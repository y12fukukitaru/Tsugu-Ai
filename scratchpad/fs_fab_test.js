// =============================================================
// 2026-10-13：スマホで設定の文字サイズを変えても変わらない／継ナビくんのボタンがほかのボタンに重なる
//   ① 画面の文字は rem（html の 16px × 倍率に合わせて大きくなる）。px が残っていない
//   ② 入力欄は 16px を下回らせない（iPhone で触れたときに拡大しない）。印刷・PDF はいつもの大きさ
//   ③ メニュー・ポップアップを開いているあいだはボタンを隠す（カルテは除く）
//   ④ スマホ：下へスクロール中は引っ込める・上へ戻すと出す。ページとカルテの下に余白
//   ⑤ 説明書
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
let n = 0, bad = [];
function ok(name, c) { n++; if (!c) bad.push(name); }

const pxLeft = (SRC.match(/font-size:\d+(?:\.\d+)?px/g) || []).filter((x) => x !== 'font-size:16px');
ok('① 文字の大きさに px が残っていない（印刷の 16px だけ）', pxLeft.length === 0 && (SRC.match(/font-size:16px/g) || []).length === 1);
ok('① font の一括指定も rem', !/font:\d00 \d+(?:\.\d+)?px/.test(SRC));
ok('① 倍率は html の大きさ', /\n  html\{font-size:calc\(16px \* var\(--fs,1\)\);\}/.test(SRC) && /setProperty\('--fs', String\(p\.fontScale\|\|1\)\)/.test(SRC));
ok('② 入力欄は 16px を下回らない（4か所）', (SRC.match(/font-size:max\(16px,1rem\)/g) || []).length === 4);
ok('② 印刷はいつもの大きさ', /@media print\{ html\{font-size:16px !important;\} \}/.test(SRC));
ok('② PDF も倍率を外して作る', /document\.documentElement\.style\.setProperty\('--fs','1'\);/.test(SRC) && /\}finally\{ document\.documentElement\.style\.setProperty\('--fs', fsWas\|\|'1'\); \}/.test(SRC));
ok('③ メニュー・ポップアップ・下から出る窓のあいだは隠す（カルテは除く）', /body:has\(\.drawer\.open\) \.knv-fab,/.test(SRC) && /body:has\(\.modal-back:not\(\.hidden\):not\(#cl-modal\)\) \.knv-fab\{opacity:0;visibility:hidden;pointer-events:none;\}/.test(SRC) && /body:has\(#cl-dback:not\(\.hidden\)\) \.knv-fab,/.test(SRC));
ok('④ 下へスクロール中は引っ込める（ガイドの最中は除く）', /body\.knv-tuck:not\(\.ct-on\) \.knv-fab\{translate:0 calc\(100% \+ 30px\);rotate:-16deg;opacity:0;pointer-events:none;/.test(SRC) && /document\.addEventListener\('scroll', onScroll, \{ passive:true, capture:true \}\);/.test(SRC) && /else if\(d>8\) document\.body\.classList\.add\('knv-tuck'\);/.test(SRC) && /else if\(d<-8\) document\.body\.classList\.remove\('knv-tuck'\);/.test(SRC));
ok('④ 動き：もぐるときは伸び上がってから首をかしげて・出るときはぴょこんと（ふわふわは止めない）', /translate \.42s cubic-bezier\(\.55,-0\.55,\.75,\.3\)/.test(SRC) && /translate \.6s cubic-bezier\(\.34,1\.7,\.5,1\),rotate \.7s cubic-bezier\(\.34,2\.2,\.5,1\)/.test(SRC) && !/body\.knv-tuck:not\(\.ct-on\) \.knv-fab\{[^}]*animation:none/.test(SRC));
ok('④ 動きを控える設定の方には、ふっと消える・出るだけ', /\.knv-fab,body\.knv-tuck \.knv-fab\{transition:opacity \.2s,visibility \.2s!important;rotate:0deg!important;\}/.test(SRC));
ok('④ ページとカルテの下に余白（右下・左下のときだけ）', /body:not\(\.knv-fab-rt\):not\(\.knv-fab-lt\) \.wrap\{padding-bottom:110px;\}/.test(SRC) && /#cl-modal \.modal-body\{padding-bottom:110px;\}/.test(SRC));
ok('⑤ 説明書（経営者・パートナー）', /スマホでもパソコンでも<\/b>、表や数字・ボタンの文字も一緒に大きくなります/.test(R('manual-customer.html')) && /下へスクロールしているあいだは右下にもぐって引っ込み<\/b>、少し上へ戻すとぴょこんと出てきます/.test(R('manual-customer.html')) && /下へスクロールしているあいだ引っ込み/.test(R('manual-partner.html')));

// 2026-10-14：予定の前後へ送るボタンを大きく・払いを iPhone でも確実に
const calFn = SRC.slice(SRC.indexOf('  async function knvRenderCal('), SRC.indexOf('// .cal-stick', SRC.indexOf('  async function knvRenderCal(')));
ok('⑥ 前後へ送る札：紺に金の矢印・「前の週／次の週」（月は「前の月／次の月」）', /class="cal-arw prev" onclick="calMove\(-1\)" aria-label="前の'\+unit\+'へ"/.test(calFn) && /class="cal-arw next" onclick="calMove\(1\)"/.test(calFn) && /var unit=\(view==='month'\)\?'月':'週';/.test(calFn) && /\.cal-arw\{[^}]*min-height:40px;[^}]*border:1\.5px solid #CFA860;background:linear-gradient\(160deg,#24426E 0%,#0E2038 100%\)/.test(SRC));
ok('⑥ 押すと矢印が進む向きへ・札が沈む・狭い画面では丸い札だけ', /\.cal-arw\.next:active svg\{transform:translateX\(3px\);\}/.test(SRC) && /\.cal-arw:active\{transform:translateY\(1px\) scale\(\.95\);/.test(SRC) && /@media\(max-width:380px\)\{ \.cal-arw\{padding:0 10px;\} \.cal-arw \.t\{display:none;\}/.test(SRC));
ok('⑥ 払い：横の指の動きをブラウザに取らせない・touchcancel でも判定', /#knv-cal\{touch-action:pan-y pinch-zoom;\}/.test(SRC) && /box\.addEventListener\('touchcancel', end, \{ passive:true \}\);/.test(SRC) && /CAL_SW\.lx=e\.touches\[0\]\.clientX;/.test(SRC));
ok('⑥ 説明書', /紺の「‹ 前の週」「次の週 ›」/.test(R('manual-customer.html')) && /紺の「‹ 前の週」「次の週 ›」/.test(R('manual-partner.html')));
if (bad.length) { bad.forEach((b) => console.log('NG ' + b)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK ' + n + ' checks, 0 failed');
