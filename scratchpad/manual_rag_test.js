// =============================================================
// 継ナビくんが説明書を読んでから答える（説明書RAG）の試験
//   ・質問ごとに、役割で読める資料から関係の深い頁を選ぶ（2文字ずつの組＋IDF）
//   ・選んだ頁の本文を system に足し、出典「📖 出典：説明書名 › 頁名」を求める
//   ・答えに出典が出た頁だけ「開く」ボタンにする
//   ・相談（secretarySend）とサポートAI（supportSend）の両方で使う
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
let n = 0, bad = [];
function ok(name, cond) { n++; if (!cond) bad.push(name); }
const src = R('index.html');
function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('no ' + name);
  let d = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') d++; else if (src[k] === '}') { d--; if (!d) return src.slice(i, k + 1); } }
}
const names = ['knvNorm', 'knvGrams', 'knvRagPrep', 'knvManualPick', 'knvManualNote', 'knvRagQuery', 'knvRefsUsed', 'knvRefsHtml', 'esc', 'escA'];
const lib = new Function('var KNV_RAG_PREP=null;' + names.map(grab).join('\n') + '\nreturn {' + names.join(',') + '};')();

// 資料を頁に分ける（ブラウザの DOMParser の代わりに、ざっくり正規表現で）
const dec = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
function pages(f, dn, sec) {
  const h = R(f), out = [];
  const re = /<section class="slide[^"]*"([^>]*)>([\s\S]*?)<\/section>/g;
  let m, i = 0;
  while ((m = re.exec(h))) {
    i++;
    const a = m[1], t = dec((a.match(/ data-t="([^"]*)"/) || [])[1] || '');
    if (!t || t === '表紙') continue;
    const body = m[2].replace(/<div class="talk"[\s\S]*?<\/div>/g, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ');
    out.push({ f, dn, sec, n: i, t, g: dec((a.match(/ data-g="([^"]*)"/) || [])[1] || ''),
      q: dec((a.match(/ data-q="([^"]*)"/) || [])[1] || '').split('|').map((x) => x.trim()).filter(Boolean),
      x: dec(body).replace(/\s+/g, ' ').trim() });
  }
  return out;
}
const CUS = pages('manual-customer.html', '経営者向け 操作説明書', 'manual');
const PAR = pages('manual-partner.html', 'パートナー向け 操作説明書', 'manual').concat(CUS, pages('pitch-customer.html', '顧客候補向け プロダクト説明', 'pitch'));
const ADM = pages('manual-admin.html', '運営向け 操作説明書', 'manual').concat(pages('manual-partner.html', 'パートナー向け 操作説明書', 'manual'), CUS);
ok('経営者の説明書を読めた', CUS.length > 20);

function top(idx, q) { return lib.knvManualPick(idx, q, 3).map((h) => h.p.t); }
function hit(label, idx, q, want) {
  const t = top(idx, q);
  ok(label + '「' + q + '」→「' + want + '」が上位3つに（実際: ' + t.join(' / ') + '）', t.some((x) => x.indexOf(want) >= 0));
}
// ① 経営者の質問
hit('経営者', CUS, 'iPhoneに通知が来ません', 'スマホ通知');
hit('経営者', CUS, 'アプリのバッジが付かない', 'スマホ通知');
hit('経営者', CUS, '解約したいときはどうすればいいですか', '解約');
// ② パートナーの質問
hit('パートナー', PAR, 'スマホに予定の通知を出したい', 'スマホ通知');
// ③ 運営の質問
hit('運営', ADM, '通知が届かないと言われたときの調べ方', 'スマホ通知');

// ④ 関係のない短いあいさつ・空は、何も渡さない
ok('空の質問は何も選ばない', lib.knvManualPick(CUS, '', 3).length === 0);
ok('1文字は何も選ばない', lib.knvManualPick(CUS, 'あ', 3).length === 0);
ok('あいさつは何も選ばない', lib.knvManualPick(CUS, 'こんにちは', 3).length === 0);
ok('経営の相談には何も選ばない', lib.knvManualPick(CUS, '来期の経営計画の立て方を相談したい', 3).length === 0);
hit('経営者', CUS, '担当パートナーにメッセージを送りたい', 'メッセージ');
hit('経営者', CUS, '月次レポートはいつ届く？', '月次レポート');
ok('最大3頁', lib.knvManualPick(PAR, '通知 料金 解約 予定 TODO メッセージ', 3).length <= 3);

// ⑤ 2文字ずつの組
const g = lib.knvGrams('スマホ通知、来ない？ iPhone');
ok('組：スマ', g.indexOf('スマ') >= 0);
ok('組：句読点をまたがない', g.indexOf('知来') < 0 && g.indexOf('知、') < 0);
ok('組：英字は単語のまま', g.indexOf('iphone') >= 0);

// ⑥ 渡す文
const hits = lib.knvManualPick(CUS, 'iPhoneに通知が来ません', 3);
const note = lib.knvManualNote(hits);
ok('渡す文：見出し', note.indexOf('【このアプリの説明書') >= 0);
ok('渡す文：出典の書き方', note.indexOf('📖 出典：説明書名 › 頁名') >= 0);
ok('渡す文：推測しない・問い合わせを案内', /推測で補わない/.test(note) && /運営への問い合わせ/.test(note));
ok('渡す文：経営相談には使わない', /関係のない質問なら、この頁は使わず/.test(note));
ok('渡す文：頁名つき', note.indexOf('経営者向け 操作説明書 › ') >= 0);
ok('渡す文：1頁 1200字まで', hits.every((h) => note.indexOf(h.p.x.slice(0, 1200)) >= 0) && note.length < 3 * 1300 + 1200);
ok('何も無ければ空', lib.knvManualNote([]) === '');

// ⑦ 出典に出た頁だけボタン
const refs = [{ f: 'manual-customer.html', dn: 'x', t: 'スマホ通知とバッジ' }, { f: 'manual-customer.html', dn: 'x', t: '困ったときは' }];
const used = lib.knvRefsUsed('…設定から許可してください。\n📖 出典：経営者向け 操作説明書 › スマホ通知とバッジ', refs);
ok('出典に出た頁だけ', used.length === 1 && used[0].t === 'スマホ通知とバッジ');
const bh = lib.knvRefsHtml(used);
ok('開くボタン', bh.indexOf("knvDocOpen('manual-customer.html','read','スマホ通知とバッジ')") >= 0 && bh.indexOf('📖 スマホ通知とバッジ を開く') >= 0);
ok('ボタンなし', lib.knvRefsHtml([]) === '');

// ⑧ 短い問いはひとつ前の問いも足す
const msgs = [{ role: 'user', content: 'iPhoneの通知の設定' }, { role: 'assistant', content: '…' }, { role: 'user', content: 'どこ？' }];
ok('短い問いは前の問いを足す', lib.knvRagQuery(msgs, 'どこ？').indexOf('iPhoneの通知の設定') >= 0);
ok('長い問いはそのまま', lib.knvRagQuery(msgs, 'スマホの通知を受け取るための設定のやりかたを詳しく教えてください') === 'スマホの通知を受け取るための設定のやりかたを詳しく教えてください');

// ⑨ つなぎ込み
ok('索引に sec', /out\.push\(\{ f:d\.f, dn:d\.n, sec:d\.sec,/.test(src));
ok('相談で使う', /man=await knvManualRag\(knvRagQuery\(SEC_MSGS, t\)\)/.test(src) && /secDrillNote\(\)\+rag\+man\.text;/.test(src));
ok('相談：出典の頁を覚える', /var refs=knvRefsUsed\(out, man\.refs\);/.test(src) && /refs:refs\.length\?refs:undefined/.test(src));
ok('相談：ボタンを出す', /\+\(m\.refs\?knvRefsHtml\(m\.refs\):''\)\n\s*\+\(thinking\?'':secShareBtn/.test(src));
ok('サポートAIで使う', /man=await knvManualRag\(knvRagQuery\(SUP_MSGS, t\)\)/.test(src) && /system:supBotSys\(\)\+man\.text/.test(src));
ok('サポートAI：ボタン', /srefs=knvRefsUsed\(sout, man\.refs\)/.test(src));
ok('3秒で打ち切る', /function knvManualRag\(q\)\{\n\s*var to=new Promise\(function\(res\)\{ setTimeout\(function\(\)\{ res\(null\); \}, 3000\); \}\);/.test(src));
ok('CSS', /\.knv-ref\{/.test(src));

// ⑨' 情報の守り（security.html も経営者の索引に入る）
const CUS2 = CUS.concat(pages('security.html', 'お客様の情報を守る仕組み', 'manual'));
['私の試算表は他の会社に見られませんか', '継ナビくんへの相談は運営に読まれる？', 'AIに送った試算表は学習に使われる？', '退会したらデータは消えますか'].forEach(function (q) {
  const t = lib.knvManualPick(CUS2, q, 3).map((h) => h.p.dn);
  ok('情報の守り「' + q + '」→ 資料が上位3つに（実際: ' + t.join(' / ') + '）', t.indexOf('お客様の情報を守る仕組み') >= 0);
});

// ⑩ 説明書にも書く
ok('経営者の説明書：説明書を読んでから答える', /使い方の質問には、この説明書を読んでから答えます。/.test(R('manual-customer.html')) && /使い方を継ナビくんに聞ける？/.test(R('manual-customer.html')));
ok('パートナーの説明書：同上', /使い方の質問には、説明書（この説明書・経営者向け説明書・商談スライド）から関係する頁を探して読んでから答えます。/.test(R('manual-partner.html')));
ok('運営の説明書：説明書を直せば答えも変わる', /説明書を直せば、継ナビくんの答えも変わります。/.test(R('manual-admin.html')));

// ⑪ 経営者・運営の案内文（secUsageGuide）にもスマホ通知
const gi = src.indexOf('function secUsageGuide'), guide = src.slice(gi, src.indexOf('\n  function ', gi + 30));
ok('経営者の案内：届かないときの直し方', /iPhoneの設定→通知にTsuguAiが無い=許可の確認画面が一度も出ていない/.test(guide));
ok('経営者の案内：バッジ', /Androidは数字でなく点/.test(guide));
ok('運営の案内：調べ方', /cron\.job_run_details と push_reminder_log を見る/.test(guide));

if (bad.length) { console.log(bad.join('\n')); console.log(n + ' 件中 ' + bad.length + ' 件 不合格'); process.exit(1); }
console.log(n + ' 件 ぜんぶ通りました');
