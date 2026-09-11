// =============================================================
// 集金と振込（画面側）の試験
//   ・相殺後に「ご請求」が残る相手の数
//   ・請求台帳の集金方式ごとの内訳と、口座振替／銀行振込の CSV
//   ・総合振込ファイルの箱（対象・入れないもの・EP-II 不明のときは作らせない）
//   ・委託者情報の欄と保存対象、契約締結の知らせの呼び出し、版、説明書、SQL
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const MANA = fs.readFileSync(__dirname + '/../manual-admin.html', 'utf8');
const MANP = fs.readFileSync(__dirname + '/../manual-partner.html', 'utf8');
const VER = JSON.parse(fs.readFileSync(__dirname + '/../version.json', 'utf8'));
const SQL = fs.readFileSync(__dirname + '/../supabase/migrations/20260911030000_contract_notified.sql', 'utf8');
const CS = fs.readFileSync(__dirname + '/../supabase/functions/contract-send/index.ts', 'utf8');
const PF = fs.readFileSync(__dirname + '/../supabase/functions/payout-file/index.ts', 'utf8');
let n = 0, bad = [];
function is(name, got, want) { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) bad.push({ name, got: g, want: w }); }
function ok(name, cond) { is(name, !!cond, true); }
function no(name, cond) { is(name, !!cond, false); }
function takeFn(name) {
  const re = new RegExp('\\n  (?:async )?function ' + name + '\\s*\\(', 'g');
  let m, last = null, cnt = 0;
  while ((m = re.exec(SRC)) !== null) { last = m; cnt++; }
  if (!last) throw new Error('見つかりません: ' + name);
  is('定義は一つだけ: ' + name, cnt, 1);
  const end = SRC.indexOf('\n  }\n', last.index);
  return SRC.slice(last.index, end + 4);
}
const base =
  'function esc(s){ return String(s==null?"":s).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];}); }' +
  'function yen(v){ return "¥"+Math.round(Number(v)||0).toLocaleString("ja-JP"); }' +
  takeFn('payDueCount') + takeFn('invMethodSummary') + takeFn('invCsvRows') + takeFn('payFileBoxHtml');
const M = new Function(base + 'return {due:payDueCount, sum:invMethodSummary, csv:invCsvRows, box:payFileBoxHtml};')();

// ① 相殺後の支払者数
{
  const acc = { a: { due: 0, pay: 100 }, b: { due: 5000 }, c: { due: 3000, acctOrg: '法人X' }, d: { due: 0 } };
  const epG = { x: { due: 12000 }, y: { due: 0, payNet: 100 } };
  is('個人の「ご請求」と EP-I 法人の「ご請求」を数える（EP-I の担当者は数えない）', M.due(acc, ['a', 'b', 'c', 'd'], epG, ['x', 'y']), 2);
  is('空なら0', M.due({}, [], {}, []), 0);
}
// ② 集金方式の内訳と CSV
{
  const rows = [
    { customer_id: 'c1', name: 'A社', title: '顧問料 9月', period: '2026-09', amount: 49500, paid_amount: 0, due_on: '2026-09-27', status: 'open', method: 'transfer' },
    { customer_id: 'c2', name: 'B社', title: '顧問料 9月', period: '2026-09', amount: 49500, paid_amount: 20000, due_on: '2026-09-27', status: 'partial', method: 'bank' },
    { customer_id: 'c3', name: 'C社', title: '顧問料 9月', period: '2026-09', amount: 49500, paid_amount: 49500, due_on: '2026-09-27', status: 'paid', method: 'transfer' },
    { customer_id: 'c4', name: 'D社', title: 'FA', period: '2026-09', amount: 3300000, paid_amount: 0, due_on: '2026-09-30', status: 'void', method: 'bank' },
    { customer_id: 'c5', name: 'E社', title: '顧問料 9月', period: '2026-09', amount: 33000, paid_amount: 0, due_on: '2026-09-27', status: 'open' },
  ];
  const s = M.sum(rows);
  is('口座振替：未入金の件数と額', [s.transfer.n, s.transfer.amt], [1, 49500]);
  is('銀行振込：一部入金は残りで数え、method 無しは振込に寄せる', [s.bank.n, s.bank.amt], [2, 29500 + 33000]);
  const t = M.csv(rows, 'transfer');
  is('口座振替CSV：見出し＋1行', t.length, 2);
  is('口座振替CSV：誰に・いくら・いつ（口座は無い）', t[1], ['c1', 'A社', '顧問料 9月', '2026-09', '49500', '2026-09-27', '未入金']);
  no('見出しに口座の列は無い', /口座/.test(t[0].join(',')));
  const b = M.csv(rows, 'bank');
  is('銀行振込CSV：2行、一部入金は残額', [b.length, b[1][4], b[1][6]], [3, '29500', '一部入金']);
}
// ③ 総合振込ファイルの箱
{
  const items = [{ kind: 'user', id: 'u1', amount: 50000, label: '山田' }, { kind: 'ep', id: 'e1', amount: 120000, label: '法人A' }];
  const h = M.box(items, ['法人B（利用料を引けていない）'], false);
  ok('件数と合計', /お振込みになる 2 件・合計 ¥170,000/.test(h));
  ok('入れないものを名指し', /入れないもの：<\/b>法人B（利用料を引けていない）/.test(h));
  ok('振込指定日とボタン', /id="pf-date"/.test(h) && /onclick="payFileMake\(\)"/.test(h));
  ok('初回は試す注意', /初回は<b>1件だけの月で試す<\/b>/.test(h));
  const h2 = M.box(items, [], true);
  no('EP-II 不明ならボタンなし', /payFileMake/.test(h2));
  ok('EP-II 不明の理由', /EP-II かどうかを確かめられていない/.test(h2));
  const h3 = M.box([], [], false);
  ok('対象なしの文', /お振込みになる方はいません/.test(h3));
}
// ④ 配線
{
  const lp = takeFn('loadPayout');
  ok('配分の計算の末尾で「誰にいくら」を持つ', /PAY_FILE=\{ ym:ym, items:fileItems \}/.test(lp) && /PAY_FILE=null;/.test(lp));
  ok('EP-I は法人へ1本・ご本人の行は入れない', /kind:'ep', id:id, amount:Math\.round\(g\.payNet\)/.test(lp) && /if\(b\.acctOrg\) return;/.test(lp));
  ok('利用料を引けなかった法人は入れない', /if\(g\.unknown\)\{ fileSkip\.push/.test(lp));
  ok('ご請求の件数を出す', /payDueCount\(acc, keys, epG, epOrder\)\+' 件/.test(lp));
  const pm = takeFn('payFileMake');
  ok('Edge Function を呼ぶ', /functions\.invoke\('payout-file'/.test(pm));
  ok('確認してから', /confirm\(/.test(pm) && /口座を取り出した記録が残ります/.test(pm));
  ok('全銀ファイルと確認CSVを保存', /bytesDl\('sogo_furikomi_'/.test(pm) && /_kakunin\.csv'/.test(pm));
  ok('委託者情報の欄', ['bl-sc', 'bl-sname', 'bl-sbank', 'bl-sbranch', 'bl-stype', 'bl-sacct'].every((id) => SRC.indexOf('id="' + id + '"') > 0));
  const ids = SRC.match(/var BL_RATE_IDS=\[[^\]]+\]/)[0];
  ok('委託者情報は設定として保存される', ['bl-sc', 'bl-sname', 'bl-sbank', 'bl-sbranch', 'bl-stype', 'bl-sacct'].every((id) => ids.indexOf("'" + id + "'") > 0));
  ok('Edge Function も同じ鍵で読む', ['bl-sc', 'bl-sname', 'bl-sbank', 'bl-sbranch', 'bl-stype', 'bl-sacct'].every((id) => PF.indexOf('v["' + id + '"]') > 0));
  const ri = takeFn('renderInvoices');
  ok('請求台帳に集金方式の内訳と CSV', /invMethodSummary\(INV_ROWS\)/.test(ri) && /invCsv\(\\'transfer\\'\)/.test(ri) && /invCsv\(\\'bank\\'\)/.test(ri));
  const ca = takeFn('ctAgree');
  ok('同意の直後に締結の知らせを呼ぶ（already のときは呼ばない）', /if\(!r\.data\.already\)\{[\s\S]*action:'agreed'/.test(ca));
  ok('知らせが失敗しても同意の画面は進む', ca.indexOf("action:'agreed'") < ca.indexOf('await ctOpen();'));
  ok('contract-send の agreed は notified_at で一度だけ', /\.is\("notified_at", null\)/.test(CS) && /already: true/.test(CS));
  ok('contract-send は DB のお知らせを文面に使う', /contract_offers\.id=" \+ o\.data\.id/.test(CS));
}
// ⑤ 版・SQL・説明書
{
  const build = SRC.match(/var APP_BUILD='([^']+)'/)[1];
  is('版が揃う', [build, VER.build], ['20260911-16', '20260911-16']);
  ok('SQL は列を足すだけで期待値1', /add column if not exists notified_at timestamptz/.test(SQL) && /期待値：1/.test(SQL));
  ok('SQL にデプロイの手順', /supabase functions deploy contract-send --no-verify-jwt/.test(SQL));
  ok('運営説明書：総合振込ファイル', /総合振込ファイル/.test(MANA) && /委託者情報/.test(MANA) && /全銀フォーマット/.test(MANA));
  ok('運営説明書：集金の見取り図と CSV', /集金の見取り図/.test(MANA) && /口座振替の請求データ（CSV）/.test(MANA));
  ok('運営説明書：お客様の口座は置かない', /お客様の口座はこのシステムに置きません/.test(MANA));
  ok('運営説明書：締結はメールと LINE にも', /メールと LINE（連携している方）にも同じ文面が届きます/.test(MANA));
  ok('パートナー説明書：締結はメールと LINE にも', /メールと、連携していれば LINE にも/.test(MANP));
  ok('payout-file のデプロイ手順', /supabase functions deploy payout-file --no-verify-jwt/.test(PF));
}
console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
