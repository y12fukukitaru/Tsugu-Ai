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
    ],
    setup_fee_notices: [
      { offer_id: 'o1', customer_id: 'c1', invoice_id: 'i1', mailed_at: null, mail_count: 0, mail_error: null },
      { offer_id: 'o2', customer_id: 'c2', invoice_id: 'i2', mailed_at: null, mail_count: 0, mail_error: null },
    ],
  };
}
function make(db, mails, opts) {
  let handler = null;
  const Deno = {
    env: { get: (k) => ({ SUPABASE_URL: 'https://sb', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', RESEND_API_KEY: 'rk', MAIL_FROM: 'TsuguAi <m@x>', APP_URL: 'https://app/' })[k] },
    serve: (h) => { handler = h; },
  };
  function q(table) {
    const rows = db[table] || (db[table] = []);
    const f = []; let upd = null;
    const api = {
      select() { return api; },
      eq(k, v) { f.push((r) => r[k] === v); return api; },
      is(k, v) { f.push((r) => (r[k] == null) === (v == null)); return api; },
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
  return call;
}

(async () => {
  // ① ご本人
  {
    const db = fresh(), mails = [];
    const call = make(db, mails);
    const [a, b] = await Promise.all([call('tC', { action: 'setup' }), call('tC', { action: 'setup' })]);
    ok('ご本人：2台同時でも送るのは一度', mails.length === 1 && a.body.sent + b.body.sent === 1);
    ok('宛先は登録のアドレス（画面から受け取らない）', mails[0].to[0] === 'c1@x.jp' && mails[0].subject === '【TsuguAi -継-】初期導入費のご案内');
    const nt = db.setup_fee_notices.find((x) => x.offer_id === 'o1');
    ok('送った記録（日時・回数・エラーなし）', !!nt.mailed_at && nt.mail_count === 1 && nt.mail_error == null);
    const again = await call('tC', { action: 'setup' });
    ok('次のログインでは送らない', again.body.sent === 0 && mails.length === 1);
    const h = mails[0].html;
    ok('文面：宛名・金額（税別・税・税込）・期日', /一社 御中/.test(h) && /山田 様/.test(h) && /100,000円（税別）＋ 消費税 10,000円/.test(h) && /110,000円（税込）/.test(h) && /2026年11月30日/.test(h));
    ok('文面：お振込先・依頼人名・振込手数料', /〇〇銀行 本店 普通 1234567 カ）フクキタル/.test(h) && /ご依頼人名をご契約の会社名/.test(h) && /振込手数料はご負担/.test(h));
    ok('文面：なりすまし注意・日々の一行', /メールだけでお振込先の変更をお願いすることはありません/.test(h) && /継ぐ、を身近な経営判断に/.test(h));
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
    const v = await call('tA', { action: 'setup', invoice_id: 'i2' });
    const k = await call('tA', { action: 'setup', invoice_id: 'i4' });
    ok('運営：取り消した請求・顧問料の請求には送らない', !v.body.ok && !k.body.ok && mails.length === 2);
    const x = await call('nobody', { action: 'setup' });
    ok('ログインしていなければ送らない', x.status === 401);
  }
  // ③ お振込先が空のとき
  {
    const call = make(fresh(), []);
    const h = call.html({ company: '', contact: '', inv: { title: 't', amount_ex: 1, tax: 0, amount: 1, due_on: '2026-01-31' }, bank: '' });
    ok('お振込先が空なら、アプリで確かめていただく', /お振込先は、アプリの「お支払い」でご確認ください/.test(h) && /ご担当者様/.test(h));
    const e = call.html({ company: '<b>x</b>', contact: '', inv: { title: '<i>', amount_ex: 1, tax: 0, amount: 1, due_on: null }, bank: '<script>' });
    ok('会社名・件名・お振込先は文字として出す', !/<b>x<\/b>/.test(e) && !/<script>/.test(e) && /&lt;b&gt;x/.test(e));
  }
  // ④ 説明の書き方（デプロイ・SQL）
  ok('冒頭にデプロイと先に流す SQL', /Verify JWT）は外してよい/.test(SRC) && /20261015000000_debit_mandate_setup_fee\.sql/.test(SRC));

  if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b)); process.exit(1); }
  console.log('ALL OK', n, 'checks, 0 failed');
})();
