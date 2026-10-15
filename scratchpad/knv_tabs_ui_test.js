// =============================================================
// 継ナビくんのタブ（2026-10-15 作り直し）の試験：大きなタイル・線の絵・パソコンは1段／スマホは横に送る
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
// ① 並び
const tabs = SRC.slice(SRC.indexOf('<div class="knv-tabs"'), SRC.indexOf('</div>', SRC.indexOf('<button id="knv-tab-support"')));
const ids = [...tabs.matchAll(/<button id="knv-tab-([a-z]+)"/g)].map((m) => m[1]);
is('8つのタブ（順番）', ids, ['chat', 'cal', 'todo', 'msg', 'kn', 'notif', 'setup', 'support']);
is('どのタブも線の絵（svg）とラベル', [...tabs.matchAll(/<span class="ki"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">[\s\S]*?<\/svg><\/span><span class="kl">([^<]+)<\/span>/g)].map((m) => m[1]),
  ['相談', '予定', 'TODO', 'メッセージ', 'ナレッジ', 'お知らせ', '連携', 'サポート']);
ok('絵文字はタブに使わない', !/[💬📅✅✉📚🔔🔗📖]/u.test(tabs));
ok('数字（バッジ）はそのまま', /id="knv-todobadge" class="knv-tbadge hidden"/.test(tabs) && /id="knv-mbadge"/.test(tabs) && /id="knv-tbadge"/.test(tabs));
ok('読み上げ：タブの並びに名前', /role="tablist" aria-label="継ナビくんのメニュー"/.test(tabs));
// ② 大きさと見た目
ok('押しやすい高さ（60px）', /\.knv-tabs button\{[^}]*min-height:60px/.test(SRC));
ok('ラベルは12px（1段で狭いときだけ11px）', /\.knv-tabs button\{[^}]*font-size:\.75rem/.test(SRC) && /\.knv-tabs\.tight button\{font-size:\.6875rem/.test(SRC));
ok('いまのタブは金のタイル', /\.knv-tabs button\.on\{color:#F6E3B4;background:linear-gradient/.test(SRC));
ok('キーボードの印・動きを減らす設定に従う', /\.knv-tabs button:focus-visible\{outline:2px solid #E9C97E/.test(SRC) && /prefers-reduced-motion:reduce\)\{ \.knv-tabs button\{transition:none;\}/.test(SRC));
ok('スマホは横に送る1段（折り返さない・同じ大きさのタイル・スクロールバーを出さない・端に続きの印）',
  /\.knv-tabs\.scroll\{flex-wrap:nowrap;justify-content:flex-start;overflow-x:auto;overflow-y:hidden;/.test(SRC) && /\.knv-tabs\.scroll button\{flex:0 0 74px;scroll-snap-align:start;\}/.test(SRC)
  && /\.knv-tabs\.scroll::-webkit-scrollbar\{display:none;\}/.test(SRC) && /scrollbar-width:none/.test(SRC) && /radial-gradient\(farthest-side at 100% 50%,rgba\(233,201,126,\.38\)/.test(SRC));
ok('2段の並びはやめた', !/\.knv-tabs\.two/.test(SRC) && !/classList\.toggle\('two'/.test(SRC));
// ③ 並べるか送るか（実際に計算させる）
{
  const f = takeFn('knvTabsFit');
  const mk = (w, nShown, nAll) => {
    const kids = []; for (let i = 0; i < nAll; i++) kids.push({ classList: { contains: (c) => c === 'hidden' && i >= nShown } });
    const cls = {}; const st = {}; let rev = 0;
    const t = { clientWidth: w, children: kids, style: { getPropertyValue: (k) => st[k] || '', setProperty: (k, v) => { st[k] = v; } }, classList: { toggle: (c, on) => { cls[c] = !!on; } } };
    new Function('document', 'window', 'knvTabsReveal', f + 'knvTabsFit();')({ querySelector: () => t }, {}, () => { rev++; });
    return [!!cls.scroll, !!cls.tight, rev];
  };
  is('パソコン（600px）・7つ → 1段に並べる', mk(600, 7, 8), [false, false, 0]);
  is('パソコン（600px）・8つ（パートナー）→ 1段・文字を詰める', mk(600, 8, 8), [false, true, 0]);
  is('スマホ（374px）・7つ → 横に送る・いまのタブを見える所へ', mk(374, 7, 8), [true, false, 1]);
  is('スマホ（374px）・6つ（運営）→ 横に送る', mk(374, 6, 8), [true, false, 1]);
  is('閉じていて幅が測れないときは何もしない', mk(0, 7, 8), [false, false, 0]);
}
ok('タブを替えたら、選んだタブを見える所へ送る', /knvTabsReveal\(\);   \/\/ 横に送っているときは、選んだタブを見える所へ/.test(takeFn('knvShowTab')));
ok('見える所へ送る：見切れている向きにだけ動かす', /if\(br\.left<tr\.left\+10\) t\.scrollLeft-= /.test(takeFn('knvTabsReveal')) && /else if\(br\.right>tr\.right-10\) t\.scrollLeft\+= /.test(takeFn('knvTabsReveal')));
ok('タブの帯を左右に送っても、パネルは閉じない', /if\(tg && tg\.closest && tg\.closest\('\.knv-tabs'\)\) return;/.test(takeFn('knvSwipeInit')));
ok('開いたとき・役割でタブが変わったときに並べ直す', /knvTabsFit\(\);         \/\/ タブを並べるか横に送るか/.test(takeFn('knvToggle')) && /knvTabsFit\(\);\n    knvShowTab\('chat'\);/.test(SRC));
// ④ 説明書・版
ok('説明書：大きなボタン・パソコンは1段・スマホは横に送れる1段・金色', /パソコンは1段に並び、スマホは<b>横に送れる1段<\/b>です（指で左右に送ります/.test(R('manual-partner.html')) && /パソコンは1段に並び、スマホは<b>横に送れる1段<\/b>（指で左右に送ります）。いま開いているタブは<b>金色<\/b>/.test(R('manual-customer.html')));
is('版が揃う', [SRC.match(/var APP_BUILD='([^']+)'/)[1], VER.build], [VER.build, VER.build]);

if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b.name, '\n   got ', b.got, '\n   want', b.want)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
