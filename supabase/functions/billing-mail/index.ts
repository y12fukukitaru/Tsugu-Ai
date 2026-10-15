// =============================================================
// billing-mail: お支払いのご案内をメールで届ける
//
//  2つのご案内を送る。
//    ・初回のお振込みのご案内（action:"setup"）
//    ・お振込みのお願い（action:"dunning"）… 引き落とせなかった・期日を過ぎた分を、
//      運営か担当パートナーが「お振込みのお願いを送る」で送る（下の ③）
//
//  初回のお振込みのご案内：
//    顧客が顧問契約を受け取った最初の一度に、DB の引き金（setup_fee_on_claim）が
//    初期導入費と、ご登録の翌月分の顧問料の請求、ご案内の記録（setup_fee_notices）を作る。
//    ここは、その記録のうちまだ送っていないものを、登録のメールアドレスへ送る。
//    ご登録の月の顧問料はいただかない。口座振替は、ご登録の2か月後の分から。
//
//  呼び方
//    ① ご本人の画面（ログインのあと、送っていないご案内があるとき）
//         { action:"setup" }
//       → 本人の未送信のご案内だけを送る。宛先は登録のアドレス（画面からは受け取らない）
//    ② 運営の画面（請求と未収の「案内メールを送る」）
//         { action:"setup", invoice_id }
//       → その請求（初期導入費か、初回に入れた顧問料）のご案内を送る（再送も）。
//         手で立てた初期導入費にも使える
//
//    ③ 運営・担当パートナーの画面（未収の「お振込みのお願いを送る」）
//         { action:"dunning", notice_id }
//       → DB の dunning_prepare が作った記録（dunning_notices）の請求を、まとめて案内する。
//         送れるのは、その記録を作った本人か運営。送るのは一度だけ
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
//   supabase/migrations/20261015010000_dunning.sql（お振込みのお願い）
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
  amount_ex: number; tax: number; amount: number; due_on: string | null; period?: string | null;
};

//  口座振替を始める月（初回に入れた顧問料の翌月分から）
function debitFrom(adv: Inv | null): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(adv?.period ?? ""));
  if (!m) return "";
  let y = Number(m[1]), mo = Number(m[2]) + 1;
  if (mo > 12) { mo = 1; y++; }
  return `${y}年${mo}月分`;
}

//  初回のお振込みのご案内（初期導入費＋ご登録の翌月分の顧問料）。
//  お振込先は、アプリのお支払い画面と同じ文をそのまま載せる
export function setupHtml(o: {
  company: string; contact: string; invs: Inv[]; bank: string; debitFrom?: string;
}): string {
  const to = [o.company ? `${esc(o.company)} 御中` : "", o.contact ? `${esc(o.contact)} 様` : ""]
    .filter(Boolean).join("<br>") || "ご担当者様";
  const bank = o.bank.trim()
    ? `<div style="white-space:pre-wrap;background:#F8F9FC;border:1px solid #E2E7EF;border-radius:10px;padding:12px 14px;font-size:13px;color:#18202E;line-height:1.9;">${esc(o.bank.trim())}</div>`
    : `<div style="font-size:13px;color:#18202E;line-height:1.9;">お振込先は、アプリの「お支払い」でご確認ください。</div>`;
  const row = (k: string, v: string) =>
    `<tr><td style="padding:7px 0;color:#5A6981;width:46%;vertical-align:top;">${k}</td><td style="padding:7px 0;color:#18202E;text-align:right;">${v}</td></tr>`;
  //  内訳：品目（税別）→ 小計（税別）→ 消費税（10%）→ 合計（税込）。
  //  消費税は請求ごとに計算した額の合計（アプリの請求と同じ数字になる）
  const sub = o.invs.reduce((t, x) => t + (Number(x.amount_ex) || 0), 0);
  const tax = o.invs.reduce((t, x) => t + (Number(x.tax) || 0), 0);
  const total = o.invs.reduce((t, x) => t + (Number(x.amount) || 0), 0);
  const due = o.invs.map((x) => String(x.due_on ?? "")).filter(Boolean).sort().pop() ?? "";
  const lines = o.invs.map((x) => row(esc(x.title), `${yen(x.amount_ex)}`)).join("");
  const line2 = (k: string, v: string, top = false) =>
    `<tr><td style="padding:6px 0;color:#5A6981;${top ? "border-top:1px solid #E2E7EF;" : ""}">${k}</td><td style="padding:6px 0;color:#18202E;text-align:right;${top ? "border-top:1px solid #E2E7EF;" : ""}">${v}</td></tr>`;
  const debit = o.debitFrom
    ? `<b>${esc(o.debitFrom)}の顧問料からは、口座振替（お引き落とし）</b>になります。口座振替の依頼書は、担当パートナーからお渡しします（金融機関の登録が間に合わないときは、その月も銀行振込でご案内します）。<br>`
    : "毎月の顧問料のお支払い（口座振替・銀行振込）は、担当パートナーから別にご案内します。<br>";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F4F6FA;">
<div style="max-width:600px;margin:0 auto;padding:28px 20px;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Noto Sans JP',sans-serif;">
  <div style="text-align:center;font-size:15px;font-weight:700;color:#1E3A66;margin-bottom:18px;">
    TsuguAi<span style="color:#C8A24B;">-継-</span></div>
  <div style="background:#fff;border:1px solid #E2E7EF;border-radius:14px;padding:24px;">
    <div style="font-size:11px;color:#8A6D2F;font-weight:700;">💴 初回のお振込みのご案内</div>
    <div style="font-size:13px;color:#18202E;line-height:2;margin-top:10px;">${to}</div>
    <div style="font-size:13px;color:#18202E;line-height:2;margin-top:10px;">
      このたびは TsuguAi -継- の顧問契約にご登録いただき、ありがとうございます。<br>
      初回のお振込み（初期導入費と、最初の月の顧問料）をお知らせします。<b>ご登録の月の顧問料はいただきません。</b></div>
    <div style="font-size:12px;color:#8A6D2F;font-weight:700;margin:14px 0 2px;">ご請求の内訳</div>
    <table style="width:100%;font-size:13px;border-collapse:collapse;border-top:1px solid #EDF1F6;">
      <tr><td style="padding:6px 0;color:#94A2B6;font-size:11.5px;">品目</td><td style="padding:6px 0;color:#94A2B6;font-size:11.5px;text-align:right;">金額（税別）</td></tr>
      ${lines}
      ${line2("小計（税別）", yen(sub), true)}
      ${line2("消費税（10%）", yen(tax))}
      <tr><td style="padding:9px 0;color:#1E3A66;font-weight:700;border-top:1px solid #E2E7EF;">合計（税込）</td>
        <td style="padding:9px 0;text-align:right;border-top:1px solid #E2E7EF;"><b style="color:#1E3A66;font-size:16px;">${yen(total)}</b></td></tr>
      ${row("お支払期日", `<b>${esc(jaDate(due))}</b>`)}
      ${row("お支払い方法", "銀行振込（まとめて一度に）")}
    </table>
    <div style="font-size:12px;color:#8A6D2F;font-weight:700;margin:16px 0 6px;">お振込先</div>
    ${bank}
    <div style="font-size:12.5px;color:#18202E;line-height:1.95;margin-top:12px;">
      お振込の際は、<b>ご依頼人名をご契約の会社名</b>にしてください（入金の確認に使います）。振込手数料はご負担をお願いしております。<br>
      初期導入費は、契約後のはじめの90日（土台づくり）で担当パートナーと運営が動くための費用です（初回のみ）。<br>
      ${debit}</div>
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

const INV_COLS = "id, customer_id, kind, title, status, amount_ex, tax, amount, due_on, period";
type Notice = { offer_id: string; invoice_id: string | null; advisory_invoice_id: string | null; mail_count: number | null };

//  ご案内に載せる請求（まだお支払いの済んでいないもの）。初期導入費 → 顧問料 の順
async function noticeInvoices(sb: ReturnType<typeof createClient>, n: Notice): Promise<{ invs: Inv[]; adv: Inv | null }> {
  const out: Inv[] = []; let adv: Inv | null = null;
  for (const id of [n.invoice_id, n.advisory_invoice_id]) {
    if (!id) continue;
    const r = await sb.from("invoices").select(INV_COLS).eq("id", id).maybeSingle();
    const inv = r.data as Inv | null;
    if (!inv) continue;
    if (inv.kind === "advisory") adv = inv;
    if (inv.status !== "void" && inv.status !== "paid") out.push(inv);
  }
  return { invs: out, adv };
}

async function sendOne(sb: ReturnType<typeof createClient>, customerId: string, invs: Inv[], adv: Inv | null): Promise<string | null> {
  const u = await sb.auth.admin.getUserById(customerId);
  const email = u.data?.user?.email ?? "";
  if (!email) return "登録のメールアドレスがありません";
  const p = await sb.from("profiles").select("company_name, contact_name, full_name")
    .eq("id", customerId).maybeSingle();
  const s = await sb.from("app_settings").select("value").eq("key", "billing_rates").maybeSingle();
  const bank = String((s.data?.value as Record<string, unknown> | null)?.["bl-bank"] ?? "");
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [email],
        subject: adv ? "【TsuguAi -継-】初回のお振込みのご案内（初期導入費・顧問料）" : "【TsuguAi -継-】初期導入費のご案内",
        html: setupHtml({
          company: p.data?.company_name ?? "",
          contact: p.data?.contact_name || p.data?.full_name || "",
          invs,
          bank,
          debitFrom: debitFrom(adv),
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

//  ---- お振込みのお願い（引き落とせなかった・期日を過ぎた分）----
type DInv = Inv & { paid_amount?: number | null };
export function dunningHtml(o: {
  company: string; contact: string; invs: DInv[]; bank: string; payBy: string;
  debitContinues: boolean; ask: string;
}): string {
  const to = [o.company ? `${esc(o.company)} 御中` : "", o.contact ? `${esc(o.contact)} 様` : ""]
    .filter(Boolean).join("<br>") || "ご担当者様";
  const bank = o.bank.trim()
    ? `<div style="white-space:pre-wrap;background:#F8F9FC;border:1px solid #E2E7EF;border-radius:10px;padding:12px 14px;font-size:13px;color:#18202E;line-height:1.9;">${esc(o.bank.trim())}</div>`
    : `<div style="font-size:13px;color:#18202E;line-height:1.9;">お振込先は、アプリの「お支払い」でご確認ください。</div>`;
  const tr = (k: string, v: string, top = false, strong = false) =>
    `<tr><td style="padding:6px 0;color:${strong ? "#1E3A66;font-weight:700" : "#5A6981"};${top ? "border-top:1px solid #E2E7EF;" : ""}">${k}</td><td style="padding:6px 0;color:#18202E;text-align:right;${top ? "border-top:1px solid #E2E7EF;" : ""}">${v}</td></tr>`;
  //  内訳：〇月分（税別）→ 小計（税別）→ 消費税（10%）→ 合計（税込）→ お支払い済みの分 → お振込みのお願い額
  const sub = o.invs.reduce((t, x) => t + (Number(x.amount_ex) || 0), 0);
  const tax = o.invs.reduce((t, x) => t + (Number(x.tax) || 0), 0);
  const total = o.invs.reduce((t, x) => t + (Number(x.amount) || 0), 0);
  const paid = o.invs.reduce((t, x) => t + (Number(x.paid_amount) || 0), 0);
  const lines = o.invs.map((x) => tr(esc(x.title), yen(x.amount_ex))).join("");
  const months = o.invs.map((x) => monthLabel(x)).filter(Boolean);
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F4F6FA;">
<div style="max-width:600px;margin:0 auto;padding:28px 20px;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Noto Sans JP',sans-serif;">
  <div style="text-align:center;font-size:15px;font-weight:700;color:#1E3A66;margin-bottom:18px;">
    TsuguAi<span style="color:#C8A24B;">-継-</span></div>
  <div style="background:#fff;border:1px solid #E2E7EF;border-radius:14px;padding:24px;">
    <div style="font-size:11px;color:#A9403D;font-weight:700;">💴 お振込みのお願い</div>
    <div style="font-size:13px;color:#18202E;line-height:2;margin-top:10px;">${to}</div>
    <div style="font-size:13px;color:#18202E;line-height:2;margin-top:10px;">
      いつも TsuguAi -継- をご利用いただき、ありがとうございます。<br>
      <b>${esc(months.join("・"))}</b>のお支払いが、まだ確認できておりません（口座振替でお引き落としができなかった分を含みます）。
      お手数ですが、下記のとおり<b>お振込み</b>をお願いいたします。<br>
      <span style="color:#5A6981;">行き違いでお支払いいただいている場合は、申し訳ありません。このメールは破棄してください。</span></div>
    <div style="font-size:12px;color:#8A6D2F;font-weight:700;margin:14px 0 2px;">ご請求の内訳</div>
    <table style="width:100%;font-size:13px;border-collapse:collapse;border-top:1px solid #EDF1F6;">
      <tr><td style="padding:6px 0;color:#94A2B6;font-size:11.5px;">品目</td><td style="padding:6px 0;color:#94A2B6;font-size:11.5px;text-align:right;">金額（税別）</td></tr>
      ${lines}
      ${tr("小計（税別）", yen(sub), true)}
      ${tr("消費税（10%）", yen(tax))}
      ${tr("合計（税込）", yen(total), true)}
      ${paid > 0 ? tr("お支払い済みの分", `−${yen(paid)}`) : ""}
      <tr><td style="padding:9px 0;color:#A9403D;font-weight:700;border-top:1px solid #E2E7EF;">お振込みのお願い額</td>
        <td style="padding:9px 0;text-align:right;border-top:1px solid #E2E7EF;"><b style="color:#A9403D;font-size:16px;">${yen(total - paid)}</b></td></tr>
      ${tr("お支払期日", `<b>${esc(jaDate(o.payBy))}</b>`)}
      ${tr("お支払い方法", "銀行振込（まとめて一度に）")}
    </table>
    <div style="font-size:12px;color:#8A6D2F;font-weight:700;margin:16px 0 6px;">お振込先</div>
    ${bank}
    <div style="font-size:12.5px;color:#18202E;line-height:1.95;margin-top:12px;">
      お振込の際は、<b>ご依頼人名をご契約の会社名</b>にしてください（入金の確認に使います）。振込手数料はご負担をお願いしております。<br>
      ${o.debitContinues
        ? "<b>今回の分は、口座からのお引き落としはいたしません</b>（二重のお支払いにならないよう、お振込みでお願いします）。これからの月の顧問料は、これまでどおり口座振替です。ご口座の残高のご確認をお願いします。<br>"
        : ""}
      ご不明な点は、${o.ask}までお問い合わせください。</div>
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
//  「2026年9月分」。月のない請求（初期導入費など）は件名で
function monthLabel(x: Inv): string {
  const m = /^(\d{4})-(\d{2})$/.exec(String(x.period ?? ""));
  if (x.kind === "advisory" || x.kind === "direct") return m ? `${Number(m[1])}年${Number(m[2])}月分の顧問料` : x.title;
  return x.title;
}

async function sendDunning(sb: ReturnType<typeof createClient>, uid: string, noticeId: string): Promise<Response> {
  const me = await sb.from("profiles").select("role").eq("id", uid).maybeSingle();
  const isAdmin = me.data?.role === "admin";
  const nq = await sb.from("dunning_notices")
    .select("id, customer_id, sent_by, invoice_ids, pay_by, mailed_at").eq("id", noticeId).maybeSingle();
  const n = nq.data as { id: string; customer_id: string; sent_by: string; invoice_ids: string[]; pay_by: string; mailed_at: string | null } | null;
  if (!n) return json({ ok: false, error: "お振込みのお願いの記録が見つかりません" });
  if (n.sent_by !== uid && !isAdmin) return json({ ok: false, error: "用意した本人か運営だけが送れます" }, 403);
  //  送るのは一度だけ（「送信中」を取ってから送る）
  const took = await sb.from("dunning_notices").update({ mailed_at: new Date().toISOString(), mail_error: null })
    .eq("id", n.id).is("mailed_at", null).select("id");
  if (!took.data?.length) return json({ ok: false, error: "このお願いはもう送っています" });

  const fail = async (msg: string) => {
    await sb.from("dunning_notices").update({ mailed_at: null, mail_error: msg }).eq("id", n.id);
    return json({ ok: false, error: msg });
  };
  const invs: DInv[] = [];
  for (const id of n.invoice_ids ?? []) {
    const r = await sb.from("invoices").select(INV_COLS + ", paid_amount").eq("id", id).maybeSingle();
    const x = r.data as DInv | null;
    if (x && (x.status === "open" || x.status === "partial")) invs.push(x);
  }
  if (!invs.length) return fail("お支払いの済んでいない請求がありません（入金済み・取り消し）");

  const u = await sb.auth.admin.getUserById(n.customer_id);
  const email = u.data?.user?.email ?? "";
  if (!email) return fail("登録のメールアドレスがありません");
  const p = await sb.from("profiles").select("company_name, contact_name, full_name, consultant_id")
    .eq("id", n.customer_id).maybeSingle();
  const s = await sb.from("app_settings").select("value").eq("key", "billing_rates").maybeSingle();
  const bank = String((s.data?.value as Record<string, unknown> | null)?.["bl-bank"] ?? "");
  const dm = await sb.from("debit_mandates").select("status").eq("customer_id", n.customer_id).maybeSingle();
  //  問い合わせ先：担当パートナー（お名前とメール）。いなければ運営
  let ask = "運営（082-548-2224）";
  const cid = p.data?.consultant_id as string | null | undefined;
  if (cid) {
    const c = await sb.from("profiles").select("full_name, company_name").eq("id", cid).maybeSingle();
    const cu = await sb.auth.admin.getUserById(cid);
    const nm = c.data?.full_name || c.data?.company_name || "";
    const ce = cu.data?.user?.email ?? "";
    if (nm || ce) ask = `担当パートナー（${esc(nm)}${ce ? `・${esc(ce)}` : ""}）`;
  }
  const months = invs.map(monthLabel);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [email],
        subject: `【TsuguAi -継-】お振込みのお願い（${months.join("・")}）`,
        html: dunningHtml({
          company: p.data?.company_name ?? "",
          contact: p.data?.contact_name || p.data?.full_name || "",
          invs, bank, payBy: n.pay_by,
          debitContinues: dm.data?.status === "registered",
          ask,
        }),
      }),
    });
    if (!res.ok) {
      console.error("dunning mail failed:", res.status, await res.text());
      return fail(`メールを送れませんでした（${res.status}）`);
    }
  } catch (e) {
    console.error("dunning mail error:", e);
    return fail("メールを送れませんでした");
  }
  return json({ ok: true, sent: 1 });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST のみ" }, 405);
  if (!RESEND_KEY) return json({ ok: false, error: "メールの設定（RESEND_API_KEY）がありません" }, 500);

  const uid = await signedInUserId(req);
  if (!uid) return json({ ok: false, error: "ログインが必要です" }, 401);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* 空でよい */ }
  if (body.action !== "setup" && body.action !== "dunning") return json({ ok: false, error: "action が正しくありません" }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // ③ お振込みのお願い（運営・担当パートナー）
  if (body.action === "dunning") {
    if (!body.notice_id) return json({ ok: false, error: "お振込みのお願いが指定されていません" }, 400);
    return await sendDunning(sb, uid, String(body.notice_id));
  }
  const N_COLS = "offer_id, invoice_id, advisory_invoice_id, mail_count";

  // ② 運営：指定の請求のご案内を送る（再送も）
  if (body.invoice_id) {
    const me = await sb.from("profiles").select("role").eq("id", uid).maybeSingle();
    if (me.data?.role !== "admin") return json({ ok: false, error: "運営のみが送れます" }, 403);
    const iid = String(body.invoice_id);
    const iv = await sb.from("invoices").select(INV_COLS).eq("id", iid).maybeSingle();
    const inv = iv.data as Inv | null;
    if (!inv || (inv.kind !== "setup" && inv.kind !== "advisory")) return json({ ok: false, error: "初回のお振込みの請求が見つかりません" });
    if (inv.status === "void") return json({ ok: false, error: "取り消した請求です" });
    if (inv.status === "paid") return json({ ok: false, error: "お支払い済みの請求です" });
    //  初回のご案内の記録（初期導入費か、一緒に入れた顧問料から引く）
    let n = (await sb.from("setup_fee_notices").select(N_COLS).eq("invoice_id", iid).maybeSingle()).data as Notice | null;
    if (!n) n = (await sb.from("setup_fee_notices").select(N_COLS).eq("advisory_invoice_id", iid).maybeSingle()).data as Notice | null;
    if (!n) {
      if (inv.kind !== "setup") return json({ ok: false, error: "初回のお振込みに入れた顧問料ではありません" });
      //  手で立てた初期導入費には記録が無いので、請求の番号で作る
      await sb.from("setup_fee_notices").insert({ offer_id: inv.id, customer_id: inv.customer_id, invoice_id: inv.id });
      n = { offer_id: inv.id, invoice_id: inv.id, advisory_invoice_id: null, mail_count: 0 };
    }
    const { invs, adv } = await noticeInvoices(sb, n);
    if (!invs.length) return json({ ok: false, error: "お支払いの済んでいない請求がありません" });
    const err = await sendOne(sb, inv.customer_id, invs, adv);
    await sb.from("setup_fee_notices")
      .update(err ? { mail_error: err } : { mailed_at: new Date().toISOString(), mail_count: Number(n.mail_count ?? 0) + 1, mail_error: null })
      .eq("offer_id", n.offer_id);
    return err ? json({ ok: false, error: err }) : json({ ok: true, sent: 1 });
  }

  // ① ご本人：まだ送っていないご案内を、1行ずつ取ってから送る
  const pend = await sb.from("setup_fee_notices").select(N_COLS)
    .eq("customer_id", uid).is("mailed_at", null);
  let sent = 0;
  for (const n of (pend.data ?? []) as Notice[]) {
    const now = new Date().toISOString();
    const took = await sb.from("setup_fee_notices").update({ mailed_at: now })
      .eq("offer_id", n.offer_id).is("mailed_at", null).select("offer_id");
    if (!took.data?.length) continue;   // もう一台が送っている
    const { invs, adv } = await noticeInvoices(sb, n);
    if (!invs.length) {
      //  送るものが無い（取り消した・もう払っていただいた）。送らずに閉じる
      await sb.from("setup_fee_notices").update({ mail_error: "送らずに閉じました（請求が取り消し済み・お支払い済み）" })
        .eq("offer_id", n.offer_id);
      continue;
    }
    const err = await sendOne(sb, uid, invs, adv);
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
