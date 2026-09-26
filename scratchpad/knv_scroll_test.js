// =============================================================
// 継ナビくんの中で送ったのに、背後の画面が動いてしまう（スクロールの連鎖）
//   ① 中身・パネル本体・週の横送り・表・質問ガイドに overscroll-behavior
//   ② 見出しやタブのように、そもそも動かない所は上の仕掛けが効かないので
//      「どの箱も動けないときだけ」送りを止める
//   ③ スマホは、開いているあいだ背後を留める（iPhone は ① ② でも動くため）
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const VER = JSON.parse(R('version.json'));
let n = 0, bad = [];
function is(name, got, want) { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) bad.push({ name, got: g, want: w }); }
function ok(name, cond) { is(name, !!cond, true); }
function no(name, cond) { is(name, !!cond, false); }
function takeFn(name) {
  const re = new RegExp('\\n  (?:async )?function ' + name + '\\s*\\(', 'g');
  let m, last = null, cnt = 0;
  while ((m = re.exec(SRC)) !== null) { last = m; cnt++; }
  if (!last) throw new Error('見つかりません: ' + name);
  is('定義は一つだけ: ' + name, cnt, 1);
  return SRC.slice(last.index, SRC.indexOf('\n  }\n', last.index) + 4);
}

// ① 連鎖を止める指定
{
  ok('パネルの中身', /\.knv-body\{flex:1;overflow-y:auto;overscroll-behavior:contain;/.test(SRC));
  ok('パネル本体', /\.knv-panel\{[^}]*overflow:hidden;overscroll-behavior:contain;/.test(SRC));
  ok('週表示の横送り', /\.wk-wrap\{overflow-x:auto;overscroll-behavior-x:contain;/.test(SRC));
  ok('AIの答えの中の表', /\.ai-tblwrap\{overflow-x:auto;overscroll-behavior-x:contain;/.test(SRC));
  ok('質問ガイドの箱', /id="knv-guide"[^>]*max-height:210px;overflow:auto;overscroll-behavior:contain;/.test(SRC));
  ok('なぜ要るかを書いてある', /背後の画面に伝わらないようにする。これが無いと、継ナビくんの中を/.test(SRC));
}

// ② 受け取れない送りは流さない
{
  const f = takeFn('knvCanTake');
  //  実物を動かして、判定が正しいか見る（DOMの代わりに最小の張りぼてを渡す）
  const CS = {};
  const g = new Function('getComputedStyle', '$', 'document', f + 'return knvCanTake;')(
    (el) => ({ overflowY: el.oy || 'visible' }),
    () => ({ __panel: 1 }),
    { body: { __body: 1 } });
  const panel = { __panel: 1 };
  //  ※ $('knv-panel') は毎回新しい張りぼてを返すと止まらないので、同じものを返す版で作り直す
  const g2 = new Function('getComputedStyle', '$', 'document', f + 'return knvCanTake;')(
    (el) => ({ overflowY: el.oy || 'visible' }), () => panel, { body: { __body: 1 } });
  const mk = (o) => Object.assign({ nodeType: 1, scrollHeight: 0, clientHeight: 0, scrollTop: 0, parentNode: panel }, o);
  is('動ける箱がある（下へ）', g2(mk({ oy: 'auto', scrollHeight: 500, clientHeight: 100, scrollTop: 0 }), 1), true);
  is('いちばん下まで来ている（下へ）', g2(mk({ oy: 'auto', scrollHeight: 500, clientHeight: 100, scrollTop: 400 }), 1), false);
  is('いちばん下でも、上へは動ける', g2(mk({ oy: 'auto', scrollHeight: 500, clientHeight: 100, scrollTop: 400 }), -1), true);
  is('いちばん上で、上へは動けない', g2(mk({ oy: 'auto', scrollHeight: 500, clientHeight: 100, scrollTop: 0 }), -1), false);
  is('そもそも動かない箱（見出し・タブ）', g2(mk({ oy: 'visible' }), 1), false);
  is('はみ出していない箱', g2(mk({ oy: 'auto', scrollHeight: 100, clientHeight: 100 }), 1), false);
  //  親をたどること。押された所が動かなくても、その上に動く箱があれば任せる
  const inner = mk({ oy: 'visible' });
  inner.parentNode = mk({ oy: 'auto', scrollHeight: 500, clientHeight: 100, scrollTop: 0 });
  is('親に動ける箱があれば任せる', g2(inner, 1), true);

  const w = takeFn('knvWheelGuard');
  ok('掛けるのは一度だけ', /if\(!p\|\|p\.__knvWheel\) return;/.test(w) && /p\.__knvWheel=1;/.test(w));
  ok('止められる形で受ける', /\{ passive:false \}/.test(w));
  ok('横の送りには手を出さない', /if\(!e\.deltaY\) return;/.test(w));
  ok('受け取れないときだけ止める', /if\(!knvCanTake\(e\.target, e\.deltaY\)\) e\.preventDefault\(\);/.test(w));
}

// ③ スマホは背後を留める
{
  const f = takeFn('knvLock');
  //  中央に大きく、を選んでいるときも留める（2026-09-25）
  ok('狭い画面と、中央に大きく', /if\(KNV_LOCK_Y!==null \|\| !\(knvNarrow\(\) \|\| knvCentered\(\)\)\) return;/.test(f));
  ok('いまの位置を覚える', /KNV_LOCK_Y=window\.pageYOffset\|\|document\.documentElement\.scrollTop\|\|0;/.test(f));
  ok('body ごと留める（overflow だけでは iPhone は止まらない）', /b\.style\.position='fixed';/.test(f)
      && /b\.style\.top=\(-KNV_LOCK_Y\)\+'px';/.test(f) && /b\.style\.overflow='hidden';/.test(f));
  ok('外すときは元の位置へ戻す', /window\.scrollTo\(0,y\);/.test(f));
  ok('二重に外さない', /if\(KNV_LOCK_Y===null\) return;/.test(f));
  ok('境目は CSS と同じ600px', /matchMedia\('\(max-width:600px\)'\)\.matches/.test(takeFn('knvNarrow')));
  //  掛け外しの場所
  const t = takeFn('knvToggle');
  ok('開くときに掛ける', /knvLock\(true\);        \/\/ 背後の画面を留める（スマホと、中央に大きく）/.test(t));
  ok('開くときに送りの番人も掛ける', /knvWheelGuard\(\);      \/\/ 受け取れない送りを背後へ流さない/.test(t));
  ok('閉じるときに外す', /knvLock\(false\);         \/\/ 留めていた背後を、元の位置のまま返す/.test(t));
  //  knvToggle を通らない道（ログイン画面へ戻すときなど）でも外す
  ok('別の道で隠すときも外す', /if\(typeof knvLock==='function'\) knvLock\(false\);/.test(takeFn('knvHideAll')));
}

// ④ 版
{
  const build = SRC.match(/var APP_BUILD='([^']+)'/)[1];
  is('版が揃う', [build, VER.build], ['20260926-04', '20260926-04']);
}
console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
