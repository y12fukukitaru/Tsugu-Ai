// =============================================================
// 継ナビくんの予定（2026-10-15 作り直し）：日ごとの札・日の見出し・週の枠
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
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const calDkey = (d) => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
// ① 予定の札（実際に描かせる）
{
  const Card = new Function('esc', 'escJ', 'calKindOf', 'calDkey', 'calIsTodo', takeFn('calCard') + 'return calCard;')(esc, (s) => String(s), (x) => (x.kind === 'meet' ? { fg: '#8A6A12', bg: '#FBF5E6', bd: '#EAD9AC', label: '面談' } : null), calDkey, (x) => !!(x && (x.kind === 'todo' || x.kind === 'task')));
  const now = new Date();
  const iso = (mins) => new Date(now.getTime() + mins * 60000).toISOString();
  const own = Card({ kind: 'own', id: 'e1', _ri: 3, title: '<b>銀行</b>', when: iso(120), ends: iso(180), place: '本店', note: 'メモ', allDay: false });
  ok('時刻は大きく、終わりの時刻を下に小さく', /<div class="cev-time"><b>\d\d:\d\d<\/b>(<small>〜\d\d:\d\d<\/small>)?<\/div>/.test(own));
  ok('題名は文字のまま・場所はピンの絵・メモ', /&lt;b&gt;銀行&lt;\/b&gt;/.test(own) && /<div class="cev-meta"><svg[^>]*>[\s\S]*?<\/svg><span>本店<\/span><\/div>/.test(own) && /<div class="cev-note">メモ<\/div>/.test(own));
  ok('自分の予定：絵のボタンで直す・消す（読み上げの名前つき）', /class="cev-btn" title="直す" aria-label="直す" onclick="event\.stopPropagation\(\);calOpenForm\('e1'\)"/.test(own) && /class="cev-btn del" title="消す" aria-label="消す" onclick="event\.stopPropagation\(\);calDelete\('e1'\)"/.test(own));
  ok('押すと小窓（どの予定か）', /onclick="calPeek\(3\)"/.test(own));
  const nowEv = Card({ kind: 'own', id: 'e2', title: '会議', when: iso(-10), ends: iso(30), allDay: false });
  ok('いま行っている予定は「いま」の札で光らせる', /class="cev now"/.test(nowEv) && /<span class="cev-now">いま<\/span>/.test(nowEv));
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 30);
  if (now.getHours() >= 2) {
    const past = Card({ kind: 'own', id: 'e3', title: '朝会', when: midnight.toISOString(), ends: new Date(midnight.getTime() + 30 * 60000).toISOString(), allDay: false });
    ok('今日の済んだ予定は薄く', /class="cev past"/.test(past));
  }
  const meet = Card({ kind: 'meet', title: '面談', when: iso(1440), allDay: false });
  ok('自動で並んだ予定は種類の札・種類の色の帯', /<span class="cev-kind">面談<\/span>/.test(meet) && /--kc:#8A6A12;/.test(meet) && !/cev-btn/.test(meet));
  const all = Card({ kind: 'own', id: 'e4', title: '決算月', when: iso(2880), allDay: true });
  ok('終日は「終日」の札', /<b class="all">終日<\/b>/.test(all));
}
// ② 日の見出し
{
  const Head = new Function('esc', 'escJ', 'calDkey', 'koyoLine', takeFn('calDayHead') + 'return calDayHead;')(esc, (s) => String(s), calDkey, () => '<i>暦</i>');
  const sun = new Date(2026, 9, 18);
  const h = Head(sun, '今日', true, 3);
  ok('大きな日付と月・曜日（日曜は赤）', /<div class="cdh-d sun"><b>18<\/b><span>10月 日曜<\/span><\/div>/.test(h));
  ok('今日は紺の札＋金の「今日」', /<div class="cdh today">/.test(h) && /<span class="cdh-rel">今日<\/span>/.test(h));
  ok('その日の件数・この日に足す', /予定 <b>3<\/b>件/.test(h) && /class="cdh-add" onclick="calOpenForm\('','2026-10-18T09:00'\)">＋ この日<\/button>/.test(h));
  ok('件数0は「予定なし」・件数を渡さなければ出さない', /予定なし/.test(Head(sun, '', false, 0)) && !/cdh-n/.test(Head(sun, '', false)));
  ok('暦はこれまでどおり見出しの下', /<i>暦<\/i>$/.test(h));
  ok('月・週・一覧から件数を渡す', /calDayHead\(pd, calRel\(pd\), true, \(byDay\[pick\]\|\|\[\]\)\.length\)/.test(SRC) && /calDayHead\(wpd, calRel\(wpd\), true, \(byDay\[wkPick\]\|\|\[\]\)\.length\)/.test(SRC) && /calDayHead\(d2, calRel\(d2\), false, \(byDay\[key2\]\|\|\[\]\)\.length\)/.test(SRC));
  ok('予定の無い日は点線の枠で「＋ この日」へ案内', (SRC.match(/<div class="cev-empty">この日の予定はありません。<b>「＋ この日」<\/b>から入れられます。<\/div>/g) || []).length === 2);
}
// ③ 週の枠・月の点
{
  ok('週の枠：左に種類の色の帯・文字11px・影', /\.wk-ev\{position:absolute;z-index:2;border-radius:6px;padding:3px 5px 3px 6px;font-size:\.6875rem;[^}]*border-left:3px solid var\(--fg\);/.test(SRC));
  ok('週の枠：パソコンは題名を2行まで（長い枠は下に時刻）・スマホはこれまでどおり', /-webkit-line-clamp:var\(--l2,1\)/.test(SRC) && /-webkit-line-clamp:var\(--l1,1\);\}/.test(SRC) && /--l2:'\+\(hgt>=56\?/.test(SRC));
  ok('月の点は少し大きく（7px）', /\.cal-dot\{width:7px;height:7px;/.test(SRC));
  ok('動きを減らす設定では「いま」の点滅を止める', /prefers-reduced-motion:reduce\)\{ \.cev-now::before\{animation:none;\}/.test(SRC));
}
ok('説明書：鉛筆・くず入れ・「いま」', /札の右の<b>鉛筆<\/b>で直し、<b>くず入れ<\/b>で消せます/.test(R('manual-customer.html')) && /札の右の<b>鉛筆<\/b>で直し、<b>くず入れ<\/b>で消せます/.test(R('manual-partner.html')));
is('版が揃う', [SRC.match(/var APP_BUILD='([^']+)'/)[1], VER.build], [VER.build, VER.build]);
if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b.name, '\n   got ', b.got, '\n   want', b.want)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
