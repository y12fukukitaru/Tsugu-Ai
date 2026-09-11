// =============================================================
// 契約締結の知らせ（Edge Function contract-send, action:"agreed"）の試験
//   ・同意済みの契約だけ・一度だけ（notified_at の印）・3日より古いものは送らない
//   ・宛先と文面は DB のお知らせ（agent_insights）を使い、無ければ控えの文面
//   ・メール（Resend）と LINE（line_links のある人だけ）
//   ・SQL 未実行のときは、その旨を返す
//   ・従来の「契約書を送る」はログインが要る（変わらない）
// 実行: node scratchpad/contract_push_test.js（scratchpad/tsck に typescript が要る）
// =============================================================
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const TSCK = path.join(process.env.SCRATCH || __dirname, 'tsck');
const OUT = path.join(TSCK, 'out_contract');
let n = 0, bad = [];
function is(name, got, want) { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) bad.push({ name, got: g, want: w }); }
function ok(name, cond) { is(name, !!cond, true); }

cp.execSync(`npx tsc --outDir ${OUT} --module commonjs --target es2022 --moduleResolution node --skipLibCheck --lib es2022,dom ${path.join(TSCK, 'deno-shim.d.ts')} ${path.join(ROOT, 'supabase/functions/contract-send/index.ts')}`, { cwd: TSCK, stdio: 'pipe' });
let js = fs.readFileSync(path.join(OUT, 'index.js'), 'utf8').replace('require("npm:@supabase/supabase-js@2")', '({ createClient: globalThis.__createClient })');
fs.writeFileSync(path.join(OUT, 'index.cjs'), js);

let handler = null;
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc', RESEND_API_KEY: 'rs', LINE_CHANNEL_ACCESS_TOKEN: 'ln' })[k] }, serve: (h) => { handler = h; } };

// ---- 偽の Supabase（update ... is(notified_at,null) を含む）----
const DB = {};
let NO_NOTIFIED_COL = false;
function fakeSb() {
  return {
    from(table) {
      const st = { filters: [], update: null };
      const api = {
        select() { return api; },
        eq(k, v) { st.filters.push([k, v]); return api; },
        is(k, v) { st.filters.push([k, v]); return api; },
        update(patch) { st.update = patch; return api; },
        maybeSingle() { return Promise.resolve(run(true)); },
        then(res) { return Promise.resolve(run(false)).then(res); },
      };
      function match(r) { return st.filters.every(([k, v]) => v === null ? r[k] == null : r[k] === v); }
      function run(single) {
        if (st.update) {
          if (NO_NOTIFIED_COL && 'notified_at' in st.update) return { data: null, error: { message: 'column "notified_at" of relation "contract_offers" does not exist' } };
          const rows = (DB[table] || []).filter(match);
          rows.forEach((r) => Object.assign(r, st.update));
          return { data: rows.map((r) => ({ id: r.id })), error: null };
        }
        const rows = (DB[table] || []).filter(match);
        return { data: single ? (rows[0] || null) : rows, error: null };
      }
      return api;
    },
  };
}
globalThis.__createClient = () => fakeSb();
let SENT = [];
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('/auth/v1/user')) return new Response('', { status: 401 });
  if (u.includes('api.resend.com')) { SENT.push(['mail', JSON.parse(init.body)]); return new Response('{}', { status: 200 }); }
  if (u.includes('api.line.me')) { SENT.push(['line', JSON.parse(init.body)]); return new Response('{}', { status: 200 }); }
  throw new Error('unexpected fetch ' + u);
};
require(path.join(OUT, 'index.cjs'));
ok('ハンドラ登録', typeof handler === 'function');

async function call(body) {
  const req = new Request('https://x/contract-send', { method: 'POST', headers: { Authorization: 'Bearer anon', 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const res = await handler(req);
  return { status: res.status, json: await res.json() };
}
const TOKEN = 'a'.repeat(40);
(async () => {
  // 従来の道はログインが要る
  let r = await call({ token: TOKEN });
  is('契約書を送る（従来）は未ログインで401', r.status, 401);
  r = await call({ token: 'short', action: 'agreed' });
  is('短いトークンは400', r.status, 400);

  // まだ同意されていない
  DB.contract_offers = [{ id: 'o1', token: TOKEN, kind: 'customer', email: 'c@x.jp', status: 'sent', agreed_at: null, offered_by: 'p1', consultant_id: 'p1', notified_at: null }];
  r = await call({ token: TOKEN, action: 'agreed' });
  is('未同意は400', [r.status, r.json.ok], [400, false]);

  // 同意済み・DB のお知らせあり
  const now = new Date().toISOString();
  Object.assign(DB.contract_offers[0], { status: 'agreed', agreed_at: now, agreed_name: '継 太郎', agreed_org: '株式会社継', monthly_fee: 45000 });
  DB.agent_insights = [
    { user_id: 'p1', kind: 'contract_agreed', reason: 'contract_offers.id=o1', title: '顧問契約が締結されました：c@x.jp', body: '株式会社継　継 太郎 様が 2026/09/11 12:00 に同意しました。顧問料 45,000円（税別）。\n次の一手：…' },
    { user_id: 'a1', kind: 'contract_agreed', reason: 'contract_offers.id=o1', title: '顧問契約が締結されました：c@x.jp', body: '…' },
    { user_id: 'zz', kind: 'contract_agreed', reason: 'contract_offers.id=other', title: 'x', body: 'y' },
  ];
  DB.profiles = [{ id: 'p1', email: 'partner@x.jp', role: 'consultant' }, { id: 'a1', email: 'admin@x.jp', role: 'admin' }];
  DB.line_links = [{ user_id: 'p1', line_user_id: 'U123' }];
  SENT = [];
  r = await call({ token: TOKEN, action: 'agreed' });
  is('送れる：宛先2・メール2・LINE1', [r.status, r.json.ok, r.json.to, r.json.mail, r.json.line], [200, true, 2, 2, 1]);
  is('メールの宛先', SENT.filter((s) => s[0] === 'mail').map((s) => s[1].to[0]).sort(), ['admin@x.jp', 'partner@x.jp']);
  ok('件名は継ナビくんから', SENT.filter((s) => s[0] === 'mail').every((s) => /^【継ナビくん】顧問契約が締結されました/.test(s[1].subject)));
  ok('本文に同意者と時刻', /株式会社継　継 太郎 様が 2026\/09\/11 12:00/.test(SENT[0][1].html));
  ok('本文の < は無害化', !/<script/.test(SENT[0][1].html));
  is('LINE は連携している人だけ', SENT.filter((s) => s[0] === 'line').map((s) => s[1].to), ['U123']);
  ok('LINE の文にアプリの案内', /アプリで開く/.test(SENT.find((s) => s[0] === 'line')[1].messages[0].text));
  ok('印が付く', !!DB.contract_offers[0].notified_at);

  // 二度目は送らない
  SENT = [];
  r = await call({ token: TOKEN, action: 'agreed' });
  is('二度目は already', [r.json.ok, r.json.already], [true, true]);
  is('二度目は何も送らない', SENT.length, 0);

  // 3日より古い同意は掘り起こさない
  DB.contract_offers[0].notified_at = null;
  DB.contract_offers[0].agreed_at = new Date(Date.now() - 4 * 86400000).toISOString();
  r = await call({ token: TOKEN, action: 'agreed' });
  is('古い同意は already 扱い', [r.json.ok, r.json.already], [true, true]);
  ok('印も付けない', DB.contract_offers[0].notified_at == null);

  // DB のお知らせが無いとき：控えの文面（送った人・担当・運営）
  DB.contract_offers[0].agreed_at = now;
  DB.contract_offers[0].consultant_id = 'p2';
  DB.profiles.push({ id: 'p2', email: 'sub@x.jp', role: 'consultant' });
  DB.agent_insights = [];
  SENT = [];
  r = await call({ token: TOKEN, action: 'agreed' });
  is('控えの宛先：送った人・担当・運営の3人', [r.json.to, r.json.mail], [3, 3]);
  const fb = SENT.find((s) => s[0] === 'mail' && s[1].to[0] === 'sub@x.jp');
  ok('控えの文面に法人名・名前・顧問料', /株式会社継　継 太郎 様が/.test(fb[1].html) && /45,000円/.test(fb[1].html));

  // パートナー契約
  DB.contract_offers.push({ id: 'o2', token: 'b'.repeat(40), kind: 'partner', email: 'np@x.jp', status: 'agreed', agreed_at: now, agreed_name: '山田', agreed_org: null, offered_by: 'a1', consultant_id: null, notified_at: null });
  SENT = [];
  r = await call({ token: 'b'.repeat(40), action: 'agreed' });
  is('パートナー契約：運営だけ（送った人＝運営）', [r.json.to, r.json.mail], [1, 1]);
  ok('パートナー契約の件名', /パートナー契約が締結されました：np@x.jp/.test(SENT[0][1].subject));
  ok('本文に認定パートナー', /認定パートナーになります/.test(SENT[0][1].html));

  // SQL 未実行
  NO_NOTIFIED_COL = true;
  DB.contract_offers[0].notified_at = null;
  SENT = [];
  r = await call({ token: TOKEN, action: 'agreed' });
  is('列が無ければ SQL 名を返し、送らない', [r.json.ok, /20260911030000_contract_notified/.test(r.json.error), SENT.length], [false, true, 0]);

  console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
  process.exit(bad.length ? 1 : 0);
})();
