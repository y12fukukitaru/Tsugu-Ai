/* =============================================================
   商談スライドを見せるための手当て ― 真ん中に大きく・全画面・スワイプ
   ---------------------------------------------------------------
   ここが引き受けるのは、話す人の手元の操作だけ。中身（何枚あるか、
   どの順で見せるか）は各資料の側にある。

     ① 画面に合わせる … 倍率を zoom で当てる（transform と違って配置も
        一緒に伸びるので、中央寄せがそのまま効く）。倍率は CSS 変数 --fit。
        測るのは表示中の一枚ではなく**全部**で、いちばん収まらない一枚に
        合わせる。一枚ずつ測ると、縦に伸びるデモの頁だけ小さくなり、
        送るたびに紙の大きさが変わり、見ているほうが落ち着かない。
        紙の高さ（--slideh）も、いちばん高い一枚にそろえる。幅だけでは
        上下の位置が頁ごとに動く。倍率も高さも、一度決めたら画面の
        大きさが変わるまで動かさない
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
  var FIT=1;
  function barH(){
    var b=document.querySelector('.bar');
    if(!b) return 0;
    //  全画面ではバーは紙の上に重なる。出ているかどうかで高さを変えると、
    //  バーが出入りするたびに紙の大きさが変わってしまう。常に同じだけ空ける
    if(body.classList.contains('pf-on')) return 8;
    return b.offsetHeight||58;
  }
  //  隠れている一枚の高さを測る。display:none のままでは測れないので、
  //  画面の外へ出して、いま出ている一枚と同じ幅で組み直して測る。
  //  幅を揃えないと、折り返しが変わって高さも変わる
  function natH(s, w, disp){
    var st=s.style;
    var keep=[st.display, st.position, st.left, st.top, st.visibility, st.width];
    //  いま出ている一枚と同じ組み方で測る。block で測ると、flex では
    //  起きない余白の相殺が効いてしまい、実際より低い高さが返る
    st.setProperty('display', disp||'flex', 'important');
    st.setProperty('position','absolute','important');
    st.setProperty('left','-99999px','important');
    st.setProperty('top','0','important');
    st.setProperty('visibility','hidden','important');
    if(w>0) st.setProperty('width', w+'px','important');
    var h=s.offsetHeight||0;
    st.display=keep[0]; st.position=keep[1]; st.left=keep[2];
    st.top=keep[3]; st.visibility=keep[4]; st.width=keep[5];
    return h;
  }
  //  いちばん収まらない一枚に合わせた倍率をひとつ決める。
  //  ここで一枚ずつ決めると、送るたびに紙の大きさが変わる
  var TALL=0;
  function measure(){
    var deck=document.querySelector('.deck'); if(!deck) return FIT;
    var cur=document.querySelector('.slide.on');
    var all=[].slice.call(document.querySelectorAll('.slide'));
    if(!all.length) return FIT;
    deck.style.setProperty('--fit','1');            // いちど等倍に戻して自然な高さを測る
    //  前に決めた高さが残っていると、全部がその高さで返ってきてしまう
    deck.style.removeProperty('--slideh');
    var w=(cur&&cur.offsetWidth)||BASE_W;
    var disp=cur ? (getComputedStyle(cur).display||'flex') : 'flex';
    if(disp==='none') disp='flex';
    var tall=0;
    all.forEach(function(s){
      var h=(s===cur) ? (s.offsetHeight||0) : natH(s, w, disp);
      if(h>tall) tall=h;
    });
    if(tall<=0) tall=1;
    TALL=tall;
    var vw=document.documentElement.clientWidth, vh=window.innerHeight;
    var z=Math.min((vw-28)/BASE_W, (vh-barH()-PAD)/tall);
    if(!isFinite(z)||z<=0) z=1;
    return Math.max(0.6, Math.min(z, 2.6));
  }
  function apply(){
    var deck=document.querySelector('.deck'); if(!deck) return;
    deck.style.setProperty('--fit', String(Math.round(FIT*1000)/1000));
    //  紙の高さも、いちばん高い一枚にそろえる。幅だけそろえても、
    //  中央寄せなので低い頁は上下が内側に寄り、送るたびに枠が伸び縮みする。
    //  低い頁は下に余白が付くだけで、中身の並びは変わらない
    if(TALL>0) deck.style.setProperty('--slideh', Math.ceil(TALL)+'px');
  }
  function fit(){ FIT=measure(); apply(); }

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
    //  入った直後に操作を出さない。押した本人はどこにあるか分かっているし、
    //  出してしまうと「紙だけ」にした意味が無くなる
    body.classList.add('pf-on'); paint(); fit();
  }
  function leave(){
    try{
      if(document.exitFullscreen && document.fullscreenElement) document.exitFullscreen().catch(function(){});
      else if(document.webkitExitFullscreen && document.webkitFullscreenElement) document.webkitExitFullscreen();
    }catch(err){}
    body.classList.remove('pf-on','pf-ui','pf-topui','pf-cursor');
    paint(); fit();
  }
  function toggle(){ body.classList.contains('pf-on') ? leave() : enter(); }

  // 全画面のあいだ、下のバーと右上を出す・退かせる。
  //   頁を送っただけで出てはいけない（送るたびに操作が現れて、話の邪魔になる）。
  //   出すのは「そこへ近づいたとき」だけにする。紙の大きさは変えない
  function showUi(on){
    if(!body.classList.contains('pf-on')) return;
    body.classList.toggle('pf-ui', !!on);
  }
  function showTop(on){
    if(!body.classList.contains('pf-on')){ body.classList.remove('pf-topui'); return; }
    body.classList.toggle('pf-topui', !!on);
  }
  //  全画面では、動かしていないあいだカーソルも消す。白い矢印が紙の上に
  //  残っていると、そこだけ目が行ってしまう
  function wakeCursor(){
    if(!body.classList.contains('pf-on')) return;
    body.classList.add('pf-cursor');
    if(uiTimer) clearTimeout(uiTimer);
    uiTimer=setTimeout(function(){
      body.classList.remove('pf-cursor','pf-ui','pf-topui');
    }, 2200);
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
      //  指の端末には hover が無いので、下のほうを触ったときだけバーを出す。
      //  どこを触っても出ると、送るたびに操作が現れることになる
      if(ty>window.innerHeight-110) showUi(true);
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
    //  頁を送っても倍率は測り直さない（全部の頁で同じ大きさを保つ）。
    //  操作も出さない。出すのは、そこへ近づいたときだけ
    window.show=function(i){ _show(i); apply(); };
  }
  document.addEventListener('keydown', function(e){
    if(e.key==='Escape' && body.classList.contains('pf-on') && !fsOn()){ leave(); }
    if(e.key==='f'||e.key==='F'){ toggle(); }
  });
  //  近づいたら出す。下の帯（バー）と右上（操作）を、それぞれの近さで判定する
  var HOT_BOTTOM=96, HOT_TOP=132, HOT_RIGHT=168;
  document.addEventListener('mousemove', function(e){
    if(!body.classList.contains('pf-on')) return;
    wakeCursor();
    showUi(e.clientY > window.innerHeight - HOT_BOTTOM);
    showTop(e.clientY < HOT_TOP && e.clientX > window.innerWidth - HOT_RIGHT);
  });
  ['fullscreenchange','webkitfullscreenchange'].forEach(function(ev){
    document.addEventListener(ev, function(){
      //  ブラウザ側（Esc やメニュー）で解除されたときも、こちらの見た目を合わせる
      if(!fsOn() && fsCan()) body.classList.remove('pf-on','pf-ui','pf-topui','pf-cursor');
      paint(); fit();
    });
  });
  //  測り直すのは画面の大きさが変わったときだけ。全部の頁を測るので、
  //  resize の連打でそのまま走らせない
  var rzT=null;
  window.addEventListener('resize', function(){
    if(rzT) clearTimeout(rzT);
    rzT=setTimeout(fit, 120);
  });
  window.addEventListener('load', fit);
  //  字が入れ替わると高さが変わる。読み込み終わりにもう一度だけ測る
  try{ if(document.fonts && document.fonts.ready) document.fonts.ready.then(fit); }catch(e){}
  build(); bindSwipe();
  //  開いた直後だけ右上を濃くして、そこに操作があることを知らせる。
  //  ずっと濃いと、見せている紙より先に目に入ってしまう
  body.classList.add('pf-hint');
  setTimeout(function(){ body.classList.remove('pf-hint'); }, 3600);
  if(document.readyState!=='loading') fit();
  window.pitchFit=fit;
  window.pitchFull=toggle;
})();
