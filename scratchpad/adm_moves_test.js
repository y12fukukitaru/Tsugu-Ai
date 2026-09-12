// =============================================================
// 運営ダッシュボード「今日の動き」と、エンタープライズの絵の試験
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
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
function takeVar(name) {
  const re = new RegExp('\\n  var ' + name + '\\s*=', 'g');
  let m, last = null;
  while ((m = re.exec(SRC)) !== null) last = m;
  const from = SRC.indexOf('=', last.index) + 1;
  const nl = SRC.indexOf('\n', from);
  return 'var ' + name + '=' + SRC.slice(from, nl).trim();
}
// ① 絵
ok('エンタープライズの絵が地図にある', /'sec-ep':'briefcase'/.test(SRC));
ok('briefcase の絵は定義済み', /\n\s*briefcase\s*:\s*'</.test(SRC));
ok('運営のメニューに sec-ep がある', /\['sec-ep','エンタープライズ'\]/.test(SRC));

// ② 今日の動き
const M = new Function(
  'function esc(s){ return String(s==null?"":s).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];}); }' +
  'function jstMin(t){ return String(t||"").slice(0,16).replace("T"," "); }' +
  takeVar('ADM_MOVES_DAYS') + takeFn('admMovesHtml') + 'return admMovesHtml;'
)();
const now = new Date('2026-09-11T00:00:00Z');
const d = (days) => new Date(now.getTime() - days * 86400000).toISOString();
const rows = [
  { id: 'p1', role: 'consultant', full_name: '佐藤', created_at: d(2) },
  { id: 'p2', role: 'consultant', full_name: '鈴木', created_at: d(40) },
  { id: 'c1', role: 'customer', company_name: 'A社', created_at: d(1), consultant_id: 'p1' },
  { id: 'c2', role: 'customer', company_name: 'B社', created_at: d(3), consultant_id: null },
  { id: 'c3', role: 'customer', company_name: 'C社', created_at: d(30), consultant_id: null },
  { id: 'a1', role: 'admin', email: 'x@y', created_at: d(100) }
];
const nameOf = { p1: '佐藤', p2: '鈴木' };
const pending = [{ user_id: 'p2', name: '鈴木', email: 's@x', bank_name: 'みずほ', last4: '1234', submitted_at: d(0.5) }];
const contracts = [
  { kind: 'customer', email: 'A@x.jp', status: 'agreed', agreed_at: d(1.2), agreed_name: '山田', agreed_org: 'A社', offered_by: 'p1', consultant_id: 'p1' },
  { kind: 'partner', email: 'np@x.jp', status: 'agreed', agreed_at: d(2.5), agreed_name: '高橋', offered_by: 'a1' },
  { kind: 'customer', email: 'old@x.jp', status: 'agreed', agreed_at: d(40), agreed_name: '旧', offered_by: 'p2', consultant_id: 'p2' }
];
const invites = [{ email: 'inv@x.jp', company_name: 'D社', consultant_id: 'p2', created_at: d(0.2), status: 'pending' }];
rows[2].email = 'a@x.jp';
const h = M(rows, nameOf, pending, now, contracts, invites);
ok('題', /今日の動き/.test(h));
ok('新しく登録した顧客 2社（7日以内）', /新しく登録した顧客<\/div><div[^>]*>2社/.test(h));
ok('担当未割当 2社（全期間）', /担当未割当の顧客<\/div><div[^>]*>2社/.test(h));
ok('新しいパートナー 1名', /新しいパートナー<\/div><div[^>]*>1名/.test(h));
ok('確認待ちの口座 1件', /確認待ちの口座<\/div><div[^>]*>1件/.test(h));
ok('顧客の行に担当名', /A社<\/span><span[^>]*>担当：佐藤<\/span>/.test(h));
ok('未割当は赤', /B社<\/span><span[^>]*><span style="color:#A9403D;">担当未割当<\/span>/.test(h));
no('30日前の顧客は行に出ない', /C社/.test(h));
ok('パートナーの行', /パートナー<\/span><span[^>]*>佐藤<\/span>/.test(h));
ok('口座の行と「確認する」', /口座<\/span><span[^>]*>鈴木　みずほ \*\*\*\*1234<\/span><span[^>]*onclick="goSec\('sec-billing'\)">確認する →/.test(h));
ok('新しい順', h.indexOf('A社') < h.indexOf('B社'));
ok('チップの行き先', /goSec\('sec-cust'\)/.test(h) && /goSec\('sec-fde'\)/.test(h) && /goSec\('sec-billing'\)/.test(h));
ok('締結は同意画面を押した日時だと明記', /「締結」は契約書の同意画面を押した日時です/.test(h));
ok('締結した契約 2件（7日以内。40日前は数えない）', /締結した契約<\/div><div[^>]*>2件/.test(h));
ok('招待中 1件', /招待中（登録待ち）<\/div><div[^>]*>1件/.test(h));
ok('顧問契約の締結の行（担当名つき）', /顧問契約 締結<\/span><span[^>]*>A社　山田（A@x\.jp）<\/span><span[^>]*>担当：佐藤<\/span>/.test(h));
ok('パートナー契約の締結の行（送付者つき）', /パートナー契約 締結<\/span><span[^>]*>高橋（np@x\.jp）<\/span><span[^>]*>送付：<\/span>/.test(h));
ok('契約を経た顧客の行は「締結」の日時', /締結 20\d\d-\d\d-\d\d \d\d:\d\d<\/span><span class="tag blue"[^>]*>顧客<\/span><span[^>]*>A社<\/span>/.test(h));
ok('契約を経ていない顧客の行は「登録」の日付', /登録 20\d\d-\d\d-\d\d<\/span><span class="tag blue"[^>]*>顧客<\/span><span[^>]*>B社<\/span>/.test(h));
ok('招待中の行に招いた人と「担当が付きます」', /招待中<\/span><span[^>]*>D社<\/span><span[^>]*>招待：鈴木（本人が登録した瞬間に担当が付きます）<\/span>/.test(h));
ok('締結の行は新しい順で、顧客の行より前', h.indexOf('顧問契約 締結') < h.indexOf('パートナー契約 締結') && h.indexOf('パートナー契約 締結') < h.indexOf('>顧客</span>'));
const h0 = M([{ id: 'c9', role: 'customer', company_name: 'D社', created_at: d(50), consultant_id: 'p1' }], nameOf, [], now, [], []);
ok('何も無ければその旨', /新しい登録と確認待ちはありません/.test(h0));
ok('created_at が無くても落ちない', /今日の動き/.test(M([{ id: 'z', role: 'customer' }], {}, [], now)));

// ③ 置き場と読み込み
ok('運営ダッシュボードの成長ロードマップの前に置き場（アンケートの集計を挟む）', /id="adm-moves"><\/div>'\s*\n\s*\+'<div id="adm-survey"><\/div>'\s*\n\s*\+'<div id="adm-plans"><\/div>'\s*\n\s*\+'<div id="adm-roadmap">/.test(SRC));
ok('loadAdmin が描く', /clientCount\[c\.consultant_id\]\|\|0\)\+1; \}\);\n\s*loadAdmMoves\(rows, nameOf\);/.test(SRC));
{
  const f = takeFn('loadAdmMoves');
  ok('口座は課金・契約の権限があるときだけ読む', /if\(adminCanSee\('sec-billing'\)\)\{[\s\S]*payout_account_pending/.test(f));
  ok('締結した契約と招待中を読む', /sb\.from\('contract_offers'\)\.select\('kind,email,status,agreed_at,agreed_name,agreed_org,offered_by,consultant_id'\)\.eq\('status','agreed'\)/.test(f) && /sb\.from\('customer_invites'\)\.select\('email,company_name,consultant_id,created_at,status'\)\.eq\('status','pending'\)/.test(f));
  ok('運営もお知らせ（agent_insights）を読む', /\n\s*loadAgentInsights\(\);\n\s*loadPlanRates\(\);[^\n]*\n\s*if\(adminCanSee\('sec-ep'\)\) loadEp\(\);/.test(SRC) && /id="agent-insights-box"><\/div>'\s*\n\s*\+'<div id="adm-moves">/.test(SRC));
}
{
  const SQL = fs.readFileSync(__dirname + '/../supabase/migrations/20260911010000_contract_notify.sql', 'utf8');
  ok('SQL：招待は運営でも付く', /role in \('consultant','admin'\)\) then\n\s*return 'error: 招いたパートナーが見つかりません'/.test(SQL));
  ok('SQL：契約の書き込みは運営も', /p\.role in \('consultant','admin'\)\)\n\s*and public\.ep_may_send_customer_contract\(\)/.test(SQL));
  ok('SQL：締結の知らせは送った人・担当・運営', /select o\.offered_by as u\n\s*union select o\.consultant_id\n\s*union select id from public\.profiles where role = 'admin'/.test(SQL));
  ok('SQL：知らせが失敗しても同意は通す', /perform public\.contract_notify_agreed\(o\.id\);\n\s*exception when others then\n\s*null;/.test(SQL));
  ok('SQL：知らせの関数は本人から呼べない', /revoke all on function public\.contract_notify_agreed\(uuid\) from public, anon, authenticated;/.test(SQL));
}
{
  const b = /var APP_BUILD='([^']+)';/.exec(SRC);
  const v = JSON.parse(fs.readFileSync(__dirname + '/../version.json', 'utf8'));
  ok('APP_BUILD と version.json が同じ', b && b[1] === v.build);
}
console.log('試験 ' + n + '件');
if (bad.length) { console.log('\n合わないもの ' + bad.length + '件:'); bad.forEach(b => console.log('  ✗ ' + b.name + '\n      出た: ' + b.got + '\n      欲しい: ' + b.want)); process.exit(1); }
console.log('ぜんぶ通りました。');
