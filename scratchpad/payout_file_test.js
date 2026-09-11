// =============================================================
// 総合振込ファイル（Edge Function payout-file）の試験
//   ・全銀の文字（全角カナ→半角、濁点、小さいカナ、使えない記号）
//   ・レコード（120バイト固定長・ヘッダ／データ／トレーラ／エンド）
//   ・Shift_JIS の1バイト化
//   ・ハンドラ：運営だけ・委託者未設定・口座の無い相手は入れない・EP-I は法人の口座
// 実行: scratchpad/tsck に typescript を入れてから  node scratchpad/payout_file_test.js
// =============================================================
const fs = require('fs'), path = require('path'), cp = require('child_process');
const ROOT = path.join(__dirname, '..');
const TSCK = path.join(process.env.SCRATCH || path.join(__dirname), 'tsck');
const OUT = path.join(TSCK, 'out_payout');
let n = 0, bad = [];
function is(name, got, want) { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) bad.push({ name, got: g, want: w }); }
function ok(name, cond) { is(name, !!cond, true); }

// ---- TS → CommonJS に落として読み込む（Deno と npm: を差し替える）----
cp.execSync(`npx tsc --outDir ${OUT} --module commonjs --target es2022 --moduleResolution node --skipLibCheck --lib es2022,dom ${path.join(TSCK, 'deno-shim.d.ts')} ${path.join(ROOT, 'supabase/functions/payout-file/index.ts')}`, { cwd: TSCK, stdio: 'pipe' });
let js = fs.readFileSync(path.join(OUT, 'index.js'), 'utf8').replace('require("npm:@supabase/supabase-js@2")', '({ createClient: globalThis.__createClient })');
fs.writeFileSync(path.join(OUT, 'index.cjs'), js);

let handler = null;
globalThis.Deno = { env: { get: (k) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'svc' })[k] }, serve: (h) => { handler = h; } };
// ---- 偽の Supabase ----
const DB = {};
function fakeSb() {
  const q = (table) => {
    const st = { table, filters: [] };
    const api = {
      select() { return api; }, eq(k, v) { st.filters.push([k, v]); return api; }, in(k, v) { st.filters.push([k, v]); return api; },
      is(k, v) { st.filters.push([k, v]); return api; },
      maybeSingle() { return Promise.resolve(run(true)); },
      then(res) { return Promise.resolve(run(false)).then(res); },
    };
    function run(single) {
      let rows = (DB[table] || []).filter((r) => st.filters.every(([k, v]) => Array.isArray(v) ? v.includes(r[k]) : (v === null ? r[k] == null : r[k] === v)));
      return { data: single ? (rows[0] || null) : rows, error: null };
    }
    return api;
  };
  return {
    from: q,
    rpc(name, args) {
      DB.__rpc = (DB.__rpc || []).concat([[name, args]]);
      if (name === 'payout_account_for_transfer') {
        return Promise.resolve({ data: (DB.__accts || []).filter((a) => args.p_users.includes(a.user_id)), error: null });
      }
      return Promise.resolve({ data: null, error: { message: 'unknown rpc ' + name } });
    },
  };
}
globalThis.__createClient = () => fakeSb();
let AUTH_USER = null;
globalThis.fetch = async (url) => {
  if (String(url).includes('/auth/v1/user')) return AUTH_USER ? new Response(JSON.stringify(AUTH_USER), { status: 200 }) : new Response('', { status: 401 });
  throw new Error('unexpected fetch ' + url);
};
const M = require(path.join(OUT, 'index.cjs'));
ok('Deno.serve でハンドラが登録される', typeof handler === 'function');

// ---------------------------------------------------------------
// ① 文字
// ---------------------------------------------------------------
{
  is('全角カナ→半角', M.zenginText('カ）ツグアイ').text, 'ｶ)ﾂｸﾞｱｲ');
  is('濁点は別の1文字', M.zenginText('ガギグ').text, 'ｶﾞｷﾞｸﾞ');
  is('半濁点', M.zenginText('パピ').text, 'ﾊﾟﾋﾟ');
  is('小さいカナは大きく', M.zenginText('キャッシュ').text, 'ｷﾔﾂｼﾕ');
  is('長音・中黒', M.zenginText('スーパー・エー').text, 'ｽｰﾊﾟｰ.ｴｰ');
  is('英小文字は大文字・全角英数も半角', M.zenginText('abcＡＢ１２').text, 'ABCAB12');
  is('半角カナはそのまま', M.zenginText('ｶ)ﾂｸﾞｱｲ').text, 'ｶ)ﾂｸﾞｱｲ');
  const d = M.zenginText('継太郎');
  is('漢字は空白にして知らせる', d.text, '   ');
  is('落とした文字', d.dropped, ['継', '太', '郎']);
  is('全角スペースは半角に', M.zenginText('ヤマダ　タロウ').text, 'ﾔﾏﾀﾞ ﾀﾛｳ');
  is('padNum は左0埋め', M.padNum('123', 7), '0000123');
  is('padNum は数字以外を落とす', M.padNum('12-34', 7), '0001234');
  is('padNum は長すぎれば右を残す', M.padNum('123456789', 7), '3456789');
  is('padR は右空白', M.padR('AB', 4), 'AB  ');
  is('padR は切る', M.padR('ABCDE', 3), 'ABC');
  is('種別コード', [M.acctTypeCode('futsu'), M.acctTypeCode('touza'), M.acctTypeCode('chochiku')], ['1', '2', '4']);
}

// ---------------------------------------------------------------
// ② レコード
// ---------------------------------------------------------------
{
  const sender = { code: '1234567890', name: 'ｶ)ﾂｸﾞｱｲ', bank: '0310', branch: '101', type: '1', acct: '1234567' };
  const payees = [
    { bank_code: '0005', branch_code: '123', account_type: 'futsu', account_no: '7654321', holder: 'ﾔﾏﾀﾞ ﾀﾛｳ', amount: 123456 },
    { bank_code: '0009', branch_code: '001', account_type: 'touza', account_no: '11', holder: 'ｶ)ﾎｳｼﾞﾝ', amount: 1000000 },
  ];
  const L = M.zenginLines(sender, '0925', payees);
  is('4行（ヘッダ・データ2・トレーラ・エンド）', L.length, 5);
  ok('全行120バイト', L.every((l) => l.length === 120));
  is('ヘッダ：データ区分1・種別21・JIS', L[0].slice(0, 4), '1210');
  is('ヘッダ：委託者コード', L[0].slice(4, 14), '1234567890');
  is('ヘッダ：委託者名40', L[0].slice(14, 54), 'ｶ)ﾂｸﾞｱｲ' + ' '.repeat(33));
  is('ヘッダ：振込指定日', L[0].slice(54, 58), '0925');
  is('ヘッダ：仕向銀行・支店', [L[0].slice(58, 62), L[0].slice(77, 80)], ['0310', '101']);
  is('ヘッダ：預金種目と口座', [L[0][95], L[0].slice(96, 103)], ['1', '1234567']);
  is('データ：区分2・銀行', L[1].slice(0, 5), '20005');
  is('データ：支店', L[1].slice(20, 23), '123');
  is('データ：種目・口座', [L[1][42], L[1].slice(43, 50)], ['1', '7654321']);
  is('データ：受取人名30', L[1].slice(50, 80), 'ﾔﾏﾀﾞ ﾀﾛｳ' + ' '.repeat(22));
  is('データ：金額10', L[1].slice(80, 90), '0000123456');
  is('データ：新規コード・振込区分', [L[1][90], L[1][111]], ['0', '7']);
  is('データ2：当座・口座は左0埋め', [L[2][42], L[2].slice(43, 50)], ['2', '0000011']);
  is('トレーラ：件数と合計', [L[3][0], L[3].slice(1, 7), L[3].slice(7, 19)], ['8', '000002', '000001123456']);
  is('エンド', L[4][0] + L[4].trim().length, '91');
  const B = M.toSjisBytes('Aｱﾞ\r\n');
  is('Shift_JIS 1バイト化：A=0x41 ｱ=0xB1 ﾞ=0xDE', Array.from(B), [0x41, 0xb1, 0xde, 0x0d, 0x0a]);
  is('Shift_JIS：範囲外は空白', Array.from(M.toSjisBytes('漢')), [0x20]);
}

// ---------------------------------------------------------------
// ③ ハンドラ
// ---------------------------------------------------------------
async function call(body, jwt) {
  const req = new Request('https://x/payout-file', { method: 'POST', headers: jwt ? { Authorization: 'Bearer ' + jwt, 'content-type': 'application/json' } : { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const res = await handler(req);
  return { status: res.status, json: await res.json() };
}
(async () => {
  const items = [{ kind: 'user', id: 'u1', amount: 50000, label: '山田' }, { kind: 'ep', id: 'ep1', amount: 120000, label: '法人A' }, { kind: 'user', id: 'u3', amount: 7000, label: '口座なし' }];
  // 未ログイン
  AUTH_USER = null;
  let r = await call({ date: '0925', items }, 'tok');
  is('未ログインは401', r.status, 401);
  // 運営でない
  AUTH_USER = { id: 'p1' };
  DB.profiles = [{ id: 'p1', role: 'consultant' }, { id: 'a1', role: 'admin' }];
  r = await call({ date: '0925', items }, 'tok');
  is('運営以外は403', r.status, 403);
  // 委託者未設定
  AUTH_USER = { id: 'a1' };
  DB.app_settings = [{ key: 'billing_rates', value: { 'bl-sc': '', 'bl-sname': '' } }];
  r = await call({ date: '0925', items }, 'tok');
  is('委託者未設定は ok:false（200）', [r.status, r.json.ok], [200, false]);
  ok('未設定の項目を名指し', /委託者コード/.test(r.json.error) && /銀行コード/.test(r.json.error));
  // 振込指定日なし
  DB.app_settings = [{ key: 'billing_rates', value: { 'bl-sc': '0000000001', 'bl-sname': 'ｶ)ﾂｸﾞｱｲ', 'bl-sbank': '0310', 'bl-sbranch': '101', 'bl-stype': '1', 'bl-sacct': '1234567' } }];
  r = await call({ date: '', items }, 'tok');
  is('振込指定日が無ければ400', r.status, 400);
  // 本番相当
  DB.payout_accounts = [{ user_id: 'mgr', ep_id: 'ep1', status: 'registered', forgotten_at: null }];
  DB.__accts = [
    { user_id: 'u1', bank_name: 'みずほ銀行', bank_code: '0001', branch_name: '本店', branch_code: '001', account_type: 'futsu', account_no: '1111111', holder_kana: 'ヤマダ　タロウ' },
    { user_id: 'mgr', bank_name: 'GMOあおぞら', bank_code: '0310', branch_name: '法人営業部', branch_code: '101', account_type: 'futsu', account_no: '2222222', holder_kana: 'ｶ)ﾎｳｼﾞﾝｴｰ' },
  ];
  DB.__rpc = [];
  r = await call({ ym: '2026-09', date: '0925', items }, 'tok');
  is('作れる', [r.status, r.json.ok, r.json.count, r.json.total], [200, true, 2, 170000]);
  is('口座の無い相手は入らず理由が付く', r.json.skipped.map((s) => s.label), ['口座なし']);
  is('EP-I は法人の口座（管理者の行）で引く。取り出しは1回', [DB.__rpc.length, DB.__rpc[0][1].p_users.sort()], [1, ['mgr', 'u1', 'u3']]);
  const bytes = Buffer.from(r.json.zengin_b64, 'base64');
  const lines = bytes.toString('latin1').split('\r\n').filter(Boolean);
  is('全銀ファイルは3＋件数行', lines.length, 5);
  ok('全行120バイト（Shift_JIS）', lines.every((l) => l.length === 120));
  is('データ行の金額', [lines[1].slice(80, 90), lines[2].slice(80, 90)], ['0000050000', '0000120000']);
  ok('CSV に確認用の列と2行', r.json.csv.startsWith('﻿') && r.json.csv.split('\r\n').filter(Boolean).length === 3);
  ok('CSV に名義（全銀の形）が入る', /ﾔﾏﾀﾞ ﾀﾛｳ/.test(r.json.csv));
  is('警告なし', r.json.warnings, []);
  // 名義に漢字が混じる・銀行コード未登録
  DB.__accts[0].holder_kana = 'ヤマダ 太郎';
  DB.__accts.push({ user_id: 'u3', bank_name: 'X', bank_code: null, branch_name: 'Y', branch_code: null, account_type: 'futsu', account_no: '3', holder_kana: 'ｴｯｸｽ' });
  r = await call({ ym: '2026-09', date: '0925', items }, 'tok');
  ok('使えない文字は警告', r.json.warnings.some((w) => /山田/.test(w) && /太郎/.test(w)));
  ok('銀行コード未登録は入らない', r.json.skipped.some((s) => s.label === '口座なし' && /銀行コード/.test(s.why)));
  // 対象なし
  r = await call({ ym: '2026-09', date: '0925', items: [{ kind: 'user', id: 'u9', amount: 0, label: 'x' }] }, 'tok');
  is('金額0は対象なし（400）', r.status, 400);

  console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
  process.exit(bad.length ? 1 : 0);
})();
