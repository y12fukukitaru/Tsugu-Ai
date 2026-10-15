// =============================================================
// お振込みのお願い・3か月の滞納で請求を止める（画面側）の試験（2026-10-15）
//   ・未収をお客様ごとにまとめる／3か月分で「請求を止めています」
//   ・運営の未収とパートナーの「担当先の未入金」から送る
//   ・送る流れ（中身の確認 → 期日 → 用意 → billing-mail）
//   ・月の請求で止めた社数を出す、説明書、SQL・Edge Function、版
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
const M = new Function(takeFn('dunGroups') + takeFn('dunAddDays') + takeFn('dunMonth') + 'return {g:dunGroups, add:dunAddDays, mon:dunMonth};')();

// ① まとめ方
{
  const rows = [
    { customer_id: 'a', title: '2026-07 顧問料（買い手プラン）', period: '2026-07', amount: 49500, paid_amount: 0, days_late: 80 },
    { customer_id: 'b', title: '初期導入費（買い手プラン）', period: '2026-09', amount: 110000, paid_amount: 0, days_late: 10 },
    { customer_id: 'a', title: '2026-08 顧問料（買い手プラン）', period: '2026-08', amount: 49500, paid_amount: 0, days_late: 49 },
    { customer_id: 'a', title: '2026-09 顧問料（買い手プラン）', period: '2026-09', amount: 49500, paid_amount: 9500, days_late: 18 },
  ];
  const g = M.g(rows);
  is('お客様ごと（出てきた順）', g.map((c) => c.id), ['a', 'b']);
  is('残りの合計・いちばん長い遅れ・顧問料の月数', [g[0].rest, g[0].late, g[0].months], [139000, 80, 3]);
  is('顧問料3か月分で「止めている」・初期導入費だけなら止めない', [g[0].held, g[1].held], [true, false]);
  is('〇月分の顧問料・ほかは件名', [M.mon(rows[0]), M.mon(rows[1])], ['2026年7月分の顧問料', '初期導入費（買い手プラン）']);
  is('期日の既定（2週間後・月またぎ）', M.add('2026-10-25', 14), '2026-11-08');
}
// ② 送る流れ
{
  const d = takeFn('dunSend');
  ok('中身はDBで決める（dunning_preview）', /sb\.rpc\('dunning_preview',\{ p_customer:cust \}\)/.test(d));
  ok('送る前に、〇月分・金額・合計・止めているか・切り替え・前回を見せる', /dunMonth\(x\)/.test(d) && /合計 '\+yen\(d\.total\)/.test(d) && /請求を止めています/.test(d) && /銀行振込に切り替えます/.test(d) && /前回のお願い/.test(d));
  ok('お支払期日は既定2週間後・形を確かめる', /prompt\(msg, dunAddDays\(jstToday\(\),14\)\)/.test(d) && /\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/.test(d));
  ok('用意してから送る（dunning_prepare → billing-mail dunning）', d.indexOf("sb.rpc('dunning_prepare'") < d.indexOf("action:'dunning', notice_id:p.id"));
  ok('送れなかったときも伝える・一覧を読み直す', /送れませんでした/.test(d) && /loadInvOverdue\(\)/.test(d) && /loadUnpaid\('partner'\)/.test(d));
  const r = takeFn('renderInvOverdue');
  ok('運営：お客様ごとにまとめ、ボタン・止めている札・前回', /dunGroups\(INV_OD\)/.test(r) && /onclick="dunSend\(/.test(r) && /3か月滞納・請求を止めています/.test(r) && /DUN_LAST\[c\.id\]/.test(r));
  ok('運営：前回送った日時を読む', /await dunLoadLast\(INV_OD\.map/.test(takeFn('loadInvOverdue')));
  const u = takeFn('loadUnpaid');
  ok('パートナー：担当先の未入金にも同じボタン', /dunGroups\(rows\)/.test(u) && /onclick="dunSend\(/.test(u) && /await dunLoadLast\(rows\.map/.test(u));
  ok('前回は送れたものだけ', /\.not\('mailed_at','is',null\)/.test(takeFn('dunLoadLast')));
  ok('月の請求：止めた社数を出す', /d\.held>0\?/.test(takeFn('invGenerate')));
}
// ③ SQL・Edge Function
{
  const SQL = R('supabase/migrations/20261015010000_dunning.sql');
  ok('SQL：送れるのは運営と担当（主・サブ）', /create or replace function public\.dunning_can/.test(SQL) && /a\.main_id = auth\.uid\(\) or a\.sub_id = auth\.uid\(\)/.test(SQL));
  ok('SQL：まとめた分は振込に切り替える', /update public\.invoices set method = 'bank', updated_at = now\(\)\s+where id = any\(v_ids\) and method = 'transfer'/.test(SQL));
  ok('SQL：同じ方へは1日に1回', /interval '1 day'/.test(SQL));
  ok('SQL：3か月分で月の請求を止め、止めた社数を返す', /count\(\*\) >= 3/.test(SQL) && /public\.billing_held\(r\.id, v_start\)/.test(SQL) && /'held', v_held/.test(SQL));
  const EF = R('supabase/functions/billing-mail/index.ts');
  ok('Edge Function：dunning は用意した本人か運営だけ・一度だけ', /n\.sent_by !== uid && !isAdmin/.test(EF) && /\.is\("mailed_at", null\)\.select\("id"\)/.test(EF));
}
// ④ 説明書・版
{
  const MA = R('manual-admin.html'), MP = R('manual-partner.html'), MC = R('manual-customer.html');
  ok('運営説明書：お振込みのお願いと3か月で止める', /data-t="お振込みのお願い（引き落とせなかった分）"/.test(MA) && /顧問料が3か月分たまった方には、次の月から請求を止めます。/.test(MA));
  ok('パートナー説明書：担当先の未入金から送れる', /「💴 お振込みのお願いを送る」<\/b>で、〇月分・いくら/.test(MP));
  ok('経営者説明書：引き落とせなかったときはお振込み', /<tr><th>引き落とせなかったとき<\/th>/.test(MC) && /その分はお振込みでお願いします/.test(MC));
  is('版が揃う', [SRC.match(/var APP_BUILD='([^']+)'/)[1], VER.build], [VER.build, VER.build]);
}

if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b.name, '\n   got ', b.got, '\n   want', b.want)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
