// =============================================================
// エンタープライズ（EP-I／EP-II）の配線の試験
//   画面に書いてあることと、実際に動く計算がずれていないかを見る。
//   ずれたまま気づかないと、そのままご請求・お振込になる。
//     ① EP-I の 80% が、配分の計算にも使われているか
//     ② EP-II の本部一律10% が、支払と振込ファイルに乗っているか
//     ③ EP-II の概要が、本部にご請求しない額を出していないか／0社と出ないか
//     ④ EP-I の主担当が profiles.consultant_id に映るか（窓口と呼び出し）
//     ⑤ EP-II の所属パートナー契約に、本部（ep_id）が入るか
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const SQL = fs.readFileSync(__dirname + '/../supabase/migrations/20260914010000_ep_main_grant_sync.sql', 'utf8');
const MANE = fs.readFileSync(__dirname + '/../manual-ep.html', 'utf8');
let n = 0, bad = [];
function is(name, got, want) { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) bad.push({ name, got: g, want: w }); }
function ok(name, cond) { is(name, !!cond, true); }
function no(name, cond) { is(name, !!cond, false); }
function fn(name) {
  const re = new RegExp('\\n  (?:async )?function ' + name + '\\s*\\(', 'g');
  let m, last = null, cnt = 0;
  while ((m = re.exec(SRC)) !== null) { last = m; cnt++; }
  if (!last) throw new Error('見つかりません: ' + name);
  is('定義は一つだけ: ' + name, cnt, 1);
  const end = SRC.indexOf('\n  }\n', last.index);
  return SRC.slice(last.index, end + 4);
}
const PAY = fn('loadPayout');
const SUM2 = fn('epSum2');
const GRANT = fn('epSetGrant');
const REVOKE = fn('epRevokeMember');
const SEND = fn('ctSend');
const SENDADM = fn('ctSendAdmin');
const ADMCT = fn('loadAdmContracts');

// ① EP-I の 80%
{
  ok('配分は EP-I なら EP_I_PCT を使う',
    /af\s*&&\s*af\.ep_kind==='EP1'\s*\)\s*\?\s*EP_I_PCT/.test(PAY));
  ok('EP-I 以外はこれまでどおり rankFeeRate', /:\s*rankFeeRate\(p\.fde_rank/.test(PAY));
  ok('行に「EP-I 法人の率」と出す', /EP-I 法人の率/.test(PAY) && /b\.ep1rate=/.test(PAY));
  ok('注記でも EP-I はランクで変わらないと断る',
    /EP-I<\/b> は法人との契約で決めた率/.test(PAY) && /ランクやスケールでは変わりません/.test(PAY));
}
// ② EP-II の本部一律10%
{
  ok('本部ぶんを積む', /hqG\[af\.ep_id\]\.fee \+= net\*EP_HQ_PCT/.test(PAY));
  ok('EP-II のときだけ積む', /if\(af && af\.ep_kind==='EP2'\)\{/.test(PAY));
  ok('本部の振込先は管理者の席から引く',
    /from\('ep_members'\)[\s\S]{0,200}eq\('seat_role','manager'\)/.test(PAY));
  ok('本部の欄を出す', /EP-II：本部へのお支払い（一律10%）/.test(PAY));
  ok('合計の札にも出す', /EP-II 本部へ 合計/.test(PAY));
  ok('振込ファイルにも入れる',
    /hqOrder\.forEach\(function\(g?\w*\)\{[\s\S]{0,400}fileItems\.push/.test(PAY));
  ok('管理者がいない法人はファイルに入れず理由を出す',
    /EP-II 本部・管理者が未設定/.test(PAY) && /有効な管理者の席がありません/.test(PAY));
  ok('本部には利用料を差し引かない', !/hqG\[[^\]]+\]\.use/.test(PAY));
  ok('所属を引けなかったら本部10%も出ないと断る',
    /本部への一律10%も出ません/.test(PAY));
}
// ③ EP-II の概要
{
  no('本部に「継へのご利用料」の表を出さない', /epCostBox\(/.test(SUM2));
  ok('本部のご負担は0円と出す', /本部のご負担（月）/.test(SUM2) && /'0 円'/.test(SUM2));
  ok('負担するのは所属の方だと書く', /所属の認定パートナーご本人/.test(SUM2));
  ok('社数は担当表（ep_book）から数える',
    /\(d\.book\|\|\[\]\)\.forEach/.test(SUM2) && /Object\.keys\(cus\)\.length/.test(SUM2));
  no('社数に ep_clients を使わない', /epActive\(d\)/.test(SUM2));
}
// ④ 主担当 → 顧客管理
{
  ok('主担当を決めたら窓口を呼ぶ',
    /role==='main'/.test(GRANT) && /rpc\('ep_sync_client_consultant'/.test(GRANT));
  ok('窓口が断ったら失敗として出す', /sd\.ok===false/.test(GRANT));
  ok('席を外す前に担当も外す', /rpc\('ep_sync_client_consultant'/.test(REVOKE)
    && REVOKE.indexOf("rpc('ep_sync_client_consultant'") < REVOKE.indexOf("update({ status:'revoked'"));
  ok('外せなかったら席はそのままにする', /席はそのままにしています/.test(REVOKE));
  ok('割当の画面に、顧客管理にも出ると書く', /「顧客管理」の一覧とカルテにも出ます/.test(SRC));
  // 窓口（SQL）の守り
  ok('SQL：関数がある', /create or replace function public\.ep_sync_client_consultant/.test(SQL));
  ok('SQL：管理者か運営だけ', /ep_is_manager\(p_ep\) or public\.ep_is_admin\(\)/.test(SQL));
  ok('SQL：EP-II では動かさない', /v_kind <> 'EP1'/.test(SQL));
  ok('SQL：自法人の稼働中の顧問先だけ', /from public\.ep_clients c[\s\S]{0,160}c\.status = 'active'/.test(SQL));
  ok('SQL：入れられるのは活きている席の人だけ',
    /from public\.ep_members m[\s\S]{0,160}m\.status = 'active'[\s\S]{0,120}update public\.profiles set consultant_id = p_user/.test(SQL));
  ok('SQL：よその担当は消さない', /'kept', v_cur/.test(SQL));
  ok('SQL：記録に残す', /'grant_sync'/.test(SQL));
  no('SQL：anon には渡さない', /grant execute on function public\.ep_sync_client_consultant\(uuid, uuid, uuid\) to anon/.test(SQL));
  ok('SQL：authenticated にだけ渡す',
    /grant execute on function public\.ep_sync_client_consultant\(uuid, uuid, uuid\) to authenticated/.test(SQL));
  ok('説明書も直っている', /顧客管理」<\/b>の一覧とカルテにも出ます/.test(MANE));
}
// ⑤ 契約に本部を入れる
{
  ok('ctSend が ep_id を受け取る', /function ctSend\(kind, pfx, epId\)/.test(SEND));
  ok('ctSend が ep_id を入れる', /if\(epId\) row\.ep_id=epId;/.test(SEND));
  ok('EP-II 所属契約は本部を選ばないと送れない',
    /k==='partner_ep2_member' && !ep/.test(SENDADM) && /所属する本部を選んでください/.test(SENDADM));
  ok('選んだ本部を渡す', /ctSend\(k, 'cta', ep\|\|null\)/.test(SENDADM));
  ok('本部の欄がある', /id="cta-ep"/.test(ADMCT) && /id="cta-epwrap"/.test(ADMCT));
  ok('EP-II の法人だけを出す', /eq\('kind','EP2'\)/.test(ADMCT));
  ok('法人がまだ無いときは断る', /EP-II の法人がまだ登録されていません/.test(ADMCT));
  ok('種類を選び直すと欄が出入りする',
    /onchange="ctKindPick\(\)"/.test(ADMCT) && /function ctKindPick\(\)/.test(SRC));
}

console.log(bad.length ? JSON.stringify(bad, null, 1) : '', n + ' checks, ' + bad.length + ' failed');
process.exit(bad.length ? 1 : 0);
