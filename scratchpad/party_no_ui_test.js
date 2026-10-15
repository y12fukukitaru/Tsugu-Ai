// =============================================================
// 顧客番号・パートナー番号（画面側）の試験（2026-10-15）
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
const M = new Function('esc', 'window', 'ADM_CACHE', takeFn('pnoFmt') + takeFn('pnoKey') + takeFn('pnoHit') + takeFn('pnoTag') + takeFn('pnoOf') + takeFn('pnoMineHtml')
  + 'var PNO={a:{c:"C482719531",p:""}}; return {fmt:pnoFmt, hit:pnoHit, tag:pnoTag, of:pnoOf, mine:pnoMineHtml};');

// ① 形と探し方
{
  const W = { __prof: { role: 'customer', customer_no: 'C482719531' } };
  const m = M(esc, W, { all: [{ id: 'b', customer_no: 'C111111116', partner_no: 'P222222224' }] });
  is('区切って見せる', [m.fmt('C482719531'), m.fmt('P306588120'), m.fmt(''), m.fmt('x')], ['C-4827-1953-1', 'P-3065-8812-0', '', 'x']);
  ok('探す：一部・ハイフン・小文字・空白でも当たる', m.hit('C482719531', '4827') && m.hit('C482719531', 'c-4827-1953-1') && m.hit('C482719531', ' 4827 1953 ') && m.hit('C482719531', 'C48'));
  ok('探す：2文字以下・空・番号なしは当てない', !m.hit('C482719531', '48') && !m.hit('C482719531', '') && !m.hit('', '4827'));
  ok('探す：違う番号は当てない', !m.hit('C482719531', '9999'));
  ok('札：顧客番号とパートナー番号の見出し', /title="顧客番号">C-4827-1953-1</.test(m.tag('C482719531')) && /title="パートナー番号"/.test(m.tag('P306588120')) && m.tag('') === '');
  is('番号を引く（読み込んだもの → 運営の一覧）', [m.of('a', 'c'), m.of('b', 'c'), m.of('b', 'p'), m.of('z', 'c')], ['C482719531', 'C111111116', 'P222222224', '']);
  ok('ご本人：お客様番号', /お客様番号<\/span><b[^>]*>C-4827-1953-1<\/b>/.test(m.mine('customer')));
  ok('ご本人：役割が違う（運営が顧客の見え方を試す）ときは出さない', m.mine('consultant') === '' && M(esc, { __prof: { role: 'admin', customer_no: '' } }, {}).mine('customer') === '');
  ok('パートナー：パートナー番号', /パートナー番号<\/span><b[^>]*>P-3065-8812-0<\/b>/.test(M(esc, { __prof: { role: 'consultant', partner_no: 'P306588120' } }, {}).mine('consultant')));
}
// ② 置き場所
{
  ok('運営：パートナー一覧に札・番号で探せる', /\+pnoTag\(u\.partner_no\)/.test(takeFn('renderAdmFde')) && /pnoHit\(u\.partner_no, q\)/.test(takeFn('renderAdmFde')));
  ok('運営：顧客一覧に札・番号で探せる', /\+pnoTag\(u\.customer_no\)/.test(takeFn('renderAdmCust')) && /!pnoHit\(u\.customer_no, q\)/.test(takeFn('renderAdmCust')));
  ok('検索欄の案内に番号', /会社名・メールアドレス・顧客番号で検索" oninput="renderAdmCust\(\)"/.test(SRC) && /名前・メールアドレス・パートナー番号で検索/.test(SRC) && /会社名・メールアドレス・顧客番号で検索" oninput="renderClientList\(\)"/.test(SRC));
  const rcl = takeFn('renderClientList');
  ok('パートナー：顧客一覧に札・番号で探せる', /pnoTag\(pnoOf\(c\.id,'c'\)\)/.test(rcl) && /pnoHit\(pnoOf\(c\.id,'c'\), q\)/.test(rcl));
  ok('パートナー：顧客の番号を読む（列が無くても一覧は出す）', /await pnoLoad\(clients\.map/.test(SRC) && /if\(r\.error\) return;/.test(takeFn('pnoLoad')));
  ok('カルテの題に顧客番号', /mt\.textContent=titleTxt\+\(cno\?'　'\+pnoFmt\(cno\):''\)/.test(takeFn('viewClient')));
  ok('課金：パートナー別・顧客別を番号で絞れる', /pnoHit\(r\.pno, pq\)/.test(SRC) && /pnoHit\(r\.c\.customer_no, cq\)/.test(SRC));
  ok('請求と未収：番号を読み、札と CSV の2列目に', /await pnoLoad\(ids\);/.test(takeFn('loadInvoices')) && /\+pnoTag\(x\.cno\)/.test(takeFn('renderInvoices')) && /\['顧客ID','顧客番号','会社名'/.test(takeFn('invCsvRows')));
  ok('未収：番号の札', /await pnoLoad\(INV_OD\.map/.test(takeFn('loadInvOverdue')) && /pnoTag\(pnoOf\(c\.id,'c'\)\)/.test(takeFn('renderInvOverdue')));
  ok('設定のいちばん上・お支払いの画面にご本人の番号', /var h=pnoMineHtml\(r\)\+/.test(takeFn('renderSettings')) && /\+pnoMineHtml\('customer'\)/.test(SRC));
}
// ③ SQL・Edge Function・説明書・版
{
  const SQL = R('supabase/migrations/20261015040000_party_numbers.sql');
  ok('SQL：C と P は別・形は 頭＋8桁乱数＋検査数字', /check \(no ~ '\^\[CP\]\[1-9\]\[0-9\]\{8\}\$'\)/.test(SQL) && /gen_random_uuid\(\)/.test(SQL) && /party_no_check\(v_body\)/.test(SQL));
  ok('SQL：書き換えさせない（更新は元の番号に戻す・新規は渡した番号を使わない）', /new\.customer_no := old\.customer_no;/.test(SQL) && /new\.customer_no := null;/.test(SQL));
  ok('SQL：番号を作る関数は画面から呼べない', /revoke all on function public\.party_no_issue\(uuid, text\) from public, anon, authenticated;/.test(SQL));
  ok('SQL：口座振替のお客様番号は顧客番号の数字9桁・請求書番号は 年月-顧客番号', /substr\(p\.customer_no, 2\)/.test(SQL) && /replace\(p_period, '-', ''\) \|\| '-' \|\| v_cno/.test(SQL));
  ok('SQL：通し番号を使わない', !/nextval\(/.test(SQL));
  const EF = R('supabase/functions/billing-mail/index.ts');
  ok('Edge Function：お客様番号を別に読む（無くても送る）', /async function custNo/.test(EF) && /\.select\("customer_no"\)/.test(EF) && (EF.match(/cno: await custNo\(sb, /g) || []).length === 3);
  const MA = R('manual-admin.html'), MP = R('manual-partner.html'), MC = R('manual-customer.html');
  ok('運営説明書：番号の頁', /data-t="顧客番号・パートナー番号"/.test(MA) && /いまの顧客数・パートナー数・契約数は分かりません/.test(MA) && /202611-C482719531/.test(MA) && !/6桁の<b>お客様番号/.test(MA));
  ok('パートナー説明書：パートナー番号と顧客番号', /<tr><th>パートナー番号<\/th>/.test(MP) && /<tr><th>顧客番号<\/th>/.test(MP));
  ok('経営者説明書：お客様番号', /<tr><th>お客様番号<\/th>/.test(MC));
  is('版が揃う', [SRC.match(/var APP_BUILD='([^']+)'/)[1], VER.build], [VER.build, VER.build]);
}

if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b.name, '\n   got ', b.got, '\n   want', b.want)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
