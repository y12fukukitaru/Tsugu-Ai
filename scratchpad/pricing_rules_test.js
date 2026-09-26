// =============================================================
// 料金の決めごとの試験（LP・特定商取引法に基づく表示と、画面・資料を突き合わせる）
//   お金の話は、書いてあることと実際の計算がずれた瞬間に信用を失う。
//     ① 利用料は「その月に入金のあった顧問先」だけで計算する
//     ② 入金のあった顧問先が0社の月は、基本料（登録料）もいただかない
//     ③ EP-I の担当者ぶんも、入金のあった顧問先を持つ方だけを数える
//     ④ 初期導入費はプランで違う（買い手 100,000／売り手 50,000）
//     ⑤ M&Aの手数料の条件（レーマン・着手金0・最低手数料なし・譲渡価額基準・
//        片側のみ・顧問契約はプラン変更でも通算）
//     ⑥ プラン変更の差額と、解約のときの扱い
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const MANC = R('manual-customer.html'), MANP = R('manual-partner.html'),
      MANA = R('manual-admin.html'), MANE = R('manual-ep.html');
const PITC = R('pitch-customer.html'), PITG = R('pitch-general.html'),
      PITB = R('pitch-bank.html'), PITF = R('pitch-finance.html'), PITE2 = R('pitch-ep2.html');
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
  return SRC.slice(last.index, SRC.indexOf('\n  }\n', last.index) + 4);
}

// ①② 利用料の計算そのもの
{
  const M = new Function(
    'function taxIn(v){ return Math.round((Number(v)||0)*11/10); }' +
    'function yen(v){ return "¥"+Math.round(Number(v)||0).toLocaleString("ja-JP"); }' +
    fn('payUsageFee') + fn('payUsageNote') +
    'return { fee:payUsageFee, note:payUsageNote };')();
  const rates = { base: 3000, per: 2000, seat: 3000 };
  //  個人：入金のあった顧問先の数で決まる
  is('個人・3社', [M.fee(3, null, rates).ex, M.fee(3, null, rates).inc], [3000 + 2000 * 3, 9900]);
  is('個人・1社', M.fee(1, null, rates).ex, 5000);
  //  ここがいちばん大事。0社の月に基本料だけ立ってはいけない
  is('個人・0社なら基本料もかからない', M.fee(0, null, rates).ex, 0);
  is('個人・0社は税込も0', M.fee(0, null, rates).inc, 0);
  //  EP-II の所属営業も同じ（登録料1人ぶん ＋ AI×社数）
  is('EP-II・2社', M.fee(2, { ep_kind: 'EP2' }, rates).ex, 3000 + 2000 * 2);
  is('EP-II・0社なら0', M.fee(0, { ep_kind: 'EP2' }, rates).ex, 0);
  //  EP-I はご本人からは引かない（法人がまとめてご負担）
  is('EP-I はご本人から引かない', M.fee(5, { ep_kind: 'EP1' }, rates).ex, 0);
  //  0社の月は「引かなかった」と書く。黙って0円だと引き忘れに見える
  ok('0社の月の断り', /入金のあった顧問先が無いため、基本料もいただいていません/.test(M.note(M.fee(0, null, rates))));
  ok('内訳に「入金のあった顧問先」と書く', /× 3社（入金のあった顧問先）/.test(M.note(M.fee(3, null, rates))));
  is('EP-I には内訳を出さない', M.note(M.fee(5, { ep_kind: 'EP1' }, rates)), '');
}
// ①③ 配分画面の数え方
{
  const lp = fn('loadPayout');
  ok('その月に入金のあった顧問先を覚える', /b\.paid\[r\.customer_id\]=1;/.test(lp));
  ok('利用料の土台は入金のあった顧問先の数', /b\.clients=Object\.keys\(b\.paid\)\.length;/.test(lp));
  ok('総社数はスケール判定にだけ残す', /b\.allClients=payClients\[k\]\|\|0;/.test(lp)
    && /rankFeeRate\(p\.fde_rank, payClients\[c\.consultant_id\]\|\|0/.test(lp));
  ok('EP-I も入金から数える（席は入金のある担当者だけ）',
    /if\(Object\.keys\(b\.paid\)\.length>0\) g\.seats\+\+;/.test(lp)
    && /g\.clientFee=g\.clients\*uRates\.per;/.test(lp));
  ok('画面にも数え方を書く', /その月に入金のあった顧問先<\/b>だけです/.test(lp)
    && /入金のあった顧問先が0社の月は、基本料（登録料）もいただきません/.test(lp));
  //  ご本人の明細も同じ数え方でないと、振込額が明細と合わない
  const pd = fn('poFetch');
  ok('ご本人の明細も入金のあった顧問先で数える', /paidC\[x\.custId\]=1/.test(pd)
    && /clients:Object\.keys\(paidC\)\.length/.test(pd));
}
// ④ 初期導入費はプランで違う
{
  ok('定数が2つある', /var EP_SETUP_FEE=100000;/.test(SRC) && /var EP_SETUP_SELLER=50000;/.test(SRC));
  ok('運営の設定欄も2つ', /blIn\('bl-init',/.test(SRC) && /blIn\('bl-initseller',/.test(SRC));
  const rb = fn('renderAdmBilling');
  ok('試算はプランごとに掛ける', /var initThisMonth=newB\*init\+newS\*initSeller;/.test(rb));
  no('一律で掛けていない', /var initThisMonth=newC\*init;/.test(rb));
  no('本体に「初期導入費は全社一律」は残っていない', /初期導入費は<b>全社一律/.test(fn('renderAdmBilling')) || /初期導入費は<b>全社一律 '\+EP_SETUP_FEE/.test(SRC));
  //  資料・説明書にも両方の額
  [['pitch-customer', PITC], ['pitch-general', PITG], ['pitch-bank', PITB],
   ['pitch-finance', PITF], ['manual-customer', MANC], ['manual-admin', MANA]].forEach(function (x) {
    ok(x[0] + '：初期導入費が2プラン', /100,000円/.test(x[1]) && /50,000\s?円/.test(x[1]));
  });
  ok('金融機関向けの年間も直っている', /50,000 \+ 35,000×12 = <b>470,000円<\/b>／次年度以降 <b>420,000円<\/b>/.test(PITF));
}
// ⑤ M&A の手数料の条件
{
  ok('本体：基準は譲渡価額（株価）', /譲渡価額（株価）<\/b>で、負債は含みません/.test(SRC));
  ok('本体：着手金等0円・最低手数料なし', /着手金・中間金・月額報酬は0円、最低手数料はありません/.test(SRC));
  ok('本体：双方からは取らない', /同一の案件で双方からはいただきません/.test(SRC));
  ok('本体：プラン変更でも通算', /プランを変更しても期間は通算/.test(SRC));
  no('本体：最低報酬を濁す言い方は残っていない', /実際の料率・最低報酬額は契約内容に従ってください/.test(SRC));
  ok('顧客説明書：M&Aの手数料の頁', /data-t="M&Aの手数料"/.test(MANC)
    && /5億円以下 5%／5億円超10億円以下 4%/.test(MANC)
    && /着手金 0円・中間金 0円・月額報酬（リテイナー）0円・最低手数料なし/.test(MANC)
    && /双方から報酬をいただくことはありません/.test(MANC));
  ok('運営説明書にも同じ条件', /譲渡価額（株価・負債を含まない）/.test(MANA)
    && /着手金・中間金・月額報酬は0円、最低手数料はありません/.test(MANA));
  //  顧問契約の起点はプランではない（プランを変えても通算される）
  ok('優遇の起点は契約開始日', /faPerk\(prof\.onboard_start\|\|prof\.created_at\)/.test(SRC));
  //  最低報酬は、どなたにもない。顧問先の優遇は割引だけ。
  //  「1年以上なら最低報酬なし」と書くと、1年未満には最低報酬があるように読める
  const MINFEE = /最低報酬(なし|を設けず|はかかりません|あり|がなくな|額は別途)/;
  const PITP = R('pitch-partner.html');
  [['index.html', SRC], ['pitch-customer.html', PITC], ['pitch-bank.html', PITB], ['pitch-partner.html', PITP],
   ['manual-customer.html', MANC], ['manual-partner.html', MANP], ['manual-admin.html', MANA]].forEach(([f, s]) => {
    no(f + '：1年以上だけ最低報酬なし、と読める言い方は無い', MINFEE.test(s));
  });
  const FIX = fs.existsSync(__dirname + '/../supabase/migrations/20260925000000_fa_no_minimum.sql')
    ? R('supabase/migrations/20260925000000_fa_no_minimum.sql') : '';
  ok('契約書ひな形を直す SQL がある', /FA報酬に最低報酬額は設けません/.test(FIX));
}
// ⑥ プラン変更の差額と、解約
{
  ok('顧客説明書：売り手→買い手は差額5万円', /変更後の初月に初期導入費の差額<b>50,000円<\/b>/.test(MANC));
  ok('顧客説明書：買い手→売り手は3か月以内なら返金', /3か月目の月末まで<\/b>に変更される場合に限り/.test(MANC));
  ok('顧客説明書：解約は申し出た月の末日', /お申し出いただいた月の末日をもって終了<\/b>/.test(MANC)
    && /初期導入費と、ご利用済みの月の顧問料は返金いたしません/.test(MANC));
  ok('運営説明書：手順の頁がある', /data-t="プラン変更と解約のお金"/.test(MANA)
    && /単発の請求<\/b>で立てます/.test(MANA));
}
// ⑦ パートナー向けの書きぶり
{
  ok('パートナー説明書：入金のあった月だけ', /その月に顧問料の入金があったとき<\/b>だけ/.test(MANP));
  ok('パートナー説明書：0社なら基本料なし', /基本料の 3,000円もいただきません/.test(MANP));
  ok('パートナー説明書：2026年内は0円', /2026年内にご登録の方/.test(MANP) && /月額利用料は0円<\/b>/.test(MANP));
  ok('EP説明書：いつ何社ぶん掛かるか', /data-t="配分とご利用料"/.test(MANE)
    && /入金のあった顧問先のぶんだけ<\/b>を加算/.test(MANE));
  ok('EP-II の資料も入金ベース', /2,000 円 × 入金のあった顧問先の数/.test(PITE2));
}

// ⑧ エンタープライズの卸値も2プラン
{
  const SQL2 = R('supabase/migrations/20260915010000_ep_plan.sql');
  const PITE1 = R('pitch-ep1.html');
  //  顧問先ごとのプランが画面に届いているか（届かないと一律で計算してしまう）
  ok('SQL：ep_people がプランを返す', /returns table \(id uuid, email text, name text, role text, plan text\)/.test(SQL2)
    && /when p\.role = 'customer' then p\.plan else null end/.test(SQL2));
  ok('SQL：ep_book が顧問先のプランを返す', /customer_plan text/.test(SQL2) && /c\.email, c\.stage, c\.plan/.test(SQL2));
  ok('SQL：戻り値が変わるので作り直す', /drop function if exists public\.ep_people\(uuid\);/.test(SQL2)
    && /drop function if exists public\.ep_book\(uuid\);/.test(SQL2));
  no('SQL：anon には渡さない', /grant execute on function public\.ep_(people|book)\(uuid\) to anon/.test(SQL2));
  //  画面側
  ok('本体：プランで額を出し分ける道具', /function epPlan\(d,id\)/.test(SRC)
    && /function epFeeOf\(plan\)/.test(SRC) && /function epSetupOf\(plan\)/.test(SRC));
  ok('本体：名前とプランを一緒に持つ', /plan:p\.plan\|\|null/.test(SRC) && /plan:r\.customer_plan\|\|null/.test(SRC));
  const cl = fn('epClientsHtml');
  ok('顧問先の一覧は行ごとにプランで計算', /var pk=epPlan\(d, c\.customer_id\);/.test(cl)
    && /epYen\(epFeeOf\(pk\)\)/.test(cl) && /epYen\(splitOf\(pk\)\.hq\)/.test(cl));
  ok('受領を記録もプランの額', /epSetSetup\(\\''\+escJ\(c\.id\)\+'\\','\+epSetupOf\(pk\)\+'\)/.test(cl));
  no('顧問先の一覧に「全社一律」は残っていない', /全社一律/.test(cl));
  const s1 = fn('epSum1');
  ok('EP-I の受取は1社ずつ足す', /live\.forEach\(function\(c\)\{/.test(s1) && /hq\+=s1\.hq; tg\+=s1\.tsugu;/.test(s1));
  ok('EP-I の配分表は4行（顧問料と初期導入費 × 2プラン）',
    (s1.match(/epSplitRow\(/g) || []).length === 4);
  //  資料と説明書
  ok('EP-I の資料に売り手の額', /売り手 35,000円/.test(PITE1) && /<b>28,000円<\/b><\/td><td style="text-align:right;">7,000円/.test(PITE1) && /<b>40,000円<\/b>/.test(PITE1));
  ok('EP-II の資料に売り手の額', /売り手 35,000円　Lv\.2/.test(PITE2) && /買い手 4,500円／売り手 3,500円/.test(PITE2));
  ok('EP 説明書に4行の配分表', /売り手 35,000円／社・月/.test(MANE) && /売り手 50,000円／社/.test(MANE)
    && /本部 3,500円（一律10%）/.test(MANE) && /法人 28,000円（80%）<\/b>／TsuguAi 7,000円/.test(MANE));
  ok('EP 説明書：どちらのプランかは画面の札で分かる', /どちらのプランか/.test(MANE) && /の札で出ます/.test(MANE));
}
// ⑦ 売り手プランの顧問料は 35,000円（2026-09-26 に 30,000円 から変更）
{
  const PITE1 = R('pitch-ep1.html');
  ok('本体の標準は 35,000', /var EP_SELLER_FEE=35000;/.test(SRC) && !/var EP_SELLER_FEE=30000;/.test(SRC));
  ok('継ナビくんの知識も 35,000', /売り手プラン\(譲渡準備\)35,000円/.test(SRC) && !/売り手プラン\(譲渡準備\)30,000円/.test(SRC));
  //  「運営直接担当 30,000円・一律」は廃止した旧価格の説明なので残してよい
  const DOCS = ['pitch-customer.html', 'pitch-ep1.html', 'pitch-ep2.html', 'pitch-finance.html', 'pitch-bank.html',
    'pitch-general.html', 'pitch-partner.html', 'manual-customer.html', 'manual-partner.html', 'manual-admin.html',
    'manual-ep.html', 'recruit-partner.html'];
  DOCS.forEach(function (f) {
    const t = R(f).replace(/運営直接担当 30,000円・一律/g, '');
    no(f + '：売り手の月額に 30,000円 が残っていない', /売り手[^。<]{0,20}30,000\s?円/.test(t));
    no(f + '：売り手の月額に 30,000円（表の中）が残っていない', /売り手[^。]{0,40}<b>30,000円<\/b>|30,000 円<div[^>]*><span class="scr-tag gold">売り手/.test(t));
  });
  //  EP-I：80%＝28,000／20%＝7,000。10社・30社の例も計算どおり
  ok('EP-I 1社：28,000／7,000', 35000 * 0.8 === 28000 && 35000 - 28000 === 7000);
  ok('EP-I 10社：受取 344,000・差引 312,000・約374万',
    8 * 36000 + 2 * 28000 === 344000 && 344000 - 32000 === 312000 && Math.round(312000 * 12 / 10000) === 374
    && /<td>344,000円<\/td><td>−32,000円<\/td><td><b>312,000円<\/b><\/td><td>約374万円<\/td>/.test(PITE1));
  ok('EP-I 30社：受取 1,032,000・差引 957,000・約1,148万',
    24 * 36000 + 6 * 28000 === 1032000 && 1032000 - 75000 === 957000 && Math.round(957000 * 12 / 10000) === 1148
    && /<td>1,032,000円<\/td><td>−75,000円<\/td><td><b>957,000円<\/b><\/td><td class="up">約1,148万円<\/td>/.test(PITE1));
  //  EP-II：担当 Lv.2/3/4＝17,500/21,000/24,500、本部 3,500、TsuguAi は残り
  ok('EP-II 売り手の配分', [[0.5, 17500, 14000], [0.6, 21000, 10500], [0.7, 24500, 7000]].every(function (r) {
    return Math.round(35000 * r[0]) === r[1] && 35000 - r[1] - 3500 === r[2]
      && new RegExp('<b>' + r[1].toLocaleString('en-US') + '</b></td><td style="text-align:right;">3,500</td><td style="text-align:right;color:#8A6A12;">' + r[2].toLocaleString('en-US') + '</td>').test(PITE2);
  }));
  ok('EP 説明書：担当者は 17,500〜24,500円', /Lvの料率（17,500〜24,500円）/.test(MANE));
  ok('プラン変更の月額も 35,000', /月額は 35,000円 から <b>45,000円<\/b>/.test(MANC) && /月額は 45,000円 から <b>35,000円<\/b>/.test(MANC)
    && /月額は 35,000円 → <b>45,000円<\/b>/.test(MANP) && /月額は 45,000円 → <b>35,000円<\/b>/.test(MANP));
}
console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
