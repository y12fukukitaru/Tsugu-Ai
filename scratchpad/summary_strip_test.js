// =============================================================
// 継ナビくんの内訳の帯（2026-10-17）：タブの数の玉と同じことしか言わない札は出さない
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
const f = takeFn('knvSummaryRender');
function render(tab, w, ins) {
  const box = { innerHTML: '', hidden: false, classList: { add(c) { if (c === 'hidden') box.hidden = true; }, remove(c) { if (c === 'hidden') box.hidden = false; } } };
  new Function('$', 'window', 'agentInsightsUnread', 'knvCnt', 'KNV_TAB', f + 'knvSummaryRender();')(() => box, w, () => ins || 0, String, tab);
  return box;
}
// ① TODO だけなら帯は出さない
is('TODO だけ（今日まで 4件）なら帯は隠す', render('todo', { __KNV_MYTODO: 4, __eff: 'consultant' }).hidden, true);
is('相談タブでも同じ', render('chat', { __KNV_MYTODO: 4, __eff: 'customer' }).hidden, true);
// ② ほかの知らせは今までどおり
{
  const b = render('chat', { __KNV_UNREAD: 2, __KNV_TODO: 1, __KNV_MYTODO: 4, __eff: 'customer' }, 1);
  ok('未読・期日・提案は出す（TODO は出さない）', !b.hidden && /未読/.test(b.innerHTML) && /期日・対応/.test(b.innerHTML) && /継ナビくんの提案/.test(b.innerHTML) && !/今日までのTODO/.test(b.innerHTML));
}
// ③ お知らせタブを開いているときは、お知らせへ送る札は出さない
is('お知らせタブ：未読・期日・提案だけなら帯は隠す', render('notif', { __KNV_UNREAD: 2, __KNV_TODO: 1, __eff: 'customer' }, 1).hidden, true);
{
  const b = render('notif', { __KNV_UNREAD: 2, __KNV_TODO: 3, __KNV_CANCEL: 1, __eff: 'admin' });
  ok('運営：お知らせタブでも、サポートへ送る札（解約・未対応の問い合わせ）は残す', !b.hidden && /解約のご依頼/.test(b.innerHTML) && /未対応の問い合わせ/.test(b.innerHTML) && !/>未読</.test(b.innerHTML));
}
// ④ タブを替えたら描き直す・帯は細く
ok('タブを替えたら帯を描き直す', /KNV_TAB=t; knvSummaryRender\(\);/.test(takeFn('knvShowTab')));
ok('CSS：帯の上下の余白を詰める', /\.knv-summary\{display:flex;gap:6px;flex-wrap:wrap;padding:6px 12px;/.test(SRC));
// ⑤ 説明書
for (const m of ['manual-customer.html', 'manual-partner.html']) {
  const t = R(m);
  ok('説明書（' + m + '）：TODO の数はタブの数の玉と右下のボタン', /<b>TODOタブの青緑の数の玉<\/b>と<b>右下の継ナビくんのボタンの数字<\/b>に出ます/.test(t) && !/タブの下の<b>「今日までのTODO」<\/b>/.test(t));
}
is('版が揃う', [SRC.match(/var APP_BUILD='([^']+)'/)[1], VER.build], [VER.build, VER.build]);
if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b.name, '\n   got ', b.got, '\n   want', b.want)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
