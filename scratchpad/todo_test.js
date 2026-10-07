// =============================================================
// 継ナビくんの TODO（2026-09-27）
//   ① SQL：本人だけの表（todos）・題名の長さ・索引・何度流しても同じ
//   ② 継ナビくん：TODO タブ・数字（ボタン・タブ・内訳の帯）・書く欄・済み／戻す
//   ③ 予定の暦に青緑で並ぶ・小窓から済みにする
//   ④ 相談から入れる（[TODO] 行 → 確認のカード → 押すまで入らない）
//   ⑤ 毎朝の今日の一手（パートナー）・毎週月曜の今週のひとこと（経営者）
//   ⑥ 説明書・継ナビくんの知識・版
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const SQL = R('supabase/migrations/20260927010000_todos.sql');
const HB = R('supabase/functions/agent-heartbeat/index.ts');
const MANC = R('manual-customer.html'), MANP = R('manual-partner.html'), MANA = R('manual-admin.html');
const VER = JSON.parse(R('version.json'));
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

// ① SQL
ok('SQL：表を作る（何度流しても同じ）', /create table if not exists public\.todos \(/.test(SQL));
ok('SQL：持ち主は既定で本人・消えたら一緒に消える', /owner_id\s+uuid not null default auth\.uid\(\) references auth\.users\(id\) on delete cascade/.test(SQL));
ok('SQL：期限の日付と時刻は任意', /due_date\s+date,/.test(SQL) && /due_time\s+time,/.test(SQL));
ok('SQL：顧客のひも付けは任意（顧客が消えたら外れる）', /customer_id uuid references auth\.users\(id\) on delete set null/.test(SQL));
ok('SQL：題名は1〜200字（空白だけは不可）', /check \(char_length\(btrim\(title\)\) between 1 and 200\)/.test(SQL) && /drop constraint if exists todos_title_check/.test(SQL));
ok('SQL：索引は2つ（済んでいないものだけ）', (SQL.match(/create index if not exists todos_\w+_idx on public\.todos \([^)]*\) where done_at is null;/g) || []).length === 2);
ok('SQL：直した時刻を残す', /create trigger todos_touch before update on public\.todos/.test(SQL) && /drop trigger if exists todos_touch/.test(SQL));
ok('SQL：権限（RLS）を有効に', /alter table public\.todos enable row level security;/.test(SQL));
ok('SQL：本人だけが読み書き（運営も読めない）', /create policy "todos own" on public\.todos\s+for all to authenticated\s+using \(owner_id = auth\.uid\(\)\)\s+with check \(owner_id = auth\.uid\(\)\);/.test(SQL)
  && (SQL.match(/create policy/g) || []).length === 1 && !/ep_is_admin/.test(SQL));
ok('SQL：確かめかたを添える', /表=1/.test(SQL) && /権限（表）=1/.test(SQL) && /索引=2/.test(SQL));

// ② 継ナビくんの TODO タブ
ok('タブ：予定の次に ✅ TODO（数字つき）', /<button id="knv-tab-cal"[^\n]*\n\s*<button id="knv-tab-todo" onclick="knvShowTab\('todo'\)"><span class="ki">✅<\/span>TODO<span id="knv-todobadge" class="knv-tbadge hidden">0<\/span><\/button>/.test(SRC));
ok('タブ：中身の入れ物', /<div id="knv-todo" class="knv-body hidden"><\/div>/.test(SRC));
const show = takeFn('knvShowTab');
ok('タブ：切り替えの表に todo', /todo:'knv-todo'/.test(show) && /if\(t==='todo'\) knvRenderTodo\(\);/.test(show));
ok('初期化：読み直してから数字を出す', /TODO_ROWS=null; TODO_CLIENTS=null; TODO_EDIT=null; todoLoad\(\);/.test(SRC));
const load = takeFn('todoLoad');
ok('読む：期限の近い順（期限なしは後ろ）', /\.order\('due_date',\{ascending:true, nullsFirst:false\}\)\.order\('created_at',\{ascending:true\}\)/.test(load));
ok('読む：表が無くても止まらない', /TODO_ROWS=\[\]; TODO_ERR=/.test(load));
ok('読む：表が無いときは SQL の名前を出す', /TODO の表がまだ用意されていません（SQL 20260927010000_todos\.sql の実行が必要です）/.test(SRC));

// 期限の仕分け（今日・期限切れ・これから・期限なし・済み）
{
  const env = takeFn('todoYmd') + takeFn('todoToday') + takeFn('todoBucket') + takeFn('todoDueLabel') + takeFn('todoDueCount');
  const f = new Function('var TODO_ROWS=arguments[0];' + env + '; return { todoBucket, todoDueLabel, todoDueCount, todoYmd };');
  const d = (k) => { const x = new Date(); x.setDate(x.getDate() + k); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  const rows = [
    { title: 'a', due_date: d(-2) }, { title: 'b', due_date: d(0), due_time: '15:00:00' },
    { title: 'c', due_date: d(3) }, { title: 'd' }, { title: 'e', due_date: d(-5), done_at: '2026-09-01' },
  ];
  const T = f(rows);
  ok('仕分け：期限切れ', T.todoBucket(rows[0]) === 'over');
  ok('仕分け：今日', T.todoBucket(rows[1]) === 'today');
  ok('仕分け：これから', T.todoBucket(rows[2]) === 'later');
  ok('仕分け：期限なし', T.todoBucket(rows[3]) === 'none');
  ok('仕分け：済んだものは済み（期限切れにしない）', T.todoBucket(rows[4]) === 'done');
  ok('数字：今日まで（期限切れを含む・済みは除く）', T.todoDueCount() === 2);
  ok('表示：今日は「今日 15:00」', T.todoDueLabel(rows[1]) === '今日 15:00');
  ok('表示：期限切れは頭に「期限切れ」', /^期限切れ \d+\/\d+（[日月火水木金土]）$/.test(T.todoDueLabel(rows[0])));
  ok('表示：期限なしは空', T.todoDueLabel(rows[3]) === '');
}
const badge = takeFn('todoBadge');
ok('数字：TODO タブの数字（9より多いと 9+）', /window\.__KNV_MYTODO=n;/.test(badge) && /n>9\?'9\+':n/.test(badge) && /knvBadgesRender\(\)/.test(badge));
const br = takeFn('knvBadgesRender');
ok('数字：右下のボタンにも足す（お知らせタブの数字には足さない）', /var fabN=total\+\(window\.__KNV_MYTODO\|\|0\);/.test(br) && /b\.textContent=fabN>9\?'9\+':fabN;/.test(br) && /if\(fabN>\(window\.__KNV_LAST\|\|0\)\) knvHop\(\);/.test(br));
const sum = takeFn('knvSummaryRender');
ok('内訳の帯：「✅ 今日までのTODO」から TODO タブへ', /my=window\.__KNV_MYTODO\|\|0/.test(sum) && /!ins && !my\)/.test(sum) && /knvShowTab\(\\'todo\\'\)">✅ 今日までのTODO <b>'\+my\+'<\/b>件<\/button>/.test(sum));

const paint = takeFn('todoPaint');
ok('書く欄：題名（Enter で入る。変換中は入らない）', /id="td-title"[^>]*maxlength="200"/.test(paint) && /event\.key===\\'Enter\\'&&!event\.isComposing/.test(paint));
ok('書く欄：期限の札と「なし」', /todoQuick\(\)\.map/.test(paint) && /todoSetDue\(\\'\\'\)">なし<\/button>/.test(paint));
ok('書く欄：日付・時刻・メモ', /id="td-date" type="date"/.test(paint) && /id="td-time" type="time"/.test(paint) && /id="td-note"/.test(paint));
ok('書く欄：顧客のひも付けはパートナーだけ', /id="td-cust"/.test(paint) && /顧客にひも付けない/.test(paint));
ok('並び：期限ごとの束で描く（束の名前は TODO_GROUPS）', /TODO_GROUPS\.forEach\(function\(g\)\{/.test(paint) && /todoGroup\(t\)===g\[0\]/.test(paint));
ok('済んだもの：今日の分は残し、それより前は見る／隠す', /✓ 今日済んだこと/.test(paint) && /それより前に済んだものを隠す/.test(paint) && /それより前に済んだもの（'\+doneOld\.length\+'件）を見る/.test(paint));
ok('経営者には「やることメモ」との違いを言う', /===\s*'customer'/.test(paint) && /ご自身だけ<\/b>が見る控えです/.test(paint) && /goSec\(\\'sec-mypdca\\'\)">経営課題の「やることメモ」<\/a>へ/.test(paint));
const quick = takeFn('todoQuick');
ok('札：今日・明日・金曜・来週月曜', /'今日'/.test(quick) && /'明日'/.test(quick) && /金曜/.test(quick) && /来週月曜/.test(quick));
const clients = takeFn('todoClients');
ok('ひも付け先：自分の担当顧客だけ', /\.eq\('role','customer'\)\.eq\('consultant_id',ME\)/.test(clients) && /!=='consultant'/.test(clients));
const save = takeFn('todoSave');
ok('保存：新しいものは本人の名前で', /insert\(Object\.assign\(\{ owner_id:ME \}, row\)\)/.test(save) && /update\(row\)\.eq\('id',TODO_EDIT\)/.test(save));
const done = takeFn('todoDone');
ok('済み：日時を入れる／戻すと空に', /update\(\{ done_at: on \? new Date\(\)\.toISOString\(\) : null \}\)\.eq\('id',id\)/.test(done));
ok('消す：確かめてから', /confirm\(/.test(takeFn('todoDel')) && /\.delete\(\)\.eq\('id',id\)/.test(takeFn('todoDel')));
const changed = takeFn('todoChanged');
ok('変えたら暦と数字も直す', /knvAgendaReset\(\)/.test(changed) && /todoBadge\(\)/.test(changed));

// ③ 予定の暦
ok('暦：TODO の色（青緑）', /todo:\s*\{ label:'TODO',\s*bd:'#BFE0DA', bg:'rgba\(20,122,110,\.08\)',\s*fg:'#147A6E' \}/.test(SRC));
const ext = takeFn('calExtraFetch');
ok('暦：期限のある・済んでいない TODO を並べる', /from\('todos'\)\.select\('id,title,due_date,due_time,note,customer_id'\)\s*\.is\('done_at',null\)\.not\('due_date','is',null\)/.test(ext));
ok('暦：時刻があればその時刻、無ければ終日', /when: timed \? \(x\.due_date\+'T'\+String\(x\.due_time\)\.slice\(0,5\)\+':00'\) : calDayIso\(x\.due_date\)/.test(ext) && /allDay:!timed/.test(ext));
ok('暦：ひも付けた会社名を頭に', /title:who\(x\.customer_id\)\+\(x\.title\|\|'TODO'\)/.test(ext));
const peek = takeFn('calPeek');
ok('小窓：どこから来たか・済みにする・TODO を開く', /継ナビくんの TODO です。直すときは TODO タブから。/.test(peek) && /todoDone\(/.test(peek) && /✓ 済みにする/.test(peek) && /TODO を開く/.test(peek));

// ④ 相談から入れる
const note = takeFn('todoNote'), ask = takeFn('todoAskNote');
ok('相談：いまの TODO を継ナビくんに渡す', /【TODO】/.test(note));
ok('相談：頼まれたときだけ [TODO] 行を出す', /\[TODO\] \{"title":"やること","due":"YYYY-MM-DD（期限が無ければ空）","time":"HH:MM（無ければ空）","note":"メモ（無ければ空）"\}/.test(ask)
  && /\[TODO\] と \[EVENT\] を同時に出さないこと/.test(ask));
ok('相談：渡す順（予定の案内の次）', /calAskNote\(\)\+todoNote\(\)\+todoAskNote\(\)\+secDrillNote\(\)/.test(SRC) && /if\(!TODO_ROWS\) await todoLoad\(\);/.test(SRC));
ok('相談：[TODO] は [EVENT] より先に切り出す', SRC.indexOf("out.match(/\\n?\\s*\\[TODO\\]") > 0 && SRC.indexOf("out.match(/\\n?\\s*\\[TODO\\]") < SRC.indexOf("out.match(/\\n?\\s*\\[EVENT\\]"));
ok('相談：下書きを会話に添える', /draft:ev, tdraft:td\}/.test(SRC));
{
  const env = takeFn('todoYmd') + takeFn('todoToday') + takeFn('todoDraftClean');
  const clean = new Function(env + '; return todoDraftClean;')();
  const d = (k) => { const x = new Date(); x.setDate(x.getDate() + k); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  ok('下書き：題名が空なら出さない', clean({ title: '  ' }) === null && clean(null) === null);
  const a = clean({ title: '見積を送る', due: d(3), time: '10:30', note: 'A社' });
  ok('下書き：そのまま通る', a && a.title === '見積を送る' && a.due === d(3) && a.time === '10:30' && a.note === 'A社');
  ok('下書き：遠すぎる期限は外す（2年より先）', clean({ title: 'x', due: d(800) }).due === '');
  ok('下書き：過ぎた期限は前日まで', clean({ title: 'x', due: d(-1) }).due === d(-1) && clean({ title: 'x', due: d(-3) }).due === '');
  ok('下書き：変な日付・時刻は外す', clean({ title: 'x', due: '2026-13-40', time: '10:30' }).due === '' && clean({ title: 'x', due: d(1), time: '25時' }).time === '');
  ok('下書き：期限が無ければ時刻も無し', clean({ title: 'x', time: '10:00' }).time === '');
  ok('下書き：題名は200字まで', clean({ title: 'あ'.repeat(250) }).title.length === 200);
}
const card = takeFn('todoDraftCard');
ok('確認のカード：押すまで入らない', /この TODO を入れますか？/.test(card) && /todoDraftSave\('\+mi\+'\)">✅ TODO に入れる<\/button>/.test(card) && /todoDraftDrop\('\+mi\+'\)">やめる<\/button>/.test(card));
ok('確認のカード：入れるのは本人の名前で', /from\('todos'\)\.insert\(\{ owner_id:ME, title:d\.title, due_date:d\.due\|\|null,/.test(takeFn('todoDraftSave')));

// ⑤ 毎朝・毎週の便り
ok('便り：本人の TODO（期限が今日まで・済んでいない）', /async function todoItems\(sb: any, ownerId: string, upto: string\)/.test(HB)
  && /\.from\("todos"\)\s*\.select\("title, due_date, due_time"\)\s*\.eq\("owner_id", ownerId\)\.is\("done_at", null\)\s*\.not\("due_date", "is", null\)\.lte\("due_date", upto\)/.test(HB));
ok('便り：TODO の枠は無い日は出さない', /function todoBlock\(items: AgendaItem\[\], span: string\): string \{\s*if \(!items\.length\) return "";\s*return `\*\*【TODO（\$\{span\}）】\*\*\\n`/.test(HB));
ok('毎朝：担当顧客がいなくても TODO があれば届ける', /const briefTargets = new Map\(byPartner\);\s*await addTodoPartners\(sb, briefTargets\);/.test(HB)
  && /\.eq\("role", "consultant"\)/.test(HB.slice(HB.indexOf('async function addTodoPartners'))));
ok('毎朝：今日までの TODO を予定の下に', /const todos = await todoItems\(sb, partnerId, jstToday\(\)\.date\);/.test(HB) && /brief\.body = agendaBlock\(agenda\) \+ todoBlock\(todos, "今日まで"\) \+ brief\.body;/.test(HB));
ok('毎朝：TODO だけの日は AI を呼ばずに一通', /\{ title: `今日までのTODOが\$\{todos\.length\}件あります`, body: "" \}/.test(HB));
ok('毎週：今週末までの TODO を予定の下に', /const myTodos = await todoItems\(sb, c\.id, jstDateAfter\(6\)\);/.test(HB) && /brief\.body = weekBlock\(agenda\) \+ todoBlock\(myTodos, "今週まで"\) \+ brief\.body;/.test(HB));
ok('毎週：TODO だけの週も届ける（AI は呼ばない）', /if \(!signals\.length && !agenda\.length && !myTodos\.length\) continue;/.test(HB) && /\{ title: `今週までのTODOが\$\{myTodos\.length\}件あります`, body: "" \}/.test(HB));
{
  //  同じ輪の中で同じ名前を二度宣言すると、Edge Function が起動しない
  const i = HB.indexOf('const myTodos = await todoItems(sb, c.id');
  const loop = HB.slice(HB.lastIndexOf('for (const c of', i), HB.indexOf('agent_insights', i));
  ok('毎週：「todos」を二度宣言しない', (loop.match(/const todos\b/g) || []).length === 1 && (loop.match(/const myTodos\b/g) || []).length === 1);
}
ok('便り：理由の欄に TODO', /\.\.\.todos\.map\(\(a\) => "TODO: " \+ a\.text\)/.test(HB) && /\.\.\.myTodos\.map\(\(a\) => "TODO: " \+ a\.text\)/.test(HB));

// ⑥ 説明書・知識・版
const slideOf = (h) => (h.match(/<section class="slide" data-t="TODO（やること）"[\s\S]*?<\/section>/) || [''])[0];
const sc = slideOf(MANC), sp = slideOf(MANP);
ok('説明書（経営者）：TODO の頁', !!sc && /ご本人だけが見られます/.test(sc) && /今週のひとこと/.test(sc) && /「✅ TODO に入れる」を押すまで入りません/.test(sc) && /やることメモ/.test(sc));
ok('説明書（パートナー）：TODO の頁', !!sp && /ご自身だけが見られます/.test(sp) && /今日の一手/.test(sp) && /担当顧客をひも付ける/.test(sp) && /課題（PDCA）/.test(sp));
ok('説明書：頁は予定の次', MANC.indexOf('data-t="TODO（やること）"') > MANC.indexOf('data-t="予定（カレンダー）"') && MANP.indexOf('data-t="TODO（やること）"') > MANP.indexOf('data-t="予定（カレンダー）"'));
ok('説明書：質問の見出し（data-q）', /data-t="TODO（やること）"[^>]*data-q="[^"]*TODO/.test(MANC) && /data-t="TODO（やること）"[^>]*data-q="[^"]*TODO/.test(MANP));
ok('説明書：予定の色に青緑', /<b>青緑<\/b>…TODO/.test(MANC) && /<b>青緑<\/b>…ご自身のTODO/.test(MANP));
ok('説明書（パートナー）：タブは8つ・TODO の行', /継ナビくんの8つのタブ/.test(MANP) && /<tr><th>✅ TODO<\/th>/.test(MANP));
ok('説明書（パートナー）：今日の一手の【TODO（今日まで）】', /本文の【TODO（今日まで）】/.test(MANP));
ok('説明書（経営者）：今週のひとことの【TODO（今週まで）】', /【TODO（今週まで）】/.test(MANC));
ok('説明書（運営）：本人だけ・運営も読めない', /✅ TODO（本人だけの「やること」の控え/.test(MANA) && /<code>todos<\/code> は権限（RLS）で本人以外は読めず、運営も読めません/.test(MANA));
ok('知識：パートナーは8タブ・経営者は7タブ', /パネルは8タブ: 相談\(このチャット/.test(SRC) && /パネルは7タブ: 相談\(24時間/.test(SRC) && !/パネルは6タブ/.test(SRC));
ok('知識：TODO の説明（両方）', (SRC.match(/／✅TODO\(自分用のやること控え。本人だけが見え/g) || []).length === 2);
ok('知識：予定の色に青緑（両方）', (SRC.match(/紫=補助金の締切・青緑=TODO/g) || []).length === 2);
const build = SRC.match(/var APP_BUILD='([^']+)'/)[1];
ok('版が揃う', build === VER.build && build === '20261007-04');

if (bad.length) { bad.forEach((b) => console.log('NG ' + b)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK ' + n + ' checks, 0 failed');
