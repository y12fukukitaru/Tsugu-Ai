/* =============================================================
   商談スライドを画面に合わせる ― 真ん中に、大きく
   ---------------------------------------------------------------
   紙（.slide）は 1080px 幅を基準に組んである。大きな画面では上に
   小さく寄ってしまい、文字も読みにくい。ここでは表示中の一枚を測り、
   幅と高さの両方に収まる最大の倍率を zoom で当てる（zoom は
   transform と違って配置も一緒に伸びるので、中央寄せがそのまま効く）。

   倍率は CSS 変数 --fit に置き、印刷では pitch-wa.css が 1 に戻す。
   読み込む順番： 各資料のインラインの script（show/mv を定義）→ pitch-fit.js
   ============================================================= */
(function(){
  var BASE_W=1080;           // 紙の基準幅（各資料の .slide の max-width）
  var BAR=58;                // 下の操作バーの高さ
  var PAD=32;                // 上下の余白
  function fit(){
    var deck=document.querySelector('.deck'); if(!deck) return;
    var cur=document.querySelector('.slide.on'); if(!cur) return;
    // 一度 1 倍に戻して自然な高さを測る
    deck.style.setProperty('--fit','1');
    var vw=document.documentElement.clientWidth, vh=window.innerHeight;
    var natH=cur.offsetHeight||1;
    var byW=(vw-28)/BASE_W, byH=(vh-BAR-PAD)/natH;
    var z=Math.min(byW, byH);
    if(!isFinite(z)||z<=0) z=1;
    z=Math.max(0.6, Math.min(z, 2.2));
    deck.style.setProperty('--fit', String(Math.round(z*1000)/1000));
  }
  // 各資料の show(i) のあとに合わせ直す（mv も show を呼ぶ）
  if(typeof window.show==='function'){
    var _show=window.show;
    window.show=function(i){ _show(i); fit(); };
  }
  window.addEventListener('resize', fit);
  window.addEventListener('load', fit);
  if(document.readyState!=='loading') fit();
  window.pitchFit=fit;
})();
