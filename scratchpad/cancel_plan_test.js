// =============================================================
// プランの変更と解約の導線の試験
//   ・経営者：「お支払い」の上に「ご契約について」があり、
//     プランの変更と解約がそこに揃っているか
//   ・担当パートナー：顧問先の解約のお申し出がカルテに出るか
//   ・説明書（経営者・パートナー）に手順とお金が載っているか
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const MANC = R('manual-customer.html'), MANP = R('manual-partner.html');
const SQL = R('supabase/migrations/20260903010000_cancel_requests.sql');
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

// ① 経営者：置き場所
{
  const panel = SRC.slice(SRC.indexOf('<div class="panel" id="sec-billpay">'), SRC.indexOf('<div class="panel" id="sec-cash">'));
  ok('「お支払い」に「ご契約について」の箱がある', panel.indexOf('id="my-contract"') > 0);
  //  探させないための変更なので、位置そのものが仕様
  //  決済リンク（カード決済）はやめたので、比べる先はお支払い方法の案内
  ok('お支払い方法の案内より上にある', panel.indexOf('id="my-contract"') < panel.indexOf('銀行振込または口座振替'));
  ok('明細やCSVより上にある', panel.indexOf('id="my-contract"') < panel.indexOf('id="cst-out"'));
  no('解約の欄を画面の末尾に置いたままにしない', /id="cst-out"[\s\S]{0,120}id="my-cancel"/.test(panel));
  ok('読み込みは顧客の起動に入っている', /loadPlanRates\(\)\.then\(loadMyContract\);/.test(SRC));
}
// ② 経営者：中身
{
  const mc = takeFn('loadMyContract');
  ok('いまのプランと月額', /いまの顧問プラン/.test(mc) && /planFee\(plan\)/.test(mc));
  ok('変えかたは担当パートナーへ、効くのは翌月', /担当パートナーにお申し出ください/.test(mc) && /翌月のご請求から/.test(mc));
  ok('その場で押してメッセージが開く', /knvToggle\(true\);knvShowTab\(\\'msg\\'\)/.test(mc));
  ok('依頼中は二度申し出させない', /from\('plan_requests'\)/.test(mc) && /へ切替を依頼中/.test(mc));
  //  額は定数から出す（画面に数字を直接書かない）
  ok('差額は定数から', /EP_SETUP_FEE-EP_SETUP_SELLER/.test(mc));
  ok('買い手へは初月に差額、売り手へは3か月目の月末まで返金', /変更後の初月に初期導入費の差額/.test(mc) && /3か月目の月末まで/.test(mc));
  ok('優遇の年数は通算', /プランを変更しても通算/.test(mc));
  ok('解約の欄はこの箱の中', mc.indexOf('id="my-cancel"') > 0 && mc.indexOf('loadMyCancel();') > 0);
  const my = takeFn('loadMyCancel');
  ok('押す前に、終わる日と返金のこと', /月の末日をもって終了/.test(my) && /返金いたしません/.test(my));
  ok('押してもすぐには終わらない', /押してすぐに使えなくなることはありません/.test(my));
  //  表が無い環境で黙って消えると、申し出る先が画面から消える
  ok('表が無くても申し出る先は出す', /担当パートナーへメッセージでお知らせください/.test(my));
  no('表が無いときに空にしない', /if\(!r \|\| r\.error\)\{ box\.innerHTML=''; return; \}/.test(my));
}
// ③ 経営者：出口の設計からの案内（同じことを二か所に書かない）
{
  const ex = takeFn('exitHtml');
  ok('出口の設計から「お支払い」へ送る', /goSec\(\\'sec-billpay\\'\)/.test(ex) && /ご契約について/.test(ex));
  ok('パートナーの依頼ボタンの下に、額と時期', /切り替えるのは運営です/.test(ex) && /EP_SETUP_FEE-EP_SETUP_SELLER/.test(ex) && /翌月の請求から/.test(ex));
}
// ④ 担当パートナー：顧問先の解約のお申し出
{
  const cc = takeFn('loadClientCancel');
  ok('開いている依頼だけを、その顧問先のぶん読む', /eq\('customer_id',custId\)/.test(cc) && /eq\('status','open'\)/.test(cc));
  ok('日付と理由を出す', /jstDay\(c\.created_at\)/.test(cc) && /c\.reason/.test(cc) && /c\.note/.test(cc));
  ok('手続きは運営だと明記する', /運営が行います/.test(cc) && /この画面から解約することはできません/.test(cc));
  ok('まず話を聞く', /お話をうかがってください/.test(cc));
  ok('カルテのいちばん上に置く', /var head='<div id="cl-head"><div id="cl-cancel"><\/div>'/.test(SRC));
  ok('カルテを開いたら読む', /loadClientCancel\(custId\);/.test(SRC));
  //  権限はもともとある（画面が無かっただけ）
  ok('SQL に担当パートナーの読み取りがある', /cancel_requests partner read/.test(SQL) && /cancel_partner_can_see/.test(SQL));
}
// ⑤ 継ナビくんが場所を答えられるか
{
  ok('経営者むけの案内に新しい場所', /お支払い=画面のいちばん上に「ご契約について」/.test(SRC));
  ok('パートナーむけの案内に赤い帯', /カルテのいちばん上に赤い帯/.test(SRC));
  ok('パートナー自身の離脱は運営サポートへ', /パートナーご自身が離れるときは運営サポート/.test(SRC));
}
// ⑥ 説明書
{
  const pages = (h) => (h.match(/data-t="([^"]+)"/g) || []).map((s) => s.slice(8, -1));
  const cp = pages(MANC), pp = pages(MANP);
  ok('経営者の説明書に専用の頁', cp.indexOf('プランの変更と解約') >= 0 && cp.indexOf('変更と解約のお金') >= 0);
  ok('パートナーの説明書に専用の頁', pp.indexOf('プランの変更と解約') >= 0 && pp.indexOf('変更と解約のお金') >= 0);
  //  章（data-g）が飛び飛びだと、目次が二つに割れる
  [['manual-customer', MANC], ['manual-partner', MANP]].forEach(function (x) {
    const gs = (x[1].match(/data-g="([^"]+)"/g) || []).map((s) => s.slice(8, -1));
    const seen = [];
    let dup = [];
    gs.forEach((g, i) => { if (g !== gs[i - 1]) { if (seen.indexOf(g) >= 0) dup.push(g); seen.push(g); } });
    is(x[0] + '：章は続けて並んでいる', dup, []);
  });
  //  手順が「どこを押すか」まで書いてあること
  ok('経営者：お支払いのいちばん上だと書く', /「お支払い」を開いた、いちばん上/.test(MANC));
  ok('経営者：変更の手順', /✉️ 担当パートナーに伝える/.test(MANC) && /翌月のご請求から/.test(MANC));
  ok('経営者：解約の手順と取り下げ', /解約を依頼する/.test(MANC) && /この内容で依頼する/.test(MANC) && /取り下げる/.test(MANC));
  ok('経営者：お金の表', /売り手 → 買い手/.test(MANC) && /買い手 → 売り手/.test(MANC) && /3か月目の月末まで/.test(MANC));
  ok('パートナー：依頼の手順', /への切替を運営に依頼/.test(MANP) && /空欄のままでも送れてしまう/.test(MANP));
  ok('パートナー：解約は赤い帯で気づく', /解約のご依頼が出ています/.test(MANP) && /まずお話をうかがってください/.test(MANP));
  ok('パートナー：自分が離れるとき', /運営への問い合わせ/.test(MANP) && /ご自身の契約を画面から終える操作はありません/.test(MANP));
  //  金額は published の条件どおりか（下げも上げもしない）
  [['manual-customer', MANC], ['manual-partner', MANP]].forEach(function (x) {
    ok(x[0] + '：差額は50,000円', /50,000円/.test(x[1]));
    ok(x[0] + '：日割りはしない', /日割りの精算は/.test(x[1]));
    ok(x[0] + '：優遇の年数は通算', /プランを変更しても通算/.test(x[1]));
  });
  ok('経営者：お支払いの行から新しい頁へ送る', /「プランの変更と解約」/.test(MANC));
}
// ⑦ 版
{
  const build = SRC.match(/var APP_BUILD='([^']+)'/)[1];
  is('版が揃う', [build, VER.build], ['20260924-01', '20260924-01']);
}
console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
