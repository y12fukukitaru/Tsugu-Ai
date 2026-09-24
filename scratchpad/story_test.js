// =============================================================
// 説明資料の試験：「株式会社継（架空）の3年間」の数字が、式どおりで、
// 資料どうし・デモの画面どうしで食い違っていないか
// -------------------------------------------------------------
//  説明のあいだに「さっきは1,800万と言ったのに、画面では180万」のような
//  食い違いがあると、聞き手はそこで止まる。数字はすべて一つの例から出す。
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
let n = 0, bad = [];
function ok(name, cond) { n++; if (!cond) bad.push(name); }
function no(name, cond) { ok(name, !cond); }

const PITC = R('pitch-customer.html'), PITP = R('pitch-partner.html'), PITG = R('pitch-general.html'),
      PITB = R('pitch-bank.html'), REC = R('recruit-partner.html');

// ① 例の数字（万円）。式は本体と同じ
const Y0 = { sales: 27600, op: 1800, dep: 640, cash: 900, debt: 3400 };
const Y1 = { sales: 28800, op: 2160, dep: 640, cash: 1200, debt: 2800 };
const Y3 = { sales: 36800, op: 3280, dep: 1140, cash: 3000, debt: 3100 };
const value = (y) => (y.op + y.dep) * 5 + y.cash - y.debt;          // 企業価値 = EBITDA×5 + 現預金 − 借入
const months = (y) => Math.round(y.cash / (y.sales / 12) * 10) / 10; // 現預金の月商倍率
const payback = (y) => Math.round(y.debt / (y.op + y.dep) * 10) / 10; // 債務償還年数 = 借入 ÷ EBITDA（本体と同じ）
const rate = (y) => Math.round(y.op / y.sales * 1000) / 10;          // 利益率
{
  ok('企業価値：契約した月 9,700万', value(Y0) === 9700);
  ok('企業価値：1年後 1億2,400万', value(Y1) === 12400);
  ok('企業価値：3年後 約2億2,000万', Math.abs(value(Y3) - 22000) <= 200);
  ok('月商倍率 0.4 → 0.5 → 1.0', months(Y0) === 0.4 && months(Y1) === 0.5 && months(Y3) === 1.0);
  ok('債務償還年数 1.4 → 1.0 → 0.7', payback(Y0) === 1.4 && payback(Y1) === 1.0 && payback(Y3) === 0.7);
  ok('利益率 6.5 → 7.5 → 8.9', rate(Y0) === 6.5 && rate(Y1) === 7.5 && rate(Y3) === 8.9);
  //  1年目の＋360万は、見直し180万＋値付け180万
  ok('1年目の増益 ＝ 180 ＋ 180', Y1.op - Y0.op === 180 + 180);
  //  価値の増え方：利益×5 ＋ 現金 ＋ 返済
  ok('価値の増え ＝ 1,800 ＋ 300 ＋ 600', value(Y1) - value(Y0) === 1800 + 300 + 600);
  //  3年後の利益：本業2,400 ＋ 運送520 ＋ 配送の内製化360
  ok('3年後の利益 ＝ 2,400 ＋ 520 ＋ 360', Y3.op === 2400 + 520 + 360);
  //  2〜3年目 ＋1,120万 ＝ 520 ＋ 360 ＋ 本業の伸び240
  ok('2〜3年目の増益 ＝ 520 ＋ 360 ＋ 240', Y3.op - Y1.op === 520 + 360 + 240);
  //  買える大きさ：自己資金600（現預金の半分）＋ デット2,000
  ok('自己資金は現預金の半分', Y1.cash / 2 === 600);
  //  買う会社：営業利益520万 × 4〜6倍
  ok('価格の目安 2,080〜3,120万', 520 * 4 === 2080 && 520 * 6 === 3120 && 520 * 5 === 2600);
  //  FA報酬 130万（5%）、顧問先は1年で10%引き
  ok('FA報酬 130万 → 10%引き 117万', 2600 * 0.05 === 130 && 130 * 0.9 === 117);
  //  旗：2億円／2029（あと3年強）→ 利益なら月＋127万
  ok('旗 2億円に届く月の利益 ＋127万', Math.round((20000 - value(Y1)) / 5 / 12) === 127);
}

// ② 顧客向け：物語の表と、デモの画面（1年後）が同じ数字
{
  const T = (PITC.match(/<section class="slide" data-t="3年間を数字で">[\s\S]*?<\/section>/) || [''])[0];
  ['2億7,600万', '2億8,800万', '3億6,800万', '1,800万', '2,160万', '3,280万', '6.5%', '7.5%', '8.9%',
    '900万', '1,200万', '3,000万', '0.4か月', '0.5か月', '1.0か月', '3,400万', '2,800万', '3,100万',
    '1.4年', '1.0年', '0.7年', '9,700万', '1億2,400万', '約2億2,000万'].forEach(function (v) {
    ok('3年間の表に ' + v, T.indexOf(v) >= 0);
  });
  //  デモの画面は「1年後」
  const demo = PITC.split('data-t="1年後の画面"')[1] || '';
  ok('1年後の画面のあとにデモ', demo.indexOf('data-t="①ダッシュボード"') >= 0);
  ok('②：旗は 2億円／2029', PITC.indexOf('2億円 / 2029') >= 0 && PITC.indexOf('利益なら月 +127万で届く') >= 0);
  ok('②：買う会社は 年商6,800・利益520', /6,800/.test(PITC) && /520/.test(PITC));
  ok('②：価格の目安と手元資金', PITC.indexOf('2,080〜3,120万') >= 0 && PITC.indexOf('2.1か月分 → 1.0か月分') >= 0);
  ok('②：買ったあとの営業利益', PITC.indexOf('2,160万 → 2,680万') >= 0);
  ok('⑤：予算 2,600万まで', PITC.indexOf('2,600万まで') >= 0 && PITC.indexOf('自己資金600万＋借入余力2,000万・返済月28万まで') >= 0);
  ok('⑦：月商の0.5か月分・債務償還 1.0年', PITC.indexOf('月商の 0.5か月分') >= 0 && PITC.indexOf('債務償還年数1.0年') >= 0);
  //  債務償還年数は、本体と同じく 借入 ÷ EBITDA。営業利益だけで割った古い数字を残さない
  ok('本体の債務償還年数は 借入÷EBITDA', /m\.debtYears\s*=.*debt\/\(ebitdaM\*12\)/.test(R('index.html')));
  ['1.8年', '1.3年', '0.9年'].forEach(function (v) { no('顧客向けに古い債務償還年数「' + v + '」が残っていない', PITC.indexOf(v) >= 0); });
  //  消した食い違い
  ['月商の 2.1か月分', '180万 → 780万', '2億円 / 2028', '6.2年', '2,400〜3,600万', '1.4か月分'].forEach(function (v) {
    no('顧客向けに古い数字「' + v + '」が残っていない', PITC.indexOf(v) >= 0);
  });
  //  最低報酬は「顧問契約が1年を過ぎたら」なし。顧問先なら誰でも、ではない
  ok('最低報酬の言い方は「1年を過ぎると」', PITC.indexOf('顧問契約が1年を過ぎると最低報酬がなくなります') >= 0);
  no('「顧問先には最低報酬がありません」と言い切っていない', /顧問先には最低報酬がありません/.test(PITC));
  //  物語の順番
  const order = ['全体の地図', '物語の会社', '⑧契約から90日', '第1｜土台づくり', '第2｜現金を増やす', '第3｜買い手の余力を測る',
    '第4｜次の1社の条件を決める', '1年後の画面', '2年目｜M&amp;Aの進み方', '2年目｜お金の話', '買った後の100日', '3年目｜柱が2本に',
    '3年間を数字で', '約束すること・しないこと', '料金'];
  let last = -1, inOrder = true;
  order.forEach(function (t) { const i = PITC.indexOf('data-t="' + t + '"'); if (i < 0 || i < last) inOrder = false; last = i; });
  ok('顧客向けの物語が順番どおり', inOrder);
}

// ③ ほかの資料も同じ例
{
  ok('パートナー向け：伴走の3年間・担当先の数字・M&Aでの役割・残るもの',
    ['伴走の3年間', '担当先の3年間を数字で', 'M&amp;Aでのあなたの役割', 'あなたに残るもの'].every(function (t) { return PITP.indexOf('data-t="' + t + '"') >= 0; }));
  ok('パートナー向け：月商倍率の単位は「か月」', PITP.indexOf('>0.5か月<') >= 0 && PITP.indexOf('>0.5倍<') < 0);
  //  成功報酬の配分は決まった数字が無い。資料で作らない
  ok('パートナー向け：成功報酬の配分は案件ごと', PITP.indexOf('成功報酬の配分は、案件ごとに運営と事前に') >= 0);
  ok('一般向け：1社の3年間', PITG.indexOf('data-t="1社の3年間"') >= 0);
  [['pitch-general', PITG], ['pitch-bank', PITB], ['recruit-partner', REC], ['pitch-partner', PITP]].forEach(function (x) {
    no(x[0] + '：古い価格の目安（2,400〜3,600万）が残っていない', x[1].indexOf('2,400〜3,600万') >= 0);
  });
  [['pitch-general', PITG], ['pitch-bank', PITB], ['recruit-partner', REC]].forEach(function (x) {
    ok(x[0] + '：価格の目安 2,080〜3,120万', x[1].indexOf('2,080〜3,120万') >= 0);
  });
}

// ④ 話す内容：全部の頁にあり、紙には出ず、T で開け閉め
{
  [['pitch-customer', PITC], ['pitch-partner', PITP], ['pitch-general', PITG]].forEach(function (x) {
    const secs = x[1].match(/<section class="slide[^"]*"[\s\S]*?<\/section>/g) || [];
    const miss = secs.filter(function (s) { return s.indexOf('<div class="talk">') < 0; }).length;
    ok(x[0] + '：全部の頁に話す内容（' + secs.length + '枚・無し ' + miss + '）', secs.length > 0 && miss === 0);
    ok(x[0] + '：話す内容は紙に出さない', /\.talk\{display:none!important;\}/.test(x[1]));
    ok(x[0] + '：下の欄とボタン', x[1].indexOf('<div id="talkp" aria-live="polite"></div>') >= 0 && x[1].indexOf('id="talkb" onclick="talkToggle()"') >= 0);
    ok(x[0] + '：送るたびに欄を書き換える', /talkPaint\(\);\n\}/.test(x[1]) && x[1].indexOf('function talkPaint()') >= 0);
    ok(x[0] + '：T キー', x[1].indexOf("if(e.key==='t'||e.key==='T'){ e.preventDefault(); talkToggle(); }") >= 0);
    ok(x[0] + '：印刷では欄を隠す', /@media print\{ #talkp\{display:none!important;\} \}/.test(x[1]));
  });
  ok('顧客向けの表紙に15分の道順', /15分しかないときは次の順だけ/.test(PITC));
  no('表紙で「15分だけ」と言わない（全部で30分）', /15分だけ/.test(PITC));
}

// ⑤ エンタープライズ（EP-I／EP-II）：同じ1社の物語と、積み上がる収入の数字
{
  const E1 = R('pitch-ep1.html'), E2 = R('pitch-ep2.html');
  const has = (src, t) => src.indexOf('data-t="' + t + '"') >= 0;
  ok('EP-I：物語の頁がそろっている', ['顧問先の行き先', '2つの顧問契約', '1社の3年間', '担当者のカルテ', '顧問先の画面（1年後）',
    '会社の値段が上がると', '企業が変わると', '担当者の方へ', '10社・30社で見ると'].every(function (t) { return has(E1, t); }));
  ok('EP-II：物語の頁がそろっている', ['本部の収入の形', '積み上がる受取', '1社の3年間', '所属の方のカルテ', '顧問先の画面（1年後）',
    '関係が変わる'].every(function (t) { return has(E2, t); }));
  //  EP-I の受取：買い手 36,000・売り手 24,000（80%）、初期導入費 80,000・40,000
  ok('EP-I 10社：受取 336,000・利用料 32,000・差引 304,000',
    8 * 36000 + 2 * 24000 === 336000 && 10 * 2000 + 4 * 3000 === 32000 && E1.indexOf('336,000円') >= 0 && E1.indexOf('<b>304,000円</b>') >= 0);
  ok('EP-I 30社：受取 1,008,000・利用料 75,000・差引 933,000',
    24 * 36000 + 6 * 24000 === 1008000 && 30 * 2000 + 5 * 3000 === 75000 && E1.indexOf('1,008,000円') >= 0 && E1.indexOf('<b>933,000円</b>') >= 0);
  ok('EP-I 初期導入費：10社 720,000・30社 2,160,000',
    8 * 80000 + 2 * 40000 === 720000 && 24 * 80000 + 6 * 40000 === 2160000 && E1.indexOf('720,000円') >= 0 && E1.indexOf('2,160,000円') >= 0);
  ok('EP-I 年にすると 約365万・約1,120万', Math.round(304000 * 12 / 10000) === 365 && Math.round(933000 * 12 / 10000) === 1120
    && E1.indexOf('約365万円') >= 0 && E1.indexOf('約1,120万円') >= 0);
  ok('EP-I M&Aの例：117万の5割＝58.5万', 117 * 0.5 === 58.5 && E1.indexOf('その5割の58.5万が御社へ') >= 0);
  ok('EP-I 利益100万で値段は約500万（×5）', E1.indexOf('会社の値段は<b>約500万</b>') >= 0);
  ok('EP-I：いまの顧問契約はそのまま、別の契約', E1.indexOf('税務の顧問はそのまま') >= 0 && E1.indexOf('別の仕事として、別の契約で') >= 0);
  ok('EP-I：担当者の方へ（現場から所内へ）', E1.indexOf('その1社から所内に提案') >= 0);
  //  EP-I は「事業承継・M&A支援部門の立ち上げをお手伝いする」建付け（2026-09-24）。
  //  分担（FAは運営・成約時は手数料の5割が御社へ）と料金は据え置き
  ok('EP-I：表紙は部門の立ち上げ', E1.indexOf('事業承継・M&amp;A支援部門</span>を。') >= 0 && E1.indexOf('部門の立ち上げをお手伝いする形です') >= 0);
  ok('EP-I：部門の頁がそろっている', ['部門をつくる', '部門の組織図', '立ち上げの90日', '部門の成績表'].every(function (t) { return has(E1, t); }));
  ok('EP-I：物語の順（部門をつくる → EP-Iとは → 組織図 … 90日 → 収入 → 成績表）',
    E1.indexOf('data-t="部門をつくる"') < E1.indexOf('data-t="EP-Iとは"') && E1.indexOf('data-t="EP-Iとは"') < E1.indexOf('data-t="部門の組織図"')
    && E1.indexOf('data-t="担当者の方へ"') < E1.indexOf('data-t="立ち上げの90日"') && E1.indexOf('data-t="立ち上げの90日"') < E1.indexOf('data-t="収入"')
    && E1.indexOf('data-t="10社・30社で見ると"') < E1.indexOf('data-t="部門の成績表"') && E1.indexOf('data-t="部門の成績表"') < E1.indexOf('data-t="画面で見る"'));
  ok('EP-I：分担は今のまま（FAは運営、成約で5割）', E1.indexOf('買い手候補の特定から先の実行（FA）は<b>TsuguAiの運営</b>が担い、成約したときは手数料の<b>5割</b>が御社に入ります') >= 0);
  ok('EP-I：看板は仲介ではなく支援', E1.indexOf('看板は「仲介」ではなく<b>「事業承継・M&amp;A支援」</b>') >= 0);
  ok('EP-I：部門は仲介・価格交渉・契約実務をしない', E1.indexOf('部門は<b>仲介・価格交渉・契約実務をしません</b>') >= 0);
  ok('EP-I：料金は据え置き（立ち上げの別料金なし）', E1.indexOf('立ち上げのための別料金はありません') >= 0
    && /ボリュームディスカウント・EP登録料・月額下限・法人管理料は<b>ありません<\/b>/.test(E1));
  ok('EP-I：成績表の差引は10社の例と同じ', /部門の差引（月）<\/td><td class="up">304,000円/.test(E1));
  ok('本体：資料の説明にも部門の立ち上げ', R('index.html').indexOf('事業承継・M&A支援部門の立ち上げ（組織図・90日・成績表）') >= 0);
  ok('EP-I：相続税評価額は算定しない', E1.indexOf('相続税評価額はTsuguAiでは算定しません') >= 0);
  //  EP-II の本部：1社 4,500円（買い手）
  ok('EP-II 本部の受取 30社・60社・90社', 30 * 4500 === 135000 && 60 * 4500 === 270000 && 90 * 4500 === 405000
    && ['135,000円', '270,000円', '405,000円', '162万円', '324万円', '486万円'].every(function (v) { return E2.indexOf(v) >= 0; }));
  ok('EP-II 初期導入費（本部分）30社で30万', 30 * 10000 === 300000 && E2.indexOf('30万円') >= 0);
  ok('EP-II：保険の手数料とは別の収入', E2.indexOf('保険の手数料とは別の、毎月積み上がる収入を') >= 0);
  //  保険の締結は、募集人資格のある所属の方ならご本人の本業として（2026-09-23 運営の判断）
  ok('EP-II：保険は募集人資格があればご本人の本業として', E2.indexOf('募集人資格をお持ちの所属の方なら、ご自身の本業として') >= 0);
  no('EP-II：「運営へ取り次ぐ決まり」を残していない', E2.indexOf('有資格の運営担当へ取り次ぐ決まり') >= 0);
  //  M&A：手数料（税抜き）のうち 本部1割・所属パートナー4割・運営5割
  ok('EP-II M&A：本部1割・所属4割・運営5割', E2.indexOf('本部に1割、担当の所属パートナーに4割') >= 0
    && Math.round(117 * 0.1 * 10) / 10 === 11.7 && Math.round(117 * 0.4 * 10) / 10 === 46.8 && E2.indexOf('本部に11.7万、佐藤さんに46.8万') >= 0);
  ok('本体・説明書にも同じ配分', R('index.html').indexOf('本部に1割、担当の所属パートナーに4割</b>をお支払いします（運営が5割）') >= 0
    && R('manual-ep.html').indexOf('EP-II は<b>本部に1割・担当の所属パートナーに4割</b>') >= 0);
  //  有資格のパートナーは自分で実行してよい
  ok('本体：有資格なら本人が実行（SELF_EXEC_OK）', /var SELF_EXEC_OK = true;/.test(R('index.html'))
    && R('index.html').indexOf('募集人資格をお持ちの方はご自身の所属代理店の募集人として行って構いません') >= 0);
  ok('EP-II：所属の方 Lv.2・3社で 67,500円', 3 * 22500 === 67500 && E2.indexOf('月67,500円') >= 0);
  //  デモの写しも、1年後の株式会社継の数字
  [['pitch-ep1', E1], ['pitch-ep2', E2]].forEach(function (x) {
    ok(x[0] + '：顧問先の画面は1年後の数字', x[1].indexOf('1億2,400万') >= 0 && x[1].indexOf('2,080〜3,120万円') >= 0 && x[1].indexOf('2億円 / 2029') >= 0);
    ok(x[0] + '：写しに「御社の数字で出ます」を残さない', x[1].indexOf('御社の数字で出ます') < 0);
    const secs = x[1].match(/<section class="slide[^"]*"[\s\S]*?<\/section>/g) || [];
    const miss = secs.filter(function (s) { return s.indexOf('<div class="talk">') < 0; }).length;
    ok(x[0] + '：全部の頁に話す内容（' + secs.length + '枚・無し ' + miss + '）', secs.length > 0 && miss === 0);
    ok(x[0] + '：話す内容の欄・T キー', x[1].indexOf('<div id="talkp" aria-live="polite"></div>') >= 0
      && x[1].indexOf("if(e.key==='t'||e.key==='T'){ e.preventDefault(); talkToggle(); }") >= 0 && /\.talk\{display:none!important;\}/.test(x[1]));
  });
}

console.log(bad.length ? bad.join('\n') : 'ALL OK', n + ' checks, ' + bad.length + ' failed');
process.exit(bad.length ? 1 : 0);
