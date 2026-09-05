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
// 応答: { ok:true } / { ok:false, error }
//
// デプロイ:
//   supabase functions deploy contract-send --no-verify-jwt
//     ※ --no-verify-jwt でよい。認証はこの関数の中で行う
//   Secret の追加は不要（RESEND_API_KEY は設定済み）
//
// 先に実行しておく SQL:
//   supabase/migrations/20260905000000_contracts.sql
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST のみ受け付けます" }, 405);
  if (!SERVICE_KEY) return json({ ok: false, error: "サーバーの設定が足りません" }, 500);
  if (!RESEND_KEY) return json({ ok: false, error: "メールの設定がされていません" }, 500);

  const meId = await signedInUserId(req);
  if (!meId) return json({ ok: false, error: "ログインが必要です" }, 401);

  let body: { token?: string; url?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "リクエストを読めませんでした" }, 400);
  }
  const token = String(body.token ?? "").trim();
  if (token.length < 32) return json({ ok: false, error: "契約が指定されていません" }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

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
