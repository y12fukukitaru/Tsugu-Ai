// =============================================================
// 口座振替の手続き・初期導入費のご案内（画面側）の試験（2026-10-15）
//   ・手続きの名前・数・ご本人への表示・依頼書の添え状
//   ・請求：手続きに合わせる（既定）・1件の切り替えの注意・CSV のお客様番号
//   ・初期導入費：契約を受け取ったらご案内メール、運営の再送、料金表の切り替え
//   ・説明書・SQL・Edge Function・版
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const VER = JSON.parse(R('version.json'));
let n = 0, bad = [];
function is(name, got, want) { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) bad.push({ name, got: g, want: w }); }
function ok(name, cond) { is(name, !!cond, true); }
function no(name, cond) { is(name, !!cond, false); }
function takeFn(name) {
  const re = new RegExp('\\n  (?:async )?function ' + name + '\\s*\\(', 'g');
  let m, last = null, cnt = 0;
  while ((m = re.exec(SRC)) !== null) { last = m; cnt++; }
  if (!last) throw new Error('見つかりません: ' + name);
  is('定義は一つだけ: ' + name, cnt, 1);
  const end = SRC.indexOf('\n  }\n', last.index);
  return SRC.slice(last.index, end + 4);
}
const base =
  'function esc(s){ return String(s==null?"":s).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];}); }' +
  'var DM_ROWS=[];' +
  takeFn('dmLabel') + takeFn('dmOf') + takeFn('dmCount') + takeFn('dmCustomerHtml') + takeFn('dmLetterHtml') + takeFn('invCsvRows');
const M = new Function(base + 'return {label:dmLabel, of:dmOf, count:dmCount, cust:dmCustomerHtml, letter:dmLetterHtml, csv:invCsvRows, set:function(r){ DM_ROWS=r; }};')();

// ① 手続き
{
  is('名前', ['preparing', 'sent', 'returned', 'registered', 'stopped'].map(M.label),
    ['用紙をお渡し（記入待ち）', '集金代行へ送付済み', '不備で返却', '登録完了', '口座振替をやめた']);
  M.set([{ customer_id: 'a', status: 'preparing' }, { customer_id: 'b', status: 'returned' }, { customer_id: 'c', status: 'registered' }, { customer_id: 'd', status: 'sent' }, { customer_id: 'e', status: 'stopped' }]);
  is('手続き中（登録完了の前）と、不備で返却', M.count(), { wait: 3, returned: 1 });
  is('お客様ごとに引ける', M.of('c').status, 'registered');
  const r = M.cust({ status: 'returned', ref_no: '100001', return_reason: '印鑑相違' });
  ok('ご本人：戻った理由と、登録までは振込', /印鑑相違/.test(r) && /100001/.test(r) && /登録が済むまでの顧問料は、銀行振込でお願いします/.test(r));
  ok('ご本人：送付済みは1〜2か月', /1〜2か月/.test(M.cust({ status: 'sent', ref_no: '1' })));
  is('ご本人：登録完了・やめたは出さない', [M.cust({ status: 'registered' }), M.cust({ status: 'stopped' }), M.cust(null)], ['', '', '']);
}
// ② 添え状
{
  const h = M.letter({ name: '株式会社<一>', ref: '100007', bank: '〇〇銀行 普通 1234567', today: '2026-10-15' });
  ok('お客様番号を大きく・書く欄', /<span class="no">100007<\/span>/.test(h) && /「お客様番号」（顧客番号）の欄/.test(h));
  ok('書き方：名義は通帳どおり・届出印は実印とは限らない・書き損じは新しい用紙', /一字一句同じ/.test(h) && /金融機関へ届け出た印鑑/.test(h) && /実印や角印とは限りません/.test(h) && /新しい用紙に書き直して/.test(h));
  ok('戻りの多い理由と、登録まで振込・二重払いの注意', /印鑑相違/.test(h) && /登録が済むまでの顧問料は、銀行振込/.test(h) && /二重にお支払いにならないよう/.test(h));
  ok('登録までのお振込先', /〇〇銀行 普通 1234567/.test(h));
  ok('口座振替はご登録の2か月後の分から', /ご登録の2か月後の月の顧問料から<\/b>始まります/.test(h));
  ok('口座情報は持たない・写真を送らない', /システムには保存しません/.test(h) && /写真をアプリやメールで送らないでください/.test(h));
  ok('会社名は文字として出す', /株式会社&lt;一&gt;/.test(h) && !/株式会社<一>/.test(h));
  ok('日々の一行と連絡先', /継ぐ、を身近な経営判断に/.test(h) && /082-548-2224/.test(h));
  no('お振込先が無ければ欄を出さない', /登録が済むまでのお振込先/.test(M.letter({ name: 'x', ref: '1', bank: '', today: '' })));
}
// ③ 請求
{
  const rows = [{ customer_id: 'c', name: 'C社', title: '顧問料', period: '2026-11', amount: 49500, paid_amount: 0, due_on: '2026-11-27', status: 'open', method: 'transfer', ref_no: '100003' }];
  is('口座振替CSV：最後にお客様番号', M.csv(rows, 'transfer')[1].slice(-1), ['100003']);
  ok('既定は「手続きに合わせる」', /<select id="inv-method" class="inp2">'[\s\S]{0,300}<option value="auto">手続きに合わせる<\/option>/.test(SRC) && /「手続きに合わせる」<\/b>は、下の「口座振替の手続き」で<b>登録完了の方だけ口座振替<\/b>/.test(SRC));
  const g = takeFn('invGenerate');
  ok('手続きに合わせる：銀行振込で立ててから、登録完了の方だけ口座振替に', /p_method:\(auto\?'bank':mth\)/.test(g) && /sb\.rpc\('invoice_apply_mandates',\{ p_period:ym \}\)/.test(g));
  ok('切り替えに失敗したら赤で知らせる', /口座振替への切り替えができませんでした/.test(g));
  const m = takeFn('invMethod');
  ok('1件の切り替え：登録前に口座振替→未収、登録後に振込→二重払い を注意', /登録が済んでいません/.test(m) && /引き落とせず、未収になります/.test(m) && /二重払い/.test(m));
  ok('見取り図に「手続き中」', /bizChip\('口座振替の手続き中'/.test(takeFn('renderInvoices')));
  ok('タブ：お客様一覧 → 手続き → 請求の順に読む', /ivaInit\(\)\.then\(loadMandates\)\.then\(loadInvoices\)/.test(SRC));
  ok('一覧：不備で返却を上に、理由と次の手', /returned:0, preparing:1/.test(takeFn('renderMandates')) && /担当パートナーから伺い/.test(takeFn('renderMandates')));
  ok('不備で返却は理由を聞く', /prompt\('戻ってきた理由をご記入ください/.test(takeFn('dmSet')));
  ok('登録完了のとき、いまの振込の請求はそのままと伝える', /いま銀行振込でご案内中の請求は、そのままにしてください/.test(takeFn('dmSet')));
  ok('用紙を準備したら添え状を開く', /dmSet\(cust, 'preparing', true\)/.test(takeFn('dmStart')) && /dmLetter\(cust\)/.test(takeFn('dmStart')));
  ok('口座番号・名義・届出印を入れない旨を画面に', /口座番号・名義・届出印は、このシステムに入れません。/.test(SRC));
  ok('ご本人のお支払い画面に手続きの様子', /from\('debit_mandates'\)\.select\('status,ref_no,return_reason'\)\.eq\('customer_id',ME\)/.test(takeFn('loadUnpaid')) && /dmCustomerHtml\(dm\.data\)/.test(takeFn('loadUnpaid')));
}
// ④ 初期導入費のご案内
{
  const c = takeFn('claimLinks');
  ok('顧問契約を受け取ったらご案内（顧客だけ）', /String\(cc\.data\|\|''\)==='claimed:customer'\) setupNoticeSend\(\)/.test(c));
  const s = takeFn('setupNoticeSend');
  ok('送っていないものがあるときだけ呼ぶ・待たない', /sb\.rpc\('setup_notice_pending'\)/.test(s) && /sb\.functions\.invoke\('billing-mail', \{ body:\{ action:'setup' \} \}\)\.catch/.test(s) && !/await sb\.functions/.test(s));
  ok('運営：請求の行から送る・再送', /invoice_id:id/.test(takeFn('invSetupMail')) && /もう一度送る/.test(takeFn('invSetupMailHtml')) && /x\.kind==='setup' \|\| x\.first\) && x\.status!=='void'\) \? invSetupMailHtml\(x\)/.test(SRC));
  ok('送れなかった理由を出す', /まだ届いていません/.test(takeFn('invSetupMailHtml')));
  const li = takeFn('loadInvoices');
  ok('初回に入れた顧問料も、ご案内の記録とひも付ける', /in\('advisory_invoice_id',sids\)/.test(li) && /x\.first=!!\(x\.notice && x\.notice\.advisory_invoice_id===x\.id\)/.test(li));
  ok('初回に入れた顧問料の行にも札とメールの状態', /\(x\.kind==='setup' \|\| x\.first\) && x\.status!=='void'\) \? invSetupMailHtml\(x\)/.test(SRC) && /初回のお振込み（初期導入費と一緒）/.test(takeFn('invSetupMailHtml')));
  ok('初回に入れた顧問料を口座振替にするときは止める', /\(to==='transfer' && row\.first\)/.test(takeFn('invMethod')) && /初回のお振込み（初期導入費と一緒）でご案内済みの顧問料です/.test(takeFn('invMethod')));
  ok('料金表：初期導入費＋翌月分、ご登録の月はいただかない', /自動で立て（初期導入費＋翌月分の顧問料）/.test(SRC) && /ご登録の月の顧問料はいただきません。<\/b>口座振替はご登録の2か月後の分から/.test(SRC));
  ok('料金表：自動で立てるかを選べる（保存対象）', /<select id="bl-setup-auto"/.test(SRC) && /var BL_RATE_IDS=\[[^\]]*'bl-setup-auto'[^\]]*\]/.test(SRC));
}
// ⑤ SQL・Edge Function・説明書・版
{
  const SQL = R('supabase/migrations/20261015000000_debit_mandate_setup_fee.sql');
  ok('SQL：口座の列を持たない', !/account_no|bank_code|holder|印影/.test(SQL.replace(/--.*$/gm, '')));
  ok('SQL：引き金は顧客の契約を受け取った最初の一度', /when \(new\.kind = 'customer' and new\.claimed_user_id is not null\s+and new\.claimed_user_id is distinct from old\.claimed_user_id\)/.test(SQL));
  ok('SQL：失敗してもログインを止めない', /exception when others then\s+raise warning 'setup_fee_on_claim/.test(SQL));
  const EF = R('supabase/functions/billing-mail/index.ts');
  ok('Edge Function：宛先は登録のアドレス', /auth\.admin\.getUserById\(customerId\)/.test(EF) && /sendOne\(sb, uid, invs, adv\)/.test(EF) && !/body\.to|body\.email/.test(EF));
  const MA = R('manual-admin.html');
  ok('運営説明書：口座振替の手続き・お客様番号・添え状', /data-t="口座振替の手続き"/.test(MA) && /お客様番号/.test(MA) && /添え状を印刷/.test(MA));
  ok('運営説明書：初期導入費の自動請求とご案内メール', /初期導入費のご案内メール/.test(MA) && /billing-mail/.test(MA));
  const MC = R('manual-customer.html');
  ok('経営者説明書：初回のお振込みのメールと、口座振替のお手続き', /「初回のお振込みのご案内」<\/b>がメールで届きます/.test(MC) && /口座振替のお手続き中です/.test(MC));
  ok('経営者説明書：ご登録の月はいただかない・2か月後から口座振替', /ご登録の月の顧問料はいただきません。/.test(MC) && /その翌月の分から口座振替/.test(MC) && /10月ご登録 → 11月分は初回のお振込み、12月分から引き落とし/.test(MC));
  ok('運営説明書：初回のお振込みと、口座振替は2か月後の分から', /初期導入費<\/b>（概要タブの額）と<b>ご登録の翌月分の顧問料<\/b>/.test(MA) && /ご登録の2か月後の分から。<\/b>/.test(MA));
  ok('パートナー説明書：初回のお振込み', /初回のお振込み（初期導入費＋翌月分の顧問料）/.test(R('manual-partner.html')));
  is('版が揃う', [SRC.match(/var APP_BUILD='([^']+)'/)[1], VER.build], [VER.build, VER.build]);
}

if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b.name, '\n   got ', b.got, '\n   want', b.want)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
