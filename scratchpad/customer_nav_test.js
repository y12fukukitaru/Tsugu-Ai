// =============================================================
// ⑩ 経営者のメニューを「買い手になる」一枠に束ねる試験
//
//   Tsugime -結- を経営者の左メニューから外し、「買い手になる」の
//   画面の下半分に束ねる。showSection は navDefs に無いパネルを直前の
//   項目に合流させるので、メニューから外すだけで束なる。
//
//  守りたいのは「外したのに開けなくなっていないこと」と、
//  「束ねた先が本当に『買い手になる』であること」。
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
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
  const re = new RegExp('\\n  function ' + name + '\\s*\\(', 'g');
  let m, last = null;
  while ((m = re.exec(SRC)) !== null) last = m;
  if (!last) throw new Error('見つかりません: ' + name);
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
const NAV = new Function(
  'var ACCESS="";var EP_ME=null;' +
  'function adminNavAll(){ return [["sec-flow","ダッシュボード"]]; } function adminCanSee(){ return true; }' +
  'function loadPrefs(){ return {}; }' +
  takeVar('KNV_ABSORBED') + takeVar('NAV_TUCKED') +
  'function planOf(p){ return (p&&p.plan==="seller")?"seller":"buyer"; } function planTag(p){ return ""; } var window={__prof:{}};' +
  takeFn('navDefs') + takeFn('knvAbsorbed') + takeFn('navTucked') + takeFn('effectiveNav') +
  'return { navDefs:navDefs, effectiveNav:effectiveNav };'
)();

// ---------------------------------------------------------------
// ① メニュー
// ---------------------------------------------------------------
const cust = NAV.navDefs('customer').map(x => x[0]);
const shown = NAV.effectiveNav('customer').map(x => x[0]);
no('経営者の navDefs に Tsugime の枠が無い', cust.indexOf('sec-market') >= 0);
no('経営者の左メニューにも無い', shown.indexOf('sec-market') >= 0);
ok('「買い手になる」は残っている', cust.indexOf('sec-ma') >= 0);
is('経営者のメニューは11項目（出口の設計・買った後に備える・継ナビくん含む。買い手プラン）', cust.length, 11);
is('経営者のメニューの並び（出口の設計は買い手になるの前）', cust, ['sec-flow', 'sec-reports', 'sec-mypdca', 'sec-billpay', 'sec-cash', 'sec-value', 'sec-ai', 'sec-exit', 'sec-ma', 'sec-after', 'sec-sec']);
ok('パートナーの Tsugime は残っている（申請する側）', NAV.navDefs('consultant').map(x => x[0]).indexOf('sec-market') >= 0);
ok('顧問税理士の入力画面は変えていない', JSON.stringify(new Function(
  'var ACCESS="finance";var EP_ME=null;' + takeFn('navDefs') + 'return navDefs("customer");'
)()) === JSON.stringify([['sec-flow', '月次数字の入力']]));

// ---------------------------------------------------------------
// ② 束ね先（showSection と同じ決めかたで）
// ---------------------------------------------------------------
{
  //  経営者の画面のパネルを、並び順のまま拾う
  const a = SRC.indexOf("else if(eff==='customer'){");
  const b = SRC.indexOf("} else if(eff==='consultant'){", a);
  ok('経営者の画面の範囲が取れる', a > 0 && b > a);
  const panels = [];
  const re = /class="panel" id="(sec-[a-z0-9]+)"/g; let m;
  const part = SRC.slice(a, b);
  while ((m = re.exec(part)) !== null) panels.push(m[1]);
  ok('sec-market のパネルは経営者の画面に残っている', panels.indexOf('sec-market') >= 0);
  //  showSection と同じ：navDefs にある id が来るたびに「いまの組」が変わる
  const navIds = {}; cust.forEach(id => navIds[id] = 1);
  let cur = null; const grp = {};
  panels.forEach(id => { if (navIds[id]) cur = id; grp[id] = cur; });
  is('Tsugime のパネルは「買い手になる」の組に入る', grp['sec-market'], 'sec-ma');
  is('sec-market は sec-ma の直後（間に別の項目が挟まらない）', panels[panels.indexOf('sec-ma') + 1], 'sec-market');
  is('試算結果が企業価値の組に入るのと同じ仕組み', grp['sec-ins'], 'sec-value');
  //  goSec('sec-market') は経営者でも別の場所へ逸らされない
  const g = takeFn('goSec');
  no('goSec は sec-market を横取りしない', /sec-market/.test(g));
  ok('goSec は showSection に渡す', /showSection\(id\);/.test(g));
}

// ---------------------------------------------------------------
// ③ 画面の中の入口と案内
// ---------------------------------------------------------------
{
  const i = SRC.indexOf('id="sec-ma"><div class="ph">買い手になる</div>');
  const j = SRC.indexOf('id="sec-market"', i);
  const ma = SRC.slice(i, j);
  ok('「買い手になる」の冒頭に案件への入口がある', /goSec\(\\'sec-market\\'\)[^>]*>案件を見る（Tsugime -結-）↓<\/a>/.test(ma));
  ok('入口は柱の絵より前', ma.indexOf("goSec(\\'sec-market\\')") < ma.indexOf('id="my-pillar"'));
  ok('継ナビくんの案内が「同じ画面の下半分」と言える', /同じ画面の下半分が Tsugime -結-（投資・融資・M&A）=マッチング掲載\(左メニューには無い/.test(SRC));
  no('継ナビくんの案内に古い「／Tsugime -結-（投資・融資・M&A）=」の区切りが残っていない', /提案もここ／Tsugime -結-/.test(SRC));
  ok('説明書が「左メニューは一枠」と言う', /<b>左メニューは「買い手になる」の一枠<\/b>で、Tsugime -結- の案件はこの画面の<b>下半分<\/b>/.test(MANC));
  //  「価値の流れ」の経営者の飛び先は sec-ma のまま（束ね先そのもの）
  ok('価値の流れの⑤は買い手になるへ', /\['5','次の投資','M&A・HD化で成長','M&Aを見る','sec-ma'/.test(SRC));
}

// ---------------------------------------------------------------
// ④ 版
// ---------------------------------------------------------------
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
