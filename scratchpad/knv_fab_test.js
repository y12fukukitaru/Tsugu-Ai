// =============================================================
// 継ナビくんの呼び出し口と「外側を押したら閉じる」の試験
//
//  ここで守りたいのは二つです。
//
//   ① 呼び出し口が、押せるものに見える大きさと位置にあること。
//      画面の隅にぴたりと寄っていると「閉じる」に見えて押されません。
//      小さい画面では逆に本文を隠すので、そこは元の大きさに戻すこと。
//
//   ② 外側を押したら閉じるが、**閉じてはいけない場所では閉じないこと。**
//      いちばん怖いのは、開いたその一押しで閉じてしまうことと、
//      パネルの中から開いた予定の小窓を読もうとした瞬間に
//      土台ごと消えることです。どちらも「壊れている」と受け取られます。
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
  const oneLine = SRC.slice(from, nl);
  if (oneLine.trim().endsWith(';')) return 'var ' + name + '=' + oneLine.trim();
  const end = SRC.indexOf('\n  ];', last.index);
  return 'var ' + name + '=' + SRC.slice(from, end + 4);
}

// ---------------------------------------------------------------
// ① 見た目：呼び出し口の大きさと位置
// ---------------------------------------------------------------
//  CSSはブラウザが無いと実際には試せないので、宣言そのものを読む。
//  数字を直したのに片方だけ直し忘れる、という取りこぼしを止めるのが狙い
function ruleOf(sel, from) {
  const at = SRC.indexOf('\n  ' + sel + '{', from || 0);
  if (at < 0) throw new Error('CSSが見つかりません: ' + sel);
  const end = SRC.indexOf('}', at);
  return SRC.slice(at, end);
}
function px(rule, prop) {
  const m = new RegExp('(?:^|[;{\\s])' + prop + ':(-?[0-9.]+)px').exec(rule);
  return m ? Number(m[1]) : null;
}

const fab = ruleOf('.knv-fab');
const fabSvg = ruleOf('.knv-fab svg');
const panel = ruleOf('.knv-panel');

is('PC：呼び出し口の幅', px(fab, 'width'), 88);
is('PC：呼び出し口の高さ', px(fab, 'height'), 88);
ok('PC：前より大きい（72pxではない）', px(fab, 'width') > 72);
is('PC：右の余白', px(fab, 'right'), 32);
is('PC：下の余白', px(fab, 'bottom'), 32);
ok('PC：前より内側にある', px(fab, 'right') > 18 && px(fab, 'bottom') > 18);
ok('丸のまま', /border-radius:50%/.test(fab));
ok('継ナビくんの絵も一緒に大きくなっている', px(fabSvg, 'width') > 42);
is('絵の幅', px(fabSvg, 'width'), 52);
is('絵の高さ', px(fabSvg, 'height'), 52);
ok('絵が枠からはみ出していない', px(fabSvg, 'width') < px(fab, 'width'));
//  存在感：金の輪をひとまわり足している（影が二段になっているか）
ok('金の輪が回っている', /box-shadow:[^;]*rgba\(195,155,63/.test(fab));
ok('押せるものだと分かる', /cursor:pointer/.test(fab));
ok('ふわふわ動く（見つけてもらうため）', /animation:knv-float/.test(fab));

// ---------------------------------------------------------------
// ② 小さい画面では元に戻す
// ---------------------------------------------------------------
const mq = SRC.slice(SRC.indexOf('@media(max-width:600px){\n    .knv-fab'));
const mqEnd = mq.indexOf('\n  }');
const mobile = mq.slice(0, mqEnd);
ok('小さい画面の指定がある', mobile.length > 0);
ok('小さい画面では72pxに戻る', /\.knv-fab\{[^}]*width:72px/.test(mobile));
ok('小さい画面では端から18px', /\.knv-fab\{[^}]*right:18px/.test(mobile));
ok('小さい画面では絵も42pxに戻る', /\.knv-fab svg\{[^}]*width:42px/.test(mobile));
ok('小さい画面のパネルはほぼ全画面', /\.knv-panel\{[^}]*width:calc\(100vw - 16px\)/.test(mobile));

// ---------------------------------------------------------------
// ③ パネルが継ナビくんから膨らんで見えるか
// ---------------------------------------------------------------
//  transform-origin が継ナビくんの真ん中を指していないと、
//  何もない場所から湧いて出たように見える
const originM = /transform-origin:calc\(100% - ([0-9.]+)px\) calc\(100% - ([0-9.]+)px\)/.exec(panel);
ok('PC：開く起点が指定されている', !!originM);
const fabCx = px(fab, 'right') + px(fab, 'width') / 2;      // 画面の右端からの距離
const fabCy = px(fab, 'bottom') + px(fab, 'height') / 2;    // 画面の下端からの距離
is('PC：開く起点が継ナビくんの真ん中（横）', Number(originM[1]), fabCx - px(panel, 'right'));
is('PC：開く起点が継ナビくんの真ん中（縦）', Number(originM[2]), fabCy - px(panel, 'bottom'));

const mOriginM = /transform-origin:calc\(100% - ([0-9.]+)px\) calc\(100% - ([0-9.]+)px\)/.exec(mobile);
ok('小さい画面：開く起点が指定されている', !!mOriginM);
is('小さい画面：起点が継ナビくんの真ん中（横）', Number(mOriginM[1]), (18 + 36) - 8);
is('小さい画面：起点が継ナビくんの真ん中（縦）', Number(mOriginM[2]), (18 + 36) - 8);

// ---------------------------------------------------------------
// ④ 外側を押したら閉じる — ここからは実際に動かして確かめる
// ---------------------------------------------------------------
//  画面のかわりに、親子のたどれる張りぼてを組む。
//  knvKeepOpen は parentNode を上まで辿るだけなので、これで十分試せる
function el(opt) {
  const e = {
    id: opt.id || '', className: opt.className || '',
    parentNode: null, __hidden: !!opt.hidden, __closing: !!opt.closing
  };
  e.classList = {
    contains: function (c) {
      if (c === 'hidden') return e.__hidden;
      if (c === 'closing') return e.__closing;
      return (' ' + e.className + ' ').indexOf(' ' + c + ' ') >= 0;
    }
  };
  return e;
}
function child(parent, opt) { const e = el(opt || {}); e.parentNode = parent; return e; }

//  外側を押したときに何が起きたかを記録する
function makeWorld(o) {
  o = o || {};
  const panelEl = el({ id: 'knv-panel', hidden: !!o.hidden, closing: !!o.closing });
  const calls = [];
  const mod = new Function(
    'panelEl', 'calls', 'NOW',
    'var document={};' +
    'function $(id){ return id==="knv-panel" ? panelEl : null; }' +
    'function knvToggle(v){ calls.push(v); }' +
    'var Date={ now:function(){ return NOW; } };' +
    takeVar('KNV_OPEN_AT') +
    takeVar('KNV_KEEP_ID') +
    takeVar('KNV_KEEP_CLASS') +
    takeFn('knvKeepOpen') +
    takeFn('knvOutside') +
    'KNV_OPEN_AT=' + (o.openedAt === undefined ? 0 : o.openedAt) + ';' +
    'return { press:function(t){ knvOutside({target:t}); return calls; },' +
    '         keep:function(t){ return knvKeepOpen(t); } };'
  );
  return mod(panelEl, calls, o.now === undefined ? 100000 : o.now);
}

const body = el({ id: 'body-ish' });
const sidebar = child(body, { className: 'side' });
const sideBtn = child(sidebar, { className: 'navitem' });

// -- 閉じるべきとき
is('外側（左メニュー）を押したら閉じる', makeWorld().press(sideBtn), [false]);
is('本文の地を押しても閉じる', makeWorld().press(child(body, {})), [false]);

// -- 閉じてはいけないとき
const panelBody = (w => { const p = el({ id: 'knv-panel' }); return child(p, { className: 'knv-body' }); })();
{
  const p = el({ id: 'knv-panel' });
  const inner = child(child(p, { className: 'knv-body' }), { className: 'ai-bubble' });
  is('パネルの中を押しても閉じない', makeWorld().press(inner), []);
}
{
  const f = el({ id: 'knv-fab' });
  const svgPath = child(child(f, {}), {});
  //  SVGの中の className は文字列でないことがある。そこで落ちないか
  svgPath.className = { baseVal: 'tsg-body' };
  is('継ナビくん本人（SVGの中）を押しても閉じない', makeWorld().press(svgPath), []);
}
{
  const bg = el({ className: 'cpk-bg' });
  const card = child(bg, { className: 'cpk' });
  is('パネルから開いた予定の小窓を押しても閉じない', makeWorld().press(card), []);
}
{
  const man = el({ id: 'manual-modal' });
  is('操作説明書を押しても閉じない', makeWorld().press(child(man, {})), []);
}
{
  const bar = el({ className: 'upd-bar' });
  is('更新のお知らせを押しても閉じない', makeWorld().press(child(bar, {})), []);
}

// -- 開いた直後の一押しでは閉じない
is('開いた瞬間の押下では閉じない',
   makeWorld({ openedAt: 100000, now: 100000 }).press(sideBtn), []);
is('開いて0.2秒ではまだ閉じない',
   makeWorld({ openedAt: 100000, now: 100200 }).press(sideBtn), []);
is('開いて0.5秒経てば閉じる',
   makeWorld({ openedAt: 100000, now: 100500 }).press(sideBtn), [false]);

// -- そもそも開いていないとき
is('閉じているときは何もしない', makeWorld({ hidden: true }).press(sideBtn), []);
is('閉じかけのときは追い打ちしない', makeWorld({ closing: true }).press(sideBtn), []);

// -- 上まで辿り切っても落ちない
{
  const w = makeWorld();
  no('身元不明の要素は外側あつかい', w.keep(el({})));
  is('親のいない要素を押しても落ちない', w.press(el({})), [false]);
}

// ---------------------------------------------------------------
// ⑤ つなぎこみ：仕掛けが実際に取り付けられているか
// ---------------------------------------------------------------
//  作ったのに呼び出していない、が一番ありがちな抜け
ok('knvInit で取り付けている', /fab\.classList\.remove\('hidden'\);\s*\n\s*knvOutsideBind\(\);/.test(SRC));
ok('二重に取り付けない見張りがある', /function knvOutsideBind\(\)\{\s*\n\s*if\(window\.__KNV_OUTSIDE\) return;/.test(SRC));
ok('click ではなく mousedown で拾う', /addEventListener\('mousedown', knvOutside, true\)/.test(SRC));
no('click では拾っていない', /addEventListener\('click', knvOutside/.test(SRC));
ok('開いたときに起点の時刻を入れている', /KNV_OPEN_AT=Date\.now\(\);/.test(SRC));
//  開く処理より前に時刻を入れないと、見送りが効かない
{
  const at = SRC.indexOf('KNV_OPEN_AT=Date.now();');
  const shown = SRC.indexOf("p.classList.remove('hidden');", at);
  ok('時刻を入れてからパネルを出している', at > 0 && shown > at);
}

// ---------------------------------------------------------------
// ⑥ 書きかけの質問が消えないこと
// ---------------------------------------------------------------
//  閉じるのは「隠す」だけ。入力欄を空にしていたら、外側を押した拍子に
//  書きかけが消える。それは閉じる仕掛けを付けたことによる後退になる
{
  const close = takeFn('knvToggle');
  const shut = close.slice(close.indexOf('// 閉じる'));
  no('閉じるときに入力欄を空にしていない', /knv-input'\)[^;]*\.value\s*=\s*''/.test(shut));
  no('閉じるときに中身を作り直していない', /innerHTML\s*=\s*''/.test(shut));
  ok('閉じるのは hidden を付けるだけ', /classList\.add\('hidden'\)/.test(shut));
}

// ---------------------------------------------------------------
// ---------------------------------------------------------------
// 開く・閉じるの速さは同じ（鏡写し）
// ---------------------------------------------------------------
{
  const op = /animation:knvOpen (\.\d+)s cubic-bezier\(([^)]*)\)/.exec(SRC);
  const cl = /animation:knvClose (\.\d+)s cubic-bezier\(([^)]*)\)/.exec(SRC);
  ok('開くと閉じるの秒数が同じ', op && cl && op[1] === cl[1]);
  is('どちらも .24s', [op && op[1], cl && cl[1]], ['.24', '.24']);
  const kf = /@keyframes knvOpen\{([\s\S]*?)\n  \}/.exec(SRC);
  no('開くに跳ね（途中の scale 1.03）が無い', kf && /1\.03/.test(kf[1]));
  ok('開くの始点は閉じるの終点と同じ（scale .26・26px）', kf && /0%\{opacity:0;transform:scale\(\.26\) translateY\(26px\);\}/.test(kf[1]));
  ok('閉じるの終点', /100%\{opacity:0;transform:scale\(\.26\) translateY\(26px\);\}/.test(SRC));
}

console.log('試験 ' + n + '件');
if (bad.length) {
  console.log('\n合わないもの ' + bad.length + '件:');
  bad.forEach(b => console.log('  ✗ ' + b.name + '\n      出た: ' + b.got + '\n      欲しい: ' + b.want));
  process.exit(1);
}
console.log('ぜんぶ通りました。');
