// =============================================================
// google-sync: 予定を Google と行き来させる（双方向）
// ---------------------------------------------------------------
//  やることは三つです。
//
//    ① 短い鍵を取り直す（1時間で切れるため）
//    ② こちらの予定を Google へ送る（まだ送っていないもの・直したもの）
//    ③ Google の変更を取ってくる（前回からの差分だけ）
//
//  ■ 同じ予定が二つにならないように
//
//    こちらから送った予定には google_id が入ります。③ で取ってくる
//    ときは google_id で突き合わせるので、送ったものが戻ってきて
//    増えることはありません。Google 側にも印を付けています
//    （extendedProperties.private.tsuguai = こちらの番号）。
//
//  ■ 差分の取り方
//
//    Google は syncToken という札をくれます。次からはその札を渡すと
//    「前回からの変更だけ」が返ります。札が古くなると 410 が返るので、
//    そのときは札を捨てて全部取り直します。
//
//  ■ 面談について
//
//    パートナーの面談（meetings_scheduled）も Google に出します。
//    ただし**Google 側で面談を消しても、TsuguAi の面談は消しません**。
//    面談は顧客との約束なので、カレンダーの操作で消えてよいものでは
//    ありません。消したいときは TsuguAi の画面から行います。
//
//  デプロイ:
//    supabase functions deploy google-sync --no-verify-jwt
//    （Verify JWT は OFF。中でログインを確かめます）
//
//  Secrets: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET
// =============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";

const DAY = 86400000;
const CAL = "primary";
const API = `https://www.googleapis.com/calendar/v3/calendars/${CAL}/events`;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

//  Google の日時は「時刻つき」と「終日」で形が違う
function gWhen(iso: string, allDay: boolean) {
  if (allDay) return { date: String(iso).slice(0, 10) };
  return { dateTime: new Date(iso).toISOString(), timeZone: "Asia/Tokyo" };
}
function fromG(v: any): { iso: string | null; allDay: boolean } {
  if (!v) return { iso: null, allDay: false };
  if (v.date) return { iso: `${v.date}T00:00:00+09:00`, allDay: true };
  if (v.dateTime) return { iso: v.dateTime, allDay: false };
  return { iso: null, allDay: false };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return json({ ok: false, error: "Google連携の設定が済んでいません（Secrets 未設定）" }, 500);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  //  誰の同期かを確かめる（Verify JWT は OFF なので自分で見る）
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "ログインが必要です" }, 401);
  const { data: u, error: ue } = await sb.auth.getUser(token);
  if (ue || !u?.user) return json({ ok: false, error: "ログインを確かめられませんでした" }, 401);
  const uid = u.user.id;

  const { data: link } = await sb.from("google_cal_links")
    .select("*").eq("user_id", uid).maybeSingle();
  if (!link || !link.refresh_enc) return json({ ok: false, error: "まだ連携していません" }, 400);

  // ---------------------------------------------------------------
  // ① 短い鍵を用意する
  // ---------------------------------------------------------------
  let access = link.access_token as string | null;
  const stillGood = link.access_expires && new Date(link.access_expires).getTime() > Date.now();
  if (!access || !stillGood) {
    const { data: refresh } = await sb.rpc("google_refresh_get", { p_user: uid });
    if (!refresh) return json({ ok: false, error: "更新用の鍵がありません。つなぎ直してください" }, 400);
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        refresh_token: String(refresh), grant_type: "refresh_token",
      }),
    });
    const t = await r.json();
    if (!r.ok || !t.access_token) {
      //  取り消された・期限切れ。つなぎ直していただくほかない
      const msg = t?.error_description || t?.error || `HTTP ${r.status}`;
      await sb.from("google_cal_links").update({ last_error: `つなぎ直しが要ります：${msg}` }).eq("user_id", uid);
      return json({ ok: false, error: `Google とのつながりが切れています（${msg}）。つなぎ直してください`, relink: true }, 400);
    }
    access = t.access_token;
    await sb.from("google_cal_links").update({
      access_token: access,
      access_expires: new Date(Date.now() + (Number(t.expires_in || 3600) - 60) * 1000).toISOString(),
    }).eq("user_id", uid);
  }
  const H = { authorization: `Bearer ${access}`, "content-type": "application/json" };

  let pushed = 0, pulled = 0, removed = 0;
  const notes: string[] = [];

  // ---------------------------------------------------------------
  // ② こちらの予定を Google へ
  // ---------------------------------------------------------------
  //  送るのは、これから先と、少し前まで。古いものまで送っても
  //  相手のカレンダーが散らかるだけです
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const until = new Date(Date.now() + 180 * DAY).toISOString();

  const { data: mine } = await sb.from("agenda_events")
    .select("id, title, starts_at, ends_at, all_day, place, note, google_id, source, synced_at, updated_at")
    .eq("owner_id", uid).gte("starts_at", since).lte("starts_at", until).limit(400);

  for (const e of mine ?? []) {
    //  Google から来たものを送り返さない
    if (e.source === "google") continue;
    //  前に送ったあと、こちらで直していなければ何もしない
    if (e.google_id && e.synced_at && new Date(e.synced_at) >= new Date(e.updated_at)) continue;

    const end = e.ends_at
      ? e.ends_at
      : new Date(new Date(e.starts_at).getTime() + (e.all_day ? DAY : 3600000)).toISOString();
    const body = {
      summary: e.title,
      location: e.place || undefined,
      description: e.note || undefined,
      start: gWhen(e.starts_at, e.all_day),
      end: gWhen(end, e.all_day),
      //  こちらのものだという印。この表が失われても見分けがつく
      extendedProperties: { private: { tsuguai: e.id } },
    };
    try {
      const r = e.google_id
        ? await fetch(`${API}/${encodeURIComponent(e.google_id)}`, { method: "PATCH", headers: H, body: JSON.stringify(body) })
        : await fetch(API, { method: "POST", headers: H, body: JSON.stringify(body) });
      const g = await r.json();
      if (r.ok && g.id) {
        await sb.from("agenda_events").update({
          google_id: g.id, google_etag: g.etag ?? null, synced_at: new Date().toISOString(),
        }).eq("id", e.id);
        pushed++;
      } else if (r.status === 404 && e.google_id) {
        //  向こうで消されていた。番号を外して、次の回に作り直す
        await sb.from("agenda_events").update({ google_id: null, synced_at: null }).eq("id", e.id);
      } else {
        notes.push(`送れませんでした：${e.title}（${g?.error?.message ?? r.status}）`);
      }
    } catch (err) {
      notes.push(`送れませんでした：${e.title}（${String((err as Error).message)}）`);
    }
  }

  //  面談も Google に出す（こちらからの一方通行）
  const { data: prof } = await sb.from("profiles").select("role").eq("id", uid).maybeSingle();
  if (prof?.role === "consultant") {
    const { data: ids } = await sb.from("profiles").select("id, company_name").eq("consultant_id", uid);
    const nameOf = new Map((ids ?? []).map((p: any) => [p.id, p.company_name || "顧客"]));
    if (nameOf.size) {
      const { data: ms } = await sb.from("meetings_scheduled")
        .select("id, customer_id, meet_at, place, status")
        .eq("status", "scheduled").in("customer_id", [...nameOf.keys()])
        .gte("meet_at", since).lte("meet_at", until).limit(300);
      for (const m of ms ?? []) {
        //  面談は agenda_events には持たないので、Google 側の番号を
        //  こちらで決められる形（id を指定して作る）にはできません。
        //  同じものを二度作らないよう、印で探してから決めます
        const q = new URL(API);
        q.searchParams.set("privateExtendedProperty", `tsuguai_meeting=${m.id}`);
        q.searchParams.set("maxResults", "1");
        let gid: string | null = null;
        try {
          const f = await fetch(q, { headers: H });
          const fj = await f.json();
          gid = fj?.items?.[0]?.id ?? null;
        } catch { /* 探せなくても、下で作る */ }
        const body = {
          summary: `面談: ${nameOf.get(m.customer_id)}（TsuguAi）`,
          location: m.place || undefined,
          description: "TsuguAiに登録された面談予定です。前日に継ナビくんの面談準備ブリーフが届きます。",
          start: gWhen(m.meet_at, false),
          end: gWhen(new Date(new Date(m.meet_at).getTime() + 3600000).toISOString(), false),
          extendedProperties: { private: { tsuguai_meeting: m.id } },
        };
        try {
          const r = gid
            ? await fetch(`${API}/${encodeURIComponent(gid)}`, { method: "PATCH", headers: H, body: JSON.stringify(body) })
            : await fetch(API, { method: "POST", headers: H, body: JSON.stringify(body) });
          if (r.ok) pushed++;
        } catch { /* 次の回に持ち越す */ }
      }
    }
  }

  // ---------------------------------------------------------------
  // ③ Google の変更を取ってくる
  // ---------------------------------------------------------------
  if (link.pull_private !== false) {
    let pageToken: string | null = null;
    let syncToken: string | null = link.sync_token ?? null;
    let nextSync: string | null = null;
    let guard = 0;

    do {
      const q = new URL(API);
      q.searchParams.set("singleEvents", "true");
      q.searchParams.set("maxResults", "250");
      if (syncToken) {
        q.searchParams.set("syncToken", syncToken);
      } else {
        //  はじめて、または札が古くなったとき。取りすぎないよう幅を切る
        q.searchParams.set("timeMin", since);
        q.searchParams.set("timeMax", until);
      }
      if (pageToken) q.searchParams.set("pageToken", pageToken);

      const r = await fetch(q, { headers: H });
      if (r.status === 410) {
        //  札が古い。捨てて最初から取り直す
        syncToken = null; pageToken = null;
        await sb.from("google_cal_links").update({ sync_token: null }).eq("user_id", uid);
        if (++guard > 2) break;
        continue;
      }
      const g = await r.json();
      if (!r.ok) {
        notes.push(`取ってこられませんでした（${g?.error?.message ?? r.status}）`);
        break;
      }

      for (const it of g.items ?? []) {
        //  こちらが送ったものは取り込まない（同じ予定が二つになる）
        const mark = it.extendedProperties?.private ?? {};
        if (mark.tsuguai || mark.tsuguai_meeting) continue;

        if (it.status === "cancelled") {
          //  向こうで消えたものは、取り込んだぶんだけ消す。
          //  こちらで作った予定は消しません（Google の操作で消えては困る）
          const { count } = await sb.from("agenda_events")
            .delete({ count: "exact" })
            .eq("owner_id", uid).eq("google_id", it.id).eq("source", "google");
          removed += count ?? 0;
          continue;
        }

        const st = fromG(it.start), en = fromG(it.end);
        if (!st.iso) continue;
        const row = {
          owner_id: uid,
          title: String(it.summary || "（無題）").slice(0, 120),
          starts_at: st.iso,
          ends_at: en.iso,
          all_day: st.allDay,
          place: it.location ? String(it.location).slice(0, 120) : null,
          note: it.description ? String(it.description).slice(0, 300) : null,
          google_id: it.id,
          google_etag: it.etag ?? null,
          source: "google",
          synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        const { error } = await sb.from("agenda_events")
          .upsert(row, { onConflict: "owner_id,google_id" });
        if (!error) pulled++;
      }

      pageToken = g.nextPageToken ?? null;
      if (g.nextSyncToken) nextSync = g.nextSyncToken;
    } while (pageToken && ++guard < 20);

    if (nextSync) {
      await sb.from("google_cal_links").update({ sync_token: nextSync }).eq("user_id", uid);
    }
  }

  await sb.from("google_cal_links").update({
    last_sync_at: new Date().toISOString(),
    last_error: notes.length ? notes.slice(0, 3).join(" / ") : null,
  }).eq("user_id", uid);

  return json({ ok: true, pushed, pulled, removed, notes: notes.slice(0, 3) });
});
