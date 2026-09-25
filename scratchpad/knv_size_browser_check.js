// ブラウザでの確かめ（手元で実行）：scratchpad の mkknvsz.js で knvsz.html を作ってから node で走らせる。
// 116項目。1440/1280/1024/390px × 大きさ4つ × ボタン4か所。スクロールの連鎖・背後の留め・閉じたときの位置まで
const { chromium } = require('./pw/node_modules/playwright-core');
const res=[]; const ok=(n,c,d)=>res.push([c?'OK ':'NG ',n,d===undefined?'':JSON.stringify(d)]);
(async()=>{
  const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--no-sandbox']});
  async function page(w,h,size,fab){
    const pg=await b.newPage({viewport:{width:w,height:h}});
    const errs=[]; pg.on('pageerror',e=>errs.push(e.message));
    await pg.goto('file://'+__dirname+'/knvsz.html'); await pg.waitForTimeout(100);
    await pg.evaluate(([s,f])=>{ knvSetSize(s); knvSetFab(f||'rb'); },[size,fab]);
    pg.errs=errs; return pg;
  }
  const st=pg=>pg.evaluate(()=>{const p=$('knv-panel').getBoundingClientRect(),a=$('app');return{y:window.scrollY,by:$('knv-body').scrollTop,
    open:!$('knv-panel').classList.contains('hidden'),fixed:document.body.style.position,pl:parseFloat(getComputedStyle(a).paddingLeft),pr:parseFloat(getComputedStyle(a).paddingRight),
    L:Math.round(p.left),R:Math.round(p.right),T:Math.round(p.top),B:Math.round(p.bottom),W:Math.round(p.width),H:Math.round(p.height),vw:innerWidth,vh:innerHeight,
    scrim:getComputedStyle($('knv-scrim')).display}});
  async function open(pg){ await pg.evaluate(()=>{ window.scrollTo(0,800); }); await pg.waitForTimeout(50); await pg.evaluate(()=>knvToggle(true)); await pg.waitForTimeout(450); }
  async function wheelAt(pg,x,y,dy){ await pg.mouse.move(x,y); await pg.mouse.wheel(0,dy); await pg.waitForTimeout(250); }

  for(const [W,H] of [[1440,900],[1280,800]]){
    for(const size of ['float','right','left','center']){
      const pg=await page(W,H,size); await open(pg);
      let s=await st(pg); const tag=W+' '+size;
      // 形
      if(size==='right') ok(tag+' 右半分：右端から画面の高さいっぱい・幅は max(600,50vw)', s.R===s.vw && s.T===0 && s.H===s.vh && Math.abs(s.W-Math.max(600,s.vw/2))<=1, s);
      if(size==='left') ok(tag+' 左半分：左端から', s.L===0 && s.T===0 && s.H===s.vh && Math.abs(s.W-Math.max(600,s.vw/2))<=1, s);
      if(size==='center') ok(tag+' 中央：左右上下の余白が同じ・幕が出る', Math.abs(s.L-(s.vw-s.R))<=1 && Math.abs(s.T-(s.vh-s.B))<=1 && s.scrim==='block', s);
      if(size==='float') ok(tag+' 標準：右下の小窓（600px）', s.W===600 && s.vw-s.R===20, s);
      // 本体を横に寄せる（半分）／寄せない（標準・中央）
      const push = size==='right'? s.pr : size==='left'? s.pl : Math.max(s.pl,s.pr);
      if(size==='right'||size==='left') ok(tag+' 本体をパネルの幅だけ寄せる', Math.abs(push-s.W)<=1, {push,W:s.W});
      else ok(tag+' 本体は寄せない', push===0, push);
      // 背後を留めるのは中央だけ
      ok(tag+' 背後を留める＝'+(size==='center'), (s.fixed==='fixed')===(size==='center'), s.fixed);
      // パネルの中身で送る → 中身だけ動き、背後は動かない
      const y0=(await st(pg)).y, by0=s.by;
      const cx=Math.round((s.L+s.R)/2);
      await wheelAt(pg,cx,s.T+300,600);
      s=await st(pg); ok(tag+' 中身で送ると中身が動く', s.by>by0, {by0,by:s.by}); ok(tag+' 中身で送っても背後は動かない', s.y===y0, {y0,y:s.y});
      // 中身を下まで送りきって、さらに送る → 背後へ流れない
      await pg.evaluate(()=>{ $('knv-body').scrollTop=1e6; }); await wheelAt(pg,cx,s.T+300,800);
      s=await st(pg); ok(tag+' 送りきった勢いが背後へ流れない', s.y===y0, {y0,y:s.y});
      // 見出しの上で送る → 背後へ流れない
      await wheelAt(pg,cx-60,s.T+25,600);
      s=await st(pg); ok(tag+' 見出しの上で送っても背後は動かない', s.y===y0, {y0,y:s.y});
      // パネルの外（本体）で送る
      if(size!=='center'){
        const ox = size==='left' ? s.R+200 : Math.max(260, s.L-200);
        const bx = size==='left' ? Math.min(s.vw-30, s.R+200) : ox;
        await wheelAt(pg,bx,400,500);
        s=await st(pg); ok(tag+' パネルの外で送ると本体が動く', s.y>y0, {y0,y:s.y});
        // 本体を押す：半分（1200px以上）は閉じない、標準は閉じる
        await pg.waitForTimeout(400);
        await pg.mouse.click(bx,500); await pg.waitForTimeout(350);
        s=await st(pg);
        if(size==='float') ok(tag+' 標準：外側を押すと閉じる', !s.open);
        else ok(tag+' 半分：本体を押しても閉じない（横に並べて使う）', s.open);
      } else {
        // 幕の上で送っても背後は動かない（留めてある）
        await wheelAt(pg,40,s.vh-40,600);
        s=await st(pg); ok(tag+' 幕の上で送っても背後は動かない', s.y===0 || s.y===y0, {y:s.y});
        await pg.waitForTimeout(400);
        await pg.mouse.click(30,30); await pg.waitForTimeout(350);
        s=await st(pg); ok(tag+' 幕を押すと閉じる', !s.open);
        ok(tag+' 閉じたら元の位置へ戻る・留めを外す', s.y===800 && s.fixed==='', {y:s.y,fixed:s.fixed});
      }
      // 閉じたら本体の寄せも戻る
      await pg.evaluate(()=>knvToggle(false)); await pg.waitForTimeout(300);
      s=await st(pg); ok(tag+' 閉じたら本体の寄せが戻る', s.pl===0 && s.pr===0 && s.scrim==='none', s);
      ok(tag+' 画面のエラーなし', pg.errs.length===0, pg.errs);
      await pg.close();
    }
  }
  // 開いたまま大きさを変える：中央→右半分で留めが外れ、右半分→中央で留まる
  { const pg=await page(1440,900,'center'); await open(pg);
    let s=await st(pg); ok('切替前：中央は留める', s.fixed==='fixed');
    await pg.evaluate(()=>knvSetSize('right')); await pg.waitForTimeout(350); s=await st(pg);
    ok('中央→右半分：留めを外し、元の位置のまま', s.fixed==='' && s.y===800 && s.pr>0, s);
    await pg.evaluate(()=>knvSetSize('center')); await pg.waitForTimeout(350); s=await st(pg);
    ok('右半分→中央：留める・寄せを戻す', s.fixed==='fixed' && s.pr===0, s);
    await pg.evaluate(()=>knvToggle(false)); await pg.waitForTimeout(300); s=await st(pg);
    ok('閉じたら元の位置', s.y===800 && s.fixed==='', s); await pg.close(); }
  // 1024px：半分を選んでいても、横に並べず端に寄せた小窓（本体は寄せない・外側で閉じる）
  { const pg=await page(1024,768,'right'); await open(pg); let s=await st(pg);
    ok('1024 右半分：600px の小窓・本体は寄せない', s.W===600 && s.R===s.vw && s.pr===0, s);
    await pg.waitForTimeout(400); await pg.mouse.click(300,400); await pg.waitForTimeout(350); s=await st(pg);
    ok('1024 右半分：外側を押すと閉じる', !s.open); await pg.close(); }
  // スマホ（390px）：どれを選んでも画面いっぱい・背後を留める
  for(const size of ['float','right','left','center']){
    const pg=await page(390,844,size); await open(pg); let s=await st(pg);
    ok('390 '+size+'：画面いっぱい・背後を留める・本体を寄せない', s.W===374 && s.fixed==='fixed' && s.pl===0 && s.pr===0, s);
    await pg.evaluate(()=>knvToggle(false)); await pg.waitForTimeout(300); s=await st(pg);
    ok('390 '+size+'：閉じたら元の位置', s.y===800 && s.fixed==='', s); await pg.close();
  }
  // ボタンの場所
  for(const [W,H] of [[1440,900],[390,844]]){
    for(const f of ['rb','lb','rt','lt']){
      const pg=await page(W,H,'float',f);
      const r=await pg.evaluate(()=>{const x=$('knv-fab').getBoundingClientRect();return{L:Math.round(x.left),R:Math.round(x.right),T:Math.round(x.top),B:Math.round(x.bottom),vw:innerWidth,vh:innerHeight};});
      const left=f[0]==='l', top=f[1]==='t';
      const sbw = W>760?238:0;
      const good = (left ? r.L>=sbw+10 && r.L<sbw+60 : r.vw-r.R<=40) && (top ? r.T>=56 && r.T<100 : r.vh-r.B<=40);
      ok(W+' ボタン '+f+'：左メニューにも見出しにも重ならない', good, r);
      if(W===1440){ // 標準の小窓は、ボタンのある隅から出る
        await pg.evaluate(()=>knvToggle(true)); await pg.waitForTimeout(450);
        const p=await st(pg);
        const g2=(left? p.L===258 : p.vw-p.R===20) && (top? p.T===20 : p.vh-p.B===20);
        ok('1440 小窓は '+f+' の隅から', g2, p);
      }
      await pg.close();
    }
  }
  await b.close();
  const ng=res.filter(r=>r[0]==='NG ');
  res.forEach(r=>console.log(r.join(' ')));
  console.log(ng.length? ('NG '+ng.length+'件') : ('ぜんぶ通りました '+res.length+'件'));
})();
