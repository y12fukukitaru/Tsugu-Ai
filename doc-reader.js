/* =============================================================
   資料の読み方を二つにする ―「スライドで見る」と「目次から読む」
   ---------------------------------------------------------------
   操作説明書・商談スライドの両方に、同じ一本を読み込むだけで効く。
   各資料の側で要るのは、</body> の前の <script src="doc-reader.js">
   と、section.slide に書いた data-t（題）・data-g（組）・data-q（質問）だけ。

     スライドで見る … いままでの見え方。何も変えない（既定）
     目次から読む   … 左に目次・質問・索引・検索、右に全部の頁を縦に並べる。
                      お客様に聞かれたことを、その場で探して見せるための見え方

   深いリンク（アプリの継ナビくんが使う）
     資料.html#t=<題>            … その題の頁へ（どちらの見え方でも）
     資料.html#q=<ことば>         … 目次から読むで、検索を入れた状態で開く
     資料.html#5                  … 5枚目へ（いままでどおり）
     資料.html?view=read&t=<題>   … 目次から読むで、その題の頁へ
     ?view=slide / ?view=read     … 見え方を指定（前回の選択より優先）

   アプリ向けに、読み込んだ時点で window.TSUGU_DOC に中身を出す。
     { title, file, kind, slides:[{n, t, g, q:[...], text}] }
   ============================================================= */
(function(){
  'use strict';
  var D=document, W=window, body=D.body, html=D.documentElement;
  var S=[].slice.call(D.querySelectorAll('section.slide'));
  if(!S.length) return;

  var FILE=(location.pathname.split('/').pop()||'').replace(/[?#].*$/,'')||'doc';
  var KIND=(typeof W.show==='function' && D.querySelector('.bar') && !D.querySelector('.mnv-top')) ? 'deck' : 'stack';
  var LSKEY='tsugu_docview:'+FILE;
  var TITLE=(D.title||'').replace(/\s*[|｜]\s*TsuguAi.*$/,'').trim()||'資料';

  // ---------- 小道具 ----------
  function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
  function el(tag, cls, htmlStr){ var e=D.createElement(tag); if(cls) e.className=cls; if(htmlStr!=null) e.innerHTML=htmlStr; return e; }
  function lsGet(k){ try{ return W.localStorage.getItem(k); }catch(e){ return null; } }
  function lsSet(k,v){ try{ W.localStorage.setItem(k,v); }catch(e){} }
  function pad2(n){ return (n<10?'0':'')+n; }
  var REDUCE=false; try{ REDUCE=W.matchMedia('(prefers-reduced-motion: reduce)').matches; }catch(e){}
  //  長さを変えない折りたたみ（カタカナ→ひらがな、全角英数→半角、英字は小文字）。
  //  長さが変わらないので、見つかった位置をそのまま元の文に当てられる
  function fold(s){
    s=String(s||''); var o='';
    for(var k=0;k<s.length;k++){
      var c=s.charCodeAt(k);
      if(c>=0x30A1&&c<=0x30F6) c-=0x60;
      else if(c>=0xFF01&&c<=0xFF5E) c-=0xFEE0;
      else if(c===0x3000) c=0x20;
      if(c>=65&&c<=90) c+=32;
      o+=String.fromCharCode(c);
    }
    return o;
  }
  //  頁の文。話す内容（.talk）・図（svg）は入れない。ブロックの境目には空白を挟む
  var BLOCK=/^(P|DIV|LI|H1|H2|H3|H4|H5|H6|TR|TD|TH|SECTION|UL|OL|TABLE|BR|DT|DD|BLOCKQUOTE)$/;
  function textOf(node){
    var out=[];
    (function walk(n){
      for(var c=n.firstChild;c;c=c.nextSibling){
        if(c.nodeType===3){ out.push(c.nodeValue); continue; }
        if(c.nodeType!==1) continue;
        var tn=c.tagName;
        if(tn==='SCRIPT'||tn==='STYLE'||tn==='svg'||tn==='SVG') continue;
        if(c.classList && c.classList.contains('talk')) continue;
        walk(c);
        if(BLOCK.test(tn)) out.push(' ');
      }
    })(node);
    return out.join('').replace(/\s+/g,' ').trim();
  }

  // ---------- 中身を集める ----------
  var coverIdx=-1;
  var DATA=S.map(function(s,i){
    var t=s.getAttribute('data-t')||'';
    if(t==='表紙' && coverIdx<0) coverIdx=i;
    var q=(s.getAttribute('data-q')||'').split('|').map(function(x){return x.trim();}).filter(Boolean);
    var text=textOf(s);
    return { i:i, n:i+1, t:t, g:s.getAttribute('data-g')||'', q:q, text:text,
             ft:fold(t), fg:fold(s.getAttribute('data-g')||''), fq:q.map(fold), fx:fold(text) };
  });
  //  目次の番号。表紙は数えない（説明書の通し番号と同じ数え方）
  var num=0; DATA.forEach(function(d){ d.no = d.i===coverIdx ? 0 : ++num; });
  W.TSUGU_DOC={
    title:TITLE, file:FILE, kind:KIND,
    slides:DATA.map(function(d){ return {n:d.n, t:d.t, g:d.g, q:d.q.slice(), text:d.text.slice(0,600)}; })
  };
  function findByTitle(t){
    if(!t) return -1;
    var k, ft=fold(t).replace(/\s+/g,'');
    for(k=0;k<DATA.length;k++) if(DATA[k].t===t) return k;
    for(k=0;k<DATA.length;k++) if(DATA[k].ft.replace(/\s+/g,'')===ft) return k;
    for(k=0;k<DATA.length;k++) if(ft && DATA[k].ft.replace(/\s+/g,'').indexOf(ft)>=0) return k;
    return -1;
  }

  // ---------- 設え（CSS） ----------
  var CSS=[
  ':root{--dr-navy:#1E3A66;--dr-gold:#C39B3F;--dr-muted:#5A6981;--dr-soft:#F8F9FC;--dr-line:#E2E7EF;--dr-ink:#18202E;--dr-toph:56px;}',
  /* 切り替え（スライドで見る／目次から読む） */
  '.dr-seg{display:inline-flex;flex:0 0 auto;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);border-radius:10px;padding:2px;gap:2px;}',
  '.dr-seg button{font-family:inherit;font-size:12.5px;font-weight:600;line-height:1.2;color:#DCE3EE;background:transparent;border:none;border-radius:8px;padding:7px 11px;cursor:pointer;white-space:nowrap;}',
  '.dr-seg button:hover{color:#fff;background:rgba(255,255,255,.08);}',
  '.dr-seg button[aria-pressed="true"]{background:#fff;color:var(--dr-navy);}',
  '.dr-seg button:focus-visible,.dr-mbtn:focus-visible{outline:2px solid var(--dr-gold);outline-offset:1px;}',
  '.dr-ctl{display:inline-flex;align-items:center;gap:8px;flex:0 0 auto;}',
  '.dr-mbtn{display:none;font-family:inherit;font-size:12.5px;font-weight:700;color:#0E1B33;background:var(--dr-gold);border:none;border-radius:9px;padding:8px 12px;cursor:pointer;white-space:nowrap;}',
  /* 資料に上の帯が無いとき（商談スライドの目次から読む／募集案内）に出す帯 */
  '.dr-top{position:fixed;top:0;left:0;right:0;z-index:60;display:none;align-items:center;gap:10px;padding:9px 14px;background:rgba(26,32,48,.96);border-bottom:1px solid rgba(195,155,63,.35);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);}',
  '.dr-top .t{color:#fff;font-size:13.5px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.03em;}',
  '.dr-top .dr-back{font-family:inherit;font-size:13px;font-weight:700;background:#C39B3F;color:#0E1B33;border:none;border-radius:9px;padding:9px 14px;cursor:pointer;white-space:nowrap;}',
  'body.dr-owntop .dr-top{display:flex;}',
  'body.dr-deck:not(.dr-read) .dr-top{display:none;}',
  /* 商談スライドのスライド表示では、左上に小さく置く（右上の全画面ボタンと対に） */
  '.dr-float{position:fixed;top:10px;left:12px;z-index:25;opacity:.62;transition:opacity .2s;}',
  '.dr-float:hover,.dr-float:focus-within{opacity:1;}',
  '.dr-float .dr-seg{background:rgba(14,27,51,.72);border-color:rgba(195,155,63,.35);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);}',
  'body.pf-on .dr-float,body.dr-read .dr-float{display:none!important;}',
  'body.pf-hint .dr-float{opacity:.9;}',
  '@media screen and (max-width:820px){ body.dr-deck:not(.dr-read) .deck{padding-top:58px!important;} .dr-float{opacity:.92;} }',
  /* 上の帯の高さに合わせて、本文を下げる（説明書は2段になることがある） */
  '@media screen{ body.dr-stack .deck{padding-top:calc(var(--dr-toph) + 14px)!important;} }',
  'body.dr-stack .slide{scroll-margin-top:calc(var(--dr-toph) + 10px);}',
  /* ===== 目次から読む ===== */
  '#dr{display:none;}',
  'body.dr-read #dr{display:grid;}',
  'body.dr-read .deck,body.dr-read .bar,body.dr-read .pf-top,body.dr-read #talkp,body.dr-read .toc{display:none!important;}',
  'body.dr-read{background-color:#FAF8F3;background-image:var(--wa-asanoha-paper,none);}',
  '#dr{grid-template-columns:300px minmax(0,1fr);gap:28px;max-width:1320px;margin:0 auto;padding:calc(var(--dr-toph) + 18px) 22px 80px;align-items:start;color:var(--dr-ink);}',
  /* 左：目次・質問・索引 */
  '.dr-side{position:sticky;top:calc(var(--dr-toph) + 14px);max-height:calc(100vh - var(--dr-toph) - 28px);display:flex;flex-direction:column;background:#fff;border:1px solid #EDE7DA;border-radius:14px;box-shadow:0 10px 30px rgba(26,32,48,.07);overflow:hidden;}',
  '.dr-side-hd{padding:12px 12px 0;border-bottom:1px solid var(--dr-line);background:#fff;}',
  '.dr-side-top{display:none;align-items:center;justify-content:space-between;margin-bottom:8px;}',
  '.dr-side-top b{font-size:14px;color:var(--dr-navy);}',
  '.dr-close{font-family:inherit;font-size:13px;font-weight:600;border:1px solid var(--dr-line);background:#fff;color:var(--dr-navy);border-radius:8px;padding:6px 12px;cursor:pointer;}',
  '.dr-search{position:relative;}',
  '.dr-search input{width:100%;box-sizing:border-box;font-family:inherit;font-size:14.5px;color:var(--dr-ink);border:1.5px solid var(--dr-line);border-radius:10px;padding:10px 34px 10px 34px;background:var(--dr-soft);outline:none;-webkit-appearance:none;appearance:none;}',
  '.dr-search input:focus{border-color:var(--dr-gold);background:#fff;}',
  '.dr-search input::-webkit-search-cancel-button{display:none;}',
  '.dr-search svg{position:absolute;left:11px;top:50%;width:16px;height:16px;margin-top:-8px;color:#94A2B6;pointer-events:none;}',
  '.dr-search .dr-clear{position:absolute;right:6px;top:50%;margin-top:-13px;width:26px;height:26px;border:none;border-radius:50%;background:transparent;color:#94A2B6;font-size:16px;line-height:1;cursor:pointer;display:none;}',
  '.dr-search.has .dr-clear{display:block;}',
  '.dr-tabs{display:flex;gap:2px;margin-top:10px;}',
  '.dr-tabs button{flex:1;font-family:inherit;font-size:13px;font-weight:600;color:var(--dr-muted);background:transparent;border:none;border-bottom:2.5px solid transparent;padding:9px 2px 8px;cursor:pointer;white-space:nowrap;}',
  '.dr-tabs button[aria-selected="true"]{color:var(--dr-navy);border-bottom-color:var(--dr-gold);}',
  '.dr-tabs button[hidden]{display:none;}',
  '.dr-side.searching .dr-tabs{display:none;}',
  '.dr-side-bd{overflow-y:auto;overscroll-behavior:contain;padding:8px 8px 16px;flex:1;min-height:0;}',
  '.dr-tg{font-size:12px;font-weight:700;color:#8A6A12;letter-spacing:.08em;padding:12px 8px 5px 18px;position:relative;}',
  '.dr-tg::before{content:"";position:absolute;left:8px;top:14px;bottom:7px;width:2px;border-radius:1px;background:var(--dr-gold);}',
  '.dr-side a{display:flex;gap:8px;align-items:baseline;text-decoration:none;color:var(--dr-ink);border-radius:8px;padding:7px 8px;font-size:14px;line-height:1.55;}',
  '.dr-side a:hover{background:var(--dr-soft);}',
  '.dr-ti .n{flex:0 0 auto;font-family:"DM Sans",sans-serif;font-size:11.5px;color:#B0A184;min-width:20px;}',
  '.dr-ti.on{background:#FFF8E6;color:var(--dr-navy);font-weight:700;box-shadow:inset 3px 0 0 var(--dr-gold);}',
  '.dr-qi{flex-direction:column;gap:1px!important;}',
  '.dr-qi .q{font-weight:600;color:var(--dr-navy);}',
  '.dr-qi .q::before{content:"Q";font-family:"DM Sans",sans-serif;font-size:11px;font-weight:700;color:var(--dr-gold);margin-right:6px;}',
  '.dr-qi .to,.dr-r .c{font-size:12px;color:var(--dr-muted);}',
  '.dr-empty{font-size:13.5px;color:var(--dr-muted);line-height:1.8;padding:14px 10px;}',
  /* 索引 */
  '.dr-kana{display:flex;flex-wrap:wrap;gap:4px;padding:6px 6px 8px;border-bottom:1px solid var(--dr-line);margin-bottom:4px;}',
  '.dr-kana button{font-family:inherit;font-size:12.5px;min-width:30px;padding:4px 7px;border:1px solid var(--dr-line);border-radius:7px;background:#fff;color:var(--dr-navy);cursor:pointer;}',
  '.dr-kana button:disabled{color:#C5CDD8;cursor:default;}',
  '.dr-igh{font-size:13px;font-weight:700;color:#fff;background:var(--dr-navy);border-radius:6px;padding:3px 10px;margin:12px 4px 6px;display:inline-block;}',
  '.dr-kw{padding:5px 8px 6px;border-bottom:1px dashed #EEF1F5;}',
  '.dr-kw b{display:block;font-size:14px;color:var(--dr-ink);font-weight:600;}',
  '.dr-kw span{display:flex;flex-wrap:wrap;gap:4px;margin-top:3px;}',
  '.dr-side .dr-kw a{display:inline-block;font-size:12px;color:#2C5DA8;background:var(--dr-soft);border:1px solid var(--dr-line);border-radius:99px;padding:1px 9px;line-height:1.7;}',
  /* 検索の結果 */
  '.dr-rh{font-size:12.5px;color:var(--dr-muted);padding:6px 8px 4px;}',
  '.dr-r{flex-direction:column;gap:2px!important;border-bottom:1px solid #EEF1F5;border-radius:0!important;}',
  '.dr-r .t{font-weight:700;color:var(--dr-navy);font-size:14px;}',
  '.dr-r .qq{font-size:13px;color:var(--dr-ink);}',
  '.dr-r .sn{font-size:12.5px;color:var(--dr-muted);line-height:1.7;}',
  '.dr-side mark,.dr-main mark.dr-hit{background:#FBE7A6;color:inherit;border-radius:3px;padding:0 1px;}',
  'mark.dr-hit{transition:background-color 1.2s;}',
  'mark.dr-hit.fade{background:transparent;}',
  /* 右：本文 */
  '.dr-main{min-width:0;container-type:inline-size;}',
  '.dr-head{position:relative;border-radius:16px;padding:40px 44px;margin:0 0 14px;overflow:hidden;min-height:0!important;display:block!important;}',
  '.dr-head h1{font-size:34px!important;margin:0 0 12px;}',
  '.dr-head .sub{font-size:15.5px!important;margin:0;}',
  '.dr-head .hero-art{right:34px!important;width:170px!important;}',
  '.dr-head .hero-art .tsg-mado{width:150px!important;height:150px!important;}',
  '.dr-head .hero-art .tsg-mado svg{width:92px!important;height:92px!important;}',
  '.dr-head .talk{display:none!important;}',
  '.dr-head .tsg-mado.xl{width:84px!important;height:84px!important;margin-bottom:16px!important;} .dr-head .tsg-mado.xl svg{width:56px!important;height:56px!important;}',
  '.dr-head .mark{margin-bottom:16px!important;}',
  '.dr-head .hx{max-width:calc(100% - 200px);}',
  '.dr-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin:0 2px 18px;font-size:13px;color:var(--dr-muted);}',
  '.dr-tools .sp{flex:1;}',
  '.dr-tools button,.dr-tools label{font-family:inherit;font-size:13px;color:var(--dr-navy);background:#fff;border:1px solid var(--dr-line);border-radius:9px;padding:7px 12px;cursor:pointer;display:inline-flex;align-items:center;gap:6px;}',
  '.dr-tools input{margin:0;accent-color:#1E3A66;}',
  '.dr-card{position:relative;background:#fff;background-image:var(--wa-asanoha-paper,none);border:1px solid #EDE7DA;border-radius:14px;box-shadow:0 10px 30px rgba(26,32,48,.06);margin:0 0 18px;scroll-margin-top:calc(var(--dr-toph) + 14px);transition:box-shadow .4s;}',
  '.dr-card::before{content:"";position:absolute;left:0;right:0;top:0;height:2px;border-radius:14px 14px 0 0;background:linear-gradient(90deg,rgba(195,155,63,.55),rgba(195,155,63,.06) 62%,transparent);}',
  '.dr-card.flash{box-shadow:0 0 0 3px rgba(195,155,63,.55),0 10px 30px rgba(26,32,48,.1);}',
  '.dr-ch{display:flex;align-items:baseline;gap:10px;padding:16px 26px 10px;border-bottom:1px solid #F1ECE1;}',
  '.dr-ch .no{font-family:"DM Sans",sans-serif;font-size:13px;color:#B0A184;flex:0 0 auto;}',
  '.dr-ch .g{font-size:12px;font-weight:700;color:#8A6A12;letter-spacing:.08em;flex:0 0 auto;}',
  '.dr-ch .tt{font-size:16px;font-weight:700;color:var(--dr-navy);flex:1;min-width:0;}',
  '.dr-ch a{font-size:12px;color:#94A2B6;text-decoration:none;flex:0 0 auto;padding:2px 6px;border-radius:6px;}',
  '.dr-ch a:hover{color:var(--dr-navy);background:var(--dr-soft);}',
  '.dr-qs{display:flex;flex-wrap:wrap;gap:6px;padding:10px 26px 0;}',
  '.dr-qs span{font-size:12.5px;color:var(--dr-navy);background:#FFF8E6;border:1px solid #F0E3BD;border-radius:99px;padding:2px 10px;}',
  '.dr-qs span::before{content:"Q ";font-weight:700;color:var(--dr-gold);}',
  '.dr-slide{display:block!important;position:relative;padding:20px 26px 26px;overflow:visible;}',
  '.dr-slide::after,.dr-slide::before{display:none!important;}',
  '.dr-slide.divider{background:linear-gradient(150deg,#0F2A1E 0%,#1B4633 70%,#27684A 100%);color:#fff;border-radius:0 0 14px 14px;padding:26px 30px;}',
  '.dr-slide.divider h1{font-size:26px!important;color:#fff;margin:0 0 6px;}',
  '.dr-slide.divider .sub{color:rgba(255,255,255,.85);margin:0;}',
  '.dr-slide.dm h2{font-size:24px;}',
  '.dr-slide .talk{display:none!important;}',
  'body.dr-talk .dr-slide .talk{display:block!important;margin-top:16px;border:1px dashed #E6D6AE;background:#FFFDF6;border-radius:10px;padding:10px 16px;font-size:14px;line-height:1.9;color:var(--dr-ink);}',
  'body.dr-talk .dr-slide .talk::before{content:"話す内容";display:block;font-size:11px;font-weight:700;letter-spacing:.12em;color:#8A6A12;margin-bottom:4px;}',
  'body.dr-talk .dr-slide .talk p{margin:0 0 4px;}',
  'body.dr-talk .dr-slide .talk p>b:first-child{display:inline-block;min-width:5.4em;margin-right:.5em;color:#8A6A12;font-size:12.5px;}',
  /* 商談スライドの一枚は 16:9 の紙に収めるための作り。読み物にするときは、幅で組み直す */
  '@container (max-width:760px){ .dr-slide .g3,.dr-slide .g4,.dr-slide .tl,.dr-slide .flow{grid-template-columns:1fr 1fr!important;} .dr-slide .st3,.dr-slide .demo,.dr-slide .demo.wide{grid-template-columns:1fr!important;} .dr-slide .walls{flex-wrap:wrap;} .dr-slide .walls > *{flex:1 1 40%;} .dr-slide .duo .art{flex-basis:120px;} }',
  '@container (max-width:520px){ .dr-slide .g2,.dr-slide .g3,.dr-slide .g4,.dr-slide .tl,.dr-slide .flow,.dr-slide .grid,.dr-slide [style*="grid-template-columns"]{grid-template-columns:1fr!important;} .dr-slide .duo{flex-direction:column;} }',
  '.dr-slide .grid > *,.dr-slide [style*="grid-template-columns"] > *{min-width:0;}',
  /* 16:9 に収めるために小さくしてある本文を、読み物では少し戻す */
  '@media(min-width:900px){ .dr-slide .card p,.dr-slide .note{font-size:14.5px;} }',
  '.dr-slide table{max-width:100%;}',
  '.dr-slide .nt,.dr-slide .kv{display:table;}',
  '.dr-slide .nt th:first-child,.dr-slide .nt td:first-child{min-width:7.5em;}',
  '.dr-wide{overflow-x:auto;-webkit-overflow-scrolling:touch;max-width:100%;}',
  '.dr-foot{font-size:12.5px;color:var(--dr-muted);text-align:center;padding:10px 0 0;}',
  /* 幕（スマホで目次を開いたときの後ろ） */
  '.dr-scrim{display:none;}',
  /* ===== スマホ：目次は「目次・さがす」で開く ===== */
  '@media screen and (max-width:899px){',
  '  #dr{grid-template-columns:minmax(0,1fr);padding:calc(var(--dr-toph) + 12px) 12px 60px;gap:0;}',
  '  body.dr-read .dr-mbtn{display:inline-block;}',
  '  .dr-side{position:fixed;left:0;right:0;top:var(--dr-toph);bottom:0;max-height:none;border-radius:0;border:none;z-index:58;display:none;box-shadow:0 20px 40px rgba(0,0,0,.25);}',
  '  body.dr-drawer .dr-side{display:flex;}',
  '  body.dr-drawer .dr-scrim{display:block;position:fixed;inset:0;background:rgba(8,13,25,.35);z-index:57;}',
  '  .dr-side-top{display:flex;}',
  '  .dr-search input{font-size:16px;}',
  '  .dr-head{padding:26px 20px;border-radius:14px;}',
  '  .dr-head h1{font-size:25px!important;}',
  '  .dr-head .sub{font-size:14px!important;}',
  '  .dr-head .hero-art{display:none!important;}',
  '  .dr-head .hx{max-width:none;}',
  '  .dr-head .tsg-mado.xl{width:70px!important;height:70px!important;} .dr-head .tsg-mado.xl svg{width:48px!important;height:48px!important;}',
  '  .dr-ch{padding:13px 16px 8px;flex-wrap:wrap;gap:4px 10px;}',
  '  .dr-ch .tt{flex-basis:100%;order:3;font-size:16px;}',
  '  .dr-ch a{margin-left:auto;}',
  '  .dr-tools > span:first-child{flex-basis:100%;}',
  '  .dr-tools .sp{display:none;}',
  '  .dr-qs{padding:8px 16px 0;}',
  '  .dr-slide{padding:16px 16px 20px;}',
  '  .dr-slide h2{font-size:20px!important;}',
  '}',
  /* 上の帯：スマホでは切り替えを2段目に */
  '@media screen and (max-width:640px){',
  '  .mnv-top.dr-has,.dr-top{flex-wrap:wrap;row-gap:7px;}',
  '  .mnv-top.dr-has .dr-ctl,.dr-top .dr-ctl{order:3;flex:1 1 100%;justify-content:space-between;}',
  '  .dr-seg button{padding:7px 10px;font-size:12.5px;}',
  '}',
  /* ===== 印刷：目次から読むは、全部の頁を順に ===== */
  '@media print{',
  '  .dr-float,.dr-top,.dr-side,.dr-tools,.dr-scrim,.dr-ch a{display:none!important;}',
  '  body.dr-read .mnv-top{display:none!important;}',
  '  body.dr-read{background:#fff!important;background-image:none!important;}',
  '  body.dr-read #dr{display:block!important;padding:0!important;max-width:none;}',
  '  body.dr-read .dr-card{box-shadow:none;border:1px solid #DDD;break-inside:avoid;page-break-inside:avoid;margin:0 0 6mm;background-image:none;}',
  '  body.dr-read .dr-ch{break-after:avoid;page-break-after:avoid;}',
  '  body.dr-read .dr-head{-webkit-print-color-adjust:exact;print-color-adjust:exact;break-after:avoid;}',
  '  body.dr-read .dr-slide.divider{-webkit-print-color-adjust:exact;print-color-adjust:exact;}',
  '}'
  ].join('\n');
  var st=el('style'); st.id='dr-style'; st.textContent=CSS; D.head.appendChild(st);
  //  印刷の紙の向き。資料は A4 横で作ってあるので、目次から読むのときだけ縦にする
  var pageSt=el('style'); pageSt.id='dr-page'; pageSt.media='not all';
  pageSt.textContent='@page{size:A4 portrait;margin:12mm;}';
  D.head.appendChild(pageSt);

  body.classList.add('dr-on', KIND==='deck'?'dr-deck':'dr-stack');

  // ---------- 切り替え ----------
  var segs=[];
  function makeSeg(){
    var s=el('div','dr-seg');
    s.setAttribute('role','group'); s.setAttribute('aria-label','表示の切り替え');
    s.innerHTML='<button type="button" data-v="slide" aria-pressed="true">スライドで見る</button>'
               +'<button type="button" data-v="read" aria-pressed="false">目次から読む</button>';
    s.addEventListener('click',function(e){
      var b=e.target.closest ? e.target.closest('button') : e.target;
      if(!b||!b.getAttribute('data-v')) return;
      e.stopPropagation();
      setView(b.getAttribute('data-v'), {save:true});
    });
    segs.push(s); return s;
  }
  function makeMenuBtn(){
    var b=el('button','dr-mbtn','☰ 目次・さがす'); b.type='button';
    b.setAttribute('aria-controls','dr-side'); b.setAttribute('aria-expanded','false');
    b.addEventListener('click',function(e){ e.stopPropagation(); drawer(!body.classList.contains('dr-drawer')); });
    return b;
  }
  function makeCtl(){ var c=el('div','dr-ctl'); c.appendChild(makeSeg()); c.appendChild(makeMenuBtn()); return c; }
  function goBack(){
    if(W.self!==W.top){ try{ parent.postMessage({tsugu:'closeManual'},'*'); return; }catch(e){} }
    if(history.length>1) history.back(); else location.href='./index.html';
  }

  var mnvTop=D.querySelector('.mnv-top'), drTop=null, floatBox=null;
  if(mnvTop){
    mnvTop.classList.add('dr-has');
    var backBtn=mnvTop.querySelector('button');
    mnvTop.insertBefore(makeCtl(), backBtn||null);
  }else{
    drTop=el('div','dr-top');
    drTop.innerHTML='<span class="t">'+esc(TITLE)+'</span>';
    drTop.appendChild(makeCtl());
    //  戻る：商談スライドの右上の ✕ と同じく、プラットフォームの中で開いたときだけ出す
    if(W.self!==W.top){
      var bb=el('button','dr-back','プラットフォームに戻る ✕'); bb.type='button';
      bb.addEventListener('click',function(e){ e.stopPropagation(); goBack(); });
      drTop.appendChild(bb);
    }
    body.appendChild(drTop);
    body.classList.add('dr-owntop');
    if(KIND==='deck'){
      floatBox=el('div','dr-float'); floatBox.appendChild(makeSeg());
      body.appendChild(floatBox);
    }
  }
  function topBar(){ return mnvTop || ((KIND==='stack'||body.classList.contains('dr-read')) ? drTop : null); }
  function measureTop(){
    var b=topBar(); var h=b ? b.offsetHeight : 0;
    html.style.setProperty('--dr-toph', (h||0)+'px');
  }

  // ---------- 目次から読むの中身（最初に開いたときに組む） ----------
  var built=false, root, side, mainEl, cards=[], paneToc, paneQ, paneIdx, paneRes, qInput, tabBtns={}, curTab='toc';
  var SVG_SEARCH='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';
  function build(){
    if(built) return; built=true;
    root=el('div'); root.id='dr';
    side=el('aside','dr-side'); side.id='dr-side'; side.setAttribute('aria-label','目次と検索');
    var nq=DATA.reduce(function(a,d){return a+d.q.length;},0);
    side.innerHTML=
      '<div class="dr-side-hd">'
      +'<div class="dr-side-top"><b>目次・さがす</b><button type="button" class="dr-close">閉じる ✕</button></div>'
      +'<div class="dr-search">'+SVG_SEARCH+'<input type="search" id="dr-q" placeholder="ことば・質問でさがす" aria-label="この資料の中をさがす" autocomplete="off" enterkeyhint="search"><button type="button" class="dr-clear" aria-label="消す">×</button></div>'
      +'<div class="dr-tabs" role="tablist">'
      +'<button type="button" role="tab" data-tab="toc" aria-selected="true">目次</button>'
      +'<button type="button" role="tab" data-tab="q" aria-selected="false"'+(nq?'':' hidden')+'>質問から探す</button>'
      +'<button type="button" role="tab" data-tab="idx" aria-selected="false">索引</button>'
      +'</div></div>'
      +'<div class="dr-side-bd">'
      +'<div class="dr-pane" data-pane="toc" role="tabpanel"></div>'
      +'<div class="dr-pane" data-pane="q" role="tabpanel" hidden></div>'
      +'<div class="dr-pane" data-pane="idx" role="tabpanel" hidden></div>'
      +'<div class="dr-res" hidden aria-live="polite"></div>'
      +'</div>';
    mainEl=el('main','dr-main');
    root.appendChild(side); root.appendChild(mainEl);
    var scrim=el('div','dr-scrim'); scrim.addEventListener('click',function(){ drawer(false); });
    body.appendChild(root); body.appendChild(scrim);

    paneToc=side.querySelector('[data-pane="toc"]');
    paneQ=side.querySelector('[data-pane="q"]');
    paneIdx=side.querySelector('[data-pane="idx"]');
    paneRes=side.querySelector('.dr-res');
    qInput=side.querySelector('#dr-q');
    [].forEach.call(side.querySelectorAll('.dr-tabs button'),function(b){
      tabBtns[b.getAttribute('data-tab')]=b;
      b.addEventListener('click',function(){ setTab(b.getAttribute('data-tab')); });
    });
    side.querySelector('.dr-close').addEventListener('click',function(){ drawer(false); });
    var sbox=side.querySelector('.dr-search');
    side.querySelector('.dr-clear').addEventListener('click',function(){ qInput.value=''; runSearch(); qInput.focus(); });
    var tmr=null;
    qInput.addEventListener('input',function(){ sbox.classList.toggle('has', !!qInput.value); clearTimeout(tmr); tmr=setTimeout(runSearch,120); });
    qInput.addEventListener('keydown',function(e){
      if(e.key==='Enter'){ var a=paneRes.querySelector('a'); if(a){ e.preventDefault(); a.click(); } }
      if(e.key==='Escape'){ if(qInput.value){ qInput.value=''; runSearch(); } else drawer(false); }
    });
    //  左の一覧のどれを押しても、同じ動き（その頁へ・必要なら語を光らせる）
    side.addEventListener('click',function(e){
      var a=e.target.closest ? e.target.closest('a[data-i]') : null; if(!a) return;
      e.preventDefault();
      var i=+a.getAttribute('data-i'), hl=a.getAttribute('data-hl');
      jump(i,{smooth:true, hl:hl?hl.split('\u0001'):null, setHash:true});
      drawer(false);
    });

    // 表紙 → 頁の頭（見出し）
    if(coverIdx>=0){
      var cv=S[coverIdx].cloneNode(true);
      stripIds(cv);
      cv.className=cv.className.replace(/\bslide\b/,'').replace(/\bon\b/,'')+' dr-head';
      cv.removeAttribute('data-n'); cv.removeAttribute('data-t'); cv.removeAttribute('data-q'); cv.removeAttribute('data-g');
      var hh=el('header'); hh.className=cv.className; hh.innerHTML=cv.innerHTML;
      mainEl.appendChild(hh);
    }else{
      mainEl.appendChild(el('header','dr-head cover','<h1>'+esc(TITLE)+'</h1>'));
    }
    var hasTalk=KIND==='deck' && S.some(function(s){ return !!s.querySelector('.talk'); });
    var tools=el('div','dr-tools');
    tools.innerHTML='<span>全'+num+'項目'+(nq?'・よくある質問 '+nq+'件':'')+'</span><span class="sp"></span>'
      +(hasTalk?'<label><input type="checkbox" id="dr-talk"> 話す内容も表示</label>':'')
      +'<button type="button" id="dr-print">印刷・PDF</button>';
    mainEl.appendChild(tools);
    var tk=tools.querySelector('#dr-talk');
    if(tk){
      tk.checked=lsGet('tsugu_docview_talk')==='1';
      body.classList.toggle('dr-talk', tk.checked);
      tk.addEventListener('change',function(){ body.classList.toggle('dr-talk', tk.checked); lsSet('tsugu_docview_talk', tk.checked?'1':''); });
    }
    tools.querySelector('#dr-print').addEventListener('click',function(){ W.print(); });

    // 頁ごとの札
    DATA.forEach(function(d,i){
      if(i===coverIdx){ cards[i]=null; return; }
      var card=el('article','dr-card'); card.id='dr-'+d.n;
      card.setAttribute('data-i', i);
      var link='#t='+encodeURIComponent(d.t);
      card.innerHTML='<div class="dr-ch"><span class="no">'+pad2(d.no)+'</span>'
        +(d.g?'<span class="g">'+esc(d.g)+'</span>':'')
        +'<span class="tt" role="heading" aria-level="2">'+esc(d.t)+'</span>'
        +'<a href="'+esc(link)+'" title="この項目へのリンク" aria-label="この項目へのリンク">#</a></div>'
        +(d.q.length?'<div class="dr-qs">'+d.q.map(function(q){return '<span>'+esc(q)+'</span>';}).join('')+'</div>':'');
      var c=S[i].cloneNode(true);
      stripIds(c);
      var sec=el('section');
      sec.className=(' '+c.className+' ').replace(/ slide | on /g,' ').trim()+' dr-slide';
      sec.innerHTML=c.innerHTML;
      //  横に長い表は、札の中でだけ横に送れるようにする（頁全体を横に動かさない）
      [].forEach.call(sec.querySelectorAll('table'),function(tb){
        if(tb.closest && tb.closest('.scr')) return;
        if(tb.parentNode && !tb.parentNode.classList.contains('dr-wide')){
          var w=el('div','dr-wide'); tb.parentNode.insertBefore(w,tb); w.appendChild(tb);
        }
      });
      card.appendChild(sec);
      mainEl.appendChild(card);
      cards[i]=card;
    });
    mainEl.appendChild(el('div','dr-foot','— ここまで —'));

    buildToc(); buildQ(); buildIdx();
    //  検索欄などで打ったキーを、資料の側（→ で次へ、T で話す内容 など）に渡さない
    side.addEventListener('keydown',function(e){ e.stopPropagation(); });
  }
  function stripIds(n){
    if(n.removeAttribute) n.removeAttribute('id');
    [].forEach.call(n.querySelectorAll('[id]'),function(x){ x.removeAttribute('id'); });
  }

  // ---------- 目次 ----------
  var tocLinks=[];
  function groupRuns(){
    var runs=[], last=null;
    DATA.forEach(function(d,i){
      if(i===coverIdx) return;
      var g=d.g||'（そのほか）';
      if(!last||last.g!==g){ last={g:g, items:[]}; runs.push(last); }
      last.items.push(d);
    });
    return runs;
  }
  function buildToc(){
    var h='';
    groupRuns().forEach(function(r){
      h+='<div class="dr-tg">'+esc(r.g)+'</div>';
      r.items.forEach(function(d){
        h+='<a class="dr-ti" href="#t='+esc(encodeURIComponent(d.t))+'" data-i="'+d.i+'"><span class="n">'+pad2(d.no)+'</span><span>'+esc(d.t)+'</span></a>';
      });
    });
    paneToc.innerHTML=h;
    tocLinks=[].slice.call(paneToc.querySelectorAll('a.dr-ti'));
  }
  function buildQ(){
    var h='';
    groupRuns().forEach(function(r){
      var items=r.items.filter(function(d){return d.q.length;});
      if(!items.length) return;
      h+='<div class="dr-tg">'+esc(r.g)+'</div>';
      items.forEach(function(d){
        d.q.forEach(function(q){
          h+='<a class="dr-qi" href="#t='+esc(encodeURIComponent(d.t))+'" data-i="'+d.i+'"><span class="q">'+esc(q)+'</span><span class="to">→ '+esc(d.t)+'</span></a>';
        });
      });
    });
    paneQ.innerHTML=h||'<p class="dr-empty">この資料には、質問の一覧はまだありません。目次か検索からどうぞ。</p>';
  }

  // ---------- 索引（五十音） ----------
  var GYO=['あ','か','さ','た','な','は','ま','や','ら','わ','A–Z','漢字・その他'];
  var ROWS=['あいうえおぁぃぅぇぉゔ','かきくけこがぎぐげごゕゖ','さしすせそざじずぜぞ','たちつてとだぢづでどっ','なにぬねの','はひふへほばびぶべぼぱぴぷぺぽ','まみむめも','やゆよゃゅょ','らりるれろ','わをんゎゐゑ'];
  function gyoOf(s){
    var c=s.charCodeAt(0);
    if(c>=0x30A1&&c<=0x30F6) c-=0x60;
    if(c>=0x3041&&c<=0x3096){
      var h=String.fromCharCode(c);
      for(var r=0;r<ROWS.length;r++) if(ROWS[r].indexOf(h)>=0) return r;
    }
    if((c>=65&&c<=90)||(c>=97&&c<=122)||(c>=0xFF21&&c<=0xFF3A)||(c>=0xFF41&&c<=0xFF5A)) return 10;
    return 11;
  }
  var STOP={'自分':1,'場合':1,'最初':1,'本当':1,'必要':1,'一緒':1,'可能':1,'何':1,'誰':1,'画面':1,'いま':1,'今':1};
  function cleanTerm(s){
    s=String(s||'').replace(/\s+/g,' ').trim();
    s=s.replace(/^([①-⑳❶-❿]|[0-9０-９]+[.．)）])\s*/,'');
    s=s.replace(/^[・「『“"'（(【\[\s]+/,'').replace(/[」』”"'）)】\]\s。、，,.:：！!？?…]+$/,'');
    if(/^[「『]/.test(s)===false) s=s.replace(/[」』]$/,'');
    return s.trim();
  }
  function okTerm(s){
    if(!s||s.length<2||s.length>24) return false;
    if(/[。、，]/.test(s)) return false;
    if(/(ます|です|ません|ください|ましょう|でした)$/.test(s)) return false;
    if(/^[\d０-９,.，．%％¥￥+\-−~〜\s万円年月日か月ヶ月社名件本倍点時分秒]+$/.test(s)) return false;
    if(/^[\d０-９]+[,.\d]*\s*(年|か月|ヶ月|月|日|社|名|件|%|％|万|円|倍|本|点|時|分)/.test(s)) return false;
    if(STOP[s]) return false;
    if(!/[぀-ヿ一-鿿A-Za-zＡ-Ｚａ-ｚ]/.test(s)) return false;
    return true;
  }
  function buildIdx(){
    var map={};  // key → {term, slides:{i:1}, order:[]}
    function add(term, i){
      term=cleanTerm(term); if(!okTerm(term)) return;
      var key=fold(term).replace(/\s+/g,'');
      var o=map[key]; if(!o) o=map[key]={term:term, list:[]};
      if(o.list.indexOf(i)<0) o.list.push(i);
    }
    DATA.forEach(function(d,i){
      if(i===coverIdx) return;
      add(d.t, i);
      var s=S[i];
      [].forEach.call(s.querySelectorAll('h2,h3,th,.card h3'),function(e){
        if(e.closest && (e.closest('.talk')||e.closest('.scr'))) return;
        var tx=textOf(e);
        //  「出口の設計 ― どの会社にも出口があります」は、前だけを語にする
        var parts=tx.split(/\s*[―—]\s*|｜/);
        if(parts.length>1) tx=parts[0];
        add(tx, i);
      });
      d.q.forEach(function(q){
        (q.match(/[一-鿿゠-ヿーA-Za-zＡ-Ｚａ-ｚ0-9０-９&＆・\-]{2,}/g)||[]).forEach(function(w){
          if(/^[0-9０-９]/.test(w)) return;
          w=w.replace(/^・+|・+$/g,'');
          add(w, i);
        });
      });
    });
    var coll=null; try{ coll=new Intl.Collator('ja'); }catch(e){}
    var cmp=coll?coll.compare:function(a,b){return a<b?-1:a>b?1:0;};
    var groups=GYO.map(function(){return [];});
    Object.keys(map).forEach(function(k){ var o=map[k]; groups[gyoOf(o.term)].push(o); });
    groups.forEach(function(g){ g.sort(function(a,b){ return cmp(a.term,b.term); }); });
    var h='<div class="dr-kana">'+GYO.map(function(l,gi){
      return '<button type="button" data-g="'+gi+'"'+(groups[gi].length?'':' disabled')+'>'+l+'</button>';
    }).join('')+'</div>';
    groups.forEach(function(g,gi){
      if(!g.length) return;
      h+='<div class="dr-ig" data-g="'+gi+'"><div class="dr-igh">'+GYO[gi]+'</div>';
      g.forEach(function(o){
        h+='<div class="dr-kw"><b>'+esc(o.term)+'</b><span>'+o.list.map(function(i){
          return '<a href="#t='+esc(encodeURIComponent(DATA[i].t))+'" data-i="'+i+'" data-hl="'+esc(o.term)+'">'+esc(DATA[i].t)+'</a>';
        }).join('')+'</span></div>';
      });
      h+='</div>';
    });
    paneIdx.innerHTML=h;
    paneIdx.querySelector('.dr-kana').addEventListener('click',function(e){
      var b=e.target.closest ? e.target.closest('button[data-g]') : null; if(!b) return;
      var t=paneIdx.querySelector('.dr-ig[data-g="'+b.getAttribute('data-g')+'"]');
      var bd=side.querySelector('.dr-side-bd');
      if(t&&bd) bd.scrollTop=t.offsetTop-bd.offsetTop-4;
    });
    W.TSUGU_DOC.index=Object.keys(map).length;
  }

  function setTab(t){
    if(!tabBtns[t]||tabBtns[t].hidden) t='toc';
    curTab=t;
    Object.keys(tabBtns).forEach(function(k){ tabBtns[k].setAttribute('aria-selected', k===t?'true':'false'); });
    paneToc.hidden=t!=='toc'; paneQ.hidden=t!=='q'; paneIdx.hidden=t!=='idx';
    var bd=side.querySelector('.dr-side-bd'); if(bd) bd.scrollTop=0;
    if(t==='toc') syncToc(true);
  }

  // ---------- 検索 ----------
  function terms(q){ return fold(q).trim().split(/\s+/).filter(Boolean); }
  function markHtml(src, ts){
    var f=fold(src), rng=[];
    ts.forEach(function(t){ var p=0, k; while(t && (k=f.indexOf(t,p))>=0){ rng.push([k,k+t.length]); p=k+t.length; } });
    if(!rng.length) return esc(src);
    rng.sort(function(a,b){return a[0]-b[0];});
    var out='', pos=0;
    rng.forEach(function(r){ if(r[0]<pos) r[0]=pos; if(r[1]<=r[0]) return; out+=esc(src.slice(pos,r[0]))+'<mark>'+esc(src.slice(r[0],r[1]))+'</mark>'; pos=r[1]; });
    return out+esc(src.slice(pos));
  }
  function search(q){
    var ts=terms(q); if(!ts.length) return [];
    function run(all){
      var res=[];
      DATA.forEach(function(d,i){
        var hay=d.ft+' '+d.fg+' '+d.fq.join(' ')+' '+d.fx;
        var hit=ts.filter(function(t){ return hay.indexOf(t)>=0; });
        if(all ? hit.length<ts.length : !hit.length) return;
        var sc=0;
        hit.forEach(function(t){
          if(d.ft.indexOf(t)>=0) sc+=10;
          d.fq.forEach(function(x){ if(x.indexOf(t)>=0) sc+=6; });
          if(d.fg.indexOf(t)>=0) sc+=2;
          var c=0,p=0,k; while((k=d.fx.indexOf(t,p))>=0 && c<5){ c++; p=k+t.length; } sc+=c;
        });
        res.push({i:i, sc:sc});
      });
      return res;
    }
    var r=run(true); if(!r.length && ts.length>1) r=run(false);
    r.sort(function(a,b){ return b.sc-a.sc || a.i-b.i; });
    return r.map(function(x){ return x.i; });
  }
  function snippet(d, ts){
    var at=-1;
    ts.forEach(function(t){ var k=d.fx.indexOf(t); if(k>=0 && (at<0||k<at)) at=k; });
    if(at<0) return '';
    var a=Math.max(0,at-30), b=Math.min(d.text.length, at+60);
    return (a>0?'…':'')+markHtml(d.text.slice(a,b), ts)+(b<d.text.length?'…':'');
  }
  function runSearch(){
    if(!built) return;
    var q=qInput.value.trim();
    side.querySelector('.dr-search').classList.toggle('has', !!qInput.value);
    if(!q){ side.classList.remove('searching'); paneRes.hidden=true; setTab(curTab); return; }
    side.classList.add('searching');
    paneToc.hidden=paneQ.hidden=paneIdx.hidden=true; paneRes.hidden=false;
    var ts=terms(q), list=search(q);
    var hl=ts.join('\u0001');
    var h='<div class="dr-rh">「'+esc(q)+'」 '+(list.length?list.length+'件':'見つかりませんでした')+'</div>';
    if(!list.length) h+='<p class="dr-empty">ことばを短くするか、別の言い方でお試しください。<br>例：「解約」「手元資金」「報酬」</p>';
    list.forEach(function(i){
      var d=DATA[i];
      var qs=d.q.filter(function(x){ var f=fold(x); return ts.some(function(t){ return f.indexOf(t)>=0; }); }).slice(0,2);
      h+='<a class="dr-r" href="#t='+esc(encodeURIComponent(d.t))+'" data-i="'+i+'" data-hl="'+esc(hl)+'">'
        +(d.g?'<span class="c">'+esc(d.g)+'</span>':'')
        +'<span class="t">'+(d.no?pad2(d.no)+' ':'')+markHtml(d.t||'表紙', ts)+'</span>'
        +qs.map(function(x){ return '<span class="qq">Q '+markHtml(x, ts)+'</span>'; }).join('')
        +'<span class="sn">'+snippet(d, ts)+'</span></a>';
    });
    paneRes.innerHTML=h;
    var bd=side.querySelector('.dr-side-bd'); if(bd) bd.scrollTop=0;
  }

  // ---------- その頁へ ----------
  var hlTimer=null;
  function clearHits(){
    [].forEach.call(D.querySelectorAll('mark.dr-hit'),function(m){
      var p=m.parentNode; if(!p) return;
      p.replaceChild(D.createTextNode(m.textContent), m); p.normalize();
    });
  }
  function highlight(card, words){
    clearHits(); clearTimeout(hlTimer);
    var ts=(words||[]).map(function(w){ return fold(w).trim(); }).filter(Boolean);
    if(!ts.length||!card) return;
    var sec=card.querySelector('.dr-slide')||card;
    var talkOn=body.classList.contains('dr-talk');
    var walker=D.createTreeWalker(sec, NodeFilter.SHOW_TEXT, {acceptNode:function(n){
      var p=n.parentNode;
      while(p && p!==sec){ if(p.nodeName==='svg'||p.nodeName==='SCRIPT'||p.nodeName==='STYLE'||(!talkOn&&p.classList&&p.classList.contains('talk'))) return NodeFilter.FILTER_REJECT; p=p.parentNode; }
      return NodeFilter.FILTER_ACCEPT;
    }});
    var nodes=[], n; while((n=walker.nextNode())) nodes.push(n);
    nodes.forEach(function(tn){
      var s=tn.nodeValue, f=fold(s), rng=[];
      ts.forEach(function(t){ var p=0,k; while((k=f.indexOf(t,p))>=0){ rng.push([k,k+t.length]); p=k+t.length; } });
      if(!rng.length) return;
      rng.sort(function(a,b){return a[0]-b[0];});
      var frag=D.createDocumentFragment(), pos=0;
      rng.forEach(function(r){
        if(r[0]<pos) r[0]=pos; if(r[1]<=r[0]) return;
        if(r[0]>pos) frag.appendChild(D.createTextNode(s.slice(pos,r[0])));
        var m=D.createElement('mark'); m.className='dr-hit'; m.textContent=s.slice(r[0],r[1]); frag.appendChild(m);
        pos=r[1];
      });
      if(pos<s.length) frag.appendChild(D.createTextNode(s.slice(pos)));
      tn.parentNode.replaceChild(frag, tn);
    });
    hlTimer=setTimeout(function(){
      [].forEach.call(D.querySelectorAll('mark.dr-hit'),function(m){ m.classList.add('fade'); });
      hlTimer=setTimeout(clearHits, 1400);
    }, 3200);
  }
  var spyLock=0;
  function jump(i, o){
    o=o||{};
    if(i<0||i>=S.length) return;
    if(isRead()){
      build();
      var target=(i===coverIdx) ? null : cards[i];
      var y=target ? target.getBoundingClientRect().top + W.pageYOffset - (parseFloat(getComputedStyle(html).getPropertyValue('--dr-toph'))||0) - 12 : 0;
      spyLock=Date.now()+(o.smooth?900:200);
      setCur(i);
      try{ W.scrollTo({top:Math.max(0,y), behavior:(o.smooth&&!REDUCE)?'smooth':'auto'}); }catch(e){ W.scrollTo(0,Math.max(0,y)); }
      if(target){
        target.classList.add('flash'); setTimeout(function(){ target.classList.remove('flash'); }, 1600);
        if(o.hl) highlight(target, o.hl);
      }
    }else if(KIND==='deck'){
      if(typeof W.show==='function') W.show(i);
    }else{
      stackTo(i, o.smooth);
    }
    if(o.setHash){ try{ history.replaceState(null,'', location.pathname+location.search+'#t='+encodeURIComponent(DATA[i].t)); }catch(e){} }
  }
  //  説明書（縦に並ぶ作り）のスライド表示で、その頁の位置へ送る
  function stackTo(i, smooth){
    var s=S[i]; if(!s) return;
    var y= i===0 ? 0 : s.getBoundingClientRect().top + W.pageYOffset - (parseFloat(getComputedStyle(html).getPropertyValue('--dr-toph'))||0) - 10;
    spyLock=Date.now()+(smooth?900:250);
    try{ W.scrollTo({top:Math.max(0,y), behavior:(smooth&&!REDUCE)?'smooth':'auto'}); }catch(e){ W.scrollTo(0,Math.max(0,y)); }
    if(typeof W.i==='number') W.i=i;
    CUR=i;
  }

  // ---------- いまどこを読んでいるか ----------
  var CUR=0, rafOn=false;
  function setCur(i){ CUR=i; syncToc(false); }
  function syncToc(scrollIntoList){
    tocLinks.forEach(function(a){ a.classList.toggle('on', +a.getAttribute('data-i')===CUR); });
    if(!built || curTab!=='toc' || side.classList.contains('searching')) return;
    var on=paneToc.querySelector('a.on'), bd=side.querySelector('.dr-side-bd');
    if(on && bd){
      var top=on.offsetTop-bd.offsetTop, bot=top+on.offsetHeight;
      if(top<bd.scrollTop+8) bd.scrollTop=Math.max(0,top-40);
      else if(bot>bd.scrollTop+bd.clientHeight-8) bd.scrollTop=bot-bd.clientHeight+40;
    }
  }
  function currentFrom(list){
    var line=(parseFloat(getComputedStyle(html).getPropertyValue('--dr-toph'))||0)+90, cur=coverIdx>=0?coverIdx:0;
    for(var k=0;k<list.length;k++){
      var e=list[k]; if(!e) continue;
      if(e.getBoundingClientRect().top<=line) cur=k; else break;
    }
    return cur;
  }
  function onScroll(){
    if(rafOn) return; rafOn=true;
    (W.requestAnimationFrame||setTimeout)(function(){
      rafOn=false;
      if(isRead()){
        if(Date.now()<spyLock) return;
        var c=currentFrom(cards);
        if(c!==CUR) setCur(c);
      }else if(KIND==='stack'){
        if(Date.now()<spyLock) return;
        var s=currentFrom(S);
        if(typeof W.i==='number') W.i=s;
        CUR=s;
      }
    });
  }
  W.addEventListener('scroll', onScroll, {passive:true});

  // ---------- 見え方を変える ----------
  function isRead(){ return body.classList.contains('dr-read'); }
  function paintSeg(v){
    segs.forEach(function(s){
      [].forEach.call(s.querySelectorAll('button'),function(b){ b.setAttribute('aria-pressed', b.getAttribute('data-v')===v?'true':'false'); });
    });
  }
  function drawer(on){
    if(!built) return;
    on=!!on && isRead() && W.innerWidth<900;
    body.classList.toggle('dr-drawer', on);
    html.style.overflow=on?'hidden':'';
    [].forEach.call(D.querySelectorAll('.dr-mbtn'),function(b){ b.setAttribute('aria-expanded', on?'true':'false'); });
    if(on){ syncToc(true); }
  }
  function currentSlideIndex(){
    if(KIND==='deck') return (typeof W.CUR==='number') ? W.CUR : 0;
    return CUR;
  }
  function setView(v, o){
    o=o||{};
    v = v==='read' ? 'read' : 'slide';
    var was=isRead();
    var from = (o.at!=null) ? o.at : (was ? CUR : currentSlideIndex());
    if(o.save) lsSet(LSKEY, v);
    //  URL に ?view= が付いているときは、選び直したほうに書き換える（再読み込みで戻らないように）
    if(o.save){
      try{
        var sp=new URLSearchParams(location.search);
        if(sp.has('view')){ sp.set('view', v); history.replaceState(null,'', location.pathname+'?'+sp.toString()+location.hash); }
      }catch(e){}
    }
    if(v==='read'){
      build();
      body.classList.add('dr-read');
      pageSt.media='print';
    }else{
      drawer(false);
      body.classList.remove('dr-read');
      pageSt.media='not all';
    }
    paintSeg(v);
    measureTop();
    if(v==='slide' && KIND==='deck' && typeof W.pitchFit==='function'){ try{ W.pitchFit(); }catch(e){} }
    if(was!==(v==='read') || o.force){
      if(o.noJump) return;
      jump(from, {});
    }
  }

  // ---------- キー：目次から読むでは、矢印で頁を送らない ----------
  W.addEventListener('keydown',function(e){
    if(!isRead()) return;
    var k=e.key, tag=(e.target&&e.target.tagName)||'';
    var typing=/^(INPUT|TEXTAREA|SELECT)$/.test(tag)||(e.target&&e.target.isContentEditable);
    //  打っている最中のキーは、入力欄の側で止める（ここで止めると入力欄の Enter も効かなくなる）
    if(typing) return;
    if(k==='Escape' && body.classList.contains('dr-drawer')){ drawer(false); e.stopPropagation(); return; }
    if(!typing && k==='/'){ e.preventDefault(); e.stopPropagation(); if(W.innerWidth<900) drawer(true); if(qInput){ qInput.focus(); qInput.select(); } return; }
    //  資料の側のキー（→ ← スペース Enter T F など）には渡さない。
    //  既定の動き（スペースで下へ、入力欄への文字）はそのまま効く
    if(/^(ArrowRight|ArrowLeft|ArrowUp|ArrowDown|PageUp|PageDown|Home|End| |Enter|t|T|f|F|Escape)$/.test(k)){
      e.stopPropagation();
    }
  }, true);
  //  スワイプ（pitch-fit.js）や紙を押したときの「次へ」も、目次から読むでは効かせない
  if(typeof W.mv==='function'){
    var _mv=W.mv;
    W.mv=function(d){ if(isRead()) return; return _mv(d); };
  }
  //  説明書のスライド表示：いままでは送るたびに頁の頭へ戻っていた。その頁の位置へ送る
  if(KIND==='stack' && typeof W.show==='function'){
    var _show=W.show;
    W.show=function(n){ var r=_show(n); if(!isRead()){ var k=(typeof W.i==='number')?W.i:n; stackTo(k,false); } return r; };
  }

  // ---------- URL を読む ----------
  function parseLoc(){
    var o={view:null,t:null,q:null,n:null};
    try{
      var sp=new URLSearchParams(location.search);
      o.view=sp.get('view'); o.t=sp.get('t'); o.q=sp.get('q');
    }catch(e){}
    var h=(location.hash||'').replace(/^#/,'');
    if(/^\d+$/.test(h)) o.n=parseInt(h,10);
    else if(/^(t|q|view)=/.test(h)){
      try{
        var hp=new URLSearchParams(h.replace(/\+/g,'%2B'));
        if(hp.get('t')!=null) o.t=hp.get('t');
        if(hp.get('q')!=null) o.q=hp.get('q');
        if(hp.get('view')!=null) o.view=hp.get('view');
      }catch(e){
        var m=h.match(/^(t|q)=(.*)$/);
        if(m){ var val; try{ val=decodeURIComponent(m[2]); }catch(er){ val=m[2]; } o[m[1]]=val; }
      }
    }
    return o;
  }
  function applyLoc(first){
    var o=parseLoc();
    var v=o.view==='read'||o.view==='slide' ? o.view : null;
    if(o.q) v='read';
    if(!v && first){ var saved=lsGet(LSKEY); v= saved==='read' ? 'read' : 'slide'; }
    var idx=-1;
    if(o.t) idx=findByTitle(o.t);
    else if(o.n) idx=Math.max(0,Math.min(S.length-1,o.n-1));
    if(v) setView(v, {noJump:true, at: idx>=0?idx:null});
    if(o.q && built){
      qInput.value=o.q; runSearch();
      if(W.innerWidth<900) drawer(true);
    }
    if(idx>=0) jump(idx, {hl: (o.q?terms(o.q):null)});
    else if(o.t && built){ qInput.value=o.t; runSearch(); if(isRead()&&W.innerWidth<900) drawer(true); }
    else if(first && !o.q){ /* 何も指定が無ければ、いまの位置のまま */ }
    return idx;
  }
  W.addEventListener('hashchange', function(){ applyLoc(false); });

  //  プラットフォームからの合図（iframe の中で開いたとき）
  W.addEventListener('message', function(e){
    var m=e&&e.data; if(!m||m.tsugu!=='docGo') return;
    if(m.view) setView(m.view, {noJump:true});
    if(m.q){ setView('read',{noJump:true}); qInput.value=String(m.q); runSearch(); }
    var i = m.t ? findByTitle(String(m.t)) : (m.n ? (+m.n-1) : -1);
    if(i>=0) jump(i, {hl: m.q?terms(String(m.q)):null});
  });
  W.tsuguDoc={
    view:function(v){ if(v) setView(v,{save:false}); return isRead()?'read':'slide'; },
    go:function(t){ var i= typeof t==='number' ? t-1 : findByTitle(String(t)); if(i>=0) jump(i,{}); return i>=0; },
    search:function(q){ setView('read',{noJump:true}); qInput.value=String(q||''); runSearch(); return search(String(q||'')).map(function(i){ return DATA[i].t; }); }
  };

  // ---------- はじめ ----------
  measureTop();
  paintSeg('slide');
  var firstIdx=applyLoc(true);
  //  文字の読み込みで高さが変わるので、読み終わりにもう一度だけ合わせる（人が動かしていなければ）
  var touched=false;
  ['wheel','touchstart','keydown','mousedown'].forEach(function(ev){ W.addEventListener(ev,function(){ touched=true; },{passive:true, once:true}); });
  function settle(){
    measureTop();
    if(!touched && firstIdx>=0) jump(firstIdx, {});
  }
  W.addEventListener('load', settle);
  try{ if(D.fonts && D.fonts.ready) D.fonts.ready.then(settle); }catch(e){}
  W.addEventListener('resize', function(){ measureTop(); if(W.innerWidth>=900) drawer(false); });
  try{ if(W.ResizeObserver){ var ro=new ResizeObserver(measureTop); if(mnvTop) ro.observe(mnvTop); if(drTop) ro.observe(drTop); } }catch(e){}
})();
