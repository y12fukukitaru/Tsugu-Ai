// =============================================================
// ai-proxy: フロントからClaude APIを安全に呼ぶための中継
//
// 対応形式:
//   body: { system?, messages, model?, max_tokens? }
//   messages[].content は「文字列」または「コンテンツブロック配列」の両対応。
//   配列の場合は document(PDF) / image(画像) ブロックをそのまま中継するため、
//   決算書アップロード→AI読み込み（承継シミュレーション）が動作する。
// 応答: { ok:true, text } / { ok:false, error }
//
// 認証:
//   ログイン中の本人でなければ呼べない。Authorization ヘッダのトークンを
//   Supabase の /auth/v1/user で検証する。
//   これが無いと、URLさえ知っていれば誰でも Claude を呼べてしまい、
//   こちらの API 利用料で好きなだけ使われる（データは漏れないが費用が出る）。
//   ブラウザからは sb.functions.invoke が自動でトークンを送るため、
//   画面側の変更は要らない。
//
// デプロイ:
//   supabase functions deploy ai-proxy --no-verify-jwt
//     ※ --no-verify-jwt のままでよい。認証はこの関数の中で行う
//       （そのほうが「ログインが必要です」と日本語で返せる）
//   supabase secrets set ANTHROPIC_API_KEY=<APIキー>（設定済みなら不要）
// =============================================================

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  });
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

// 呼んでいるのがログイン中の本人かどうかを確かめる。
// publishable key（画面のソースに載っている公開鍵）を投げてきただけでは通らない。
async function callerIsSignedIn(req: Request): Promise<boolean> {
  const authz = req.headers.get("Authorization") ?? "";
  const jwt = authz.replace(/^Bearer\s+/i, "").trim();
  if (!jwt || jwt === ANON_KEY) return false;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: ANON_KEY },
    });
    if (!r.ok) return false;
    const u = await r.json();
    return !!u?.id;
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  if (!(await callerIsSignedIn(req))) {
    return json({ ok: false, error: "ログインが必要です" }, 401);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!apiKey) return json({ ok: false, error: "ANTHROPIC_API_KEY が未設定です" });

  let body: any = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid json" }); }

  const payload: any = {
    model: body.model || "claude-sonnet-4-6",
    max_tokens: Math.min(Number(body.max_tokens) || 1500, 8000),
    messages: Array.isArray(body.messages) ? body.messages : [],
  };
  if (body.system) payload.system = body.system;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const j = await r.json();
    if (!r.ok) {
      return json({ ok: false, error: j?.error?.message || ("API error " + r.status) });
    }
    const text = (j.content || [])
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("\n");
    return json({ ok: true, text });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) });
  }
});
