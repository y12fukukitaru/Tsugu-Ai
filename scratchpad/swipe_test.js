// =============================================================
// スマホ：画面の端からのスワイプでメニューを開く試験（2026-09-26）
//   Gmail のように、ハンバーガーとは別に、画面の右端から内側へ払うとメニューが指について出る。
//   ① スマホ（760px以下）だけ。右端の帯（24px）から始めた払いだけ拾う
//   ② 縦の動きが先ならスクロールに任せる。幅の1/3まで引く（か素早く払う）と開く／閉じる
//   ③ アプリ本体はドロワー、カルテは2段のメニューをドロワーにして出す
//   ④ カルテを閉じる・別の会社を開くときはメニューを元の場所へ戻す（id が二つにならない）
//   ⑤ はじめて一度だけ、払えることを知らせる。説明書・継ナビくんの知識にも書く
// =============================================================
const fs = require('fs');
const R = f => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
let n = 0, bad = [];
function ok(name, c) { n++; if (!c) bad.push(name); }
function takeFn(name) { const m = new RegExp('\\n  (?:async )?function ' + name + '\\s*\\(').exec(SRC); if (!m) throw new Error(name); return SRC.slice(m.index, SRC.indexOf('\n  }\n', m.index) + 4); }
ok('スマホだけ（760px以下）', /matchMedia\('\(max-width:760px\)'\)/.test(takeFn('swipeMobile')));
ok('右端の帯から始めたときだけ', /var SWIPE_EDGE=24;/.test(SRC) && /t\.clientX >= window\.innerWidth - SWIPE_EDGE/.test(SRC));
ok('縦が先ならスクロールに任せる', /Math\.abs\(dy\)>Math\.abs\(dx\)/.test(SRC) && /SW\.dead=true; return;/.test(SRC));
ok('払っているあいだは画面を動かさず、指について出る', /\{ passive:false \}/.test(SRC) && /ev\.preventDefault\(\);/.test(SRC) && /style\.transform='translateX\('\+off\+'px\)'/.test(SRC));
ok('幅の1/3か素早い払いで開く・閉じる', /var SWIPE_OPEN_RATIO=0\.33;/.test(SRC) && /fast=dist>40 && \(Date\.now\(\)-s\.t0\)<250/.test(SRC));
ok('開いたメニューは右へ払うと閉じる', /mode:\(isOpen\?'close':'open'\)/.test(SRC) && /s\.P\.close\(\)/.test(SRC));
ok('アプリ本体：経営者もドロワー（左メニューと同じ中身）', /function openSideDrawer\(\)/.test(SRC) && /open:openSideDrawer, close:closeDrawer/.test(takeFn('swipeParts')));
ok('カルテ：2段のメニューをドロワーに', /open:clDrawerOpen, close:clDrawerClose, prep:clDrawerMount/.test(takeFn('swipeParts')) && /e\.box\.appendChild\(side\)/.test(takeFn('clDrawerMount')));
ok('カルテ：項目・小枝・並び順を押したら閉じる（組のアイコンは閉じない）', /closest\('\.cl-ni,\.cl-tw,\.cl-rg-set'\)/.test(SRC));
ok('ほかの小窓が出ているときは拾わない', /'cl-menu'/.test(takeFn('swipeCtx')) && /'dash-sheet'/.test(takeFn('swipeCtx')) && /'manual-modal'/.test(takeFn('swipeCtx')) && /'knv-panel'/.test(takeFn('swipeCtx')));
ok('カルテを閉じたらメニューを元の場所へ', /clDrawerReset\(\); \}/.test(takeFn('closeClientModal')) && /clDrawerUnmount\(\);/.test(takeFn('clDrawerReset')));
ok('別の会社を開く前にも戻す', /    clDrawerReset\(\);\n    box\.innerHTML='<div class="cl-shell">'/.test(SRC));
ok('ドロワーの見た目', /\.cl-drawer\.open\{transform:none;visibility:visible;/.test(SRC) && /\.drawer\.swiping,\.cl-drawer\.swiping\{transition:none!important;/.test(SRC));
ok('はじめて一度だけ知らせる', /tsugu_swipe_hint_v1/.test(takeFn('swipeHintOnce')) && /右端から左へ払うと、メニューが開きます/.test(takeFn('swipeHintOnce')) && /\$\('app-body'\)\.innerHTML=view;\n    swipeHintOnce\(\);/.test(SRC));
ok('ハンバーガーはそのまま', /onclick="openDrawer\(\)"/.test(SRC) && /onclick="clMenuToggle\(event\)"/.test(SRC));
ok('経営者の説明書', /<tr><th>スマホのメニュー<\/th><td>右上の<b>≡<\/b>のほか、<b>画面の右端から左へ指で払う<\/b>/.test(R('manual-customer.html')));
ok('パートナーの説明書（本体とカルテ）', (R('manual-partner.html').match(/画面の右端から左へ払う/g) || []).length >= 2);
ok('継ナビくんの知識', (SRC.match(/スマホではメニューは右上の≡か、画面の右端から左へ指で払うと開く/g) || []).length === 2);
if (bad.length) { bad.forEach(b => console.log('NG', b)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK ' + n + ' checks, 0 failed');
