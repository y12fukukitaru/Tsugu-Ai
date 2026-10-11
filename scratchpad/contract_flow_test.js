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
// 同意する前は、契約者の欄の空欄の行とプランの行を出さない（2026-10-11 その3）
{
  const body = '■ 契約者\n  法人名：＿＿＿＿＿＿＿＿＿＿＿＿\n  ご担当者名：＿＿＿＿＿＿＿＿\n  メールアドレス：a@b.jp\n  契約日：＿＿＿年＿＿月＿＿日\n  プラン：{{プラン}}\n  顧問料：月額 45,000円（税別）\n\n第2条（顧問料）\n  乙は甲に対し、契約時のプラン（{{プラン}}）の月額を払う。';
  const pre = P.ctBody({ body, plan: 'buyer', status: 'sent' });
  ok('同意前：契約者の欄はメールアドレスと顧問料だけ（空欄とプランの行は出さない）', !/法人名：|ご担当者名：|契約日：|  プラン：/.test(pre) && /メールアドレス：a@b\.jp/.test(pre) && /顧問料：月額 45,000円/.test(pre));
  ok('同意前：お名前などは下の欄に書く案内を1行', (pre.match(/※ お名前などは、下の欄にご記入ください/g) || []).length === 1);
  ok('同意前：条文の中のプランは埋めて残す', /契約時のプラン（買い手プラン（成長））/.test(pre));
  const done = P.ctBody({ body: body.replace('＿＿＿＿＿＿＿＿＿＿＿＿', '株式会社継'), plan: 'buyer', status: 'agreed' });
  ok('同意後の控えは全文のまま', /法人名：株式会社継/.test(done) && /契約日：/.test(done) && /  プラン：/.test(done));
  ok('記入済みの所属本部は残す', /所属本部：本部A/.test(P.ctBody({ body: '■ 契約者\n  所属本部：本部A\n  お名前：＿＿＿', status: 'sent' })));
}
ok('説明書：同意前の契約者の欄', ['manual-customer.html', 'manual-buyer.html', 'manual-seller.html'].every((f) => /<b>メールアドレスと顧問料だけ<\/b>が出ます/.test(R(f))));
// 解約で消した方は新規扱い（v3）と、説明書（2026-10-11 その4）
const cv3 = R('supabase/migrations/20261011020000_contract_claim_v3.sql');
ok('SQL v3：Supabase の画面で消したアカウントの契約は受け取れる／解約の手続きで消した方の契約は受け取らない', /not exists \(select 1 from auth\.users u where u\.id = c\.claimed_user_id\)\s*\n[\s\S]{0,300}and not exists \(select 1 from public\.account_deletions d\s*\n\s*where d\.deleted_user_id = c\.claimed_user_id\)/.test(cv3) && /onboarded = true/.test(cv3) && /grant execute on function public\.contract_claim\(\) to authenticated;/.test(cv3));
const adm = R('manual-admin.html');
ok('説明書（運営）：契約から登録までの頁（流れと止まったときの確かめ）', /data-t="契約から登録まで（流れと確かめ）"/.test(adm) && /URL Configuration/.test(adm) && /20261011020000_contract_claim_v3\.sql/.test(adm) && /同意済みの顧問契約も、登録し直した方には引き継がれません/.test(adm));
ok('説明書（パートナー）：相手に見える契約書・解約で消した方は新規扱い', /同意する前は「契約者」の欄に<b>メールアドレスと顧問料だけ<\/b>が出て/.test(R('manual-partner.html')) && /解約の手続きで運営が消した方は新規扱い/.test(R('manual-partner.html')));
// 契約のときに所在地・電話番号もいただく（2026-10-11 その5。法人番号は聞かない＝その6）
{
  const H = takeFn('ctHtml');
  ok('入力欄：所在地（住所）・電話番号は必須', /id="ct-addr"/.test(H) && /id="ct-tel" class="inp" type="tel" inputmode="tel"/.test(H));
  ok('法人番号は聞かない（欄も、送るものも、一覧の表示も無い）', !/法人番号|ct-corp|p_corp_no|ctCorpOk|agreed_corp_no/.test(SRC));
  ok('入力欄の下に使い道と、電話番号は控えに載らないこと', /契約の相手を確かめることと、ご連絡にだけ/.test(H) && /電話番号は控え（このURL）には載りません/.test(H));
  const N = new Function(takeFn('ctNorm') + 'return { ctNorm };')();
  is('全角の電話番号を半角に', N.ctNorm('０８２－１２３ー４５６７'), '082-123-4567');
  const ag = takeFn('ctAgree');
  ok('同意：所在地・電話番号を送る（足りなければ送る前に止める）', /Object\.assign\(\{ p_address: adr, p_tel: tel \}, base\)/.test(ag) && ag.indexOf("say(needOrg?'所在地") < ag.indexOf("sb.rpc('contract_agree'") && /tel\.replace\(\/\[\^0-9\]\/g,''\)\.length<10/.test(ag));
  ok('SQL がまだの環境では、前の形で同意だけは記録する', /PGRST202\|Could not find the function/.test(ag) && /r=await sb\.rpc\('contract_agree', base\)/.test(ag));
  ok('一覧（運営・送った人）に所在地・電話番号', /'📍 '\+esc\(o\.agreed_address\)/.test(takeFn('ctRowHtml')) && /'　☎ '\+esc\(o\.agreed_tel\)/.test(takeFn('ctRowHtml')));
  const cc = R('supabase/migrations/20261011030000_contract_contact.sql');
  ok('SQL：列・前の形を消して作り直す・控えに所在地（電話番号は入れない）', /add column if not exists agreed_tel/.test(cc) && /drop function if exists public\.contract_agree\(text, text, text, text\);/.test(cc) && /placing mail_line \|\| extra/.test(cc) && !/extra := [^;]*tel/.test(cc));
  ok('SQL：受け取りで電話番号をプロフィールへ・EP-II 所属をパートナー契約として扱う', /phone = coalesce\(nullif\(btrim\(phone\),''\), nullif\(btrim\(o\.agreed_tel\),''\)\)/.test(cc) && /'partner','partner_ep1','partner_ep2','partner_ep2_member'/.test(cc) && /public\.account_deletions/.test(cc));
  ok('説明書・情報の守り：所在地・電話番号（法人番号は書かない）', ['manual-customer.html', 'manual-buyer.html', 'manual-seller.html'].every((f) => /所在地（会社の住所）・電話番号<\/b>をご記入ください/.test(R(f)) && !/法人番号/.test(R(f))) && /所在地・電話番号を記入<\/b>し、同意すると成立/.test(R('manual-partner.html')) && !/法人番号/.test(R('manual-partner.html') + R('manual-admin.html')) && /契約のときの所在地・電話番号/.test(R('security.html')));
}
if (bad.length) { console.log(JSON.stringify(bad, null, 1)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
