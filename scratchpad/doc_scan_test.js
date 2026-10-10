// =============================================================
// 書類のスキャン（2026-10-10）
//   スマホのカメラで決算書・試算表を1枚ずつ撮り、白黒に整えて、まとめて AI で読み取る
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
const go = takeFn('scanGo');
ok('送る大きさの上限（7MB で止めて、分けて読むよう案内）', /if\(tot>7\*1024\*1024\)/.test(go) && /2回に分けて読み取ってください/.test(go));
const ps = takeFn('parseScanByAI');
ok('数枚を1つの書類として読む（finAskAI と同じ決まり・万円）', /type:'image', source:\{ type:'base64', media_type:'image\/jpeg', data:b64 \}/.test(ps) && /1つの試算表または決算書をページごとに撮った写真/.test(ps) && /finSetImportRows\(await finAskAI\(content\), 'スキャン読み取り'\);/.test(ps));
ok('スキャンのボタンは指で操作する端末だけ', /matchMedia\('\(pointer:coarse\)'\)/.test(takeFn('scanCan')));
ok('カルテの取り込み欄にスキャン（読み取ったら確認の表）', /onclick="finScan\(\\''\+custId\+'\\'\)">📷 書類をスキャンして読み取る<\/button>/.test(SRC) && /renderFinPreview\(custId\);/.test(takeFn('finScan')));
ok('税理士の先生の入力にもスキャン（ファイルと同じ流し込み）', /onclick="acctScan\(\\''\+f\.id\+'\\'\)">📷 スキャン<\/button>/.test(SRC) && /acctRead\(cid, function\(\)\{ return parseScanByAI\(imgs\); \}\)/.test(takeFn('acctScan')) && /await acctRead\(cid, async function\(\)\{/.test(takeFn('acctFile')));
ok('写真は残さない（閉じたら URL を捨てる）', /URL\.revokeObjectURL\(pg\.url\)/.test(takeFn('scanClose')));
ok('画像の URL（blob:）は CSP で許可済み', /img-src 'self' data: blob:/.test(SRC));
ok('説明書（パートナー）：スキャン', /<b>📷 書類をスキャンして読み取る<\/b>/.test(R('manual-partner.html')));
if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
