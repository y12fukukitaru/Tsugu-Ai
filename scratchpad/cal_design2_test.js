// =============================================================
// 継ナビくんの予定（2026-10-15 その2）：曜日の帯・丸の日付・TODO と課題の白抜きの丸
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
const css = (sel) => { const i = SRC.indexOf(sel + '{'); return i < 0 ? '' : SRC.slice(i, SRC.indexOf('}', i) + 1); };
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const calDkey = (d) => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);

// ① TODO・課題の見分け
const isTodo = new Function(takeFn('calIsTodo') + 'return calIsTodo;')();
ok('TODO と課題は「用事」', isTodo({ kind: 'todo' }) && isTodo({ kind: 'task' }));
ok('ほかは予定', !isTodo({ kind: 'own' }) && !isTodo({ kind: 'meet' }) && !isTodo({ kind: 'pay' }) && !isTodo(null));

// ② 月の札（パソコン）：TODO は終日でも塗らず、白抜きの丸の印（td）
{
  const kinds = { todo: { fg: '#147A6E', bg: 'rgba(20,122,110,.08)', bd: '#BFE0DA' }, own: null };
  const chip = new Function('calKindOf', 'esc', 'escA', 'calIsTodo', takeFn('calChip') + '; return calChip;')((x) => kinds[x.kind] || null, esc, esc, isTodo);
  const w = new Date(2026, 9, 15, 11, 0).toISOString();
  const t = chip({ kind: 'todo', title: '請求書', when: w, allDay: true, _ri: 1 });
  ok('TODO（終日）は td・塗らない', /class="cal-ev td"/.test(t) && !/cal-ev all/.test(t));
  ok('TODO の枠の色を渡す', /--ebd:#BFE0DA;/.test(t));
  const a = chip({ kind: 'own', title: '決算', when: w, allDay: true, _ri: 2 });
  ok('予定（終日）は今までどおり塗る', /class="cal-ev all"/.test(a));
}

// ③ 日ごとの札：TODO は「期限」、時刻のある TODO は「まで」、課題は「期日」
{
  const Card = new Function('esc', 'escJ', 'calKindOf', 'calDkey', 'calIsTodo', takeFn('calCard') + 'return calCard;')(
    esc, (s) => String(s), () => ({ fg: '#147A6E', bg: '#eee', bd: '#BFE0DA', label: 'TODO' }), calDkey, isTodo);
  const day = Card({ kind: 'todo', title: '請求書', when: '2026-10-15T09:00:00', allDay: true });
  ok('TODO（終日）は「期限」と白抜きの丸', /class="cev td"/.test(day) && /<b class="all due"><i class="cev-ring"><\/i>期限<\/b>/.test(day) && !/終日/.test(day));
  const tm = Card({ kind: 'todo', title: '電話', when: '2026-10-15T11:00:00', allDay: false });
  ok('時刻のある TODO は「11:00 まで」', /<b>11:00<\/b><small>まで<\/small>/.test(tm));
  const task = Card({ kind: 'task', title: '原価の見直し の期日', when: '2026-10-15T09:00:00', allDay: true });
  ok('課題は「期日」', />期日<\/b>/.test(task));
  const own = Card({ kind: 'own', id: 'e', title: '会議', when: '2026-10-15T09:00:00', allDay: true });
  ok('自分の予定（終日）は「終日」のまま', /<b class="all">終日<\/b>/.test(own) && !/cev td/.test(own));
}

// ④ 月の表：曜日の帯・丸の日付・今日・点
{
  const cal = takeFn('knvRenderCal');
  ok('曜日の帯（cal-hds）', /<div class="cal-grid cal-hds">/.test(cal));
  ok('スマホでも過ぎた日を控えめに', /\(key<tKey\?' past':''\)/.test(cal));
  ok('点：TODO・課題は白抜き', /calIsTodo\(x\) \? '<span class="cal-dot td" style="border-color:'/.test(cal));
  ok('点：4件を超えたら3つ＋残りの数', /items\.slice\(0,items\.length>4\?3:4\)/.test(cal) && /cal-more">\+'\+\(items\.length-3\)\+'<\/span>'/.test(cal));
  ok('CSS：曜日の帯は淡い地に太字', /background:var\(--soft\)/.test(css('.cal-grid.cal-hds')) && /font-size:\.6875rem;font-weight:700/.test(css('.cal-hd')));
  ok('CSS：日付は丸の中（DM Sans）', /border-radius:99px/.test(css('.cal-cell .d')) && /DM Sans/.test(css('.cal-cell .d')));
  ok('CSS：今日は紺の丸に金の数字', /linear-gradient\(160deg,#1E3A66,#0E1B33\)/.test(css('.cal-cell.today .d')) && /#F6E3B4/.test(css('.cal-cell.today .d')));
  ok('CSS：選んだ日は青い輪', /box-shadow:0 0 0 2px/.test(css('.cal-cell.on')));
  ok('CSS：白抜きの点', /border:2px solid/.test(css('.cal-dot.td')));
  ok('CSS：土日の色は白地の上に重ねる（下の灰色が透けない）', /\) var\(--card\)/.test(css('.cal-cell.rich.sun')) && /\) var\(--card\)/.test(css('.cal-cell.rich.sat')));
  ok('CSS：札の TODO は枠と丸', /border:1px solid var\(--ebd/.test(css('.cal-ev.td')) && /\.cal-ev\.td::before\{content:"";[^}]*border-radius:50%/.test(SRC));
}

// ⑤ 週の見出し・週の札
{
  const wk = takeFn('calWeekVertical');
  ok('週の見出し：曜日と日付を分ける', /<span class="w">'\+'日月火水木金土'\.charAt\(d\.getDay\(\)\)\+'<\/span>'/.test(wk));
  ok('週：終日の TODO に td', /class="wk-chip'\+\(calIsTodo\(x\)\?' td':''\)/.test(wk));
  ok('週：時刻のある TODO に td', /class="wk-ev'\+\(calIsTodo\(x\)\?' td':''\)/.test(wk));
  ok('CSS：週の今日は紺の丸', /linear-gradient\(160deg,#1E3A66,#0E1B33\)/.test(css('.wk-hcell.today .n')));
  ok('CSS：日付の丸は28px（スマホ24px）', /width:28px;height:28px/.test(css('.wk-hcell .n')) && /\.wk-hcell \.n\{width:24px;height:24px/.test(SRC));
  ok('CSS：スマホの TODO の札は白地に色の枠', /\.wk-chip\.td\{background:var\(--card\)!important;color:var\(--fg\)!important;border:1px solid var\(--fg\)!important/.test(SRC));
}

// ⑥ 色の見分け（凡例）も白抜き
ok('凡例：TODO・課題は白抜き', /\(k==='todo'\|\|k==='task'\)\?' class="td" style="border-color:'/.test(takeFn('calLegend')) && /\.cal-lg i\.td\{/.test(SRC));
ok('帯の真ん中は日付の1段だけ（年・内訳の段はやめた）', /return '<div class="cl-main">'\+main\+'<\/div>';/.test(takeFn('calHeadLab')) && !/cl-stats|cl-eye/.test(SRC));

// ⑦ 説明書
for (const f of ['manual-customer.html', 'manual-partner.html']) {
  const m = R(f);
  ok('説明書（' + f + '）：白抜きの丸・紺の丸・期限', /TODO・課題は<b>白抜きの点<\/b>/.test(m) && /今日の日付は<b>紺の丸に金の数字<\/b>/.test(m) && /<b>「期限」「期日」<\/b>/.test(m));
}
is('版が揃う', [SRC.match(/var APP_BUILD='([^']+)'/)[1], VER.build], [VER.build, VER.build]);
if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b.name, '\n   got ', b.got, '\n   want', b.want)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
