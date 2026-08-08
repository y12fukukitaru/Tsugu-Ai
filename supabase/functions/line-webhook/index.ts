// =============================================================
// line-webhook: LINE公式アカウントのWebhook受け口
// 役割:
//   - 友だち追加時: 連携方法を案内
//   - 6桁コード受信: line_link_codes と照合してアカウントを紐付け
//   - 「解除」受信: 紐付けを解除
//   - その他のメッセージ: アプリへの誘導を案内
//
// デプロイ:
//   supabase functions deploy line-webhook --no-verify-jwt
//   supabase secrets set LINE_CHANNEL_SECRET=<チャネルシークレット>
//   supabase secrets set LINE_CHANNEL_ACCESS_TOKEN=<チャネルアクセストークン>
//   その後、LINE Developersのチャネル設定でWebhook URLに
//   https://<PROJECT-REF>.supabase.co/functions/v1/line-webhook を設定して有効化。
//   （応答メッセージ（自動応答）はOFFにすること）
// =============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CHANNEL_SECRET = Deno.env.get("LINE_CHANNEL_SECRET") ?? "";
const ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "https://y12fukukitaru.github.io/Tsugu-Ai/";

const GUIDE =
  "こんにちは、継ナビくんです🌱\n\n" +
  "TsuguAiのアカウントと連携すると、毎朝の「今日の一手」がこのトークに届きます。\n\n" +
  "連携方法：\n" +
  "1. TsuguAiアプリの「継ナビくん」画面で「💬 LINEで通知を受け取る」を押す\n" +
  "2. 表示された6桁のコードを、このトークに送信\n\n" +
  "解除したいときは「解除」と送ってください。\n" + APP_URL;

Deno.serve(async (req) => {
  const body = await req.text();

  // 署名検証（X-Line-Signature = HMAC-SHA256(channel secret, body) のBase64）
  if (!CHANNEL_SECRET || !(await verifySignature(body, req.headers.get("x-line-signature") ?? ""))) {
    return new Response("forbidden", { status: 403 });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  let events: any[] = [];
  try { events = JSON.parse(body)?.events ?? []; } catch {}

  for (const ev of events) {
    try {
      const lineUserId = ev?.source?.userId;
      if (!lineUserId) continue;

      if (ev.type === "follow") {
        await reply(ev.replyToken, GUIDE);
        continue;
      }
      if (ev.type !== "message" || ev.message?.type !== "text") continue;

      const text = String(ev.message.text ?? "").trim();

      if (/^解除$/.test(text)) {
        await sb.from("line_links").delete().eq("line_user_id", lineUserId);
        await reply(ev.replyToken, "連携を解除しました。再開したいときは、アプリでコードを発行してもう一度送ってください。");
        continue;
      }

      const code = text.replace(/[^0-9]/g, "");
      if (/^\d{6}$/.test(code)) {
        const { data: row } = await sb
          .from("line_link_codes")
          .select("user_id, expires_at")
          .eq("code", code)
          .maybeSingle();
        if (!row || new Date(row.expires_at).getTime() < Date.now()) {
          await reply(ev.replyToken, "コードが見つからないか、期限切れです（有効期限10分）。アプリでもう一度発行してください。");
          continue;
        }
        // 1ユーザー1LINE・1LINE1ユーザーになるよう古い紐付けを掃除してから登録
        await sb.from("line_links").delete().eq("user_id", row.user_id);
        await sb.from("line_links").delete().eq("line_user_id", lineUserId);
        const { error } = await sb.from("line_links").insert({ user_id: row.user_id, line_user_id: lineUserId });
        await sb.from("line_link_codes").delete().eq("code", code);
        await reply(
          ev.replyToken,
          error
            ? "連携に失敗しました。時間をおいてもう一度お試しください。"
            : "✅ 連携が完了しました！\n毎朝6時ごろ、継ナビくんの「今日の一手」がここに届きます。\n解除したいときは「解除」と送ってください。"
        );
        continue;
      }

      await reply(ev.replyToken, GUIDE);
    } catch (e) {
      console.error("line-webhook event failed:", e);
    }
  }
  return new Response("ok");
});

async function verifySignature(body: string, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(CHANNEL_SECRET),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
    const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
    return expected === signature;
  } catch { return false; }
}

async function reply(replyToken: string, text: string) {
  if (!ACCESS_TOKEN || !replyToken) return;
  const res = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${ACCESS_TOKEN}` },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] }),
  });
  if (!res.ok) console.error("line reply failed:", res.status, await res.text());
}
