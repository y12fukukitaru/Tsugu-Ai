// =============================================================
// calendar-feed: TsuguAiの面談予定をICS形式で配信するEdge Function
// Googleカレンダー等の「URLで追加」で購読すると、担当顧客との面談予定が
// パートナーのカレンダーに自動表示される（Google審査・OAuth不要）。
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

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TsuguAi//KeiNavi//JA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${icsText("TsuguAi 面談")}`,
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
function icsText(s: string) {
  return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
