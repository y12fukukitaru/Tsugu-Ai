// =============================================================
// 顧客カルテ：右の列（明るい地）の項目にカーソルを置いたときの見た目（2026-09-29）
//   以前は暗い地向けの決まり（.cl-ni:hover .ci{color:#fff}）が勝ち、白い札に白い線で
//   マークが空欄に見えていた。
//   ① カーソル：札は淡い金地に金茶の線（空欄にしない）、行に金の光と左の細い帯
//   ② 選択中：札は金のグラデーションに白い線（カーソルを置いても変わらない）
//   ③ 夜の画面・動きを減らす設定・キーボード操作
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
let n = 0, bad = [];
function ok(name, c) { n++; if (!c) bad.push(name); }
function rule(sel) {
  const i = SRC.indexOf('\n  ' + sel + '{');
  if (i < 0) return '';
  return SRC.slice(i, SRC.indexOf('}', i) + 1);
}
const hov = rule('.cl-panel .cl-ni:hover .ci,.cl-panel .cl-ni:focus-visible .ci');
ok('カーソル：札は淡い金地に金茶の線', /background:linear-gradient\(135deg,#FFF9EC,#F5E6C3\)/.test(hov) && /color:#8A6D2F;/.test(hov) && !/color:#fff/.test(hov));
ok('カーソル：札が少し浮く', /transform:translateY\(-1px\) scale\(1\.06\)/.test(hov) && /box-shadow:0 4px 10px rgba\(195,155,63,\.24\)/.test(hov));
ok('カーソル：行に金の光', /background:linear-gradient\(90deg,rgba\(195,155,63,\.16\)/.test(rule('.cl-panel .cl-ni:hover,.cl-panel .cl-ni:focus-visible')));
ok('カーソル：左に金の細い帯が伸びる', /transform:scaleY\(0\)/.test(rule('.cl-panel .cl-ni::before')) && /transform:scaleY\(1\)/.test(rule('.cl-panel .cl-ni:hover::before,.cl-panel .cl-ni:focus-visible::before')));
ok('暗い地向けの決まりより強い（.cl-panel まで書く）', /\n  \.cl-ni:hover \.ci\{color:#fff;\}/.test(SRC) && hov.length > 0);
const on = rule('.cl-panel .cl-ni.on .ci,.cl-panel .cl-ni.on:hover .ci');
ok('選択中：金のグラデーションに白い線', /background:linear-gradient\(135deg,#DDBD72,#B8902F\)/.test(on) && /color:#fff;/.test(on) && /transform:none;/.test(on));
ok('選択中：行は太字と帯', /font-weight:700/.test(rule('.cl-panel .cl-ni.on')) && /transform:scaleY\(1\)/.test(rule('.cl-panel .cl-ni.on::before')));
ok('夜の画面：カーソルの札', /color:#EBD092;/.test(rule('body.dark .cl-panel .cl-ni:hover .ci,body.dark .cl-panel .cl-ni:focus-visible .ci')));
ok('夜の画面：選択中は金の札のまま', /background:linear-gradient\(135deg,#DDBD72,#B8902F\)/.test(rule('body.dark .cl-panel .cl-ni.on .ci,body.dark .cl-panel .cl-ni.on:hover .ci')));
ok('夜の画面の選択中の決まりは、夜のカーソルの決まりより後ろ（同じ強さなので後ろが勝つ）',
  SRC.indexOf('body.dark .cl-panel .cl-ni.on .ci,body.dark .cl-panel .cl-ni.on:hover .ci{') > SRC.indexOf('body.dark .cl-panel .cl-ni:hover .ci,body.dark .cl-panel .cl-ni:focus-visible .ci{'));
ok('動きを減らす設定では動かさない', /@media \(prefers-reduced-motion: reduce\)\{\s*\.cl-panel \.cl-ni,\.cl-panel \.cl-ni::before,\.cl-panel \.cl-ni \.ci\{transition:none;\}/.test(SRC));
if (bad.length) { bad.forEach((b) => console.log('NG ' + b)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK ' + n + ' checks, 0 failed');
