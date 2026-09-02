// =============================================================
// ai-proxy: フロントからClaude APIを安全に呼ぶための中継
//
// 対応形式:
//   body: { system?, messages, max_tokens? }
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
// モデル（2026-09-02）:
//   画面側が何を指定しても、ここで決めた一つのモデルに揃える。
//   以前は body.model をそのまま通していたので、呼び出し側が高価なモデルを
//   指定すれば、その費用がそのまま出た。運営の判断で Opus の最新に固定する。
//   変えるときは Secret の AI_MODEL を書き換える。画面の再デプロイは要らない。
//
// 利用上限（2026-09-02）:
//   1人あたり1日 AI_DAILY_LIMIT 回（既定60回）。登録は誰でもできるので、
//   悪意がなくても「試しに100回」で費用が出る。超えたら、継ナビくんの言葉で
//   「今日はここまで」と返す。回数は ai_calls 表に1行ずつ記録する。
//   表がまだ無い環境では、数えずに通す。上限より先に AI が止まるほうが困る。
//
// デプロイ:
//   supabase functions deploy ai-proxy --no-verify-jwt
//     ※ --no-verify-jwt のままでよい。認証はこの関数の中で行う
//       （そのほうが「ログインが必要です」と日本語で返せる）
//   supabase secrets set ANTHROPIC_API_KEY=<APIキー>（設定済みなら不要）
// =============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

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
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ---- モデルと上限。ここ以外では決めない ----
const MODEL = Deno.env.get("AI_MODEL") || "claude-opus-5";
const DAILY_LIMIT = Math.max(1, Number(Deno.env.get("AI_DAILY_LIMIT")) || 60);
const MAX_TOKENS_CAP = 8000;

// 上限に達したときの言葉。エラーではなく、継ナビくんの返事として画面に出る。
const LIMIT_MESSAGE =
  `今日はここまでにしましょう。1日にお答えできる回数（${DAILY_LIMIT}回）に達しました。` +
  `明日また続きをお聞かせください。急ぎのご相談は、担当パートナーへメッセージでどうぞ。`;

// 呼んでいるのがログイン中の本人かどうかを確かめ、本人の id を返す。
// publishable key（画面のソースに載っている公開鍵）を投げてきただけでは通らない。
async function signedInUserId(req: Request): Promise<string | null> {
  const authz = req.headers.get("Authorization") ?? "";
  const jwt = authz.replace(/^Bearer\s+/i, "").trim();
  if (!jwt || jwt === ANON_KEY) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${jwt}`, apikey: ANON_KEY },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? String(u.id) : null;
  } catch {
    return null;
  }
}

// 日本時間の「今日の0時」を UTC の ISO で返す。上限は暦日で区切る。
function jstDayStartIso(now = Date.now()): string {
  const j = new Date(now + 9 * 3600000);
  const startUtc = Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate()) - 9 * 3600000;
  return new Date(startUtc).toISOString();
}

// 今日の回数を数え、上限内なら1行記録して true を返す。
// 表が無い・読めない・書けないときは true（数えずに通す）。
async function underLimitAndRecord(userId: string): Promise<{ allowed: boolean; used: number }> {
  if (!SERVICE_KEY) return { allowed: true, used: 0 };
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { count, error } = await sb
      .from("ai_calls")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("at", jstDayStartIso());
    if (error) return { allowed: true, used: 0 };          // 表が無い環境。止めない
    const used = count ?? 0;
    if (used >= DAILY_LIMIT) return { allowed: false, used };
    // 記録は「呼ぶ前」に付ける。呼んだあとに付けると、失敗した呼び出しが数に入らず、
    // 失敗を繰り返すだけで上限を素通りできてしまう。
    const ins = await sb.from("ai_calls").insert({ user_id: userId, model: MODEL });
    if (ins.error) return { allowed: true, used };
    return { allowed: true, used: used + 1 };
  } catch {
    return { allowed: true, used: 0 };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method not allowed" }, 405);

  const userId = await signedInUserId(req);
  if (!userId) {
    return json({ ok: false, error: "ログインが必要です" }, 401);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
  if (!apiKey) return json({ ok: false, error: "ANTHROPIC_API_KEY が未設定です" });

  let body: any = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid json" }); }

  // 上限。超えていたら Claude を呼ばずに返す。
  // 200 で返すのは、画面側が「本文」として表示できるようにするため。
  // 非2xxだと supabase-js が中身を捨てて「Edge Function returned a non-2xx」に
  // してしまい、この言葉が経営者に届かない。
  const lim = await underLimitAndRecord(userId);
  if (!lim.allowed) {
    return json({ ok: false, limited: true, error: LIMIT_MESSAGE, text: LIMIT_MESSAGE, used: lim.used, limit: DAILY_LIMIT });
  }

  // body.model は読まない。モデルはここで決める。
  const payload: any = {
    model: MODEL,
    max_tokens: Math.min(Number(body.max_tokens) || 1500, MAX_TOKENS_CAP),
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
    return json({ ok: true, text, model: MODEL, used: lim.used, limit: DAILY_LIMIT });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) });
  }
});
