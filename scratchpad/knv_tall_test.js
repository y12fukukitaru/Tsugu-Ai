// スマホの継ナビくんのパネルは上下いっぱい（2026-10-15）
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const VER = JSON.parse(fs.readFileSync(__dirname + '/../version.json', 'utf8'));
let n = 0, bad = [];
function ok(name, c) { n++; if (!c) bad.push(name); }
const m = SRC.indexOf('    .knv-fab{right:18px;bottom:18px;width:72px;height:72px;');
const blk = SRC.slice(m, SRC.indexOf('/* 週表示は7日を幅に収め', m));
ok('スマホ：上下の位置で決める（上8px＋安全域・下8px＋安全域・左右8px）', /\.knv-panel\{left:8px;right:8px;top:calc\(8px \+ env\(safe-area-inset-top,0px\)\);bottom:calc\(8px \+ env\(safe-area-inset-bottom,0px\)\);/.test(blk));
ok('スマホ：高さは決めない（100vh を使わない）', /width:auto;height:auto;/.test(blk) && !/\.knv-panel\{[^}]*100vh/.test(blk));
ok('パソコンはこれまでどおり（右下に浮かぶ600px）', /\.knv-panel\{position:fixed;right:20px;bottom:20px;z-index:71;width:min\(600px,calc\(100vw - 24px\)\);height:min\(820px,calc\(100vh - 60px\)\);/.test(SRC));
ok('版が揃う', SRC.match(/var APP_BUILD='([^']+)'/)[1] === VER.build);
if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
