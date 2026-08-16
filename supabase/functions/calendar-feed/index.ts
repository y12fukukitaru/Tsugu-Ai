// =============================================================
// calendar-feed: TsuguAiの予定をICS形式で配信するEdge Function
// Googleカレンダー等の「URLで追加」で購読すると、次の2つが自動表示される
// （Google審査・OAuth不要）。
//   ① 面談予定（meetings_scheduled）… パートナーは担当顧客全社分
//   ② 継ナビくんの「予定」タブに本人が入れた予定（agenda_events）
// つまり「TsuguAiに入れれば Googleカレンダーにも出る」。
//
// 認証: URL内のトークン（calendar_feed_tokens）で本人を特定する
//       いわゆるケイパビリティURL方式。JWTは使わないため
//       デプロイ後は「Verify JWT」をOFFにすること。
//
// デプロイ:
//   supabase functions deploy calendar-feed --no-verify-jwt
//   （追加のSecretsは不要。SUPABASE_URL / SERVICE_ROLE_KEY は自動注入）
// =============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const DAY = 86400000;

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  if (!/^[a-f0-9]{32,}$/i.test(token)) return new Response("not found", { status: 404 });

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: row } = await sb.from("calendar_feed_tokens").select("user_id").eq("token", token).maybeSingle();
  if (!row?.user_id) return new Response("not found", { status: 404 });
  const partnerId = row.user_id;

  // 担当顧客（本担当 + 承認済みの2名体制）
  const customerIds = new Set<string>();
  {
    const { data } = await sb.from("profiles").select("id").eq("role", "customer").eq("consultant_id", partnerId);
    for (const p of data ?? []) customerIds.add(p.id);
  }
  {
    const { data } = await sb
      .from("partner_assignments")
      .select("customer_id, main_id, sub_id")
      .eq("status", "approved");
    for (const a of data ?? []) if (a.main_id === partnerId || a.sub_id === partnerId) customerIds.add(a.customer_id);
  }

  const ids = [...customerIds];
  let events: string[] = [];
  if (ids.length) {
    const names = new Map<string, string>();
    {
      const { data } = await sb.from("profiles").select("id, company_name").in("id", ids);
      for (const p of data ?? []) names.set(p.id, p.company_name || "顧客");
    }
    // 過去30日〜今後180日の面談を配信（過去分も少し残すと確認に便利）
    const { data: meetings } = await sb
      .from("meetings_scheduled")
      .select("id, customer_id, meet_at, place, status")
      .eq("status", "scheduled")
      .in("customer_id", ids)
      .gte("meet_at", new Date(Date.now() - 30 * DAY).toISOString())
      .lte("meet_at", new Date(Date.now() + 180 * DAY).toISOString())
      .order("meet_at", { ascending: true })
      .limit(300);

    events = (meetings ?? []).map((m: any) => {
      const start = new Date(m.meet_at);
      const end = new Date(start.getTime() + 3600000); // 標準60分
      return [
        "BEGIN:VEVENT",
        `UID:tsuguai-meeting-${m.id}@tsugu-ai`,
        `DTSTAMP:${icsDate(new Date())}`,
        `DTSTART:${icsDate(start)}`,
        `DTEND:${icsDate(end)}`,
        `SUMMARY:${icsText("面談: " + (names.get(m.customer_id) ?? "顧客") + "（TsuguAi）")}`,
        ...(m.place ? [`LOCATION:${icsText(m.place)}`] : []),
        `DESCRIPTION:${icsText("TsuguAiに登録された面談予定です。前日に継ナビくんの面談準備ブリーフが届きます。")}`,
        "BEGIN:VALARM",
        "TRIGGER:-PT60M",
        "ACTION:DISPLAY",
        `DESCRIPTION:${icsText("面談60分前です")}`,
        "END:VALARM",
        "END:VEVENT",
      ].join("\r\n");
    });
  }

  // 継ナビくんの「予定」タブに本人が入れた予定も配信する。
  // TsuguAi に入れれば Googleカレンダーにも出る、という一方向の連携。
  {
    const { data: mine } = await sb
      .from("agenda_events")
      .select("id, title, starts_at, ends_at, all_day, place, note")
      .eq("owner_id", partnerId)
      .gte("starts_at", new Date(Date.now() - 30 * DAY).toISOString())
      .lte("starts_at", new Date(Date.now() + 180 * DAY).toISOString())
      .order("starts_at", { ascending: true })
      .limit(300);

    for (const e of mine ?? []) {
      const start = new Date(e.starts_at);
      const end = e.ends_at ? new Date(e.ends_at) : new Date(start.getTime() + 3600000);
      const lines = [
        "BEGIN:VEVENT",
        `UID:tsuguai-agenda-${e.id}@tsugu-ai`,
        `DTSTAMP:${icsDate(new Date())}`,
      ];
      if (e.all_day) {
        // 終日はローカルの日付で書く（時刻を持たせると前日にずれることがある）
        const d0 = icsDay(start);
        const d1 = icsDay(new Date(start.getTime() + DAY));
        lines.push(`DTSTART;VALUE=DATE:${d0}`, `DTEND;VALUE=DATE:${d1}`);
      } else {
        lines.push(`DTSTART:${icsDate(start)}`, `DTEND:${icsDate(end)}`);
      }
      lines.push(`SUMMARY:${icsText(e.title ?? "予定")}`);
      if (e.place) lines.push(`LOCATION:${icsText(e.place)}`);
      lines.push(`DESCRIPTION:${icsText((e.note ? e.note + " / " : "") + "TsuguAi の継ナビくんに登録された予定です。")}`);
      if (!e.all_day) {
        lines.push("BEGIN:VALARM", "TRIGGER:-PT30M", "ACTION:DISPLAY",
                   `DESCRIPTION:${icsText("まもなく予定の時間です")}`, "END:VALARM");
      }
      lines.push("END:VEVENT");
      events.push(lines.join("\r\n"));
    }
  }

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TsuguAi//KeiNavi//JA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText("TsuguAi 継ナビくん")}`,
    "X-WR-TIMEZONE:Asia/Tokyo",
    ...events,
    "END:VCALENDAR",
  ].join("\r\n");

  return new Response(ics, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'attachment; filename="tsuguai.ics"',
      "cache-control": "private, max-age=900",
    },
  });
});

function icsDate(d: Date) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
function icsDay(d: Date) {
  // 日本時間の日付として書き出す（UTCだと前日になることがある）
  const j = new Date(d.getTime() + 9 * 3600000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${j.getUTCFullYear()}${p(j.getUTCMonth() + 1)}${p(j.getUTCDate())}`;
}
function icsText(s: string) {
  return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
