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
// ⑥ 画面に合わせる（真ん中に・大きく）と、位置づけの一文
{
  const FIT = R('pitch-fit.js'), WA = R('pitch-wa.css');
  ok('pitch-fit.js：表示中の一枚を測って --fit を置く', /setProperty\('--fit'/.test(FIT) && /window\.show=function\(i\)\{ _show\(i\); fit\(\); \}/.test(FIT));
  ok('pitch-wa.css：deck は中央寄せ、slide は zoom var(--fit)', /\.deck\{[^}]*justify-content:center/.test(WA) && /\.slide\{zoom:var\(--fit,1\);\}/.test(WA) && /@media print\{ \.deck\{[^}]*\} \.slide\{zoom:1;\} \}/.test(WA));
  ok('印刷では隠さない（screen だけで隠す）', /@media screen\{ \.slide:not\(\.on\)\{display:none!important;\} \}/.test(WA));
  [['pitch-customer', PITC], ['pitch-partner', PITP], ['pitch-general', PITG], ['pitch-bank', PITB], ['pitch-finance', PITF]].forEach(function (x) {
    ok(x[0] + ' が pitch-fit.js を読む（インラインの script のあと）', /<\/script>\n<script src="pitch-fit.js"><\/script>\n<\/body>/.test(x[1]));
  });
  const POS = '明確な出口（ゴール）を経営者と一緒に決め、管理しながら伴走するプラットフォーム';
  [['pitch-customer', PITC], ['pitch-partner', PITP], ['pitch-general', PITG], ['pitch-bank', PITB], ['recruit-partner', REC]].forEach(function (x) {
    ok(x[0] + ' に位置づけの一文', x[1].indexOf(POS) >= 0);
    ok(x[0] + ' に「交渉前から交渉後まで」の一文', x[1].indexOf('交渉前の準備から交渉中、交渉後もずっと一緒にいます。') >= 0);
  });
}
// ⑦ 全画面・スワイプ・右上の操作（ウェビナー／プレゼン用）
{
  const FIT = R('pitch-fit.js'), WA = R('pitch-wa.css');
  ok('全画面：入る・出る・切り替える', /function enter\(/.test(FIT) && /function leave\(/.test(FIT) && /function toggle\(/.test(FIT) && /requestFullscreen/.test(FIT) && /webkitRequestFullscreen/.test(FIT));
  ok('全画面が使えない端末でも、見立ての全画面に落とす', /body\.classList\.add\('pf-on'\)/.test(FIT));
  ok('ブラウザ側で解除されたときも見た目を合わせる', /fullscreenchange/.test(FIT) && /webkitfullscreenchange/.test(FIT));
  ok('スワイプ：横だけ・45px 以上', /touchstart/.test(FIT) && /touchend/.test(FIT) && /Math\.abs\(dx\)>45/.test(FIT) && /Math\.abs\(dx\)>Math\.abs\(dy\)/.test(FIT));
  ok('スワイプ直後の click は握りつぶす（二重に進まない）', /if\(swiped\)\{ swiped=false; e\.stopPropagation\(\); e\.preventDefault\(\); \}/.test(FIT));
  ok('右上：全画面と戻るの2つ、全画面中は戻るを出さない', /aria-label', on\?'全画面を解除':'全画面で表示'/.test(FIT) && /btnBack\.style\.display = \(on\|\|window\.parent===window\) \? 'none' : ''/.test(FIT));
  ok('右上の印は線で描く（端末で形が変わらないように）', /SVG_OPEN=/.test(FIT) && /SVG_CLOSE=/.test(FIT) && /SVG_X=/.test(FIT));
  ok('戻るは枠の親に合図を送る', /parent\.postMessage\(\{tsugu:'closeManual'\}/.test(FIT));
  ok('全画面のあいだ、操作が途切れたらバーを退かせる', /body\.classList\.add\('pf-ui'\)/.test(FIT) && /body\.pf-on \.bar\{transform:translateY\(115%\)/.test(WA) && /body\.pf-on\.pf-ui \.bar\{transform:none;\}/.test(WA));
  ok('右上は普段うすく、近づくと濃い', /\.pf-top\{[^}]*opacity:\.22/.test(WA) && /\.pf-top:hover,body\.pf-ui \.pf-top\{opacity:1;\}/.test(WA) && /body\.pf-hint \.pf-top\{opacity:\.85;\}/.test(WA));
  ok('触る端末では hover が無いので、常に見える濃さ', /@media\(hover:none\)\{ \.pf-top\{opacity:\.5;\} \}/.test(WA));
  ok('印刷では右上を隠す', /\.bar,\.pf-top\{display:none!important;\}/.test(WA));
  [['pitch-customer', PITC], ['pitch-partner', PITP], ['pitch-general', PITG], ['pitch-bank', PITB], ['pitch-finance', PITF]].forEach(function (x) {
    no(x[0] + '：古い戻るボタンは残っていない', /backbtn/.test(x[1]));
  });
  ok('枠（iframe）の中でも全画面が使えるようにしてある', /<iframe id="manual-frame" allow="fullscreen" allowfullscreen/.test(IDX));
  ok('パートナー説明書に、資料の見せかた', /右上の<b>⛶<\/b>で<b>全画面<\/b>/.test(MANP) && /指で左右にスワイプ/.test(MANP));
  ok('継ナビくんの案内にも、資料の見せかた', /右上の⛶で全画面/.test(IDX) && /指で左右にスワイプ/.test(IDX));
}
// ⑧ 今日の一手のボタンは「読んだ」の一つだけ
{
  no('本体：役に立った／不要のボタンは無い', />👍 役に立った<\/button>|>不要（表示しない）<\/button>/.test(IDX));
  no('本体：使われていなかった feedback の書き込みは残さない', /agentInsightMark/.test(IDX));
  ok('本体：読んだ のボタンと、読み返せる案内', /✓ 読んだ<\/button>/.test(IDX) && /今日のうちは、ここで読み返せます/.test(IDX));
  [['manual-customer', MANC], ['manual-partner', MANP], ['pitch-partner', PITP]].forEach(function (x) {
    no(x[0] + '：役に立った／不要は書かない', /👍 役に立った|不要（表示しない）|「役に立った／不要」/.test(x[1]));
  });
  ok('説明書：読んだら薄くなって残る、と書いてある', /「✓ 読んだ」<\/b>を押すと薄くなり/.test(MANC) && /「✓ 読んだ」<\/b>を押すと薄くなり/.test(MANP));
}
console.log(bad.length ? bad.join('\n') : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
