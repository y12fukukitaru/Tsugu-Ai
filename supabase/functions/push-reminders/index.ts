// @ts-nocheck  下の「何を送るか」の部分を素の JavaScript のまま試験で動かすため、型の検査はしない
// =============================================================
// push-reminders: 予定・TODO・メッセージ・対応が必要なことを、スマホ（ホーム画面に追加したアプリ）へ知らせる
// ---------------------------------------------------------------
//  これまでプッシュ通知で届いていたのは、毎朝のブリーフ（agent-heartbeat）
//  だけだった。予定の直前や TODO の期限の時刻には何も来ないので、アプリを
//  開いていなければ思い出せない。ここで5分ごとに見て、時刻が来たものを送る。
//
//  何を、いつ送るか（設定は notify_prefs。行が無い人は既定）
//    ・予定（継ナビくんの予定タブ＝agenda_events）……開始の 10／30／60 分前（既定30分）
//    ・面談（meetings_scheduled）……同じく開始前。経営者ご本人と担当パートナーの両方へ
//    ・TODO（todos。期限の時刻があるもの）……期限の時刻に
//    ・終日の予定・時刻のない今日の TODO・経営者の「やること」（customer_todos）・
//      期日が今日の対応事項（action_items）……朝8時（日本時間）にまとめて1通
//
//  新しく届いたものは、届いてすぐ（1分ごとの呼び出しで）
//    メッセージ（msg_on）
//    ・担当とのメッセージ（chat_messages）……経営者 ⇄ 担当パートナー
//    ・運営からの回答（support_inquiries.admin_reply）……問い合わせたパートナーへ
//    ・運営からのお知らせ（announcements）……宛先（全員／パートナー／顧客）へ
//    対応が必要なこと（act_on）
//    ・対応事項（action_items）……担当パートナーが登録したら、経営者へ
//    ・継ナビくんの相談の共有（ai_shares）……経営者が「伝える」を押したら、担当パートナーへ
//    ・月次レポート（monthly_reports）……公開されたら、経営者へ
//    ・問い合わせ・解約のご依頼・契約の終了のお申し出・プラン切替の依頼……運営（admin）へ
//
//  二度送らない：送る前に push_reminder_log へ (誰・種類・id・時刻) を書き込み、
//  書き込めたものだけ送る。呼び出しが重なっても、遅れても、同じ通知は1回だけ。
//  呼び出しが遅れたときのために、時刻を過ぎて GRACE_MIN 分までは送る。
//  それより古いものは送らない（会議が終わってから「30分前です」は要らない）。
//
//  デプロイ: Supabase Dashboard → Edge Functions → push-reminders（Verify JWT はオフ）
//   Secrets は既存のものを使う：CRON_SECRET／VAPID_PUBLIC_KEY／VAPID_PRIVATE_KEY／
//   VAPID_SUBJECT／APP_URL（agent-heartbeat と同じ）
//  呼び出し: pg_cron が1分ごと（migrations/20261008010000_push_reminders.sql で登録、
//            20261008020000_push_messages.sql で5分→1分に）
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
    let r = await sb.from("notify_prefs").select("user_id, event_on, event_before_min, todo_on, msg_on, act_on, preview_on").in("user_id", ids);
    //  中身を出すかの列（preview_on）がまだ無い環境では、中身を出さない（安全な側）
    if (r.error) r = await sb.from("notify_prefs").select("user_id, event_on, event_before_min, todo_on, msg_on, act_on").in("user_id", ids);
    //  メッセージの列をまだ足していない環境でも、予定とTODOの設定は読む
    if (r.error) r = await sb.from("notify_prefs").select("user_id, event_on, event_before_min, todo_on").in("user_id", ids);
    if (!r.error) for (const p of r.data ?? []) prefs[p.user_id] = p;
  });
  //  役割（運営あての通知と、お知らせの宛先に使う）
  const roles: Record<string, string> = {};
  await eachChunk(users, async (ids) => {
    const { data } = await sb.from("profiles").select("id, role").in("id", ids);
    for (const p of data ?? []) roles[p.id] = p.role;
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

  // ---- 新しく届いたもの（この GRACE_MIN 分のうちに書かれたもの）----
  //  どれも、表や列がまだ無い環境では黙って空にする（ほかの通知は止めない）
  const since = new Date(now - GRACE_MIN * MIN).toISOString();
  const pick = async (q: any) => { try { const { data, error } = await q; return error ? [] : (data ?? []); } catch { return []; } };
  const msgs = await pick(sb.from("chat_messages").select("customer_id, sender_id, sender_role, body, attachment_name, created_at")
    .gt("created_at", since).order("created_at", { ascending: true }).limit(300));
  const replies = await pick(sb.from("support_inquiries").select("id, partner_id, subject, admin_reply, replied_at")
    .gt("replied_at", since).limit(100));
  const anns = await pick(sb.from("announcements").select("id, audience, title, body, created_at").gt("created_at", since).limit(20));
  const acts = await pick(sb.from("action_items").select("id, customer_id, title, due_date, created_by, created_at")
    .gt("created_at", since).limit(200));
  const shares = await pick(sb.from("ai_shares").select("id, customer_id, question, created_at").gt("created_at", since).limit(200));
  const reports = await pick(sb.from("monthly_reports").select("id, customer_id, report_month, published_at")
    .eq("status", "published").gt("published_at", since).limit(200));
  const inquiries = await pick(sb.from("support_inquiries").select("id, partner_id, subject, created_at").gt("created_at", since).limit(100));
  const cancels = await pick(sb.from("cancel_requests").select("id, customer_id, created_at").gt("created_at", since).limit(50));
  const exits = await pick(sb.from("partner_exit_requests").select("id, partner_id, created_at").gt("created_at", since).limit(50));
  const planReqs = await pick(sb.from("plan_requests").select("id, customer_id, to_plan, created_at").gt("created_at", since).limit(50));
  const dayActs = morning ? await pick(sb.from("action_items").select("id, customer_id, title")
    .eq("due_date", today).neq("status", "done").limit(500)) : [];
  //  会社名と担当（メッセージ・共有・面談の宛先を決めるのに使う）
  const cids = [...new Set([...msgs, ...shares, ...cancels, ...planReqs].map((m: any) => m.customer_id).filter((id: string) => id && !people[id]))];
  await eachChunk(cids, async (ids) => {
    const { data: ps } = await sb.from("profiles").select("id, company_name, consultant_id").in("id", ids);
    for (const p of ps ?? []) people[p.id] = p;
  });

  const plan = maskPlan(buildPlan({
    now, users: new Set(users), prefs, events, meetings, people, todos,
    allDay, dayTodos, custTodos, appUrl: APP_URL,
    roles, msgs, replies, anns, acts, shares, reports, inquiries, cancels, exits, planReqs, dayActs,
  }), prefs);
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
  return { event: p.event_on !== false, before: b, todo: p.todo_on !== false, msg: p.msg_on !== false, act: p.act_on !== false,
    preview: p.preview_on === true };
}
//  ---- ロック画面に中身を出さない（2026-10-10 情報の守り）----
//  通知はロック画面に出るので、机に置いたスマホを横から見られることがある。
//  既定では「何が届いたか」の種類だけを出し、会社名・メッセージの文・予定の場所・
//  TODO の題は出さない。ご本人が連携タブで「通知に中身を出す」を選んだときだけ、元の文で送る。
const SAFE_TEXT = {
  event: "📅 まもなく予定があります", meeting: "📅 まもなく面談があります", todo: "✅ TODO の期限です",
  morning: "☀️ 今日の予定とTODOがあります", msg: "✉️ 新しいメッセージが届きました", reply: "✉️ 運営から回答が届きました",
  ann: "📢 運営からのお知らせがあります", act: "📌 対応のお願いが届きました", share: "📌 相談の共有が届きました",
  report: "📄 月次レポートが届きました", inq: "🛟 問い合わせが届きました", cancel: "⚠ 解約のご依頼が届きました",
  pexit: "⚠ 契約の終了のお申し出が届きました", plan: "🔁 プラン切替の依頼が届きました",
};
const SAFE_BODY = "内容はアプリを開いてご確認ください";
function maskPlan(plan, prefs) {
  return plan.map((n) => prefOf(prefs, n.user_id).preview ? n
    : Object.assign({}, n, { title: SAFE_TEXT[n.kind] || "🔔 新しいお知らせがあります", body: SAFE_BODY }));
}
function linkTo(appUrl, tab) { return String(appUrl || "./").replace(/\/?$/, "/") + "?knv=" + tab; }
function cut(t, n) { t = String(t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; }
//  新しく届いたもの：書かれてから GRACE_MIN 分のうち（時計のずれで少し先の時刻も受ける）
function fresh(iso, now) { const t = Date.parse(iso || ""); return !isNaN(t) && t > now - GRACE_MIN * MIN && t <= now + MIN; }
function ymJp(ym) { const m = /^(\d{4})-(\d{2})/.exec(String(ym || "")); return m ? m[1] + "年" + Number(m[2]) + "月" : String(ym || ""); }
function mdJp(ymd) { const m = /^\d{4}-(\d{2})-(\d{2})/.exec(String(ymd || "")); return m ? Number(m[1]) + "/" + Number(m[2]) : ""; }

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
    for (const a of x.dayActs || []) if (x.users.has(a.customer_id) && prefOf(x.prefs, a.customer_id).act) add(a.customer_id, "・対応 " + cut(a.title || "対応事項", 30));
    for (const uid of Object.keys(lines)) {
      const ls = lines[uid], shown = ls.slice(0, 5);
      out.push({ user_id: uid, kind: "morning", ref_id: day, fire_at: fire,
        title: "☀️ 今日の予定とTODO（" + ls.length + "件）",
        body: shown.join("\n") + (ls.length > shown.length ? "\nほか " + (ls.length - shown.length) + "件" : ""),
        url: linkTo(x.appUrl, ls.some((s) => s.indexOf("・終日") === 0) ? "cal" : "todo"), tag: "morning-" + day });
    }
  }
  //  ---- 新しく届いたもの ----
  const home = linkTo(x.appUrl, "").replace(/\?knv=$/, "");
  const roles = x.roles || {}, people = x.people || {};
  const push = (uid, kind, ref, at, cat, title, body, url, tag) => {
    if (!uid || !x.users.has(uid)) return;
    const p = prefOf(x.prefs, uid); if (cat === "msg" ? !p.msg : !p.act) return;
    out.push({ user_id: uid, kind, ref_id: String(ref), fire_at: Date.parse(at), title, body, url, tag });
  };
  const company = (cid) => cut((people[cid] || {}).company_name || "顧客", 24);
  // メッセージ（経営者 ⇄ 担当パートナー）。同じ会社とのやり取りは通知を1枚に重ねる
  for (const m of x.msgs || []) {
    if (!fresh(m.created_at, now)) continue;
    const text = m.body ? cut(m.body, 90) : (m.attachment_name ? "📎 " + cut(m.attachment_name, 60) : "（添付ファイル）");
    const ref = m.customer_id + "|" + m.sender_role + "|" + m.created_at;
    if (m.sender_role === "customer") {
      const pid = (people[m.customer_id] || {}).consultant_id;
      if (pid !== m.sender_id) push(pid, "msg", ref, m.created_at, "msg", "✉️ " + company(m.customer_id) + "からメッセージ", text, linkTo(x.appUrl, "msg"), "msg-" + m.customer_id);
    } else if (m.customer_id !== m.sender_id) {
      push(m.customer_id, "msg", ref, m.created_at, "msg", "✉️ 担当パートナーからメッセージ", text, linkTo(x.appUrl, "msg"), "msg-" + m.customer_id);
    }
  }
  // 運営からの回答（問い合わせたパートナーへ）
  for (const r of x.replies || []) {
    if (!fresh(r.replied_at, now) || !r.admin_reply) continue;
    push(r.partner_id, "reply", r.id + "|" + r.replied_at, r.replied_at, "msg", "✉️ 運営から回答：" + cut(r.subject || "お問い合わせ", 30),
      cut(r.admin_reply, 90), linkTo(x.appUrl, "support"), "reply-" + r.id);
  }
  // 運営からのお知らせ（宛先の役割の方へ。運営には送らない）
  for (const a of x.anns || []) {
    if (!fresh(a.created_at, now)) continue;
    for (const uid of x.users) {
      const r = roles[uid];
      if (!r || r === "admin") continue;
      if (a.audience !== "all" && a.audience !== r) continue;
      push(uid, "ann", a.id, a.created_at, "msg", "📢 運営からのお知らせ：" + cut(a.title || "お知らせ", 30), cut(a.body, 90), home, "ann-" + a.id);
    }
  }
  // 対応事項（担当パートナーが登録したら、経営者へ）
  for (const a of x.acts || []) {
    if (!fresh(a.created_at, now) || a.created_by === a.customer_id) continue;
    push(a.customer_id, "act", a.id, a.created_at, "act", "📌 対応のお願い：" + cut(a.title || "対応事項", 36),
      "担当パートナーから" + (a.due_date ? "（期日 " + mdJp(a.due_date) + "）" : ""), home, "act-" + a.id);
  }
  // 継ナビくんの相談の共有（経営者 → 担当パートナー）
  for (const s of x.shares || []) {
    if (!fresh(s.created_at, now)) continue;
    push((people[s.customer_id] || {}).consultant_id, "share", s.id, s.created_at, "act",
      "📌 " + company(s.customer_id) + "から相談の共有", cut(s.question, 90), home, "share-" + s.id);
  }
  // 月次レポート（公開されたら、経営者へ）
  for (const r of x.reports || []) {
    if (!fresh(r.published_at, now)) continue;
    push(r.customer_id, "report", r.id + "|" + r.published_at, r.published_at, "act", "📄 " + ymJp(r.report_month) + "の月次レポートが届きました",
      "担当パートナーからです。数字の動きと、次の一手が書いてあります。", home, "report-" + r.id);
  }
  // 運営あて（問い合わせ・解約のご依頼・契約の終了・プラン切替）
  const admins = [...x.users].filter((u) => roles[u] === "admin");
  const toAdmins = (kind, list, title, body) => {
    for (const it of list || []) {
      if (!fresh(it.created_at, now)) continue;
      for (const uid of admins) push(uid, kind, it.id, it.created_at, "act", title(it), body(it), home, kind + "-" + it.id);
    }
  };
  toAdmins("inq", x.inquiries, (i) => "🛟 パートナーから問い合わせ：" + cut(i.subject || "（件名なし）", 30), () => "サポート管理の受信箱で回答できます。");
  toAdmins("cancel", x.cancels, () => "⚠ 解約のご依頼が届きました", (c) => company(c.customer_id) + "から。お話をうかがってから手続きへ。");
  toAdmins("pexit", x.exits, () => "⚠ パートナーから契約の終了のお申し出", () => "担当顧問先の引き継ぎと最終月の報酬を進めます。");
  toAdmins("plan", x.planReqs, () => "🔁 プラン切替の依頼が届きました", (r) => company(r.customer_id) + "：" + (r.to_plan === "buyer" ? "買い手プラン" : "売り手プラン") + "へ");
  return out;
}
// ===== PLAN END =====
