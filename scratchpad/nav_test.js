// =============================================================
// 左メニューの出し分けの試験
//
//  継ナビくんのパネルに「取り込んだ」ものはメニューから消します。
//  ただし sec-support は、同じIDでも役割が正反対なので、
//  運営のぶんだけはメニューに残っていないといけません。
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');

let n = 0, bad = [];
function is(name, got, want) {
  n++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) bad.push({ name, got: g, want: w });
}
function ok(name, cond) { is(name, !!cond, true); }
function no(name, cond) { is(name, !!cond, false); }

// ---- index.html から関数を取り出す（最後に定義されたものが実際に動く）----
function takeFn(name) {
  const re = new RegExp('\\n  function ' + name + '\\s*\\(', 'g');
  let m, last = null;
  while ((m = re.exec(SRC)) !== null) last = m;
  if (!last) throw new Error('見つかりません: ' + name);
  const end = SRC.indexOf('\n  }\n', last.index);
  if (end < 0) throw new Error('終わりが見つかりません: ' + name);
  return SRC.slice(last.index, end + 4);
}

const mod = new Function(
  "var KNV_ABSORBED=['sec-sec','sec-support','sec-knowledge'];" +
  takeFn('knvAbsorbed') +
  'return { knvAbsorbed, KNV_ABSORBED };'
)();

// =============================================================
// ① 運営のサポート管理は、メニューに残る
// =============================================================
//  ここが本題。運営の sec-support は「届いた相談・解約・契約を捌く」
//  管理画面で、パネルには本体が入っていない。消すと三手かかる
no('運営：サポート管理はメニューから消さない',
  mod.knvAbsorbed('admin').indexOf('sec-support') >= 0);
ok('運営：継ナビくん本体はメニューに出さない',
  mod.knvAbsorbed('admin').indexOf('sec-sec') >= 0);
ok('運営：ナレッジもメニューに出さない',
  mod.knvAbsorbed('admin').indexOf('sec-knowledge') >= 0);

// =============================================================
// ② パートナー・経営者は、これまでどおり
// =============================================================
//  パートナーの「運営サポート」は相談の窓口で、パネルに本体ごと
//  入っている。メニューにも出すと、同じものが二か所に出る
ok('パートナー：運営サポートはパネルに集約したまま',
  mod.knvAbsorbed('consultant').indexOf('sec-support') >= 0);
ok('パートナー：ナレッジもパネルのまま',
  mod.knvAbsorbed('consultant').indexOf('sec-knowledge') >= 0);
ok('経営者：これまでどおり',
  mod.knvAbsorbed('customer').indexOf('sec-support') >= 0);
is('パートナーの扱いは変えていない',
  mod.knvAbsorbed('consultant'), mod.KNV_ABSORBED);

// =============================================================
// ③ 元の一覧を壊していないこと
// =============================================================
//  filter は新しい配列を返すので、元の KNV_ABSORBED は減らない。
//  ここが破壊的だと、運営を一度描画したあとパートナーに切り替えたとき、
//  パートナーのメニューにも運営サポートが出てしまう
mod.knvAbsorbed('admin');
is('運営を描いても元の一覧は減らない', mod.KNV_ABSORBED.length, 3);
ok('元の一覧に sec-support が残っている',
  mod.KNV_ABSORBED.indexOf('sec-support') >= 0);

// =============================================================
// ④ メニューの定義そのもの
// =============================================================
ok('運営のメニュー定義にサポート管理がある',
  /\['sec-support','サポート管理'\]/.test(SRC));
ok('effectiveNav が役割ごとの一覧を使う',
  /var ab=knvAbsorbed\(r\);/.test(SRC));
ok('運営がサポート管理を開けること（権限）',
  /'sec-support': \['owner','coo','cto'\]/.test(SRC));

// =============================================================
// ⑤ 版
// =============================================================
const build = (SRC.match(/var APP_BUILD='([^']+)'/) || [])[1];
const vj = JSON.parse(fs.readFileSync(__dirname + '/../version.json', 'utf8'));
is('版が version.json と同じ', vj.build, build);

// =============================================================
console.log(n + ' 件中 ' + (n - bad.length) + ' 件 合格、' + bad.length + ' 件 不合格');
bad.forEach(b => console.log('  × ' + b.name + '\n      実際: ' + b.got + '\n    あるべき: ' + b.want));
process.exit(bad.length ? 1 : 0);
