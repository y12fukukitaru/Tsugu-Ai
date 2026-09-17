// =============================================================
// google-oauth: Googleカレンダーとつなぐ（同意 → 鍵の受け取り）
// ---------------------------------------------------------------
//  二つの入口を一つの関数にしています。Google に登録する戻り先
//  （リダイレクトURI）は一つでないといけないためです。
//
//    GET  ?start=1   … Google の同意画面の URL を返す（要ログイン）
//    GET  ?code=...  … Google が戻してくる。鍵を受け取ってしまう
//
//  認証: 戻り先には JWT が付きません。だから「Verify JWT」は OFF にし、
//        start のときだけ Authorization ヘッダの中身を自分で確かめます。
//
//  state: 誰の同意かを戻り先まで運ぶ札です。推測されると他人の
//        カレンダーを自分に結び付けられてしまうので、**署名**します
//        （HMAC-SHA256・10分で失効）。
//
//  デプロイ:
//    supabase functions deploy google-oauth --no-verify-jwt
//
//  Secrets（Supabase → Edge Functions → Secrets）:
//    GOOGLE_CLIENT_ID      … Google Cloud の OAuth クライアントID
//    GOOGLE_CLIENT_SECRET  … 同シークレット
//    GOOGLE_REDIRECT_URI   … この関数の URL（Google 側にも同じものを登録）
//    GOOGLE_STATE_SECRET   … 札の署名に使う任意の長い文字列
//    APP_URL               … 終わったあとに戻すページ（例 https://…/index.html）
// =============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";
const REDIRECT_URI = Deno.env.get("GOOGLE_REDIRECT_URI") ?? "";
const STATE_SECRET = Deno.env.get("GOOGLE_STATE_SECRET") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "";

//  予定の読み書きと、どのアカウントかを知るぶんだけ。
//  これ以上は求めません（求めるほど同意画面が重くなります）
const SCOPE = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "openid",
  "email",
].join(" ");

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

//  人が読む画面。終わったことだけ伝えて、アプリへ戻す
//
//  ・ページとして表示させるには content-type が要ります。付け忘れると
//    ブラウザが HTML の中身をそのまま文字として出します（実際に出ました）。
//    Headers で明示的に組み、charset も必ず付けます。付けないと
//    日本語が文字化けします（Windows では Shift-JIS と誤読されます）。
//  ・返す本文は、こちらで組んだ文字列です。ただし Google から来た
//    エラー文などが混ざるので、山括弧だけは落としておきます。
function esc(s: string) {
  return String(s ?? "").replace(/[<>&"]/g, (c) =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] as string));
}
function page(title: string, msg: string, ok: boolean) {
  const back = APP_URL
    ? `<p style="margin-top:22px"><a href="${esc(APP_URL)}" style="color:#2C5DA8">TsuguAi に戻る</a></p>`
    : "";
  const h = new Headers();
  h.set("content-type", "text/html; charset=utf-8");
  h.set("cache-control", "no-store");
  return new Response(
    `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head>
<body style="margin:0;background:#FBF9F4;font:15px/1.9 system-ui,'Noto Sans JP',sans-serif;color:#243247">
<div style="max-width:560px;margin:14vh auto;padding:28px 30px;background:#fff;border:1px solid #E2E7EF;border-radius:14px">
<div style="font-size:19px;font-weight:700;color:${ok ? "#27684A" : "#A9403D"}">${esc(title)}</div>
<div style="margin-top:10px;color:#5A6981">${esc(msg)}</div>${back}</div></body></html>`,
    { status: ok ? 200 : 400, headers: h },
  );
}

//  ---- 札の署名（HMAC-SHA256）----
async function hmac(data: string) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(STATE_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function makeState(userId: string) {
  const body = `${userId}.${Date.now()}`;
  return `${body}.${await hmac(body)}`;
}
async function readState(state: string): Promise<string | null> {
  const p = String(state || "").split(".");
  if (p.length !== 3) return null;
  const body = `${p[0]}.${p[1]}`;
  //  署名が合うこと。時間をかけずに比べると差が漏れるので、長さも先に見る
  const want = await hmac(body);
  if (want.length !== p[2].length) return null;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ p[2].charCodeAt(i);
  if (diff !== 0) return null;
  //  10分で失効
  if (Date.now() - Number(p[1]) > 600000) return null;
  return p[0];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const url = new URL(req.url);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI || !STATE_SECRET) {
    const miss = "Google連携の設定が済んでいません（Secrets：GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REDIRECT_URI / GOOGLE_STATE_SECRET）";
    return url.searchParams.get("code")
      ? page("つなげませんでした", miss, false)
      : json({ ok: false, error: miss }, 500);
  }

  // ---------------------------------------------------------------
  // ① 同意画面の URL を返す
  // ---------------------------------------------------------------
  if (url.searchParams.get("start")) {
    const auth = req.headers.get("authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, error: "ログインが必要です" }, 401);
    const { data: u, error } = await sb.auth.getUser(token);
    if (error || !u?.user) return json({ ok: false, error: "ログインを確かめられませんでした" }, 401);

    const p = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      scope: SCOPE,
      //  更新用の鍵をもらうために要る二つ。offline でないと
      //  1時間ごとにログインし直しになります
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state: await makeState(u.user.id),
    });
    return json({ ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${p}` });
  }

  // ---------------------------------------------------------------
  // ② Google からの戻り
  // ---------------------------------------------------------------
  const code = url.searchParams.get("code");
  const err = url.searchParams.get("error");
  if (err) {
    return page("つなげませんでした",
      err === "access_denied"
        ? "Google の画面で「許可」が押されなかったため、つながっていません。もう一度お試しいただけます。"
        : `Google から次の返事がありました：${err}`,
      false);
  }
  if (!code) return json({ ok: false, error: "使い方が違います" }, 400);

  const userId = await readState(url.searchParams.get("state") ?? "");
  if (!userId) {
    return page("つなげませんでした",
      "確認の札が合わないか、時間が経ちすぎています（10分で切れます）。TsuguAi の画面からもう一度お試しください。", false);
  }

  //  code を鍵に交換する
  let tok: any;
  try {
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI, grant_type: "authorization_code",
      }),
    });
    tok = await r.json();
    if (!r.ok) throw new Error(tok?.error_description || tok?.error || `HTTP ${r.status}`);
  } catch (e) {
    return page("つなげませんでした", `Google とのやり取りで止まりました：${String((e as Error).message)}`, false);
  }

  //  どのアカウントか（id_token の中身を見るだけ。署名は Google 直送なので信じてよい）
  let email = "";
  try {
    const part = String(tok.id_token || "").split(".")[1];
    if (part) {
      const pad = part.replace(/-/g, "+").replace(/_/g, "/");
      email = JSON.parse(atob(pad + "=".repeat((4 - pad.length % 4) % 4)))?.email ?? "";
    }
  } catch { /* 名前が取れなくても、つながりは作れる */ }

  //  更新用の鍵は暗号化してしまう（SQL 側の関数がやる）
  const { error: e1 } = await sb.rpc("google_link_save", {
    p_user: userId, p_email: email, p_refresh: tok.refresh_token ?? "",
  });
  if (e1) return page("つなげませんでした", `保存で止まりました：${e1.message}`, false);

  //  短いほうの鍵は、そのまま入れておく（すぐ同期できるように）
  if (tok.access_token) {
    await sb.from("google_cal_links").update({
      access_token: tok.access_token,
      access_expires: new Date(Date.now() + (Number(tok.expires_in || 3600) - 60) * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("user_id", userId);
  }

  //  更新用の鍵が来なかったとき（二度目以降の同意で起きます）。
  //  前のものが残っていれば、それで動きます
  const { data: link } = await sb.from("google_cal_links")
    .select("refresh_enc").eq("user_id", userId).maybeSingle();
  if (!link?.refresh_enc) {
    return page("もう一度だけお願いします",
      "Google から更新用の鍵が返りませんでした。Google アカウントの「セキュリティ → サードパーティのアクセス」から TsuguAi のアクセスを一度削除してから、もう一度おつなぎください。", false);
  }

  return page("つながりました",
    `${email ? email + " の" : ""}Googleカレンダーとつながりました。TsuguAi に戻ると、すぐに予定の行き来が始まります。`, true);
});
