// =============================================================
// 3か月分の滞納で、翌月1日からご利用を一時停止（画面側）の試験（2026-10-15）
//   ・入口（enterApp）で止める／止めた画面の中身／もう一度確認する
//   ・運営・パートナーの札と「今月だけ停止を解く」
//   ・SQL・Edge Function・説明書・契約条項の案・版
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
const yen = (v) => '¥' + Number(v || 0).toLocaleString('ja-JP');

// ① 入口で止める
{
  const e = takeFn('enterApp');
  ok('担当パートナーの門のあと・中に入る前に確かめる', e.indexOf('needsPartnerGate') < e.indexOf('suspendStatus(prof)') && e.indexOf('suspendStatus(prof)') < e.indexOf('renderApp(prof, email)'));
  ok('止めていれば止めた画面で終わる', /if\(st\)\{ showSuspendGate\(st\); return; \}/.test(e));
  const s = takeFn('suspendStatus');
  ok('経営者だけ（運営・パートナーは通す）', /\(prof\.role\|\|'customer'\)!=='customer'\) return null/.test(s));
  ok('見ている会社で確かめる（閲覧メンバーも）', /var cid=SCOPE\|\|ME/.test(s) && /sb\.rpc\('service_status',\{ p_customer:cid \}\)/.test(s));
  ok('読めなければ通す（DB の側で止めている）', /catch\(e\)\{ return null; \}/.test(s) && /r\.error \|\| !r\.data/.test(s));
  ok('止めた画面：ほかの画面と継ナビくんを隠す', /\$\('app'\)\.classList\.add\('hidden'\)/.test(takeFn('showSuspendGate')) && /knvHideAll\(\)/.test(takeFn('showSuspendGate')));
  ok('止めた画面：お振込先を読む', /sb\.rpc\('invoice_pay_info'\)/.test(takeFn('showSuspendGate')));
  const r = takeFn('sgateRecheck');
  ok('もう一度確認：開いたら中へ・まだなら伝える', /renderApp\(prof, window\.__email\|\|''\)/.test(r) && /まだお振込みを確認できていません/.test(r));
  ok('ログアウトしたら止めた画面も隠す', /function showAuth\(\)\{[^\n]*\$\('sgate'\)[^\n]*classList\.add\('hidden'\)/.test(SRC));
  ok('止めた画面の枠：題・再開・データは残る・もう一度開く', /入金を確かめて、もう一度開く<\/button>/.test(SRC) && /<div id="sgate" class="gate hidden">/.test(SRC) && /ご利用を一時停止しています/.test(SRC) && /お振込みを確認しだい、すぐに再開します。/.test(SRC) && /これまでのデータはそのまま残っています。/.test(SRC));
}
// ② 止めた画面の中身
{
  const H = new Function('esc', 'yen', takeFn('sgateHtml') + 'return sgateHtml;')(esc, yen);
  const st = { since: '2026-10-01', total: 158400, partner_name: '山田 太郎', partner_email: 'p@example.jp', items: [
    { period: '2026-07', title: '2026-07 顧問料（買い手プラン）', amount_ex: 45000, tax: 4500, amount: 49500, paid_amount: 0 },
    { period: '2026-08', title: '2026-08 顧問料（買い手プラン）', amount_ex: 45000, tax: 4500, amount: 49500, paid_amount: 0 },
    { period: '2026-09', title: '2026-09 顧問料（買い手プラン）', amount_ex: 45000, tax: 4500, amount: 49500, paid_amount: 10000 },
    { period: '2026-09', title: '<b>初期導入費</b>', amount_ex: 10000, tax: 1000, amount: 11000, paid_amount: 0 },
  ] };
  const h = H(st, '広島銀行 本店営業部\n普通 1234567');
  ok('〇月分の顧問料', /2026年7月分の顧問料　<b>¥49,500<\/b>/.test(h) && /2026年8月分の顧問料/.test(h));
  ok('税別・消費税の内訳', /（税別 ¥45,000・消費税 ¥4,500）/.test(h));
  ok('一部入金は残りと入金済み', /2026年9月分の顧問料　<b>¥39,500<\/b>/.test(h) && /（¥10,000 は入金済み）/.test(h));
  ok('件名はそのまま・HTML は効かない', /&lt;b&gt;初期導入費&lt;\/b&gt;/.test(h) && !/<b>初期導入費<\/b>/.test(h));
  ok('お願い額', /お振込みのお願い額　¥158,400/.test(h));
  ok('お振込先（改行のまま）', /広島銀行 本店営業部\n普通 1234567/.test(h));
  ok('問い合わせ先は担当パートナー', /担当パートナー（山田 太郎・p@example\.jp）/.test(h));
  const h2 = H({ total: 0, items: [] }, '');
  ok('お振込先が無い・担当がいないとき', /担当パートナーまでお問い合わせください。/.test(h2) && /運営（082-548-2224）/.test(h2));
}
// ③ 運営・パートナーの札と、今月だけ解く
{
  const today = '2026-10-15';
  const D = new Function('jstToday', 'SUS_LIFT', takeFn('dunSuspended') + 'return dunSuspended;');
  const rows = (ds) => ds.map((d, i) => ({ title: '2026-0' + (7 + i) + ' 顧問料（買い手プラン）', due_on: d }));
  const c3 = { id: 'a', rows: rows(['2026-07-31', '2026-08-31', '2026-09-30']) };
  is('3か月分（今月1日より前が期日）で止めている', D(() => today, {})(c3), true);
  is('今月解いていれば止めていない', D(() => today, { a: '2026-10-03T00:00:00Z' })(c3), false);
  is('2か月分なら止めていない', D(() => today, {})({ id: 'a', rows: c3.rows.slice(0, 2) }), false);
  is('3件目の期日が今月なら、まだ止めていない', D(() => today, {})({ id: 'a', rows: rows(['2026-08-31', '2026-09-30', '2026-10-10']) }), false);
  is('初期導入費は数えない', D(() => today, {})({ id: 'a', rows: c3.rows.slice(0, 2).concat([{ title: '初期導入費', due_on: '2026-09-30' }]) }), false);
  const l = takeFn('susLift');
  ok('今月だけ解く：理由が要る・suspension_lift・読み直す', /if\(why===null\) return;/.test(l) && /解く理由をご記入ください/.test(l) && /sb\.rpc\('suspension_lift',\{ p_customer:cust, p_reason:String\(why\)\.trim\(\) \}\)/.test(l) && /loadInvOverdue\(\)/.test(l));
  const dl = takeFn('dunLoadLast');
  ok('今月解いた方を読む', /from\('service_suspensions'\)/.test(dl) && /SUS_LIFT\[n\.customer_id\]=n\.lifted_at/.test(dl));
  const r = takeFn('renderInvOverdue');
  ok('運営：札と「今月だけ停止を解く」', /⏸ ご利用を一時停止中/.test(r) && /今月は停止を解いています/.test(r) && /onclick="susLift\(/.test(r) && /⏯ 今月だけ停止を解く/.test(r));
  const u = takeFn('loadUnpaid');
  ok('パートナー：札だけ（解くのは運営）', /⏸ ご利用を一時停止中/.test(u) && !/susLift\(/.test(u));
}
// ④ SQL・Edge Function
{
  const SQL = R('supabase/migrations/20261015020000_suspension.sql');
  ok('SQL：止めるのは月の請求を止める判定と同じ（その月の1日で見る）', /public\.billing_held\(p\.id, date_trunc\('month', \(now\(\) at time zone 'Asia\/Tokyo'\)::date\)::date\)/.test(SQL));
  ok('SQL：今月解いていれば止めない', /s\.lifted_at is not null/.test(SQL));
  ok('SQL：止めた顧客ご本人だけ false', /p\.id = auth\.uid\(\) and p\.role = 'customer'/.test(SQL));
  ok('SQL：お支払いに関わる表のほか、全部の表に止める側の決まり', /as restrictive for all to authenticated/.test(SQL) && /'profiles','invoices','app_settings','debit_mandates','dunning_notices',/.test(SQL));
  ok('SQL：解くのは運営だけ・理由が要る', /if not public\.invoice_is_admin\(\)/.test(SQL) && /解く理由をご記入ください/.test(SQL));
  ok('SQL：毎朝 9:00 JST に billing-mail（suspend_notify）', /cron\.schedule\('suspend-notify', '0 0 \* \* \*', c\)/.test(SQL) && /"action":"suspend_notify"/.test(SQL));
  ok('SQL：確かめの期待値', /表=1、関数=6、守りの無い表=0、毎朝の呼び出し=1/.test(SQL));
  const EF = R('supabase/functions/billing-mail/index.ts');
  ok('Edge Function：毎朝の呼び出しは合言葉で', /x-cron-secret/.test(EF) && /suspend_notify/.test(EF));
  ok('Edge Function：2か月分で事前のお知らせ', /その翌月1日からご利用を一時停止/.test(EF));
}
// ⑤ 説明書・契約条項の案・版
{
  const MA = R('manual-admin.html'), MP = R('manual-partner.html'), MC = R('manual-customer.html'), MB = R('manual-buyer.html'), MS = R('manual-seller.html');
  ok('運営説明書：一時停止の頁', /data-t="ご利用の一時停止（3か月分の滞納）"/.test(MA) && /⏯ 今月だけ停止を解く/.test(MA) && /docs\/suspension-clause\.md/.test(MA));
  ok('パートナー説明書：翌月1日から停止・担当にもメール', /その翌月1日からご利用も一時停止/.test(MP) && /担当のあなたにもメールが届き/.test(MP));
  ok('経営者説明書：3か月分たまったとき（買い手版・売り手版にも）', [MC, MB, MS].every((m) => /<tr><th>3か月分たまったとき<\/th>/.test(m) && /その翌月1日からご利用を一時停止/.test(m)));
  const CL = R('docs/suspension-clause.md');
  ok('契約条項の案：弁護士の確認・止める範囲・解除・データは消さない', /弁護士の確認を受けてから/.test(CL) && /第5条の2/.test(CL) && /遅滞なく一時停止を解除する/.test(CL) && /データを消去しない/.test(CL));
  is('版が揃う', [SRC.match(/var APP_BUILD='([^']+)'/)[1], VER.build], [VER.build, VER.build]);
}

if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b.name, '\n   got ', b.got, '\n   want', b.want)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
