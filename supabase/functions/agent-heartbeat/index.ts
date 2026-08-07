// =============================================================
// agent-heartbeat: プロアクティブAIエージェントの心臓部
// 毎朝pg_cronから起動され、パートナーごとに担当顧客のデータを巡回し、
// 「今日の一手」ブリーフを生成して agent_insights に保存する。
//
// 分業方針:
//   シグナル抽出 = ルール（SQLで確実に拾える事実だけを使う）
//   優先順位付けと文章化 = Claude（シグナルを渡して朝のブリーフに編集させる）
//
// デプロイ:
//   supabase functions deploy agent-heartbeat --no-verify-jwt
//   supabase secrets set CRON_SECRET=<ランダムな文字列>
//   （ANTHROPIC_API_KEY は ai-proxy と共用の既存Secret）
// =============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

const DAY = 86400000;
const now = () => new Date();
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
const daysAhead = (n: number) => new Date(Date.now() + n * DAY).toISOString();

type Signal = { customer: string; kind: string; fact: string; priority: number };

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // 「パートナー → 顧客リスト」を組み立てる。
  // 本体の紐付けは profiles.consultant_id（運営が顧客管理で割り当てる担当）。
  // partner_assignments は2名体制（サブ担当）の承認分を追加で拾う。
  const byPartner = new Map<string, Set<string>>();
  const add = (pid: string | null, cid: string | null) => {
    if (!pid || !cid) return;
    if (!byPartner.has(pid)) byPartner.set(pid, new Set());
    byPartner.get(pid)!.add(cid);
  };

  const { data: profs, error: profErr } = await sb
    .from("profiles")
    .select("id, consultant_id")
    .eq("role", "customer")
    .not("consultant_id", "is", null);
  if (profErr) return json({ error: profErr.message }, 500);
  for (const p of profs ?? []) add(p.consultant_id, p.id);

  const { data: asg } = await sb
    .from("partner_assignments")
    .select("customer_id, main_id, sub_id")
    .eq("status", "approved");
  for (const a of asg ?? []) {
    add(a.main_id, a.customer_id);
    add(a.sub_id, a.customer_id);
  }

  let generated = 0;
  for (const [partnerId, customerSet] of byPartner) {
    const customerIds = [...customerSet];

    // 同じ日に二重生成しない（再実行・リトライ対策）
    const { data: dup } = await sb
      .from("agent_insights")
      .select("id")
      .eq("user_id", partnerId)
      .eq("kind", "daily_brief")
      .gte("created_at", daysAgo(0.8))
      .limit(1);
    if (dup?.length) continue;

    const signals = await collectSignals(sb, customerIds);
    if (!signals.length) continue;

    const brief = await composeBrief(signals);
    if (!brief) continue;

    const { error: insErr } = await sb.from("agent_insights").insert({
      user_id: partnerId,
      kind: "daily_brief",
      title: brief.title,
      body: brief.body,
      reason: signals.map((s) => s.fact).join(" / "),
      priority: Math.min(...signals.map((s) => s.priority)),
    });
    if (!insErr) generated++;
  }

  return json({ partners: byPartner.size, generated });
});

// ---- ルールベースのシグナル抽出（既存テーブルのみ使用） ----
async function collectSignals(sb: any, customerIds: string[]): Promise<Signal[]> {
  const signals: Signal[] = [];
  const names = new Map<string, string>();
  {
    const { data } = await sb.from("profiles").select("id, company_name").in("id", customerIds);
    for (const p of data ?? []) names.set(p.id, p.company_name || "（社名未設定）");
  }
  const nm = (id: string) => names.get(id) ?? "担当顧客";

  // 1) 3日以内の面談 → 準備を促す
  {
    const { data } = await sb
      .from("meetings_scheduled")
      .select("customer_id, meet_at")
      .eq("status", "scheduled")
      .in("customer_id", customerIds)
      .gte("meet_at", now().toISOString())
      .lte("meet_at", daysAhead(3));
    for (const m of data ?? []) {
      signals.push({
        customer: nm(m.customer_id),
        kind: "meeting_prep",
        fact: `${nm(m.customer_id)}と${fmtDate(m.meet_at)}に面談予定`,
        priority: 1,
      });
    }
  }

  // 2) 課題（PDCA）の期日超過
  {
    const { data } = await sb
      .from("pdca_items")
      .select("customer_id, title, due_date, status")
      .in("customer_id", customerIds)
      .neq("status", "done")
      .lt("due_date", now().toISOString().slice(0, 10));
    for (const p of (data ?? []).slice(0, 5)) {
      signals.push({
        customer: nm(p.customer_id),
        kind: "pdca_overdue",
        fact: `${nm(p.customer_id)}の課題「${p.title}」が期日超過`,
        priority: 2,
      });
    }
  }

  // 3) 試算表の入力が2ヶ月途絶（解約の前兆シグナル）
  {
    const { data } = await sb
      .from("financial_entries")
      .select("customer_id, created_at")
      .in("customer_id", customerIds)
      .order("created_at", { ascending: false });
    const latest = new Map<string, string>();
    for (const f of data ?? []) if (!latest.has(f.customer_id)) latest.set(f.customer_id, f.created_at);
    for (const id of customerIds) {
      const last = latest.get(id);
      if (!last || new Date(last).getTime() < Date.now() - 60 * DAY) {
        signals.push({
          customer: nm(id),
          kind: "silence",
          fact: `${nm(id)}の試算表入力が${last ? "2ヶ月以上" : "一度も"}ない（関係が薄れているサイン）`,
          priority: 2,
        });
      }
    }
  }

  // 4) 顧客チャットの30日沈黙
  {
    const { data } = await sb
      .from("chat_messages")
      .select("customer_id, created_at")
      .in("customer_id", customerIds)
      .gte("created_at", daysAgo(30));
    const active = new Set((data ?? []).map((c: any) => c.customer_id));
    for (const id of customerIds) {
      if (!active.has(id)) {
        signals.push({
          customer: nm(id),
          kind: "silence",
          fact: `${nm(id)}と30日以上やり取りがない`,
          priority: 3,
        });
      }
    }
  }

  // 5) 先月分の月次レポートが未作成・下書きのまま
  {
    const prev = new Date();
    prev.setDate(1);
    prev.setDate(0); // 先月末
    const prevMonth = prev.toISOString().slice(0, 7);
    const { data } = await sb
      .from("monthly_reports")
      .select("customer_id, report_month, status")
      .in("customer_id", customerIds)
      .eq("report_month", prevMonth);
    const done = new Set((data ?? []).filter((r: any) => r.status === "published").map((r: any) => r.customer_id));
    const draft = new Set((data ?? []).filter((r: any) => r.status === "draft").map((r: any) => r.customer_id));
    for (const id of customerIds) {
      if (draft.has(id)) {
        signals.push({ customer: nm(id), kind: "report_draft", fact: `${nm(id)}の${prevMonth}月次レポートが下書きのまま`, priority: 2 });
      } else if (!done.has(id)) {
        signals.push({ customer: nm(id), kind: "report_draft", fact: `${nm(id)}の${prevMonth}月次レポートが未作成`, priority: 3 });
      }
    }
  }

  // 6) 締切30日以内の補助金（全顧客共通のレーダー情報）
  {
    const { data } = await sb
      .from("subsidies")
      .select("name, deadline")
      .eq("active", true)
      .gte("deadline", now().toISOString().slice(0, 10))
      .lte("deadline", daysAhead(30).slice(0, 10))
      .order("deadline", { ascending: true })
      .limit(3);
    for (const s of data ?? []) {
      signals.push({ customer: "全顧客", kind: "subsidy", fact: `補助金「${s.name}」の締切が${s.deadline}に迫っている（該当顧客がいないか確認）`, priority: 3 });
    }
  }

  // 7) 資金繰りスコアの悪化（最新スナップショットが40点以下）
  {
    const { data } = await sb
      .from("cashflow_snapshots")
      .select("customer_id, score, created_at")
      .in("customer_id", customerIds)
      .gte("created_at", daysAgo(90))
      .order("created_at", { ascending: false });
    const seen = new Set<string>();
    for (const c of data ?? []) {
      if (seen.has(c.customer_id)) continue;
      seen.add(c.customer_id);
      if (typeof c.score === "number" && c.score <= 40) {
        signals.push({ customer: nm(c.customer_id), kind: "cashflow", fact: `${nm(c.customer_id)}の資金繰りスコアが${c.score}点と低い`, priority: 1 });
      }
    }
  }

  signals.sort((a, b) => a.priority - b.priority);
  return signals.slice(0, 12); // ブリーフは絞る。多すぎる提案は読まれない
}

// ---- Claudeでブリーフに編集（優先順位付けと「最初の一言」まで） ----
async function composeBrief(signals: Signal[]): Promise<{ title: string; body: string } | null> {
  const sys =
    "あなたは中小企業支援プラットフォーム「TsuguAi」の、認定パートナーを支えるAIエージェント「継ナビくん」です。" +
    "親しみやすく、頼れる相棒として振る舞います（ただし馴れ馴れしくしない）。" +
    "毎朝、担当顧客の状況シグナルから「今日の一手」ブリーフを作ります。" +
    "ルール: 最重要の3件までに絞る。各件は必ず①顧客名②なぜ今日か（根拠）③最初の一言（そのまま送れる短い文面案）の3点で書く。" +
    "断定しすぎない。押し付けない。敬意のある簡潔な日本語。" +
    '出力は次のJSONのみ: {"title":"見出し(20字以内)","body":"本文(Markdown可・600字以内)"}';
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1200,
      system: sys,
      messages: [{ role: "user", content: "今朝のシグナル:\n" + signals.map((s) => `- [優先${s.priority}] ${s.fact}`).join("\n") }],
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = data?.content?.[0]?.text ?? "";
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}
