// =============================================================
// contract-send: 契約書のURLを、相手にメールでお届けする
//
//  画面からURLをコピーして自分で送る道も残してあるが、それだけだと
//  送り忘れが起きるし、「送った・届いていない」の行き違いが残らない。
//  ここから送れば、いつ送ったかが記録として残る。
//
//  なぜサーバー側でやるのか
//    宛先を画面から受け取って送ると、URLを持っている人が誰にでも
//    送りつけられる。宛先は「その契約に書かれているアドレス」だけにする。
//    だから受け取るのはトークンだけで、宛先はこちらで引く。
//
//  呼べるのは、その契約を発行した本人か運営だけ。ログインの確認も行う。
//
//  もうひとつの役目：締結の知らせ（action:"agreed"）
//    相手が同意した瞬間、送った人・担当・運営へメールと LINE で届ける。
//    アプリ内のお知らせ（agent_insights）は DB の contract_notify_agreed が
//    同意と同じトランザクションで書く。ここはその文面をそのまま外へ運ぶ。
//    呼ぶのは同意した本人の画面（ログイン前）なので、トークンだけで受け、
//    「同意済み」かつ「まだ知らせていない」ときに一度だけ送る。
//
// 応答: { ok:true } / { ok:false, error }
//
// デプロイ:
//   supabase functions deploy contract-send --no-verify-jwt
//     ※ --no-verify-jwt でよい。認証はこの関数の中で行う
//   Secret の追加は不要（RESEND_API_KEY は設定済み。LINE_CHANNEL_ACCESS_TOKEN が
//   あれば LINE にも届く。無ければメールだけ）
//
// 先に実行しておく SQL:
//   supabase/migrations/20260905000000_contracts.sql
//   supabase/migrations/20260911010000_contract_notify.sql
//   supabase/migrations/20260911030000_contract_notified.sql  ← 締結の知らせ用
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
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const LINE_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
//  既定値は agent-heartbeat と揃えてある。Secret が外れたときに、
//  片方だけ別の差出人で飛ぶ事故を防ぐ
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "TsuguAi -継- <onboarding@resend.dev>";
const APP_URL = Deno.env.get("APP_URL") ?? "https://y12fukukitaru.github.io/Tsugu-Ai/";

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

function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function mailHtml(o: {
  kind: string; title: string; url: string; fee: number | null; fromName: string;
}): string {
  const isPartner = o.kind === "partner";
  const lead = isPartner
    ? "TsuguAi -継- の認定パートナー契約についてご案内します。"
    : `${o.fromName}より、経営支援の顧問契約についてご案内します。`;
  const feeRow = o.fee == null ? "" :
    `<tr><td style="padding:6px 0;color:#5A6981;">顧問料</td>
      <td style="padding:6px 0;color:#1E3A66;font-weight:700;">月額 ${o.fee.toLocaleString("ja-JP")}円（税別）</td></tr>`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F4F6FA;">
<div style="max-width:600px;margin:0 auto;padding:28px 20px;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Noto Sans JP',sans-serif;">
  <div style="text-align:center;font-size:15px;font-weight:700;color:#1E3A66;margin-bottom:18px;">
    TsuguAi<span style="color:#C8A24B;">-継-</span></div>
  <div style="background:#fff;border:1px solid #E2E7EF;border-radius:14px;padding:24px;">
    <div style="font-size:11px;color:#8A6D2F;font-weight:700;">📄 ご契約のご案内</div>
    <div style="font-size:16px;font-weight:700;color:#1E3A66;margin-top:6px;line-height:1.6;">${esc(o.title)}</div>
    <div style="font-size:13px;color:#18202E;line-height:2;margin-top:12px;">${esc(lead)}</div>
    <table style="width:100%;font-size:12.5px;margin-top:10px;border-collapse:collapse;">${feeRow}</table>
    <div style="font-size:13px;color:#18202E;line-height:2;margin-top:12px;">
      下のボタンから契約書をお読みいただき、<b>お名前をご記入のうえご同意ください。</b>
      ご同意いただいた時点で契約が成立し、そのままご登録いただけます。</div>
    <div style="text-align:center;margin:20px 0 6px;">
      <a href="${o.url}" style="display:inline-block;background:#1E3A66;color:#fff;text-decoration:none;
        font-size:14px;font-weight:700;padding:13px 30px;border-radius:9px;">契約書を読む →</a></div>
    <div style="font-size:11px;color:#94A2B6;line-height:1.9;margin-top:14px;">
      ボタンが開かない場合は、次のURLをブラウザに貼り付けてください。<br>
      <span style="word-break:break-all;color:#5A6981;">${o.url}</span><br><br>
      このURLの有効期限は<b>30日間</b>です。<br>
      お心当たりのない場合は、お手数ですがこのメールは破棄してください。</div>
  </div>
  <div style="text-align:center;font-size:11px;color:#94A2B6;margin-top:16px;line-height:1.8;">
    このメールは TsuguAi -継- からお送りしています。<br>${APP_URL}</div>
</div></body></html>`;
}

// ---- 締結の知らせ：メールと LINE で「同意がありました」を運ぶ ----
//  文面は DB が書いたお知らせ（agent_insights, kind=contract_agreed）と同じ。
//  アプリの中と外で違う文が届くと、「どちらが正しいのか」から会話が始まる。
function noticeHtml(n: { title: string; body: string }): string {
  const body = String(n.body ?? "").split("\n").map((l) => esc(l.trim())).join("<br>");
  return `<div style="font-family:'Hiragino Sans','Noto Sans JP',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18202E;">
    <div style="font-size:13px;color:#C39B3F;font-weight:bold;">✦ 契約が締結されました</div>
    <h2 style="font-size:17px;color:#1E3A66;margin:8px 0 14px;">${esc(n.title)}</h2>
    <div style="font-size:14px;line-height:1.9;background:#F8F9FC;border:1px solid #E2E7EF;border-radius:10px;padding:16px 18px;">${body}</div>
    <div style="margin:18px 0;"><a href="${APP_URL}" style="display:inline-block;background:#1E3A66;color:#fff;text-decoration:none;font-size:13px;font-weight:bold;padding:11px 22px;border-radius:9px;">TsuguAiを開く →</a></div>
    <div style="font-size:11px;color:#5A6981;line-height:1.7;">このメールは TsuguAi -継- の継ナビくんが、契約書に同意があった瞬間に自動でお送りしています。</div>
  </div>`;
}

//  ひとりに届ける。失敗は握りつぶしてログに残す（契約自体は成立している）
async function deliverNotice(sb: any, userId: string, n: { title: string; body: string })
  : Promise<{ mail: number; line: number }> {
  const out = { mail: 0, line: 0 };
  if (RESEND_KEY) {
    try {
      const { data: prof } = await sb.from("profiles").select("email").eq("id", userId).maybeSingle();
      if (prof?.email) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_KEY}`, "content-type": "application/json" },
          body: JSON.stringify({
            from: MAIL_FROM, to: [prof.email],
            subject: `【継ナビくん】${n.title}`,
            html: noticeHtml(n),
          }),
        });
        if (res.ok) out.mail++;
        else console.error("notice mail failed:", res.status, await res.text());
      }
    } catch (e) { console.error("notice mail failed:", e); }
  }
  if (LINE_TOKEN) {
    try {
      const { data: link } = await sb.from("line_links").select("line_user_id").eq("user_id", userId).maybeSingle();
      if (link?.line_user_id) {
        const res = await fetch("https://api.line.me/v2/bot/message/push", {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: `Bearer ${LINE_TOKEN}` },
          body: JSON.stringify({
            to: link.line_user_id,
            messages: [{ type: "text", text: `✦ ${n.title}\n\n${n.body}\n\nアプリで開く → ${APP_URL}` }],
          }),
        });
        if (res.ok) out.line++;
        else console.error("notice line failed:", res.status, await res.text());
      }
    } catch (e) { console.error("notice line failed:", e); }
  }
  return out;
}

//  DB のお知らせが（万一）無かったときの控え。宛先の決め方は
//  contract_notify_agreed と同じ：送った人・担当・運営の全員
async function fallbackNotices(sb: any, o: any): Promise<{ user_id: string; title: string; body: string }[]> {
  const isCust = o.kind === "customer";
  const when = new Date(o.agreed_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", hour12: false });
  const who = [o.agreed_org, o.agreed_name].filter(Boolean).join("　");
  const title = (isCust ? "顧問契約が締結されました：" : "パートナー契約が締結されました：") + o.email;
  const body = `${who} 様が ${when} に同意しました。` +
    (isCust && o.monthly_fee != null ? `顧問料 ${Number(o.monthly_fee).toLocaleString("ja-JP")}円（税別）。` : "") +
    "\nご本人がこのメールアドレスで登録した瞬間に、" + (isCust ? "担当が自動で付きます。" : "認定パートナーになります。");
  const ids = new Set<string>();
  if (o.offered_by) ids.add(o.offered_by);
  if (o.consultant_id) ids.add(o.consultant_id);
  const { data: admins } = await sb.from("profiles").select("id").eq("role", "admin");
  for (const a of admins ?? []) ids.add(a.id);
  return [...ids].map((user_id) => ({ user_id, title, body }));
}

async function notifyAgreed(sb: any, token: string): Promise<Response> {
  const o = await sb.from("contract_offers")
    .select("id,kind,email,status,agreed_at,agreed_name,agreed_org,monthly_fee,offered_by,consultant_id")
    .eq("token", token).maybeSingle();
  if (o.error) return json({ ok: false, error: "契約を確かめられませんでした" }, 500);
  if (!o.data) return json({ ok: false, error: "その契約は見つかりませんでした" }, 404);
  if (o.data.status !== "agreed") return json({ ok: false, error: "まだ同意されていません" }, 400);
  //  古い契約を掘り起こして送らせない。同意の直後に画面から呼ばれるものだけ
  if (Date.now() - new Date(o.data.agreed_at).getTime() > 3 * 86400000) return json({ ok: true, already: true });

  //  先に「知らせた」の印を付けてから送る。同時に2回呼ばれても片方しか通らない
  const mark = await sb.from("contract_offers")
    .update({ notified_at: new Date().toISOString() })
    .eq("id", o.data.id).is("notified_at", null).select("id");
  if (mark.error) {
    if (/notified_at/.test(String(mark.error.message))) {
      return json({ ok: false, error: "SQL（20260911030000_contract_notified.sql）が未実行です" }, 200);
    }
    return json({ ok: false, error: "知らせの印を付けられませんでした" }, 500);
  }
  if (!mark.data?.length) return json({ ok: true, already: true });

  let notes: { user_id: string; title: string; body: string }[] =
    (await sb.from("agent_insights").select("user_id,title,body")
      .eq("kind", "contract_agreed").eq("reason", "contract_offers.id=" + o.data.id)).data ?? [];
  if (!notes.length) notes = await fallbackNotices(sb, o.data);

  let mail = 0, line = 0;
  for (const n of notes) {
    const r = await deliverNotice(sb, n.user_id, n);
    mail += r.mail; line += r.line;
  }
  return json({ ok: true, to: notes.length, mail, line });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST のみ受け付けます" }, 405);
  if (!SERVICE_KEY) return json({ ok: false, error: "サーバーの設定が足りません" }, 500);
  if (!RESEND_KEY) return json({ ok: false, error: "メールの設定がされていません" }, 500);

  let body: { token?: string; url?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "リクエストを読めませんでした" }, 400);
  }
  const token = String(body.token ?? "").trim();
  if (token.length < 32) return json({ ok: false, error: "契約が指定されていません" }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  //  締結の知らせ。同意した本人の画面（ログイン前）から呼ばれる
  if (body.action === "agreed") return await notifyAgreed(sb, token);

  const meId = await signedInUserId(req);
  if (!meId) return json({ ok: false, error: "ログインが必要です" }, 401);

  const o = await sb
    .from("contract_offers")
    .select("id,kind,email,title,monthly_fee,offered_by,status,sent_at")
    .eq("token", token)
    .maybeSingle();
  if (o.error) return json({ ok: false, error: "契約を確かめられませんでした" }, 500);
  if (!o.data) return json({ ok: false, error: "その契約は見つかりませんでした" }, 404);
  if (o.data.status !== "sent") {
    return json({ ok: false, error: "この契約は、すでに同意済みか取り消されています" }, 400);
  }

  // 発行した本人か、運営だけ。他人の契約書を送りつけられないようにする
  if (o.data.offered_by !== meId) {
    const me = await sb.from("profiles").select("role").eq("id", meId).maybeSingle();
    if (me.data?.role !== "admin") {
      return json({ ok: false, error: "この契約を送る権限がありません" }, 403);
    }
  }

  // 差出人の名前（顧問契約は「誰から届いたのか」が分からないと開かれない）
  let fromName = "TsuguAi -継-";
  const p = await sb.from("profiles").select("company_name,contact_name")
    .eq("id", o.data.offered_by).maybeSingle();
  if (p.data) fromName = p.data.company_name || p.data.contact_name || fromName;

  // 宛先は契約に書かれているアドレスだけ。画面から受け取らない
  const url = String(body.url ?? "").trim() || `${APP_URL}?c=${token}`;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [o.data.email],
        subject: `【TsuguAi -継-】${o.data.title}`,
        html: mailHtml({
          kind: o.data.kind,
          title: o.data.title,
          url,
          fee: o.data.monthly_fee == null ? null : Number(o.data.monthly_fee),
          fromName,
        }),
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error("contract mail failed:", res.status, t);
      return json({ ok: false, error: `メールを送れませんでした（${res.status}）` }, 200);
    }
  } catch (e) {
    console.error("contract mail failed:", e);
    return json({ ok: false, error: "メールを送れませんでした" }, 200);
  }

  // いつ送ったかを残す。「送った・届いていない」の行き違いを残さない
  await sb.from("contract_offers").update({ sent_at: new Date().toISOString() }).eq("id", o.data.id);

  return json({ ok: true, to: o.data.email });
});
