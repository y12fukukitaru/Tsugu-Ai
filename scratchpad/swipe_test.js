// =============================================================
// スマホ：画面の端からのスワイプでメニューを開く試験（2026-09-26）
//   Gmail のように、ハンバーガーとは別に、画面の端から内側へ払うとメニューが指について出る。
//   ① スマホ（760px以下）だけ。左右の端の帯（24px）から始めた払いだけ拾う（2026-09-27 左端からも。その側から出す）
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
ok('左右の端の帯から始めたときだけ', /var SWIPE_EDGE=24;/.test(SRC) && /fromR=\(t\.clientX >= window\.innerWidth - SWIPE_EDGE\), fromL=\(t\.clientX <= SWIPE_EDGE\)/.test(SRC)
  && /if\(!isOpen && \(fromR \|\| fromL\)\) side=fromL \? 'left' : 'right';/.test(SRC));
ok('左端からはメニューを左から出し、左へ払って閉じる', /SW\.P\.el\.classList\.toggle\('from-left', SW\.side==='left'\)/.test(SRC) && /side=P\.el\.classList\.contains\('from-left'\) \? 'left' : 'right'/.test(SRC)
  && /\.drawer\.from-left\{right:auto;left:0;transform:translateX\(-105%\);/.test(SRC) && /\.cl-drawer\.from-left\{right:auto;left:0;transform:translateX\(-105%\);/.test(SRC)
  && /\.drawer\.from-left\.open\{transform:none;\}/.test(SRC) && /\.cl-drawer\.from-left\.open\{transform:none;\}/.test(SRC));
ok('開くときは内側へ、閉じるときは外側へだけ', /\(SW\.mode==='open' && inw<0\) \|\| \(SW\.mode==='close' && inw>0\)/.test(SRC));
ok('≡は右から（左から出ていた名残を外す）', /d\.classList\.toggle\('from-left', side==='left'\)/.test(takeFn('openDrawer')) && /e\.box\.classList\.toggle\('from-left', side==='left'\)/.test(takeFn('clDrawerOpen')) && /clDrawerOpen\('right'\)/.test(takeFn('clMenuToggle')) && /s\.P\.open\(s\.side\)/.test(SRC));
ok('縦が先ならスクロールに任せる', /Math\.abs\(dy\)>Math\.abs\(dx\)/.test(SRC) && /SW\.dead=true; return;/.test(SRC));
ok('払っているあいだは画面を動かさず、指について出る', /\{ passive:false \}/.test(SRC) && /ev\.preventDefault\(\);/.test(SRC) && /style\.transform='translateX\('\+\(SW\.side==='left' \? -hid : hid\)\+'px\)'/.test(SRC));
ok('幅の1/3か素早い払いで開く・閉じる', /var SWIPE_OPEN_RATIO=0\.33;/.test(SRC) && /fast=dist>40 && \(Date\.now\(\)-s\.t0\)<250/.test(SRC));
ok('開いたメニューは右へ払うと閉じる', /mode:\(isOpen\?'close':'open'\)/.test(SRC) && /s\.P\.close\(\)/.test(SRC));
ok('アプリ本体：経営者もドロワー（左メニューと同じ中身）', !/openSideDrawer/.test(SRC) && /open:openDrawer, close:closeDrawer/.test(takeFn('swipeParts')));
ok('カルテ：2段のメニューをドロワーに', /open:clDrawerOpen, close:clDrawerClose,/.test(takeFn('swipeParts')) && /e\.box\.appendChild\(side\)/.test(takeFn('clDrawerMount')));
ok('カルテ：項目・小枝・並び順を押したら閉じる（組のアイコンは閉じない）', /closest\('\.cl-ni,\.cl-tw,\.cl-rg-set'\)/.test(SRC));
ok('ほかの小窓が出ているときは拾わない', /'manual-modal'/.test(takeFn('swipeCtx')) && /'knv-panel'/.test(takeFn('swipeCtx')));
ok('カルテを閉じたらメニューを元の場所へ', /clDrawerReset\(\); \}/.test(takeFn('closeClientModal')) && /clDrawerUnmount\(\);/.test(takeFn('clDrawerReset')));
ok('別の会社を開く前にも戻す', /    clDrawerReset\(\);\n    box\.innerHTML='<div class="cl-shell">'/.test(SRC));
ok('ドロワーの見た目', /\.cl-drawer\.open\{transform:none;visibility:visible;/.test(SRC) && /\.drawer\.swiping,\.cl-drawer\.swiping\{transition:none!important;/.test(SRC));
ok('はじめて一度だけ知らせる', /tsugu_swipe_hint_v2/.test(takeFn('swipeHintOnce')) && /画面の左右どちらの端からでも、内側へ払うとメニューが開きます/.test(takeFn('swipeHintOnce')) && /\$\('app-body'\)\.innerHTML=view;\n    swipeHintOnce\(\);/.test(SRC));
ok('≡は払ったときと同じメニューを開く（アプリ）', /onclick="openDrawer\(\)"/.test(SRC) && !/customer/.test(takeFn('openDrawer')) && /d\.classList\.add\('open'\)/.test(takeFn('openDrawer')));
ok('≡とパンくずの「メニュー」は払ったときと同じ2段のドロワー（カルテ）', /onclick="clMenuToggle\(event\)"/.test(SRC) && /onclick="clMenuToggle\(event\)">メニュー<\/button>/.test(SRC)
  && /if\(box && box\.classList\.contains\('open'\)\) clDrawerClose\(\); else clDrawerOpen\('right'\);/.test(takeFn('clMenuToggle')));
ok('ドロワーの開け閉めで≡の形も変わる', /mb\.classList\.add\('open'\)/.test(takeFn('clDrawerOpen')) && /mb\.classList\.remove\('open'\)/.test(takeFn('clDrawerClose')));
ok('カルテのシートは並び順のカスタマイズだけ（タイルの一覧は無い）', !/clTilesHtml|clMenuGo/.test(SRC) && /body\.innerHTML=clEditHtml\(\);/.test(takeFn('clSheetRender')) && /clSheetOpen\(true\)/.test(SRC) && !/clSheetOpen\(false\)/.test(SRC));
ok('カルテ：並び順のシートが出ていても端から払える（払い始めにシートを閉じる）', !/'cl-menu'/.test(takeFn('swipeCtx')) && /prep:function\(\)\{ var sh=\$\('cl-menu'\); if\(sh && !sh\.classList\.contains\('hidden'\)\) clMenuClose\(\); clDrawerMount\(\); \}/.test(takeFn('swipeParts')));
ok('カルテのタイルのシートは body 直下へ移して開く（カルテの窓の中だとスクロールでずれる）', /if\(d\.parentNode!==document\.body\) document\.body\.appendChild\(d\);\n    CL_EDIT=!!edit;/.test(takeFn('clSheetOpen')));
ok('経営者の説明書', /<tr><th>スマホのメニュー<\/th><td>右上の<b>≡<\/b>のほか、<b>画面の左右どちらの端からでも、内側へ指で払う<\/b>/.test(R('manual-customer.html')) && /左端からの払いが「前の画面に戻る」操作と重なることがあります/.test(R('manual-customer.html')));
ok('パートナーの説明書（本体とカルテ）', (R('manual-partner.html').match(/画面の左右どちらの端からでも、内側へ払う/g) || []).length >= 2);
ok('継ナビくんの知識', (SRC.match(/スマホではメニューは右上の≡か、画面の左右どちらの端からでも内側へ指で払うと、その側から開く/g) || []).length === 2);
if (bad.length) { bad.forEach(b => console.log('NG', b)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK ' + n + ' checks, 0 failed');
