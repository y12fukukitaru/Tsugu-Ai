/* =============================================================
   商談スライドを見せるための手当て ― 真ん中に大きく・全画面・スワイプ
   ---------------------------------------------------------------
   ここが引き受けるのは、話す人の手元の操作だけ。中身（何枚あるか、
   どの順で見せるか）は各資料の側にある。

     ① 画面に合わせる … 表示中の一枚を測り、幅と高さの両方に収まる
        倍率を zoom で当てる（transform と違って配置も一緒に伸びるので、
        中央寄せがそのまま効く）。倍率は CSS 変数 --fit に置く
     ② 全画面        … ウェビナー・プレゼン用。ブラウザの全画面が使える
        端末では本物の全画面、使えない端末（iPhone の Safari など）では
        下のバーを退かせて紙を最大にする「見立ての全画面」に落とす
     ③ スワイプ      … iPhone・タブレットで指で送る。横に動いたときだけ
        送り、そのあとの click は握りつぶす（タップで次へ、と二重に
        進まないように）
     ④ 右上の操作    … 「⛶ 全画面」と「✕ プラットフォームに戻る」。
        話の邪魔をしないよう普段は薄く、近づくと濃くなる。
        全画面のあいだは ✕ を出さない（全画面 → 解除 → 戻る の順に
        すると、どこへ戻るのかが迷子にならない）

   読み込む順番： 各資料のインラインの script（show/mv を定義）→ pitch-fit.js
   ============================================================= */
(function(){
  var BASE_W=1080;           // 紙の基準幅（各資料の .slide の max-width）
  var PAD=32;                // 紙の上下に残す余白
  var body=document.body;
  var uiTimer=null;

  // ===== ① 画面に合わせる =====
  function barH(){
    var b=document.querySelector('.bar');
    if(!b) return 0;
    //  全画面でバーを退かせているあいだは、その分も紙に使う
    if(body.classList.contains('pf-on') && !body.classList.contains('pf-ui')) return 8;
    return b.offsetHeight||58;
  }
  function fit(){
    var deck=document.querySelector('.deck'); if(!deck) return;
    var cur=document.querySelector('.slide.on'); if(!cur) return;
    deck.style.setProperty('--fit','1');            // いちど等倍に戻して自然な高さを測る
    var vw=document.documentElement.clientWidth, vh=window.innerHeight;
    var natH=cur.offsetHeight||1;
    var z=Math.min((vw-28)/BASE_W, (vh-barH()-PAD)/natH);
    if(!isFinite(z)||z<=0) z=1;
    z=Math.max(0.6, Math.min(z, 2.6));
    deck.style.setProperty('--fit', String(Math.round(z*1000)/1000));
  }

  // ===== ② 全画面 =====
  function fsOn(){ return !!(document.fullscreenElement||document.webkitFullscreenElement); }
  function fsCan(){ var e=document.documentElement; return !!(e.requestFullscreen||e.webkitRequestFullscreen); }
  function enter(){
    var e=document.documentElement;
    //  本物の全画面が断られることもある（iframe の中など）。そのときも
    //  見立ての全画面には入れておく。押したのに何も起きないのが一番困る
    try{
      if(e.requestFullscreen) e.requestFullscreen().catch(function(){});
      else if(e.webkitRequestFullscreen) e.webkitRequestFullscreen();
    }catch(err){}
    body.classList.add('pf-on'); showUi(); paint(); fit();
  }
  function leave(){
    try{
      if(document.exitFullscreen && document.fullscreenElement) document.exitFullscreen().catch(function(){});
      else if(document.webkitExitFullscreen && document.webkitFullscreenElement) document.webkitExitFullscreen();
    }catch(err){}
    body.classList.remove('pf-on','pf-ui');
    paint(); fit();
  }
  function toggle(){ body.classList.contains('pf-on') ? leave() : enter(); }

  // 全画面のあいだ、操作したときだけ下のバーを出す（話している最中は紙だけにする）
  function showUi(){
    if(!body.classList.contains('pf-on')) return;
    body.classList.add('pf-ui');
    if(uiTimer) clearTimeout(uiTimer);
    uiTimer=setTimeout(function(){ body.classList.remove('pf-ui'); fit(); }, 2600);
    fit();
  }

  // ===== ④ 右上の操作 =====
  //  絵文字（⛶ など）は端末によって形も大きさも変わる。ここは線で描く。
  var SVG_OPEN='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
  var SVG_CLOSE='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>';
  var SVG_X='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  var btnFull, btnBack;
  function paint(){
    if(!btnFull) return;
    var on=body.classList.contains('pf-on');
    btnFull.innerHTML = on ? SVG_CLOSE : SVG_OPEN;
    btnFull.setAttribute('aria-label', on?'全画面を解除':'全画面で表示');
    btnFull.setAttribute('title', on?'全画面を解除（Esc）':'全画面で表示（F）');
    //  全画面のあいだは「戻る」を出さない。全画面 → 解除 → 戻る の順に置くと、
    //  どこへ戻るのかが分かったうえで押せる
    if(btnBack) btnBack.style.display = (on||window.parent===window) ? 'none' : '';
  }
  function build(){
    var top=document.createElement('div'); top.className='pf-top';
    btnFull=document.createElement('button'); btnFull.type='button'; btnFull.className='pf-btn';
    btnFull.onclick=function(e){ e.stopPropagation(); toggle(); };
    btnBack=document.createElement('button'); btnBack.type='button'; btnBack.className='pf-btn';
    btnBack.innerHTML=SVG_X; btnBack.setAttribute('aria-label','プラットフォームに戻る');
    btnBack.setAttribute('title','プラットフォームに戻る');
    btnBack.onclick=function(e){
      e.stopPropagation();
      if(window.parent!==window){ try{ parent.postMessage({tsugu:'closeManual'},'*'); return; }catch(err){} }
      if(history.length>1) history.back(); else location.href='./index.html';
    };
    top.appendChild(btnFull); top.appendChild(btnBack);
    body.appendChild(top);
    paint();
  }

  // ===== ③ スワイプ =====
  var tx=0, ty=0, swiped=false;
  function bindSwipe(){
    document.addEventListener('touchstart', function(e){
      if(e.touches.length!==1) return;
      tx=e.touches[0].clientX; ty=e.touches[0].clientY; swiped=false;
      showUi();
    }, {passive:true});
    document.addEventListener('touchend', function(e){
      var t=e.changedTouches&&e.changedTouches[0]; if(!t) return;
      var dx=t.clientX-tx, dy=t.clientY-ty;
      //  横に 45px 以上、かつ縦より横のほうが大きいときだけ「送った」とみなす。
      //  斜めや縦の指の動きで頁が飛ぶと、読んでいる人が迷子になる
      if(Math.abs(dx)>45 && Math.abs(dx)>Math.abs(dy)*1.3){
        swiped=true;
        if(typeof window.mv==='function') window.mv(dx<0?1:-1);
      }
    }, {passive:true});
    //  スワイプの直後の click は握りつぶす（紙のどこを押しても次へ進む作りのため）
    document.addEventListener('click', function(e){
      if(swiped){ swiped=false; e.stopPropagation(); e.preventDefault(); }
    }, true);
  }

  // ===== 配線 =====
  if(typeof window.show==='function'){
    var _show=window.show;
    window.show=function(i){ _show(i); fit(); };
  }
  document.addEventListener('keydown', function(e){
    if(e.key==='Escape' && body.classList.contains('pf-on') && !fsOn()){ leave(); }
    if(e.key==='f'||e.key==='F'){ toggle(); }
    showUi();
  });
  document.addEventListener('mousemove', showUi);
  ['fullscreenchange','webkitfullscreenchange'].forEach(function(ev){
    document.addEventListener(ev, function(){
      //  ブラウザ側（Esc やメニュー）で解除されたときも、こちらの見た目を合わせる
      if(!fsOn() && fsCan()) body.classList.remove('pf-on','pf-ui');
      paint(); fit();
    });
  });
  window.addEventListener('resize', fit);
  window.addEventListener('load', fit);
  build(); bindSwipe();
  //  開いた直後だけ右上を濃くして、そこに操作があることを知らせる。
  //  ずっと濃いと、見せている紙より先に目に入ってしまう
  body.classList.add('pf-hint');
  setTimeout(function(){ body.classList.remove('pf-hint'); }, 3600);
  if(document.readyState!=='loading') fit();
  window.pitchFit=fit;
  window.pitchFull=toggle;
})();
