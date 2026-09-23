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

console.log(bad.length ? bad.join('\n') : 'ALL OK', n + ' checks, ' + bad.length + ' failed');
process.exit(bad.length ? 1 : 0);
