// =============================================================
// 表示モード（運営だけ）を、ダッシュボードの中から左のメニューの最上部へ（2026-09-27）
//   ① 左のメニュー（#sb-va）とスマホのドロワー（#dw-va）の最上部に出る。運営でなければ出ない
//   ② いまの見え方のボタンが「on」。押すと setAdminView
//   ③ 左のメニューを下へ送っても上に残る（sticky）
//   ④ ダッシュボードの中の切替バー（.vaswitch）は無くなった。顧客の見え方のメニューのシートにも出る
//   ⑤ 運営の説明書も同じことを言う
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html'), MANA = R('manual-admin.html');
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
// 小さな DOM の代わり
const els = {};
function mk(id) { const cls = new Set(['hidden']); return els[id] = { innerHTML: '', classList: { toggle: (c, on) => on ? cls.add(c) : cls.delete(c), contains: (c) => cls.has(c) } }; }
mk('sb-va'); mk('dw-va');
const env = { VIEWAS: 'admin', role: 'admin', calls: [] };
const L = new Function('env', 'els',
  'var window={}; Object.defineProperty(window,"__role",{get:function(){return env.role;}});'
  + 'function $(id){ return els[id]||null; }'
  + 'var VIEWAS; Object.defineProperty(this,"x",{});'
  + takeFn('vaActive').replace(/VIEWAS/g, 'env.VIEWAS') + takeFn('vaButtons') + takeFn('vaSideRender')
  + 'return { vaActive:vaActive, vaSideRender:vaSideRender };'
)(env, els);

// ① ②
L.vaSideRender();
no('運営：左のメニューに出る', els['sb-va'].classList.contains('hidden'));
no('運営：ドロワーにも出る', els['dw-va'].classList.contains('hidden'));
ok('見出しは「表示モード」', /<div class="sb-va-l">表示モード<\/div>/.test(els['sb-va'].innerHTML));
is('3つのボタン', (els['sb-va'].innerHTML.match(/<button /g) || []).length, 3);
ok('運営が on', /class="on" aria-pressed="true" onclick="setAdminView\('admin'\)">運営</.test(els['sb-va'].innerHTML));
env.VIEWAS = 'fde'; L.vaSideRender();
ok('パートナーの見え方ではパートナーが on', /class="on" aria-pressed="true" onclick="setAdminView\('fde'\)">パートナー</.test(els['sb-va'].innerHTML));
env.role = 'consultant'; L.vaSideRender();
ok('運営でなければ左のメニューに出ない', els['sb-va'].classList.contains('hidden') && els['sb-va'].innerHTML === '');
ok('運営でなければドロワーにも出ない', els['dw-va'].classList.contains('hidden'));

// ③ つなぎ
ok('左のメニュー：会社名と役割の下、メニューの上', /<span id="app-role" class="plan-pill"><\/span><\/div>\n    <div id="sb-va" class="sb-va hidden"><\/div>\n    <nav id="app-nav"/.test(SRC));
ok('ドロワー：役割の下、メニューの上', /<span id="dw-role" class="plan-pill"><\/span><\/div>\n  <div id="dw-va" class="sb-va hidden"><\/div>\n  <nav id="drawer-nav"/.test(SRC));
ok('左のメニューを下へ送っても上に残る', /\.sb-va\{position:sticky;top:0;z-index:2;background:var\(--deep\);/.test(SRC));
ok('描くたびに表示モードも描き直す', /vaSideRender\(\);\n    avatarRemember\(\); renderAvatar\(\);/.test(SRC));
ok('顧客の見え方でも、≡のメニューは同じドロワー（いちばん上に表示モード）', !/vaSheetHtml|dash-sheet/.test(SRC));
ok('切り替えたら描き直す（ドロワーは renderApp が閉じる）', /function setAdminView\(m\)\{ VIEWAS=m; renderApp\(window\.__prof, window\.__email\); \}/.test(SRC) && /closeDrawer\(\);\n    buildNav\(eff\);/.test(SRC));

// ④ 以前の切替バーは無い
no('ダッシュボードの中の切替バーは無い', /vaswitch|adminSwitchHtml|viewas-row/.test(SRC));

// ⑤ 説明書
ok('運営の説明書：左のメニューの最上部', /左のメニューの最上部にある<b>表示モード<\/b>（運営／パートナー／顧客）/.test(MANA) && /メニューを下へ送っても上に残ります/.test(MANA));
ok('運営の説明書：質問から探せる', /パートナーや顧客の見え方を確かめたい（表示モード）/.test(MANA));

if (bad.length) { bad.forEach(b => console.log('NG', b.name, '\n   got ', b.got, '\n   want', b.want)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK ' + n + ' checks, 0 failed');
