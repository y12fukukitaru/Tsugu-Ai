// =============================================================
// google-sync: 予定を Google と行き来させる（双方向・複数アカウント）
// ---------------------------------------------------------------
//  つないである Google アカウント**全部**について、順にやります。
//
//    ① 短い鍵を取り直す（1時間で切れるため）
//    ② こちらの予定を Google へ送る（まだ送っていないもの・直したもの）
//    ③ Google の変更を取ってくる（カレンダーごと・前回からの差分だけ）
//
//  ■ 複数アカウントのときの決まり
//
//    ・Google → TsuguAi は、つないだ**全部**から取り込む
//      （アカウントごとに「取り込む／取り込まない」を選べる）
//    ・アカウントの中の**どのカレンダーを取り込むか**も選べる
//      （家族・誕生日・共有されたもの・祝日など。メインだけ最初からオン）。
//      一覧は同期のたびに Google と合わせ、札（syncToken）は
//      カレンダーごとに持つ
//    ・TsuguAi → Google は、**送り先（push_target）一つ**にだけ送る。
//      両方に送ると、同じ予定が二つのカレンダーに出て散らかります
//    ・一度どこかへ送った予定は、そのアカウントで直し続ける（link_id）。
//      送り先を変えても動かしません。新しい予定から新しい送り先へ
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
//    取り込みが一件でも失敗した回は、札を進めません。進めると、
//    失敗した予定が次から「もう渡した」扱いになり、永久に入りません。
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
//  送り先はメインカレンダー。購読しているだけのカレンダーには書けません
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

//  旧来の「見るだけ」の購読（calendar-feed の ICS）を Google 側に残して
//  いると、一覧にカレンダーとして出てきます。それを取り込むと TsuguAi の
//  予定が TsuguAi に戻ってきて、際限なく増えます。一覧から外します
function isSelfFeed(c: any) {
  const id = String(c?.id ?? ""), name = String(c?.summaryOverride ?? c?.summary ?? "");
  return /calendar-feed/.test(id) || /^TsuguAi 継ナビくん$/.test(name);
}

//  短い鍵を用意する。切れていれば更新用の鍵で取り直す。
//  取り直せなければ null（つなぎ直しが要る）
async function accessFor(sb: any, link: any): Promise<string | null> {
  const stillGood = link.access_expires && new Date(link.access_expires).getTime() > Date.now();
  if (link.access_token && stillGood) return link.access_token;

  const { data: refresh } = await sb.rpc("google_refresh_get", { p_link: link.id });
  if (!refresh) {
    await sb.from("google_cal_links").update({ last_error: "つなぎ直しが要ります：更新用の鍵がありません" }).eq("id", link.id);
    return null;
  }
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
    await sb.from("google_cal_links").update({ last_error: `つなぎ直しが要ります：${msg}` }).eq("id", link.id);
    return null;
  }
  await sb.from("google_cal_links").update({
    access_token: t.access_token,
    access_expires: new Date(Date.now() + (Number(t.expires_in || 3600) - 60) * 1000).toISOString(),
  }).eq("id", link.id);
  return t.access_token;
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

  const { data: links } = await sb.from("google_cal_links")
    .select("*").eq("user_id", uid).order("created_at", { ascending: true });
  const live = (links ?? []).filter((l: any) => l.refresh_enc);
  if (!live.length) return json({ ok: false, error: "まだ連携していません" }, 400);

  //  送るのは、これから先と、少し前まで。古いものまで送っても
  //  相手のカレンダーが散らかるだけです
  const since = new Date(Date.now() - 30 * DAY).toISOString();
  const until = new Date(Date.now() + 180 * DAY).toISOString();

  //  こちらの予定は一度だけ読んで、アカウントごとに振り分ける
  const { data: mine } = await sb.from("agenda_events")
    .select("id, title, starts_at, ends_at, all_day, place, note, google_id, link_id, source, synced_at, updated_at")
    .eq("owner_id", uid).gte("starts_at", since).lte("starts_at", until).limit(400);

  //  面談はパートナーだけ。担当顧客の名前も一度だけ引く
  const { data: prof } = await sb.from("profiles").select("role").eq("id", uid).maybeSingle();
  let nameOf = new Map<string, string>();
  if (prof?.role === "consultant") {
    const { data: ids } = await sb.from("profiles").select("id, company_name").eq("consultant_id", uid);
    nameOf = new Map((ids ?? []).map((p: any) => [p.id, p.company_name || "顧客"]));
  }

  let pushed = 0, pulled = 0, removed = 0;
  const notes: string[] = [];
  let relink = false;   // つなぎ直しが要るアカウントがあるか

  for (const link of live) {
    const lnotes: string[] = [];
    const who = link.google_email ? `${link.google_email}：` : "";

    // -------------------------------------------------------------
    // ① 短い鍵を用意する
    // -------------------------------------------------------------
    const access = await accessFor(sb, link);
    if (!access) { relink = true; continue; }   // 理由は accessFor が書いてある
    const H = { authorization: `Bearer ${access}`, "content-type": "application/json" };

    // -------------------------------------------------------------
    // ② こちらの予定を Google へ
    // -------------------------------------------------------------
    for (const e of mine ?? []) {
      //  Google から来たものを送り返さない
      if (e.source === "google") continue;
      //  どのアカウントへ送るか。すでにどこかへ送ったものはそのアカウントへ、
      //  まだのものは送り先へ。送り先でもなく預かってもいなければ何もしない
      const here = e.link_id ? e.link_id === link.id : !!link.push_target;
      if (!here) continue;
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
            google_id: g.id, google_etag: g.etag ?? null, link_id: link.id,
            synced_at: new Date().toISOString(),
          }).eq("id", e.id);
          pushed++;
        } else if (r.status === 404 && e.google_id) {
          //  向こうで消されていた。番号を外して、次の回に送り先へ作り直す
          await sb.from("agenda_events").update({ google_id: null, link_id: null, synced_at: null }).eq("id", e.id);
        } else {
          lnotes.push(`送れませんでした：${e.title}（${g?.error?.message ?? r.status}）`);
        }
      } catch (err) {
        lnotes.push(`送れませんでした：${e.title}（${String((err as Error).message)}）`);
      }
    }

    //  面談も Google に出す（こちらからの一方通行。送り先にだけ）
    if (link.push_target && nameOf.size) {
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

    // -------------------------------------------------------------
    // ③ Google の変更を取ってくる（カレンダーごと）
    // -------------------------------------------------------------
    if (link.pull_private !== false) {
      //  まず、このアカウントが持つカレンダーの一覧を Google と合わせる。
      //  新しく見つかったものはオフで足され（メインだけオン）、名前と色は
      //  毎回直す。オン／オフと札は SQL 側が守るので、ここでは触らない
      const lr = await fetch(
        "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&showHidden=false",
        { headers: H },
      );
      const lj = await lr.json();
      if (!lr.ok) {
        lnotes.push(`カレンダーの一覧を取れませんでした（${lj?.error?.message ?? lr.status}）`);
      } else {
        const items = (lj.items ?? [])
          .filter((c: any) => !isSelfFeed(c))
          .map((c: any) => ({
            id: c.id,
            name: c.summaryOverride || c.summary || c.id,
            is_primary: !!c.primary,
            color: /^#[0-9a-f]{6}$/i.test(String(c.backgroundColor ?? "")) ? c.backgroundColor : null,
          }));
        await sb.rpc("google_cal_list_merge", { p_link: link.id, p_items: items });
      }

      //  オンになっているカレンダーだけ取ってくる
      const { data: cals } = await sb.from("google_calendars")
        .select("cal_id, name, sync_token").eq("link_id", link.id).eq("enabled", true);

      for (const cal of cals ?? []) {
        const calApi = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.cal_id)}/events`;
        let pageToken: string | null = null;
        let syncToken: string | null = cal.sync_token ?? null;
        let nextSync: string | null = null;
        let pullBad = false;   // 一件でも入れ損ねたら、札を進めない

        //  ここは do…while で書いてはいけません。do…while の continue は
        //  条件式に飛ぶので、札を捨てたあと pageToken が null のまま条件を
        //  見て、**取り直さずに終わってしまいます**。実際そうなりました
        //  （「同期できたのに一件も入らない」という、いちばん分かりにくい形で）。
        //  終わり方を自分で書きます。
        let pages = 0;     // 何ページ取ったか
        let resets = 0;    // 札を捨てて取り直した回数
        while (true) {
          if (++pages > 20) break;   // 際限なく回らないように

          const q = new URL(calApi);
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
            //  札が古い。捨てて、日付を区切った取り方で最初から取り直す
            syncToken = null; pageToken = null;
            await sb.from("google_calendars").update({ sync_token: null })
              .eq("link_id", link.id).eq("cal_id", cal.cal_id);
            if (++resets > 2) { lnotes.push(`${cal.name}：取り直しが続いたので止めました`); break; }
            continue;
          }
          const g = await r.json();
          if (!r.ok) {
            lnotes.push(`${cal.name}：取ってこられませんでした（${g?.error?.message ?? r.status}）`);
            pullBad = true;
            break;
          }

          for (const it of g.items ?? []) {
            //  こちらが送ったものは取り込まない（同じ予定が二つになる）
            const mark = it.extendedProperties?.private ?? {};
            if (mark.tsuguai || mark.tsuguai_meeting) continue;
            //  旧来の購読（ICS）経由で Google に入った TsuguAi の予定も、
            //  取り込まない。戻ってくると際限なく増える
            if (/@tsugu-ai$/.test(String(it.iCalUID ?? ""))) continue;

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
              link_id: link.id,
              cal_id: cal.cal_id,
              source: "google",
              synced_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            //  同じ予定は番号で上書き（索引は owner_id, google_id。条件なし）
            const { error } = await sb.from("agenda_events")
              .upsert(row, { onConflict: "owner_id,google_id" });
            if (error) {
              //  黙って落とすと「同期は成功なのに出ない」になる。必ず知らせる
              pullBad = true;
              if (lnotes.length < 3) lnotes.push(`入れられませんでした：${row.title}（${error.message}）`);
            } else {
              pulled++;
            }
          }

          pageToken = g.nextPageToken ?? null;
          if (g.nextSyncToken) nextSync = g.nextSyncToken;
          if (!pageToken) break;   // 最後のページまで来た
        }

        //  全部入ったときだけ札を進める。入れ損ねがあれば、次も同じ幅で取り直す
        if (nextSync && !pullBad) {
          await sb.from("google_calendars").update({ sync_token: nextSync })
            .eq("link_id", link.id).eq("cal_id", cal.cal_id);
        }
      }
    }

    //  Google が「このアカウントはカレンダーを使えない」と返したとき。
    //  Workspace でカレンダーの機能が付いていないアカウントで起きます
    //  （実際に起きました）。英語のまま出しても、何をすればよいか
    //  分かりません。日本語に置き換えます。
    //
    //  先頭の「カレンダーが使えません」は画面への合図でもあります。
    //  画面はこの言葉を見て、そのアカウントに「送り先にする」を
    //  出さないようにします（出せない先に送ると、予定が溜まります）。
    const noCal = lnotes.some((n) => /signed up for Google Calendar/i.test(n));
    const lastError = noCal
      ? "カレンダーが使えません：このGoogleアカウントには、カレンダーの機能が付いていません。"
      : (lnotes.length ? lnotes.slice(0, 3).join(" / ") : null);

    await sb.from("google_cal_links").update({
      last_sync_at: new Date().toISOString(),
      last_error: lastError,
    }).eq("id", link.id);
    if (lastError) notes.push(who + lastError);
  }

  return json({ ok: true, pushed, pulled, removed, relink, accounts: live.length, notes: notes.slice(0, 3) });
});
