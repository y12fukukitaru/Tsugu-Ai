// =============================================================
// 新規の顧問契約の流れ（2026-10-11）
//   契約書が横にずれない／{{プラン}} が記号のまま出ない／「登録へ進む」で新規登録へ／
//   残っていた古いログインで止まらない／確認メールの戻り先／画面が横に動いたままにならない
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
let n = 0, bad = [];
function is(name, got, want) { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) bad.push({ name, got: g, want: w }); }
function ok(name, c) { is(name, !!c, true); }
function takeFn(name) {
  let i = SRC.indexOf('\n  function ' + name + '('); if (i < 0) i = SRC.indexOf('\n  async function ' + name + '(');
  if (i < 0) throw new Error(name);
  return SRC.slice(i, SRC.indexOf('\n  }\n', i) + 4);
}
// 契約書
ok('本文は必ず折り返す（「──────」や長い英数字でも枠の中で横に動かない）', /\.ct-text\{overflow-wrap:anywhere;word-break:break-word;overflow-x:hidden;\}/.test(SRC) && /'<div class="ct-text" style=/.test(takeFn('ctHtml')));
ok('狭い画面では余白を詰める', /\.ct-page\{padding:16px 10px !important;\}/.test(SRC) && /id="contract" class="hidden ct-page"/.test(SRC) && /id="ct-body" class="ct-card"/.test(SRC));
const P = new Function(takeFn('ctPlanName') + takeFn('ctBody') + 'return { ctPlanName, ctBody };')();
is('{{プラン}} を埋める（買い手）', P.ctBody({ body: 'プラン：{{プラン}}／（{{プラン}}）', plan: 'buyer' }), 'プラン：買い手プラン（成長）／（買い手プラン（成長））');
is('{{プラン}} を埋める（売り手）', P.ctBody({ body: 'プラン：{{プラン}}', plan: 'seller' }), 'プラン：売り手プラン（譲渡準備）');
is('プランが分からないとき（SQL がまだ）も記号は出さない', P.ctBody({ body: 'プラン：{{プラン}}' }), 'プラン：お申し込みのプラン');
ok('「ご契約の条件」の枠にプラン', /ctPlanName\(d\.plan\)\?'<div[^']*>プラン　'\+esc\(ctPlanName\(d\.plan\)\)/.test(takeFn('ctHtml')));
const sql = R('supabase/migrations/20261011000000_contract_open_plan.sql');
ok('SQL：開いたときもプランを埋めて、plan も返す（同意のときと同じ言い方）', /replace\(b, '\{\{プラン\}\}'/.test(sql) && /'plan', o\.plan/.test(sql) && /when o\.plan = 'seller' then '売り手プラン（譲渡準備）'/.test(sql) && /grant execute on function public\.contract_open\(text\) to anon, authenticated;/.test(sql) && /b := o\.agreed_body;/.test(sql));
// 登録へ進む
const to = takeFn('ctToLogin');
ok('「登録へ進む」：別の方のログインが残っていたら外す', /CT_DATA\.status==='agreed'/.test(to) && /!==em\) await sb\.auth\.signOut\(\{ scope:'local' \}\);/.test(to) && /sessionStorage\.setItem\('tsugu_ct_signup', em\)/.test(to));
const ho = takeFn('ctSignupHandoff');
ok('新規登録の画面を、メールアドレス入りで開く', /showTab\('signup'\);/.test(ho) && /if\(a\) a\.value=em; if\(b\) b\.value=em;/.test(ho) && /sessionStorage\.removeItem\('tsugu_ct_signup'\)/.test(ho));
ok('起動時：ログインしていなければ引き継ぎ→リンクの期限切れの案内', /else \{ showAuth\(\); if\(!ctSignupHandoff\(\)\) authLinkError\(\); \}/.test(SRC));
// 古いログイン
const rs = takeFn('routeFromSession');
ok('読めないとき、サーバーに確かめて無効なら黙ってログイン画面へ（知らせの窓を出さない）', /var gu=null; try\{ gu=await sb\.auth\.getUser\(\); \}/.test(rs) && /signOut\(\{ scope:'local' \}\); \}catch\(e\)\{\}\s*\n\s*showAuth\(\);/.test(rs) && rs.indexOf('getUser') < rs.indexOf('alert('));
ok('それでも読めないときは、詳細を添えて知らせる', /\(prof\.why\?'\\n（詳細：'\+prof\.why\+'）':''\)/.test(rs) && /why:\(up\.error&&up\.error\.message\)/.test(takeFn('getProfile')));
// 確認メール
const su = takeFn('doSignup');
ok('確認メールの戻り先をこのアプリに（Site URL が違っていても 404 にしない）', /options:\{ emailRedirectTo: authReturnUrl\(\) \}/.test(su) && /location\.origin\+location\.pathname/.test(takeFn('authReturnUrl')));
ok('「確認メールを送りました」はタブを切り替えたあとに出す（消えない）', su.indexOf("showTab('login')") < su.indexOf("setMsg('login','確認メールを "));
ok('確認リンクの期限切れ（otp_expired）を案内', /otp_expired/.test(takeFn('authLinkError')) && /history\.replaceState/.test(takeFn('authLinkError')));
// 横にずれない
ok('根元（html）でも横に動かさない', /\n  html\{overflow-x:hidden;\}/.test(SRC) && /\n  body\{overflow-x:clip;\}/.test(SRC));
ok('横に動いたら左端へ戻す（拡大して見ているときは除く）', /if\(window\.visualViewport && window\.visualViewport\.scale>1\.01\) return;\s*\n\s*window\.scrollTo\(0, window\.scrollY\);/.test(SRC));
// 説明書
ok('説明書（経営者・買い手・売り手）：登録へ進む・確認メール', ['manual-customer.html', 'manual-buyer.html', 'manual-seller.html'].every((f) => /新規登録の画面にメールアドレスが入った状態<\/b>で開きます/.test(R(f)) && /<b>確認メール<\/b>が届くので/.test(R(f))));
ok('説明書（パートナー）：登録へ進む', /新規登録の画面がメールアドレス入りで<\/b>開きます/.test(R('manual-partner.html')));
// 契約から登録した方を、そのまま中へ（2026-10-11 その2）
const cl = takeFn('claimLinks');
ok('契約を受け取ったかを返す', /var cc=null; try\{ cc=await sb\.rpc\('contract_claim'\); \}/.test(cl) && /return !!\(cc && !cc\.error && \/\^claimed:\/\.test/.test(cl));
ok('受け取ったら読み直してから「はじめの設定」を判断する（空のプロフィールで聞き直さない）', /if\(await claimLinks\(session\.user\.email\)\)\{[\s\S]{0,200}select\('\*'\)\.eq\('id',ME\)\.maybeSingle\(\);[\s\S]{0,120}prof=q2\.data;/.test(rs) && rs.indexOf('claimLinks(') < rs.indexOf('needsOnboard(prof)'));
const cv2 = R('supabase/migrations/20261011010000_contract_claim_v2.sql');
ok('SQL：消したアカウントが受け取った契約も、新しいアカウントで受け取れる', /or not exists \(select 1 from auth\.users u where u\.id = c\.claimed_user_id\)/.test(cv2) && /or c\.claimed_user_id = me/.test(cv2) && /order by c\.agreed_at desc/.test(cv2));
ok('SQL：会社名・お名前を入れて、はじめの設定を済みに（すでにある値は上書きしない）', /contact_name = coalesce\(nullif\(btrim\(contact_name\),''\), nullif\(btrim\(o\.agreed_name\),''\)\)/.test(cv2) && /onboarded = true/.test(cv2));
ok('SQL：担当の記録が無ければ、送った人がパートナーならその方', /if sender_role = 'consultant' then cons := o\.offered_by; end if;/.test(cv2));
ok('SQL：本人のメール（確認済み）でだけ受け取れる', /lower\(c\.email\) = my_email/.test(cv2) && /grant execute on function public\.contract_claim\(\) to authenticated;/.test(cv2));
ok('説明書：契約の内容が入った状態で始まる', ['manual-customer.html', 'manual-buyer.html', 'manual-seller.html'].every((f) => /お名前などをもう一度聞く画面は出ません/.test(R(f))) && /そのままダッシュボードへ<\/b>入ります/.test(R('manual-partner.html')));
if (bad.length) { console.log(JSON.stringify(bad, null, 1)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
