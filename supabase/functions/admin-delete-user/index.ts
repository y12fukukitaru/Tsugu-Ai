// =============================================================
// admin-delete-user: 運営が、運営コンソールの中からアカウントを削除する
//
//  なぜサーバー側でやるのか
//    auth.users を消せるのは service_role キーを持つ者だけで、このキーは
//    ブラウザに置けない。置いた瞬間、開発者ツールを開いた誰でも全データを
//    読み書きできる。だからキーはここ（サーバー）にだけ置き、画面からは
//    「消してください」と頼むだけにする。
//
//  取り消せない操作なので、通す前に四つ確かめる
//    ① 呼んだ人がログイン中の本人であること
//    ② その人が運営（role='admin'）であること
//    ③ 消す相手が顧客（role='customer'）であること
//       ── 運営やパートナーはここからは消せない。押し間違いで運営自身が
//          消えると、誰も入れなくなる
//    ④ 画面で打ち込んだ会社名が、その方の会社名と一致すること
//       ── 一覧のボタンを押し間違えても、名前まで一致することはない。
//          この確認はサーバーでも行う。画面側だけの確認は、画面を
//          書き換えれば素通りできる
//
//  消す順番
//    記録 → 招待の片づけ → ご依頼を対応済みに → 本体を削除
//    記録を先に取る。削除に失敗しても記録だけ残るほうが、削除できたのに
//    記録が無いより、あとから辿れる。
//
//  招待の片づけを忘れない
//    customer_invites に pending が残っていると、同じアドレスで登録し直した
//    ときに以前の担当が再び付いてしまう。「再登録は新規扱い」にならない。
//
// 応答: { ok:true, deleted:{email, company_name} } / { ok:false, error }
//
// デプロイ:
//   supabase functions deploy admin-delete-user --no-verify-jwt
//     ※ --no-verify-jwt でよい。認証はこの関数の中で行う
//       （そのほうが「運営のみ実行できます」と日本語で返せる）
//   Secret の追加は不要。SUPABASE_SERVICE_ROLE_KEY は既定で入っている
//
// 先に実行しておく SQL:
//   supabase/migrations/20260903030000_account_deletions.sql
// =============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// 呼んでいるのがログイン中の本人かどうかを確かめ、本人の id を返す。
// publishable key（画面のソースに載っている公開鍵）を投げてきただけでは通らない。
async function signedInUserId(req: Request): Promise<string | null> {
  const authz = req.headers.get("Authorization") ?? "";
  const jwt = authz.replace(/^Bearer\s+/i, "").trim();
  if (!jwt || jwt === ANON_KEY) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: ANON_KEY },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? String(u.id) : null;
  } catch {
    return null;
  }
}

// 打ち込まれた確認の言葉と、控えの名前を突き合わせる。
// 前後の空白と全角空白は落とす。「株式会社 え」と「株式会社え」で
// 弾かれるのは、確認としては厳しすぎて、かえって雑に流されやすい。
function sameName(a: string, b: string): boolean {
  const norm = (s: string) => String(s ?? "").replace(/[\s　]+/g, "").trim();
  const x = norm(a);
  return x !== "" && x === norm(b);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST のみ受け付けます" }, 405);
  if (!SERVICE_KEY) return json({ ok: false, error: "サーバーの設定が足りません" }, 500);

  // ① ログイン中の本人か
  const meId = await signedInUserId(req);
  if (!meId) return json({ ok: false, error: "ログインが必要です" }, 401);

  let body: { user_id?: string; confirm_name?: string; cancel_request_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "リクエストを読めませんでした" }, 400);
  }
  const targetId = String(body.user_id ?? "").trim();
  const confirmName = String(body.confirm_name ?? "");
  if (!targetId) return json({ ok: false, error: "削除する方が指定されていません" }, 400);
  if (targetId === meId) {
    return json({ ok: false, error: "ご自身のアカウントはここからは削除できません" }, 400);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // ② 運営か
  const me = await sb.from("profiles").select("role,email").eq("id", meId).maybeSingle();
  if (me.error) return json({ ok: false, error: "権限を確かめられませんでした" }, 500);
  if (!me.data || me.data.role !== "admin") {
    return json({ ok: false, error: "運営のみ実行できます" }, 403);
  }

  // 消す直前の姿を取る
  const t = await sb
    .from("profiles")
    .select("id,email,company_name,contact_name,role,consultant_id")
    .eq("id", targetId)
    .maybeSingle();
  if (t.error) return json({ ok: false, error: "対象を確かめられませんでした" }, 500);
  if (!t.data) return json({ ok: false, error: "その方は見つかりませんでした（すでに削除済みかもしれません）" }, 404);

  // ③ 顧客だけ
  if (t.data.role !== "customer") {
    return json(
      { ok: false, error: "経営者（顧客）のアカウントのみ削除できます。パートナー・運営の削除は Supabase の管理画面から行ってください" },
      400,
    );
  }

  // ④ 名前の一致。画面側だけでなく、ここでも確かめる
  const expected = String(t.data.company_name || t.data.contact_name || t.data.email || "");
  if (!sameName(confirmName, expected)) {
    return json({ ok: false, error: `確認の言葉が一致しません。「${expected}」と入力してください` }, 400);
  }

  // 担当パートナーの控え（記録を人が読めるように）
  let consultantEmail: string | null = null;
  if (t.data.consultant_id) {
    const c = await sb.from("profiles").select("email").eq("id", t.data.consultant_id).maybeSingle();
    consultantEmail = c.data?.email ?? null;
  }

  // 解約のご依頼（あれば理由も控える）
  let reason: string | null = null;
  let cancelId: string | null = body.cancel_request_id ? String(body.cancel_request_id) : null;
  try {
    const cr = await sb
      .from("cancel_requests")
      .select("id,reason,note")
      .eq("customer_id", targetId)
      .eq("status", "open")
      .order("created_at", { ascending: true })
      .limit(1);
    if (!cr.error && cr.data && cr.data.length) {
      cancelId = cancelId || String(cr.data[0].id);
      reason = [cr.data[0].reason, cr.data[0].note].filter(Boolean).join(" / ") || null;
    }
  } catch { /* 表がまだ無い環境。削除は止めない */ }

  // ---- 記録を先に取る ----
  //  削除に失敗しても記録だけ残るほうが、削除できたのに記録が無いより辿れる。
  //  ただし記録が取れないときは進めない。取り消せない操作を、跡形もなく
  //  行ってしまうことになる。
  const rec = await sb.from("account_deletions").insert({
    deleted_user_id: targetId,
    email: t.data.email,
    company_name: t.data.company_name,
    contact_name: t.data.contact_name,
    role: t.data.role,
    consultant_id: t.data.consultant_id,
    consultant_email: consultantEmail,
    cancel_request_id: cancelId,
    reason,
    deleted_by: meId,
    deleted_by_email: me.data.email ?? null,
  });
  if (rec.error) {
    return json(
      { ok: false, error: "削除の記録を残せませんでした。記録が残らない削除は行いません（account_deletions の SQL は実行済みですか）：" + rec.error.message },
      500,
    );
  }

  // ---- 招待の片づけ ----
  //  残っていると、同じアドレスで登録し直したときに以前の担当が再び付く。
  //  「再登録は新規扱い」が崩れる。
  if (t.data.email) {
    try {
      await sb
        .from("customer_invites")
        .update({ status: "cancelled" })
        .eq("status", "pending")
        .ilike("email", t.data.email);
    } catch { /* 表がまだ無い環境 */ }
  }

  // ---- ご依頼を対応済みに ----
  //  本体を消すと cancel_requests も外部キーで消えるが、
  //  順番が前後しても困らないように先に締めておく。
  if (cancelId) {
    try {
      await sb
        .from("cancel_requests")
        .update({ status: "done", handled_at: new Date().toISOString(), handled_by: meId })
        .eq("id", cancelId);
    } catch { /* 表がまだ無い環境 */ }
  }

  // ---- 本体を削除 ----
  //  profiles・試算表・相談・手元資金など、紐づくものは外部キーで一緒に消える。
  const del = await sb.auth.admin.deleteUser(targetId);
  if (del.error) {
    return json({ ok: false, error: "削除できませんでした：" + del.error.message }, 500);
  }

  return json({
    ok: true,
    deleted: { email: t.data.email, company_name: expected },
  });
});
