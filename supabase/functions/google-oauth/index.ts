// =============================================================
// google-oauth: Googleカレンダーとつなぐ（同意 → 鍵の受け取り）
// ---------------------------------------------------------------
//  二つの入口を一つの関数にしています。Google に登録する戻り先
//  （リダイレクトURI）は一つでないといけないためです。
//
//    GET  ?start=1   … Google の同意画面の URL を返す（要ログイン）
//                      &hint=メール で、つなぎ直すアカウントを先に伝える
//    GET  ?code=...  … Google が戻してくる。鍵を受け取ってしまい、
//                      TsuguAi の画面へ戻す（?gcal=ok ／ ?gcal=err&m=理由）
//
//  一人が複数の Google アカウントをつなげます（個人と会社など）。
//  つなぐたびに google_cal_links に行が増えます。
//
//  認証: 戻り先には JWT が付きません。だから「Verify JWT」は OFF にし、
//        start のときだけ Authorization ヘッダの中身を自分で確かめます。
//
//  state: 誰の同意かを戻り先まで運ぶ札です。推測されると他人の
//        カレンダーを自分に結び付けられてしまうので、**署名**します
//        （HMAC-SHA256・10分で失効）。
//
//  デプロイ:
//    supabase functions deploy google-oauth --no-verify-jwt
//
//  Secrets（Supabase → Edge Functions → Secrets）:
//    GOOGLE_CLIENT_ID      … Google Cloud の OAuth クライアントID
//    GOOGLE_CLIENT_SECRET  … 同シークレット
//    GOOGLE_REDIRECT_URI   … この関数の URL（Google 側にも同じものを登録）
//    GOOGLE_STATE_SECRET   … 札の署名に使う任意の長い文字列
//    APP_URL               … 終わったあとに戻すページ（例 https://y12fukukitaru.github.io/Tsugu-Ai/）
// =============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const REDIRECT_URI = Deno.env.get("GOOGLE_REDIRECT_URI") ?? "";
const STATE_SECRET = Deno.env.get("GOOGLE_STATE_SECRET") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "";

//  予定の読み書きと、どのアカウントかを知るぶんだけ。
//  これ以上は求めません（求めるほど同意画面が重くなります）
const SCOPE = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "openid",
  "email",
].join(" ");

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

//  終わったら TsuguAi の画面へ戻す（302 リダイレクト）
//
//  以前はここで HTML の画面を出していましたが、Supabase の Edge Function は
//  HTML を返しても**文字のまま**表示されます（content-type を明示しても
//  同じでした。実際にそうなりました）。読ませる画面は作らず、結果だけを
//  URL に添えて TsuguAi に戻し、向こうの画面で伝えます。
//
//    うまくいった  → APP_URL?gcal=ok
//    だめだった    → APP_URL?gcal=err&m=（理由）
//
//  戻った先の画面は、予定タブを開いて、結果を出し、すぐ同期します。
//  APP_URL が無いときだけ、文字で結果を返します。
function back(ok: boolean, msg: string) {
  if (!APP_URL) {
    return new Response(`${ok ? "つながりました" : "つなげませんでした"}\n\n${msg}`, {
      status: ok ? 200 : 400,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const u = new URL(APP_URL);
  u.searchParams.set("gcal", ok ? "ok" : "err");
  if (!ok) u.searchParams.set("m", msg);
  return new Response(null, {
    status: 302,
    headers: { location: u.toString(), "cache-control": "no-store" },
  });
}

//  ---- 札の署名（HMAC-SHA256）----
async function hmac(data: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(STATE_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function makeState(userId: string) {
  const body = `${userId}.${Date.now()}`;
  return `${body}.${await hmac(body)}`;
}
async function readState(state: string): Promise<string | null> {
  const p = String(state || "").split(".");
  if (p.length !== 3) return null;
  const body = `${p[0]}.${p[1]}`;
  //  署名が合うこと。時間をかけずに比べると差が漏れるので、長さも先に見る
  const want = await hmac(body);
  if (want.length !== p[2].length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ p[2].charCodeAt(i);
  if (diff !== 0) return null;
  //  10分で失効
  if (Date.now() - Number(p[1]) > 600000) return null;
  return p[0];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI || !STATE_SECRET) {
    const miss = "Google連携の設定が済んでいません（Secrets：GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI / GOOGLE_STATE_SECRET）";
    return url.searchParams.get("code")
      ? back(false, miss)
      : json({ ok: false, error: miss }, 500);
  }

  // ---------------------------------------------------------------
  // ① 同意画面の URL を返す
  // ---------------------------------------------------------------
  if (url.searchParams.get("start")) {
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, error: "ログインが必要です" }, 401);
    const { data: u, error } = await sb.auth.getUser(token);
    if (error || !u?.user) return json({ ok: false, error: "ログインを確かめられませんでした" }, 401);

    const p = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: SCOPE,
      //  更新用の鍵をもらうために要る二つ。offline でないと
      //  1時間ごとにログインし直しになります。
      //  select_account は、二つ目のアカウントをつなぐときに
      //  「どのアカウントか」を必ず選ばせるため（無いと、いま
      //  ブラウザに入っているほうで勝手に進みます）
      access_type: "offline",
      prompt: "consent select_account",
      include_granted_scopes: "true",
      state: await makeState(u.user.id),
    });
    //  つなぎ直しのときは、どのアカウントかを先に伝えて選びやすくする
    const hint = url.searchParams.get("hint") ?? "";
    if (hint) p.set("login_hint", hint);
    return json({ ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${p}` });
  }

  // ---------------------------------------------------------------
  // ② Google からの戻り
  // ---------------------------------------------------------------
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (err) {
    return back(false,
      err === "access_denied"
        ? "Google の画面で「許可」が押されなかったため、つながっていません。もう一度お試しいただけます。"
        : `Google から次の返事がありました：${err}`);
  }
  if (!code) return json({ ok: false, error: "使い方が違います" }, 400);

  const userId = await readState(url.searchParams.get("state") ?? "");
  if (!userId) {
    return back(false,
      "確認の札が合わないか、時間が経ちすぎています（10分で切れます）。もう一度「Googleでつなぐ」からお試しください。");
  }

  //  code を鍵に交換する
  let tok: any;
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI, grant_type: "authorization_code",
      }),
    });
    tok = await r.json();
    if (!r.ok) throw new Error(tok?.error_description || tok?.error || `HTTP ${r.status}`);
  } catch (e) {
    return back(false, `Google とのやり取りで止まりました：${String((e as Error).message)}`);
  }

  //  どのアカウントか（id_token の中身を見るだけ。署名は Google 直送なので信じてよい）
  let email = "";
  try {
    const part = String(tok.id_token || "").split(".")[1];
    if (part) {
      const pad = part.replace(/-/g, "+").replace(/_/g, "/");
      email = JSON.parse(atob(pad + "=".repeat((4 - pad.length % 4) % 4)))?.email ?? "";
    }
  } catch { /* 名前が取れなくても、つながりは作れる */ }

  //  更新用の鍵は暗号化してしまう（SQL 側の関数がやる）。
  //  同じアカウントなら上書き、新しいアカウントなら行が増えます。
  //  返ってくるのは、そのつながりの番号です
  const { data: linkId, error: e1 } = await sb.rpc("google_link_save", {
    p_user: userId, p_email: email, p_refresh: tok.refresh_token ?? "",
  });
  if (e1 || !linkId) return back(false, `保存で止まりました：${e1?.message ?? "つながりの番号が返りませんでした"}`);

  //  短いほうの鍵は、そのまま入れておく（すぐ同期できるように）
  if (tok.access_token) {
    await sb.from("google_cal_links").update({
      access_token: tok.access_token,
      access_expires: new Date(Date.now() + (Number(tok.expires_in || 3600) - 60) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", linkId);
  }

  //  更新用の鍵が来なかったとき（二度目以降の同意で起きます）。
  //  前のものが残っていれば、それで動きます
  const { data: link } = await sb.from("google_cal_links")
    .select("refresh_enc").eq("id", linkId).maybeSingle();
  if (!link?.refresh_enc) {
    return back(false,
      "Google から更新用の鍵が返りませんでした。Google アカウントの「セキュリティ → サードパーティのアクセス」から TsuguAi のアクセスを一度削除してから、もう一度おつなぎください。");
  }

  return back(true, email);
});
