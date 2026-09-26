// =============================================================
// 商談スライドのスマホ表示の試験（2026-09-26）
//   スマホ・タブレット（820px以下）で、紙の高さを「いちばん高い一枚」にそろえていたため、
//   表紙など短い頁の中身が画面の何倍もの高さの真ん中に置かれ、開くと空白に見えていた。
//   ① 820px以下は高さを一画面までにとどめる（PCのそろえ方はそのまま）
//   ② スマホの下の操作列は、字を折らない
// =============================================================
const fs = require('fs');
const CSS = fs.readFileSync(__dirname + '/../pitch-wa.css', 'utf8');
let n = 0, bad = [];
function ok(name, c) { n++; if (!c) bad.push(name); }
ok('820px以下は一画面まで', /@media screen and \(max-width:820px\)\{\s*\.deck \.slide,\.deck \.slide\.dm\{min-height:calc\(100vh - 110px\);min-height:calc\(100svh - 110px\);\}/.test(CSS));
ok('PCは、いちばん高い一枚にそろえたまま', /min-height:var\(--slideh,0\);/.test(CSS));
const pc = CSS.indexOf('min-height:var(--slideh,0);'), sp = CSS.indexOf('@media screen and (max-width:820px){');
ok('スマホの決まりはPCの決まりより後ろ（上書きする）', pc > 0 && sp > pc);
ok('下の操作列：字を折らない・題を隠す', /@media\(max-width:560px\)\{[^}]*\.bar\{gap:6px;padding:0 8px;\}\s*\.bar button\{white-space:nowrap;[^}]*\}\s*\.bar \.ttl\{display:none;\}/.test(CSS));
['pitch-customer', 'pitch-partner', 'pitch-general', 'pitch-bank', 'pitch-finance', 'pitch-ep1', 'pitch-ep2'].forEach(d =>
  ok(d + ' は pitch-wa.css を読む', /href="pitch-wa\.css"/.test(fs.readFileSync(__dirname + '/../' + d + '.html', 'utf8'))));
if (bad.length) { bad.forEach(b => console.log('NG', b)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK ' + n + ' checks, 0 failed');
