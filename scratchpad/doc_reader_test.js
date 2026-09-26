// =============================================================
// 資料の「目次から読む」の試験（doc-reader.js と、各資料の data-t / data-g / data-q）
//   ・どの資料も doc-reader.js を読み込む
//   ・どの頁にも題（data-t）がある。表紙以外は組（data-g）もある
//   ・質問（data-q）が、資料ごとに決めた数以上ある。書き方が崩れていない
//   ・doc-reader.js に、深いリンク（#t= #q= ?view=）・TSUGU_DOC・3つのタブ・
//     localStorage の try/catch がある
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
let n = 0, bad = [];
function ok(name, cond) { n++; if (!cond) bad.push(name); }
function no(name, cond) { ok(name, !cond); }

const DOCS = ['manual-customer.html', 'manual-partner.html', 'manual-admin.html', 'manual-ep.html',
  'pitch-customer.html', 'pitch-partner.html', 'pitch-general.html', 'pitch-bank.html', 'pitch-finance.html',
  'pitch-ep1.html', 'pitch-ep2.html', 'recruit-partner.html'];
//  質問の数の下限（説明書は 40〜120、商談スライドはそれより少なめ）
const MIN_Q = {
  'manual-customer.html': 80, 'manual-partner.html': 100, 'manual-admin.html': 70, 'manual-ep.html': 30,
  'pitch-customer.html': 40, 'pitch-partner.html': 25, 'pitch-ep1.html': 30, 'pitch-ep2.html': 20
};
const dec = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// ① 各資料
DOCS.forEach(function (f) {
  const src = R(f);
  ok(f + ' が doc-reader.js を読み込む', /<script src="doc-reader.js"><\/script>\s*<\/body>/.test(src));
  ok(f + ' の doc-reader.js は1回だけ', src.split('src="doc-reader.js"').length === 2);
  const tags = src.match(/<section class="slide[^"]*"[^>]*>/g) || [];
  ok(f + ' に頁がある', tags.length > 0);
  const titles = [];
  let nq = 0, qs = [];
  tags.forEach(function (tag, i) {
    const t = (tag.match(/ data-t="([^"]*)"/) || [])[1];
    ok(f + ' #' + (i + 1) + ' に data-t', !!t);
    if (!t) return;
    titles.push(dec(t));
    if (dec(t) !== '表紙') ok(f + ' 「' + dec(t) + '」に data-g', / data-g="[^"]+"/.test(tag));
    const q = (tag.match(/ data-q="([^"]*)"/) || [])[1];
    if (q != null) {
      const list = dec(q).split('|');
      list.forEach(function (x) {
        ok(f + ' 「' + dec(t) + '」の質問が空でない', x.trim().length > 0);
        ok(f + ' 質問は短く（60字まで）：' + x, x.length <= 60);
        qs.push(x);
      });
      nq += list.length;
      no(f + ' 「' + dec(t) + '」に質問が多すぎない（6件まで）', list.length > 6);
    }
  });
  ok(f + ' の表紙は data-t="表紙"', titles[0] === '表紙');
  ok(f + ' の題は重ならない（#t= で一つに決まる）', new Set(titles).size === titles.length);
  if (MIN_Q[f]) ok(f + ' の質問は ' + MIN_Q[f] + ' 件以上（いま ' + nq + '）', nq >= MIN_Q[f]);
  //  質問は、読む人の言葉で。「？」で終わるか、「〜したい」「〜のしかた」などの形
  if (MIN_Q[f]) ok(f + ' の質問の多くは「？」か「たい」で終わる',
    qs.filter(function (x) { return /[？?]$|たい$|たい）$|しかた$|かた$|とき$|出る$|ない$|消えない$|合わない$|いない$|は$/.test(x); }).length >= qs.length * 0.9);
  //  深いリンクの邪魔をしない：説明書は #t= / #q= のとき #1 に書き換えない
  if (/^manual-/.test(f)) ok(f + ' は #t= #q= を上書きしない', /if\(!\/\^#\(t\|q\|view\)=\/\.test\(location\.hash\)\) history\.replaceState/.test(src));
});

// ② 中身の正しさ（いまの決まりと合っているか）
{
  const C = R('manual-customer.html'), P = R('manual-partner.html'), PC = R('pitch-customer.html');
  ok('顧客説明書：解約したいときは？ →「プランの変更と解約」',
    /data-t="プランの変更と解約"[^>]*data-q="[^"]*解約したいときは？/.test(C));
  ok('顧客説明書：顧問税理士に数字を入れてもらえる？ →「税理士へのお願い」',
    /data-t="税理士へのお願い"[^>]*data-q="[^"]*顧問税理士に数字を入れてもらえる？/.test(C));
  ok('顧客説明書：継ナビくんの大きさ →「設定」', /data-t="設定"[^>]*data-q="[^"]*継ナビくんの大きさを変えたい/.test(C));
  ok('パートナー説明書：出口の設計の入れ場所（カルテ → 企業価値・承継 → 出口の設計・株の持ち方）',
    /data-t="出口の設計"[^>]*data-q="[^"]*カルテ → 企業価値・承継 → 出口の設計・株の持ち方/.test(P));
  ok('パートナー説明書：資格の確認 →「本業と連携①」', /data-t="本業と連携①"[^>]*data-q="[^"]*資格の確認はどうやる？/.test(P));
  ok('商談（経営者）：最低報酬は？ →「2年目｜お金の話」', /data-t="2年目｜お金の話"[^>]*data-q="[^"]*最低報酬は？/.test(PC));
  ok('商談（経営者）：料金は？ →「料金」', /data-t="料金"[^>]*data-q="料金は？/.test(PC));
  ok('答える頁の本文：売り手プラン 35,000円', /売り手プラン（譲渡準備）35,000円/.test(PC));
  ok('答える頁の本文：最低報酬はどなたにも無い', /どなたにも最低報酬がありません/.test(PC));
}

// ③ doc-reader.js
{
  const J = R('doc-reader.js');
  ok('doc-reader.js：#t= を読む', /\(t\|q\|view\)=/.test(J) && /o\.t=hp\.get\('t'\)/.test(J));
  ok('doc-reader.js：#q= で目次から読む＋検索', /if\(o\.q\) v='read'/.test(J) && /qInput\.value=o\.q/.test(J));
  ok('doc-reader.js：?view= を読む', /sp\.get\('view'\)/.test(J) && /o\.view==='read'\|\|o\.view==='slide'/.test(J));
  ok('doc-reader.js：?t= を読む', /o\.t=sp\.get\('t'\)/.test(J));
  ok('doc-reader.js：#数字（いままでのリンク）', /\/\^\\d\+\$\/\.test\(h\)/.test(J));
  ok('doc-reader.js：hashchange に応じる', /addEventListener\('hashchange'/.test(J));
  ok('doc-reader.js：TSUGU_DOC を出す', /W\.TSUGU_DOC=\{/.test(J) && /slides:DATA\.map/.test(J) && /text:d\.text\.slice\(0,600\)/.test(J));
  ok('doc-reader.js：TSUGU_DOC の頁は n,t,g,q,text', /\{n:d\.n, t:d\.t, g:d\.g, q:d\.q\.slice\(\), text:/.test(J));
  ok('doc-reader.js：3つのタブ', /data-tab="toc"[^<]*>目次</.test(J) && /data-tab="q"[^<]*>質問から探す</.test(J) && /data-tab="idx"[^<]*>索引</.test(J));
  ok('doc-reader.js：切り替えの2つ', /スライドで見る/.test(J) && /目次から読む/.test(J));
  ok('doc-reader.js：スマホの「目次・さがす」', /目次・さがす/.test(J));
  ok('doc-reader.js：話す内容も表示（商談スライドだけ）', /話す内容も表示/.test(J) && /KIND==='deck' && S\.some/.test(J));
  ok('doc-reader.js：localStorage は try/catch', /function lsGet\(k\)\{ try\{ return W\.localStorage\.getItem\(k\); \}catch\(e\)\{ return null; \} \}/.test(J)
    && /function lsSet\(k,v\)\{ try\{ W\.localStorage\.setItem\(k,v\); \}catch\(e\)\{\} \}/.test(J));
  no('doc-reader.js：localStorage を try の外で触らない', /[^.]localStorage\.(get|set)Item/.test(J.replace(/W\.localStorage\.(get|set)Item/g, '')));
  ok('doc-reader.js：資料ごとに覚える', /LSKEY='tsugu_docview:'\+FILE/.test(J));
  ok('doc-reader.js：五十音の行', /GYO=\['あ','か','さ','た','な','は','ま','や','ら','わ','A–Z','漢字・その他'\]/.test(J));
  ok('doc-reader.js：Intl.Collator(ja) で並べる', /new Intl\.Collator\('ja'\)/.test(J));
  ok('doc-reader.js：24字を超える語は索引に入れない', /s\.length>24/.test(J));
  ok('doc-reader.js：目次から読むでは矢印で送らない', /ArrowRight\|ArrowLeft/.test(J) && /e\.stopPropagation\(\);/.test(J) && /W\.mv=function\(d\)\{ if\(isRead\(\)\) return;/.test(J));
  ok('doc-reader.js：iframe では「プラットフォームに戻る」', /tsugu:'closeManual'/.test(J));
  ok('doc-reader.js：印刷は目次から読むとき縦・全頁', /@page\{size:A4 portrait/.test(J) && /pageSt\.media='print'/.test(J) && /pageSt\.media='not all'/.test(J));
  ok('doc-reader.js：スマホの設えは画面だけ（印刷に効かせない）', !/@media\(max-width/.test(J));
  ok('doc-reader.js：写しの頁を section.slide にしない（数え間違いを防ぐ）', /' dr-slide'/.test(J) && /replace\(\/ slide \| on \/g,' '\)/.test(J));
  ok('doc-reader.js：CSS は自分で差し込む', /st\.id='dr-style'/.test(J));
  ok('doc-reader.js：色は既定の語彙', /#1E3A66/.test(J) && /#C39B3F/.test(J) && /#5A6981/.test(J) && /#F8F9FC/.test(J) && /#E2E7EF/.test(J));
}
console.log(bad.length ? bad.join('\n') : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
