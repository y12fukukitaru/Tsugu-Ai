// =============================================================
// 「はじめの90日（土台づくり）」と「伴走の1年」の試験
//
//   約束を一本化する：
//     ・「4週間で4つの成果物」のお約束カードを撤去（90日と食い違っていた）
//     ・導入90日プログラム → はじめの90日（土台づくり）。3つの節目は状態の言葉
//     ・伴走の1年（四半期の節目）を経営者・カルテ・顧客一覧に同じ言葉で
//     ・導入チェックリストの期限を4週→12週に
//
//  守りたいのは「約束の期日が一つであること」と「節目の判定（自動）が
//  変わっていないこと」。
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const MANP = fs.readFileSync(__dirname + '/../manual-partner.html', 'utf8');
const MANC = fs.readFileSync(__dirname + '/../manual-customer.html', 'utf8');

let n = 0, bad = [];
function is(name, got, want) {
  n++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) bad.push({ name, got: g, want: w });
}
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
function takeArr(name) {
  const i = SRC.indexOf('\n  var ' + name + '=[');
  if (i < 0) throw new Error('見つかりません: var ' + name);
  const end = SRC.indexOf('\n  ];', i);
  return SRC.slice(i, end + 5);
}
function takeVar(name) {
  const re = new RegExp('\\n  var ' + name + '\\s*=', 'g');
  let m, last = null;
  while ((m = re.exec(SRC)) !== null) last = m;
  const from = SRC.indexOf('=', last.index) + 1;
  const nl = SRC.indexOf('\n', from);
  return 'var ' + name + '=' + SRC.slice(from, nl).trim();
}
const base =
  'function esc(s){ return String(s==null?"":s).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];}); }' +
  takeArr('ONBOARD90') + takeArr('JOURNEY_Q') + takeVar('JOURNEY_YEAR') + takeVar('OB90_WINDOW') +
  takeFn('journeyPhase') + takeFn('journeyHtml') + takeFn('ob90Judge') + takeFn('ob90Waits') + takeFn('ob90Html') +
  takeFn('ob90Start') + takeFn('ob90Days');
const M = new Function(base + 'return {ONBOARD90:ONBOARD90,JOURNEY_Q:JOURNEY_Q,journeyPhase:journeyPhase,journeyHtml:journeyHtml,ob90Judge:ob90Judge,ob90Waits:ob90Waits,ob90Html:ob90Html,OB90_WINDOW:OB90_WINDOW};')();

// ---------------------------------------------------------------
// ① はじめの90日：節目の言葉と判定
// ---------------------------------------------------------------
is('3つの節目の題は「状態」の言葉', M.ONBOARD90.map(m => m.title), ['数字が見える', 'お金の流れが分かる', '1年の道筋が決まる']);
is('目安の日数は 30／60／90 のまま', M.ONBOARD90.map(m => m.day), [30, 60, 90]);
is('鍵は変えていない（判定と結びついている）', M.ONBOARD90.map(m => m.key), ['visualize', 'cost', 'roadmap']);
{
  const j = M.ob90Judge({ fin: 3, cash: 1, ins: 1, pay: 1, obr: 0 });
  is('判定は以前と同じ（可視化・棚卸しが揃い、報告書は未）', [j.visualize, j.cost, j.roadmap], [true, true, false]);
  const w = M.ob90Waits(j, { fin: 3 });
  is('資料があれば待ちではない。報告書は前の2つが揃えば待ちではない', [w.visualize, w.cost, w.roadmap], [false, false, false]);
  const w0 = M.ob90Waits(M.ob90Judge({ fin: 0, cash: 0, ins: 0, pay: 0, obr: 0 }), { fin: 0 });
  is('試算表ゼロなら全部「ご提供待ち」', [w0.visualize, w0.cost, w0.roadmap], [true, true, true]);
}
{
  const h = M.ob90Html(12, M.ob90Judge({ fin: 0, cash: 0, ins: 0, pay: 0, obr: 0 }), 'customer', { visualize: true, cost: true, roadmap: true });
  ok('経営者向けの見出しは「はじめの90日（土台づくり）」', /はじめの90日（土台づくり）/.test(h));
  ok('経営者向けは「成果を急ぐ期間ではなく土台を整える期間」と言う', /成果を急ぐ期間ではなく<b[^>]*>土台を整える期間<\/b>/.test(h));
  no('経営者向けに「成果物」の語が出ない', /成果物/.test(h));
  no('経営者向けに「4週間」が出ない', /4週間/.test(h));
  is('3つの節目が並ぶ', (h.match(/ご提供待ち/g) || []).length, 3);
  const hp = M.ob90Html(40, M.ob90Judge({ fin: 3, cash: 1, ins: 0, pay: 0, obr: 0 }), 'partner', {});
  ok('パートナー向けは「顧客の画面にも表示」と言う', /同じ内容が顧客の画面にも表示されています/.test(hp));
  ok('パートナー向けにも「成果を急がず」', /成果を急がず、90日で土台を整えます/.test(hp));
  ok('整った節目は「整いました」', /数字が見える<span[^>]*>整いました<\/span>/.test(hp));
  const hd = M.ob90Html(120, M.ob90Judge({ fin: 3, cash: 1, ins: 1, pay: 1, obr: 1 }), 'customer', {});
  ok('全部整うと「土台づくり 完了」と「ここからは伴走の1年」', /土台づくり 完了/.test(hd) && /ここからは伴走の1年です/.test(hd));
}

// ---------------------------------------------------------------
// ② 伴走の1年：節目の決めかた
// ---------------------------------------------------------------
is('四つの節目', M.JOURNEY_Q.map(x => x.title), ['土台づくり', '現金を増やす', '買い手の余力を測る', '次の1社の条件を決める']);
is('0日目は第1', [M.journeyPhase(0).q, M.journeyPhase(0).year], [1, 1]);
is('89日目はまだ第1', M.journeyPhase(89).q, 1);
is('91日目（91.25で切る）は第2', M.journeyPhase(92).q, 2);
is('182日目は第2', M.journeyPhase(182).q, 2);
is('183日目は第3', M.journeyPhase(183).q, 3);
is('274日目は第4', M.journeyPhase(274).q, 4);
is('364日目は第4', M.journeyPhase(364).q, 4);
is('365日目は2年目の第1', [M.journeyPhase(365).q, M.journeyPhase(365).year], [1, 2]);
is('null は0日目扱い', M.journeyPhase(null).q, 1);
is('負の日数も第1', M.journeyPhase(-5).q, 1);
is('札の言葉', M.journeyPhase(200).label, '第3の節目「買い手の余力を測る」');
is('2年目の札', M.journeyPhase(400).label, '2年目・第1の節目「土台づくり」');
ok('パートナー向けの各節目に3つのやること', M.JOURNEY_Q.every(x => x.partner.length === 3));
ok('第3にはゴールの言葉（準備度）', /買い手になる準備度/.test(M.JOURNEY_Q[2].partner.join('')));
ok('第4にはゴールの言葉（買いたい条件・関心・柱）', /買いたい条件/.test(M.JOURNEY_Q[3].partner[0]) && /関心を出す/.test(M.JOURNEY_Q[3].partner[1]) && /柱を1本増やす/.test(M.JOURNEY_Q[3].partner[2]));
{
  const hc = M.journeyHtml(200, 'customer');
  ok('帯の見出し', /伴走の1年/.test(hc));
  ok('いまの節目が出る', /いまは 買い手の余力を測る（開始から 200 日目）/.test(hc));
  is('四つの枠', (hc.match(/font-size:9\.5px;opacity:\.85;">第\d<\/div>/g) || []).length, 4);
  ok('経営者向けには節目の一文', /会社の値段と、次の1社を引き受ける余力を数字で知ります/.test(hc));
  no('経営者向けにパートナーのやることは出ない', /この節目でやること/.test(hc));
  ok('「半年から1年」の一文', /価値は半年から1年かけて積み上がります/.test(hc));
  const hp = M.journeyHtml(30, 'partner');
  ok('パートナー向けには「この節目でやること」', /この節目でやること/.test(hp));
  ok('第1のやることが3つ', (hp.match(/<li>/g) || []).length === 3 && /資料を預かる/.test(hp));
  const h2 = M.journeyHtml(400, 'customer');
  ok('2年目は「2年目・」を添える', /2年目・いまは 土台づくり/.test(h2));
}

// ---------------------------------------------------------------
// ③ 置き場：経営者の画面・カルテ・顧客一覧
// ---------------------------------------------------------------
{
  const f = takeFn('loadOnboard90');
  ok('経営者：土台の帯は期間内だけ、伴走の1年はずっと', /var showSetup=!\(days>OB90_WINDOW \|\| \(all && days>OB90_WINDOW\/2\)\);/.test(f) && /\(showSetup\?ob90Html\(days, judge, 'customer', ob90Waits\(judge, d\)\):''\)\+journeyHtml\(days,'customer'\)/.test(f));
  const g = takeFn('loadOnboard90Client');
  ok('カルテ：土台＋伴走の1年（パートナー向け）', /ob90Html\(days==null\?0:days, judge, 'partner', ob90Waits\(judge, d\)\)\+journeyHtml\(days==null\?0:days,'partner'\)/.test(g));
  //  顧客一覧の札
  const rl = takeFn('renderClientList');
  ok('顧客一覧は契約日から節目の札を付ける', /journeyPhase\(ob90Days\(String\(c\.created_at\)\.slice\(0,10\)\)\)/.test(rl));
  ok('一覧の読み込みで created_at を取る', /select\('id,email,company_name,role,stage,created_at'\)\.eq\('consultant_id',ME\)/.test(SRC));
  //  実際に描かせる
  const els = {};
  const d100 = new Date(Date.now() - 100 * 86400000).toISOString();
  const mod = new Function(
    base +
    'var CL_CACHE={clients:[{id:"a",email:"a@x",company_name:"A社",stage:1,created_at:' + JSON.stringify(d100) + '},{id:"b",email:"b@x",company_name:"B社",stage:1}],cnt:{},lastMsg:{},unread:{},maDeals:[]};' +
    'var CL_FILTER="all"; var SUB_IDS={}; var STAGE_NAMES={1:"導入"};' +
    'var els=arguments[0]; function $(id){ return els[id]||(els[id]={value:"",innerHTML:""}); }' +
    'function escJ(s){return String(s||"");} function jstMin(){return "";}' +
    'function pillarsOf(){ return {count:1,done:0,next:null}; }' +
    rl + 'renderClientList(); return els["cl-list"].innerHTML;'
  );
  const html = mod(els);
  ok('100日目の顧客には「第2 現金を増やす」の札', /tag gray">第2 現金を増やす<\/span>/.test(html));
  is('契約日が無い顧客には節目の札を付けない', (html.match(/>第\d /g) || []).length, 1);
}

// ---------------------------------------------------------------
// ④ 約束の一本化：4週間の約束を消す
// ---------------------------------------------------------------
no('お約束カード（4週間で4つ）の関数が無い', /function myPromiseCard\(/.test(SRC));
no('OBR_DAYS（4週間）が無い', /var OBR_DAYS=/.test(SRC));
{
  const f = takeFn('loadMyImpact');
  ok('金額が立つ前は何も出さない', /if\(!annual\)\{ box\.innerHTML=''; return; \}/.test(f));
}
ok('画面ツアーの文言は「はじめの90日」', /t:'導入診断報告書',\s*\n\s*b:'はじめの90日（土台づくり）の仕上げとして/.test(SRC));
{
  //  画面に出る文字列として「4週間」「導入90日プログラム」が残っていない（コメントは除く）
  //  「審査に2〜4週間」（融資の比較表）は約束ではないので除く
  const shown = SRC.split('\n').filter(l => /最初の4週間|4週間で|4つの成果物と|導入90日プログラム|最初のひと月/.test(l) && !/^\s*\/\//.test(l));
  is('画面に出る古い約束の残り', shown.map(l => l.trim().slice(0, 70)), []);
}
//  導入チェックリスト：4週 → 12週
{
  const steps = new Function(takeArr('ONBOARD_STEPS') + 'return ONBOARD_STEPS;')();
  is('期限は 2・4・8・12週', steps.map(s => s[1]), [14, 28, 56, 84]);
  is('12項目のまま', steps.reduce((a, s) => a + s[2].length, 0), 12);
  ok('確認文も12週', /STEP1:2週間後 → STEP4:12週間後（はじめの90日）/.test(SRC));
  ok('カルテの説明も12週', /期限は「はじめの90日（土台づくり）」に合わせて12週で組みます/.test(SRC));
}
ok('継ナビくんの経営者向け案内に「はじめの90日」と「伴走の1年」', /「はじめの90日（土台づくり）」＝最初の3か月は成果を急がず/.test(SRC) && /「伴走の1年」＝第1 土台づくり／第2 現金を増やす／第3 買い手の余力を測る／第4 次の1社の条件を決める/.test(SRC));

// ---------------------------------------------------------------
// ⑤ 説明書と版
// ---------------------------------------------------------------
ok('パートナー説明書：はじめの90日は土台づくり', /<h2>はじめの90日は「土台づくり」― 成果を急がない<\/h2>/.test(MANP));
ok('パートナー説明書：伴走の1年の頁', /<h2>伴走の1年 ― 四半期ごとの節目<\/h2>/.test(MANP) && /第3｜買い手の余力を測る/.test(MANP));
no('パートナー説明書に旧名が残っていない', /導入90日プログラム/.test(MANP));
ok('経営者説明書：はじめの90日は土台づくり', /<h2>はじめの90日は「土台づくり」です<\/h2>/.test(MANC));
ok('経営者説明書：伴走の1年の頁', /<h2>伴走の1年 ― 四つの節目<\/h2>/.test(MANC));
no('経営者説明書に旧名が残っていない', /導入90日プログラム/.test(MANC));
{
  const b = /var APP_BUILD='([^']+)';/.exec(SRC);
  const v = JSON.parse(fs.readFileSync(__dirname + '/../version.json', 'utf8'));
  ok('APP_BUILD と version.json が同じ', b && b[1] === v.build);
}

console.log('試験 ' + n + '件');
if (bad.length) {
  console.log('\n合わないもの ' + bad.length + '件:');
  bad.forEach(b => console.log('  ✗ ' + b.name + '\n      出た: ' + b.got + '\n      欲しい: ' + b.want));
  process.exit(1);
}
console.log('ぜんぶ通りました。');
