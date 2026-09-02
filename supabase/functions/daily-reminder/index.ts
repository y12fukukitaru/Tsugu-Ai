// =====================================================================
// TsuguAi -継- Phase 31：毎朝の自動リマインド（Supabase Edge Function）
// 機能：
//  ・パートナーごとに「返信滞留・接点切れ・調達期日・支払期日」を毎朝メールで通知
//  ・7日以上の返信滞留と担当未割当の顧客は、運営にもエスカレーション通知
//  ・?dry=1 を付けると送信せずに「送る予定の内容」をJSONで確認できる（テスト用）
//
// ※ この関数も長らく Supabase 側にしか無く、履歴が残っていなかった。
//    2026-09-02、朝8時のメールが届かない理由を追ったとき、中身を読めないので
//    SQLで外側から推し量るしかなかった。そのために半日使っている。
//    答えは下の「本日リマインド対象はありません」で、送る用事が無ければ
//    そもそも送らない作りだった、というだけのことだった。
//    ここに置いておけば、次からは読めば済む。
//
//    差出人名は Secret の REMINDER_FROM が決めている（MAIL_FROM ではない）。
//    monthly-report も同じ Secret を読むので、名乗りを変えるときは
//    REMINDER_FROM のほうを直せば両方が揃う。
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

// ---- 名乗り ----
//  件名の頭と本文の末尾で同じ名前を使う。散らばっていると、次に屋号を
//  変えたときに片方だけ古いまま残る。一箇所に置いて両方から参照する。
const BRAND = 'TsuguAi -継-';

Deno.serve(async (req) => {
  // ---- 認可：CRON_SECRET を知っている呼び出しだけ許可 ----
  const secret = Deno.env.get('CRON_SECRET') || '';
  const url = new URL(req.url);
  const given = req.headers.get('x-cron-secret') || url.searchParams.get('secret') || '';
  if (!secret || given !== secret) {
    return json({ error: 'unauthorized' }, 401);
  }
  const dry = url.searchParams.get('dry') === '1';

  // ---- Supabaseへ管理者権限で接続（環境変数は自動で入っています）----
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const now = Date.now();
  const DAY = 86400000;

  // ---- データ取得 ----
  const [profs, chats, funds, pays] = await Promise.all([
    sb.from('profiles').select('id,email,role,company_name,contact_name,consultant_id'),
    sb.from('chat_messages').select('customer_id,sender_role,created_at')
      .order('created_at', { ascending: false }).limit(2000),
    sb.from('funding_roadmap_items').select('customer_id,title,target_date,status'),
    sb.from('upcoming_payments').select('customer_id,title,due_date'),
  ]);
  if (profs.error) return json({ error: profs.error.message }, 500);

  const rows = profs.data || [];
  const consultants = rows.filter((r) => r.role === 'consultant');
  const admins = rows.filter((r) => r.role === 'admin');
  const customers = rows.filter((r) => r.role === 'customer');
  const nameOf = (c: any) => c.company_name || c.contact_name || c.email;

  // ---- 顧客ごとの最新メッセージ（新しい順に並んでいるので最初の1件）----
  const last: Record<string, any> = {};
  for (const m of (chats.data || [])) {
    if (!last[m.customer_id]) last[m.customer_id] = m;
  }
  const dayDiff = (s: string) => {
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : Math.floor((d.getTime() - now) / DAY);
  };

  // ---- 顧客ごとの「要対応事項」を組み立て（アプリ内トリアージと同じ基準）----
  const items: Record<string, { p: number; text: string }[]> = {};
  const add = (id: string, p: number, text: string) => {
    (items[id] = items[id] || []).push({ p, text });
  };

  for (const c of customers) {
    const lm = last[c.id];
    if (lm && lm.sender_role === 'customer') {
      const days = Math.floor((now - new Date(lm.created_at).getTime()) / DAY);
      if (days >= 2) add(c.id, 100 + days, `返信待ち ${days}日`);
    }
    if (!lm) {
      add(c.id, 40, '一度もやり取りがありません');
    } else {
      const silent = Math.floor((now - new Date(lm.created_at).getTime()) / DAY);
      if (silent >= 30) add(c.id, 40, `${silent}日間やり取りなし`);
    }
  }
  for (const f of (funds.data || [])) {
    if (!f.target_date || f.status === '実行済' || f.status === '見送り') continue;
    const d = dayDiff(f.target_date);
    if (d === null) continue;
    if (d < 0) add(f.customer_id, 95, `調達期日を${-d}日超過：${f.title}`);
    else if (d <= 14) add(f.customer_id, 60 + (14 - d), `調達期日まであと${d}日：${f.title}`);
  }
  for (const p of (pays.data || [])) {
    if (!p.due_date) continue;
    const d = dayDiff(p.due_date);
    if (d !== null && d >= 0 && d <= 7) add(p.customer_id, 55, `支払予定まであと${d}日：${p.title}`);
  }

  // ---- パートナーごとのダイジェストメール ----
  const appUrl = Deno.env.get('APP_URL') || 'https://y12fukukitaru.github.io/Tsugu-Ai/';
  const digests: { to: string; subject: string; body: string }[] = [];

  for (const f of consultants) {
    if (!f.email) continue;
    const mine = customers.filter((c) => c.consultant_id === f.id && items[c.id]);
    if (!mine.length) continue;
    mine.sort((a, b) =>
      Math.max(...items[b.id].map((i) => i.p)) - Math.max(...items[a.id].map((i) => i.p))
    );
    const lines = mine.map((c) =>
      `■ ${nameOf(c)}\n` +
      items[c.id].sort((a, b) => b.p - a.p).map((i) => `　・${i.text}`).join('\n')
    );
    digests.push({
      to: f.email,
      subject: `【${BRAND}】本日の要対応 ${mine.length}社`,
      body:
        `おはようございます。本日対応が必要な担当顧客の一覧です。\n\n` +
        `${lines.join('\n\n')}\n\n` +
        `プラットフォームを開く: ${appUrl}\n\n— ${BRAND} 自動リマインド`,
    });
  }

  // ---- 運営へのエスカレーション（7日以上の返信滞留・担当未割当）----
  const esc: string[] = [];
  for (const c of customers) {
    const overdue = (items[c.id] || []).find((i) => i.p >= 107); // 返信待ち7日以上
    if (overdue) esc.push(`■ ${nameOf(c)}：${overdue.text}（担当パートナーの対応をご確認ください）`);
    if (!c.consultant_id) esc.push(`■ ${nameOf(c)}：担当パートナーが未割当です`);
  }
  if (esc.length) {
    for (const a of admins) {
      if (!a.email) continue;
      digests.push({
        to: a.email,
        subject: `【${BRAND} 運営】エスカレーション ${esc.length}件`,
        body: `運営の確認が必要な項目です。\n\n${esc.join('\n')}\n\n${appUrl}\n\n— ${BRAND} 自動リマインド`,
      });
    }
  }

  // ---- dryモード：送信せず内容を返す（動作確認用）----
  if (dry) {
    return json({ dry: true, count: digests.length, would_send: digests });
  }
  //  用事が無ければ送らない。2026-09-02 の朝にメールが来なかったのは
  //  これ。壊れていたのではなく、この行を通っていた。
  if (!digests.length) {
    return json({ sent: 0, message: '本日リマインド対象はありません' });
  }

  // ---- Resendでメール送信 ----
  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return json({ error: 'RESEND_API_KEY が未設定です', pending: digests.length }, 500);
  const from = Deno.env.get('REMINDER_FROM') || `${BRAND} <onboarding@resend.dev>`;

  const results: any[] = [];
  for (const d of digests) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: [d.to], subject: d.subject, text: d.body }),
      });
      results.push({ to: d.to, ok: r.ok, status: r.status, detail: r.ok ? undefined : await r.text() });
    } catch (e) {
      results.push({ to: d.to, ok: false, error: String(e) });
    }
  }
  return json({ sent: results.filter((r) => r.ok).length, results });
});

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o, null, 1), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
