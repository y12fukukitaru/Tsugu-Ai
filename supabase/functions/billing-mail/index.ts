// =============================================================
// billing-mail: お支払いのご案内をメールで届ける
//
//  いまは「初期導入費のご案内」（action:"setup"）だけ。
//    顧客が顧問契約を受け取った最初の一度に、DB の引き金（setup_fee_on_claim）が
//    初期導入費の請求と、ご案内の記録（setup_fee_notices）を作る。
//    ここは、その記録のうちまだ送っていないものを、登録のメールアドレスへ送る。
//
//  呼び方
//    ① ご本人の画面（ログインのあと、送っていないご案内があるとき）
//         { action:"setup" }
//       → 本人の未送信のご案内だけを送る。宛先は登録のアドレス（画面からは受け取らない）
//    ② 運営の画面（請求と未収の「案内メールを送る」）
//         { action:"setup", invoice_id }
//       → その初期導入費の請求のご案内を送る（再送も）。手で立てた請求にも使える
//
//  二重に送らない：①は「未送信 → 送信中」を1行ずつ取ってから送る。
//  同じ方が2台で同時にログインしても、送るのは一度だけ。
//
//  お振込先は、概要タブの「お振込先（顧客向け）」（app_settings.billing_rates の bl-bank）。
//  アプリのお支払い画面と同じものを載せる。
//
// 応答: { ok:true, sent:n } / { ok:false, error }
//
// デプロイ（Dashboard → Edge Functions → 新しい関数「billing-mail」に貼り付け）:
//   JWT の確認（Verify JWT）は外してよい。認証はこの関数の中で行う
//   Secret の追加は不要（RESEND_API_KEY・MAIL_FROM・APP_URL は設定済みのものを使う）
//
// 先に実行しておく SQL:
//   supabase/migrations/20261015000000_debit_mandate_setup_fee.sql
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
//  既定値は contract-send・agent-heartbeat と揃えてある
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
const yen = (n: number) => `${Math.round(Number(n) || 0).toLocaleString("ja-JP")}円`;
function jaDate(d: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d ?? ""));
  return m ? `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日` : "";
}

type Inv = {
  id: string; customer_id: string; kind: string; title: string; status: string;
  amount_ex: number; tax: number; amount: number; due_on: string | null;
};

//  初期導入費のご案内。お振込先は、アプリのお支払い画面と同じ文をそのまま載せる
export function setupHtml(o: {
  company: string; contact: string; inv: Inv; bank: string;
}): string {
  const to = [o.company ? `${esc(o.company)} 御中` : "", o.contact ? `${esc(o.contact)} 様` : ""]
    .filter(Boolean).join("<br>") || "ご担当者様";
  const bank = o.bank.trim()
    ? `<div style="white-space:pre-wrap;background:#F8F9FC;border:1px solid #E2E7EF;border-radius:10px;padding:12px 14px;font-size:13px;color:#18202E;line-height:1.9;">${esc(o.bank.trim())}</div>`
    : `<div style="font-size:13px;color:#18202E;line-height:1.9;">お振込先は、アプリの「お支払い」でご確認ください。</div>`;
  const row = (k: string, v: string) =>
    `<tr><td style="padding:7px 0;color:#5A6981;width:34%;vertical-align:top;">${k}</td><td style="padding:7px 0;color:#18202E;">${v}</td></tr>`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F4F6FA;">
<div style="max-width:600px;margin:0 auto;padding:28px 20px;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Noto Sans JP',sans-serif;">
  <div style="text-align:center;font-size:15px;font-weight:700;color:#1E3A66;margin-bottom:18px;">
    TsuguAi<span style="color:#C8A24B;">-継-</span></div>
  <div style="background:#fff;border:1px solid #E2E7EF;border-radius:14px;padding:24px;">
    <div style="font-size:11px;color:#8A6D2F;font-weight:700;">💴 初期導入費のご案内</div>
    <div style="font-size:13px;color:#18202E;line-height:2;margin-top:10px;">${to}</div>
    <div style="font-size:13px;color:#18202E;line-height:2;margin-top:10px;">
      このたびは TsuguAi -継- の顧問契約にご登録いただき、ありがとうございます。<br>
      初期導入費のご請求をお知らせします。</div>
    <table style="width:100%;font-size:13px;margin-top:12px;border-collapse:collapse;border-top:1px solid #EDF1F6;">
      ${row("ご請求", esc(o.inv.title))}
      ${row("金額", `${yen(o.inv.amount_ex)}（税別）＋ 消費税 ${yen(o.inv.tax)}<br><b style="color:#1E3A66;font-size:15px;">${yen(o.inv.amount)}（税込）</b>`)}
      ${row("お支払期日", `<b>${esc(jaDate(o.inv.due_on))}</b>`)}
      ${row("お支払い方法", "銀行振込")}
    </table>
    <div style="font-size:12px;color:#8A6D2F;font-weight:700;margin:16px 0 6px;">お振込先</div>
    ${bank}
    <div style="font-size:12.5px;color:#18202E;line-height:1.95;margin-top:12px;">
      お振込の際は、<b>ご依頼人名をご契約の会社名</b>にしてください（入金の確認に使います）。振込手数料はご負担をお願いしております。<br>
      初期導入費は、契約後のはじめの90日（土台づくり）で担当パートナーと運営が動くための費用です（初回のみ）。<br>
      毎月の顧問料のお支払い（口座振替・銀行振込）は、担当パートナーから別にご案内します。</div>
    <div style="text-align:center;margin:20px 0 6px;">
      <a href="${APP_URL}" style="display:inline-block;background:#1E3A66;color:#fff;text-decoration:none;
        font-size:14px;font-weight:700;padding:12px 28px;border-radius:9px;">アプリの「お支払い」で確かめる →</a></div>
    <div style="font-size:11.5px;color:#A9403D;line-height:1.85;margin-top:14px;background:#FBF3F2;border-radius:9px;padding:10px 12px;">
      TsuguAi から、メールだけでお振込先の変更をお願いすることはありません。
      お振込先の違うメールが届いたときは、お振り込みにならず、担当パートナーか運営へご連絡ください。</div>
  </div>
  <div style="text-align:center;font-size:11px;color:#94A2B6;margin-top:16px;line-height:1.8;">
    株式会社福來　TsuguAi -継-　継ぐ、を身近な経営判断に<br>${APP_URL}</div>
</div></body></html>`;
}

async function sendOne(sb: ReturnType<typeof createClient>, inv: Inv): Promise<string | null> {
  const u = await sb.auth.admin.getUserById(inv.customer_id);
  const email = u.data?.user?.email ?? "";
  if (!email) return "登録のメールアドレスがありません";
  const p = await sb.from("profiles").select("company_name, contact_name, full_name")
    .eq("id", inv.customer_id).maybeSingle();
  const s = await sb.from("app_settings").select("value").eq("key", "billing_rates").maybeSingle();
  const bank = String((s.data?.value as Record<string, unknown> | null)?.["bl-bank"] ?? "");
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [email],
        subject: "【TsuguAi -継-】初期導入費のご案内",
        html: setupHtml({
          company: p.data?.company_name ?? "",
          contact: p.data?.contact_name || p.data?.full_name || "",
          inv,
          bank,
        }),
      }),
    });
    if (!res.ok) {
      console.error("setup mail failed:", res.status, await res.text());
      return `メールを送れませんでした（${res.status}）`;
    }
    return null;
  } catch (e) {
    console.error("setup mail error:", e);
    return "メールを送れませんでした";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST のみ" }, 405);
  if (!RESEND_KEY) return json({ ok: false, error: "メールの設定（RESEND_API_KEY）がありません" }, 500);

  const uid = await signedInUserId(req);
  if (!uid) return json({ ok: false, error: "ログインが必要です" }, 401);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* 空でよい */ }
  if (body.action !== "setup") return json({ ok: false, error: "action が正しくありません" }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const INV_COLS = "id, customer_id, kind, title, status, amount_ex, tax, amount, due_on";

  // ② 運営：指定の請求のご案内を送る（再送も）
  if (body.invoice_id) {
    const me = await sb.from("profiles").select("role").eq("id", uid).maybeSingle();
    if (me.data?.role !== "admin") return json({ ok: false, error: "運営のみが送れます" }, 403);
    const iv = await sb.from("invoices").select(INV_COLS).eq("id", String(body.invoice_id)).maybeSingle();
    const inv = iv.data as Inv | null;
    if (!inv || inv.kind !== "setup") return json({ ok: false, error: "初期導入費の請求が見つかりません" });
    if (inv.status === "void") return json({ ok: false, error: "取り消した請求です" });
    if (inv.status === "paid") return json({ ok: false, error: "お支払い済みの請求です" });
    //  手で立てた請求には記録が無いので、請求の番号で作る
    const ex = await sb.from("setup_fee_notices").select("offer_id, mail_count").eq("invoice_id", inv.id).maybeSingle();
    if (!ex.data) {
      await sb.from("setup_fee_notices").insert({ offer_id: inv.id, customer_id: inv.customer_id, invoice_id: inv.id });
    }
    const err = await sendOne(sb, inv);
    const cnt = Number(ex.data?.mail_count ?? 0);
    await sb.from("setup_fee_notices")
      .update(err ? { mail_error: err } : { mailed_at: new Date().toISOString(), mail_count: cnt + 1, mail_error: null })
      .eq("invoice_id", inv.id);
    return err ? json({ ok: false, error: err }) : json({ ok: true, sent: 1 });
  }

  // ① ご本人：まだ送っていないご案内を、1行ずつ取ってから送る
  const pend = await sb.from("setup_fee_notices").select("offer_id, invoice_id, mail_count")
    .eq("customer_id", uid).is("mailed_at", null);
  let sent = 0;
  for (const n of pend.data ?? []) {
    const now = new Date().toISOString();
    const took = await sb.from("setup_fee_notices").update({ mailed_at: now })
      .eq("offer_id", n.offer_id).is("mailed_at", null).select("offer_id");
    if (!took.data?.length) continue;   // もう一台が送っている
    const iv = n.invoice_id
      ? await sb.from("invoices").select(INV_COLS).eq("id", n.invoice_id).maybeSingle()
      : { data: null };
    const inv = iv.data as Inv | null;
    if (!inv || inv.status === "void" || inv.status === "paid") {
      //  送るものが無い（取り消した・もう払っていただいた）。送らずに閉じる
      await sb.from("setup_fee_notices").update({ mail_error: "送らずに閉じました（請求が取り消し済み・お支払い済み）" })
        .eq("offer_id", n.offer_id);
      continue;
    }
    const err = await sendOne(sb, inv);
    if (err) {
      //  送れなかったら、次のログインでもう一度
      await sb.from("setup_fee_notices").update({ mailed_at: null, mail_error: err }).eq("offer_id", n.offer_id);
    } else {
      await sb.from("setup_fee_notices").update({ mail_count: Number(n.mail_count ?? 0) + 1, mail_error: null })
        .eq("offer_id", n.offer_id);
      sent++;
    }
  }
  return json({ ok: true, sent });
});
