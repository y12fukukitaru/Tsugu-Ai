// =============================================================
// スマホの週表示（2026-10-17）：平日の5日を大きく、土日は横に送る
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const VER = JSON.parse(R('version.json'));
let n = 0, bad = [];
function is(name, got, want) { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) bad.push({ name, got: g, want: w }); }
function ok(name, cond) { is(name, !!cond, true); }
function takeFn(name) {
  const re = new RegExp('\\n  (?:async )?function ' + name + '\\s*\\(', 'g');
  let m, last = null, cnt = 0;
  while ((m = re.exec(SRC)) !== null) { last = m; cnt++; }
  if (!last) throw new Error('見つかりません: ' + name);
  is('定義は一つだけ: ' + name, cnt, 1);
  const end = SRC.indexOf('\n  }\n', last.index);
  return SRC.slice(last.index, end + 4);
}
const calDkey = (d) => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);

// ① 開いたときの位置（何日ぶん左へ送るか）
for (const [wstart, label] of [[0, '日曜始まり'], [1, '月曜始まり']]) {
  const def = new Function('calWeekStart', 'calDkey', 'WK5_MAX', takeFn('calWk5Default') + 'return calWk5Default;')(() => wstart, calDkey, 2);
  const ws = wstart === 0 ? new Date(2026, 9, 11) : new Date(2026, 9, 12);   // 10/11(日) / 10/12(月)
  const key = (i) => { const d = new Date(ws); d.setDate(ws.getDate() + i); return calDkey(d); };
  if (wstart === 0) {
    is(label + '：水曜を見ると月〜金（1日送る）', def(ws, key(3)), 1);
    is(label + '：日曜を見ると日〜木', def(ws, key(0)), 0);
    is(label + '：土曜を見ると火〜土', def(ws, key(6)), 2);
    is(label + '：週の外なら月〜金', def(ws, '2030-01-01'), 1);
  } else {
    is(label + '：水曜を見ると月〜金（送らない）', def(ws, key(2)), 0);
    is(label + '：土曜を見ると火〜土', def(ws, key(5)), 1);
    is(label + '：日曜を見ると水〜日', def(ws, key(6)), 2);
    is(label + '：週の外なら月〜金', def(ws, '2030-01-01'), 0);
  }
}

// ② 端の札に出す曜日
{
  const hid = new Function(takeFn('calWk5Hidden') + 'return calWk5Hidden;')();
  const sun = new Date(2026, 9, 11), mon = new Date(2026, 9, 12);
  is('日曜始まり・月〜金：左に日', hid(sun, 1, 'l'), '日');
  is('日曜始まり・月〜金：右に土', hid(sun, 1, 'r'), '土');
  is('日曜始まり・火〜土：左に日月・右は無し', [hid(sun, 2, 'l'), hid(sun, 2, 'r')], ['日月', '']);
  is('月曜始まり・月〜金：右に土日・左は無し', [hid(mon, 0, 'r'), hid(mon, 0, 'l')], ['土日', '']);
}

// ③ 組み立て
{
  const b = takeFn('calWk5Bind');
  ok('スマホのときだけ（600px以下）', /function calWk5On\(\)\{\s*\n\s*try\{ return !!\(window\.matchMedia && window\.matchMedia\('\(max-width:600px\)'\)\.matches\)/.test(SRC));
  ok('見出しと本体に同じ瞬間に transform', /inners\.forEach\(function\(e\)\{[^}]*translate3d\('\+\(-px\)\+'px,0,0\)'/.test(b) && /var inners=\[head\.querySelector\('\.wk'\), wrap\.querySelector\('\.wk'\)\]/.test(b));
  ok('目盛りは逆に動かして留める', /fixed\.forEach\(function\(e\)\{[^}]*translate3d\('\+px\+'px,0,0\)'/.test(b) && /querySelectorAll\('\.wk-corner'\)/.test(b) && /querySelectorAll\('\.wk-gut'\)/.test(b));
  ok('横の動きだけ受ける（縦はブラウザに任せる）', /st\.ax=\(Math\.abs\(dx\)>Math\.abs\(dy\)\) \? 'x' : 'y';/.test(b) && /if\(st\.ax!=='x'\) return;/.test(b) && /passive:false/.test(b));
  ok('離すと1日ぶんに吸い付く・払うと端まで', /Math\.round\(off\/colW\(\)\)/.test(b) && /Math\.abs\(v\)>0\.35 \? \(v>0 \? WK5_MAX : 0\)/.test(b));
  ok('端の先はゴムのように重く', /if\(o<0\) o=o\/3; else if\(o>max\) o=max\+\(o-max\)\/3;/.test(b));
  ok('送った指を離しても予定を押したことにしない', /if\(moved\)\{ moved=false; ev\.stopPropagation\(\); ev\.preventDefault\(\); \}/.test(b));
  ok('同じ週なら位置を覚えておく（日を押して描き直しても戻らない）', /if\(!CAL_WK5 \|\| CAL_WK5\.ws!==wsKey\)/.test(b));
  ok('端の札：押すと端まで送る', /calWk5Go\(0\)/.test(b) && /calWk5Go\('\+WK5_MAX\+'\)/.test(b));
  ok('「今日」で位置も戻す', /function calToday\(\)\{[^}]*CAL_WK5=null;/.test(SRC));
  const rc = takeFn('knvRenderCal');
  ok('描くたびに結ぶ・ネイティブの横スクロールは使わない', /var wk5=\(view==='week' && ws\) \? calWk5Bind\(box, ws\) : false;/.test(rc) && /if\(wrap && whead && !wk5\)/.test(rc) && /if\(wrap && td && !wk5 &&/.test(rc));
  ok('パネルの払って閉じるはここでは効かない', /tg\.closest\('\.wk5'\)\) return;/.test(SRC));
  ok('画面の幅が変わったら描き直す（高さだけは見ない）', /if\(w===CAL_WK5_W\) return;/.test(takeFn('calWk5Watch')));
}

// ④ CSS
ok('CSS：7日ぶんの幅（目盛り＋1日×7 ＝ 画面に5日）', /\.wk5 > \.wk\{width:calc\(40px \+ \(100% - 40px\) \* 1\.4\);/.test(SRC));
ok('CSS：縦は送れる・横は JS', /\.wk-head\.wk5,\.wk-wrap\.wk5\{overflow:hidden;touch-action:pan-y;/.test(SRC));
ok('CSS：日付と予定の字を大きく', /\.wk5 \.wk-hcell \.n\{width:28px;height:28px;font-size:\.9375rem;\}/.test(SRC) && /\.wk5 \.wk-ev\{font-size:\.6875rem;line-height:1\.2;/.test(SRC) && /var lines=Math\.max\(1, Math\.floor\(\(hgt-4\)\/13\.2\)\);/.test(SRC));
ok('CSS：端の札は紺に金の字', /\.wk5-edge\{[^}]*color:#F6E3B4;[^}]*background:linear-gradient\(160deg,#1E3A66,#0E1B33\)/.test(SRC));
ok('CSS：隠れている側に薄い影', /\.wk-wrap\.wk5\.more-l::before,\.wk-wrap\.wk5\.more-r::after\{opacity:1;\}/.test(SRC));
ok('CSS：罫線が予定の上に乗らない', /\.wk-ev\{position:absolute;z-index:2;/.test(SRC));

// ⑤ 説明書
for (const f of ['manual-customer.html', 'manual-partner.html']) {
  const m = R(f);
  ok('説明書（' + f + '）：平日の5日・横に払うと土日', /スマホでは<b>平日の5日を画面いっぱいに大きく<\/b>出し、土日は<b>横に払うと<\/b>出てきます/.test(m) && /閉じずに土日が出ます/.test(m));
}
is('版が揃う', [SRC.match(/var APP_BUILD='([^']+)'/)[1], VER.build], [VER.build, VER.build]);
if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b.name, '\n   got ', b.got, '\n   want', b.want)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
