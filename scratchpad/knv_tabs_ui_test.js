// =============================================================
// 継ナビくんのタブ（2026-10-15 作り直し）の試験：大きなタイル・線の絵・1段／2段
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
ok('押しやすい高さ（1段60px・2段52px）', /\.knv-tabs button\{[^}]*min-height:60px/.test(SRC) && /\.knv-tabs\.two button\{min-height:52px/.test(SRC));
ok('ラベルは12px（狭いときだけ11px）', /\.knv-tabs button\{[^}]*font-size:\.75rem/.test(SRC) && /\.knv-tabs\.tight button\{font-size:\.6875rem/.test(SRC));
ok('いまのタブは金のタイル', /\.knv-tabs button\.on\{color:#F6E3B4;background:linear-gradient/.test(SRC));
ok('キーボードの印・動きを減らす設定に従う', /\.knv-tabs button:focus-visible\{outline:2px solid #E9C97E/.test(SRC) && /prefers-reduced-motion:reduce\)\{ \.knv-tabs button\{transition:none;\}/.test(SRC));
// ③ 1段か2段か（実際に計算させる）
{
  const f = takeFn('knvTabsFit');
  const mk = (w, nShown, nAll) => {
    const kids = []; for (let i = 0; i < nAll; i++) kids.push({ classList: { contains: (c) => c === 'hidden' && i >= nShown } });
    const cls = {}; const st = {};
    const t = { clientWidth: w, children: kids, style: { getPropertyValue: (k) => st[k] || '', setProperty: (k, v) => { st[k] = v; } }, classList: { toggle: (c, on) => { cls[c] = !!on; } } };
    new Function('document', 'window', f + 'knvTabsFit();')({ querySelector: () => t }, {});
    return [st['--kt-cols'], !!cls.two, !!cls.tight];
  };
  is('パソコン（600px）・7つ → 1段', mk(600, 7, 8), ['7', false, false]);
  is('パソコン（600px）・8つ（パートナー）→ 1段・文字を詰める', mk(600, 8, 8), ['8', false, true]);
  is('スマホ（374px）・7つ → 2段（4つずつ）', mk(374, 7, 8), ['4', true, false]);
  is('スマホ（374px）・6つ（運営）→ 2段（3つずつ）', mk(374, 6, 8), ['3', true, false]);
  is('狭いスマホ（344px）・8つ → 2段（1つ76px なので文字はそのまま）', mk(344, 8, 8), ['4', true, false]);
  is('とても狭い窓（320px）・8つ → 2段・文字を詰める', mk(320, 8, 8), ['4', true, true]);
  is('閉じていて幅が測れないときは何もしない', mk(0, 7, 8), [undefined, false, false]);
}
ok('開いたとき・役割でタブが変わったときに並べ直す', /knvTabsFit\(\);         \/\/ タブを1段か2段に/.test(takeFn('knvToggle')) && /knvTabsFit\(\);\n    knvShowTab\('chat'\);/.test(SRC));
// ④ 説明書・版
ok('説明書：大きなボタン・1段／2段・金色', /タブは<b>大きなボタン<\/b>（絵とラベル）で、パソコンは1段、スマホは2段/.test(R('manual-partner.html')) && /パソコンは1段、スマホは2段に並び、いま開いているタブは<b>金色<\/b>/.test(R('manual-customer.html')));
is('版が揃う', [SRC.match(/var APP_BUILD='([^']+)'/)[1], VER.build], [VER.build, VER.build]);

if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b.name, '\n   got ', b.got, '\n   want', b.want)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
