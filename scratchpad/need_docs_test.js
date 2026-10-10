// =============================================================
// ニード喚起の資料（2026-10-10）
//   ① 一枚紙3種（パートナー・買い手・売り手）：A4・1枚、アプリの中から印刷
//   ② 短いプロダクト説明：買い手版・売り手版（3つの問いから）
//   ③ 経営者向け説明書を買い手版・売り手版に分ける（元は1本、tools/split-manual.py で作る）
// =============================================================
const fs = require('fs');
const { execFileSync } = require('child_process');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
let n = 0, bad = [];
function ok(name, c) { n++; if (!c) bad.push(name); }
const secs = (h) => h.split('<section class="slide').slice(1).map((s) => s.slice(0, s.indexOf('</section>')));
const order = (h) => secs(h).map((s) => (s.match(/data-t="([^"]*)"/) || [])[1]);
const slideOf = (h, t) => secs(h).find((s) => s.indexOf('data-t="' + t + '"') >= 0) || '';
const NG = /日本初|唯一|絶対|100%|売りましょう/;
//  話す内容（.talk）には「〜とは言わない」と書くので、見せる本文だけで確かめる
const body = (h) => h.slice(h.indexOf('<body')).replace(/<div class="talk">[\s\S]*?<\/div>/g, '');

// ① 一枚紙
const CSS = R('sheet.css');
ok('一枚紙：A4縦・余白なしの紙に1枚', /@page\{size:A4 portrait;margin:0;\}/.test(CSS) && /\.sheet\{width:210mm;min-height:297mm;/.test(CSS));
ok('一枚紙：印刷では上の帯を消し、紙の高さで切る', /\.bar\{display:none;\}/.test(CSS) && /\.sheet\{width:210mm;height:297mm;min-height:0;margin:0;box-shadow:none;overflow:hidden;\}/.test(CSS));
ok('一枚紙：スマホの組み直しは画面だけ（印刷の幅で崩さない）', /@media screen and \(max-width:820px\)\{ \.g2,\.g3,\.g4\{grid-template-columns:1fr;\} \}/.test(CSS));
for (const f of ['sheet-partner.html', 'sheet-buyer.html', 'sheet-seller.html']) {
  const h = R(f);
  ok(f + '：頁は1枚', secs(h).length === 1 && /class="slide sheet"/.test(h));
  ok(f + '：閉じる・印刷する', /onclick="sheetClose\(\)">← 閉じる/.test(h) && /onclick="sheetPrint\(\)">🖨 印刷する（A4・1枚）/.test(h));
  ok(f + '：共通の動きは sheet.js', /<script src="sheet\.js"><\/script>/.test(h) && !/function sheetPrint/.test(h));
  ok(f + '：探せるように 題・組・質問（6つまで）', /data-t="[^"]+" data-g="[^"]+" data-q="[^"]+"/.test(h) && (h.match(/data-q="([^"]*)"/)[1].split('|').length <= 6));
  ok(f + '：言い切らない言葉は使わない', !NG.test(body(h)));
}
const SJ = R('sheet.js');
ok('sheet.js：アプリの枠の中では別のタブで開いてから印刷', /window\.open\(location\.href\.split\('#'\)\[0\]\+'#print','_blank'\)/.test(SJ) && /location\.hash==='#print'/.test(SJ));
ok('sheet.js：枠の中で閉じるとアプリに戻る', /postMessage\(\{ tsugu:'closeManual' \}, '\*'\)/.test(SJ));
//  担当・連絡先の自動入力（2026-10-10）
ok('sheet.js：アプリが置いた担当（tsugu_sheet_me）を読み、空なら手書き用の下線', /localStorage\.getItem\('tsugu_sheet_me'\)/.test(SJ) && /SHEET_BLANK='＿＿＿＿＿＿＿＿'/.test(SJ));
ok('sheet.js：直した内容はそのパートナーの設定（tsugu_prefs_…）の sheetContact に覚える', /\/\^tsugu_prefs_\/\.test\(SHEET_ME\.key\)/.test(SJ) && /p\.sheetContact=/.test(SJ));
ok('sheet.css：直す欄は印刷しない', /@media print\{ \.who-edit\{display:none!important;\} \}/.test(CSS));
for (const f of ['sheet-buyer.html', 'sheet-seller.html']) {
  const h = R(f);
  ok(f + '：右下に担当・連絡先の欄', /担当：<b id="who-n">＿＿＿＿＿＿＿＿<\/b>　連絡先：<b id="who-c">＿＿＿＿＿＿＿＿<\/b>/.test(h));
  ok(f + '：「✏ 担当・連絡先」で直せる（名前・所属・電話・メール）', /onclick="sheetMeEdit\(\)">✏ 担当・連絡先/.test(h) && ['n', 'co', 'tel', 'mail'].every((k) => new RegExp('data-k="' + k + '" oninput="sheetMeInput\\(this\\)"').test(h)));
}
ok('パートナーの手元用には担当の欄を置かない', !/id="who-n"/.test(R('sheet-partner.html')));
const SO = (() => { const i = SRC.indexOf('\n  function sheetOpen('); return SRC.slice(i, SRC.indexOf('\n  }\n', i)); })();
ok('アプリ：一枚紙は sheetOpen で開く', /onclick="sheetOpen\(\\''\+d\.f\+'\\'\)">🖨 開いて印刷する/.test(SRC));
ok('アプリ：開く前に名前・所属・メールを置く（直した内容があればそちら）', /localStorage\.setItem\('tsugu_sheet_me'/.test(SO) && /n: c\.n \|\| me\.full_name \|\| me\.contact_name/.test(SO) && /co: c\.co \|\| \(EP_ME && EP_ME\.org && EP_ME\.org\.name\)/.test(SO) && /mail: c\.mail \|\| window\.__email/.test(SO) && /key: prefKey\(\)/.test(SO));
ok('アプリ：ログアウトで tsugu_sheet_me は消える（tsugu_ で始まり、残す一覧に無い）', /\/\^tsugu\[_\.\]\//.test(SRC) && !/WIPE_KEEP=\[[^\]]*tsugu_sheet_me/.test(SRC));
const SB = R('sheet-buyer.html'), SS = R('sheet-seller.html'), SP = R('sheet-partner.html');
ok('買い手の一枚紙：お悩み → 4つのメリット → なぜ今 → 4つの壁 → 料金', /こんなお悩みはありませんか？/.test(SB) && /4つのメリット/.test(SB) && /なぜ、いまなのか/.test(SB) && /4つの壁/.test(SB) && /月45,000円/.test(SB));
ok('売り手の一枚紙：お悩み → 売り時 → 待つリスク・早く始める得 → 選べる状態 → 料金', /こんなお悩みはありませんか？/.test(SS) && /売り時は/.test(SS) && /待つほど増えるリスク/.test(SS) && /早く始めるほど増える得/.test(SS) && /月35,000円/.test(SS));
ok('売り手の一枚紙：年数を置かない・「今は売らない」も選べる', !/年後/.test(SS) && /「今は売らない」も選べます/.test(SS));
ok('パートナーの一枚紙：刺さる社長 → 悩みにこう応える → 最初の一言 → なぜ感謝されるか', /こんな社長に刺さります/.test(SP) && /社長のこの悩みに、こう応えられます/.test(SP) && /最初の一言/.test(SP) && /なぜ、感謝されるのか/.test(SP));
ok('調査の数字には出どころ', /帝国データバンク/.test(SB) && /東京商工リサーチ/.test(SS));
ok('資料一覧：一枚紙3種はパートナー・運営に「一枚紙」の組で', ['sheet-partner', 'sheet-buyer', 'sheet-seller'].every((k) => new RegExp("f:'" + k + "\\.html'[^\\n]*sec:'sheet', one:true").test(SRC)));
ok('資料一覧：経営者には一枚紙を出さない', ['sheet-partner', 'sheet-buyer', 'sheet-seller'].every((k) => !new RegExp("f:'" + k + "\\.html'[^\\n]*customer:").test(SRC)));

// ② 短いプロダクト説明
for (const [f, first] of [['pitch-buyer.html', '買い手になるメリット'], ['pitch-seller.html', '価値のあるうちに']]) {
  const h = R(f), o = order(h);
  ok(f + '：13頁', o.length === 13);
  ok(f + '：表紙 → 3つの問い → ' + first, o[0] === '表紙' && o[1] === '3つの問い' && o[2] === first);
  ok(f + '：最後は次の一歩', o[o.length - 1] === '次の一歩');
  ok(f + '：紙の高さ合わせ・目次から読む', /<script src="pitch-fit\.js"><\/script>/.test(h) && /<script src="doc-reader\.js"><\/script>/.test(h));
  ok(f + '：問いの文字は1つのまとまり（太字で途切れない）', (slideOf(h, '3つの問い').match(/<span class="n">\d<\/span><span>/g) || []).length === 3);
  ok(f + '：資料一覧に', new RegExp("f:'" + f.replace('.', '\\.') + "'[^\\n]*sec:'pitch'").test(SRC));
}
const PB = R('pitch-buyer.html'), PS = R('pitch-seller.html');
ok('買い手：表紙は「次の1社を引き受けて、大きく育ちませんか」', /次の1社<\/span>を引き受けて、<br>大きく育ちませんか。/.test(PB));
ok('売り手：表紙は「いまの値段を、ご存知ですか」', /「いまの値段」<\/span>を、<br>ご存知ですか。/.test(PS));
ok('売り手：8つの出口・伴走の1年（売り手）・料金', order(PS).indexOf('8つの出口') > 0 && order(PS).indexOf('伴走の1年（売り手）') > 0 && /35,000円/.test(slideOf(PS, '料金（売り手プラン）')));
ok('売り手：「売りましょう」と言わない', !/売りましょう/.test(body(PS)));
ok('詳しい版は名前で分かる', /n:'顧客候補向け プロダクト説明（詳しい版・1社の物語）'/.test(SRC));

// ③ 説明書を分ける
let sync = true;
try { execFileSync('python3', [__dirname + '/../tools/split-manual.py', '--check'], { stdio: 'pipe' }); } catch (e) { sync = false; }
ok('買い手版・売り手版は元（manual-customer.html）と合っている', sync);
const MC = R('manual-customer.html'), MB = R('manual-buyer.html'), MS = R('manual-seller.html');
ok('元：買い手だけの頁・売り手だけの頁に印', /data-plan="buyer" data-t="買い手になる"/.test(MC) && /data-plan="buyer" data-t="買った後に備える"/.test(MC) && /data-plan="seller" data-t="Tsugime -結- と掲載"/.test(MC));
ok('買い手版：買い手になる・買った後に備える（売り手の頁は無い）', order(MB).indexOf('買い手になる') > 0 && order(MB).indexOf('買った後に備える') > 0 && order(MB).indexOf('Tsugime -結- と掲載') < 0);
ok('売り手版：Tsugime と掲載（買い手の頁は無い）', order(MS).indexOf('Tsugime -結- と掲載') > 0 && order(MS).indexOf('買い手になる') < 0 && order(MS).indexOf('買った後に備える') < 0);
ok('売り手版：伴走の1年の第3・第4は売り手の節目', /第3｜会社の値段を上げる/.test(slideOf(MS, '伴走の1年')) && !/第3｜買い手の余力を測る/.test(slideOf(MS, '伴走の1年')));
ok('買い手版：伴走の1年に売り手の札は出さない', !/売り手プランの第3・第4/.test(slideOf(MB, '伴走の1年')) && /第3｜買い手の余力を測る/.test(slideOf(MB, '伴走の1年')));
ok('表紙と題にプラン', /<title>経営者ダッシュボード 操作説明書（買い手プラン（成長）） \|/.test(MB) && /<title>経営者ダッシュボード 操作説明書（売り手プラン（譲渡準備）） \|/.test(MS));
ok('書き出したものに印は残さない', ![MB, MS].some((h) => /<!--plan:|<!--only:|data-plan=/.test(h)));
ok('元の説明書では、売り手版だけの文は隠れている（コメントの中）', /<!--only:seller[\s\S]*?第3｜会社の値段を上げる[\s\S]*?-->/.test(MC));

// ④ 説明書に載せる（2026-10-10）
{
  const MP = R('manual-partner.html'), MA = R('manual-admin.html');
  ok('パートナー向け説明書：一枚紙と短い説明の頁', /data-t="一枚紙と短い説明"/.test(MP) && /「🖨 開いて印刷する」<\/b>/.test(MP) && /<b>あなたのお名前・所属・メール<\/b>が自動で入ります/.test(MP) && /「⚙️ 設定」の「電話番号」/.test(MP));
  ok('パートナー向け説明書：売り手の Tsugime は出口の設計の下', /Tsugime -結-（案件と、社長の会社の掲載の進み具合）は<b>「出口の設計」の画面の下<\/b>/.test(MP));
  ok('運営向け説明書：資料一覧と一枚紙の手入れ（説明書の作り直し・電話のSQL）', /data-t="資料一覧と一枚紙（運営の手入れ）"/.test(MA) && /python3 tools\/split-manual\.py/.test(MA) && /20261010020000_partner_phone\.sql/.test(MA));
  ok('運営向け説明書：TODO のボタン・払って閉じる・お知らせの番号', /「✏️ 直す」「🗑 消す」はいつも出ています/.test(MA) && /<b>スマホでは下か横に払う<\/b>で閉じます/.test(MA) && /<b>①②③…の番号つき<\/b>/.test(MA));
}
if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
