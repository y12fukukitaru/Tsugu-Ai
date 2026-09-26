// =============================================================
// 資格の確認と、禁止行為ガイドライン④の試験（2026-09-26）
//   ① 選んだ領域のうち、運営が確認済みにしたもの（とIT・自動化）だけが「実行できる領域」
//   ② 登録番号か写しが無いものは「番号か写しを出してください」。以前の自己申告の仮番号も同じ
//   ③ 専門家ネットワークの実行体制は、確認済みの資格だけを数える（表が無ければ自己申告のまま）
//   ④ SQL：本人が出すと必ず確認待ちに戻る・確認済みにできるのは運営だけ・写しは非公開
//   ⑤ ガイドライン④：本業の報酬を、本人の事務所・所属会社として受け取るのは対象外
//   ⑥ 説明書・継ナビくんの知識も同じことを言う
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const SQL = R('supabase/migrations/20260926000000_partner_licenses.sql');
const MANP = R('manual-partner.html'), MANA = R('manual-admin.html');
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
  return SRC.slice(last.index, SRC.indexOf('\n  }\n', last.index) + 4);
}
function takeBlock(name) {
  const i = SRC.indexOf('\n  var ' + name + '=');
  if (i < 0) throw new Error('見つかりません: ' + name);
  return SRC.slice(i, SRC.indexOf(';\n', i) + 2);
}
const ESC = 'function esc(s){ return String(s==null?"":s).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];}); }'
  + 'function escA(s){ return esc(s); }';
const L = new Function(ESC
  + takeBlock('BIZ_FIELDS') + takeBlock('LIC') + takeBlock('LIC_PLACEHOLDER') + takeBlock('LIC_ST')
  + 'var NET={ partners:[], lics:[], names:{} }, NET_ERR={};'
  + takeFn('bizFieldName') + takeFn('licNeeds') + takeFn('licHasEvidence') + takeFn('licStatus')
  + takeFn('licExecFields') + takeFn('licRowsHtml') + takeFn('netExecLicenses')
  + 'return { LIC:LIC, NET:NET, NET_ERR:NET_ERR, licStatus:licStatus, licExecFields:licExecFields, licRowsHtml:licRowsHtml, netExecLicenses:netExecLicenses,'
  + ' setErr:function(v){ NET_ERR.lc=v; } };'
)();

// ① ② 状態と、実行できる領域
{
  L.LIC.remote = true;
  L.LIC.rows = {
    insurance: { field: 'insurance', reg_no: '12345', status: 'approved' },
    realestate: { field: 'realestate', reg_no: '', file_path: 'u/realestate_1.pdf', status: 'pending' },
    tax: { field: 'tax', reg_no: '（未提出）', status: 'pending' },
    legal: { field: 'legal', reg_no: '999', status: 'rejected', note: '番号が見つかりません' }
  };
  is('確認済み', L.licStatus('insurance'), 'approved');
  is('写しだけでも確認待ち', L.licStatus('realestate'), 'pending');
  is('以前の自己申告（仮番号）は「出してください」', L.licStatus('tax'), 'missing');
  is('差し戻し', L.licStatus('legal'), 'rejected');
  is('行が無ければ「出してください」', L.licStatus('labor'), 'missing');
  is('IT・自動化は確認不要', L.licStatus('it'), 'free');
  const lic = ['insurance', 'realestate', 'tax', 'legal', 'labor', 'it'];
  is('実行できるのは確認済みとITだけ', L.licExecFields(lic).map(f => f.id), ['insurance', 'it']);
  is('選んでいない領域は、確認済みでも実行できる領域に入らない', L.licExecFields(['realestate']).map(f => f.id), []);
  const h = L.licRowsHtml(lic);
  ok('確認の行：保険は「確認済み」', /保険[\s\S]*?確認済み/.test(h));
  ok('確認の行：差し戻しの理由が出る', /運営より：番号が見つかりません/.test(h));
  ok('確認の行：仮番号は入力欄に出さない', !/value="（未提出）"/.test(h));
  ok('確認の行：写しの名前か「資格証」が出る', /licOpenFile\('u\/realestate_1\.pdf'\)/.test(h));
  no('確認の行：IT・自動化の行は出ない', /lic-no-it"/.test(h));
  ok('確認の行：未提出は「確認を依頼する」', /licSubmit\('labor'\)">確認を依頼する/.test(h));
  L.LIC.remote = false;
  ok('表が無いときは準備中の案内', /資格の確認の受付を準備しています/.test(L.licRowsHtml(lic)));
  L.LIC.remote = true;
}
// ③ 専門家ネットワークの実行体制
{
  L.NET.lics = [
    { user_id: 'p1', field: 'insurance', status: 'approved' },
    { user_id: 'p1', field: 'tax', status: 'pending' },
    { user_id: 'p2', field: 'insurance', status: 'rejected' }
  ];
  is('確認済みとITだけを数える', L.netExecLicenses({ user_id: 'p1', licenses: 'insurance,tax,it' }), ['insurance', 'it']);
  is('他の人の確認済みは数えない', L.netExecLicenses({ user_id: 'p2', licenses: 'insurance' }), []);
  L.setErr('relation does not exist');
  is('表が無いときは自己申告のまま', L.netExecLicenses({ user_id: 'p2', licenses: 'insurance' }), ['insurance']);
  L.setErr(undefined);
}
// 画面のつなぎ
ok('本業と連携の読み込みで資格も読む', /await bizLoad\(\); await refLoad\(\); await licLoad\(\); renderBiz\(\);/.test(SRC));
ok('あなたが実行する領域は licExecFields で決める', /var mine=SELF_EXEC_OK \? licExecFields\(P\.lic\)/.test(SRC));
ok('確認待ちの領域を分けて出す', /確認待ち：'\+waiting\.map/.test(SRC));
ok('写しは license-docs に本人のIDのフォルダで置く', /var path=ME\+'\/'\+id\+'_'\+Date\.now\(\)/.test(SRC) && /storage\.from\('license-docs'\)\.upload/.test(SRC));
ok('運営の確認：専門家ネットワークに「⓪ 資格の確認」', /⓪ 資格の確認/.test(SRC) && /h\+=netLicHtml\(\);/.test(SRC));
ok('運営の確認：確認済み・差し戻しを書き込む', /update\(\{ status:ok\?'approved':'rejected'/.test(SRC));
ok('実行体制は netExecLicenses で数える', /netExecLicenses\(p\)\.forEach/.test(SRC));
ok('今日の動きに「確認待ちの資格」', /chip\('確認待ちの資格'/.test(SRC) && /admMovesHtml\(rows, nameOf, pending, new Date\(\), contracts, invites, licPend\)/.test(SRC));

// ④ SQL
{
  ok('SQL：表 partner_licenses', /create table if not exists public\.partner_licenses/.test(SQL));
  ok('SQL：状態は3つ', /check \(status in \('pending','approved','rejected'\)\)/.test(SQL));
  ok('SQL：番号か写しのどちらかが要る', /partner_licenses_evidence_check/.test(SQL));
  ok('SQL：本人が出すと確認待ちに戻す', /new\.status\s*:= 'pending';/.test(SQL) && /new\.reviewed_by\s*:= null;/.test(SQL));
  ok('SQL：運営だけは確認済みにできる', /if public\.ep_is_admin\(\) then/.test(SQL));
  ok('SQL：本人は運営のひとことを書き換えられない', /if tg_op = 'UPDATE' then new\.note := old\.note;/.test(SQL));
  ok('SQL：本人の書き込みは pending だけ', (SQL.match(/user_id = auth\.uid\(\) and status = 'pending'/g) || []).length === 2);
  ok('SQL：RLS 有効', /alter table public\.partner_licenses enable row level security;/.test(SQL));
  ok('SQL：写しのバケットは非公開', /values \('license-docs', 'license-docs', false\)/.test(SQL) && /do update set public = false/.test(SQL));
  ok('SQL：写しは本人のフォルダだけに置ける', /\(storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text\);/.test(SQL));
  ok('SQL：写しを読めるのは本人と運営', /or public\.ep_is_admin\(\)\)\);/.test(SQL));
  ok('SQL：以前の自己申告を確認待ちで取り込む（ITは除く）', /on conflict \(user_id, field\) do nothing;/.test(SQL) && !/'it'\)\s*\n\s*on conflict/.test(SQL));
  ok('SQL：何度流しても同じ', /何度流しても同じ結果になります/.test(SQL) && /drop policy if exists "partner_licenses admin all"/.test(SQL));
  ok('画面の仮番号と SQL の仮番号が同じ', /var LIC_PLACEHOLDER='（未提出）'/.test(SRC) && /'（未提出）'/.test(SQL));
}
// ⑤ ガイドライン④
{
  ok('④：当社の業務の対価の直接授受は禁止のまま', /<b>当社の業務の対価<\/b>を、顧客から直接受け取ること/.test(SRC));
  ok('④：本業の報酬を本人の事務所・所属会社として受け取るのは対象外', /<b>ご自身の事務所・所属会社（代理店など）として<\/b>、それぞれの業法に沿って受け取るのは、この禁止の対象外です/.test(SRC));
  no('④：「正規ルート（当社の請求）外での報酬受領」の一律の禁止は残っていない', /正規ルート（当社の請求）外での報酬受領/.test(SRC));
  ok('補足：運営が確認した領域に限る', /本業と連携で登録番号か資格証の写しを出し、運営が確認した領域<\/b>に限ります/.test(SRC));
}
// ⑥ 説明書・継ナビくん
{
  ok('パートナー説明書：資格の確認の手順', /<b>資格の確認<\/b>を依頼する/.test(MANP) && /登録番号か資格証の写し<\/b>（どちらか一つ）/.test(MANP));
  ok('パートナー説明書：禁止行為の要点も本業の報酬は対象外', /本業の報酬<\/b>を、ご自身の事務所・所属会社として受け取るのは対象外/.test(MANP));
  ok('運営説明書：資格の確認', /<b>資格の確認<\/b>（パートナーが出した登録番号・資格証の写しを確かめ/.test(MANA));
  ok('運営説明書：今日の動きは7つ', /今日の動き（7つの数字）/.test(MANA) && /確認待ちの資格<\/b>/.test(MANA));
  ok('継ナビくん：確認済みの領域だけが実行できる', /運営が確認済みにした領域だけが、ご自身の本業として実行できる領域になる/.test(SRC));
}

if (bad.length) { bad.forEach(b => console.log('NG', b.name, '\n   got ', b.got, '\n   want', b.want)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK ' + n + ' checks, 0 failed');
