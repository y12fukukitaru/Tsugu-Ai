// =============================================================
// ビジョン・ミッション・日々の一行・ステートメント（2026-10-15）
//   言葉の原本は docs/brand-statement.md。資料ごとに言い回しを変えない
//   ① 原本
//   ② 商談スライド・説明会・募集案内の「目指す社会」
//   ③ 表紙・一枚紙の日々の一行
//   ④ アプリ（題名・ログイン画面・継ナビくん）
//   ⑤ 古い言い回しが残っていない
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
let n = 0, bad = [];
function ok(name, c) { n++; if (!c) bad.push(name); }
const secs = (h) => h.split('<section class="slide').slice(1).map((s) => s.slice(0, s.indexOf('</section>')));
const slideOf = (h, t) => secs(h).find((s) => s.indexOf('data-t="' + t + '"') >= 0) || '';

const V = '継ぐ、が当たり前の社会へ', M = '継ぐ、を経営の常識に', D = '継ぐ、を身近な経営判断に';
const ST = ['黒字でも、継ぐ人がいないまま閉じていく会社があります。',
  '継ぐことは、特別な日の大きな決断ではなく、毎月の数字から始められる身近な経営判断です。',
  'AIが材料をそろえ、人が社長の隣で伴走し、その判断を経営の常識にしていきます。'];
const plain = (h) => h.replace(/<[^>]+>/g, '');

// ① 原本
{
  const B = R('docs/brand-statement.md');
  ok('原本：3つの言葉', B.indexOf('**' + V + '**') >= 0 && B.indexOf('**' + M + '**') >= 0 && B.indexOf('**' + D + '**') >= 0);
  ok('原本：ステートメント4行', ST.every((l) => B.indexOf('> ' + l) >= 0) && B.indexOf('> ' + V + '。') >= 0);
  ok('原本：年数を入れない・誇張しない決まり', /年数（「10年後」など）は入れない/.test(B) && /「日本初」「唯一」「絶対」「100%」は添えない/.test(B));
}

// ② 「目指す社会」
const DECKS = ['pitch-customer.html', 'pitch-buyer.html', 'pitch-seller.html', 'pitch-partner.html', 'pitch-ep1.html', 'pitch-ep2.html',
  'pitch-ep2-member.html', 'pitch-general.html', 'pitch-bank.html', 'pitch-finance.html', 'webinar-partner.html', 'recruit-partner.html'];
for (const f of DECKS) {
  const h = R(f), s = slideOf(h, '目指す社会'), t = plain(s.replace(/<div class="talk">[\s\S]*?<\/div>/, ''));
  ok(f + '：目指す社会は1枚', secs(h).filter((x) => x.indexOf('data-t="目指す社会"') >= 0).length === 1);
  ok(f + '：ステートメント3行 → ビジョンで言い切る', ST.every((l) => t.indexOf(l) >= 0) && /<h2 class="vs-v">継ぐ、が当たり前の社会へ。<\/h2>/.test(s)
    && t.indexOf(ST[2]) < t.indexOf(V + '。'));
  ok(f + '：ビジョン・ミッション・日々の一行', /<span>ビジョン<\/span><b>継ぐ、が当たり前の社会へ<\/b>/.test(s)
    && /<span>ミッション<\/span><b>継ぐ、を経営の常識に<\/b>/.test(s) && /<span>日々の一行<\/span><b>継ぐ、を身近な経営判断に<\/b>/.test(s));
  ok(f + '：年数・誇張を添えない', !/年後|日本初|唯一|絶対|100%|売りましょう/.test(t));
}
//  話す内容のある資料だけ、読み方を添える（銀行・事業説明・募集案内は話す内容を持たない）
for (const f of DECKS.filter((f) => !/pitch-bank|pitch-finance|recruit-partner/.test(f))) {
  ok(f + '：話す内容（読み方と日々の一行）', /<b>強調<\/b>日々の一行「継ぐ、を身近な経営判断に」/.test(slideOf(R(f), '目指す社会')));
}
for (const f of ['pitch-bank.html', 'pitch-finance.html', 'recruit-partner.html']) ok(f + '：話す内容は置かない', !/class="talk"/.test(slideOf(R(f), '目指す社会')));
ok('経営者向けは「運営会社の社名」', ['pitch-customer.html', 'pitch-buyer.html', 'pitch-seller.html'].every((f) => /運営会社の社名「<b>福來（ふくきたる）<\/b>」/.test(slideOf(R(f), '目指す社会'))));
ok('売り手向けは「選べる」（買う話を出さない）', /<h3>選べる<\/h3>/.test(slideOf(R('pitch-seller.html'), '目指す社会')) && !/会社を買う/.test(slideOf(R('pitch-seller.html'), '目指す社会')));
ok('パートナー向けは「その伴走者が、あなた」', ['pitch-partner.html', 'pitch-ep2-member.html', 'webinar-partner.html', 'recruit-partner.html'].every((f) => /それが、あなたです/.test(slideOf(R(f), '目指す社会'))));
ok('並び：経営者は次の一歩の前、パートナーは始め方の前、事業説明は会社概要の後', (function () {
  const ord = (f) => secs(R(f)).map((s) => (s.match(/data-t="([^"]*)"/) || [])[1]);
  const before = (f, t) => { const o = ord(f); return o[o.lastIndexOf(t) - 1] === '目指す社会'; };
  const after = (f, t) => { const o = ord(f); return o[o.lastIndexOf(t) + 1] === '目指す社会'; };
  return before('pitch-customer.html', '次の一歩') && before('pitch-buyer.html', '次の一歩') && before('pitch-seller.html', '次の一歩')
    && before('pitch-partner.html', '始め方') && before('pitch-ep2-member.html', '始め方') && before('pitch-ep1.html', '始め方') && before('pitch-ep2.html', '始め方')
    && before('pitch-general.html', '会社概要') && before('pitch-bank.html', 'はじめ方') && after('pitch-finance.html', '会社概要')
    && before('webinar-partner.html', 'まとめ') && before('recruit-partner.html', '始め方');
})());

// ③ 表紙・一枚紙の日々の一行
const COVERS = DECKS.concat(['manual-admin.html', 'manual-buyer.html', 'manual-customer.html', 'manual-ep.html', 'manual-partner.html', 'manual-seller.html', 'security.html']);
for (const f of COVERS) {
  const c = slideOf(R(f), '表紙');
  ok(f + '：表紙に日々の一行', /<div class="motto( in)?">継ぐ、を身近な経営判断に<\/div>/.test(c) && (R(f).match(/class="motto/g) || []).length === 1);
}
ok('縦に読む資料の表紙は、本文の下に置く', ['recruit-partner.html', 'manual-customer.html', 'security.html'].every((f) => /<div class="motto in">/.test(R(f))));
for (const f of ['sheet-partner.html', 'sheet-buyer.html', 'sheet-seller.html']) {
  ok(f + '：社名の下に日々の一行', R(f).indexOf('<div class="brand">TsuguAi <i>-継-</i><small>継ぐ、を身近な経営判断に</small></div>') >= 0);
}
{
  const WA = R('tsugu-wa.css');
  ok('見た目は tsugu-wa.css に1か所', /\.cover \.motto\{/.test(WA) && /\.vs-st\{/.test(WA) && /\.vs-mv\{/.test(WA) && /\.cover \.motto\.in\{position:static;/.test(WA)
    && !/\.vs-st\{/.test(R('pitch-wa.css')));
  ok('スマホでは縦に並べる', /@media\(max-width:820px\)\{[\s\S]{0,120}\.vs-mv,\.vs-c\{grid-template-columns:1fr;\}/.test(WA));
  ok('一枚紙の見た目', /\.hd \.brand small\{display:block;/.test(R('sheet.css')));
}

// ④ アプリ
{
  const SRC = R('index.html');
  ok('アプリ：題名・SNSの表示名', (SRC.match(/TsuguAi -継- \| 継ぐ、を身近な経営判断に/g) || []).length === 3);
  ok('アプリ：ログイン画面に日々の一行', /letter-spacing:\.06em;">継ぐ、を身近な経営判断に。<\/div>/.test(SRC));
  ok('継ナビくん：聞かれたらこの言葉どおりに答える', /TsuguAiが目指すものを聞かれたら、次の言葉どおりに伝えます（言い換えない）：ビジョン「継ぐ、が当たり前の社会へ」、ミッション「継ぐ、を経営の常識に」、日々の一行「継ぐ、を身近な経営判断に」。/.test(SRC)
    && ST.every((l) => SRC.indexOf(l) >= 0));
}

// ⑤ 古い言い回し
{
  const ALL = COVERS.concat(['index.html', 'sheet-partner.html', 'sheet-buyer.html', 'sheet-seller.html']);
  ok('古いビジョン「継ぐ・買う・譲るが当たり前の選択肢」が残っていない', ALL.every((f) => !/当たり前の選択肢になる社会/.test(R(f))));
  ok('古い題名「AIと人で、会社の未来を継ぐ」が残っていない', ALL.every((f) => R(f).indexOf('AIと人で、会社の未来を継ぐ') < 0));
}

if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
