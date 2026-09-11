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
  takeArr('ONBOARD90') + takeArr('JOURNEY_Q') +
  takeFn('journeyStart') + takeFn('journeyPos') + takeFn('journeyYM') + takeFn('journeyPhase') + takeFn('journeyHtml') +
  takeFn('ob90Judge') + takeFn('ob90Remain') + takeFn('ob90Waits') + takeFn('ob90Html');
const M = new Function(base + 'return {ONBOARD90:ONBOARD90,JOURNEY_Q:JOURNEY_Q,journeyStart:journeyStart,journeyPos:journeyPos,journeyPhase:journeyPhase,journeyHtml:journeyHtml,ob90Judge:ob90Judge,ob90Remain:ob90Remain,ob90Waits:ob90Waits,ob90Html:ob90Html};')();
//  位置を月数で作る補助
function pos(mi, start){ return { mi: mi, pre: mi < 0, start: start || '2026-10-01' }; }

// ---------------------------------------------------------------
// ① はじめの90日：節目の言葉と判定
// ---------------------------------------------------------------
is('3つの節目の題は「状態」の言葉', M.ONBOARD90.map(m => m.title), ['数字が見える', 'お金の流れが分かる', '1年の道筋が決まる']);
is('目安は 1／2／3か月目', M.ONBOARD90.map(m => m.month), [1, 2, 3]);
is('鍵は変えていない（判定と結びついている）', M.ONBOARD90.map(m => m.key), ['visualize', 'cost', 'roadmap']);
{
  const j = M.ob90Judge({ fin: 3, cash: 1, ins: 1, pay: 1, obr: 0 });
  is('判定は以前と同じ（可視化・棚卸しが揃い、報告書は未）', [j.visualize, j.cost, j.roadmap], [true, true, false]);
  is('残りは題で返す', M.ob90Remain(j), ['1年の道筋が決まる']);
  const w = M.ob90Waits(j, { fin: 3 });
  is('資料があれば待ちではない。報告書は前の2つが揃えば待ちではない', [w.visualize, w.cost, w.roadmap], [false, false, false]);
  const w0 = M.ob90Waits(M.ob90Judge({ fin: 0, cash: 0, ins: 0, pay: 0, obr: 0 }), { fin: 0 });
  is('試算表ゼロなら全部「ご提供待ち」', [w0.visualize, w0.cost, w0.roadmap], [true, true, true]);
}
{
  const h = M.ob90Html(pos(0), M.ob90Judge({ fin: 0, cash: 0, ins: 0, pay: 0, obr: 0 }), 'customer', { visualize: true, cost: true, roadmap: true });
  ok('経営者向けの見出しは「はじめの90日（土台づくり）」', /はじめの90日（土台づくり）/.test(h));
  ok('経営者向けは「成果を急ぐ期間ではなく土台を整える期間」「翌月から3か月」', /成果を急ぐ期間ではなく<b[^>]*>土台を整える期間<\/b>/.test(h) && /翌月から3か月<\/b>/.test(h));
  ok('1か月目', /1か月目<\/span>/.test(h));
  no('経営者向けに「成果物」の語が出ない', /成果物/.test(h));
  no('経営者向けに「4週間」が出ない', /4週間/.test(h));
  is('3つの節目が並ぶ', (h.match(/ご提供待ち/g) || []).length, 3);
  const hp = M.ob90Html(pos(1), M.ob90Judge({ fin: 3, cash: 1, ins: 0, pay: 0, obr: 0 }), 'partner', {});
  ok('パートナー向けは「顧客の画面にも表示」と言う', /同じ内容が顧客の画面にも表示されています/.test(hp));
  ok('整った節目は「整いました」', /数字が見える<span[^>]*>整いました<\/span>/.test(hp));
  ok('2か月目に入れば1か月目の節目は「過ぎています（続けます）」', /目安の1か月目を過ぎています（続けます）/.test(M.ob90Html(pos(1), M.ob90Judge({ fin: 0, cash: 0, ins: 0, pay: 0, obr: 0 }), 'partner', {})));
  //  起点前＝準備期間
  const hpre = M.ob90Html(pos(-1, '2026-11-01'), M.ob90Judge({ fin: 0, cash: 0, ins: 0, pay: 0, obr: 0 }), 'customer', {});
  ok('準備期間の表示', /準備期間（2026年11月から）/.test(hpre));
  no('準備期間は期限超過にならない', /過ぎています/.test(hpre));
  //  3か月を過ぎても整わない＝継続中（並行）
  const hc = M.ob90Html(pos(4), M.ob90Judge({ fin: 3, cash: 1, ins: 0, pay: 0, obr: 0 }), 'customer', {});
  ok('4か月目で未完なら「土台づくり（継続中）」', /土台づくり（継続中）/.test(hc));
  ok('「次の四半期も並行して」と言う', /次の四半期も並行して<\/b>整えていきます/.test(hc));
  const hcp = M.ob90Html(pos(4), M.ob90Judge({ fin: 3, cash: 1, ins: 0, pay: 0, obr: 0 }), 'partner', {});
  ok('パートナー向けも「次の四半期の工程と並行」', /次の四半期の工程と並行して<\/b>続けます/.test(hcp));
  const hd = M.ob90Html(pos(2), M.ob90Judge({ fin: 3, cash: 1, ins: 1, pay: 1, obr: 1 }), 'customer', {});
  ok('全部整うと「土台づくり 完了」と「ここからは伴走の1年」', /土台づくり 完了/.test(hd) && /ここからは伴走の1年です/.test(hd));
}

// ---------------------------------------------------------------
// ② 伴走の1年：起点と節目の決めかた
// ---------------------------------------------------------------
is('起点は契約の翌月1日', M.journeyStart({ created_at: '2026-09-12T03:00:00Z' }), '2026-10-01');
is('12月契約なら翌年1月', M.journeyStart({ created_at: '2026-12-30' }), '2027-01-01');
is('1日契約でも翌月', M.journeyStart({ created_at: '2026-09-01' }), '2026-10-01');
is('onboard_start があればそちら', M.journeyStart({ created_at: '2026-01-01', onboard_start: '2026-09-15' }), '2026-10-01');
is('契約日が無ければ null', M.journeyStart({}), null);
{
  const p0 = M.journeyPos('2026-10-01', new Date(2026, 9, 15));
  is('起点の月は0か月目', [p0.mi, p0.pre], [0, false]);
  const pPre = M.journeyPos('2026-10-01', new Date(2026, 8, 20));
  is('起点前は準備期間', [pPre.mi, pPre.pre], [-1, true]);
  is('2027年1月は3か月目（第2）', M.journeyPos('2026-10-01', new Date(2027, 0, 3)).mi, 3);
  is('翌年10月は12か月目（2年目）', M.journeyPos('2026-10-01', new Date(2027, 9, 1)).mi, 12);
  is('起点が無ければ0', M.journeyPos(null, new Date()).mi, 0);
}
is('四つの節目', M.JOURNEY_Q.map(x => x.title), ['土台づくり', '現金を増やす', '買い手の余力を測る', '次の1社の条件を決める']);
is('0か月目は第1', [M.journeyPhase(pos(0)).q, M.journeyPhase(pos(0)).year], [1, 1]);
is('2か月目はまだ第1（3か月目）', [M.journeyPhase(pos(2)).q, M.journeyPhase(pos(2)).monthInQ], [1, 3]);
is('3か月目は第2の1か月目', [M.journeyPhase(pos(3)).q, M.journeyPhase(pos(3)).monthInQ], [2, 1]);
is('6か月目は第3', M.journeyPhase(pos(6)).q, 3);
is('9か月目は第4', M.journeyPhase(pos(9)).q, 4);
is('11か月目は第4', M.journeyPhase(pos(11)).q, 4);
is('12か月目は2年目の第1', [M.journeyPhase(pos(12)).q, M.journeyPhase(pos(12)).year], [1, 2]);
is('準備期間は第1', [M.journeyPhase(pos(-1)).q, M.journeyPhase(pos(-1)).pre], [1, true]);
is('null でも落ちない', M.journeyPhase(null).q, 1);
is('札の言葉', M.journeyPhase(pos(7)).label, '第3の節目「買い手の余力を測る」');
is('2年目の札', M.journeyPhase(pos(13)).label, '2年目・第1の節目「土台づくり」');
is('四半期の暦の範囲', M.journeyPhase(pos(4, '2026-10-01')).range, '2027年1月〜2027年3月');
ok('パートナー向けの各節目に3つのやることと3つの検証', M.JOURNEY_Q.every(x => x.partner.length === 3 && x.review.length === 3));
ok('第1の検証は「整わなければ次の四半期も並行」', /次の四半期も並行/.test(M.JOURNEY_Q[0].review[0]));
ok('第3にはゴールの言葉（準備度）', /買い手になる準備度/.test(M.JOURNEY_Q[2].partner.join('')));
ok('第4にはゴールの言葉（買いたい条件・関心・柱）', /買いたい条件/.test(M.JOURNEY_Q[3].partner[0]) && /関心を出す/.test(M.JOURNEY_Q[3].partner[1]) && /柱を1本増やす/.test(M.JOURNEY_Q[3].partner[2]));
{
  const hc = M.journeyHtml(pos(7, '2026-10-01'), 'customer', []);
  ok('帯の見出し', /伴走の1年/.test(hc));
  ok('いまの節目と暦', /いまは 買い手の余力を測る（2か月目・2027年4月〜2027年6月）/.test(hc));
  is('四つの枠', (hc.match(/font-size:9\.5px;opacity:\.85;">第\d<\/div>/g) || []).length, 4);
  ok('経営者向けには節目の一文と振り返り', /会社の値段と、次の1社を引き受ける余力を数字で知ります/.test(hc) && /四半期の終わりに、担当パートナーと一緒に振り返ります：企業価値（今いくらの会社か）を出したか/.test(hc));
  no('経営者向けにパートナーのやることは出ない', /この節目でやること/.test(hc));
  ok('「3か月ごとに検証」の一文', /3か月ごとに検証し、次の3か月を走ります/.test(hc));
  const hp = M.journeyHtml(pos(1, '2026-10-01'), 'partner', []);
  ok('パートナー向けには「この節目でやること」と「検証すること」', /この節目でやること/.test(hp) && /この四半期の終わりに検証すること/.test(hp));
  ok('第1のやることが3つ＋検証3つ', (hp.match(/<li>/g) || []).length === 6 && /資料を預かる/.test(hp));
  //  土台が残ったまま第2に入った
  const hr = M.journeyHtml(pos(4, '2026-10-01'), 'partner', ['お金の流れが分かる', '1年の道筋が決まる']);
  ok('「土台づくり 継続中（並行）」の札', /土台づくり 継続中（並行）/.test(hr));
  ok('やることの先頭に土台の残り', /<li><b>土台の残り：<\/b>お金の流れが分かる・1年の道筋が決まる（並行して続ける）<\/li>/.test(hr));
  const hrc = M.journeyHtml(pos(4, '2026-10-01'), 'customer', ['1年の道筋が決まる']);
  ok('経営者向けにも「並行して続けます」', /土台づくり（1年の道筋が決まる）も、この四半期に並行して続けます/.test(hrc));
  no('第1のあいだは「継続中」を出さない', /継続中/.test(M.journeyHtml(pos(1, '2026-10-01'), 'partner', ['1年の道筋が決まる'])));
  const hpre = M.journeyHtml(pos(-1, '2026-11-01'), 'partner', []);
  ok('準備期間の帯', /準備期間（2026年11月から第1の節目）/.test(hpre) && /起点は翌月の1日です/.test(hpre));
  const h2 = M.journeyHtml(pos(13, '2026-10-01'), 'customer', []);
  ok('2年目は「2年目・」を添える', /2年目・いまは 土台づくり/.test(h2));
}

// ---------------------------------------------------------------
// ③ 置き場：経営者の画面・カルテ・顧客一覧
// ---------------------------------------------------------------
{
  const f = takeFn('loadOnboard90');
  ok('経営者：土台の帯は整うまで（整えば第1のあいだだけ）、伴走の1年はずっと', /var showSetup=!all \|\| \(pos\.mi<3\);/.test(f) && /\(showSetup\?ob90Html\(pos, judge, 'customer', ob90Waits\(judge, d\)\):''\)\+journeyHtml\(pos,'customer',ob90Remain\(judge\)\)/.test(f));
  ok('経営者：起点は journeyStart', /var start=journeyStart\(prof\);/.test(f));
  const g = takeFn('loadOnboard90Client');
  ok('カルテ：土台＋伴走の1年（パートナー向け・土台の残りつき）', /ob90Html\(pos, judge, 'partner', ob90Waits\(judge, d\)\)\+journeyHtml\(pos,'partner',ob90Remain\(judge\)\)/.test(g));
  //  顧客一覧の札
  const rl = takeFn('renderClientList');
  ok('顧客一覧は契約日の翌月起点で節目の札を付ける', /journeyPhase\(journeyPos\(journeyStart\(c\)\)\)/.test(rl));
  ok('一覧の読み込みで created_at を取る', /select\('id,email,company_name,role,stage,created_at'\)\.eq\('consultant_id',ME\)/.test(SRC));
  //  実際に描かせる
  const els = {};
  //  5か月前の契約→翌月起点で4か月目＝第2
  const t5 = new Date(); t5.setMonth(t5.getMonth() - 5); const d100 = t5.toISOString();
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
  ok('5か月前に契約した顧客には「第2 現金を増やす」の札', /tag gray">第2 現金を増やす<\/span>/.test(html));
  is('契約日が無い顧客には節目の札を付けない', (html.match(/>第\d /g) || []).length, 1);
}

// ---------------------------------------------------------------
// ③' 今日やることが空のとき「今月の伴走」
// ---------------------------------------------------------------
{
  const rt = takeFn('renderTodos');
  const els = {};
  const t5 = new Date(); t5.setMonth(t5.getMonth() - 5); const d100 = t5.toISOString();
  const mod = new Function(
    base +
    'var CL_CACHE={clients:[{id:"a",email:"a@x",company_name:"A社",created_at:' + JSON.stringify(d100) + '},{id:"b",email:"b@x",company_name:"B社"}]};' +
    'function buildTodos(){ return {}; }' +
    'var els=arguments[0]; function $(id){ return els[id]||(els[id]={innerHTML:""}); }' +
    'function escJ(s){return String(s||"");}' +
    rt + 'renderTodos(); return els["todo-list"].innerHTML;'
  );
  const html = mod(els);
  ok('順調の一文は残る', /今日対応が必要な顧客はありません/.test(html));
  ok('空のときは「今月の伴走」が続く', /今月の伴走（節目ごとの一手）/.test(html));
  ok('A社は第2の節目と、その最初のやること', /A社[\s\S]*第2 現金を増やす[\s\S]*棚卸しで見つけた見直しを実行に移す/.test(html));
  ok('契約日が無いB社は第1（0日目扱い）', /B社[\s\S]*第1 土台づくり[\s\S]*資料を預かる/.test(html));
  is('顧客ごとに1枚', (html.match(/カルテの台本へ →/g) || []).length, 2);
  //  対応があるときは従来どおり（今月の伴走は出さない）
  const mod2 = new Function(
    base +
    'var CL_CACHE={clients:[{id:"a",email:"a@x",company_name:"A社"}]};' +
    'function buildTodos(){ return {a:{score:80,tags:["<span>未読</span>"]}}; }' +
    'var els=arguments[0]; function $(id){ return els[id]||(els[id]={innerHTML:""}); }' +
    'function escJ(s){return String(s||"");}' +
    rt + 'renderTodos(); return els["todo-list"].innerHTML;'
  );
  no('対応があるときは今月の伴走を出さない', /今月の伴走/.test(mod2({})));
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
ok('継ナビくんの経営者向け案内に「翌月から3か月」「並行」「四半期の終わり」', /契約の翌月から3か月は成果を急がず/.test(SRC) && /次の四半期も並行して続ける/.test(SRC) && /四半期の終わりに何を振り返るか/.test(SRC));
ok('継ナビくんのパートナー向け案内にカルテの台本とナビ', /「今月の面談台本」\(その会社の数字から/.test(SRC) && /「継ナビくんのナビ」\(土台→現金→余力→条件の順番と、済／次／あと\)/.test(SRC));

// ---------------------------------------------------------------
// ⑤ 説明書と版
// ---------------------------------------------------------------
ok('パートナー説明書：翌月から3か月、できるまで続ける', /<h2>はじめの90日は「土台づくり」― 翌月から3か月、できるまで続ける<\/h2>/.test(MANP) && /3か月で整わなければ、次の四半期も土台づくりを続けます/.test(MANP));
ok('パートナー説明書：伴走の1年の頁（検証つき）', /<h2>伴走の1年 ― 四半期ごとの節目と検証<\/h2>/.test(MANP) && /第3｜買い手の余力を測る（7〜9か月目）/.test(MANP) && /暦の月で3か月ずつ/.test(MANP));
ok('パートナー説明書：継ナビくんのナビの頁', /<h2>カルテの「継ナビくんのナビ」― 道具をやる順番<\/h2>/.test(MANP));
no('パートナー説明書に旧名が残っていない', /導入90日プログラム/.test(MANP));
ok('経営者説明書：はじめの90日は土台づくり', /<h2>はじめの90日は「土台づくり」です<\/h2>/.test(MANC));
ok('経営者説明書：伴走の1年の頁（翌月1日・振り返り）', /<h2>伴走の1年 ― 四つの節目<\/h2>/.test(MANC) && /ご契約の翌月1日から、暦の月で3か月ずつ/.test(MANC) && /3か月で整わなかった節目は、次の3か月も並行して続けます/.test(MANC));
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
