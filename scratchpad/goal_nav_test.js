// =============================================================
// ゴール（顧問先が買い手になる）に画面を寄せた3点の試験
//
//   ① 各種シミュレーターを左メニューから外し、「本業と連携」から開く
//   ② 経営者の初回カード③を「買ったら？」に寄せる
//   ③ 「M&A活用」を「買い手になる」に改める
//
//  守りたいのは「外したのに、開けなくなっていないこと」。
//  メニューから消すだけなら一行で済むが、goSec で開けなくなると
//  研修の t3-2 と「価値の流れ」の「シミュレーターへ」が行き止まりになる。
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
  const re = new RegExp('\\n  function ' + name + '\\s*\\(', 'g');
  let m, last = null;
  while ((m = re.exec(SRC)) !== null) last = m;
  if (!last) throw new Error('見つかりません: ' + name);
  const end = SRC.indexOf('\n  }\n', last.index);
  if (end < 0) throw new Error('終わりが見つかりません: ' + name);
  return SRC.slice(last.index, end + 4);
}
function takeVar(name) {
  const re = new RegExp('\\n  var ' + name + '\\s*=', 'g');
  let m, last = null;
  while ((m = re.exec(SRC)) !== null) last = m;
  if (!last) throw new Error('見つかりません: var ' + name);
  const from = SRC.indexOf('=', last.index) + 1;
  const nl = SRC.indexOf('\n', from);
  return 'var ' + name + '=' + SRC.slice(from, nl).trim();
}

//  navDefs・effectiveNav を、外側の状態を差し替えて動かす
function menuFor(role, prefs) {
  const mod = new Function(
    'var ACCESS="";var EP_ME=null;' +
    'function adminNavAll(){ return [["sec-flow","ダッシュボード"],["sec-support","サポート管理"]]; }' +
    'function adminCanSee(){ return true; }' +
    'function loadPrefs(){ return ' + JSON.stringify(prefs || {}) + '; }' +
    takeVar('KNV_ABSORBED') +
    takeVar('NAV_TUCKED') +
    takeFn('navDefs') +
    takeFn('knvAbsorbed') +
    takeFn('navTucked') +
    takeFn('effectiveNav') +
    'return { all: navDefs(' + JSON.stringify(role) + ').map(function(x){return x[0];}),' +
    '         shown: effectiveNav(' + JSON.stringify(role) + ').map(function(x){return x[0];}) };'
  );
  return mod();
}

// ---------------------------------------------------------------
// ① 各種シミュレーター
// ---------------------------------------------------------------
const p = menuFor('consultant');
no('パートナーの左メニューに各種シミュレーターが無い', p.shown.indexOf('sec-sozoku') >= 0);
ok('navDefs には残っている（showSection がパネルを束ねるのに要る）', p.all.indexOf('sec-sozoku') >= 0);
ok('パネル自体は残っている', /id="sec-sozoku"/.test(SRC));
ok('「本業と連携」の中に入口がある',
   /goSec\(\\'sec-sozoku\\'\)[^>]*>各種シミュレーター<\/a>/.test(SRC));
//  入口が「本業と連携」パネルの中にあること。別の場所に紛れ込んでいないか
{
  const biz = SRC.indexOf('id="sec-biz"');
  const link = SRC.indexOf("goSec(\\'sec-sozoku\\')", biz);
  const next = SRC.indexOf('id="sec-clients"', biz);
  ok('入口は本業と連携の中（顧客管理より前）', biz > 0 && link > biz && link < next);
}
//  これまで開けていた導線が行き止まりになっていないこと
ok('研修 t3-2 は各種シミュレーターを開ける', /id:'t3-2'[\s\S]{0,200}sec:'sec-sozoku'/.test(SRC));
ok('「価値の流れ」の「シミュレーターへ」は生きている', /'シミュレーターへ','sec-sozoku'/.test(SRC));
//  ほかの役割は触っていない
const c = menuFor('customer');
is('経営者のメニューは各種シミュレーターと無関係', c.all.indexOf('sec-sozoku'), -1);
ok('取り込みの一覧（KNV_ABSORBED）は3つのまま', /var KNV_ABSORBED=\['sec-sec','sec-support','sec-knowledge'\];/.test(SRC));
//  設定で並び替えていても、外したものは戻ってこない
const p2 = menuFor('consultant', { nav: { consultant: { order: ['sec-sozoku', 'sec-flow'], hidden: [] } } });
no('設定の並び順に残っていても、メニューには出ない', p2.shown.indexOf('sec-sozoku') >= 0);
//  研修の疑似メニューからも消えている（実画面と食い違うと、研修が嘘になる）
no('研修の疑似メニューに各種シミュレーターが残っていない', /\['sozoku','各種シミュレーター'\]/.test(SRC));
ok('継ナビくんの案内が「本業と連携の中から開く」と言える',
   /本業と連携=[^／]*各種シミュレーター[^／]*この画面の中から開く/.test(SRC));
ok('説明書も「本業と連携」の中と書いてある', /各種シミュレーター<\/th><td>[^<]*<b>「本業と連携」の中<\/b>/.test(MANP));

// ---------------------------------------------------------------
// ② 初回カード③
// ---------------------------------------------------------------
{
  const m = /③ <a onclick="goSec\(\\'sec-value\\'\)"[^>]*>承継シミュレーション<\/a>([^']*)'/.exec(SRC);
  ok('初回カード③がある', !!m);
  const t = m ? m[1] : '';
  ok('③は「買ったら？」を体験する文', /この会社を買ったら？/.test(t));
  no('③に「いま譲るなら？」が残っていない', /譲るなら/.test(t));
  ok('③は買い手としての余力に触れている', /買い手としての余力/.test(t));
  ok('③の行き先は企業価値・試算結果のまま', /goSec\(\\'sec-value\\'\)/.test(m ? m[0] : ''));
}

// ---------------------------------------------------------------
// ③ M&A活用 → 買い手になる
// ---------------------------------------------------------------
is('経営者のメニューの名前', (c.all.indexOf('sec-ma') >= 0), true);
ok('メニューの文言が「買い手になる」', /\['sec-ma','買い手になる'\]/.test(SRC));
no('メニューに「M&A活用」が残っていない', /\['sec-ma','M&A活用'\]/.test(SRC));
ok('経営者パネルの見出しが「買い手になる」', /id="sec-ma"><div class="ph">買い手になる<\/div>/.test(SRC));
ok('説明文が「次の一社を引き受ける力」で始まる', /厚くなった地盤を、次の一社を引き受ける力に変えます/.test(SRC));
ok('パートナーのカルテの見出しも揃えた', /id="cs-mna"[^>]*>買い手になる提案（AI）<\/div>/.test(SRC));
no('カルテに「M&A活用提案」が残っていない', /M&A活用提案（AI）/.test(SRC));
ok('提案メモの題も揃えた', /var note='【買い手になるためのご提案】\\n';/.test(SRC));
ok('継ナビくんの経営者向け案内も揃えた', /買い手になる=会社・事業を譲り受ける方向性の提案/.test(SRC));
ok('営業ツールの関連機能名も揃えた', /feat:'買い手になる・Tsugime -結-'/.test(SRC));
no('古い名前「TsuguAiマーケット」が営業ツールに残っていない', /feat:'[^']*TsuguAiマーケット/.test(SRC));
ok('経営者の説明書も揃えた', /<th>買い手になる／Tsugime -結-/.test(MANC));
//  画面に出る文字列として「M&A活用」が残っていないこと（コメントとコードは除く）
{
  const shown = SRC.split('\n').filter(l => /M&A活用/.test(l) && !/^\s*\/\//.test(l) && !/loadMyMa|function |\/\/ ----/.test(l));
  is('画面に出る「M&A活用」の残り', shown.map(l => l.trim().slice(0, 60)), []);
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
