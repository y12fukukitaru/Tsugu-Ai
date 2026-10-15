// =============================================================
// 請求書をメールで送る（運営・画面側）の試験（2026-10-15）
//   ・載せる請求の数え方（銀行振込・未入金・初回のお振込みの分は除く）
//   ・送る流れ（用意 invoice_mail_prepare → billing-mail invoice）・まとめて送る
//   ・概要タブの「請求書の発行者」・説明書・SQL・版
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const VER = JSON.parse(R('version.json'));
let n = 0, bad = [];
function is(name, got, want) { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) bad.push({ name, got: g, want: w }); }
function ok(name, cond) { is(name, !!cond, true); }
function takeFn(name) {
  const re = new RegExp('\\n  (?:async )?function ' + name + '\\s*\\(', 'g');
  let m, last = null, cnt = 0;
  while ((m = re.exec(SRC)) !== null) { last = m; cnt++; }
  if (!last) throw new Error('見つかりません: ' + name);
  is('定義は一つだけ: ' + name, cnt, 1);
  const end = SRC.indexOf('\n  }\n', last.index);
  return SRC.slice(last.index, end + 4);
}
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const yen = (v) => '¥' + Math.round(v || 0).toLocaleString('ja-JP');

// ① 数え方
{
  const T = new Function(takeFn('invMailTargets') + 'return invMailTargets;')();
  const rows = [
    { id: '1', customer_id: 'a', name: '一社', status: 'open', method: 'bank', amount: 49500, paid_amount: 0 },
    { id: '2', customer_id: 'a', name: '一社', status: 'partial', method: null, amount: 11000, paid_amount: 1000 },
    { id: '3', customer_id: 'a', name: '一社', status: 'void', method: 'bank', amount: 1, paid_amount: 0 },
    { id: '4', customer_id: 'b', name: '二社', status: 'open', method: 'transfer', amount: 49500, paid_amount: 0 },
    { id: '5', customer_id: 'c', name: '三社', status: 'open', method: 'bank', amount: 110000, paid_amount: 0, notice: { mailed_at: 'x' } },
    { id: '6', customer_id: 'd', name: '四社', status: 'paid', method: 'bank', amount: 49500, paid_amount: 49500 },
    { id: '7', customer_id: 'e', name: '五社', status: 'open', method: 'bank', amount: 38500, paid_amount: 0 },
  ];
  const t = T(rows);
  is('お客様ごと・銀行振込で未入金だけ（取消・口座振替・初回のお振込み・入金済みは除く）', t.map((c) => [c.id, c.rows.length, c.rest]), [['a', 2, 59500], ['e', 1, 38500]]);
}
// ② 表示と送る流れ
{
  const box = takeFn('invMailBoxHtml');
  ok('箱：まだ送っていない社数で送る・送った日時と番号・送れなかった理由・1社ずつ', /まだ送っていない '\+unsent\.length\+' 社へ送る/.test(box) && /送りました（/.test(box) && /No\.'\+esc\(m\.invoice_no/.test(box) && /送れませんでした（'\+esc\(m\.mail_error\)/.test(box) && /onclick="invMailOne\(/.test(box) && /もう一度送る/.test(box));
  ok('箱：SQL が入っていなければ案内', /請求書メールはまだ使えません/.test(box));
  ok('一覧に箱を出す', /\+invMailBoxHtml\(\);/.test(takeFn('renderInvoices')));
  ok('読み込み：その月の請求書メール', /from\('invoice_mails'\)\.select\('customer_id,invoice_no,issued_on,mailed_at,mail_count,mail_error'\)\.eq\('period',ym\)/.test(takeFn('loadInvoices')));
  const s = takeFn('invMailSend');
  ok('送る：先に DB で用意してから billing-mail（invoice）', s.indexOf("sb.rpc('invoice_mail_prepare',{ p_period:ym, p_customer:cust })") >= 0 && s.indexOf("sb.rpc('invoice_mail_prepare'") < s.indexOf("action:'invoice', mail_id:p.id"));
  const one = takeFn('invMailOne');
  ok('1社：確かめてから・送ったことがあれば番号は同じと伝える・読み直す', /confirm\(/.test(one) && /請求書番号は同じです/.test(one) && /loadInvoices\(\)/.test(one));
  const all = takeFn('invMailAll');
  ok('まとめて：まだ送っていない方だけ・一覧を見せて確かめる・1社ずつ順に・送れなかった方を出す', /!\(m&&m\.mailed_at\)/.test(all) && /confirm\(/.test(all) && /for\(var i=0;i<ts\.length;i\+\+\)/.test(all) && /await invMailSend\(ts\[i\]\.id\)/.test(all) && /送れなかった方/.test(all));
}
// ③ 概要タブの発行者
{
  ok('発行者の欄（社名・所在地・電話・登録番号）', ['bl-iss-name', 'bl-iss-addr', 'bl-iss-tel', 'bl-iss-tno'].every((id) => new RegExp('id="' + id + '" class="inp2"[^>]*oninput="blRatesSave\\(\\)"').test(SRC)));
  ok('発行者は料率と同じく自動で保存（口座ではない）', /'bl-iss-name','bl-iss-addr','bl-iss-tel','bl-iss-tno'\];/.test(SRC) && !/recv:\['bl-bank','bl-iss/.test(SRC));
}
// ④ SQL・Edge Function・説明書・版
{
  const SQL = R('supabase/migrations/20261015030000_invoice_mail.sql');
  ok('SQL：運営だけ・銀行振込で未入金・初回のお振込みの分は除く', /if not public\.invoice_is_admin\(\)/.test(SQL) && /coalesce\(i\.method, 'bank'\) <> 'transfer'/.test(SQL) && /from public\.setup_fee_notices n/.test(SQL));
  ok('SQL：番号は 年月-通し番号・同じ方と月は1通', /replace\(p_period, '-', ''\) \|\| '-' \|\| lpad\(nextval/.test(SQL) && /unique \(customer_id, period\)/.test(SQL));
  ok('SQL：止めている方には見せない守り', /"service active" on public\.invoice_mails as restrictive/.test(SQL));
  const EF = R('supabase/functions/billing-mail/index.ts');
  ok('Edge Function：invoice は運営だけ・送信中を取ってから', /async function sendInvoice/.test(EF) && /\.is\("sending_at", null\)\.select\("id"\)/.test(EF) && /body\.action !== "invoice"/.test(EF));
  const MA = R('manual-admin.html'), MC = R('manual-customer.html');
  ok('運営説明書：請求書をメールで送る頁と発行者の欄', /data-t="請求書をメールで送る"/.test(MA) && /<tr><th>請求書の発行者<\/th>/.test(MA));
  ok('経営者説明書：毎月の請求書がメールで届く', /毎月、<b>請求書<\/b>（請求書番号・内訳・お支払期日・お振込先）がメールで届きます/.test(MC));
  is('版が揃う', [SRC.match(/var APP_BUILD='([^']+)'/)[1], VER.build], [VER.build, VER.build]);
}

if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b.name, '\n   got ', b.got, '\n   want', b.want)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
