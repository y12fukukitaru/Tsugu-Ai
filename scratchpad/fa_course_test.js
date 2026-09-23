// =============================================================
// FA実務講座の試験
//   ・認定研修（Lv.1の条件）に混ざっていないか（修了した人が未修了に戻らない）
//   ・レッスンの開き先（fa-course.html#cN）が本文に全部あるか
//   ・理解度チェックの正解が、式・本文と合っているか
//   ・税理士法・弁護士法の線引きが本文と画面にあるか
// =============================================================
const fs = require('fs'), vm = require('vm');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html'), FA = R('fa-course.html'), MANP = R('manual-partner.html');
let n = 0, bad = [];
function ok(name, cond) { n++; if (!cond) bad.push(name); }
function no(name, cond) { ok(name, !cond); }

// ① 講座の定義を取り出して動かす
const blk = SRC.slice(SRC.indexOf('  var TRAINING=['), SRC.indexOf('  function trFind(id)'));
const ctx = { tgShell: () => '', tgCard: () => '', tgRow: () => '', esc: (x) => x };
vm.createContext(ctx);
vm.runInContext(blk + '\nthis.T=TRAINING; this.F=FA_COURSE; this.req=trReq(); this.all=trLessons(); this.opt=trOptLessons();', ctx);
const faIds = ctx.F[0].lessons.map((l) => l.id);
ok('FA実務講座は9レッスン（序章＋7章＋理解度チェック）', faIds.length === 9);
ok('修了（Lv.1）の判定に FA は入らない', ctx.req.every((l) => !/^fa-/.test(l.id)));
ok('発展（M&A編）の数にも FA は入らない', ctx.opt.every((l) => !/^fa-/.test(l.id)));
ok('開く・読了の対象（trLessons）には FA が入る', faIds.every((id) => ctx.all.some((l) => l.id === id)));
ok('レッスンIDが研修と重ならない', new Set(ctx.all.map((l) => l.id)).size === ctx.all.length);
ctx.F[0].lessons.filter((l) => l.kind === 'doc').forEach((l) => {
  const m = /^fa-course\.html#(c\d)$/.exec(l.file || '');
  ok(l.id + ' の開き先が本文にある', m && FA.indexOf('id="' + m[1] + '"') >= 0);
});
const quiz = ctx.F[0].lessons.find((l) => l.kind === 'quiz');
ok('理解度チェックは10問', quiz && quiz.qs.length === 10);
ok('どの問いも正解が選択肢の中にある', quiz.qs.every((q) => q.a >= 0 && q.a < q.o.length && q.o.length === 4));
ok('合格の文言は FA 用（Lv.1 と言わない）', quiz.passMsg && quiz.passMsg.indexOf('Lv.1') < 0);
//  正解が本文の数字と合っているか
ok('Q1：EBITDA＝2,160＋640＝2,800', quiz.qs[0].o[quiz.qs[0].a] === '2,800万' && 2160 + 640 === 2800);
ok('Q3：調整200万×5倍＝1,000万', quiz.qs[2].o[quiz.qs[2].a] === '＋1,000万' && 200 * 5 === 1000);
ok('Q9：基準800・実際650なら150万減る', quiz.qs[8].o[quiz.qs[8].a] === '150万減る' && 800 - 650 === 150);

// ② 本文の数字（株式会社継と運送会社）が、説明資料の例と合っているか
ok('三表：EBITDA2,800−税800−運転資本300＝営業CF1,700', 2800 - 800 - 300 === 1700 && FA.indexOf('<td class="r">1,700</td>') >= 0);
ok('三表：1,700−800−600＝現預金の増加300', 1700 - 800 - 600 === 300);
ok('正常収益力：320＋180＋60＋80−120＝520', 320 + 180 + 60 + 80 - 120 === 520 && FA.indexOf('<td class="r">520</td>') >= 0);
ok('正常EBITDA：520＋480＝1,000', 520 + 480 === 1000);
ok('株式価値：2,800×5−2,800＋1,200＝12,400', 2800 * 5 - 2800 + 1200 === 12400 && FA.indexOf('<td class="r">12,400</td>') >= 0);
ok('年買法：1,400＋520×3＝2,960', 1400 + 520 * 3 === 2960 && FA.indexOf('<td class="r">2,960</td>') >= 0);
ok('EV/EBITDA：1,000×4−(1,700−500)＝2,800', 1000 * 4 - (1700 - 500) === 2800);
ok('未払残業代：1万×12名×36か月＝432', 12 * 36 === 432 && FA.indexOf('<td class="r">432</td>') >= 0);
ok('合意価格 2,600万は説明資料と同じ', FA.indexOf('<td class="r">2,600</td>') >= 0 && R('pitch-customer.html').indexOf('<b>2,600万</b>（5倍）') >= 0);

// ③ 線引き（税理士法・弁護士法）と、相続税評価額を算定しないこと
ok('本文：税理士法52条', FA.indexOf('税理士法52条') >= 0);
ok('本文：弁護士法72条', FA.indexOf('弁護士法72条') >= 0);
ok('本文：相続税評価額は算定しない', FA.indexOf('TsuguAiは相続税評価額を算定しません') >= 0);
ok('本文：してよいこと・してはいけないこと', FA.indexOf('してよいこと') >= 0 && FA.indexOf('してはいけないこと') >= 0);
no('本文に個人名（Y.さん）を載せない', /Y\.さん/.test(FA));

// ④ 画面：研修の下にパネルがあり、読み込みと読了で描き直す
ok('画面：sec-fa のパネルが認定研修のすぐ下', /id="sec-training"[\s\S]{0,1200}id="sec-fa"/.test(SRC));
ok('画面：一覧の置き場', SRC.indexOf('<div id="fa-body-list">') >= 0);
ok('画面：読み込み時と読了時に renderFa', /renderTraining\(\);\n    renderFa\(\);/.test(SRC) && (SRC.match(/renderFa\(\);/g) || []).length >= 2);
ok('画面：研修の修了条件とは別と書く', SRC.indexOf('認定研修の修了条件とは別') >= 0);
ok('採点：passMsg があればそれを出す', SRC.indexOf("(pass?(L.passMsg||'これで研修は修了です。") >= 0);
ok('M&A編の合格文言も Lv.1 と言わない', /id:'t5-8'[\s\S]{0,200}passMsg:'M&A編を修了しました/.test(SRC));
ok('継ナビくんの知識に FA実務講座', SRC.indexOf('FA実務講座(研修とは別の深く学ぶ場') >= 0);
ok('パートナー説明書に FA実務講座', MANP.indexOf('<b>FA実務講座（深く学ぶ）</b>は、研修の下に別にあります') >= 0);

console.log(bad.length ? bad.join('\n') : 'ALL OK', n + ' checks, ' + bad.length + ' failed');
process.exit(bad.length ? 1 : 0);
