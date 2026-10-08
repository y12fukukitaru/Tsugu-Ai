// @ts-nocheck  下の「何を送るか」の部分を素の JavaScript のまま試験で動かすため、型の検査はしない
// =============================================================
// push-reminders: 予定とTODOを、スマホ（ホーム画面に追加したアプリ）へ知らせる
// ---------------------------------------------------------------
//  これまでプッシュ通知で届いていたのは、毎朝のブリーフ（agent-heartbeat）
//  だけだった。予定の直前や TODO の期限の時刻には何も来ないので、アプリを
//  開いていなければ思い出せない。ここで5分ごとに見て、時刻が来たものを送る。
//
//  何を、いつ送るか（設定は notify_prefs。行が無い人は既定）
//    ・予定（継ナビくんの予定タブ＝agenda_events）……開始の 10／30／60 分前（既定30分）
//    ・面談（meetings_scheduled）……同じく開始前。経営者ご本人と担当パートナーの両方へ
//    ・TODO（todos。期限の時刻があるもの）……期限の時刻に
//    ・終日の予定・時刻のない今日の TODO・経営者の「やること」（customer_todos）
//        ……朝8時（日本時間）にまとめて1通
//
//  二度送らない：送る前に push_reminder_log へ (誰・種類・id・時刻) を書き込み、
//  書き込めたものだけ送る。呼び出しが重なっても、遅れても、同じ通知は1回だけ。
//  呼び出しが遅れたときのために、時刻を過ぎて GRACE_MIN 分までは送る。
//  それより古いものは送らない（会議が終わってから「30分前です」は要らない）。
//
//  デプロイ: Supabase Dashboard → Edge Functions → push-reminders（Verify JWT はオフ）
//   Secrets は既存のものを使う：CRON_SECRET／VAPID_PUBLIC_KEY／VAPID_PRIVATE_KEY／
//   VAPID_SUBJECT／APP_URL（agent-heartbeat と同じ）
//  呼び出し: pg_cron が5分ごと（migrations/20261008010000_push_reminders.sql）
//  確かめる: ?dry=1 を付けると送らずに「いま送るもの」を JSON で返す
// =============================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "https://y12fukukitaru.github.io/Tsugu-Ai/";
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:no-reply@example.com";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const given = req.headers.get("x-cron-secret") || url.searchParams.get("secret") || "";
  if (!CRON_SECRET || given !== CRON_SECRET) return json({ error: "forbidden" }, 403);
  const dry = url.searchParams.get("dry") === "1";
  if (!dry && (!VAPID_PUBLIC || !VAPID_PRIVATE)) {
    return json({ skipped: "VAPID_PUBLIC_KEY／VAPID_PRIVATE_KEY が未設定のため送りません" });
  }
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    return json(await run(sb, Date.now(), dry));
  } catch (e) {
    console.error("push-reminders failed:", e);
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});

async function run(sb: any, now: number, dry: boolean) {
  // ---- 通知を受け取る端末がある人だけを見る ----
  const { data: subs, error: subErr } = await sb.from("push_subscriptions").select("id, user_id, subscription");
  if (subErr) throw new Error("push_subscriptions: " + subErr.message);
  const subsByUser = new Map<string, any[]>();
  for (const s of subs ?? []) {
    if (!subsByUser.has(s.user_id)) subsByUser.set(s.user_id, []);
    subsByUser.get(s.user_id)!.push(s);
  }
  const users = [...subsByUser.keys()];
  if (!users.length) return { users: 0, planned: 0, sent: 0, dry };

  const today = jstYmd(now, 0), yday = jstYmd(now, -1);
  const morning = isMorning(now);
  const soon = new Date(now + 61 * MIN).toISOString(), nowIso = new Date(now).toISOString();

  // ---- 設定（表がまだ無い環境では、全員を既定として扱う）----
  const prefs: Record<string, any> = {};
  await eachChunk(users, async (ids) => {
    const { data, error } = await sb.from("notify_prefs").select("user_id, event_on, event_before_min, todo_on").in("user_id", ids);
    if (!error) for (const p of data ?? []) prefs[p.user_id] = p;
  });

  // ---- 時刻のある予定（これから61分のうちに始まるもの）----
  const events: any[] = [];
  await eachChunk(users, async (ids) => {
    const { data } = await sb.from("agenda_events").select("id, owner_id, title, starts_at, place")
      .in("owner_id", ids).eq("all_day", false).gt("starts_at", nowIso).lte("starts_at", soon);
    events.push(...(data ?? []));
  });

  // ---- 面談（経営者ご本人と、担当パートナーへ）----
  const meetings: any[] = [];
  const people: Record<string, any> = {};
  {
    const { data } = await sb.from("meetings_scheduled").select("id, customer_id, meet_at, place")
      .eq("status", "scheduled").gt("meet_at", nowIso).lte("meet_at", soon);
    meetings.push(...(data ?? []));
    const cids = [...new Set(meetings.map((m) => m.customer_id))];
    await eachChunk(cids, async (ids) => {
      const { data: ps } = await sb.from("profiles").select("id, company_name, consultant_id").in("id", ids);
      for (const p of ps ?? []) people[p.id] = p;
    });
  }

  // ---- 期限の時刻がある TODO（昨日・今日のぶん。日付の変わり目をまたいでも拾う）----
  const todos: any[] = [];
  await eachChunk(users, async (ids) => {
    const { data } = await sb.from("todos").select("id, owner_id, title, due_date, due_time")
      .in("owner_id", ids).is("done_at", null).not("due_time", "is", null).in("due_date", [yday, today]);
    todos.push(...(data ?? []));
  });

  // ---- 朝8時のまとめ（その時間帯だけ取りに行く）----
  const allDay: any[] = [], dayTodos: any[] = [], custTodos: any[] = [];
  if (morning) {
    const day = jstDayRange(now);
    await eachChunk(users, async (ids) => {
      const { data: ev } = await sb.from("agenda_events").select("id, owner_id, title, starts_at")
        .in("owner_id", ids).eq("all_day", true).gte("starts_at", day.from).lt("starts_at", day.to);
      allDay.push(...(ev ?? []));
      const { data: td } = await sb.from("todos").select("id, owner_id, title")
        .in("owner_id", ids).is("done_at", null).is("due_time", null).eq("due_date", today);
      dayTodos.push(...(td ?? []));
      const { data: ct, error: ctErr } = await sb.from("customer_todos").select("id, customer_id, title")
        .in("customer_id", ids).is("done_at", null).eq("due_on", today);
      if (!ctErr) custTodos.push(...(ct ?? []));
    });
  }

  const plan = buildPlan({
    now, users: new Set(users), prefs, events, meetings, people, todos,
    allDay, dayTodos, custTodos, appUrl: APP_URL,
  });
  if (dry) return { users: users.length, planned: plan.length, sent: 0, dry, morning, plan };

  // ---- 送る（記録に書き込めたものだけ）----
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
  let sent = 0;
  for (const n of plan) {
    const { data: got, error } = await sb.from("push_reminder_log")
      .upsert({ user_id: n.user_id, kind: n.kind, ref_id: n.ref_id, fire_at: new Date(n.fire_at).toISOString() },
        { onConflict: "user_id,kind,ref_id,fire_at", ignoreDuplicates: true })
      .select("id");
    if (error) { console.error("log failed:", error.message); continue; }
    if (!got?.length) continue;   // もう送ってある
    for (const s of subsByUser.get(n.user_id) ?? []) {
      try {
        await webpush.sendNotification(s.subscription, JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: n.tag }));
        sent++;
      } catch (e: any) {
        //  端末側で解除された購読は掃除する
        if (e?.statusCode === 404 || e?.statusCode === 410) await sb.from("push_subscriptions").delete().eq("id", s.id);
        else console.error("push send failed:", e?.statusCode ?? e);
      }
    }
  }
  //  送った記録は2週間で消す（二度送らないための控えなので、それで足りる）
  await sb.from("push_reminder_log").delete().lt("sent_at", new Date(now - 14 * DAY).toISOString());
  return { users: users.length, planned: plan.length, sent, dry, morning };
}

async function eachChunk(ids: string[], fn: (ids: string[]) => Promise<void>) {
  for (let i = 0; i < ids.length; i += 200) await fn(ids.slice(i, i + 200));
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

// ===== PLAN START =====
//  ここから下は、何をいつ送るかを決めるだけの部分（データベースにも端末にも触らない）。
//  試験（scratchpad/push_reminders_test.js）がこの範囲だけを取り出して動かすので、
//  型の注釈は書かず、素の JavaScript として読める形にしておく。
const MIN = 60000, DAY = 86400000, JST = 9 * 3600000;
//  呼び出しが遅れても、時刻を過ぎてこの分数までは送る（5分ごとの呼び出しが3回ぶん遅れても届く）
const GRACE_MIN = 20;
//  時刻のないものをまとめて送る時刻（日本時間）
const MORNING_HOUR = 8;
//  日本時間で今日から n 日後の日付（YYYY-MM-DD）
function jstYmd(ms, n) { return new Date(ms + JST + n * DAY).toISOString().slice(0, 10); }
//  日本時間の YYYY-MM-DD hh:mm を、その瞬間（ミリ秒）に
function jstAt(ymd, hh, mm) { const p = ymd.split("-").map(Number); return Date.UTC(p[0], p[1] - 1, p[2], hh, mm) - JST; }
function jstDayRange(ms) {
  const d = jstYmd(ms, 0), from = jstAt(d, 0, 0);
  return { from: new Date(from).toISOString(), to: new Date(from + DAY).toISOString() };
}
function isMorning(ms) { const m = jstAt(jstYmd(ms, 0), MORNING_HOUR, 0); return ms >= m && ms < m + GRACE_MIN * MIN; }
function hhmm(ms) { const j = new Date(ms + JST); return String(j.getUTCHours()).padStart(2, "0") + ":" + String(j.getUTCMinutes()).padStart(2, "0"); }
function beforeLabel(min) { return min === 60 ? "1時間後" : min + "分後"; }
function due(fire, now) { return fire <= now && fire > now - GRACE_MIN * MIN; }
function prefOf(prefs, uid) {
  const p = prefs[uid] || {};
  const b = [10, 30, 60].indexOf(Number(p.event_before_min)) >= 0 ? Number(p.event_before_min) : 30;
  return { event: p.event_on !== false, before: b, todo: p.todo_on !== false };
}
function linkTo(appUrl, tab) { return String(appUrl || "./").replace(/\/?$/, "/") + "?knv=" + tab; }
function cut(t, n) { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; }

function buildPlan(x) {
  const out = [], now = x.now;
  // 予定
  for (const e of x.events || []) {
    if (!x.users.has(e.owner_id)) continue;
    const p = prefOf(x.prefs, e.owner_id); if (!p.event) continue;
    const starts = Date.parse(e.starts_at); if (!(starts > now)) continue;
    const fire = starts - p.before * MIN; if (!due(fire, now)) continue;
    out.push({ user_id: e.owner_id, kind: "event", ref_id: String(e.id), fire_at: fire,
      title: "📅 " + beforeLabel(p.before) + "：" + cut(e.title || "予定", 40),
      body: hhmm(starts) + "から" + (e.place ? "　" + cut(e.place, 60) : ""),
      url: linkTo(x.appUrl, "cal"), tag: "event-" + e.id });
  }
  // 面談（経営者ご本人と担当パートナー）
  for (const m of x.meetings || []) {
    const starts = Date.parse(m.meet_at); if (!(starts > now)) continue;
    const c = (x.people || {})[m.customer_id] || {};
    const who = [
      { uid: m.customer_id, what: "担当パートナーとの面談" },
      { uid: c.consultant_id, what: cut(c.company_name || "顧客", 30) + "との面談" },
    ];
    for (const w of who) {
      if (!w.uid || !x.users.has(w.uid)) continue;
      const p = prefOf(x.prefs, w.uid); if (!p.event) continue;
      const fire = starts - p.before * MIN; if (!due(fire, now)) continue;
      out.push({ user_id: w.uid, kind: "meeting", ref_id: String(m.id), fire_at: fire,
        title: "📅 " + beforeLabel(p.before) + "：" + w.what,
        body: hhmm(starts) + "から" + (m.place ? "　" + cut(m.place, 60) : ""),
        url: linkTo(x.appUrl, "cal"), tag: "meeting-" + m.id });
    }
  }
  // 期限の時刻がある TODO
  for (const t of x.todos || []) {
    if (!x.users.has(t.owner_id) || !t.due_time || !t.due_date) continue;
    const p = prefOf(x.prefs, t.owner_id); if (!p.todo) continue;
    const hm = String(t.due_time).split(":").map(Number);
    const fire = jstAt(t.due_date, hm[0] || 0, hm[1] || 0); if (!due(fire, now)) continue;
    out.push({ user_id: t.owner_id, kind: "todo", ref_id: String(t.id), fire_at: fire,
      title: "✅ TODO：" + cut(t.title || "TODO", 40),
      body: "期限 " + hhmm(fire) + "（いま）。済んだら TODO タブでチェックを",
      url: linkTo(x.appUrl, "todo"), tag: "todo-" + t.id });
  }
  // 朝のまとめ（終日の予定・時刻のない今日の TODO・経営者のやること）
  if (isMorning(now)) {
    const fire = jstAt(jstYmd(now, 0), MORNING_HOUR, 0), day = jstYmd(now, 0);
    const lines = {};
    const add = (uid, s) => { (lines[uid] = lines[uid] || []).push(s); };
    for (const e of x.allDay || []) if (x.users.has(e.owner_id) && prefOf(x.prefs, e.owner_id).event) add(e.owner_id, "・終日 " + cut(e.title || "予定", 30));
    for (const t of x.dayTodos || []) if (x.users.has(t.owner_id) && prefOf(x.prefs, t.owner_id).todo) add(t.owner_id, "・TODO " + cut(t.title || "TODO", 30));
    for (const t of x.custTodos || []) if (x.users.has(t.customer_id) && prefOf(x.prefs, t.customer_id).todo) add(t.customer_id, "・やること " + cut(t.title || "やること", 30));
    for (const uid of Object.keys(lines)) {
      const ls = lines[uid], shown = ls.slice(0, 5);
      out.push({ user_id: uid, kind: "morning", ref_id: day, fire_at: fire,
        title: "☀️ 今日の予定とTODO（" + ls.length + "件）",
        body: shown.join("\n") + (ls.length > shown.length ? "\nほか " + (ls.length - shown.length) + "件" : ""),
        url: linkTo(x.appUrl, ls.some((s) => s.indexOf("・終日") === 0) ? "cal" : "todo"), tag: "morning-" + day });
    }
  }
  return out;
}
// ===== PLAN END =====
