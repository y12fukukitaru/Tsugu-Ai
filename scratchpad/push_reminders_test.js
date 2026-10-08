// =============================================================
// 予定とTODOのスマホ通知（2026-10-08）
//   ① 何をいつ送るか（push-reminders の PLAN の部分を取り出して動かす）
//   ② 二度送らない・5分ごとの呼び出しは合言葉を写す（SQL）
//   ③ アプリ：設定（何分前・TODO）・試しの通知・通知から予定/TODOタブへ
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const FN = R('supabase/functions/push-reminders/index.ts'), SQL = R('supabase/migrations/20261008010000_push_reminders.sql');
const SRC = R('index.html'), SW = R('sw.js'), MP = R('manual-partner.html'), MC = R('manual-customer.html');
let n = 0, bad = [];
function ok(name, c) { n++; if (!c) bad.push(name); }

// ① 送るものを決める部分
const plan = FN.slice(FN.indexOf('// ===== PLAN START ====='), FN.indexOf('// ===== PLAN END ====='));
const P = new Function(plan + '\nreturn { buildPlan, jstYmd, jstAt, isMorning, GRACE_MIN };')();
const J = (ymd, hm) => { const [h, m] = hm.split(':').map(Number); return P.jstAt(ymd, h, m); };
const iso = (ms) => new Date(ms).toISOString();
const D = '2026-10-08', now = J(D, '14:00');
const U = (...a) => new Set(a);
const base = { now, users: U('u1', 'p1', 'c1'), prefs: {}, events: [], meetings: [], people: {}, todos: [], allDay: [], dayTodos: [], custTodos: [], appUrl: 'https://x.example/app/' };
const run = (o) => P.buildPlan(Object.assign({}, base, o));

ok('日本時間の今日・時刻の換算', P.jstYmd(J(D, '00:10'), 0) === D && P.jstYmd(J(D, '23:50'), 0) === D && iso(J(D, '09:00')) === '2026-10-08T00:00:00.000Z');
let r = run({ events: [{ id: 'e1', owner_id: 'u1', title: '高重さん', starts_at: iso(J(D, '14:30')), place: '安田幼稚園' }] });
ok('予定：既定は30分前（14:30の予定を14:00に）', r.length === 1 && r[0].kind === 'event' && r[0].title === '📅 30分後：高重さん' && r[0].body === '14:30から　安田幼稚園' && r[0].fire_at === J(D, '14:00'));
ok('予定：押すと予定タブ（?knv=cal）・同じ予定は tag で重ねる', r[0].url === 'https://x.example/app/?knv=cal' && r[0].tag === 'event-e1' && r[0].ref_id === 'e1');
r = run({ prefs: { u1: { event_before_min: 10 } }, events: [{ id: 'e1', owner_id: 'u1', title: 'A', starts_at: iso(J(D, '14:30')) }] });
ok('予定：10分前の設定ならまだ送らない', r.length === 0);
r = run({ prefs: { u1: { event_before_min: 10 } }, now: J(D, '14:20'), events: [{ id: 'e1', owner_id: 'u1', title: 'A', starts_at: iso(J(D, '14:30')) }] });
ok('予定：10分前の設定なら14:20に', r.length === 1 && r[0].title === '📅 10分後：A');
r = run({ prefs: { u1: { event_before_min: 60 } }, events: [{ id: 'e1', owner_id: 'u1', title: 'A', starts_at: iso(J(D, '15:00')) }] });
ok('予定：1時間前は「1時間後」', r.length === 1 && r[0].title === '📅 1時間後：A');
r = run({ prefs: { u1: { event_on: false } }, events: [{ id: 'e1', owner_id: 'u1', title: 'A', starts_at: iso(J(D, '14:30')) }] });
ok('予定：知らせない設定なら送らない', r.length === 0);
r = run({ events: [{ id: 'e1', owner_id: 'u1', title: 'A', starts_at: iso(J(D, '14:15')) }] });
ok('予定：呼び出しが遅れても、時刻を過ぎて20分までは送る（13:45の分）', r.length === 1 && r[0].fire_at === J(D, '13:45'));
r = run({ prefs: { u1: { event_before_min: 60 } }, events: [{ id: 'e1', owner_id: 'u1', title: 'A', starts_at: iso(J(D, '14:30')) }] });
ok('予定：古すぎる（30分過ぎた）通知は送らない', r.length === 0);
r = run({ events: [{ id: 'e1', owner_id: 'u1', title: 'A', starts_at: iso(J(D, '13:59')) }] });
ok('予定：もう始まった予定には送らない', r.length === 0);
r = run({ events: [{ id: 'e1', owner_id: 'x9', title: 'A', starts_at: iso(J(D, '14:30')) }] });
ok('予定：通知を受け取る端末が無い人には作らない', r.length === 0);
r = run({ meetings: [{ id: 'm1', customer_id: 'c1', meet_at: iso(J(D, '14:30')), place: '本社' }], people: { c1: { company_name: '株式会社継', consultant_id: 'p1' } } });
ok('面談：経営者ご本人と担当パートナーの両方へ', r.length === 2 && r.some((x) => x.user_id === 'c1' && x.title === '📅 30分後：担当パートナーとの面談') && r.some((x) => x.user_id === 'p1' && x.title === '📅 30分後：株式会社継との面談' && x.body === '14:30から　本社'));
r = run({ prefs: { p1: { event_before_min: 60 } }, meetings: [{ id: 'm1', customer_id: 'c1', meet_at: iso(J(D, '14:30')) }], people: { c1: { consultant_id: 'p1' } } });
ok('面談：それぞれの設定で（パートナーは1時間前なので、もう過ぎて送らない）', r.length === 1 && r[0].user_id === 'c1');
r = run({ todos: [{ id: 't1', owner_id: 'u1', title: '見積を送る', due_date: D, due_time: '14:00:00' }] });
ok('TODO：期限の時刻に・TODOタブへ', r.length === 1 && r[0].kind === 'todo' && r[0].title === '✅ TODO：見積を送る' && r[0].url.endsWith('?knv=todo') && /期限 14:00/.test(r[0].body));
r = run({ todos: [{ id: 't1', owner_id: 'u1', title: 'A', due_date: D, due_time: '13:30' }] });
ok('TODO：30分過ぎたものは送らない', r.length === 0);
r = run({ prefs: { u1: { todo_on: false } }, todos: [{ id: 't1', owner_id: 'u1', title: 'A', due_date: D, due_time: '14:00' }] });
ok('TODO：知らせない設定なら送らない', r.length === 0);
r = run({ now: J('2026-10-09', '00:05'), todos: [{ id: 't1', owner_id: 'u1', title: 'A', due_date: D, due_time: '23:55' }] });
ok('TODO：日付の変わり目をまたいでも届く', r.length === 1);
const morning = { now: J(D, '08:05'), allDay: [{ id: 'a1', owner_id: 'u1', title: '文化祭り' }], dayTodos: [{ id: 'd1', owner_id: 'u1', title: '請求書' }], custTodos: [{ id: 'k1', customer_id: 'c1', title: '試算表を送る' }] };
r = run(morning);
ok('朝8時：終日の予定と時刻のないTODOをまとめて1通', r.length === 2 && r.some((x) => x.user_id === 'u1' && x.kind === 'morning' && x.title === '☀️ 今日の予定とTODO（2件）' && x.body === '・終日 文化祭り\n・TODO 請求書' && x.ref_id === D && x.fire_at === J(D, '08:00')));
ok('朝8時：経営者のやること（customer_todos）も', r.some((x) => x.user_id === 'c1' && x.body === '・やること 試算表を送る' && x.url.endsWith('?knv=todo')));
ok('朝8時のまとめは、その時間帯だけ', run(Object.assign({}, morning, { now: J(D, '07:55') })).length === 0 && run(Object.assign({}, morning, { now: J(D, '08:30') })).length === 0 && P.isMorning(J(D, '08:19')));
r = run(Object.assign({}, morning, { prefs: { u1: { todo_on: false } } }));
ok('朝8時：TODOを知らせない人には予定だけ', r.some((x) => x.user_id === 'u1' && x.body === '・終日 文化祭り'));
r = run({ now: J(D, '08:05'), dayTodos: [1, 2, 3, 4, 5, 6, 7].map((i) => ({ id: 'd' + i, owner_id: 'u1', title: 'T' + i })) });
ok('朝8時：多いときは5件まで並べて「ほか◯件」', r.length === 1 && /ほか 2件$/.test(r[0].body) && r[0].title === '☀️ 今日の予定とTODO（7件）');

// ①' メッセージと対応が必要なこと（2026-10-08 追加）
{
  const at = (hm) => iso(J(D, hm));
  const ppl = { c1: { company_name: '株式会社継', consultant_id: 'p1' } };
  r = run({ people: ppl, msgs: [{ customer_id: 'c1', sender_id: 'c1', sender_role: 'customer', body: '来月の賞与の件で相談があります', created_at: at('13:59') }] });
  ok('メッセージ：経営者から → 担当パートナーへ・メッセージタブ・会社ごとに1枚に重ねる', r.length === 1 && r[0].user_id === 'p1' && r[0].title === '✉️ 株式会社継からメッセージ' && r[0].body === '来月の賞与の件で相談があります' && r[0].url.endsWith('?knv=msg') && r[0].tag === 'msg-c1');
  r = run({ people: ppl, msgs: [{ customer_id: 'c1', sender_id: 'p1', sender_role: 'consultant', body: '', attachment_name: '試算表.pdf', created_at: at('13:59') }] });
  ok('メッセージ：担当パートナーから → 経営者へ（添付だけでも）', r.length === 1 && r[0].user_id === 'c1' && r[0].title === '✉️ 担当パートナーからメッセージ' && r[0].body === '📎 試算表.pdf');
  r = run({ people: ppl, msgs: [{ customer_id: 'c1', sender_id: 'c1', sender_role: 'customer', body: 'A', created_at: at('13:30') }] });
  ok('メッセージ：20分より前のものは送らない', r.length === 0);
  r = run({ people: ppl, prefs: { p1: { msg_on: false } }, msgs: [{ customer_id: 'c1', sender_id: 'c1', sender_role: 'customer', body: 'A', created_at: at('13:59') }] });
  ok('メッセージ：知らせない設定なら送らない', r.length === 0);
  const r1 = run({ people: ppl, msgs: [{ customer_id: 'c1', sender_id: 'c1', sender_role: 'customer', body: 'A', created_at: at('13:58') }, { customer_id: 'c1', sender_id: 'c1', sender_role: 'customer', body: 'B', created_at: at('13:59') }] });
  ok('メッセージ：1通ずつ記録（同じものは二度送らない）', r1.length === 2 && r1[0].ref_id !== r1[1].ref_id && r1[0].kind === 'msg');
  r = run({ replies: [{ id: 'q1', partner_id: 'p1', subject: '報酬の締め日', admin_reply: '毎月末です', replied_at: at('13:59') }] });
  ok('運営からの回答 → パートナーへ・サポートタブ', r.length === 1 && r[0].title === '✉️ 運営から回答：報酬の締め日' && r[0].body === '毎月末です' && r[0].url.endsWith('?knv=support'));
  const roles = { u1: 'consultant', p1: 'consultant', c1: 'customer', a1: 'admin' };
  r = run({ users: U('u1', 'p1', 'c1', 'a1'), roles, anns: [{ id: 'n1', audience: 'consultant', title: '研修の更新', body: '第5章にロールプレイ', created_at: at('13:59') }] });
  ok('お知らせ：宛先の役割の方だけ（運営には送らない）', r.length === 2 && r.every((x) => ['u1', 'p1'].includes(x.user_id)) && r[0].title === '📢 運営からのお知らせ：研修の更新');
  r = run({ users: U('u1', 'p1', 'c1', 'a1'), roles, anns: [{ id: 'n1', audience: 'all', title: 'T', body: 'B', created_at: at('13:59') }] });
  ok('お知らせ：全員あては運営以外の全員へ', r.length === 3 && !r.some((x) => x.user_id === 'a1'));
  r = run({ acts: [{ id: 'k1', customer_id: 'c1', title: '試算表を送る', due_date: '2026-10-10', created_by: 'p1', created_at: at('13:59') }] });
  ok('対応事項：担当が登録したら経営者へ（期日つき）', r.length === 1 && r[0].user_id === 'c1' && r[0].title === '📌 対応のお願い：試算表を送る' && r[0].body === '担当パートナーから（期日 10/10）' && r[0].url === 'https://x.example/app/');
  r = run({ acts: [{ id: 'k1', customer_id: 'c1', title: 'A', created_by: 'c1', created_at: at('13:59') }] });
  ok('対応事項：経営者が自分で書いたものは知らせない', r.length === 0);
  r = run({ prefs: { c1: { act_on: false } }, acts: [{ id: 'k1', customer_id: 'c1', title: 'A', created_by: 'p1', created_at: at('13:59') }] });
  ok('対応事項：知らせない設定なら送らない', r.length === 0);
  r = run({ people: ppl, shares: [{ id: 's1', customer_id: 'c1', question: '後継者がいないとき、何から始めればいい？', created_at: at('13:59') }] });
  ok('相談の共有 → 担当パートナーへ', r.length === 1 && r[0].user_id === 'p1' && r[0].title === '📌 株式会社継から相談の共有');
  r = run({ reports: [{ id: 'm1', customer_id: 'c1', report_month: '2026-09', published_at: at('13:59') }] });
  ok('月次レポートの公開 → 経営者へ', r.length === 1 && r[0].title === '📄 2026年9月の月次レポートが届きました');
  r = run({ users: U('a1', 'p1'), roles, people: ppl, inquiries: [{ id: 'i1', partner_id: 'p1', subject: '契約書', created_at: at('13:59') }],
    cancels: [{ id: 'x1', customer_id: 'c1', created_at: at('13:59') }], exits: [{ id: 'e1', partner_id: 'p1', created_at: at('13:59') }],
    planReqs: [{ id: 'r1', customer_id: 'c1', to_plan: 'buyer', created_at: at('13:59') }] });
  ok('運営あて：問い合わせ・解約・契約の終了・プラン切替は運営だけへ', r.length === 4 && r.every((x) => x.user_id === 'a1')
    && r.some((x) => x.title === '🛟 パートナーから問い合わせ：契約書') && r.some((x) => x.title === '⚠ 解約のご依頼が届きました' && x.body.startsWith('株式会社継から'))
    && r.some((x) => x.title === '🔁 プラン切替の依頼が届きました' && /買い手プランへ/.test(x.body)));
  r = run({ now: J(D, '08:05'), dayActs: [{ id: 'k1', customer_id: 'c1', title: '試算表を送る' }] });
  ok('朝8時：期日が今日の対応事項もまとめに', r.length === 1 && r[0].body === '・対応 試算表を送る');
}

// ② 送る側
ok('関数：合言葉が無ければ断る・?dry=1 は送らずに中身を返す', /given !== CRON_SECRET\) return json\(\{ error: "forbidden" \}, 403\)/.test(FN) && /if \(dry\) return \{ users: users\.length, planned: plan\.length, sent: 0, dry, morning, plan \}/.test(FN));
ok('関数：記録に書き込めたものだけ送る（二度送らない）', /\.upsert\(\{ user_id: n\.user_id, kind: n\.kind, ref_id: n\.ref_id, fire_at: new Date\(n\.fire_at\)\.toISOString\(\) \},\s*\{ onConflict: "user_id,kind,ref_id,fire_at", ignoreDuplicates: true \}\)/.test(FN) && /if \(!got\?\.length\) continue;/.test(FN));
ok('関数：解除された購読は掃除・記録は2週間で消す', /e\?\.statusCode === 404 \|\| e\?\.statusCode === 410\) await sb\.from\("push_subscriptions"\)\.delete\(\)\.eq\("id", s\.id\)/.test(FN) && /delete\(\)\.lt\("sent_at"/.test(FN));
ok('関数：端末のある人だけ・済んだTODOは見ない', /from\("push_subscriptions"\)\.select\("id, user_id, subscription"\)/.test(FN) && (FN.match(/\.is\("done_at", null\)/g) || []).length >= 3);
ok('関数：型の検査はしない（PLAN を素の JS で試験するため）', /^\/\/ @ts-nocheck/.test(FN) && !/: (string|number|any)\b/.test(plan));
ok('SQL：設定の表（本人だけ）・既定は30分前・10/30/60のみ', /create table if not exists public\.notify_prefs/.test(SQL) && /event_before_min smallint not null default 30 check \(event_before_min in \(10, 30, 60\)\)/.test(SQL) && /using \(user_id = auth\.uid\(\)\)\s*with check \(user_id = auth\.uid\(\)\)/.test(SQL));
ok('SQL：送った記録は (誰・種類・id・時刻) で一意・画面からは読めない', /unique \(user_id, kind, ref_id, fire_at\)/.test(SQL) && /revoke all on public\.push_reminder_log from anon, authenticated/.test(SQL));
ok('SQL：5分ごと。合言葉は毎朝のブリーフの登録から写す（貼り付けない）', /cron\.schedule\('push-reminders', '\*\/5 \* \* \* \*', c\)/.test(SQL) && /select command into c from cron\.job where jobname = 'agent-heartbeat-daily'/.test(SQL) && /replace\(c, '\/functions\/v1\/agent-heartbeat', '\/functions\/v1\/push-reminders'\)/.test(SQL) && !/'x-cron-secret', '/.test(SQL));
ok('SQL：二度流しても上書きしない・確かめる行がある', /if exists \(select 1 from cron\.job where jobname = 'push-reminders'\)/.test(SQL) && /as "呼び出し"/.test(SQL));

// ③ アプリ
ok('sw.js：tag で重ねて鳴らし直す', /if \(d\.tag\) \{ opt\.tag = d\.tag; opt\.renotify = true; \}/.test(SW));
ok('sw.js：押すと開いているアプリに知らせる／無ければ URL で開く', /postMessage\(\{ type: 'knv-open', tab: tab \}\)/.test(SW) && /return self\.clients\.openWindow\(url\);/.test(SW));
ok('アプリ：通知から開いたらそのタブへ（ログインのあと）', /knvDeepLink\(\);  \/\/ 予定・TODO の通知から開いたなら、そのタブへ/.test(SRC) && /var KNV_LINK_TABS=\['cal','todo','notif','msg','chat','support'\];/.test(SRC) && /d\.type==='knv-open' && KNV_LINK_TABS\.indexOf\(d\.tab\)>=0/.test(SRC));
ok('アプリ：連携タブに設定（何分前・TODO・試しの通知）', /<div id="notify-prefs-box"><\/div>/.test(SRC) && /pushStatusPaint\(\); notifyPrefsLoad\(\);/.test(SRC) && /opt\('10','開始の10分前',ev\)\+opt\('30','開始の30分前',ev\)\+opt\('60','開始の1時間前',ev\)\+opt\('off','知らせない',ev\)/.test(SRC) && /onclick="notifyTest\(\)"/.test(SRC));
ok('アプリ：保存は本人の行に upsert', /sb\.from\('notify_prefs'\)\.upsert\(row,\{ onConflict:'user_id' \}\)/.test(SRC) && /var row=\{ user_id:ME, event_on:ev!=='off'/.test(SRC));
ok('アプリ：受け取り中かをボタンに出す・毎朝だけと言わない', /この端末で受け取っています（押すと登録し直します）/.test(SRC) && !/この端末で毎朝の通知を受け取ります/.test(SRC));
ok('関数：新しく届いたものも読む（表が無くても止めない）', /const pick = async \(q: any\) => \{ try \{/.test(FN) && /from\("chat_messages"\)/.test(FN) && /from\("action_items"\)/.test(FN) && /from\("announcements"\)/.test(FN) && /roles, msgs, replies, anns, acts, shares, reports, inquiries, cancels, exits, planReqs, dayActs/.test(FN));
ok('関数：列が無い環境でも予定とTODOの設定は読む', /if \(r\.error\) r = await sb\.from\("notify_prefs"\)\.select\("user_id, event_on, event_before_min, todo_on"\)/.test(FN));
const SQL2 = R('supabase/migrations/20261008020000_push_messages.sql');
ok('SQL：メッセージ・対応の列を足し、1分ごとに', /add column if not exists msg_on boolean not null default true/.test(SQL2) && /add column if not exists act_on boolean not null default true/.test(SQL2) && /cron\.alter_job\(job_id := j, schedule := '\* \* \* \* \*'\)/.test(SQL2));
ok('アプリ：メッセージと対応の設定・役割ごとの説明・列が無いときは予定とTODOだけ保存', /id="np-mg"/.test(SRC) && /id="np-ac"/.test(SRC) && /function notifyWhatHtml\(\)/.test(SRC) && /msg_on:mg!=='off', act_on:ac!=='off'/.test(SRC) && /delete row\.msg_on; delete row\.act_on;/.test(SRC));
ok('アプリ：通知からサポートタブへも', /var KNV_LINK_TABS=\['cal','todo','notif','msg','chat','support'\];/.test(SRC));
ok('説明書：予定の前・TODOの期限・朝8時', /予定の前（10／30／60分前・面談も）とTODOの期限の時刻/.test(MP) && /予定の前（既定30分前）とTODOの期限の時刻/.test(MC));
ok('継ナビくんの知識にも', /スマホ通知は毎朝のブリーフに加えて、予定の10\/30\/60分前/.test(SRC));

if (bad.length) { bad.forEach((b) => console.log('NG ' + b)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK ' + n + ' checks, 0 failed');
