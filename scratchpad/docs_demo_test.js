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
  //  顧客向けは「1社の3年間」の物語の中で画面を見せる。中扉とデモの地図は、
  //  全体の地図（最初）と「1年後の画面」（第4のあと）に置き換えた
  ok('顧客デモは物語の中（全体の地図 → 1年後の画面 → 画面①）',
    /data-t="全体の地図"/.test(PITC) && /data-t="1年後の画面"/.test(PITC)
    && PITC.indexOf('data-t="全体の地図"') < PITC.indexOf('data-t="1年後の画面"')
    && PITC.indexOf('data-t="1年後の画面"') < PITC.indexOf('data-t="①ダッシュボード"')
    && !/data-t="デモの地図"/.test(PITC) && !/class="slide divider" data-t="画面で見る"/.test(PITC));
  ok('デモは料金の前', PITC.indexOf('data-t="⑧契約から90日"') < PITC.indexOf('data-t="料金"'));
  // 押す場所の文言は、本体のボタン名と同じ
  ['記録する', '担当パートナーに知らせる', '🏢 買う側を体験', 'この会社を買ったら？を試算する', '✉️ この結果を担当パートナーに相談する', '✉️ 担当パートナーに伝える', '続けて、買い手になる', '関心を出す', '学ぶ（継ナビくんに聞く）', '買った後の1年を、継ナビくんと想像する', '同意して契約する', '使い方ガイド（1分）'].forEach(function (lab) {
    ok('顧客デモの押す場所「' + lab + '」が本体にもある', PITC.indexOf(lab) >= 0 && IDX.indexOf(lab) >= 0);
  });
  ok('各デモに 押す→分かる→そのあと', (PITC.match(/<span class="act">/g) || []).length >= 24 && (PITC.match(/<span class="see">/g) || []).length >= 20 && (PITC.match(/<span class="then">/g) || []).length >= 12);
  ok('左メニューは本体と同じ並び', /ダッシュボード<\/div><div class="ni"><b>▤<\/b>月次レポート<\/div><div class="ni"><b>✓<\/b>経営課題<\/div><div class="ni"><b>¥<\/b>お支払い<\/div><div class="ni"><b>≈<\/b>財務・資金繰り<\/div><div class="ni"><b>◆<\/b>企業価値・試算結果<\/div><div class="ni"><b>⚙<\/b>AI自動化診断<\/div><div class="ni"><b>⇢<\/b>出口の設計<\/div><div class="ni"><b>↗<\/b>スケールの設計<\/div><div class="ni"><b>▣<\/b>買い手になる<\/div><div class="ni"><b>☰<\/b>買った後に備える/.test(PITC));
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
    //  もとの一本価格（月額50,000円）が残っていないか。50,000円そのものは
    //  売り手プランの初期導入費で正しく出るので、「月額」と並ぶ形だけを見る
    no(x[0] + ' に月額 50,000円 は無い', /月額[^。<]{0,8}50,000円|50,000円[^。<]{0,4}[／\/]\s*月/.test(x[1]));
    ok(x[0] + ' に2プランの金額', /45,000円/.test(x[1]) && /35,000円/.test(x[1]));
    no(x[0] + ' に「プランは1つ」は無い', /プランは1つ|1つだけ。会社の規模/.test(x[1]));
  });
  ok('金融機関提出用の年間の計算', /100,000 \+ 45,000×12 = <b>640,000円<\/b>/.test(PITF) && /50,000 \+ 35,000×12 = <b>470,000円<\/b>/.test(PITF) && /次年度以降 <b>420,000円<\/b><\/td>/.test(PITF));
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
  ok('運営説明書：14メニュー・6つのタブ・エンタープライズ', /14/.test(MANA) && /6つのタブ/.test(MANA) && /エンタープライズ/.test(MANA));
  ok('運営説明書：総合振込ファイルと請求と未収の手順', /総合振込ファイル/.test(MANA) && /請求と未収/.test(MANA) && /この月の請求を立てる/.test(MANA));
  no('運営説明書：「保存されません」', /試算用で、保存されません/.test(MANA));
}
// ⑥ 画面に合わせる（真ん中に・大きく）と、位置づけの一文
{
  const FIT = R('pitch-fit.js'), WA = R('pitch-wa.css');
  //  倍率は全部の頁を測ってひとつに決める。頁を送っても測り直さない
  //  （一枚ずつ決めると、送るたびに紙の大きさが変わる）
  ok('pitch-fit.js：全部を測って倍率をひとつに決める', /setProperty\('--fit'/.test(FIT)
    && /function measure\(\)/.test(FIT) && /if\(h>tall\) tall=h;/.test(FIT));
  ok('pitch-fit.js：頁を送っても倍率は測り直さない', /window\.show=function\(i\)\{ _show\(i\); apply\(\); \}/.test(FIT));
  ok('pitch-fit.js：隠れている頁は同じ幅・同じ組み方で測る', /function natH\(s, w, disp\)/.test(FIT)
    && /st\.setProperty\('width', w\+'px','important'\)/.test(FIT)
    && /st\.setProperty\('display', disp\|\|'flex', 'important'\)/.test(FIT));
  //  紙の高さもそろえる。幅だけだと、中央寄せのぶん上下の位置が頁ごとに動く
  ok('pitch-fit.js：高さもいちばん高い一枚にそろえる',
    /deck\.style\.setProperty\('--slideh', Math\.ceil\(TALL\)\+'px'\)/.test(FIT)
    && /deck\.style\.removeProperty\('--slideh'\)/.test(FIT));
  ok('pitch-wa.css：高さをそろえ、余りは上下に分ける',
    /\.deck \.slide,\.deck \.slide\.dm\{[\s\S]{0,200}min-height:var\(--slideh,0\);/.test(WA)
    && /justify-content:center;/.test(WA));
  ok('pitch-fit.js：全画面ではバーの出入りで大きさを変えない',
    /if\(body\.classList\.contains\('pf-on'\)\) return 8;/.test(FIT));
  ok('pitch-wa.css：deck は中央寄せ、slide は zoom var(--fit)', /\.deck\{[^}]*justify-content:center/.test(WA) && /\.slide\{zoom:var\(--fit,1\);\}/.test(WA) && /@media print\{ \.deck\{[^}]*\} \.slide\{zoom:1;\} \}/.test(WA));
  ok('印刷では隠さない（screen だけで隠す）', /@media screen\{[\s\S]{0,400}\.slide:not\(\.on\)\{display:none!important;\}[\s\S]{0,20}\}/.test(WA));
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
  ok('全画面のあいだ、バーは普段退いている', /body\.pf-on \.bar\{transform:translateY\(115%\)/.test(WA) && /body\.pf-on\.pf-ui \.bar\{transform:none;\}/.test(WA));
  //  頁を送っただけでは操作を出さない。出すのは、そこへ近づいたときだけ
  ok('近づいたときだけ出す', /showUi\(e\.clientY > window\.innerHeight - HOT_BOTTOM\);/.test(FIT)
    && /showTop\(e\.clientY < HOT_TOP && e\.clientX > window\.innerWidth - HOT_RIGHT\);/.test(FIT));
  no('全画面に入った直後には出さない', /add\('pf-on'\); showUi\(\);/.test(FIT));
  no('キー操作だけでは出さない', /if\(e\.key==='f'\|\|e\.key==='F'\)\{ toggle\(\); \}\n    showUi\(\);/.test(FIT));
  ok('動かしていないあいだはカーソルも消す', /body\.pf-on\{cursor:none;\}/.test(WA)
    && /body\.pf-on\.pf-cursor\{cursor:default;\}/.test(WA) && /function wakeCursor\(\)/.test(FIT));
  ok('右上は普段うすく、近づくと濃い', /\.pf-top\{[^}]*opacity:\.22/.test(WA) && /\.pf-top:hover,body\.pf-topui \.pf-top\{opacity:1;\}/.test(WA) && /body\.pf-hint \.pf-top\{opacity:\.85;\}/.test(WA));
  ok('全画面では右上を完全に消す', /body\.pf-on \.pf-top\{top:8px;right:10px;opacity:0;\}/.test(WA)
    && /body\.pf-on\.pf-topui \.pf-top,body\.pf-on \.pf-top:hover\{opacity:1;\}/.test(WA));
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
// ⑨ 先送りは交渉力も削る（選択肢が減る＝断れなくなる）
{
  ok('顧客向け：見出しに交渉力', /先送りするほど、選択肢も、交渉力も減っていきます/.test(PITC));
  ok('顧客向け：交渉力の札（時間・価値・交渉力・周りの人の4つ）', /<h3>交渉力<\/h3>/.test(PITC) && /期限が迫るほど<b>断れなくなります<\/b>/.test(PITC) && /<div class="grid g4" style="margin-top:16px;">/.test(PITC));
  ok('顧客向け：交渉は席に着く前に決まる', /交渉は、席に着く前に決まります。/.test(PITC) && /数字が整い、出口が決まっていて、期限に追われていない/.test(PITC));
  ok('パートナー向け：早く入るほど交渉力を守れる', /早く入るほど、経営者の<b>交渉力<\/b>を守れます/.test(PITP));
  ok('本体：出口の設計の案内にも交渉力', /早く決めておくほど、そのときの<b style="color:#1E3A66;">交渉力<\/b>が変わります/.test(IDX));
  ok('経営者説明書：早く決めるほど交渉力が変わる', /早く決めておくほど、そのときの交渉力が変わります。/.test(MANC));
}
// ⑩ 買う相手を狭めない（同業に限らない）
{
  ok('3つ目の問いは「会社を買う」', /<span class="n">3<\/span>会社を「買う」ことを、考えたことはありますか？/.test(PITC));
  no('顧客向け資料に「同業の」は残っていない', /同業/.test(PITC));
  no('経営者説明書にも「同業の」は残っていない', /同業/.test(MANC));
  ok('本体の承継シミュレーションは相手を広く取る', /気になる会社（同業・取引先・近隣など）/.test(IDX));
}
// ⑪ エンタープライズ（EP-I／EP-II）の資料と説明書
{
  const EP1 = R('pitch-ep1.html'), EP2 = R('pitch-ep2.html'), MANE = R('manual-ep.html');
  // 設え：ほかの資料と同じ読み込み・同じ操作
  [['pitch-ep1', EP1], ['pitch-ep2', EP2]].forEach(function (x) {
    ok(x[0] + ' が設えを読む', /<link rel="stylesheet" href="pitch-wa.css">/.test(x[1]) && /<link rel="stylesheet" href="pitch-demo.css">/.test(x[1]));
    ok(x[0] + ' が pitch-fit.js を読む', /<\/script>\n<script src="pitch-fit.js"><\/script>\n<\/body>/.test(x[1]));
    ok(x[0] + ' に位置づけの一文', x[1].indexOf('明確な出口（ゴール）を経営者と一緒に決め、管理しながら伴走するプラットフォーム') >= 0
      && x[1].indexOf('交渉前の準備から交渉中、交渉後もずっと一緒にいます。') >= 0);
    //  デモの章は、ほかの資料と同じ組み立て（中扉 → 地図 → 画面が6枚）
    ok(x[0] + ' にデモの中扉と地図', /<section class="slide divider" data-t="画面で見る">/.test(x[1])
      && /<section class="slide" data-t="デモの地図">/.test(x[1]) && /class="dmap"/.test(x[1]));
    ok(x[0] + ' に画面の写しが6枚', (x[1].match(/<section class="slide dm" data-t="画面/g) || []).length === 6);
    ok(x[0] + ' の地図は6つ', (x[1].match(/<div class="st"><i class="n mk">/g) || []).length === 6);
    //  6枚の画面に加えて、物語の中に「担当者（所属の方）のカルテ」と「顧問先の画面（1年後）」の2枚
    ok(x[0] + ' の各デモに「押す→分かる→そのあと」', (x[1].match(/<div class="dsteps">/g) || []).length === 8
      && (x[1].match(/<span class="see">/g) || []).length >= 12);
    //  表の中に番号の丸を直接置くと、HTMLの決まりで表の外へ押し出されて
    //  見当違いの場所に出る。必ず外側の箱に付ける
    no(x[0] + '：表の中に番号の丸を置いていない', /<table[^>]*><i class="mk ab">/.test(x[1]));
    ok(x[0] + '：左メニューの並びが本体と同じ', /ダッシュボード<\/div>[^]{0,400}成長・研修<\/div>[^]{0,400}本業と連携<\/div>[^]{0,400}営業ツール<\/div>[^]{0,400}顧客管理<\/div>[^]{0,400}エンタープライズ<\/div>/.test(x[1]));
    ok(x[0] + '：どちらの形かを並べて示す', /data-t="EP-IとEP-IIの違い"/.test(x[1]));
  });
  //  デモで見せる言葉は、本体の画面に本当にある言葉だけにする。
  //  ここが緩むと、実物に無いものを見せる資料になる
  [['pitch-ep1', EP1, ['顧問先を追加する', '担当者を追加する', '受領を記録', '席を外す', '席を戻す', '担当の割当', '未割当だけ',
    '変更しました。ご担当の「顧客管理」にも出るようになります。', 'この顧問先にはまだ担当が決まっていません。',
    'プラットフォーム利用料', '（法人がまとめてご負担）']],
  ['pitch-ep2', EP2, ['担当表', '担当者を追加する', '席を外す', 'まだ記録がありません。', 'まだ担当している顧客がありません。',
    '所属されている認定パートナーと、その方が担当している顧客です。',
    'EP-II：本部へのお支払い（一律10%）', '本部のご負担（月）']]
  ].forEach(function (x) {
    x[2].forEach(function (lab) {
      ok(x[0] + 'の「' + lab + '」が本体にもある', x[1].indexOf(lab) >= 0 && IDX.indexOf(lab) >= 0);
    });
  });
  //  直したばかりの決めごとが、デモにも入っているか
  ok('EP-I デモ：主担当を決めると顧客管理に出る', /主担当に決めた瞬間、その方の「顧客管理」に出ます/.test(EP1));
  ok('EP-I デモ：よその担当は消さない', /御社に所属していない方<\/b>を担当に当てている顧問先では、その紐づきはそのまま残します/.test(EP1));
  ok('EP-II デモ：概要の担当社数は担当表から', /担当表に出ている顧客の数/.test(EP2));
  ok('EP-II デモ：本部への10%は別口で振り込む', /本部へのお支払いは、別口で起こります/.test(EP2)
    && /管理者の席がないと、お振込みできません/.test(EP2));
  ok('manual-ep が設えを読む', /<link rel="stylesheet" href="manual-wa.css">/.test(MANE) && /<link rel="stylesheet" href="pitch-demo.css">/.test(MANE));
  ok('manual-ep に画面の写しが3枚', (MANE.match(/<div class="demo one tall"/g) || []).length === 3);
  // 目次の組は続けて並ぶ
  (function () {
    var gs = []; (MANE.match(/data-g="[^"]*"/g) || []).forEach(function (g) { if (gs[gs.length - 1] !== g) gs.push(g); });
    ok('manual-ep：目次の組は続けて並ぶ', new Set(gs).size === gs.length);
  })();
  // 中身：本体の決めごとと数字が合っている
  ok('EP-I：顧客は法人のもの・80%・担当の割当', /顧客との関係はパートナーが保持します/.test(EP1) && /<b>36,000円<\/b>/.test(EP1) && /<b>80,000円<\/b>/.test(EP1) && /data-t="画面④担当の割当"/.test(EP1));
  ok('EP-II：契約2本立て・本部一律10%・スケールなし', /2本立て/.test(EP2) && /4,500/.test(EP2) && /スケール到達（80%）はありません/.test(EP2) && /Lv\.4（70%）が上限/.test(EP2));
  ok('EP-II：本部のご負担はありません', /本部のご負担はありません/.test(EP2) && /所属の方がご負担/.test(EP2));
  ok('どちらの資料にも、廃止済みの制度は無いと書く', /ボリュームディスカウント・EP登録料・月額下限・法人管理料は<b>ありません<\/b>/.test(EP1) && /ボリュームディスカウント・EP登録料・月額下限・法人管理料はありません/.test(EP2));
  ok('説明書：タブの構成が本体と同じ', /概要／<b>顧問先<\/b>／担当者／<b>担当の割当<\/b>／記録/.test(MANE) && /概要／担当者／<b>担当表<\/b>／記録/.test(MANE));
  ok('説明書：管理者と担当者の線引き', /data-t="管理者と担当者"/.test(MANE) && /お客様へ顧問契約を送る（EP-I）/.test(MANE) && /お振込先の登録（EP-I）/.test(MANE));
  ok('説明書：席を戻しても割当は戻らない', /外したときの割当は戻りません/.test(MANE));
  ok('説明書：主担当は顧客管理にも出る', /顧客管理」<\/b>の一覧とカルテにも出ます。運営へのご連絡は要りません/.test(MANE));
  ok('説明書：主担当を外したときの断り', /主担当を外したとき/.test(MANE) && /その紐づきはそのまま残します/.test(MANE));
  ok('説明書：EP-II 概要の本部負担は0円', /本部のご負担（0円）/.test(MANE) && /担当表に出ている顧客の数/.test(MANE));
  ok('説明書：金額は明細で確かめる', /金額の確認は、明細で。/.test(MANE));
  ok('説明書：契約のひな形は仮', /契約書のひな形は<b>（仮）<\/b>です/.test(MANE));
  // 画面の写しの言葉は、本体にある言葉と同じ
  ['担当の割当', '担当表', '席を外す', '顧問先を追加する', '担当者を追加する', '受領を記録', '管理者として表示', 'まだ記録がありません。'].forEach(function (lab) {
    ok('説明書の「' + lab + '」が本体にもある', MANE.indexOf(lab) >= 0 && IDX.indexOf(lab) >= 0);
  });
  // サポートタブへの配線
  ok('サポート：所属している方にだけ説明書を出す', /f:'manual-ep\.html'[^\n]*n:'エンタープライズ 操作説明書'[^\n]*who:\{ consultant:'ep'/.test(IDX) && /if\(d\.who\[eff\]==='ep'\) return !!EP_ME;/.test(IDX));
  ok('サポート：運営には説明書と資料2本', /f:'manual-ep\.html'[^\n]*admin:'法人パートナー（EP-I／EP-II）に案内するときの確認用'/.test(IDX)
    && /f:'pitch-ep1\.html'[^\n]*n:'EP-I（顧客基盤型）向け プロダクト説明'[^\n]*who:\{ admin:''/.test(IDX)
    && /f:'pitch-ep2\.html'[^\n]*n:'EP-II（所属営業型）向け プロダクト説明'[^\n]*who:\{ admin:''/.test(IDX));
  ok('パートナー説明書から、詳しい説明書へ', /「エンタープライズ 操作説明書」<\/b>にまとめてあります/.test(MANP));
  ok('運営説明書から、資料と説明書へ', /EP-I（顧客基盤型）向け プロダクト説明/.test(MANA) && /エンタープライズ向け説明書/.test(MANA));
}
// ⑫ プロダクトの呼び名は TsuguAi（「継」だけで呼ばない）
//    「継」は TsuguAi -継- の一部・継ナビくん・承継など、ほかの言葉の中にだけ残す。
//    単独で製品や当社を指すと、資料を初めて読む方には別物に見える。
{
  //  残してよい「継」。長いものから消していく
  const KEEP = ['TsuguAi<i>-継-', 'TsuguAi -継-', '-継-', '継ナビくん', '承継', '継続', '引き継', '受け継',
    '継ぎ', '継い', '継ぐ', '継げ', '継がせ', '継がれ', '継がな', '中継', '継承', '後継',
    //  例に出てくる会社名・お名前
    '株式会社継', '継税理士法人', '継ライフ保険サービス', '継事務所', '継 太郎'];
  function bare(src) {
    let t = src;
    KEEP.forEach(function (k, i) { t = t.split(k).join('\u0000' + i + '\u0000'); });
    return (t.match(/継/g) || []).length;
  }
  [['pitch-ep1', R('pitch-ep1.html')], ['pitch-ep2', R('pitch-ep2.html')], ['pitch-customer', PITC], ['pitch-partner', PITP],
  ['pitch-general', PITG], ['pitch-bank', PITB], ['pitch-finance', PITF], ['recruit-partner', REC],
  ['manual-ep', R('manual-ep.html')], ['manual-customer', MANC], ['manual-partner', MANP], ['manual-admin', MANA]].forEach(function (x) {
    var c = bare(x[1]);
    ok(x[0] + '：単独の「継」で製品を呼んでいない（残り ' + c + ' か所）', c === 0);
  });
  //  画面に出る言葉（index.html）も同じ呼び名にそろえる。ここがずれると、
  //  資料の写しと本物の画面で名前が違うことになる
  ['TsuguAiへのご利用料（月・税別）', 'TsuguAiへのご利用料（本部のご負担はありません）',
    'TsuguAiへのお支払い（月）', 'お振込先（TsuguAiが受け取る口座）',
    '顧客はTsuguAiに帰属', 'TsuguAi（福來）が受け取った手数料'].forEach(function (lab) {
      ok('本体の「' + lab + '」', IDX.indexOf(lab) >= 0);
    });
  //  見るのは画面に出る文字だけ。コード中の覚え書き（// で始まる行）は
  //  社内の言葉なので、そのままにしてある
  const IDX_VIEW = IDX.split('\n').filter(function (l) { return l.trim().indexOf('//') !== 0; }).join('\n');
  no('本体：単独の「継」で呼ぶ表示は残っていない',
    /継へのご利用料|継へのお支払い|継が受け取る口座|顧客は継に帰属|継（福來）|継の役割は|継の取り分|継は担当者個人/.test(IDX_VIEW));
}
console.log(bad.length ? bad.join('\n') : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
