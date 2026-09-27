// =============================================================
// 経営者の使い方ガイド（実画面ツアー）2026-09-27
//   ① 過不足：画面の上から下・メニューの上から下の順に、いまある欄をすべて指す
//   ② 右下の継ナビくん（固定の要素）の段が落ちない
//   ③ 動き：スクロールと枠・吹き出しを同じ時間・同じ緩急で一度に動かす
//      （「一旦真ん中へ行ってから目的地へ」をなくす）。画面の切り替えは薄くしてから
//   ④ はじめての払いの案内と重ねない
//   ⑤ 説明書・名前の衝突・版
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const MANC = R('manual-customer.html'), PITCH = R('pitch-customer.html');
let n = 0, bad = [];
function ok(name, c) { n++; if (!c) bad.push(name); }
function takeFn(name) {
  const re = new RegExp('\\n  (?:async )?function ' + name + '\\s*\\(', 'g');
  let m, last = null, cnt = 0;
  while ((m = re.exec(SRC)) !== null) { last = m; cnt++; }
  if (!last) throw new Error('見つかりません: ' + name);
  ok('定義は一つだけ: ' + name, cnt === 1);
  return SRC.slice(last.index, SRC.indexOf('\n  }\n', last.index) + 4);
}

// ① 段の並び（過不足）
const stepsSrc = SRC.slice(SRC.indexOf('  var CT_STEPS=['), SRC.indexOf('  var CT=null, CT_KEY='));
const titles = [...stepsSrc.matchAll(/\n\s+t:'([^']+)'/g)].map((m) => m[1]);
const want = ['経営者ダッシュボードへようこそ', 'いまの手元資金（ご自身で入れるのはここだけ）', '土台づくりと、伴走の1年', 'これまでに増えた現金',
  '一緒に見る人・顧問税理士', '担当パートナーと、次の面談', '資金繰りステータス', '経営サマリー', '要対応アクション',
  '価値の流れ（支援ステップ）', '担当パートナーからの提案', 'メッセージ', '月次レポート', '導入診断報告書', '面談の記録（議事録）', '経営課題の取り組み', 'お支払い・ご契約',
  '財務・資金繰り', '企業価値・承継シミュレーション', '継ナビくん（右下にいつでも）', '画面の切り替え', 'このガイドはいつでも見返せます'];
ok('段の並び（画面の上から下、メニューの上から下）', JSON.stringify(titles) === JSON.stringify(want));
{
  //  ダッシュボードの欄の並び（描画の順）と、ガイドが指す順が揃っている
  const ids = ['dash-hero', 'my-cash', 'my-onboard', 'my-impact', 'my-members', 'my-acct', 'my-partner', 'my-nextmeet', 'cash-status', 'kpi-cards', 'todo-list', 'sec-journey', 'my-notes', 'my-reports', 'my-obr', 'my-meetings'];
  const pos = ids.map((id) => SRC.indexOf("id=\"" + id + "\""));
  ok('ダッシュボードの欄はこの順に並ぶ', pos.every((p) => p > 0) && pos.every((p, i) => i === 0 || p > pos[i - 1]));
  const g = (id) => stepsSrc.indexOf("'" + id + "'");
  ok('ガイドもこの順に指す', ['dash-hero', 'my-cash', 'my-onboard', 'my-impact', 'my-members', 'my-partner', 'cash-status', 'kpi-cards', 'todo-list', 'sec-journey', 'my-notes', 'my-reports', 'my-obr', 'my-meetings'].map(g).every((p, i, a) => p > 0 && (i === 0 || p > a[i - 1])));
  //  導入診断報告書と議事録は「月次レポート」のパネルの中。ダッシュボードの段として指すと、
  //  見えないので毎回落ちていた
  const repPanel = SRC.slice(SRC.indexOf('id="sec-reports"'), SRC.indexOf('id="sec-mypdca"'));
  ok('導入診断報告書・議事録は月次レポートの中にある', /id="my-obr"/.test(repPanel) && /id="my-meetings"/.test(repPanel));
  ok('ガイドも月次レポートの画面で指す', /\{ sec:'sec-reports', find:function\(\)\{ return ctFilled\('my-obr'\); \}/.test(stepsSrc) && /\{ sec:'sec-reports', find:function\(\)\{ return ctFilled\('my-meetings'\); \}/.test(stepsSrc));
}
ok('はじめの段は「まずはこの3つだけ」の枠', /find:function\(\)\{ return \$\('dash-hero'\)\|\|\$\('sec-flow'\); \}/.test(stepsSrc) && /2分ほどで/.test(stepsSrc));
ok('中身の無い欄は飛ばす', /function ctFilled\(id\)\{ var e=\$\(id\); return \(e && e\.innerHTML\) \? e : null; \}/.test(SRC)
  && ['my-cash', 'my-obr', 'my-impact', 'my-onboard', 'my-members', 'my-partner', 'my-nextmeet', 'my-notes', 'my-meetings'].every((id) => stepsSrc.includes("ctFilled('" + id + "')")));
ok('メニューの順（月次レポート→経営課題→お支払い→財務→企業価値）', ['sec-reports', 'sec-mypdca', 'sec-billpay', 'sec-cash', 'sec-value']
  .map((id) => stepsSrc.indexOf("sec:'" + id + "'")).every((p, i, a) => p > 0 && (i === 0 || p > a[i - 1])));
{
  const nav = (SRC.match(/\['sec-reports'[\s\S]{0,40}/) || [''])[0];
  const order = ['sec-reports', 'sec-mypdca', 'sec-billpay', 'sec-cash', 'sec-value'].map((id) => SRC.indexOf("['" + id + "'", SRC.indexOf("['sec-flow'")));
  ok('メニューの並びも同じ順', !!nav && order.every((p, i, a) => p > 0 && (i === 0 || p > a[i - 1])));
}
ok('経営課題の段で「やることメモ」に触れる', /同じ画面の下の「やることメモ」/.test(stepsSrc));
ok('継ナビくんの段で「予定」「TODO」に触れる', /「予定」タブ/.test(stepsSrc) && /「TODO」タブ/.test(stepsSrc));
ok('画面の切り替えの段で、出口の設計などと、スマホの払いに触れる', /出口の設計・スケールの設計・買い手になる/.test(stepsSrc) && /左右どちらの端からでも内側へ指で払うと開きます/.test(stepsSrc));
ok('右下・メニューの段は画面を切り替えない', (stepsSrc.match(/\{ sec:null, find:/g) || []).length === 2);

// ② 固定の要素
const vis = takeFn('ctVisible');
ok('固定の要素（右下の継ナビくん）を見えないと判定しない', /return el\.offsetParent!==null \|\| cs\.position==='fixed';/.test(vis) && /cs\.display==='none' \|\| cs\.visibility==='hidden'/.test(vis));
ok('固定の要素ではスクロールしない', /if\(ctIsFixed\(el\)\) return y;/.test(takeFn('ctTargetY')));
ok('固定の要素には、その段のあいだ貼り付く', /ctFollow\(tok, ctIsFixed\(el\) \? 6e5 : 200\)/.test(SRC));

// ③ 動き
const tourSrc = SRC.slice(SRC.indexOf('  var CT_STEPS=['), SRC.indexOf('  // ---- パートナー成長ロードマップ')).replace(/\/\/.*$/gm, '');
ok('ブラウザ任せのなめらかスクロールを使わない', !/scrollIntoView/.test(tourSrc) && !/behavior:'smooth'/.test(tourSrc));
ok('行き先は上の帯（.topbar2）の下から', /document\.querySelector\('\.topbar2'\)/.test(takeFn('ctTopInset')) && /ctTopInset\(\)/.test(takeFn('ctTargetY')));
ok('行き先はページの端で止める', /Math\.min\(max, Math\.max\(0, t\)\)/.test(takeFn('ctTargetY')));
{
  //  緩急：JS のスクロールと CSS の枠の移動が同じ曲線
  const ease = new Function(takeFn('ctEase') + '; return ctEase;')();
  ok('緩急：はじめ・なかほど・おわり', ease(0) === 0 && Math.abs(ease(0.5) - 0.5) < 1e-9 && ease(1) === 1 && ease(0.25) < 0.25 && ease(0.75) > 0.75);
  ok('枠の移動も同じ曲線（cubic-bezier(.65,0,.35,1)）', /var CT_EASE='cubic-bezier\(\.65,0,\.35,1\)';/.test(SRC));
}
const anim = takeFn('ctScrollAnim');
ok('スクロールは1枚ずつ自分で描く（割り込まれたら止まる）', /requestAnimationFrame\(function step\(ts\)/.test(anim) && /if\(tok!==CT_SCROLL_TOK\) return;/.test(anim) && /window\.scrollTo\(0, Math\.round\(from\+d\*ctEase\(k\)\)\)/.test(anim));
const step = takeFn('ctStep');
ok('枠と吹き出しは「スクロールの終点での位置」へ同じ時間で動く', /ctPlace\(\{ left:r\.left, top:r\.top-d, width:r\.width, height:r\.height \}, dur\);\s*ctScrollAnim\(to, dur,/.test(step));
ok('動いているあいだは、スクロールのたびに置き直さない', /if\(!CT\|\|!CT\.el\|\|CT\.anim\) return;/.test(takeFn('ctReposition')) && /CT\.anim=true;/.test(step));
ok('時間は距離に応じて 0.42〜0.9秒', /Math\.min\(900, Math\.max\(420, 320\+Math\.abs\(d\)\*0\.2\)\)/.test(step));
ok('動きを減らす設定なら動かさない', /ctReduced\(\) \? 0/.test(step) && /prefers-reduced-motion: reduce/.test(takeFn('ctReduced')));
ok('吹き出しの中身を入れてから、次の描画を待って動かす', step.indexOf("$('ct-pop').innerHTML=") < step.indexOf('var run=function') && /requestAnimationFrame\(function\(\)\{ requestAnimationFrame\(run\); \}\)/.test(step));
const go = takeFn('ctGo');
ok('画面の切り替えは薄くしてから入れ替える', /ctFade\(true\);\s*setTimeout\(function\(\)\{[\s\S]*?showSection\(s\.sec, true\);[^\n]*\n\s*ctStep\(i, tok, true\);\s*\}, 170\);/.test(go));
ok('見えていないあいだに行き先へ置いて戻す', /window\.scrollTo\(0,to\);\s*ctPlace\(el\.getBoundingClientRect\(\), 0\);\s*ctFade\(false\);/.test(step));
ok('切り替えた画面の入場の動きにも枠が付いていく', /ctFollow\(tok, 650\);/.test(step));
ok('周りを暗くしている枠は薄くしない（光らない）', !/ring/.test(takeFn('ctFade').replace(/\/\/.*$/gm, '')));
ok('次の段へ進んだら、走っている動きを止める', /var tok=\+\+CT_TOK;\s*CT_SCROLL_TOK\+\+;/.test(go));
const end = takeFn('ctEnd');
ok('閉じたら元の画面へ（二度動かさない）', /showSection\(back, true\);\s*window\.scrollTo\(0,0\);/.test(end) && /ctScrollAnim\(0,/.test(end) && /ctFade\(false\);/.test(end));
ok('吹き出しも薄くなれる', /padding:15px 17px 13px;transition:left \.35s cubic-bezier\(\.4,0,\.2,1\),top \.35s cubic-bezier\(\.4,0,\.2,1\),opacity \.2s ease;\}/.test(SRC));

// ④ はじめての払いの案内
const sh = takeFn('swipeHintOnce');
ok('ガイドが開いているあいだは払いの案内を出さない（次に回す）', /if\(typeof CT!=='undefined' && CT\) return;/.test(sh)
  && sh.indexOf("if(typeof CT!=='undefined' && CT) return;") < sh.indexOf("localStorage.setItem(k,'1')")
  && !/if\(localStorage\.getItem\(k\)\) return; localStorage\.setItem/.test(sh));

// ⑤ 名前の衝突（契約の画面も ct で始まる）・説明書・版
{
  const names = [...SRC.matchAll(/\n\s*(?:async )?function (ct\w+)\s*\(/g)].map((m) => m[1]);
  const dup = names.filter((x, i) => names.indexOf(x) !== i);
  ok('ct で始まる関数の名前が重ならない', dup.length === 0);
}
ok('ボタンの名前は「使い方ガイド（2分）」', /使い方ガイド（2分）/.test(SRC) && !/使い方ガイド（1分）/.test(SRC));
ok('説明書：名前と、指す順・操作', !/使い方ガイド（1分）/.test(MANC) && /<tr><th>使い方ガイド（2分）<\/th><td>[^<]*はじめてログインしたときは自動で始まります。/.test(MANC) && /キーボードの ← → でも送れ、Esc で閉じます/.test(MANC));
ok('提案資料の画面の写しも 2分', /使い方ガイド（2分）/.test(PITCH) && !/使い方ガイド（1分）/.test(PITCH));

if (bad.length) { bad.forEach((b) => console.log('NG ' + b)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK ' + n + ' checks, 0 failed');
