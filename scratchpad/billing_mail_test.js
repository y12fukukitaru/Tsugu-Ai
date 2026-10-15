// =============================================================
// billing-mail（初期導入費のご案内メール）を、本物の Supabase・Resend なしで動かす
//   ・ご本人：未送信だけを一度だけ送る（2台同時でも一度）。宛先は登録のアドレス
//   ・取り消し・お支払い済みは送らずに閉じる。送れなかったら次のログインでもう一度
//   ・運営：指定の請求を送る（再送・手で立てた請求も）。運営以外は送れない
//   ・文面：金額（税別・税・税込）・期日・お振込先・依頼人名・なりすまし注意
// =============================================================
const fs = require('fs');
const ts = require('/opt/node22/lib/node_modules/typescript');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
let n = 0, bad = [];
function ok(name, c) { n++; if (!c) bad.push(name); }

// ---- 関数を取り出す（import を外し、Deno を差し替える）
const SRC = R('supabase/functions/billing-mail/index.ts');
const js = ts.transpileModule(SRC.replace(/^import .*$/m, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

//  createClient は import を外したので、関数の中で名前が引けるように差し込む
const js2 = js.replace(/\bcreateClient\(/g, '__mk(');

function fresh() {
  return {
    tokens: { tC: 'c1', tA: 'adm', tC2: 'c2' },
    users: [{ id: 'c1', email: 'c1@x.jp' }, { id: 'c2', email: 'c2@x.jp' }],
    profiles: [{ id: 'c1', role: 'customer', company_name: '一社', contact_name: '山田' }, { id: 'adm', role: 'admin' }, { id: 'c2', role: 'customer', company_name: '二社' }],
    app_settings: [{ key: 'billing_rates', value: { 'bl-bank': '〇〇銀行 本店 普通 1234567 カ）フクキタル' } }],
    invoices: [
      { id: 'i1', customer_id: 'c1', kind: 'setup', title: '初期導入費（買い手プラン）', status: 'open', amount_ex: 100000, tax: 10000, amount: 110000, due_on: '2026-11-30' },
      { id: 'i2', customer_id: 'c2', kind: 'setup', title: '初期導入費（売り手プラン）', status: 'void', amount_ex: 50000, tax: 5000, amount: 55000, due_on: '2026-11-30' },
      { id: 'i3', customer_id: 'c2', kind: 'setup', title: '初期導入費（手）', status: 'open', amount_ex: 50000, tax: 5000, amount: 55000, due_on: '2026-12-31' },
      { id: 'i4', customer_id: 'c2', kind: 'advisory', title: '顧問料', status: 'open', amount_ex: 35000, tax: 3500, amount: 38500, due_on: '2026-11-27' },
      { id: 'a1', customer_id: 'c1', kind: 'advisory', period: '2026-11', title: '2026-11 顧問料（買い手プラン）', status: 'open', amount_ex: 45000, tax: 4500, amount: 49500, due_on: '2026-11-30' },
    ],
    setup_fee_notices: [
      { offer_id: 'o1', customer_id: 'c1', invoice_id: 'i1', advisory_invoice_id: 'a1', mailed_at: null, mail_count: 0, mail_error: null },
      { offer_id: 'o2', customer_id: 'c2', invoice_id: 'i2', advisory_invoice_id: null, mailed_at: null, mail_count: 0, mail_error: null },
    ],
  };
}
function make(db, mails, opts) {
  let handler = null;
  const Deno = {
    env: { get: (k) => ({ SUPABASE_URL: 'https://sb', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', RESEND_API_KEY: 'rk', MAIL_FROM: 'TsuguAi <m@x>', APP_URL: 'https://app/', CRON_SECRET: 'cs' })[k] },
    serve: (h) => { handler = h; },
  };
  function q(table) {
    const rows = db[table] || (db[table] = []);
    const f = []; let upd = null;
    const api = {
      select() { return api; },
      eq(k, v) { f.push((r) => r[k] === v); return api; },
      is(k, v) { f.push((r) => (r[k] == null) === (v == null)); return api; },
      in(k, arr) { f.push((r) => arr.indexOf(r[k]) >= 0); return api; },
      lt(k, v) { f.push((r) => String(r[k]) < String(v)); return api; },
      update(o) { upd = o; return api; },
      insert(o) { rows.push(Object.assign({ mail_count: 0, mailed_at: null, mail_error: null }, o)); return Promise.resolve({ error: null }); },
      maybeSingle() { const r = rows.filter((x) => f.every((g) => g(x))); return Promise.resolve({ data: r[0] ? Object.assign({}, r[0]) : null }); },
      then(res, rej) {
        const hit = rows.filter((x) => f.every((g) => g(x)));
        if (upd) hit.forEach((x) => Object.assign(x, upd));
        return Promise.resolve({ data: hit.map((x) => Object.assign({}, x)), error: null }).then(res, rej);
      },
    };
    return api;
  }
  const sb = { from: q, auth: { admin: { getUserById: async (id) => ({ data: { user: (db.users || []).find((u) => u.id === id) || null } }) } } };
  const fetch = async (url, init) => {
    if (/auth\/v1\/user/.test(url)) {
      const tok = (init.headers.Authorization || '').replace('Bearer ', '');
      return { ok: !!db.tokens[tok], json: async () => ({ id: db.tokens[tok] }) };
    }
    if (/resend/.test(url)) {
      if (opts && opts.mailFail) return { ok: false, status: 500, text: async () => 'x' };
      mails.push(JSON.parse(init.body)); return { ok: true, json: async () => ({}) };
    }
    throw new Error('unexpected ' + url);
  };
  class Resp { constructor(b, i) { this.body = b; this.status = (i || {}).status || 200; } }
  const mod = { exports: {} };
  new Function('Deno', 'fetch', 'module', 'exports', 'Response', '__mk', js2)(Deno, fetch, mod, mod.exports, Resp, () => sb);
  const call = async (token, body) => {
    const res = await handler({ method: 'POST', headers: { get: (k) => (k === 'Authorization' ? 'Bearer ' + token : null) }, json: async () => body });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  call.html = mod.exports.setupHtml;
  call.stop = mod.exports.stopNoteFor;
  call.inv = mod.exports.invoiceHtml;
  call.iss = mod.exports.issuerOf;
  call.cno = mod.exports.cnoFmt;
  call.cron = async (body, secret) => {
    const res = await handler({ method: 'POST', headers: { get: (k) => (k === 'x-cron-secret' ? secret : null) }, json: async () => body });
    return { status: res.status, body: JSON.parse(res.body) };
  };
  return call;
}

(async () => {
  // ① ご本人
  {
    const db = fresh(), mails = [];
    const call = make(db, mails);
    const [a, b] = await Promise.all([call('tC', { action: 'setup' }), call('tC', { action: 'setup' })]);
    ok('ご本人：2台同時でも送るのは一度', mails.length === 1 && a.body.sent + b.body.sent === 1);
    ok('宛先は登録のアドレス（画面から受け取らない）', mails[0].to[0] === 'c1@x.jp' && mails[0].subject === '【TsuguAi -継-】初回のお振込みのご案内（初期導入費・顧問料）');
    const nt = db.setup_fee_notices.find((x) => x.offer_id === 'o1');
    ok('送った記録（日時・回数・エラーなし）', !!nt.mailed_at && nt.mail_count === 1 && nt.mail_error == null);
    const again = await call('tC', { action: 'setup' });
    ok('次のログインでは送らない', again.body.sent === 0 && mails.length === 1);
    const h = mails[0].html;
    ok('文面：宛名・初期導入費と翌月分の顧問料・期日', /一社 御中/.test(h) && /山田 様/.test(h)
      && /初期導入費（買い手プラン）<\/td><td[^>]*>100,000円/.test(h) && /2026-11 顧問料（買い手プラン）<\/td><td[^>]*>45,000円/.test(h) && /2026年11月30日/.test(h));
    ok('文面：税金の内訳（小計・消費税10%・合計）', /ご請求の内訳/.test(h) && /金額（税別）/.test(h)
      && /小計（税別）<\/td><td[^>]*>145,000円/.test(h) && /消費税（10%）<\/td><td[^>]*>14,500円/.test(h) && /合計（税込）[\s\S]{0,200}159,500円/.test(h)
      && h.indexOf('小計（税別）') < h.indexOf('消費税（10%）') && h.indexOf('消費税（10%）') < h.indexOf('合計（税込）'));
    ok('文面：ご登録の月はいただかない・口座振替は2か月後（12月分）から', /ご登録の月の顧問料はいただきません/.test(h) && /2026年12月分の顧問料からは、口座振替/.test(h) && /まとめて一度に/.test(h));
    ok('文面：初期導入費 → 顧問料 の順', h.indexOf('初期導入費（買い手プラン）') < h.indexOf('2026-11 顧問料'));
    ok('文面：お振込先・依頼人名・振込手数料', /〇〇銀行 本店 普通 1234567 カ）フクキタル/.test(h) && /ご依頼人名をご契約の会社名/.test(h) && /振込手数料はご負担/.test(h));
    ok('文面：なりすまし注意・日々の一行', /メールだけでお振込先の変更をお願いすることはありません/.test(h) && /継ぐ、を身近な経営判断に/.test(h));
  }
  {
    const db = fresh(), mails = [];
    const call = make(db, mails);
    db.invoices.find((x) => x.id === 'i1').status = 'paid';
    await call('tC', { action: 'setup' });
    ok('初期導入費が払い済みなら、顧問料だけを案内する', mails.length === 1 && !/初期導入費（買い手プラン）/.test(mails[0].html) && /2026-11 顧問料/.test(mails[0].html));
  }
  {
    const db = fresh(), mails = [];
    const call = make(db, mails);
    await call('tC2', { action: 'setup' });
    const nt = db.setup_fee_notices.find((x) => x.offer_id === 'o2');
    ok('取り消した請求は送らずに閉じる', mails.length === 0 && !!nt.mailed_at && /送らずに閉じました/.test(nt.mail_error));
  }
  {
    const db = fresh(), mails = [];
    const call = make(db, mails, { mailFail: true });
    const r = await call('tC', { action: 'setup' });
    const nt = db.setup_fee_notices.find((x) => x.offer_id === 'o1');
    ok('送れなかったら未送信に戻す（次のログインでもう一度）', r.body.sent === 0 && nt.mailed_at === null && /送れませんでした/.test(nt.mail_error));
  }
  // ② 運営
  {
    const db = fresh(), mails = [];
    const call = make(db, mails);
    const no = await call('tC', { action: 'setup', invoice_id: 'i3' });
    ok('運営以外は請求を指定して送れない', no.status === 403 && mails.length === 0);
    const r = await call('tA', { action: 'setup', invoice_id: 'i3' });
    const nt = db.setup_fee_notices.find((x) => x.invoice_id === 'i3');
    ok('運営：手で立てた請求にも送れる（記録を作る）', r.body.ok && mails.length === 1 && mails[0].to[0] === 'c2@x.jp' && nt && nt.mail_count === 1);
    await call('tA', { action: 'setup', invoice_id: 'i3' });
    ok('運営：再送は回数が増える', mails.length === 2 && db.setup_fee_notices.find((x) => x.invoice_id === 'i3').mail_count === 2);
    ok('運営：手で立てた初期導入費だけなら、件名は初期導入費・顧問料の行なし', mails[1].subject === '【TsuguAi -継-】初期導入費のご案内' && !/顧問料（/.test(mails[1].html));
    const ra = await call('tA', { action: 'setup', invoice_id: 'a1' });
    ok('運営：初回に入れた顧問料の行からも、初期導入費と一緒に送れる', ra.body.ok && mails.length === 3 && /初期導入費（買い手プラン）/.test(mails[2].html) && /2026-11 顧問料/.test(mails[2].html));
    const v = await call('tA', { action: 'setup', invoice_id: 'i2' });
    const k = await call('tA', { action: 'setup', invoice_id: 'i4' });
    ok('運営：取り消した請求・ふつうの月の顧問料には送らない', !v.body.ok && !k.body.ok && /初回のお振込みに入れた顧問料ではありません/.test(k.body.error) && mails.length === 3);
    const x = await call('nobody', { action: 'setup' });
    ok('ログインしていなければ送らない', x.status === 401);
  }
  // ③ お振込先が空のとき
  {
    const call = make(fresh(), []);
    const h = call.html({ company: '', contact: '', invs: [{ title: 't', amount_ex: 1, tax: 0, amount: 1, due_on: '2026-01-31' }], bank: '' });
    ok('お振込先が空なら、アプリで確かめていただく', /お振込先は、アプリの「お支払い」でご確認ください/.test(h) && /ご担当者様/.test(h));
    const e = call.html({ company: '<b>x</b>', contact: '', invs: [{ title: '<i>', amount_ex: 1, tax: 0, amount: 1, due_on: null }], bank: '<script>' });
    ok('顧問料が無ければ、口座振替の始まりは書かない', /担当パートナーから別にご案内します/.test(h));
    ok('会社名・件名・お振込先は文字として出す', !/<b>x<\/b>/.test(e) && !/<script>/.test(e) && /&lt;b&gt;x/.test(e));
  }
  // ⑤ お振込みのお願い（引き落とせなかった・期日を過ぎた分）
  function dfresh() {
    const db = fresh();
    db.tokens.tP = 'p1'; db.tokens.tX = 'px';
    db.users.push({ id: 'p1', email: 'p1@x.jp' }, { id: 'px', email: 'px@x.jp' });
    db.profiles.find((x) => x.id === 'c1').consultant_id = 'p1';
    db.profiles.push({ id: 'p1', role: 'consultant', full_name: '佐藤 花子' }, { id: 'px', role: 'consultant', full_name: 'ほか' });
    db.invoices.push(
      { id: 'd7', customer_id: 'c1', kind: 'advisory', period: '2026-07', title: '2026-07 顧問料（買い手プラン）', status: 'open', amount_ex: 45000, tax: 4500, amount: 49500, paid_amount: 0, due_on: '2026-07-27' },
      { id: 'd8', customer_id: 'c1', kind: 'advisory', period: '2026-08', title: '2026-08 顧問料（買い手プラン）', status: 'partial', amount_ex: 45000, tax: 4500, amount: 49500, paid_amount: 9500, due_on: '2026-08-27' });
    db.debit_mandates = [{ customer_id: 'c1', status: 'registered' }];
    db.dunning_notices = [{ id: 'n1', customer_id: 'c1', sent_by: 'p1', invoice_ids: ['d7', 'd8'], pay_by: '2026-10-29', mailed_at: null, mail_error: null }];
    return db;
  }
  {
    const db = dfresh(), mails = [];
    const call = make(db, mails);
    const x = await call('tX', { action: 'dunning', notice_id: 'n1' });
    ok('お願い：用意した本人か運営でなければ送れない', x.status === 403 && mails.length === 0);
    const r = await call('tP', { action: 'dunning', notice_id: 'n1' });
    ok('お願い：担当パートナーが送れる（宛先は登録のアドレス）', r.body.ok && mails.length === 1 && mails[0].to[0] === 'c1@x.jp');
    ok('お願い：件名に〇月分', mails[0].subject === '【TsuguAi -継-】お振込みのお願い（2026年7月分の顧問料・2026年8月分の顧問料）');
    const h = mails[0].html;
    ok('お願い：内訳（税別・小計・消費税・合計）', /2026-07 顧問料（買い手プラン）<\/td><td[^>]*>45,000円/.test(h) && /小計（税別）<\/td><td[^>]*>90,000円/.test(h) && /消費税（10%）<\/td><td[^>]*>9,000円/.test(h) && /合計（税込）<\/td><td[^>]*>99,000円/.test(h));
    ok('お願い：入金済みの分を引いたお願い額', /お支払い済みの分<\/td><td[^>]*>−9,500円/.test(h) && /お振込みのお願い額[\s\S]{0,200}89,500円/.test(h));
    ok('お願い：期日・お振込先・依頼人名', /2026年10月29日/.test(h) && /カ）フクキタル/.test(h) && /ご依頼人名をご契約の会社名/.test(h));
    ok('お願い：口座振替の方には「今回は引き落とさない・これからは口座振替」', /今回の分は、口座からのお引き落としはいたしません/.test(h));
    ok('お願い：問い合わせ先は担当パートナー・行き違いのお詫び', /担当パートナー（佐藤 花子・p1@x\.jp）/.test(h) && /行き違いでお支払いいただいている場合は/.test(h));
    ok('お願い：送った記録', !!db.dunning_notices[0].mailed_at && db.dunning_notices[0].mail_error == null);
    const again = await call('tA', { action: 'dunning', notice_id: 'n1' });
    ok('お願い：同じものは二度送らない', !again.body.ok && /もう送っています/.test(again.body.error) && mails.length === 1);
    ok('お願い：2か月分なら「もう1か月分たまると、その翌月1日から一時停止」', /このまま次の月の顧問料も確認できない場合は、その翌月1日からご利用を一時停止/.test(h));
  }
  {
    const db = dfresh(), mails = [];
    db.debit_mandates = [];
    const call = make(db, mails);
    const r = await call('tA', { action: 'dunning', notice_id: 'n1' });
    ok('お願い：運営も送れる。口座振替でない方には引き落としの文を出さない', r.body.ok && !/口座からのお引き落としはいたしません/.test(mails[0].html));
  }
  {
    const db = dfresh(), mails = [];
    const call = make(db, mails, { mailFail: true });
    const r = await call('tP', { action: 'dunning', notice_id: 'n1' });
    ok('お願い：送れなかったら記録を戻し、理由を残す（もう一度送れる）', !r.body.ok && db.dunning_notices[0].mailed_at === null && /送れませんでした/.test(db.dunning_notices[0].mail_error));
  }
  {
    const db = dfresh(), mails = [];
    db.invoices.filter((x) => x.id === 'd7' || x.id === 'd8').forEach((x) => { x.status = 'paid'; });
    const call = make(db, mails);
    const r = await call('tP', { action: 'dunning', notice_id: 'n1' });
    ok('お願い：もう入金済みなら送らない', !r.body.ok && mails.length === 0 && /お支払いの済んでいない請求がありません/.test(db.dunning_notices[0].mail_error));
  }

  // ⑥ 止めることの一文（お願いのメール）
  {
    const call = make(fresh(), []);
    const A = (due) => ({ kind: 'advisory', due_on: due });
    ok('止める一文：1か月分なら無し', call.stop([A('2026-09-27')], '2026-10-15', false) === '');
    ok('止める一文：3か月分で今月1日にはもう3か月分 → 止めています', /一時停止しています/.test(call.stop([A('2026-07-27'), A('2026-08-27'), A('2026-09-27')], '2026-10-15', false)));
    ok('止める一文：3か月分になったばかり → 来月1日から', /11月1日からご利用を一時停止/.test(call.stop([A('2026-08-27'), A('2026-09-27'), A('2026-10-05')], '2026-10-15', false)));
    ok('止める一文：12月なら1月1日から', /1月1日から/.test(call.stop([A('2026-10-27'), A('2026-11-27'), A('2026-12-05')], '2026-12-15', false)));
    ok('止める一文：運営が今月解いていれば「止めています」と書かない', !/一時停止しています/.test(call.stop([A('2026-07-27'), A('2026-08-27'), A('2026-09-27')], '2026-10-15', true)));
  }
  // ⑦ 止めた日のお知らせ（毎朝・pg_cron）
  {
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const ms = today.slice(0, 8) + '01';
    const before = (k) => { const d = new Date(ms + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - k); d.setUTCDate(27); return d.toISOString().slice(0, 10); };
    const db = dfresh(), mails = [];
    db.invoices = db.invoices.filter((x) => x.customer_id !== 'c1');
    [3, 2, 1].forEach((k, i) => db.invoices.push({ id: 's' + i, customer_id: 'c1', kind: 'advisory', period: before(k).slice(0, 7), title: before(k).slice(0, 7) + ' 顧問料（買い手プラン）', status: 'open', amount_ex: 45000, tax: 4500, amount: 49500, paid_amount: 0, due_on: before(k) }));
    db.service_suspensions = [];
    const call = make(db, mails);
    const bad = await call.cron({ action: 'suspend_notify' }, 'wrong');
    ok('毎朝：合言葉が違えば動かない', bad.status === 401 && mails.length === 0);
    const r = await call.cron({ action: 'suspend_notify' }, 'cs');
    ok('毎朝：止めた方とその担当パートナーへ知らせる', r.body.ok && r.body.notified === 1 && mails.length === 2 && mails[0].to[0] === 'c1@x.jp' && mails[1].to[0] === 'p1@x.jp');
    ok('毎朝：ご本人には内訳・お願い額・お振込先・再開のこと', /ご利用の一時停止のお知らせ/.test(mails[0].subject) && /148,500円/.test(mails[0].html) && /カ）フクキタル/.test(mails[0].html) && /お振込みを確認しだい、すぐに再開します/.test(mails[0].html));
    ok('毎朝：お客様番号が無ければ載せない（番号の SQL がまだでも送る）', !/お客様番号/.test(mails[0].html));
    ok('毎朝：担当パートナーには会社名・月数・金額', /担当先のご利用を一時停止しました/.test(mails[1].subject) && /一社/.test(mails[1].html) && /3か月分/.test(mails[1].html));
    const rec = db.service_suspensions[0];
    ok('毎朝：知らせた記録（ご本人・担当）', rec && !!rec.notified_at && !!rec.partner_notified_at && rec.month === today.slice(0, 7));
    await call.cron({ action: 'suspend_notify' }, 'cs');
    ok('毎朝：同じ月は二度知らせない', mails.length === 2);
    const db2 = dfresh(), mails2 = [];
    db2.invoices = db.invoices.map((x) => Object.assign({}, x));
    db2.service_suspensions = [{ customer_id: 'c1', month: today.slice(0, 7), lifted_at: '2026-10-01T00:00:00Z', notified_at: null }];
    await make(db2, mails2).cron({ action: 'suspend_notify' }, 'cs');
    ok('毎朝：運営が今月解いた方には知らせない', mails2.length === 0);
  }

  // ⑤ 請求書（運営が、その月の銀行振込の請求をまとめて送る）
  {
    const ifresh = () => {
      const db = fresh();
      db.users.push({ id: 'p1', email: 'p1@x.jp' });
      db.profiles.push({ id: 'p1', role: 'consultant', full_name: '担当 一郎' });
      db.profiles[0].consultant_id = 'p1';
      db.tokens.tP = 'p1';
      db.profiles[0].customer_no = 'C482719531';
      db.app_settings[0].value['bl-iss-name'] = '株式会社福來';
      db.app_settings[0].value['bl-iss-addr'] = '広島県広島市中区〇〇1-2-3';
      db.invoices.push(
        { id: 'm1', customer_id: 'c1', kind: 'advisory', period: '2026-12', title: '2026-12 顧問料（買い手プラン）', status: 'open', amount_ex: 45000, tax: 4500, amount: 49500, paid_amount: 0, due_on: '2026-12-27' },
        { id: 'm2', customer_id: 'c1', kind: 'other', period: '2026-12', title: '<b>資料作成</b>', status: 'partial', amount_ex: 10000, tax: 1000, amount: 11000, paid_amount: 1000, due_on: '2026-12-31' },
        { id: 'm3', customer_id: 'c1', kind: 'other', period: '2026-12', title: '取り消した', status: 'void', amount_ex: 1, tax: 0, amount: 1, paid_amount: 0, due_on: '2026-12-31' });
      db.invoice_mails = [{ id: 'im1', customer_id: 'c1', period: '2026-12', invoice_no: '202612-0007', invoice_ids: ['m1', 'm2', 'm3'], issued_on: '2026-12-01', mail_count: 0, sending_at: null, mailed_at: null, mail_error: null }];
      return db;
    };
    {
      const db = ifresh(), mails = [];
      const call = make(db, mails);
      const rp = await call('tP', { action: 'invoice', mail_id: 'im1' });
      ok('請求書：運営以外は送れない', rp.status === 403 && mails.length === 0);
      const rn = await call('tA', { action: 'invoice' });
      ok('請求書：請求書の指定が要る', rn.status === 400);
      const r = await call('tA', { action: 'invoice', mail_id: 'im1' });
      ok('請求書：運営が送れる・宛先は登録のアドレス', r.body.ok && mails.length === 1 && mails[0].to[0] === 'c1@x.jp');
      const h = mails[0].html;
      ok('請求書：件名に月と番号', /請求書（2026年12月分・No\.202612-0007）/.test(mails[0].subject));
      ok('請求書：宛名・番号・発行日', /一社 御中/.test(h) && /請求書番号　202612-0007/.test(h) && /発行日　2026年12月1日/.test(h));
      ok('請求書：品目（〇月分の顧問料・件名）と税率・取消は載せない', /2026年12月分の顧問料/.test(h) && /&lt;b&gt;資料作成&lt;\/b&gt;/.test(h) && !/取り消した/.test(h) && />10%</.test(h));
      ok('請求書：小計・消費税・合計・入金済み・ご請求金額', /55,000円/.test(h) && /5,500円/.test(h) && /60,500円/.test(h) && /−1,000円/.test(h) && /59,500円/.test(h));
      ok('請求書：お支払期日（いちばん早いもの）・お振込先・依頼人名', /お支払期日　<b style="color:#A9403D;">2026年12月27日/.test(h) && /カ）フクキタル/.test(h) && /ご依頼人名をご契約の会社名/.test(h));
      ok('請求書：発行者（社名・所在地・電話）・登録番号は空なら載せない', /株式会社福來<\/b>/.test(h) && /広島県広島市中区〇〇1-2-3/.test(h) && /TEL 082-548-2224/.test(h) && !/登録番号/.test(h));
      ok('請求書：問い合わせ先は担当パートナー', /担当パートナー（担当 一郎・p1@x\.jp）/.test(h));
      ok('請求書：お客様番号を宛名の下に（区切って）', /お客様番号　C-4827-1953-1/.test(h));
      const rec = db.invoice_mails[0];
      ok('請求書：送った記録（日時・回数・送信中を外す）', !!rec.mailed_at && rec.mail_count === 1 && rec.sending_at === null && rec.mail_error === null);
      await call('tA', { action: 'invoice', mail_id: 'im1' });
      ok('請求書：もう一度送れる（回数が増える）', mails.length === 2 && db.invoice_mails[0].mail_count === 2);
      db.invoice_mails[0].sending_at = new Date().toISOString();
      const busy = await call('tA', { action: 'invoice', mail_id: 'im1' });
      ok('請求書：送っている最中は二重に送らない', !busy.body.ok && /いま送っています/.test(busy.body.error) && mails.length === 2);
    }
    {
      const db = ifresh(), mails = [];
      const r = await make(db, mails, { mailFail: true })('tA', { action: 'invoice', mail_id: 'im1' });
      ok('請求書：送れなかったら理由を残し、送信中を外す', !r.body.ok && db.invoice_mails[0].sending_at === null && /送れませんでした/.test(db.invoice_mails[0].mail_error) && !db.invoice_mails[0].mailed_at);
      db.invoices.forEach((x) => { if (/^m/.test(x.id)) x.status = 'paid'; });
      const r2 = await make(db, [])('tA', { action: 'invoice', mail_id: 'im1' });
      ok('請求書：みな入金済みなら送らない', !r2.body.ok && /お支払いの済んでいない請求がありません/.test(r2.body.error));
      const r3 = await make(db, [])('tA', { action: 'invoice', mail_id: 'nope' });
      ok('請求書：無い請求書は送れない', !r3.body.ok && /見つかりません/.test(r3.body.error));
    }
    {
      const call = make(fresh(), []);
      ok('お客様番号の区切り', call.cno('C482719531') === 'C-4827-1953-1' && call.cno('P123456782') === 'P-1234-5678-2' && call.cno('') === '' && call.cno('x') === 'x');
      ok('発行者：空なら社名と電話の既定', JSON.stringify(call.iss({})) === JSON.stringify({ name: '株式会社福來', addr: '', tel: '082-548-2224', tno: '' }));
      ok('発行者：登録番号は T＋13桁のときだけ', call.iss({ 'bl-iss-tno': 'T1234567890123' }).tno === 'T1234567890123' && call.iss({ 'bl-iss-tno': '1234' }).tno === '');
      const h = call.inv({ company: '', contact: '', invs: [{ kind: 'advisory', period: '2026-12', title: 'x', amount_ex: 45000, tax: 4500, amount: 49500, due_on: '2026-12-27' }], bank: '', no: '1', issued: '2026-12-01', period: '2026-12', issuer: call.iss({ 'bl-iss-tno': 'T1234567890123', 'bl-iss-addr': '<script>' }), ask: '運営' });
      ok('請求書：登録番号があれば載せる・所在地は文字のまま', /登録番号 T1234567890123/.test(h) && /&lt;script&gt;/.test(h) && !/<script>/.test(h));
      ok('請求書：お振込先が無ければアプリで', /お振込先は、アプリの「お支払い」でご確認ください/.test(h));
    }
  }

  // ④ 説明の書き方（デプロイ・SQL）
  ok('冒頭にデプロイと先に流す SQL', /Verify JWT）は外してよい/.test(SRC) && /20261015000000_debit_mandate_setup_fee\.sql/.test(SRC));

  if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b)); process.exit(1); }
  console.log('ALL OK', n, 'checks, 0 failed');
})();
