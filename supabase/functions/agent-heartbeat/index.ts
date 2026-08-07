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
import webpush from "npm:web-push@3.6.7";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

// ---- Phase 2: 配信チャネル（未設定のチャネルは自動的にスキップされる） ----
const RESEND_KEY = Deno.env.get("RESEND_API_KEY") ?? "";                 // メール配信（Resend）
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "TsuguAi 継ナビくん <onboarding@resend.dev>";
const APP_URL = Deno.env.get("APP_URL") ?? "https://y12fukukitaru.github.io/Tsugu-Ai/";
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";             // プッシュ通知（Web Push）
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:no-reply@example.com";

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

  // 巡回＋ブリーフ生成は数十秒かかることがあり、pg_net（SQLからの呼び出し）は
  // 長く待てないため、即座に受領応答を返して本処理はバックグラウンドで続行する。
  const job = runHeartbeat(sb).catch((e) => console.error("heartbeat failed:", e));
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) {
    rt.waitUntil(job);
    return json({ accepted: true, note: "処理継続中。結果は agent_insights を確認" }, 202);
  }
  return json(await job);
});

async function runHeartbeat(sb: any) {
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
  if (profErr) throw new Error(profErr.message);
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
    if (!insErr) {
      generated++;
      await deliver(sb, partnerId, brief); // メール・プッシュで届ける（アプリ外への働きかけ）
    }
  }

  console.log(`heartbeat done: partners=${byPartner.size} generated=${generated}`);
  return { partners: byPartner.size, generated };
}

// ---- Phase 2: ブリーフをメールとスマホ通知でも届ける ----
// 配信失敗でブリーフ生成自体を失敗させないよう、すべて握りつぶしてログに残すだけにする。
async function deliver(sb: any, partnerId: string, brief: { title: string; body: string }) {
  // メール（Resend）
  if (RESEND_KEY) {
    try {
      const { data: prof } = await sb.from("profiles").select("email").eq("id", partnerId).maybeSingle();
      if (prof?.email) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${RESEND_KEY}`, "content-type": "application/json" },
          body: JSON.stringify({
            from: MAIL_FROM,
            to: [prof.email],
            subject: `【継ナビくん】${brief.title}`,
            html: emailHtml(brief),
          }),
        });
        if (!res.ok) console.error("email send failed:", res.status, await res.text());
      }
    } catch (e) { console.error("email failed:", e); }
  }
  // プッシュ通知（Web Push）
  if (VAPID_PUBLIC && VAPID_PRIVATE) {
    try {
      webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
      const { data: subs } = await sb.from("push_subscriptions").select("id, subscription").eq("user_id", partnerId);
      for (const s of subs ?? []) {
        try {
          await webpush.sendNotification(s.subscription, JSON.stringify({
            title: `継ナビくん｜${brief.title}`,
            body: excerpt(brief.body, 120),
            url: APP_URL,
          }));
        } catch (e: any) {
          // 端末側で購読が解除された購読は掃除する
          if (e?.statusCode === 404 || e?.statusCode === 410) {
            await sb.from("push_subscriptions").delete().eq("id", s.id);
          } else {
            console.error("push send failed:", e?.statusCode ?? e);
          }
        }
      }
    } catch (e) { console.error("push failed:", e); }
  }
}

function excerpt(t: string, n: number) {
  const plain = (t || "").replace(/\*\*/g, "").replace(/\n+/g, " ").trim();
  return plain.length > n ? plain.slice(0, n) + "…" : plain;
}

function emailHtml(brief: { title: string; body: string }) {
  const body = (brief.body || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/\n/g, "<br>");
  return `<div style="font-family:'Hiragino Sans','Noto Sans JP',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#18202E;">
    <div style="font-size:13px;color:#C39B3F;font-weight:bold;">✦ 継ナビくんからの提案（今日の一手）</div>
    <h2 style="font-size:17px;color:#1E3A66;margin:8px 0 14px;">${brief.title}</h2>
    <div style="font-size:14px;line-height:1.9;background:#F8F9FC;border:1px solid #E2E7EF;border-radius:10px;padding:16px 18px;">${body}</div>
    <div style="margin:18px 0;"><a href="${APP_URL}" style="display:inline-block;background:#1E3A66;color:#fff;text-decoration:none;font-size:13px;font-weight:bold;padding:11px 22px;border-radius:9px;">TsuguAiを開いて対応する →</a></div>
    <div style="font-size:11px;color:#5A6981;line-height:1.7;">このメールは TsuguAi -継- の継ナビくんが、担当顧客の状況をもとに毎朝自動でお送りしています。</div>
  </div>`;
}

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

