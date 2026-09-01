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
//  差出人名は「TsuguAi -継-」で通す。受信箱に並んだときに、どこから来た
//  メールなのかが名前だけで分かるようにするため。ここは Secret の MAIL_FROM が
//  設定されていればそちらが勝つので、実際に届く名前を変えるときは
//  Supabase の Secrets 側（MAIL_FROM）も同じ書き方に揃えること。
const MAIL_FROM = Deno.env.get("MAIL_FROM") ?? "TsuguAi -継- <onboarding@resend.dev>";
const APP_URL = Deno.env.get("APP_URL") ?? "https://y12fukukitaru.github.io/Tsugu-Ai/";
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") ?? "";             // プッシュ通知（Web Push）
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:no-reply@example.com";
const LINE_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN") ?? "";      // LINE配信（Messaging API）

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
    const agenda = await todayAgenda(sb, partnerId, customerIds);
    // 予定が入っている日は、シグナルが無くても朝のひとことを届ける
    if (!signals.length && !agenda.length) continue;

    const brief = await composeBrief(signals, agenda);
    if (!brief) continue;
    brief.body = agendaBlock(agenda) + brief.body;

    const { error: insErr } = await sb.from("agent_insights").insert({
      user_id: partnerId,
      kind: "daily_brief",
      title: brief.title,
      body: brief.body,
      reason: [...signals.map((s) => s.fact), ...agenda.map((a) => "予定: " + a)].join(" / "),
      priority: signals.length ? Math.min(...signals.map((s) => s.priority)) : 3,
    });
    if (!insErr) {
      generated++;
      await deliver(sb, partnerId, brief); // メール・プッシュで届ける（アプリ外への働きかけ）
    }
  }

  // 48時間以内に面談がある顧客には、深掘りの「面談準備ブリーフ」を届ける
  const briefed = await prepareMeetingBriefs(sb, byPartner);

  // 新人パートナーには「指南モード」で次の一歩を先回り提示（3日に1回まで）
  const mentored = await mentorNewPartners(sb, byPartner);

  // 毎週月曜は「承継シグナル・レーダー」：承継の窓が開いた顧客を検知
  const radar = await successionRadar(sb, byPartner);

  // 月初（1〜7日）は月次レポートの所見・ひとことの草案を先回りで用意
  const drafts = await reportDrafts(sb, byPartner);

  // 毎週水曜は「M&Aクロスマッチング」：パートナー間の売り×買いを突合
  const matches = await maCrossMatch(sb, byPartner);

  // 経営者にも毎朝の一手を届ける（担当パートナーがいる顧客のみ）
  const custBriefs = await customerBriefs(sb);

  // 毎週金曜は「今週のナレッジ便り」：パートナー間の知見をAIが編集して共有
  const digest = await knowledgeDigest(sb);

  console.log(`heartbeat done: partners=${byPartner.size} generated=${generated} meeting_briefs=${briefed} mentored=${mentored} succession=${radar} report_drafts=${drafts} ma_matches=${matches} customer_briefs=${custBriefs} knowledge_digest=${digest}`);
  return { partners: byPartner.size, generated, meeting_briefs: briefed, mentored, succession: radar, report_drafts: drafts, ma_matches: matches, customer_briefs: custBriefs, knowledge_digest: digest };
}

// ---- 経営者向け 毎朝の一手 ----
// 経営者自身のデータ（試算表・課題・面談・レポート）から、今日やるとよいことを1〜2個だけ。
// パートナー向けと違い、負担にならない軽さを最優先にする。
async function customerBriefs(sb: any): Promise<number> {
  const { data: custs } = await sb
    .from("profiles")
    .select("id, company_name")
    .eq("role", "customer")
    .not("consultant_id", "is", null)
    .limit(30); // 1回の実行で最大30社（コスト上限）
  if (!custs?.length) return 0;

  const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const prev = new Date(jstNow); prev.setUTCDate(1); prev.setUTCDate(0);
  const prevMonth = prev.toISOString().slice(0, 7);
  //  日本時間の今日。UTCで取ると、朝6時の実行では前日になる。
  const today = jstToday().date;

  let made = 0;
  for (const c of custs) {
    const { data: dup } = await sb
      .from("agent_insights").select("id")
      .eq("user_id", c.id).eq("kind", "daily_brief")
      .gte("created_at", daysAgo(0.8)).limit(1);
    if (dup?.length) continue;

    const signals: string[] = [];
    const { data: fin } = await sb.from("financial_entries").select("id").eq("customer_id", c.id).eq("year_month", prevMonth).limit(1);
    if (!fin?.length) signals.push(`先月(${prevMonth})の試算表が未入力`);
    const { data: pd } = await sb.from("pdca_items").select("title, due_date").eq("customer_id", c.id).neq("status", "done").lt("due_date", today).limit(3);
    for (const p of pd ?? []) signals.push(`課題「${p.title}」が期日超過`);
    const { data: mt } = await sb.from("meetings_scheduled").select("meet_at").eq("customer_id", c.id).eq("status", "scheduled")
      .gte("meet_at", now().toISOString()).lte("meet_at", daysAhead(3)).limit(1);
    if (mt?.length) signals.push(`${fmtDate(mt[0].meet_at)}にパートナーとの面談予定`);
    const { data: rp } = await sb.from("monthly_reports").select("report_month").eq("customer_id", c.id).eq("status", "published")
      .gte("published_at", daysAgo(7)).limit(1);
    if (rp?.length) signals.push(`新しい月次レポート(${rp[0].report_month})が届いている`);
    //  ご自分で書いた「やること」。今日のぶんと、過ぎてしまったぶん。
    //  書いた本人に読み上げるので、催促にならない言い方で添える。
    const todos = await openTodos(sb, c.id, today);
    for (const t of todos.slice(0, 4)) {
      signals.push(t.due_on < today
        ? `ご自分で書いた「${t.title}」が${t.due_on}の予定のまま`
        : `今日やると書いていた「${t.title}」`);
    }
    const agenda = await todayAgenda(sb, c.id, [c.id]);
    // 予定が入っている日は、シグナルが無くても朝のひとことを届ける
    if (!signals.length && !agenda.length) continue;

    const sys =
      "あなたは経営支援プラットフォーム「TsuguAi」のAIエージェント「継ナビくん」です。" +
      "経営者ご本人に向けた、朝のひとことを作ります。" +
      "ルール: お願いは1〜2個まで。忙しい経営者の負担にならない軽さで、労いから入る。" +
      "■ 書き方（スマホで読まれる）お願いが2つあるときは、あいだに1行あける。" +
      "1文は40字程度で切る。箇条書きの記号は「・」。詰まった文字の塊にしない。" +
      "今日の予定は、本文の前に別枠で必ず表示される。だから本文で予定を並べ直さない。" +
      "予定が詰まっている日は、お願いを1個に減らす。" +
      "予定が無い日に「予定はありません」と書き添える必要はない（別枠に出ているため）。" +
      "面談準備や数字の入力はアプリのどの画面でやるかを一言添える。判断に迷う内容は担当パートナーへの相談を促す。" +
      '出力は次のJSONのみ: {"title":"見出し(20字以内)","body":"本文(Markdown可・250字以内)"}';
    const tj = jstToday();
    const usr = `会社: ${c.company_name || ""}\n今日は${tj.label}です。\n`
      + (agenda.length ? `今日の予定:\n${agenda.map((a) => "- " + a).join("\n")}\n` : "")
      + (signals.length ? `\n今朝の状況:\n${signals.map((x) => "- " + x).join("\n")}` : "");
    const brief = await callClaudeJson(sys, usr, 700);
    if (!brief) continue;
    brief.body = agendaBlock(agenda) + brief.body;

    const { error: insErr } = await sb.from("agent_insights").insert({
      user_id: c.id, kind: "daily_brief",
      title: brief.title, body: brief.body,
      reason: [...signals, ...agenda.map((a) => "予定: " + a)].join(" / "), priority: signals.length ? 2 : 3,
    });
    if (!insErr) { made++; await deliver(sb, c.id, brief); }
  }
  return made;
}

// ---- 今週のナレッジ便り（毎週金曜）：パートナー間の知見共有をAIが編集 ----
async function knowledgeDigest(sb: any): Promise<number> {
  const jstDay = new Date(Date.now() + 9 * 3600 * 1000).getUTCDay();
  if (jstDay !== 5) return 0; // 金曜のみ

  const { data: items } = await sb
    .from("knowledge_items")
    .select("title, industry, theme, c1, c2, c3")
    .eq("status", "approved")
    .gte("created_at", daysAgo(7))
    .limit(10);
  if (!items?.length) return 0; // 新着がない週は送らない

  const sys =
    "あなたは経営支援プラットフォーム「TsuguAi」のAIエージェント「継ナビくん」です。" +
    "週に一度、全パートナーから今週投稿・承認されたナレッジ（実例）を紹介する「今週のナレッジ便り」を作ります。" +
    "書き方: 各実例を1〜2行で「何がうまくいったか・自分の顧客にどう活かせるか」の観点で紹介。" +
    "最後に「あなたの実例もナレッジ画面からぜひ投稿を」と一言添える。400字以内。" +
    '出力は次のJSONのみ: {"title":"見出し(20字以内)","body":"本文(Markdown可)"}';
  const brief = await callClaudeJson(sys, "今週の新着ナレッジ:\n" + JSON.stringify(items), 900);
  if (!brief) return 0;

  const { data: cons } = await sb.from("profiles").select("id").eq("role", "consultant").limit(30);
  let sent = 0;
  for (const p of cons ?? []) {
    const { data: dup } = await sb
      .from("agent_insights").select("id")
      .eq("user_id", p.id).eq("kind", "knowledge_digest")
      .gte("created_at", daysAgo(5)).limit(1);
    if (dup?.length) continue;
    const { error: insErr } = await sb.from("agent_insights").insert({
      user_id: p.id, kind: "knowledge_digest",
      title: brief.title, body: brief.body,
      reason: `今週承認されたナレッジ${items.length}件をAIが編集`, priority: 3,
    });
    if (!insErr) { sent++; await deliver(sb, p.id, brief); }
  }
  return sent;
}

// ---- 月次レポート先回りドラフト（月初1〜7日）----
// 先月の数字からコメント（所見）と冒頭のひとことの草案を作り、パートナーに届ける。
// monthly_reportsには書き込まず、承認フロー（下書き→人が仕上げて承認）は壊さない。
async function reportDrafts(sb: any, byPartner: Map<string, Set<string>>): Promise<number> {
  const jstNow = new Date(Date.now() + 9 * 3600 * 1000);
  if (jstNow.getUTCDate() > 7) return 0; // 月初のみ
  const prev = new Date(jstNow); prev.setUTCDate(1); prev.setUTCDate(0);
  const prevMonth = prev.toISOString().slice(0, 7);

  let drafted = 0;
  for (const [partnerId, customerSet] of byPartner) {
    for (const cid of customerSet) {
      if (drafted >= 15) return drafted; // 1回の実行で最大15件（コスト上限）

      // 同じ顧客の草案は月に1回まで
      const { data: dup } = await sb
        .from("agent_insights")
        .select("id")
        .eq("user_id", partnerId)
        .eq("customer_id", cid)
        .eq("kind", "report_draft")
        .gte("created_at", daysAgo(25))
        .limit(1);
      if (dup?.length) continue;

      // 先月を含む直近3ヶ月の数字。先月分が無い顧客はスキップ（草案の材料がない）
      const { data: fin } = await sb
        .from("financial_entries")
        .select("year_month, revenue, profit, memo")
        .eq("customer_id", cid)
        .order("year_month", { ascending: false })
        .limit(3);
      if (!fin?.length || fin[0].year_month !== prevMonth) continue;

      const { data: prof } = await sb.from("profiles").select("company_name").eq("id", cid).maybeSingle();
      const company = prof?.company_name || "（社名未設定）";

      const sys =
        "あなたは中小企業支援プラットフォーム「TsuguAi」のAIエージェント「継ナビくん」です。" +
        "パートナーが顧客に届ける月次レポートの草案（コメント欄に貼る「所見」と、冒頭の「ひとこと」）を用意します。" +
        "所見: 150〜250字。数字の動きと着眼点、来月に向けた一歩。データにある数字だけを使い、創作しない。" +
        "ひとこと: 120字以内。顧客への短い呼びかけ。" +
        "口調は誠実で温かく、パートナーがそのまま使える完成度に。" +
        '出力は次のJSONのみ: {"title":"◯◯社 ' + prevMonth + ' レポート草案 の形式","body":"**所見（コメント欄へ）**\\n…\\n\\n**ひとこと（冒頭へ）**\\n…"}';
      const usr = `会社: ${company}\n対象月: ${prevMonth}\n直近の試算表(新しい順): ${JSON.stringify(fin)}`;
      const brief = await callClaudeJson(sys, usr, 1000);
      if (!brief) continue;

      const { error: insErr } = await sb.from("agent_insights").insert({
        user_id: partnerId,
        customer_id: cid,
        kind: "report_draft",
        title: brief.title,
        body: brief.body,
        reason: `${prevMonth}の試算表が登録済みのため、月次レポートの草案を先回りで用意`,
        priority: 2,
      });
      if (!insErr) drafted++;
    }
  }
  return drafted;
}

// ---- M&Aクロスマッチング（毎週水曜）----
// 各パートナーのM&A案件と、Tsugu市場のオープン掲載（M&A）・他パートナーの案件を
// 匿名化した条件（種別・業種・金額）だけで突合し、有望な組み合わせを双方に知らせる。
async function maCrossMatch(sb: any, byPartner: Map<string, Set<string>>): Promise<number> {
  const jstDay = new Date(Date.now() + 9 * 3600 * 1000).getUTCDay();
  if (jstDay !== 3) return 0; // 水曜のみ

  const [{ data: deals }, { data: listings }] = await Promise.all([
    sb.from("ma_deals").select("id, customer_id, deal_type, stage, expected_price, target_date").order("updated_at", { ascending: false }).limit(50),
    sb.from("market_listings").select("id, side, kind, title, industry, amount").eq("status", "open").eq("kind", "mna").limit(50),
  ]);
  if (!deals?.length) return 0;

  // 顧客 → 担当パートナー
  const partnersOf = new Map<string, Set<string>>();
  for (const [pid, custs] of byPartner) for (const cid of custs) {
    if (!partnersOf.has(cid)) partnersOf.set(cid, new Set());
    partnersOf.get(cid)!.add(pid);
  }

  let notified = 0;
  for (const [partnerId, customerSet] of byPartner) {
    const mine = (deals ?? []).filter((d: any) => customerSet.has(d.customer_id));
    if (!mine.length) continue;

    const { data: dup } = await sb
      .from("agent_insights")
      .select("id")
      .eq("user_id", partnerId)
      .eq("kind", "ma_match")
      .gte("created_at", daysAgo(5))
      .limit(1);
    if (dup?.length) continue;

    // 突合対象: 市場のオープン掲載 + 他パートナーの案件（匿名化: 種別・金額のみ）
    const others = (deals ?? [])
      .filter((d: any) => !customerSet.has(d.customer_id))
      .map((d: any) => ({ 種別: d.deal_type, 金額目安: d.expected_price, 出所: "他パートナー案件" }));
    const market = (listings ?? []).map((l: any) => ({ 種別: l.side === "raise" ? "譲渡（売り）" : "譲受（買い）", 業種: l.industry, 金額: l.amount, 表題: l.title, 出所: "Tsugu市場" }));
    if (!others.length && !market.length) continue;

    const sys =
      "あなたは中小企業支援プラットフォーム「TsuguAi」のAIエージェント「継ナビくん」です。" +
      "週に一度の「M&Aクロスマッチング」として、パートナーの担当案件と、プラットフォーム内の他の案件・掲載との有望な組み合わせを探します。" +
      "判断基準: 譲渡と譲受の向きが噛み合う・金額帯が近い（±50%目安）・業種の親和性。無理にマッチを作らない。有望なものが無ければ candidates を空配列に。" +
      "個社が特定できる情報は書かない。次の一歩は「M&A案件画面から運営に照会」を案内する。" +
      '出力は次のJSONのみ: {"title":"見出し(20字以内)","body":"本文(Markdown可・400字以内。有望な組み合わせと理由、無ければその旨)","candidates":["組み合わせの短い説明", ...]}';
    const usr = `担当案件: ${JSON.stringify(mine.map((d: any) => ({ 種別: d.deal_type, 進捗stage: d.stage, 金額目安: d.expected_price, 目標日: d.target_date })))}\n` +
      `突合対象: ${JSON.stringify([...market, ...others].slice(0, 40))}`;
    const brief: any = await callClaudeJson(sys, usr, 1000);
    if (!brief || !Array.isArray(brief.candidates) || !brief.candidates.length) continue; // マッチ無しなら通知しない

    const { error: insErr } = await sb.from("agent_insights").insert({
      user_id: partnerId,
      kind: "ma_match",
      title: brief.title,
      body: brief.body,
      reason: `担当${mine.length}案件 × 市場掲載${market.length}件・他案件${others.length}件を突合`,
      priority: 2,
    });
    if (!insErr) {
      notified++;
      await deliver(sb, partnerId, brief);
    }
  }
  return notified;
}

// ---- 新人パートナー指南モード：「経験」をプラットフォームが供給する ----
// 対象: 担当顧客が0社、または研修が未修了のパートナー。
// 研修進捗と現状から「今週の一歩」を具体的に示す。頻度は3日に1回まで。
const TOTAL_LESSONS = 10; // 研修プログラムは全4章10レッスン（manual-partner.htmlと同期）
async function mentorNewPartners(sb: any, byPartner: Map<string, Set<string>>): Promise<number> {
  const { data: consultants } = await sb.from("profiles").select("id, contact_name, company_name").eq("role", "consultant");
  if (!consultants?.length) return 0;

  const ids = consultants.map((c: any) => c.id);
  const { data: prog } = await sb.from("training_progress").select("user_id, lesson_id").in("user_id", ids);
  const doneOf = new Map<string, number>();
  for (const t of prog ?? []) doneOf.set(t.user_id, (doneOf.get(t.user_id) ?? 0) + 1);

  let mentored = 0;
  for (const c of consultants.slice(0, 20)) { // 1回の実行で最大20名（コスト上限）
    const clients = byPartner.get(c.id)?.size ?? 0;
    const done = doneOf.get(c.id) ?? 0;
    const isNewbie = clients === 0 || done < TOTAL_LESSONS;
    if (!isNewbie) continue;

    const { data: dup } = await sb
      .from("agent_insights")
      .select("id")
      .eq("user_id", c.id)
      .eq("kind", "mentor")
      .gte("created_at", daysAgo(3))
      .limit(1);
    if (dup?.length) continue;

    const brief = await composeMentorBrief({ name: c.contact_name || c.company_name || "", clients, done });
    if (!brief) continue;

    const { error: insErr } = await sb.from("agent_insights").insert({
      user_id: c.id,
      kind: "mentor",
      title: brief.title,
      body: brief.body,
      reason: `研修${done}/${TOTAL_LESSONS}レッスン修了・担当顧客${clients}社のため、次の一歩を提案`,
      priority: 3,
    });
    if (!insErr) {
      mentored++;
      await deliver(sb, c.id, brief);
    }
  }
  return mentored;
}

async function composeMentorBrief(p: { name: string; clients: number; done: number }): Promise<{ title: string; body: string } | null> {
  const sys =
    "あなたは中小企業支援プラットフォーム「TsuguAi」のAIエージェント「継ナビくん」です。" +
    "今は指南モード：経験の浅い認定パートナーの先輩役として、次の一歩を具体的に示します。" +
    "TsuguAiでの立ち上がりの標準ルート: ①研修プログラム（全4章10レッスン）修了 → ②営業ツール「課題ヒアリング診断」で見込み客と商談 → ③顧客を登録し担当に → ④初回面談（前日に面談準備ブリーフが届く）→ ⑤導入90日プログラムで成果物を約束 → ⑥毎月の試算表取り込みと月次レポート承認。" +
    "書き方: ①いまの到達点をひとこと承認 ②今週の一歩（1〜3個。画面名・機能名つきで具体的に）③励ましをひとこと。教科書口調にせず、隣の先輩のように。250字以内。" +
    '出力は次のJSONのみ: {"title":"見出し(20字以内)","body":"本文(Markdown可)"}';
  const usr = `パートナー: ${p.name || "（新規）"}\n研修の修了: ${p.done}/${TOTAL_LESSONS}レッスン\n担当顧客: ${p.clients}社`;
  return await callClaudeJson(sys, usr, 800);
}

// ---- 承継シグナル・レーダー（毎週月曜）：承継の窓が開いた顧客を検知 ----
async function successionRadar(sb: any, byPartner: Map<string, Set<string>>): Promise<number> {
  const jstDay = new Date(Date.now() + 9 * 3600 * 1000).getUTCDay();
  if (jstDay !== 1) return 0; // 月曜のみ

  let count = 0;
  for (const [partnerId, customerSet] of byPartner) {
    const customerIds = [...customerSet];

    const { data: dup } = await sb
      .from("agent_insights")
      .select("id")
      .eq("user_id", partnerId)
      .eq("kind", "succession")
      .gte("created_at", daysAgo(5))
      .limit(1);
    if (dup?.length) continue;

    // 社名
    const names = new Map<string, string>();
    {
      const { data } = await sb.from("profiles").select("id, company_name").in("id", customerIds);
      for (const p of data ?? []) names.set(p.id, p.company_name || "（社名未設定）");
    }
    // 承継チェックの実施状況
    const { data: checks } = await sb.from("succession_checks").select("customer_id, updated_at").in("customer_id", customerIds);
    const checkOf = new Map<string, string>();
    for (const s of checks ?? []) checkOf.set(s.customer_id, s.updated_at);
    // 株価評価の最終実施
    const { data: vals } = await sb.from("valuation_snapshots").select("customer_id, created_at").in("customer_id", customerIds).order("created_at", { ascending: false });
    const valOf = new Map<string, string>();
    for (const v of vals ?? []) if (!valOf.has(v.customer_id)) valOf.set(v.customer_id, v.created_at);

    const findings: string[] = [];
    for (const cid of customerIds) {
      const nm = names.get(cid) ?? "担当顧客";
      const chk = checkOf.get(cid);
      const val = valOf.get(cid);
      if (!chk) findings.push(`${nm}: 承継準備チェックが未実施`);
      else if (new Date(chk).getTime() < Date.now() - 365 * DAY) findings.push(`${nm}: 承継チェックが1年以上更新されていない`);
      if (!val) findings.push(`${nm}: 株価（自社株評価）のシミュレーションが未実施`);
      else if (new Date(val).getTime() < Date.now() - 180 * DAY) findings.push(`${nm}: 株価評価が半年以上前。決算をまたいでいれば再評価を`);
    }
    if (!findings.length) continue;

    const sys =
      "あなたは中小企業支援プラットフォーム「TsuguAi」のAIエージェント「継ナビくん」です。" +
      "週に一度の「承継シグナル・レーダー」として、事業承継の準備が手つかず・停滞している顧客をパートナーに知らせます。" +
      "書き方: 検出結果を顧客ごとに整理し、それぞれ「最初の声のかけ方」を一言添える。使える道具（承継準備チェック、事業承継・株対策シミュレーター、退職金シミュレーター）への誘導を含める。押し付けない。500字以内。" +
      '出力は次のJSONのみ: {"title":"見出し(20字以内)","body":"本文(Markdown可)"}';
    const brief = await callClaudeJson(sys, "今週の検出:\n" + findings.slice(0, 10).map((f) => "- " + f).join("\n"), 1000);
    if (!brief) continue;

    const { error: insErr } = await sb.from("agent_insights").insert({
      user_id: partnerId,
      kind: "succession",
      title: brief.title,
      body: brief.body,
      reason: findings.slice(0, 6).join(" / "),
      priority: 3,
    });
    if (!insErr) {
      count++;
      await deliver(sb, partnerId, brief);
    }
  }
  return count;
}

// Claude呼び出しの共通部（JSON応答を期待するもの）
// 書式ルールを全生成に共通で適用する：配信先（メール・LINE・アプリ内）の
// 表示は太字と箇条書きのみ対応のため、重いMarkdownは使わせない。
const STYLE_RULE =
  " 本文の書式ルール: 使ってよいのは太字(**文字**)と箇条書き(行頭の「- 」)と改行のみ。" +
  "見出し記号(#)、罫線(---)、引用(>)、表、コードブロックは使わない。絵文字は控えめに。";
async function callClaudeJson(sys: string, usr: string, maxTokens: number): Promise<{ title: string; body: string } | null> {
  sys = sys + STYLE_RULE;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: maxTokens, system: sys, messages: [{ role: "user", content: usr }] }),
  });
  if (!res.ok) { console.error("claude api failed:", res.status); return null; }
  const data = await res.json();
  const text = data?.content?.[0]?.text ?? "";
  try {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch { return null; }
}

// ---- 面談前ブリーフ：前日〜当日の面談に向けて、その顧客の全体像を1枚に ----
async function prepareMeetingBriefs(sb: any, byPartner: Map<string, Set<string>>): Promise<number> {
  // 顧客 → 担当パートナーの逆引き
  const partnersOf = new Map<string, Set<string>>();
  for (const [pid, custs] of byPartner) {
    for (const cid of custs) {
      if (!partnersOf.has(cid)) partnersOf.set(cid, new Set());
      partnersOf.get(cid)!.add(pid);
    }
  }
  const customerIds = [...partnersOf.keys()];
  if (!customerIds.length) return 0;

  const { data: meetings } = await sb
    .from("meetings_scheduled")
    .select("customer_id, meet_at, place")
    .eq("status", "scheduled")
    .in("customer_id", customerIds)
    .gte("meet_at", now().toISOString())
    .lte("meet_at", daysAhead(2));

  let briefed = 0;
  for (const m of (meetings ?? []).slice(0, 10)) { // 1回の実行で最大10件（コスト上限）
    for (const partnerId of partnersOf.get(m.customer_id) ?? []) {
      // 同じ顧客への準備ブリーフは1.5日以内に1回まで（毎朝の重複を防ぐ）
      const { data: dup } = await sb
        .from("agent_insights")
        .select("id")
        .eq("user_id", partnerId)
        .eq("customer_id", m.customer_id)
        .eq("kind", "meeting_prep")
        .gte("created_at", daysAgo(1.5))
        .limit(1);
      if (dup?.length) continue;

      const ctx = await collectCustomerContext(sb, m.customer_id);
      const brief = await composeMeetingBrief(ctx, m);
      if (!brief) continue;

      const { error: insErr } = await sb.from("agent_insights").insert({
        user_id: partnerId,
        customer_id: m.customer_id,
        kind: "meeting_prep",
        title: brief.title,
        body: brief.body,
        reason: `${fmtDate(m.meet_at)}に面談予定のため、直近の数字・課題・前回記録から自動生成`,
        priority: 1,
      });
      if (!insErr) {
        briefed++;
        await deliver(sb, partnerId, brief);
      }
    }
  }
  return briefed;
}

// 顧客1社の「今」をテーブル横断で集める（面談準備の材料）
async function collectCustomerContext(sb: any, customerId: string) {
  const [prof, fin, cash, pdca, note] = await Promise.all([
    sb.from("profiles").select("company_name, stage").eq("id", customerId).maybeSingle(),
    sb.from("financial_entries").select("year_month, revenue, profit, memo").eq("customer_id", customerId).order("year_month", { ascending: false }).limit(3),
    sb.from("cashflow_snapshots").select("cash, monthly_in, monthly_out, monthly_repay, score, created_at").eq("customer_id", customerId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("pdca_items").select("title, due_date, status").eq("customer_id", customerId).neq("status", "done").order("due_date", { ascending: true }).limit(6),
    sb.from("meeting_notes").select("meeting_date, title, summary, todos").eq("customer_id", customerId).order("meeting_date", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return {
    company: prof?.data?.company_name ?? "（社名未設定）",
    stage: prof?.data?.stage ?? null,
    finance: fin?.data ?? [],
    cashflow: cash?.data ?? null,
    openIssues: pdca?.data ?? [],
    lastMeeting: note?.data ?? null,
  };
}

async function composeMeetingBrief(ctx: any, meeting: { meet_at: string; place?: string }): Promise<{ title: string; body: string } | null> {
  const sys =
    "あなたは中小企業支援プラットフォーム「TsuguAi」のAIエージェント「継ナビくん」です。" +
    "認定パートナーが顧客との面談に自信を持って臨めるよう、面談準備ブリーフを1枚にまとめます。" +
    "構成: ①会社の今（数字の要点を2〜3行。データがあれば前月比・傾向に言及）②前回からの宿題・未完了課題（確認すべきもの）③今回話すべきテーマ3つ（理由つき）④想定される質問と答えの方向性1〜2個⑤冒頭の一言（そのまま使える台詞）。" +
    "データが無い項目は無理に埋めず飛ばす。断定しすぎない。数字はデータにあるものだけ使い、創作しない。" +
    '出力は次のJSONのみ: {"title":"◯◯社 面談準備（M/D）の形式","body":"本文(Markdown可・900字以内)"}';
  const usr =
    `面談: ${fmtDate(meeting.meet_at)} ${meeting.place ? "＠" + meeting.place : ""}\n` +
    `会社: ${ctx.company}\n` +
    `直近の試算表(新しい順): ${JSON.stringify(ctx.finance)}\n` +
    `資金繰り最新: ${JSON.stringify(ctx.cashflow)}\n` +
    `未完了の課題: ${JSON.stringify(ctx.openIssues)}\n` +
    `前回の面談記録: ${JSON.stringify(ctx.lastMeeting)}`;
  return await callClaudeJson(sys, usr, 1600);
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
  // LINE（Messaging API）
  if (LINE_TOKEN) {
    try {
      const { data: link } = await sb.from("line_links").select("line_user_id").eq("user_id", partnerId).maybeSingle();
      if (link?.line_user_id) {
        const res = await fetch("https://api.line.me/v2/bot/message/push", {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: `Bearer ${LINE_TOKEN}` },
          body: JSON.stringify({
            to: link.line_user_id,
            messages: [{
              type: "text",
              text: `✦ ${brief.title}\n\n${excerpt(brief.body, 1400)}\n\nアプリで詳しく → ${APP_URL}`,
            }],
          }),
        });
        if (!res.ok) console.error("line push failed:", res.status, await res.text());
      }
    } catch (e) { console.error("line failed:", e); }
  }
}

//  LINE や通知に出す用に、飾り記号を落として素の文にする。
//   空行は残す。ここで潰すと、段落の切れ目が消えて一続きの文字の壁になり、
//   スマホでは読まれない。実際そうなっていた。3行以上の空きだけ2行に詰める。
function excerpt(t: string, n: number) {
  const plain = (t || "")
    .replace(/^#{1,4}\s*/gm, "").replace(/^>\s*/gm, "").replace(/^(-{3,}|\*{3,})$/gm, "")
    .replace(/\*\*/g, "")
    .replace(/^[-*]\s+/gm, "・")      // 箇条書きの記号をそろえる（メール側と同じ形に）
    .replace(/[ \t]+$/gm, "")        // 行末の余白だけ落とす
    .replace(/\n{3,}/g, "\n\n")      // 空きすぎだけ詰める（1行の空きは残す）
    .trim();
  if (plain.length <= n) return plain;
  //  途中でぶつ切りにせず、直前の段落の切れ目で終える
  const cut = plain.slice(0, n);
  const at = cut.lastIndexOf("\n\n");
  return (at > n * 0.5 ? cut.slice(0, at) : cut) + "\n…（続きはアプリで）";
}

function emailHtml(brief: { title: string; body: string }) {
  // 万一Markdown記号が混ざっても崩れないよう、表示側でも綺麗に変換する
  const body = (brief.body || "")
    .split("\n")
    .map((line) => {
      let l = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").trim();
      if (/^(-{3,}|\*{3,}|─{3,})$/.test(l)) return '<div style="border-top:1px solid #E2E7EF;margin:10px 0;"></div>';
      l = l.replace(/^&gt;\s*/, "");                    // 引用記号は外す
      const heading = /^#{1,4}\s*(.+)$/.exec(l);
      if (heading) l = `<b style="color:#1E3A66;">${heading[1]}</b>`;
      l = l.replace(/^-\s+/, "・").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
      return l;
    })
    .join("<br>")
    .replace(/(<br>){3,}/g, "<br><br>")
    //  区切り線の前後の改行を吸わせる。残すと線のまわりが空きすぎて、
    //  かえって「何も無い場所」に見える。線自体も薄すぎたので少し濃くする。
    .replace(/(?:<br>)*<div style="border-top:[^"]*"><\/div>(?:<br>)*/g,
             '<div style="border-top:1px solid #D8E0EC;margin:14px 0;"></div>');
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

  // 4-2) まだ返信していないやり取り
  //   画面のバッジは、スレッドを開いた時点で消える（読む作業を軽くするため）。
  //   その代わり、返信していないものは毎朝ここで拾って便りに載せる。
  //   「この件は一区切り」を押した相手は、そこから先に新しいメッセージが
  //   来ていなければ蒸し返さない。会話はこちらが送って終わるとは限らない。
  {
    const { data: last } = await sb
      .from("chat_messages")
      .select("customer_id, sender_role, created_at")
      .in("customer_id", customerIds)
      .gte("created_at", daysAgo(60))
      .order("created_at", { ascending: false });
    const { data: closed } = await sb
      .from("chat_threads")
      .select("customer_id, closed_at")
      .in("customer_id", customerIds);
    const closedAt = new Map<string, number>();
    for (const c of closed ?? []) {
      if (c.closed_at) closedAt.set(c.customer_id, new Date(c.closed_at).getTime());
    }
    const seen = new Set<string>();
    for (const m of last ?? []) {
      if (seen.has(m.customer_id)) continue;   // 顧客ごとの最新1件だけを見る
      seen.add(m.customer_id);
      if (m.sender_role !== "customer") continue;
      const t = new Date(m.created_at).getTime();
      if ((closedAt.get(m.customer_id) ?? 0) >= t) continue;   // 一区切り済み
      const days = Math.floor((Date.now() - t) / DAY);
      signals.push({
        customer: nm(m.customer_id),
        kind: "unreplied",
        fact: days >= 1
          ? `${nm(m.customer_id)}からのメッセージに、まだ返信していない（${days}日前）`
          : `${nm(m.customer_id)}からメッセージが届いていて、まだ返信していない`,
        priority: days >= 2 ? 1 : 2,
      });
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

  // 5.5) 経営者ご本人が書いた「やること」
  //   全部を並べるとただのTODO一覧になって読まれなくなるので、
  //   優先度が高いものと、期日を過ぎたものだけを拾う（openTodosForCustomers 側で絞る）。
  //   こちらから片づけるものではなく、声をかける手がかりとして渡す。
  {
    const today = jstToday().date;
    const todos = await openTodosForCustomers(sb, customerIds, today);
    for (const t of todos.slice(0, 5)) {
      const late = t.due_on < today;
      signals.push({
        customer: nm(t.customer_id),
        kind: "cust_todo",
        fact: late
          ? `${nm(t.customer_id)}がご自分で書いた「${t.title}」が${t.due_on}のまま残っている`
          : `${nm(t.customer_id)}が今日やると書いている「${t.title}」（優先度：高）`,
        priority: late ? 2 : 3,
      });
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
async function composeBrief(signals: Signal[], agenda: string[] = []): Promise<{ title: string; body: string } | null> {
  const sys =
    "あなたは中小企業支援プラットフォーム「TsuguAi」の、認定パートナーを支えるAIエージェント「継ナビくん」です。" +
    "親しみやすく、頼れる相棒として振る舞います（ただし馴れ馴れしくしない）。" +
    "毎朝、担当顧客の状況シグナルから「今日の一手」ブリーフを作ります。" +
    "ルール: 最重要の3件までに絞る。各件は必ず①顧客名②なぜ今日か（根拠）③最初の一言（そのまま送れる短い文面案）の3点で書く。" +
    "■ 書き方（スマホの通知で読まれる。詰まった文字の塊にしない）" +
    "・件と件のあいだは必ず1行あける。" +
    "・各件はこの形にそろえる。1行目に見出し、次の行に理由、最後に2行。" +
    "　1) ① 顧客名｜ひとことの見出し（20字以内）" +
    "　2) なぜ今日かを1〜2文。長くしない。" +
    "　3) ・いつ動くか：（時間帯）" +
    "　4) ・最初の一言：「そのまま送れる文面」" +
    "・箇条書きの記号は「・」を使う。番号や記号を混ぜない。" +
    "・1文は40字程度で切る。読点でつなげ続けない。" +
    "今日の予定は、本文の前に別枠で必ず表示される。だから本文で予定を並べ直さない。" +
    "予定があるときは、その時間を踏まえて、いつ動くのが現実的かを添える。" +
    "予定が無い日に「予定はありません」と書き添える必要はない（別枠に出ているため）。" +
    "断定しすぎない。押し付けない。敬意のある簡潔な日本語。" +
    '出力は次のJSONのみ: {"title":"見出し(20字以内)","body":"本文(Markdown可・600字以内)"}';
  const t = jstToday();
  const usr = `今日は${t.label}です。\n`
    + (agenda.length ? `今日の予定:\n${agenda.map((a) => "- " + a).join("\n")}\n\n` : "")
    + (signals.length ? "今朝のシグナル:\n" + signals.map((s) => `- [優先${s.priority}] ${s.fact}`).join("\n") : "特筆すべきシグナルはありません。");
  return await callClaudeJson(sys, usr, 1200);
}

// ---- 本文の頭に置く「本日の予定」の枠 ----
//  予定が無い日も必ず出す。毎朝おなじ場所に同じ形であることに意味がある。
//    ・「なし」は、カレンダーを見に行って空だった、という報告になる
//      （届いていない・壊れている、と区別がつく）
//    ・入れ忘れに気づける。「あるはずだが」と思えるのは、出ているときだけ
//  ただしAIの文章には書かせない。日によって言い回しが変わると、
//  読み手が「毎朝ここを見る」癖をつけられないため、こちらで組み立てる。
function agendaBlock(agenda: string[]): string {
  //  LINEでは ** が落ちるため、【】そのもので見出しと分かるようにする。
  //  区切り線は、予定と本題のあいだに視線の切れ目を作るためのもの。
  const head = "**【本日の予定】**\n";
  if (!agenda.length) return "**【本日の予定】**　なし\n\n────────────\n\n";
  return head + agenda.map((a) => "・" + a).join("\n") + "\n\n────────────\n\n";
}

// ---- 今日の予定（継ナビくんのカレンダー＋面談）----
//  ブリーフの冒頭に「今日は何があるか」を置く。予定を知らないまま
//  「今日の一手」を語っても、相手の一日と噛み合わないため。
//  日付の境目は日本時間で切る（サーバーはUTCで動いている）。
function jstToday(): { from: string; to: string; label: string; date: string } {
  const j = new Date(Date.now() + 9 * 3600000);
  const y = j.getUTCFullYear(), m = j.getUTCMonth(), d = j.getUTCDate();
  const startUtc = Date.UTC(y, m, d) - 9 * 3600000;
  const w = "日月火水木金土"[new Date(Date.UTC(y, m, d)).getUTCDay()];
  return {
    from: new Date(startUtc).toISOString(),
    to: new Date(startUtc + 24 * 3600000).toISOString(),
    label: `${m + 1}月${d}日（${w}）`,
    //  日付そのもの（YYYY-MM-DD）。期日の比較は必ずこちらを使うこと。
    //  この関数は 6:00 JST（＝21:00 UTC）に走るので、UTCで日付を取ると
    //  前日になってしまう。
    date: j.toISOString().slice(0, 10),
  };
}
function fmtTimeJst(iso: string) {
  const j = new Date(new Date(iso).getTime() + 9 * 3600000);
  return `${String(j.getUTCHours()).padStart(2, "0")}:${String(j.getUTCMinutes()).padStart(2, "0")}`;
}
//  経営者ご本人が書いた「やること」のうち、まだ済んでいないもの。
//  今日までのぶんだけを拾う（明後日の予定を今朝せかす理由はない）。
//  表が未作成の環境でも黙って空を返す。
type OpenTodo = { customer_id: string; title: string; due_on: string; priority: number };
async function openTodos(sb: any, customerId: string, today: string, limit = 6): Promise<OpenTodo[]> {
  try {
    const { data, error } = await sb.from("customer_todos")
      .select("customer_id, title, due_on, priority")
      .eq("customer_id", customerId).is("done_at", null).lte("due_on", today)
      .order("priority", { ascending: true }).order("due_on", { ascending: true }).limit(limit);
    if (error) return [];
    return (data ?? []) as OpenTodo[];
  } catch { return []; }
}
//  担当顧客ぶんをまとめて。パートナーには「優先度が高い」か「期日を過ぎた」
//  ものだけを渡す。全部を並べると、毎朝ただのTODO一覧になって読まれなくなる。
async function openTodosForCustomers(sb: any, customerIds: string[], today: string): Promise<OpenTodo[]> {
  if (!customerIds.length) return [];
  try {
    const { data, error } = await sb.from("customer_todos")
      .select("customer_id, title, due_on, priority")
      .in("customer_id", customerIds).is("done_at", null).lte("due_on", today)
      .order("priority", { ascending: true }).order("due_on", { ascending: true }).limit(40);
    if (error) return [];
    return ((data ?? []) as OpenTodo[]).filter((t) => t.priority === 1 || t.due_on < today);
  } catch { return []; }
}
async function todayAgenda(sb: any, ownerId: string, customerIds?: string[]): Promise<string[]> {
  const { from, to } = jstToday();
  const rows: { t: number; s: string }[] = [];
  try {
    const { data: ev } = await sb
      .from("agenda_events")
      .select("title, starts_at, all_day, place")
      .eq("owner_id", ownerId)
      .gte("starts_at", from).lt("starts_at", to)
      .order("starts_at", { ascending: true }).limit(12);
    for (const e of ev ?? []) {
      rows.push({
        t: new Date(e.starts_at).getTime(),
        s: `${e.all_day ? "終日" : fmtTimeJst(e.starts_at)} ${e.title ?? "予定"}${e.place ? `（${e.place}）` : ""}`,
      });
    }
  } catch { /* 表が無い環境でも止めない */ }
  if (customerIds?.length) {
    try {
      const names = new Map<string, string>();
      const { data: ps } = await sb.from("profiles").select("id, company_name").in("id", customerIds);
      for (const p of ps ?? []) names.set(p.id, p.company_name || "顧客");
      const { data: mt } = await sb
        .from("meetings_scheduled")
        .select("customer_id, meet_at, place")
        .eq("status", "scheduled").in("customer_id", customerIds)
        .gte("meet_at", from).lt("meet_at", to)
        .order("meet_at", { ascending: true }).limit(12);
      for (const m of mt ?? []) {
        rows.push({
          t: new Date(m.meet_at).getTime(),
          s: `${fmtTimeJst(m.meet_at)} ${names.get(m.customer_id) ?? "顧客"}との面談${m.place ? `（${m.place}）` : ""}`,
        });
      }
    } catch { /* 同上 */ }
  }
  rows.sort((a, b) => a.t - b.t);
  return rows.map((r) => r.s);
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

