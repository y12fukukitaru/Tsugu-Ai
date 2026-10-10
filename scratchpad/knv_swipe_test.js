// =============================================================
// 継ナビくんを横に払って閉じる（2026-10-10。上下はスクロールとぶつかるので使わない）
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const MANC = fs.readFileSync(__dirname + '/../manual-customer.html', 'utf8');
const MANP = fs.readFileSync(__dirname + '/../manual-partner.html', 'utf8');
let n = 0, bad = [];
function ok(name, c) { n++; if (!c) bad.push(name); }
function takeFn(name) { const i = SRC.indexOf('\n  function ' + name + '('); if (i < 0) throw new Error(name); return SRC.slice(i, SRC.indexOf('\n  }\n', i) + 4); }
const f = takeFn('knvSwipeInit');
ok('パネルに指の動きを付ける（一度だけ）', /var p=\$\('knv-panel'\); if\(!p \|\| p\.__sw\) return; p\.__sw=true;/.test(f) && /document\.addEventListener\('DOMContentLoaded', knvSwipeInit\);/.test(SRC));
ok('入力欄から始めた動きは使わない', /tg\.closest\('input,textarea,select,\[contenteditable="true"\],\.knv-szmenu'\)/.test(f));
ok('上下の払いでは閉じない（横がはっきり勝つときだけ）', /if\(Math\.abs\(dx\)>Math\.abs\(dy\)\*1\.2\)\{/.test(f) && /\} else \{ s\.dead=true; return; \}/.test(f) && !/translateY/.test(f) && !/s\.axis='y'/.test(f));
ok('横に送れるものは、その向きの端まで送り切っているときだけ', /if\(\(dx>0 && !atL\) \|\| \(dx<0 && !atR\)\)\{ s\.dead=true; return; \}/.test(f));
ok('指についていき、十分に動いたか素早く払ったら閉じる', /var fast=dist>50 && \(Date\.now\(\)-s\.t0\)<260;/.test(f) && /dist > Math\.min\(140, span\*0\.28\)/.test(f) && /knvToggle\(false\);/.test(f));
ok('足りなければ元の位置に戻る', /p\.style\.transform=''; p\.style\.opacity='';/.test(f));
ok('払って閉じたときは、縮む動きを重ねない', /\.knv-panel\.knv-swiped\.closing\{animation:none;opacity:0;\}/.test(SRC) && /\.knv-panel\.knv-dragging\{animation:none;transition:none;\}/.test(SRC));
ok('継ナビくんが開いているあいだは、端からのメニューの払いを使わない（カルテの上でも）', /var kp0=\$\('knv-panel'\); if\(kp0 && !kp0\.classList\.contains\('hidden'\)\) return null;\n    var m=\$\('cl-modal'\);/.test(SRC));
const sc = takeFn('knvSwScroller');
ok('横に送れる箱を探す', /overflowX/.test(sc));
ok('説明書：スマホでは左右に払っても閉じる（上下は閉じない）', [MANC, MANP].every((m) => /<b>スマホでは、パネルを左右に払っても閉じます<\/b>（上下の動きは中身のスクロールなので閉じません/.test(m)));
if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
