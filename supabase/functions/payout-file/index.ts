// =============================================================
// payout-file: パートナーへのお振込みを、銀行に上げられるファイルにする
//
//  これまでは、運営が「支払い」の画面から口座を1件ずつ開き、銀行の振込
//  画面に手で打ち写していた。件数が増えれば打ち間違いが出るし、口座番号を
//  目で見て運ぶ回数が増えるほど、漏れる機会も増える。
//
//  ここでは、画面で計算した「誰にいくら」を受け取り、口座はサーバー側で
//  取り出して、全銀フォーマット（総合振込・固定長120バイト）のファイルに
//  する。GMOあおぞらネット銀行をはじめ、法人ネットバンキングの「総合振込
//  ファイルアップロード」がそのまま受け取る形式。あわせて、目で確かめる
//  ための CSV も返す。
//
//  なぜサーバー側でやるのか
//    口座番号の取り出し（payout_account_for_transfer）は service_role にしか
//    許していない。ブラウザに口座を渡さずにファイルにするには、ここしかない。
//    取り出したことは payout_account_reads に purpose='transfer' で残る。
//
//  呼べるのは運営（profiles.role='admin'）だけ。
//
//  委託者（継の口座）の情報は app_settings.billing_rates の
//    bl-sc（委託者コード10桁）bl-sname（委託者名カナ）bl-sbank（銀行4桁）
//    bl-sbranch（支店3桁）bl-stype（1普通/2当座）bl-sacct（口座番号）
//  を使う。運営コンソール「課金・契約」→「概要」で入れる。
//
// 入力: { ym:"2026-09", date:"MMDD",
//         items:[{ kind:"user"|"ep", id:uuid, amount:整数円, label:表示名 }] }
// 応答: { ok:true, zengin_b64, csv, count, total, skipped:[{label,why}], warnings:[] }
//       { ok:false, error }
//
// デプロイ:
//   supabase functions deploy payout-file --no-verify-jwt
//     ※ --no-verify-jwt でよい。認証（ログインと運営権限）はこの関数の中で行う
//   Secret の追加は不要
//
// 先に実行しておく SQL:
//   supabase/migrations/20260908020000_payout_accounts_keep.sql（実行済み）
// =============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "content-type": "application/json" } });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

async function signedInUserId(req: Request): Promise<string | null> {
  const authz = req.headers.get("Authorization") ?? "";
  const jwt = authz.replace(/^Bearer\s+/i, "").trim();
  if (!jwt || jwt === ANON_KEY) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: ANON_KEY } });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? String(u.id) : null;
  } catch { return null; }
}

// ---- 全銀フォーマットの文字 ----
//  使えるのは半角の英数字・カナ・いくつかの記号だけ。全角カナは半角に、
//  濁点・半濁点は別の1文字に、小さいカナは大きいカナに直す（小文字は不可）。
//  「・」は使えないので「.」に。それ以外は空白にして、warnings で知らせる。
const KANA: Record<string, string> = {
  "ア":"ｱ","イ":"ｲ","ウ":"ｳ","エ":"ｴ","オ":"ｵ","カ":"ｶ","キ":"ｷ","ク":"ｸ","ケ":"ｹ","コ":"ｺ","サ":"ｻ","シ":"ｼ","ス":"ｽ","セ":"ｾ","ソ":"ｿ",
  "タ":"ﾀ","チ":"ﾁ","ツ":"ﾂ","テ":"ﾃ","ト":"ﾄ","ナ":"ﾅ","ニ":"ﾆ","ヌ":"ﾇ","ネ":"ﾈ","ノ":"ﾉ","ハ":"ﾊ","ヒ":"ﾋ","フ":"ﾌ","ヘ":"ﾍ","ホ":"ﾎ",
  "マ":"ﾏ","ミ":"ﾐ","ム":"ﾑ","メ":"ﾒ","モ":"ﾓ","ヤ":"ﾔ","ユ":"ﾕ","ヨ":"ﾖ","ラ":"ﾗ","リ":"ﾘ","ル":"ﾙ","レ":"ﾚ","ロ":"ﾛ","ワ":"ﾜ","ヲ":"ｦ","ン":"ﾝ",
  "ガ":"ｶﾞ","ギ":"ｷﾞ","グ":"ｸﾞ","ゲ":"ｹﾞ","ゴ":"ｺﾞ","ザ":"ｻﾞ","ジ":"ｼﾞ","ズ":"ｽﾞ","ゼ":"ｾﾞ","ゾ":"ｿﾞ",
  "ダ":"ﾀﾞ","ヂ":"ﾁﾞ","ヅ":"ﾂﾞ","デ":"ﾃﾞ","ド":"ﾄﾞ","バ":"ﾊﾞ","ビ":"ﾋﾞ","ブ":"ﾌﾞ","ベ":"ﾍﾞ","ボ":"ﾎﾞ",
  "パ":"ﾊﾟ","ピ":"ﾋﾟ","プ":"ﾌﾟ","ペ":"ﾍﾟ","ポ":"ﾎﾟ","ヴ":"ｳﾞ",
  "ァ":"ｱ","ィ":"ｲ","ゥ":"ｳ","ェ":"ｴ","ォ":"ｵ","ャ":"ﾔ","ュ":"ﾕ","ョ":"ﾖ","ッ":"ﾂ","ヮ":"ﾜ",
  "ー":"ｰ","・":".","（":"(","）":")","　":" ","－":"-","．":".","／":"/",
  "ｧ":"ｱ","ｨ":"ｲ","ｩ":"ｳ","ｪ":"ｴ","ｫ":"ｵ","ｬ":"ﾔ","ｭ":"ﾕ","ｮ":"ﾖ","ｯ":"ﾂ","･":".",
};
const FULL_ALNUM_BASE = "０".charCodeAt(0);
export function zenginText(s: string): { text: string; dropped: string[] } {
  const dropped: string[] = [];
  let out = "";
  for (const ch of String(s ?? "")) {
    const c = ch.charCodeAt(0);
    if (KANA[ch] != null) { out += KANA[ch]; continue; }
    if (c >= 0x20 && c <= 0x7e) { out += ch.toUpperCase(); continue; }          // 半角英数・記号
    if (c >= 0xff61 && c <= 0xff9f) { out += ch; continue; }                    // 半角カナ・濁点
    if (c >= FULL_ALNUM_BASE && c <= FULL_ALNUM_BASE + 9) { out += String.fromCharCode(0x30 + c - FULL_ALNUM_BASE); continue; }
    if (c >= 0xff21 && c <= 0xff3a) { out += String.fromCharCode(0x41 + c - 0xff21); continue; } // Ａ-Ｚ
    if (c >= 0xff41 && c <= 0xff5a) { out += String.fromCharCode(0x41 + c - 0xff41); continue; } // ａ-ｚ
    dropped.push(ch);
    out += " ";
  }
  //  英小文字は大文字に。全銀で使える記号だけ残す
  out = out.replace(/[^0-9A-Z ｦ-ﾟ()\-./,\\｢｣]/g, " ");
  return { text: out, dropped };
}

//  固定長：足りなければ空白で右を埋め、長ければ切る（すべて1バイト文字）
export function padR(s: string, n: number): string { s = String(s ?? ""); return (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length)); }
export function padNum(v: number | string, n: number): string {
  const d = String(v ?? "").replace(/[^0-9]/g, "");
  return (d.length >= n ? d.slice(-n) : "0".repeat(n - d.length) + d);
}
export function acctTypeCode(t: string): string {
  return t === "touza" ? "2" : (t === "chochiku" ? "4" : "1");   // 1普通 2当座 4貯蓄
}

export type Sender = { code: string; name: string; bank: string; branch: string; type: string; acct: string };
export type Payee = { bank_code: string; branch_code: string; account_type: string; account_no: string; holder: string; amount: number };

//  総合振込（種別21）。ヘッダ・データ・トレーラ・エンドの4種類、各120バイト
export function zenginLines(sender: Sender, date: string, payees: Payee[]): string[] {
  const head = "1" + "21" + "0"
    + padNum(sender.code, 10)
    + padR(sender.name, 40)
    + padNum(date, 4)
    + padNum(sender.bank, 4) + padR("", 15)
    + padNum(sender.branch, 3) + padR("", 15)
    + (sender.type === "2" ? "2" : "1")
    + padNum(sender.acct, 7)
    + padR("", 17);
  const rows = payees.map((p) =>
    "2"
    + padNum(p.bank_code, 4) + padR("", 15)
    + padNum(p.branch_code, 3) + padR("", 15)
    + padR("", 4)                                  // 手形交換所番号（省略）
    + acctTypeCode(p.account_type)
    + padNum(p.account_no, 7)
    + padR(p.holder, 30)
    + padNum(Math.round(p.amount), 10)
    + "0"                                          // 新規コード：0=その他
    + padR("", 10) + padR("", 10)                  // 顧客コード1・2（省略）
    + "7"                                          // 振込区分：7=テレ振込
    + " "                                          // 識別表示（EDI なし）
    + padR("", 7));
  const total = payees.reduce((a, p) => a + Math.round(p.amount), 0);
  const trail = "8" + padNum(payees.length, 6) + padNum(total, 12) + padR("", 101);
  const end = "9" + padR("", 119);
  const lines = [head, ...rows, trail, end];
  for (const l of lines) if (l.length !== 120) throw new Error("全銀レコード長が120ではありません: " + l.length);
  return lines;
}

//  Shift_JIS のうち、ここで使う範囲は1バイトで済む：ASCII はそのまま、
//  半角カナ（U+FF61〜FF9F）は 0xA1〜0xDF。ライブラリなしで足りる
export function toSjisBytes(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c === 0x0d || c === 0x0a) out.push(c);
    else if (c >= 0x20 && c <= 0x7e) out.push(c);
    else if (c >= 0xff61 && c <= 0xff9f) out.push(0xa1 + (c - 0xff61));
    else out.push(0x20);
  }
  return new Uint8Array(out);
}
function b64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "POST のみ受け付けます" }, 405);
  if (!SERVICE_KEY) return json({ ok: false, error: "サーバーの設定が足りません" }, 500);

  const meId = await signedInUserId(req);
  if (!meId) return json({ ok: false, error: "ログインが必要です" }, 401);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const me = await sb.from("profiles").select("role").eq("id", meId).maybeSingle();
  if (me.data?.role !== "admin") return json({ ok: false, error: "運営のみが使えます" }, 403);

  let body: { ym?: string; date?: string; items?: { kind: string; id: string; amount: number; label: string }[] };
  try { body = await req.json(); } catch { return json({ ok: false, error: "リクエストを読めませんでした" }, 400); }
  const items = (body.items ?? []).filter((x) => x && x.id && Number(x.amount) > 0);
  if (!items.length) return json({ ok: false, error: "お振込みの対象がありません" }, 400);
  const date = String(body.date ?? "").replace(/[^0-9]/g, "");
  if (date.length !== 4) return json({ ok: false, error: "振込指定日（月日4桁）をご指定ください" }, 400);

  // 委託者（継の口座）
  const st = await sb.from("app_settings").select("value").eq("key", "billing_rates").maybeSingle();
  const v = (st.data?.value ?? {}) as Record<string, string>;
  const senderName = zenginText(v["bl-sname"] ?? "");
  const sender: Sender = {
    code: String(v["bl-sc"] ?? "").replace(/[^0-9]/g, ""), name: senderName.text,
    bank: String(v["bl-sbank"] ?? "").replace(/[^0-9]/g, ""), branch: String(v["bl-sbranch"] ?? "").replace(/[^0-9]/g, ""),
    type: String(v["bl-stype"] ?? "1"), acct: String(v["bl-sacct"] ?? "").replace(/[^0-9]/g, ""),
  };
  const missing: string[] = [];
  if (!sender.code) missing.push("委託者コード");
  if (!sender.name.trim()) missing.push("委託者名（カナ）");
  if (sender.bank.length !== 4) missing.push("銀行コード（4桁）");
  if (sender.branch.length !== 3) missing.push("支店コード（3桁）");
  if (!sender.acct) missing.push("口座番号");
  if (missing.length) {
    return json({ ok: false, error: "委託者（継の口座）の " + missing.join("・") + " が未設定です。「課金・契約」→「概要」の「総合振込の委託者情報」でご入力ください" });
  }

  // 口座の取り出し。EP-I は法人の口座（ep_id の行）を、その行の user_id で引く
  const userIds: string[] = [];
  const epToUser = new Map<string, string>();
  const eps = items.filter((x) => x.kind === "ep").map((x) => x.id);
  if (eps.length) {
    const r = await sb.from("payout_accounts").select("user_id, ep_id").in("ep_id", eps).eq("status", "registered").is("forgotten_at", null);
    for (const a of r.data ?? []) { epToUser.set(a.ep_id, a.user_id); userIds.push(a.user_id); }
  }
  for (const x of items) if (x.kind !== "ep" && userIds.indexOf(x.id) < 0) userIds.push(x.id);
  const acc = await sb.rpc("payout_account_for_transfer", { p_users: userIds });
  if (acc.error) return json({ ok: false, error: "口座を取り出せませんでした：" + acc.error.message }, 500);
  const byUser = new Map<string, any>();
  for (const a of acc.data ?? []) byUser.set(a.user_id, a);

  const payees: Payee[] = [];
  const csvRows: string[][] = [["お支払い先", "銀行コード", "銀行名", "支店コード", "支店名", "種別", "口座番号", "名義（全銀）", "金額（円）"]];
  const skipped: { label: string; why: string }[] = [];
  const warnings: string[] = [];
  for (const x of items) {
    const uid = x.kind === "ep" ? epToUser.get(x.id) : x.id;
    const a = uid ? byUser.get(uid) : null;
    if (!a) { skipped.push({ label: x.label, why: "口座が未登録か、確認が済んでいません" }); continue; }
    if (!a.bank_code || !a.branch_code) { skipped.push({ label: x.label, why: "銀行コード・支店コードが未登録です（ご本人に登録し直していただくか、銀行の画面で補ってください）" }); continue; }
    if (!a.account_no || !a.holder_kana) { skipped.push({ label: x.label, why: "口座番号か名義が読めません" }); continue; }
    const holder = zenginText(a.holder_kana);
    if (holder.dropped.length) warnings.push(`${x.label}：名義の「${holder.dropped.join("")}」は全銀で使えない文字のため空白にしました`);
    if (holder.text.length > 30) warnings.push(`${x.label}：名義が30文字を超えるため切りました`);
    const amount = Math.round(Number(x.amount));
    payees.push({ bank_code: a.bank_code, branch_code: a.branch_code, account_type: a.account_type, account_no: a.account_no, holder: holder.text.slice(0, 30), amount });
    csvRows.push([x.label, a.bank_code, a.bank_name ?? "", a.branch_code, a.branch_name ?? "", a.account_type === "touza" ? "当座" : (a.account_type === "chochiku" ? "貯蓄" : "普通"), a.account_no, holder.text.slice(0, 30), String(amount)]);
  }
  if (senderName.dropped.length) warnings.push(`委託者名の「${senderName.dropped.join("")}」は全銀で使えない文字のため空白にしました`);
  if (!payees.length) return json({ ok: false, error: "ファイルにできる相手がいませんでした", skipped });

  let lines: string[];
  try { lines = zenginLines(sender, date, payees); }
  catch (e) { return json({ ok: false, error: String((e as Error)?.message ?? e) }, 500); }
  const zengin = toSjisBytes(lines.join("\r\n") + "\r\n");
  const csv = "\uFEFF" + csvRows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const total = payees.reduce((s, p) => s + p.amount, 0);
  return json({ ok: true, zengin_b64: b64(zengin), csv, count: payees.length, total, skipped, warnings });
});
