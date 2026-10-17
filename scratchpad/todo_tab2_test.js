// =============================================================
// TODO タブ（2026-10-17）：週は月曜始まり・今週の区切り・束の見出しを貼り付け・いまの線・済んだ日時
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
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

// ① 週の始まり：既定は月曜
{
  const ws = (p) => new Function('loadPrefs', takeFn('calWeekStart') + 'return calWeekStart;')(() => p)();
  is('何も選んでいなければ月曜', ws({}), 1);
  is('日曜を選べば日曜', ws({ weekStart: 0 }), 0);
  is('月曜を選べば月曜', ws({ weekStart: 1 }), 1);
}

// ② 今週の区切りは週の始まりに合わせる
{
  const bucket = new Function('todoToday', takeFn('todoBucket') + 'return todoBucket;');
  for (const [w, label] of [[1, '月曜始まり（今週は日曜まで）'], [0, '日曜始まり（今週は土曜まで）']]) {
    const grp = new Function('todoBucket', 'calWeekStart', takeFn('todoGroup') + 'return todoGroup;')(bucket(() => ymd(new Date())), () => w);
    const now = new Date(), wend = (w + 6) % 7, toEnd = (wend - now.getDay() + 7) % 7;
    const at = (k) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + k); return { due_date: ymd(d) }; };
    if (toEnd >= 2) is(label + '：週の終わりの日は今週', grp(at(toEnd)), 'week');
    is(label + '：週の終わりの翌日はそれ以降', grp(at(toEnd + 1)), toEnd + 1 === 1 ? 'tomorrow' : 'later');
  }
  const lab = (w) => new Function('calWeekStart', takeFn('todoWeekLab') + 'return todoWeekLab;')(() => w)();
  is('見出し：月曜始まり', lab(1), '今週（日曜まで）');
  is('見出し：日曜始まり', lab(0), '今週（土曜まで）');
}

// ③ 束の見出しは上に貼り付く・今日の束のいまの線・過ぎた時刻
ok('CSS：束の見出しを貼り付ける', /\.todo-gh\{[^}]*position:sticky;top:-12px;/.test(SRC));
{
  const p = takeFn('todoPaint');
  ok('今日の束：時刻を過ぎたものとこれからのもののあいだに「いま」の線', /if\(g\[0\]==='today'\)\{/.test(p) && /\(i===nowAt\?todoNowLine\(\):''\)\+todoItemHtml\(t, nm, g\[2\]\)/.test(p) && /\(nowAt===list\.length\?todoNowLine\(\):''\)/.test(p));
  ok('時刻を過ぎていなければ線は引かない', /if\(anyPast\)\{/.test(p));
  ok('今週の見出しは週の始まりに合わせる', /var glab=\(g\[0\]==='week'\)\?todoWeekLab\(\):g\[1\];/.test(p));
  const pill = takeFn('todoDuePill');
  ok('時刻を過ぎた今日の札は「過ぎています」', /if\(tm && tm<=hm\)\{ txt\+=' 過ぎています'; cls='today late'; \}/.test(pill));
  ok('いまの線は予定と同じ形', /'<div class="cev-nowl todo-nowl"><span>いま '/.test(takeFn('todoNowLine')));
}

// ④ 済んだ日時
{
  const lab = new Function('todoYmd', 'todoToday', takeFn('todoDoneLab') + 'return todoDoneLab;')(ymd, () => ymd(new Date()));
  const now = new Date();
  ok('今日なら「今日 HH:MM に済み」', /^今日 \d\d:\d\d に済み$/.test(lab(now.toISOString())));
  is('それより前は「M/D（曜）に済み」', lab(new Date(2026, 9, 15, 10, 0).toISOString()), '10/15（木）に済み');
  ok('札に使う', /meta\.push\('<span class="todo-donel">'\+esc\(todoDoneLab\(t\.done_at\)\)\+'<\/span>'\)/.test(takeFn('todoItemHtml')));
}

// ⑤ 説明書
for (const f of ['manual-customer.html', 'manual-partner.html']) {
  const m = R(f);
  ok('説明書（' + f + '）', /<b>週は月曜始まり<\/b>です。/.test(m) && /<b>「過ぎています」<\/b>/.test(m) && /束の見出し（期限切れ・今日・明日…）は下へ読み進めても<b>上に残ります<\/b>/.test(m) && /今週（週の終わりまで）/.test(m));
}
is('版が揃う', [SRC.match(/var APP_BUILD='([^']+)'/)[1], VER.build], [VER.build, VER.build]);
if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b.name, '\n   got ', b.got, '\n   want', b.want)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
