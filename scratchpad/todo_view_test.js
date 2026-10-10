// =============================================================
// TODO の見え方・月表示に予定を並べる（2026-09-30）
//   ① 束：期限切れ・今日・明日・今週（日曜まで）・それ以降・期限なし
//   ② 期限の札：◯日超過／今日 HH:MM／明日／◯曜／M/D（曜）
//   ③ 画面：今日やること（件数と帯）・1行で足す欄（詳しくは開いたときだけ）・今日済んだこと
//   ④ 月表示：パネルが広いときは予定そのもの（3件まで＋n件）、狭いときは点
//   ⑤ 説明書・知識
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html'), MANC = R('manual-customer.html'), MANP = R('manual-partner.html');
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
const block = (name) => { const i = SRC.indexOf('\n  var ' + name + '='); return i < 0 ? '' : SRC.slice(i, SRC.indexOf(';\n', i) + 2); };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ymd = (x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
const dayOff = (base, k) => { const x = new Date(base); x.setDate(x.getDate() + k); return x; };

// ① 束
const env = takeFn('todoYmd') + takeFn('todoToday') + takeFn('todoBucket') + takeFn('todoGroup') + block('TODO_GROUPS') + takeFn('todoDuePill');
function load(now) {
  const RealDate = Date;
  function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(now); }
  FakeDate.prototype = RealDate.prototype; FakeDate.now = () => now.getTime();
  return new Function('Date', 'esc', 'escA', env + '; return { todoGroup, todoDuePill, TODO_GROUPS };')(FakeDate, esc, esc);
}
{
  const G = load(new Date(2026, 8, 30, 10, 0));   // 2026-09-30（水）
  const T = new Date(2026, 8, 30);
  const g = (k, extra) => G.todoGroup(Object.assign({ title: 'x', due_date: ymd(dayOff(T, k)) }, extra || {}));
  ok('束：期限切れ', g(-1) === 'over');
  ok('束：今日', g(0) === 'today');
  ok('束：明日', g(1) === 'tomorrow');
  ok('束：今週（水曜から見て金・日）', g(2) === 'week' && g(4) === 'week');
  ok('束：翌週の月曜はそれ以降', g(5) === 'later');
  ok('束：期限なし', G.todoGroup({ title: 'x' }) === 'none');
  ok('束：済みは済み', g(-3, { done_at: '2026-09-29T01:00:00Z' }) === 'done');
  ok('束は6つ・この順', G.TODO_GROUPS.map((x) => x[0]).join(',') === 'over,today,tomorrow,week,later,none');
  ok('束の名前', G.TODO_GROUPS.map((x) => x[1]).join(',') === '期限切れ,今日,明日,今週（日曜まで）,それ以降,期限なし');
  // 日曜が今日なら「今週の残り」は無い／土曜なら日曜は「明日」
  const S = load(new Date(2026, 9, 4, 9, 0)), Sd = new Date(2026, 9, 4);   // 10/4（日）
  ok('束：日曜が今日なら翌日以降は明日・それ以降', S.todoGroup({ due_date: ymd(dayOff(Sd, 1)) }) === 'tomorrow' && S.todoGroup({ due_date: ymd(dayOff(Sd, 2)) }) === 'later');
  const Sa = load(new Date(2026, 9, 3, 9, 0)), Sad = new Date(2026, 9, 3);  // 10/3（土）
  ok('束：土曜から見た日曜は明日、月曜はそれ以降', Sa.todoGroup({ due_date: ymd(dayOff(Sad, 1)) }) === 'tomorrow' && Sa.todoGroup({ due_date: ymd(dayOff(Sad, 2)) }) === 'later');

  // ② 期限の札
  const p = (k, extra) => G.todoDuePill(Object.assign({ title: 'x', due_date: ymd(dayOff(T, k)) }, extra || {}));
  ok('札：期限切れは「◯日超過」（赤）', /class="todo-due over"[^>]*>3日超過</.test(p(-3)));
  ok('札：今日は時刻つき', />今日 15:00</.test(p(0, { due_time: '15:00:00' })) && /class="todo-due today"/.test(p(0)));
  ok('札：明日', />明日</.test(p(1)) && /class="todo-due tomorrow"/.test(p(1)));
  ok('札：今週は曜日', />金曜</.test(p(2)));
  ok('札：それ以降は日付と曜日', />10\/5（月）</.test(p(5)));
  ok('札：期限が無ければ出さない', G.todoDuePill({ title: 'x' }) === '');
  ok('札：押さなくても日付が分かる（title）', /title="期限 10\/2（金）（終日）"/.test(p(2)));
}

// ③ 画面
const paint = takeFn('todoPaint');
ok('今日やること：件数は期限切れ＋今日', /var dueN=cnt\.over\+cnt\.today/.test(paint) && /<div class="lab">今日やること<\/div>/.test(paint));
ok('今日やること：済んだ割合の帯', /class="todo-bar"/.test(paint) && /var pct=tot\?Math\.round\(doneN\/tot\*100\):0;/.test(paint));
ok('今日やること：束へ飛ぶ札', /onclick="todoJump\(\\''\+g\[0\]\+'\\'\)"/.test(paint) && /id="todo-g-'\+g\[0\]\+'"/.test(paint));
ok('1行で足す：Enter で入る（変換中は入れない）', /event\.key===\\'Enter\\'&&!event\.isComposing/.test(paint));
ok('1行で足す：詳しくは開いたときだけ（直すときは開く）', /var more=TODO_MORE \|\| !!ed;/.test(paint) && /<div class="more todo-more'\+\(more\?'':' hidden'\)\+'">/.test(paint));
ok('1行で足す：期限の札に印', /class="todo-chip'\+\(curDue===q\[1\]\?' on':''\)\+'" data-due="'\+q\[1\]\+'"/.test(paint));
ok('今日の分が済んだら、ねぎらう', /🎉 今日の分はぜんぶ済みました/.test(paint));
const tog = takeFn('todoMoreToggle');
ok('詳しくの開け閉めで打ちかけを消さない', /\['td-title','td-date','td-time','td-cust','td-note'\]/.test(tog) && /e\.value=keep\[k\]/.test(tog));
const tick = takeFn('todoTick');
ok('済みにした瞬間に見た目を変え、動きを控える設定なら待たない', /classList\.add\('ticking'\)/.test(tick) && /prefers-reduced-motion: reduce/.test(tick) && /\(on && !reduce\) \? 260 : 0/.test(tick));
const item = takeFn('todoItemHtml');
ok('行：左の○で済み・期限の札・顧客の札・メモ1行', /todoTick\(this,/.test(item) && /todoDuePill\(t\)/.test(item) && /class="todo-cu"/.test(item) && /class="todo-note1"/.test(item));
ok('行：✎と🗑に読み上げの名前', /aria-label="直す"/.test(item) && /aria-label="消す"/.test(item));
//  2026-10-10：直す・消すは小さくて押しにくく、カーソルを置かないと出なかった → いつも見せ、大きく
ok('CSS：直す・消すはいつも見せる（カーソルを置かなくても）', !/\.todo-acts\{[^}]*opacity:0/.test(SRC) && !/\.todo-it:hover \.todo-acts/.test(SRC));
ok('CSS：パソコンは絵＋文字で高さ34px、スマホは44pxの絵だけ', /\.todo-ic\{flex:none;display:inline-flex;align-items:center;gap:5px;min-height:34px;/.test(SRC) && /@media \(max-width:600px\)\{\n    \.todo-ic\{min-width:44px;min-height:44px;/.test(SRC) && /\.todo-ic \.lb\{display:none;\}/.test(SRC));
ok('直す・消すは線の絵と文字（文字の絵 ✎🗑 は使わない）', /'<span class="lb">直す<\/span><\/button>'/.test(SRC) && /'<span class="lb">消す<\/span><\/button>'/.test(SRC) && /var TODO_IC_EDIT='<svg/.test(SRC) && /var TODO_IC_DEL='<svg/.test(SRC) && !/class="todo-ic"[^>]*>✎/.test(SRC));
ok('消すは赤で、直すと見分けられる', /\.todo-ic\.del\{color:#A9403D;\}/.test(SRC) && /class="todo-ic del"/.test(SRC));
ok('CSS：束の色は左の線', /\.todo-it::before\{[^}]*background:var\(--gc/.test(SRC));
ok('CSS：暗い画面の色', /\[data-theme="dark"\] \.todo-sum/.test(SRC) || /\.dark \.todo-sum/.test(SRC) || /prefers-color-scheme: dark\)[\s\S]{0,4000}\.todo-sum/.test(SRC));

// ④ 月表示
ok('月：列は同じ幅（中身で広がらない）', /\.cal-grid\{[^}]*grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/.test(SRC));
ok('月：広いときだけ予定を並べる（540px 以上）', /var CAL_RICH_W=540,/.test(SRC) && /return !!\(box && box\.clientWidth>=CAL_RICH_W\);/.test(takeFn('calRichOk')));
const cal = takeFn('knvRenderCal');
ok('月：1日3件まで、多い日は2件＋「＋n件」', /var MAXE=3, showN=its\.length>MAXE\?MAXE-1:its\.length;/.test(cal) && /calPickMore\(\\''\+key\+'\\'\)">＋'\+\(its\.length-showN\)\+'件<\/button>/.test(cal));
ok('月：終日を先に、あとは時刻の順', /\(b\.allDay\?1:0\)-\(a\.allDay\?1:0\) \|\| new Date\(a\.when\)-new Date\(b\.when\)/.test(cal));
ok('月：狭いときは点のまま', /class="cal-dots"/.test(cal) && /class="cal-dot"/.test(cal));
ok('月：過ぎた日は薄く・1日は「M/1」', /\(rich && key<tKey\?' past':''\)/.test(cal) && /d\.getDate\(\)===1\?\(d\.getMonth\(\)\+1\)\+'\/1'/.test(cal));
ok('月：大きさを変えたら並べ直す', /calRichWatch\(box\)/.test(cal) && /new ResizeObserver/.test(takeFn('calRichWatch')));
ok('月：「＋n件」でその日の一覧へ送る', /scrollIntoView/.test(takeFn('calPickMore')) && /<div id="cal-pickday"><\/div>/.test(cal));
{
  const chipSrc = takeFn('calChip');
  const chip = new Function('calKindOf', 'esc', 'escA', chipSrc + '; return calChip;')(
    () => ({ fg: '#B8923F', bg: 'rgba(184,146,63,.1)', txt: '#fff' }), esc, esc);
  const w = new Date(2026, 8, 30, 14, 5).toISOString();
  const a = chip({ title: '◯◯社 面談', when: w, place: '本社', _ri: 7 });
  ok('札：時刻と題名・色・押すと小窓', /<b>14:05<\/b>◯◯社 面談<\/button>/.test(a) && /--ec:#B8923F;/.test(a) && /calPeek\(7\)/.test(a) && /event\.stopPropagation\(\)/.test(a));
  ok('札：カーソルで全文（場所つき）', /title="14:05 ◯◯社 面談（本社）"/.test(a));
  const b = chip({ title: '決算', when: w, allDay: true, _ri: 2 });
  ok('札：終日は塗り・時刻なし', /class="cal-ev all"/.test(b) && !/<b>/.test(b));
  ok('札：題名は逃がす', /&lt;x&gt;/.test(chip({ title: '<x>', when: w, _ri: 1 })));
}
ok('CSS：札は2行まで', /\.cal-ev\{[^}]*-webkit-line-clamp:2/.test(SRC));

// ⑤ 説明書・知識
const slide = (h, t) => (h.match(new RegExp('<section class="slide" data-t="' + t + '"[\\s\\S]*?</section>')) || [''])[0];
[['経営者', MANC], ['パートナー', MANP]].forEach(([who, M]) => {
  const td = slide(M, 'TODO（やること）'), ca = slide(M, '予定（カレンダー）');
  ok('説明書（' + who + '）：今日やること・6つの束・札', /「今日やること ◯件」/.test(td) && /期限切れ・今日・明日・今週（日曜まで）・それ以降・期限なし/.test(td) && /「3日超過」「今日 15:00」「明日」「金曜」/.test(td));
  ok('説明書（' + who + '）：1行で足す・詳しく', /<b>Enter<\/b>/.test(td) && /<b>「🗓 日時・メモ ▾」<\/b>のボタンを押すと出ます/.test(td));
  ok('説明書（' + who + '）：今日済んだこと', /<b>「✓ 今日済んだこと」<\/b>/.test(td) && /<b>「それより前に済んだもの（◯件）を見る」<\/b>/.test(td));
  ok('説明書（' + who + '）：月表示に予定そのもの', /<b>各日のマスに予定そのもの<\/b>/.test(ca) && /スマホや小窓では<b>点<\/b>/.test(ca));
});
ok('知識：TODO の見え方（両方）', (SRC.match(/期限切れ・今日・明日・今週\(日曜まで\)・それ以降・期限なしに分けて並び/g) || []).length === 2);
ok('知識：月表示に予定そのもの（両方）', (SRC.match(/月表示は、ブラウザでパネルが広いとき\(右半分・左半分・中央に大きく\)は各日のマスに予定そのもの/g) || []).length === 2);

//  2026-10-10：書く欄に枠がなく分かりにくい・左の＋が押せない → 枠のある欄と、押せる＋
{
  const paint = (() => { const i = SRC.indexOf('\n  function todoPaint('); return SRC.slice(i, SRC.indexOf('\n  }\n', i)); })();
  ok('書く欄：枠と高さ（スマホは44px）', /\.todo-add \.row1 input\{flex:1;min-width:0;border:1\.5px solid #BFD9D3;border-radius:10px;/.test(SRC) && /min-height:42px;/.test(SRC) && /\.todo-add \.row1 input,\.todo-add \.plus,\.todo-add \.row1 \.btn2\{min-height:44px;\}/.test(SRC));
  ok('左の＋は押せるボタン（todoPlus）', /<button type="button" class="plus"[^>]*onclick="todoPlus\(\)">/.test(paint) && !/<span class="plus"/.test(paint));
  const tp = (() => { const i = SRC.indexOf('\n  function todoPlus('); return SRC.slice(i, SRC.indexOf('\n  }\n', i)); })();
  ok('＋：空なら欄にカーソル、書いてあれば追加', /if\(i && !String\(i\.value\|\|''\)\.trim\(\)\)\{ try\{ i\.focus\(\); \}catch\(e\)\{\} todoMsg\(/.test(tp) && /todoSave\(\);/.test(tp));
  ok('スマホでは短い案内文（切れないように）', /window\.innerWidth<=600\?'やることを入力':'やることを入力（例：◯◯社に見積を送る）'/.test(paint));
}
//  2026-10-10：日時・メモのボタンが小さい・開いたとき日付と時刻が白い箱 → 枠のあるボタン、名前つきの欄、いまの日時
{
  const paint = (() => { const i = SRC.indexOf('\n  function todoPaint('); return SRC.slice(i, SRC.indexOf('\n  }\n', i)); })();
  ok('日時・メモは枠のあるボタン（スマホ38px）', /class="todo-more-btn'\+\(more\?' on':''\)\+'"/.test(paint) && /\.todo-more-btn\{font-size:13px;min-height:38px;/.test(SRC));
  ok('日付・時刻・顧客・メモに名前', /<label class="tf"[^>]*><span>日付<\/span><input id="td-date"/.test(paint) && /<span>時刻<\/span><div class="tf-time">'\n\s*\+'<input id="td-time"/.test(paint) && /<span>メモ（任意）<\/span><textarea id="td-note"/.test(paint));
  ok('スマホの欄は44px・文字16px（拡大しない）', /\.todo-more input\[type=date\],\.todo-more input\[type=time\],\.todo-more select,\.todo-more textarea\{min-height:44px;font-size:16px;\}/.test(SRC));
  ok('スマホの期限の札も大きく', /\.todo-chip\{font-size:12\.5px;padding:0 13px;min-height:36px;\}/.test(SRC));
  const tg = takeFn('todoMoreToggle');
  ok('開いたとき、日付が空ならいまの日時（時刻は次の15分）', /if\(TODO_MORE && !TODO_EDIT\)\{/.test(tg) && /d\.value=todoYmd\(new Date\(\)\);/.test(tg) && /if\(tm && !tm\.value && !TODO_ALLDAY\) tm\.value=todoNext15\(\);/.test(tg) && /Math\.ceil\(\(now\.getHours\(\)\*60\+now\.getMinutes\(\)\+1\)\/15\)\*15/.test(takeFn('todoNext15')));
  ok('「なし」で日付と時刻を消せる（これまでどおり）', /if\(!v\)\{ todoAllDay\(false\); var tm=\$\('td-time'\); if\(tm\) tm\.value=''; \}/.test(SRC));
}
ok('説明書：日時・メモのボタンと、いまの日時', ['manual-customer.html', 'manual-partner.html'].every((f) => /<b>「🗓 日時・メモ ▾」<\/b>のボタンを押すと出ます/.test(fs.readFileSync(__dirname + '/../' + f, 'utf8')) && /<b>いまの日時<\/b>（時刻は次の15分の区切り）が入ります/.test(fs.readFileSync(__dirname + '/../' + f, 'utf8'))));
//  2026-10-10：時刻に「終日」
{
  const paint = (() => { const i = SRC.indexOf('\n  function todoPaint('); return SRC.slice(i, SRC.indexOf('\n  }\n', i)); })();
  ok('時刻の横に「終日」（押すと時刻の欄が止まる）', /<button type="button" id="td-allday" class="todo-allday'\+\(TODO_ALLDAY\?' on':''\)\+'"/.test(paint) && /onclick="todoAllDay\(\)">'\+\(TODO_ALLDAY\?'✓ ':''\)\+'終日<\/button>'/.test(paint) && /\(TODO_ALLDAY\?' disabled':''\)/.test(paint));
  const ad = takeFn('todoAllDay');
  ok('終日：時刻を空にして止める／外すと次の15分', /tm\.disabled=TODO_ALLDAY; if\(TODO_ALLDAY\) tm\.value=''; else if\(pressed && !tm\.value\) tm\.value=todoNext15\(\);/.test(ad));
  const sv = takeFn('todoSave');
  ok('保存：終日なら時刻は空', /tm=TODO_ALLDAY \? null : /.test(sv) && /TODO_EDIT=null; TODO_MORE=false; TODO_ALLDAY=false;/.test(sv));
  ok('直す：期限があって時刻が無いものは終日で開く', /TODO_ALLDAY=!!\(t && t\.due_date && !t\.due_time\);/.test(takeFn('todoEdit')));
  ok('スマホの終日ボタンは44px', /\.todo-allday\{min-height:44px;/.test(SRC));
}
ok('説明書：時刻の横の「終日」', ['manual-customer.html', 'manual-partner.html'].every((f) => /時刻を決めないときは時刻の横の<b>「終日」<\/b>/.test(fs.readFileSync(__dirname + '/../' + f, 'utf8'))) && /時刻を決めないときは「終日」/.test(fs.readFileSync(__dirname + '/../manual-admin.html', 'utf8')));
if (bad.length) { bad.forEach((b) => console.log('NG ' + b)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK ' + n + ' checks, 0 failed');
