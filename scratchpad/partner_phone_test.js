// =============================================================
// パートナーの電話番号（2026-10-10）
//   設定に「電話番号」→ profiles.phone → 一枚紙の「担当・連絡先」に自動で入る
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html'), SQL = R('supabase/migrations/20261010020000_partner_phone.sql');
let n = 0, bad = [];
function ok(name, c) { n++; if (!c) bad.push(name); }
function takeFn(name) {
  const i = SRC.indexOf('\n  function ' + name + '(') >= 0 ? SRC.indexOf('\n  function ' + name + '(') : SRC.indexOf('\n  async function ' + name + '(');
  if (i < 0) throw new Error(name);
  return SRC.slice(i, SRC.indexOf('\n  }\n', i) + 4);
}
// SQL
ok('SQL：profiles に phone の列（何度流しても同じ）', /alter table public\.profiles add column if not exists phone text;/.test(SQL));
ok('SQL：使える文字と長さの決まり（既にある行は止めない）', /check \(phone is null or \(char_length\(phone\) <= 20 and phone ~ '\^\[0-9\+\(\) -\]\+\$'\)\) not valid;/.test(SQL));
ok('SQL：確かめは2つとも1', /as "電話の列"/.test(SQL) && /as "使える文字の決まり"/.test(SQL));
// 画面
ok('設定：パートナーにだけ「電話番号」の欄', /if\(r==='consultant'\)\{\n      \/\/  電話番号（2026-10-10）/.test(SRC) && /<input type="tel" id="set-phone"/.test(SRC) && /onclick="savePhone\(\)">保存/.test(SRC));
ok('設定：開いたら今の番号を読む', /if\(r==='consultant'\)\{ loadPhone\(\); loadInvoiceNo\(\);/.test(SRC));
const F = new Function(takeFn('phoneNorm') + takeFn('phoneOk') + 'return { norm: phoneNorm, ok: phoneOk };')();
ok('全角の数字・ハイフンは半角に', F.norm('０９０－１２３４－５６７８') === '090-1234-5678' && F.norm('（03）1234ー5678') === '(03)1234-5678');
ok('よい番号は通す', F.ok('090-1234-5678') && F.ok('+81 3 1234 5678') && F.ok(''));
ok('数字以外・長すぎるものは通さない', !F.ok('090-1234<b>') && !F.ok('012345678901234567890') && !F.ok('---'));
const sp = takeFn('savePhone');
ok('保存：自分の行の phone だけ、空なら null', /sb\.from\('profiles'\)\.update\(\{ phone:\(v\|\|null\) \}\)\.eq\('id',ME\)/.test(sp));
ok('保存：画面の中の自分の情報も新しくする（一枚紙にすぐ反映）', /window\.__prof\.phone=v\|\|null;/.test(sp));
ok('一枚紙：電話は登録した番号を先に', /tel: me\.phone \|\| c\.tel \|\| ''/.test(takeFn('sheetOpen')));
// 説明
ok('パートナー向け説明書：設定の表に電話番号', /<tr><th>電話番号<\/th><td>社長にお渡しする<b>一枚紙<\/b>/.test(R('manual-partner.html')));
ok('一枚紙：直す欄に、設定で登録した電話が入ると書く', ['sheet-buyer.html', 'sheet-seller.html'].every((f) => /電話番号（アプリの「⚙️ 設定」で登録したもの）が自動で入ります/.test(R(f))));
if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
