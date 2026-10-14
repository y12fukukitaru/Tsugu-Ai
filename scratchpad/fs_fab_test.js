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

// 2026-10-14：予定の操作を本体の外の帯に・下へ読むと畳む・前後の札の中心・週の始まり
const calFn = SRC.slice(SRC.indexOf('  async function knvRenderCal('), SRC.indexOf('// .cal-stick', SRC.indexOf('  async function knvRenderCal(')));
ok('⑥ 前後の札：紺に金の矢印・「前の週／次の週」（月は「前の月／次の月」）', /class="cal-arw prev" onclick="calMove\(-1\)" aria-label="前の'\+unit\+'へ"/.test(calFn) && /class="cal-arw next" onclick="calMove\(1\)"/.test(calFn) && /var unit=\(view==='month'\)\?'月':'週'/.test(calFn) && /\.cal-arw\{[^}]*height:34px;[^}]*border:1\.5px solid #CFA860;background:linear-gradient\(160deg,#24426E 0%,#0E2038 100%\)/.test(SRC));
ok('⑥ 札の中身を真ん中に（矢印の側の余白を詰める）', /\.cal-arw\.prev\{padding:0 13px 0 8px;\}/.test(SRC) && /\.cal-arw\.next\{padding:0 8px 0 13px;\}/.test(SRC) && /justify-content:center;gap:3px;height:34px;/.test(SRC));
ok('⑥ 操作はスクロールする本体の外の帯に', /<div id="knv-calbar" class="knv-calbar hidden"><\/div>\n  <div id="knv-cal" class="knv-body hidden"><\/div>/.test(SRC) && /cbar\.classList\.toggle\('hidden', t!=='cal'\);/.test(SRC) && /bar\.innerHTML=bh;/.test(calFn));
ok('⑥ 下へ読むと上段・内訳・副題を畳み、上へ戻すと出す（行ったり来たりしない）', /\.knv-panel\.knv-compact \.knv-calbar \.cb-top\{max-height:0;opacity:0;/.test(SRC) && /\.knv-panel\.knv-compact \.knv-summary\{max-height:0;/.test(SRC) && /KNV_CPT\.lock=Date\.now\(\)\+400;/.test(SRC) && /if\(d>14\)\{ knvCompact\(true\);/.test(SRC) && /else if\(d<-14\)\{ knvCompact\(false\);/.test(SRC) && /knvCompact\(false\);   \/\/ 畳んだ見出しは、タブを替えたら出し直す/.test(SRC));
ok('⑥ 暦の払いはやめた（横の払いは継ナビくんを閉じる）', !/calSwipeBind/.test(SRC) && !/#knv-cal\{touch-action/.test(SRC) && !/左右に払っても送れます/.test(SRC));
ok('⑦ 週の始まり：日曜／月曜（週表示・月表示・TODO の暦）', /function calWeekStart\(\)\{ var p=loadPrefs\(\); return p\.weekStart===1\?1:0; \}/.test(SRC) && /ws=calWeekStartOf\(cur\);/.test(SRC) && /var start=calWeekStartOf\(first\), wEnd=\(calWeekStart\(\)\+6\)%7;/.test(SRC) && /for\(var i=0;i<\(first\.getDay\(\)-calWeekStart\(\)\+7\)%7;i\+\+\)/.test(SRC) && /onclick="setWeekStart\('\+o\[1\]\+'\)">'\+o\[0\]\+'から/.test(SRC));
ok('⑥⑦ 説明書', /紺の「‹ 前の週」「次の週 ›」/.test(R('manual-customer.html')) && /予定の週の始まり/.test(R('manual-customer.html')) && /予定の週の始まり/.test(R('manual-partner.html')));
if (bad.length) { bad.forEach((b) => console.log('NG ' + b)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK ' + n + ' checks, 0 failed');
