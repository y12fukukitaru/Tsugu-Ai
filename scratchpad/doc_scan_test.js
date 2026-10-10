// =============================================================
// 書類のスキャン（2026-10-10）
//   スマホのカメラで決算書・試算表を1枚ずつ撮り、白黒に整えて、まとめて AI で読み取る
//   撮ったものは色々に使える：PDFにする（保存・共有）／文字に書き起こす／PDFで送る／継ナビくんに見せる
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
let n = 0, bad = [];
function ok(name, c) { n++; if (!c) bad.push(name); }
function takeFn(name) {
  let i = SRC.indexOf('\n  function ' + name + '('); if (i < 0) i = SRC.indexOf('\n  async function ' + name + '(');
  if (i < 0) throw new Error(name);
  return SRC.slice(i, SRC.indexOf('\n  }\n', i) + 4);
}
const paint = takeFn('scanPaint');
ok('カメラで撮る（背面のカメラ）', /<input type="file" accept="image\/\*" capture="environment" onchange="scanAdd\(this\)">/.test(paint));
ok('1ページずつ、8枚まで', /var SCAN_MAX=8;/.test(SRC) && /\(n<SCAN_MAX\?/.test(paint));
ok('撮った写真ごとに「回す」「外す」', /onclick="scanRotate\('\+i\+'\)"/.test(paint) && /onclick="scanDel\('\+i\+'\)"/.test(paint));
ok('撮り方の案内（明るい所・画面いっぱい・真上から）', /明るい所で、書類を<b>画面いっぱい<\/b>に、<b>真上から<\/b>撮ってください/.test(paint));
const en = takeFn('scanEnhance');
ok('整える：長い辺1600px・白黒・濃淡を伸ばす・JPEG', /1600\/Math\.max\(w,h\)/.test(en) && /0\.299\*px\[i\]\+0\.587\*px\[i\+1\]\+0\.114\*px\[i\+2\]/.test(en) && /tot\*0\.02/.test(en) && /'image\/jpeg', 0\.85/.test(en));
const imgs = takeFn('scanImgs');
ok('AI に送る大きさの上限（7MB で止めて、分けるよう案内）', /if\(tot>7\*1024\*1024\)/.test(imgs) && /2回に分けてください/.test(imgs));
ok('使い道：開いた場所の1つ＋どこでも使える2つ（撮るまでは押せない）', /onclick="scanDo\(\\'main\\'\)">'\+esc\(SCAN\.main\.label\)/.test(paint) && /onclick="scanDo\(\\'pdf\\'\)"><span>📄<\/span>PDFにする/.test(paint) && /onclick="scanDo\(\\'text\\'\)"><span>📝<\/span>文字に書き起こす/.test(paint) && (paint.match(/\(n\?'':' disabled'\)/g) || []).length === 3);
ok('古い書き方（関数を渡す）は「読み取る」として扱う', /if\(typeof main==='function'\) main=\{ label:'読み取る', ai:true, run:main \};/.test(takeFn('scanOpen')));
const sdo = takeFn('scanDo');
ok('AI の使い道は写真（base64）、それ以外は PDF のファイルを渡す', /if\(main\.ai\)\{[\s\S]*?var imgs=await scanImgs\(\);\s*scanClose\(\); await main\.run\(imgs\);/.test(sdo) && /var file=await scanPdf\(\);\s*scanClose\(\); await main\.run\(file\);/.test(sdo));
const pdf = takeFn('scanPdfBytes');
ok('PDF：1枚＝A4 1ページ（横長は横向き）・JPEG はそのまま（DCTDecode）', /PW=land\?841\.89:595\.28, PH=land\?595\.28:841\.89/.test(pdf) && /\/Filter \/DCTDecode/.test(pdf) && /xref/.test(pdf) && /startxref/.test(pdf));
//  実際に PDF を作って、目次（xref）の位置が正しいかを確かめる
{
  const f = new Function('TextEncoder', pdf + 'return scanPdfBytes;')(TextEncoder);
  const jpg = Uint8Array.from([0xFF, 0xD8, 1, 2, 3, 0xFF, 0xD9]);
  const parts = f([{ w: 900, h: 1200, jpg }, { w: 1200, h: 800, jpg }]);
  const buf = Buffer.concat(parts.map((p) => Buffer.from(p)));
  const txt = buf.toString('latin1');
  ok('PDF の頭と終わり', txt.startsWith('%PDF-1.4') && txt.trimEnd().endsWith('%%EOF'));
  const sx = +txt.match(/startxref\n(\d+)/)[1];
  ok('startxref は xref の位置', txt.slice(sx, sx + 4) === 'xref');
  const rows = txt.slice(sx).split('\n').slice(3, 3 + 8);
  ok('xref の各行は、その番号の obj の位置', rows.every((r, i) => txt.slice(+r.slice(0, 10), +r.slice(0, 10) + String(i + 1).length + 6) === (i + 1) + ' 0 obj'));
  ok('2ページ（縦・横）', /\/Count 2/.test(txt) && /MediaBox \[0 0 595\.28 841\.89\]/.test(txt) && /MediaBox \[0 0 841\.89 595\.28\]/.test(txt));
}
ok('PDF の保存・共有（共有できる端末は送る・共有、なければ保存）', /navigator\.canShare\(\{ files:\[o\.file\] \}\)/.test(takeFn('scanOutHtml')) && /navigator\.share\(\{ files:\[f\], title:f\.name \}\)/.test(takeFn('scanPdfShare')) && /a\.download=name;/.test(takeFn('scanDownload')));
const tr = takeFn('scanTranscribe');
ok('書き起こし：そのまま・表は「｜」・読めない所は［判読不能］・憶測しない', /要約・言い換え・説明・前置きはしない/.test(tr) && /欄を「｜」で区切る/.test(tr) && /［判読不能］/.test(tr) && /憶測で文字や数字を作らない/.test(tr));
ok('書き起こしはコピー・テキストで保存', /navigator\.clipboard\.writeText\(t\.value\)/.test(takeFn('scanTextCopy')) && /text\/plain;charset=utf-8/.test(takeFn('scanTextSave')));
ok('ページを足す・回す・外すと、前に作ったものは消す', ['scanAdd', 'scanRotate', 'scanDel'].every((n) => /scanOutDrop\(\);/.test(takeFn(n))));
ok('メッセージ：📷 → PDFにして送る（いつもの下見と「送信」）', /onclick="knvMsgScan\(\)">📷<\/button>/.test(SRC) && /label:'✉️ PDFにして送る', run:function\(f\)\{ knvMsgPreview\(f\); \}/.test(takeFn('knvMsgScan')));
ok('相談：📷 → 継ナビくんに見せる（質問に添える）', /onclick="knvAskScan\(\)"/.test(SRC) && /label:'💬 継ナビくんに見せる'/.test(takeFn('knvAskScan')) && /knvAskPreview\(f\);/.test(takeFn('knvAskScan')));
ok('📷 は指で操作する端末だけ（CSS）', /@media \(pointer:coarse\)\{ \.scan-only\{display:inline-flex !important;\} \}/.test(SRC) && /class="ghost scan-only" id="knv-ask-scan"/.test(SRC) && /class="ghost scan-only" id="knv-msg-scan"/.test(SRC));
const ps = takeFn('parseScanByAI');
ok('数枚を1つの書類として読む（finAskAI と同じ決まり・万円）', /type:'image', source:\{ type:'base64', media_type:'image\/jpeg', data:b64 \}/.test(ps) && /1つの試算表または決算書をページごとに撮った写真/.test(ps) && /finSetImportRows\(await finAskAI\(content\), 'スキャン読み取り'\);/.test(ps));
ok('スキャンのボタンは指で操作する端末だけ', /matchMedia\('\(pointer:coarse\)'\)/.test(takeFn('scanCan')));
ok('カルテの取り込み欄にスキャン（読み取ったら確認の表）', /onclick="finScan\(\\''\+custId\+'\\'\)">📷 書類をスキャンして読み取る<\/button>/.test(SRC) && /renderFinPreview\(custId\);/.test(takeFn('finScan')));
ok('税理士の先生の入力にもスキャン（ファイルと同じ流し込み）', /onclick="acctScan\(\\''\+f\.id\+'\\'\)">📷 スキャン<\/button>/.test(SRC) && /label:'📊 数字を読み取る', ai:true, run:function\(imgs\)\{ return acctRead\(cid, function\(\)\{ return parseScanByAI\(imgs\); \}\); \}/.test(takeFn('acctScan')) && /await acctRead\(cid, async function\(\)\{/.test(takeFn('acctFile')));
ok('写真は残さない（閉じたら URL を捨てる）', /URL\.revokeObjectURL\(pg\.url\)/.test(takeFn('scanClose')));
ok('画像の URL（blob:）は CSP で許可済み', /img-src 'self' data: blob:/.test(SRC));
ok('説明書（パートナー）：スキャン', /<b>📷 書類をスキャンして読み取る<\/b>/.test(R('manual-partner.html')) && /data-t="書類をスキャンする"/.test(R('manual-partner.html')) && /「📊 数字を読み取る」/.test(R('manual-partner.html')));
ok('説明書（経営者）：スキャンの頁（PDF・書き起こし・送る・見せる）', ['manual-customer.html', 'manual-buyer.html', 'manual-seller.html'].every((f) => /data-t="書類をスキャンする"/.test(R(f)) && /「✉️ PDFにして送る」/.test(R(f)) && /「💬 継ナビくんに見せる」/.test(R(f)) && /📄 PDFにする/.test(R(f)) && /📝 文字に書き起こす/.test(R(f))));
ok('説明書（運営）：PDF・書き起こし', /「📄 PDFにする」<\/b>（保存・共有）と<b>「📝 文字に書き起こす」/.test(R('manual-admin.html')));
if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
