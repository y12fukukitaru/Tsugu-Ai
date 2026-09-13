// =============================================================
// 説明書・説明資料の試験：画面の写し（デモ）が入っているか、古い記述が残っていないか
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
let n = 0, bad = [];
function ok(name, cond) { n++; if (!cond) bad.push(name); }
function no(name, cond) { ok(name, !cond); }

const CSS = R('pitch-demo.css');
const PITC = R('pitch-customer.html'), PITP = R('pitch-partner.html'), PITG = R('pitch-general.html'),
      PITB = R('pitch-bank.html'), PITF = R('pitch-finance.html'), REC = R('recruit-partner.html');
const MANC = R('manual-customer.html'), MANP = R('manual-partner.html'), MANA = R('manual-admin.html');
const IDX = R('index.html');

// ① 写しの設え（CSS）と読み込み
{
  ['.scr{', '.scr-sb{', '.scr-panel{', '.mk{', '.hot{', '.dsteps{', '.dstep .see::before', '.dstep .then::before', '.dmap{', '.slide.dm{', '.demo.tall .scr'].forEach(function (k) {
    ok('pitch-demo.css に ' + k, CSS.indexOf(k) >= 0);
  });
  ok('分かる／そのあと の札', /content:'分かる'/.test(CSS) && /content:'そのあと'/.test(CSS));
  [['pitch-customer', PITC], ['pitch-partner', PITP], ['pitch-general', PITG], ['pitch-bank', PITB], ['recruit-partner', REC], ['manual-customer', MANC], ['manual-partner', MANP]].forEach(function (x) {
    ok(x[0] + ' が pitch-demo.css を読む', /<link rel="stylesheet" href="pitch-demo.css">/.test(x[1]));
  });
  ok('読む順：pitch-wa → pitch-demo', PITC.indexOf('pitch-wa.css') < PITC.indexOf('pitch-demo.css'));
}
// ② 経営者向け：デモ8枚 ＋ 地図 ＋ 中扉
{
  ['①ダッシュボード', '②承継シミュレーション', '③継ナビくん', '④出口の設計', '⑤買い手になる', '⑥買った後に備える', '⑦月次レポート・財務', '⑧契約から90日'].forEach(function (t) {
    ok('顧客デモ ' + t, PITC.indexOf('<section class="slide dm" data-t="' + t + '">') >= 0);
  });
  ok('顧客デモの中扉と地図', /class="slide divider" data-t="画面で見る"/.test(PITC) && /data-t="デモの地図"/.test(PITC) && (PITC.match(/<div class="st"><i class="n mk">/g) || []).length >= 8);
  ok('デモは料金の前', PITC.indexOf('data-t="⑧契約から90日"') < PITC.indexOf('data-t="料金"'));
  // 押す場所の文言は、本体のボタン名と同じ
  ['記録する', '担当パートナーに知らせる', '🏢 買う側を体験', 'この会社を買ったら？を試算する', '✉️ この結果を担当パートナーに相談する', '✉️ 担当パートナーに伝える', '続けて、買い手になる', '関心を出す', '学ぶ（継ナビくんに聞く）', '買った後の1年を、継ナビくんと想像する', '同意して契約する', '使い方ガイド（1分）'].forEach(function (lab) {
    ok('顧客デモの押す場所「' + lab + '」が本体にもある', PITC.indexOf(lab) >= 0 && IDX.indexOf(lab) >= 0);
  });
  ok('各デモに 押す→分かる→そのあと', (PITC.match(/<span class="act">/g) || []).length >= 24 && (PITC.match(/<span class="see">/g) || []).length >= 20 && (PITC.match(/<span class="then">/g) || []).length >= 12);
  ok('左メニューは本体と同じ並び', /ダッシュボード<\/div><div class="ni"><b>▤<\/b>月次レポート<\/div><div class="ni"><b>✓<\/b>経営課題<\/div><div class="ni"><b>¥<\/b>お支払い<\/div><div class="ni"><b>≈<\/b>財務・資金繰り<\/div><div class="ni"><b>◆<\/b>企業価値・試算結果<\/div><div class="ni"><b>⚙<\/b>AI自動化診断<\/div><div class="ni"><b>⇢<\/b>出口の設計<\/div><div class="ni"><b>▣<\/b>買い手になる<\/div><div class="ni"><b>☰<\/b>買った後に備える/.test(PITC));
}
// ③ パートナー向け：デモ6枚
{
  ['①今日やること', '②今日の一手', '③顧問契約を送る', '④カルテ', '⑤M&amp;A案件・Tsugime', '⑥ランクと明細'].forEach(function (t) {
    ok('パートナーデモ ' + t, PITP.indexOf('<section class="slide dm" data-t="' + t + '">') >= 0);
  });
  ok('パートナーデモの中扉と地図', /class="slide divider" data-t="画面で見る"/.test(PITP) && /data-t="デモの地図"/.test(PITP));
  ok('契約を送る：メールとプランだけ（金額の入力は無い）', /プラン（必須）/.test(PITP) && /契約書を送る/.test(PITP) && /金額の入力はありません/.test(PITP));
  ok('ナビは12の道具の順', /試算表 → 資金繰り → 保険・固定費 → 支払予定 → 導入診断報告書 → 企業価値 → 出口の設計 → 買った後に備える → 準備度 → 買いたい条件/.test(PITP));
  ok('ランク表は本体と同じ', /顧問契約10件 または 成約1件/.test(PITP) && /顧問契約20件 または 成約3件/.test(PITP) && /30社以上で 80%/.test(PITP));
  ok('今日の一手はお知らせタブの先頭（相談タブではない）', /「お知らせ」タブの先頭/.test(PITP) && /相談タブには出しません/.test(PITP));
  no('顧問料の割引（廃止済み）は書かない', /顧問先の顧問料も割引されます/.test(PITP));
}
// ④ 汎用・金融機関・採用：画面で見ると（1枚）と料金
{
  [['pitch-general', PITG], ['pitch-bank', PITB], ['recruit-partner', REC]].forEach(function (x) {
    ok(x[0] + ' に「画面で見ると」', /data-t="画面で見ると"/.test(x[1]) && /経営者が押すのは3か所/.test(x[1]));
  });
  [['pitch-general', PITG], ['pitch-bank', PITB], ['pitch-finance', PITF]].forEach(function (x) {
    no(x[0] + ' に月額 50,000円 は無い', /50,000円/.test(x[1]));
    ok(x[0] + ' に2プランの金額', /45,000円/.test(x[1]) && /30,000円/.test(x[1]));
    no(x[0] + ' に「プランは1つ」は無い', /プランは1つ|1つだけ。会社の規模/.test(x[1]));
  });
  ok('金融機関提出用の年間の計算', /100,000 \+ 45,000×12 = <b>640,000円<\/b>/.test(PITF) && /100,000 \+ 30,000×12 = <b>460,000円<\/b>/.test(PITF));
  ok('採用：外注費率は 50〜80%', /50〜80%/.test(REC) && !/50〜70%/.test(REC));
  ok('採用：昇格の別ルート', /顧問契約10件 または 顧問先の成約1件/.test(REC) && /顧問契約20件 または 成約3件/.test(REC));
  no('顧客向け：廃止済みの割引制度', /割引制度<\/h3>|最大10%OFF|複数社契約：/.test(PITC));
}
// ⑤ 説明書：古い記述が無い・写しが入っている
{
  no('顧客説明書：「これからお届けするもの」', /これからお届けするもの/.test(MANC));
  no('顧客説明書：「新しく増えました」', /新しく増えました/.test(MANC));
  no('顧客説明書：廃止済みの割引', /最大10%OFF|HD化）5%|2〜4社3%/.test(MANC));
  ok('顧客説明書：まずはこの3つ＝手元資金・継ナビくん・シミュレーション', /<b>いまの手元資金<\/b>を入れる/.test(MANC) && /<b>継ナビくん<\/b>に、いま気になっていることを一つ聞く/.test(MANC) && /<b>承継シミュレーション<\/b>で/.test(MANC));
  ok('顧客説明書：出口の設計・買った後に備える・顧問プランは独立した頁', /data-t="出口の設計"/.test(MANC) && /data-t="買った後に備える"/.test(MANC) && /data-t="顧問プランと、M&Aの優遇"/.test(MANC));
  ok('顧客説明書：写しが5枚', (MANC.match(/<div class="demo one tall"/g) || []).length === 5);
  ok('顧客説明書：メッセージの頁に買った後に備えるは無い', (function () { var i = MANC.indexOf('data-t="メッセージ"'); var j = MANC.indexOf('</section>', i); return MANC.slice(i, j).indexOf('買った後に備える') < 0; })());
  // 目次の組が分かれない（同じ組が飛び飛びにならない）
  function groups(s) { var gs = []; (s.match(/data-g="[^"]*"/g) || []).forEach(function (g) { if (gs[gs.length - 1] !== g) gs.push(g); }); return gs; }
  [['manual-customer', MANC], ['manual-partner', MANP], ['manual-admin', MANA]].forEach(function (x) {
    var gs = groups(x[1]); ok(x[0] + '：目次の組は続けて並ぶ', new Set(gs).size === gs.length);
  });
  no('パートナー説明書：「10の道具」', /10の道具/.test(MANP));
  no('パートナー説明書：「新しく増えました」', /新しく増えました/.test(MANP));
  ok('パートナー説明書：ナビは12の道具で出口の設計・買った後に備えるを含む', /12の道具/.test(MANP) && /出口の設計/.test(MANP) && /買った後に備える/.test(MANP));
  no('運営説明書：「13メニュー」「一律」', /13メニュー|45,000円（税別）の一律/.test(MANA));
  ok('運営説明書：14メニュー・7つのタブ・エンタープライズ', /14/.test(MANA) && /7つのタブ/.test(MANA) && /エンタープライズ/.test(MANA));
  ok('運営説明書：総合振込ファイルと請求と未収の手順', /総合振込ファイル/.test(MANA) && /請求と未収/.test(MANA) && /この月の請求を立てる/.test(MANA));
  no('運営説明書：「保存されません」', /試算用で、保存されません/.test(MANA));
}
console.log(bad.length ? bad.join('\n') : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
