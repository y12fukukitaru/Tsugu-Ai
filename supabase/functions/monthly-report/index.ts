// =====================================================================
// TsuguAi -継- Phase 32：月次レポート自動生成（Supabase Edge Function）
// 毎月1日に実行：
//  ・財務データのある全顧客について、前月分のレポート下書きを生成
//  ・売上・利益・推移を集計し、Anthropic APIでコメント下書きを作成
//  ・パートナーへ「承認待ちレポートがあります」とメール通知
//  ・財務データ未入力の顧客は運営へ報告
// テスト：?dry=1 で書き込み・送信なしの確認 / ?month=YYYY-MM で対象月指定
//
// ※ この関数は長らく Supabase 側にしか無く、履歴が残っていなかった。
//    誰がいつ何を変えたか分からないと、送り先や文面を直すたびに
//    「いま動いているもの」を読みに行くしかなくなるため、ここに置く。
//    差出人名は Secret の REMINDER_FROM が決めている（MAIL_FROM ではない）。
//    daily-reminder も同じ Secret を読むので、名乗りを変えるときは
//    REMINDER_FROM のほうを直せば両方が揃う。
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

// ---- 名乗り ----
//  件名の頭と本文の末尾で同じ名前を使う。散らばっていると、次に屋号を
//  変えたときに片方だけ古いまま残る。一箇所に置いて両方から参照する。
const BRAND = 'TsuguAi -継-';

Deno.serve(async (req) => {
  // ---- 認可 ----
  const secret = Deno.env.get('CRON_SECRET') || '';
  const url = new URL(req.url);
  const given = req.headers.get('x-cron-secret') || url.searchParams.get('secret') || '';
  if (!secret || given !== secret) return json({ error: 'unauthorized' }, 401);

  const dry = url.searchParams.get('dry') === '1';

  // ---- 対象月（既定：日本時間での「前月」）----
  const target = url.searchParams.get('month') || prevMonthJST();
  if (!/^\d{4}-\d{2}$/.test(target)) return json({ error: 'month は YYYY-MM 形式で指定してください' }, 400);

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ---- データ取得 ----
  const [profs, fins, existing] = await Promise.all([
    sb.from('profiles').select('id,email,role,company_name,contact_name,consultant_id'),
    sb.from('financial_entries').select('customer_id,year_month,revenue,profit')
      .order('year_month', { ascending: true }),
    sb.from('monthly_reports').select('id,customer_id,status').eq('report_month', target),
  ]);
  if (profs.error) return json({ error: profs.error.message }, 500);
  if (existing.error) return json({ error: '月次レポートテーブルが見つかりません。Phase 32のSQLを先に実行してください：' + existing.error.message }, 500);

  const rows = profs.data || [];
  const customers = rows.filter((r) => r.role === 'customer');
  const consultants = rows.filter((r) => r.role === 'consultant');
  const admins = rows.filter((r) => r.role === 'admin');
  const nameOf = (c: any) => c.company_name || c.contact_name || c.email;

  const finBy: Record<string, any[]> = {};
  for (const f of (fins.data || [])) {
    (finBy[f.customer_id] = finBy[f.customer_id] || []).push(f);
  }
  const exMap: Record<string, any> = {};
  for (const e of (existing.data || [])) exMap[e.customer_id] = e;

  const created: any[] = [];
  const skippedNoData: any[] = [];
  const skippedPublished: any[] = [];

  for (const c of customers) {
    const fin = finBy[c.id] || [];
    if (!fin.length) { skippedNoData.push(nameOf(c)); continue; }
    if (exMap[c.id] && exMap[c.id].status === 'published') { skippedPublished.push(nameOf(c)); continue; }

    // ---- 数値サマリーの組み立て ----
    const history = fin.slice(-12).map((f) => ({
      ym: f.year_month, revenue: f.revenue, profit: f.profit,
    }));
    const cur = fin.find((f) => f.year_month === target) || null;
    const prev = fin.find((f) => f.year_month === prevOf(target)) || null;
    const valuation = calcValuation(fin.slice(-12));
    const summary = {
      month: target,
      revenue: cur ? cur.revenue : null,
      profit: cur ? cur.profit : null,
      prev_revenue: prev ? prev.revenue : null,
      prev_profit: prev ? prev.profit : null,
      has_current: !!cur,
      history,
      valuation,
    };

    // ---- AI分析下書き（コメント＋SWOT＋市場ポジション） ----
    let comment: string;
    let analysis: any = null;
    if (dry) {
      comment = '（dryモードのためAI分析は未生成）';
    } else {
      const a = await genAnalysis(nameOf(c), target, summary);
      comment = a.comment;
      analysis = a.analysis;
    }

    if (!dry) {
      if (exMap[c.id]) {
        const u = await sb.from('monthly_reports')
          .update({ summary, ai_comment: comment, analysis })
          .eq('id', exMap[c.id].id);
        if (u.error) return json({ error: u.error.message }, 500);
      } else {
        const i = await sb.from('monthly_reports')
          .insert({ customer_id: c.id, report_month: target, summary, ai_comment: comment, analysis, status: 'draft' });
        if (i.error) return json({ error: i.error.message }, 500);
      }
    }
    created.push({ customer: nameOf(c), consultant_id: c.consultant_id, has_current: !!cur });
  }

  // ---- パートナーへの通知メール ----
  const appUrl = Deno.env.get('APP_URL') || 'https://y12fukukitaru.github.io/Tsugu-Ai/';
  const mails: { to: string; subject: string; body: string }[] = [];
  for (const f of consultants) {
    if (!f.email) continue;
    const mine = created.filter((r) => r.consultant_id === f.id);
    if (!mine.length) continue;
    const lines = mine.map((r) =>
      `■ ${r.customer}` + (r.has_current ? '' : '（対象月の試算表が未入力のため、過去データのみで作成）')
    );
    mails.push({
      to: f.email,
      subject: `【${BRAND}】${ymLabel(target)}分の月次レポート下書き ${mine.length}件`,
      body:
        `${ymLabel(target)}分の月次レポート下書きを作成しました。\n` +
        `プラットフォームの「レポート承認」からコメントを確認・編集し、「承認して公開」を押すと顧客の画面に表示されます。\n\n` +
        `${lines.join('\n')}\n\n${appUrl}\n\n— ${BRAND} 自動レポート`,
    });
  }
  // ---- 運営への報告 ----
  if (admins.length && (created.length || skippedNoData.length)) {
    const body =
      `${ymLabel(target)}分の月次レポート自動生成の結果です。\n\n` +
      `作成：${created.length}件\n` +
      (skippedPublished.length ? `公開済みのためスキップ：${skippedPublished.join('、')}\n` : '') +
      (skippedNoData.length ? `財務データ未入力のため未作成：${skippedNoData.join('、')}\n` : '') +
      `\n${appUrl}\n\n— ${BRAND} 自動レポート`;
    for (const a of admins) {
      if (a.email) mails.push({ to: a.email, subject: `【${BRAND} 運営】月次レポート生成結果（${ymLabel(target)}分）`, body });
    }
  }

  if (dry) return json({ dry: true, target, would_create: created, skipped_no_data: skippedNoData, skipped_published: skippedPublished, mails });

  // ---- メール送信（Resend）----
  const key = Deno.env.get('RESEND_API_KEY');
  //  実際に届く差出人名は Secret の REMINDER_FROM が決める。ここは未設定時の
  //  控えなので、Secret を直さないと受信箱の名前は変わらない。
  const from = Deno.env.get('REMINDER_FROM') || `${BRAND} <onboarding@resend.dev>`;
  const sent: any[] = [];
  if (key) {
    for (const m of mails) {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.body }),
        });
        sent.push({ to: m.to, ok: r.ok, status: r.status });
      } catch (e) {
        sent.push({ to: m.to, ok: false, error: String(e) });
      }
    }
  }
  return json({ target, created: created.length, skipped_no_data: skippedNoData.length, mails_sent: sent });
});

// ---- 企業価値の簡易試算（確定計算・AIは使わない） ----
// 直近12ヶ月の売上・利益から、中小M&A実務の2軸でレンジを出す
//  ・年買法（簡易）：営業利益 × 2〜5年分 ※時価純資産は未入力のため含まない
//  ・EBITDA倍率：営業利益（簡易EBITDA）× 4〜6倍
function calcValuation(last12: any[]) {
  const months = last12.length;
  if (!months) return null;
  let rev = 0, prof = 0;
  for (const f of last12) { rev += Number(f.revenue) || 0; prof += Number(f.profit) || 0; }
  const annualized = months < 12;
  if (annualized) { rev = rev * 12 / months; prof = prof * 12 / months; }
  rev = Math.round(rev); prof = Math.round(prof);
  const margin = rev > 0 ? Math.round(prof / rev * 1000) / 10 : null;
  let position = '判定不可';
  if (margin !== null) {
    if (margin >= 10) position = '上位水準';
    else if (margin >= 5) position = '平均以上';
    else if (margin >= 2) position = '平均圏';
    else position = '要改善';
  }
  const profitable = prof > 0;
  return {
    annual_revenue: rev,
    annual_profit: prof,
    months_used: months,
    annualized,
    margin_pct: margin,            // 営業利益率（％）中小平均は3〜5％が目安
    position,
    nb_low: profitable ? prof * 2 : null,   // 年買法 下限
    nb_high: profitable ? prof * 5 : null,  // 年買法 上限
    eb_low: profitable ? prof * 4 : null,   // EBITDA倍率 下限
    eb_high: profitable ? prof * 6 : null,  // EBITDA倍率 上限
  };
}

// ---- AI分析生成（コメント＋SWOT＋市場ポジション解説）----
async function genAnalysis(company: string, month: string, summary: any): Promise<{ comment: string; analysis: any }> {
  const fallback = { comment: '（AI分析の生成に失敗しました。手動でご記入ください）', analysis: null };
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) return { comment: '（ANTHROPIC_API_KEYが未設定のため、コメントを手動でご記入ください）', analysis: null };
  try {
    const prompt =
      `あなたは中小企業の経営支援パートナーです。以下の財務データをもとに、経営者向けの月次分析を作成してください。\n` +
      `必ず次のJSON形式のみで出力してください（前置き・後書き・コードブロック記号は一切不要）：\n` +
      `{"comment":"...","swot":{"s":["...","..."],"w":["...","..."],"o":["...","..."],"t":["...","..."]},"position_note":"..."}\n\n` +
      `各項目の要件：\n` +
      `・comment：200〜300字。①当月の数字の要点（前月比があれば触れる）②良い点のねぎらい③来月への具体的な一手1つ。です・ます調。Markdownや記号装飾・見出し・会社名は書かない。\n` +
      `・swot：強み(s)/弱み(w)/機会(o)/脅威(t)を各2点、それぞれ30字以内。データ（売上推移・利益率・企業価値レンジ）から読み取れる根拠を優先し、業種の一般論は補助的に使う。\n` +
      `・position_note：valuationの利益率(margin_pct)と中小企業の平均水準（営業利益率3〜5%が目安）を比べた現在位置の解説を60字以内。\n` +
      `・税務・法務の断定はしない。数字の単位は万円。\n\n` +
      `会社名：${company}\n対象月：${ymLabel(month)}\nデータ：${JSON.stringify(summary)}`;
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await r.json();
    const text = (data.content || []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n').trim();
    if (!text) return fallback;
    const clean = text.replace(/```json|```/g, '').trim();
    try {
      const obj = JSON.parse(clean);
      const comment = (obj.comment || '').trim() || fallback.comment;
      const analysis = {
        swot: obj.swot && obj.swot.s ? obj.swot : null,
        position_note: (obj.position_note || '').trim() || null,
      };
      return { comment, analysis: (analysis.swot || analysis.position_note) ? analysis : null };
    } catch (_e) {
      // JSONで返らなかった場合は本文をコメントとして使う
      return { comment: clean.slice(0, 600), analysis: null };
    }
  } catch (_e) {
    return fallback;
  }
}

// ---- 日付ユーティリティ（日本時間基準）----
function prevMonthJST(): string {
  const jst = new Date(Date.now() + 9 * 3600 * 1000);
  let y = jst.getUTCFullYear();
  let m = jst.getUTCMonth(); // 0-11（今月-1が前月のindex）
  if (m === 0) { y -= 1; m = 12; }
  return `${y}-${String(m).padStart(2, '0')}`;
}
function prevOf(ym: string): string {
  let [y, m] = ym.split('-').map(Number);
  m -= 1;
  if (m === 0) { y -= 1; m = 12; }
  return `${y}-${String(m).padStart(2, '0')}`;
}
function ymLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `${y}年${Number(m)}月`;
}
function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o, null, 1), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
