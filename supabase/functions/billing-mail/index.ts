// =============================================================
// billing-mail: お支払いのご案内をメールで届ける
//
//  3つのご案内を送る。
//    ・初回のお振込みのご案内（action:"setup"）
//    ・お振込みのお願い（action:"dunning"）… 引き落とせなかった・期日を過ぎた分を、
//      運営か担当パートナーが「お振込みのお願いを送る」で送る（下の ③）
//    ・ご利用の一時停止のお知らせ（action:"suspend_notify"）… 毎朝 9:00 に pg_cron が呼ぶ（下の ④）。
//      顧問料が3か月分たまって、その月の1日から止めた方と担当パートナーへ、月に一度だけ
//    ・請求書（action:"invoice"）… 運営が「請求と未収」から、その月の銀行振込の請求を
//      お客様ごとに1通の請求書にまとめて送る（下の ⑤）。口座振替が始まるまでの毎月の顧問料など
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
//    ④ 毎朝の呼び出し（pg_cron。合言葉 x-cron-secret が CRON_SECRET と一致したときだけ）
//         { action:"suspend_notify" }
//
//    ⑤ 運営の画面（請求と未収の「請求書をメールで送る」）
//         { action:"invoice", mail_id }
//       → DB の invoice_mail_prepare が作った請求書（invoice_mails）を送る。運営だけ。再送もできる
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
//   supabase/migrations/20261015020000_suspension.sql（ご利用の一時停止）
//   supabase/migrations/20261015030000_invoice_mail.sql（請求書）
//   supabase/migrations/20261015040000_party_numbers.sql（お客様番号。無くてもメールは送れる）
//   Secret の CRON_SECRET は、毎朝のブリーフ（agent-heartbeat）で設定済みのものを使う
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
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

//  日本の今日（YYYY-MM-DD）と、今月の1日・来月の1日
function jstToday(): string { return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); }
function monthStart(d: string): string { return d.slice(0, 8) + "01"; }
function nextMonthStart(d: string): string {
  let y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7)) + 1;
  if (m > 12) { m = 1; y++; }
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

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

//  お客様番号（顧客番号）。C＋8桁＋検査数字を、読みやすく区切る（例：C-4827-1953-1）
export function cnoFmt(no: string | null | undefined): string {
  const m = /^([CP])(\d{4})(\d{4})(\d)$/.exec(String(no ?? ""));
  return m ? `${m[1]}-${m[2]}-${m[3]}-${m[4]}` : String(no ?? "");
}
function cnoLine(no?: string | null): string {
  return no ? `<div style="font-size:11.5px;color:#5A6981;margin-top:2px;">お客様番号　${esc(cnoFmt(no))}</div>` : "";
}
//  番号は別に読む（顧客番号の SQL がまだでも、メールは止めない）
async function custNo(sb: ReturnType<typeof createClient>, id: string): Promise<string> {
  try {
    const r = await sb.from("profiles").select("customer_no").eq("id", id).maybeSingle();
    return String((r.data as Record<string, unknown> | null)?.customer_no ?? "");
  } catch {
    return "";
  }
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
  company: string; contact: string; invs: Inv[]; bank: string; debitFrom?: string; cno?: string;
}): string {
  const to = ([o.company ? `${esc(o.company)} 御中` : "", o.contact ? `${esc(o.contact)} 様` : ""]
    .filter(Boolean).join("<br>") || "ご担当者様") + cnoLine(o.cno);
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
          cno: await custNo(sb, customerId),
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
  debitContinues: boolean; ask: string; stopNote?: string; cno?: string;
}): string {
  const to = ([o.company ? `${esc(o.company)} 御中` : "", o.contact ? `${esc(o.contact)} 様` : ""]
    .filter(Boolean).join("<br>") || "ご担当者様") + cnoLine(o.cno);
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
    ${o.stopNote ? `<div style="font-size:12.5px;color:#A9403D;line-height:1.9;margin-top:12px;border:1px solid #E8C4C2;background:#FDF6F5;border-radius:9px;padding:10px 12px;">${o.stopNote}</div>` : ""}
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
//  止めることの一文（お願いのメールに入れる）。
//    ・たまった顧問料が2か月分 … 「もう1か月分たまると、その翌月1日から一時停止」
//    ・3か月分で、今月の1日にはもう3か月分だった … 「一時停止しています」
//    ・3か月分になったばかり … 「来月1日から一時停止」
export function stopNoteFor(invs: Inv[], today: string, liftedThisMonth: boolean): string {
  const adv = invs.filter((x) => x.kind === "advisory" || x.kind === "direct");
  const ms = monthStart(today);
  const before = adv.filter((x) => String(x.due_on ?? "") < ms).length;
  if (before >= 3 && !liftedThisMonth) {
    return "<b>お支払いが3か月分確認できないため、ご利用を一時停止しています。</b>お振込みを確認しだい、すぐに再開します。";
  }
  if (adv.length >= 3) {
    const n = nextMonthStart(today);
    return `<b>お支払いが3か月分確認できないため、${Number(n.slice(5, 7))}月1日からご利用を一時停止させていただきます。</b>それまでにお振込みを確認できれば、止めることはありません。`;
  }
  if (adv.length === 2) {
    return "<b>このまま次の月の顧問料も確認できない場合は、その翌月1日からご利用を一時停止させていただきます。</b>お早めのお振込みをお願いいたします。";
  }
  return "";
}

//  ---- ご利用の一時停止のお知らせ（止めた日に、ご本人と担当パートナーへ）----
export function suspendHtml(o: {
  company: string; contact: string; invs: DInv[]; bank: string; ask: string; since: string; cno?: string;
}): string {
  const to = ([o.company ? `${esc(o.company)} 御中` : "", o.contact ? `${esc(o.contact)} 様` : ""]
    .filter(Boolean).join("<br>") || "ご担当者様") + cnoLine(o.cno);
  const rest = o.invs.reduce((t, x) => t + (Number(x.amount) || 0) - (Number(x.paid_amount) || 0), 0);
  const lines = o.invs.map((x) =>
    `<tr><td style="padding:6px 0;color:#5A6981;">${esc(monthLabel(x))}</td><td style="padding:6px 0;text-align:right;">${yen((Number(x.amount) || 0) - (Number(x.paid_amount) || 0))}（税込）</td></tr>`).join("");
  const bank = o.bank.trim()
    ? `<div style="white-space:pre-wrap;background:#F8F9FC;border:1px solid #E2E7EF;border-radius:10px;padding:12px 14px;font-size:13px;color:#18202E;line-height:1.9;">${esc(o.bank.trim())}</div>`
    : `<div style="font-size:13px;color:#18202E;line-height:1.9;">お振込先は、アプリでご確認ください（ログインすると表示されます）。</div>`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F4F6FA;">
<div style="max-width:600px;margin:0 auto;padding:28px 20px;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Noto Sans JP',sans-serif;">
  <div style="text-align:center;font-size:15px;font-weight:700;color:#1E3A66;margin-bottom:18px;">
    TsuguAi<span style="color:#C8A24B;">-継-</span></div>
  <div style="background:#fff;border:1px solid #E2E7EF;border-radius:14px;padding:24px;">
    <div style="font-size:11px;color:#A9403D;font-weight:700;">⏸ ご利用の一時停止のお知らせ</div>
    <div style="font-size:13px;color:#18202E;line-height:2;margin-top:10px;">${to}</div>
    <div style="font-size:13px;color:#18202E;line-height:2;margin-top:10px;">
      いつも TsuguAi -継- をご利用いただき、ありがとうございます。<br>
      顧問料のお支払いが3か月分確認できないため、<b>${esc(jaDate(o.since))}から、TsuguAi のご利用を一時停止</b>させていただきました。
      ログインすると、未入金の内訳とお振込先だけが表示されます。<b>お振込みを確認しだい、すぐに再開します。</b>
      これまでのデータはそのまま残っています。<br>
      <span style="color:#5A6981;">行き違いでお支払いいただいている場合は、申し訳ありません。お手数ですがご連絡ください。</span></div>
    <div style="font-size:12px;color:#8A6D2F;font-weight:700;margin:14px 0 2px;">未入金の内訳</div>
    <table style="width:100%;font-size:13px;border-collapse:collapse;border-top:1px solid #EDF1F6;">
      ${lines}
      <tr><td style="padding:9px 0;color:#A9403D;font-weight:700;border-top:1px solid #E2E7EF;">お振込みのお願い額</td>
        <td style="padding:9px 0;text-align:right;border-top:1px solid #E2E7EF;"><b style="color:#A9403D;font-size:16px;">${yen(rest)}</b></td></tr>
    </table>
    <div style="font-size:12px;color:#8A6D2F;font-weight:700;margin:16px 0 6px;">お振込先</div>
    ${bank}
    <div style="font-size:12.5px;color:#18202E;line-height:1.95;margin-top:12px;">
      ご依頼人名は<b>ご契約の会社名</b>でお願いします。振込手数料はご負担をお願いしております。<br>
      ご不明な点は、${o.ask}までお問い合わせください。</div>
    <div style="font-size:11.5px;color:#A9403D;line-height:1.85;margin-top:14px;background:#FBF3F2;border-radius:9px;padding:10px 12px;">
      TsuguAi から、メールだけでお振込先の変更をお願いすることはありません。
      お振込先の違うメールが届いたときは、お振り込みにならず、担当パートナーか運営へご連絡ください。</div>
  </div>
  <div style="text-align:center;font-size:11px;color:#94A2B6;margin-top:16px;line-height:1.8;">
    株式会社福來　TsuguAi -継-　継ぐ、を身近な経営判断に<br>${APP_URL}</div>
</div></body></html>`;
}
function partnerSuspendHtml(o: { partner: string; company: string; rest: number; months: number; since: string; cno?: string }): string {
  return `<div style="font-family:'Hiragino Sans','Noto Sans JP',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18202E;">
    <div style="font-size:13px;color:#A9403D;font-weight:bold;">⏸ 担当先のご利用を一時停止しました</div>
    <div style="font-size:14px;line-height:1.95;margin-top:10px;">${esc(o.partner)} 様<br>
      担当先の <b>${esc(o.company)}</b>${o.cno ? `（お客様番号 ${esc(cnoFmt(o.cno))}）` : ""} は、顧問料のお支払いが <b>${o.months}か月分</b> 確認できないため、
      <b>${esc(jaDate(o.since))}から TsuguAi のご利用を一時停止</b>しました（未入金 ${yen(o.rest)}）。<br>
      社長には、内訳とお振込先をお送りしています。お振込みを確認しだい、自動で再開します。
      次のご連絡のときに、ひとことお声がけをお願いします。</div>
    <div style="margin:18px 0;"><a href="${APP_URL}" style="display:inline-block;background:#1E3A66;color:#fff;text-decoration:none;font-size:13px;font-weight:bold;padding:11px 22px;border-radius:9px;">TsuguAiを開く →</a></div>
    <div style="font-size:11px;color:#5A6981;">このメールは TsuguAi -継- が自動でお送りしています。</div></div>`;
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
  const today = jstToday();
  const lift = await sb.from("service_suspensions").select("lifted_at")
    .eq("customer_id", n.customer_id).eq("month", today.slice(0, 7)).maybeSingle();
  const stopNote = stopNoteFor(invs, today, !!lift.data?.lifted_at);
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
          stopNote,
          cno: await custNo(sb, n.customer_id),
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

//  ---- 請求書（その月の銀行振込の請求を、お客様ごとに1通）----
//  発行者は概要タブの「請求書の発行者」。登録番号（インボイス）は入っているときだけ載せる
export type Issuer = { name: string; addr: string; tel: string; tno: string };
export function issuerOf(v: Record<string, unknown> | null | undefined): Issuer {
  const g = (k: string) => String((v ?? {})[k] ?? "").trim();
  return {
    name: g("bl-iss-name") || "株式会社福來",
    addr: g("bl-iss-addr"),
    tel: g("bl-iss-tel") || "082-548-2224",
    tno: /^T\d{13}$/.test(g("bl-iss-tno")) ? g("bl-iss-tno") : "",
  };
}
export function invoiceHtml(o: {
  company: string; contact: string; invs: DInv[]; bank: string; no: string; issued: string;
  period: string; issuer: Issuer; ask: string; cno?: string;
}): string {
  const to = ([o.company ? `${esc(o.company)} 御中` : "", o.contact ? `${esc(o.contact)} 様` : ""]
    .filter(Boolean).join("<br>") || "ご担当者様") + cnoLine(o.cno);
  const pm = /^(\d{4})-(\d{2})$/.exec(o.period);
  const ym = pm ? `${Number(pm[1])}年${Number(pm[2])}月分` : "";
  const sub = o.invs.reduce((t, x) => t + (Number(x.amount_ex) || 0), 0);
  const tax = o.invs.reduce((t, x) => t + (Number(x.tax) || 0), 0);
  const total = o.invs.reduce((t, x) => t + (Number(x.amount) || 0), 0);
  const paid = o.invs.reduce((t, x) => t + (Number(x.paid_amount) || 0), 0);
  const due = o.invs.map((x) => String(x.due_on ?? "")).filter(Boolean).sort()[0] ?? "";
  const td = "padding:7px 0;border-bottom:1px solid #EDF1F6;";
  const lines = o.invs.map((x) =>
    `<tr><td style="${td}color:#18202E;">${esc(monthLabel(x))}</td>`
    + `<td style="${td}color:#5A6981;text-align:center;">10%</td>`
    + `<td style="${td}color:#18202E;text-align:right;">${yen(x.amount_ex)}</td></tr>`).join("");
  const tr = (k: string, v: string, strong = false) =>
    `<tr><td colspan="2" style="padding:6px 0;color:${strong ? "#1E3A66;font-weight:700" : "#5A6981"};">${k}</td><td style="padding:6px 0;text-align:right;color:#18202E;">${v}</td></tr>`;
  const bank = o.bank.trim()
    ? `<div style="white-space:pre-wrap;background:#F8F9FC;border:1px solid #E2E7EF;border-radius:10px;padding:12px 14px;font-size:13px;color:#18202E;line-height:1.9;">${esc(o.bank.trim())}</div>`
    : `<div style="font-size:13px;color:#18202E;line-height:1.9;">お振込先は、アプリの「お支払い」でご確認ください。</div>`;
  const iss = o.issuer;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#F4F6FA;">
<div style="max-width:640px;margin:0 auto;padding:28px 20px;font-family:-apple-system,BlinkMacSystemFont,'Hiragino Sans','Noto Sans JP',sans-serif;">
  <div style="text-align:center;font-size:15px;font-weight:700;color:#1E3A66;margin-bottom:18px;">
    TsuguAi<span style="color:#C8A24B;">-継-</span></div>
  <div style="background:#fff;border:1px solid #E2E7EF;border-radius:14px;padding:26px 24px;">
    <div style="text-align:center;font-size:20px;font-weight:700;color:#1E3A66;letter-spacing:.4em;">請求書</div>
    <table style="width:100%;font-size:12px;color:#5A6981;margin-top:10px;"><tr>
      <td style="vertical-align:top;font-size:13.5px;color:#18202E;line-height:1.9;">${to}</td>
      <td style="vertical-align:top;text-align:right;line-height:1.8;">請求書番号　${esc(o.no)}<br>発行日　${esc(jaDate(o.issued))}</td>
    </tr></table>
    <div style="font-size:13px;color:#18202E;line-height:1.95;margin-top:12px;">
      いつも TsuguAi -継- をご利用いただき、ありがとうございます。<br>
      ${esc(ym)}のご請求を、下記のとおりお送りします。お支払期日までに<b>お振込み</b>をお願いいたします。</div>
    <div style="display:flex;justify-content:space-between;align-items:baseline;border:1.5px solid #1E3A66;border-radius:10px;padding:12px 16px;margin:16px 0 4px;">
      <span style="font-size:13px;font-weight:700;color:#1E3A66;">ご請求金額（税込）</span>
      <span style="font-size:22px;font-weight:700;color:#1E3A66;">${yen(total - paid)}</span></div>
    <div style="font-size:12px;color:#5A6981;text-align:right;">お支払期日　<b style="color:#A9403D;">${esc(jaDate(due))}</b></div>
    <table style="width:100%;font-size:13px;border-collapse:collapse;margin-top:12px;">
      <tr><td style="padding:6px 0;color:#94A2B6;font-size:11.5px;border-bottom:1px solid #E2E7EF;">品目</td>
        <td style="padding:6px 0;color:#94A2B6;font-size:11.5px;text-align:center;border-bottom:1px solid #E2E7EF;width:60px;">税率</td>
        <td style="padding:6px 0;color:#94A2B6;font-size:11.5px;text-align:right;border-bottom:1px solid #E2E7EF;width:130px;">金額（税別）</td></tr>
      ${lines}
      ${tr("小計（10%対象・税別）", yen(sub))}
      ${tr("消費税（10%）", yen(tax))}
      ${tr("合計（税込）", yen(total), true)}
      ${paid > 0 ? tr("お支払い済みの分", `−${yen(paid)}`) : ""}
      <tr><td colspan="2" style="padding:9px 0;color:#1E3A66;font-weight:700;border-top:1px solid #E2E7EF;">ご請求金額</td>
        <td style="padding:9px 0;text-align:right;border-top:1px solid #E2E7EF;"><b style="color:#1E3A66;font-size:16px;">${yen(total - paid)}</b></td></tr>
    </table>
    <div style="font-size:12px;color:#8A6D2F;font-weight:700;margin:16px 0 6px;">お振込先</div>
    ${bank}
    <div style="font-size:12.5px;color:#18202E;line-height:1.95;margin-top:12px;">
      お振込の際は、<b>ご依頼人名をご契約の会社名</b>にしてください（入金の確認に使います）。振込手数料はご負担をお願いしております。<br>
      ご不明な点は、${o.ask}までお問い合わせください。</div>
    <div style="border-top:1px solid #E2E7EF;margin-top:16px;padding-top:12px;font-size:12px;color:#18202E;line-height:1.85;text-align:right;">
      <b>${esc(iss.name)}</b><br>
      ${iss.addr ? `${esc(iss.addr)}<br>` : ""}
      ${iss.tel ? `TEL ${esc(iss.tel)}<br>` : ""}
      ${iss.tno ? `登録番号 ${esc(iss.tno)}` : ""}</div>
    <div style="text-align:center;margin:18px 0 6px;">
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

async function sendInvoice(sb: ReturnType<typeof createClient>, uid: string, mailId: string): Promise<Response> {
  const me = await sb.from("profiles").select("role").eq("id", uid).maybeSingle();
  if (me.data?.role !== "admin") return json({ ok: false, error: "運営のみが送れます" }, 403);
  const mq = await sb.from("invoice_mails")
    .select("id, customer_id, period, invoice_no, invoice_ids, issued_on, mail_count").eq("id", mailId).maybeSingle();
  const m = mq.data as { id: string; customer_id: string; period: string; invoice_no: string; invoice_ids: string[]; issued_on: string; mail_count: number | null } | null;
  if (!m) return json({ ok: false, error: "請求書が見つかりません（先に用意してください）" });
  //  同じ請求書を同時に二度送らない（「送信中」を取ってから送る）
  const took = await sb.from("invoice_mails").update({ sending_at: new Date().toISOString(), mail_error: null })
    .eq("id", m.id).is("sending_at", null).select("id");
  if (!took.data?.length) return json({ ok: false, error: "この請求書は、いま送っています" });
  const fail = async (msg: string) => {
    await sb.from("invoice_mails").update({ sending_at: null, mail_error: msg }).eq("id", m.id);
    return json({ ok: false, error: msg });
  };
  const invs: DInv[] = [];
  for (const id of m.invoice_ids ?? []) {
    const r = await sb.from("invoices").select(INV_COLS + ", paid_amount").eq("id", id).maybeSingle();
    const x = r.data as DInv | null;
    if (x && (x.status === "open" || x.status === "partial")) invs.push(x);
  }
  if (!invs.length) return fail("お支払いの済んでいない請求がありません（入金済み・取り消し）");
  const u = await sb.auth.admin.getUserById(m.customer_id);
  const email = u.data?.user?.email ?? "";
  if (!email) return fail("登録のメールアドレスがありません");
  const p = await sb.from("profiles").select("company_name, contact_name, full_name, consultant_id")
    .eq("id", m.customer_id).maybeSingle();
  const s = await sb.from("app_settings").select("value").eq("key", "billing_rates").maybeSingle();
  const rates = (s.data?.value as Record<string, unknown> | null) ?? {};
  const bank = String(rates["bl-bank"] ?? "");
  let ask = "運営（082-548-2224）";
  const cid = p.data?.consultant_id as string | null | undefined;
  if (cid) {
    const c = await sb.from("profiles").select("full_name, company_name").eq("id", cid).maybeSingle();
    const cu = await sb.auth.admin.getUserById(cid);
    const nm = c.data?.full_name || c.data?.company_name || "";
    const ce = cu.data?.user?.email ?? "";
    if (nm || ce) ask = `担当パートナー（${esc(nm)}${ce ? `・${esc(ce)}` : ""}）`;
  }
  const pm = /^(\d{4})-(\d{2})$/.exec(m.period);
  const ym = pm ? `${Number(pm[1])}年${Number(pm[2])}月分` : m.period;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: MAIL_FROM,
        to: [email],
        subject: `【TsuguAi -継-】請求書（${ym}・No.${m.invoice_no}）`,
        html: invoiceHtml({
          company: p.data?.company_name ?? "",
          contact: p.data?.contact_name || p.data?.full_name || "",
          invs, bank, no: m.invoice_no, issued: m.issued_on, period: m.period,
          issuer: issuerOf(rates), ask,
          cno: await custNo(sb, m.customer_id),
        }),
      }),
    });
    if (!res.ok) {
      console.error("invoice mail failed:", res.status, await res.text());
      return fail(`メールを送れませんでした（${res.status}）`);
    }
  } catch (e) {
    console.error("invoice mail error:", e);
    return fail("メールを送れませんでした");
  }
  await sb.from("invoice_mails").update({
    sending_at: null, mailed_at: new Date().toISOString(), mail_count: Number(m.mail_count ?? 0) + 1, mail_error: null,
  }).eq("id", m.id);
  return json({ ok: true, sent: 1, to: email });
}

//  ④ 毎朝：今月の1日から止めた方へ、月に一度だけ知らせる（ご本人・担当パートナー）
async function suspendNotify(sb: ReturnType<typeof createClient>): Promise<Response> {
  const today = jstToday(), ms = monthStart(today), month = today.slice(0, 7);
  //  今月の1日より前が期日の顧問料で、入っていないもの
  const q = await sb.from("invoices").select("customer_id, kind, due_on")
    .in("status", ["open", "partial"]).in("kind", ["advisory", "direct"]).lt("due_on", ms);
  const cnt: Record<string, number> = {};
  for (const r of (q.data ?? []) as { customer_id: string }[]) cnt[r.customer_id] = (cnt[r.customer_id] ?? 0) + 1;
  const targets = Object.keys(cnt).filter((id) => cnt[id] >= 3);
  let sent = 0;
  for (const cid of targets) {
    const pr = await sb.from("profiles").select("role, company_name, contact_name, full_name, consultant_id").eq("id", cid).maybeSingle();
    if (pr.data?.role !== "customer") continue;
    const ex = await sb.from("service_suspensions").select("notified_at, lifted_at").eq("customer_id", cid).eq("month", month).maybeSingle();
    if (ex.data?.lifted_at || ex.data?.notified_at) continue;   // 運営が解いた・もう知らせた
    if (!ex.data) await sb.from("service_suspensions").insert({ customer_id: cid, month });
    //  一度だけ（同じ朝に二重に走っても、先に取ったほうだけが送る）
    const took = await sb.from("service_suspensions").update({ notified_at: new Date().toISOString(), notify_error: null })
      .eq("customer_id", cid).eq("month", month).is("notified_at", null).select("customer_id");
    if (!took.data?.length) continue;

    const iv = await sb.from("invoices").select(INV_COLS + ", paid_amount").eq("customer_id", cid)
      .in("status", ["open", "partial"]).lt("due_on", today);
    const invs = ((iv.data ?? []) as DInv[]).sort((a, b) => String(a.due_on).localeCompare(String(b.due_on)));
    const s = await sb.from("app_settings").select("value").eq("key", "billing_rates").maybeSingle();
    const bank = String((s.data?.value as Record<string, unknown> | null)?.["bl-bank"] ?? "");
    let ask = "運営（082-548-2224）", pName = "", pMail = "";
    if (pr.data?.consultant_id) {
      const c = await sb.from("profiles").select("full_name, company_name").eq("id", pr.data.consultant_id).maybeSingle();
      const cu = await sb.auth.admin.getUserById(pr.data.consultant_id);
      pName = c.data?.full_name || c.data?.company_name || ""; pMail = cu.data?.user?.email ?? "";
      if (pName || pMail) ask = `担当パートナー（${esc(pName)}${pMail ? `・${esc(pMail)}` : ""}）`;
    }
    const u = await sb.auth.admin.getUserById(cid);
    const email = u.data?.user?.email ?? "";
    const cno = await custNo(sb, cid);
    const send = async (to: string, subject: string, html: string) => {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, html }),
      });
      if (!res.ok) throw new Error(`メールを送れませんでした（${res.status}）`);
    };
    try {
      if (!email) throw new Error("登録のメールアドレスがありません");
      await send(email, "【TsuguAi -継-】ご利用の一時停止のお知らせ", suspendHtml({
        company: pr.data?.company_name ?? "", contact: pr.data?.contact_name || pr.data?.full_name || "",
        invs, bank, ask, since: ms, cno,
      }));
      sent++;
    } catch (e) {
      //  送れなかったら、明日の朝にもう一度
      await sb.from("service_suspensions").update({ notified_at: null, notify_error: String((e as Error).message ?? e) })
        .eq("customer_id", cid).eq("month", month);
      continue;
    }
    if (pMail) {
      try {
        const rest = invs.reduce((t, x) => t + (Number(x.amount) || 0) - (Number(x.paid_amount) || 0), 0);
        await send(pMail, `【TsuguAi -継-】担当先のご利用を一時停止しました（${pr.data?.company_name ?? ""}）`,
          partnerSuspendHtml({ partner: pName, company: pr.data?.company_name ?? "", rest, months: cnt[cid], since: ms, cno }));
        await sb.from("service_suspensions").update({ partner_notified_at: new Date().toISOString() })
          .eq("customer_id", cid).eq("month", month);
      } catch (e) {
        await sb.from("service_suspensions").update({ notify_error: "担当パートナーへ：" + String((e as Error).message ?? e) })
          .eq("customer_id", cid).eq("month", month);
      }
    }
  }
  return json({ ok: true, notified: sent });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST のみ" }, 405);
  if (!RESEND_KEY) return json({ ok: false, error: "メールの設定（RESEND_API_KEY）がありません" }, 500);

  // ④ 毎朝の呼び出し（pg_cron）。合言葉が一致したときだけ
  if (CRON_SECRET && req.headers.get("x-cron-secret") === CRON_SECRET) {
    let cb: Record<string, unknown> = {};
    try { cb = await req.json(); } catch { /* 空でよい */ }
    if (cb.action !== "suspend_notify") return json({ ok: false, error: "action が正しくありません" }, 400);
    const sbc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    return await suspendNotify(sbc);
  }

  const uid = await signedInUserId(req);
  if (!uid) return json({ ok: false, error: "ログインが必要です" }, 401);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* 空でよい */ }
  if (body.action !== "setup" && body.action !== "dunning" && body.action !== "invoice") return json({ ok: false, error: "action が正しくありません" }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

  // ③ お振込みのお願い（運営・担当パートナー）
  if (body.action === "dunning") {
    if (!body.notice_id) return json({ ok: false, error: "お振込みのお願いが指定されていません" }, 400);
    return await sendDunning(sb, uid, String(body.notice_id));
  }
  // ⑤ 請求書（運営）
  if (body.action === "invoice") {
    if (!body.mail_id) return json({ ok: false, error: "請求書が指定されていません" }, 400);
    return await sendInvoice(sb, uid, String(body.mail_id));
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
