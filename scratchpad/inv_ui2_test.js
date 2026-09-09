// =============================================================
// 単発の請求・お支払い方法まわりの画面側の試験
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');

let n = 0, bad = [];
function is(name, got, want) {
  n++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) bad.push({ name, got: g, want: w });
}
function ok(name, cond) { is(name, !!cond, true); }

// ---- index.html から関数を取り出す（最後に定義されたものが実際に動く）----
function takeFn(name) {
  const re = new RegExp('\\n  function ' + name + '\\s*\\(', 'g');
  let m, last = null;
  while ((m = re.exec(SRC)) !== null) last = m;
  if (!last) throw new Error('見つかりません: ' + name);
  const end = SRC.indexOf('\n  }\n', last.index);
  if (end < 0) throw new Error('終わりが見つかりません: ' + name);
  return SRC.slice(last.index, end + 4);
}

const yenSrc = takeFn('yen');
const mod = new Function(
  yenSrc + takeFn('esc') +
  takeFn('invMethodLabel') + takeFn('invMethodTag') +
  takeFn('invKindLabel') + takeFn('invStatusLabel') +
  'return { yen, esc, invMethodLabel, invMethodTag, invKindLabel, invStatusLabel };'
)();

// =============================================================
// ① お支払い方法の言い方
// =============================================================
is('口座振替', mod.invMethodLabel('transfer'), '口座振替');
is('銀行振込', mod.invMethodLabel('bank'), '銀行振込');
is('カード', mod.invMethodLabel('card'), 'カード');
//  口座振替を入れる前に立てた請求は method が空。振込として扱う。
//  ここが「未設定」などと出ると、お客様は何をすればよいか分からない
is('空欄は銀行振込として扱う', mod.invMethodLabel(null), '銀行振込');
is('空文字も銀行振込', mod.invMethodLabel(''), '銀行振込');
is('知らない値も銀行振込', mod.invMethodLabel('paypay'), '銀行振込');
ok('口座振替は緑の札', mod.invMethodTag('transfer').indexOf('tag green') >= 0);
ok('振込は青の札', mod.invMethodTag('bank').indexOf('tag blue') >= 0);
ok('空欄も青の札', mod.invMethodTag(null).indexOf('tag blue') >= 0);

// =============================================================
// ② 区分の言い方
// =============================================================
is('FA手数料', mod.invKindLabel('fa'), 'FA手数料');
is('顧問料', mod.invKindLabel('advisory'), '顧問料');
is('初期導入費', mod.invKindLabel('setup'), '初期導入費');
is('知らない区分は空', mod.invKindLabel('zzz'), '');

// =============================================================
// ③ 画面に出す文言
// =============================================================
//  引き落とすのに「お振込ください」と出すと二重にお支払いいただく。
//  口座振替のときは、はっきり不要と言う
ok('口座振替は「お振込は不要です」と出す',
  /口座振替のぶんは、ご登録の口座からお引き落としになります。お振込は不要です。/.test(SRC));
ok('振込のときだけ振込先を出す',
  /銀行振込のぶんは、下記へお振込ください。/.test(SRC));
ok('振込先が未設定なら担当パートナーへ案内する',
  /振込先は担当パートナーまでお問い合わせください。/.test(SRC));
ok('振込手数料の負担を書いてある', /振込手数料はご負担をお願いしております。/.test(SRC));
//  期日前のものを赤で出すと、まだ払う日が来ていない方まで不安になる
ok('これからのお支払いは別枠で出す', /これからのお支払い/.test(SRC));

// =============================================================
// ④ 単発の請求のフォーム
// =============================================================
ok('請求先の欄がある', /id="iva-cust"/.test(SRC));
ok('区分にFA手数料がある', /<option value="fa">M&AのFA手数料<\/option>/.test(SRC));
ok('件名の欄がある', /id="iva-title"/.test(SRC));
ok('金額の欄がある', /id="iva-amt"/.test(SRC));
ok('期日の欄がある', /id="iva-due"/.test(SRC));
ok('方法の欄がある', /id="iva-method"/.test(SRC));
ok('立てるボタンがある', /onclick="invAdd\(\)"/.test(SRC));
ok('顧問料はここで立てないと書いてある',
  /顧問料はここではなく、上の「この月の請求を立てる」からどうぞ/.test(SRC));
//  税抜で入れていただくので、税込がいくらになるか押す前に見せる
ok('税込の下見せがある', /function ivaPreview/.test(SRC));
ok('下見せを金額の入力でよぶ', /id="iva-amt"[^>]*oninput="ivaPreview\(\)"/.test(SRC));
ok('タブを開いたときに請求先をそろえる', /invInitMonths\(\); ivaInit\(\);/.test(SRC));

// =============================================================
// ⑤ 呼び出しの形（SQL側の引数と合っていること）
// =============================================================
ok('invoice_add を正しい引数で呼ぶ',
  /invoice_add',\{ p_customer:cust, p_kind:kind, p_title:title,\s*\n\s*p_amount_ex:ex, p_due_on:due, p_period:null, p_method:mth, p_note:null \}/.test(SRC));
ok('invoice_generate に方法を渡す',
  /invoice_generate',\{ p_period:ym, p_due_day:due, p_method:mth \}/.test(SRC));
ok('invoice_set_method を呼ぶ',
  /invoice_set_method',\{ p_id:id, p_method:to \}/.test(SRC));
ok('請求の一覧で method を取ってくる',
  /select\('id,customer_id,period,kind,title,amount,paid_amount,due_on,status,paid_on,void_reason,method'\)/.test(SRC));
ok('顧客側でも method を取ってくる',
  /select\('id,customer_id,period,title,amount,paid_amount,due_on,status,method'\)/.test(SRC));

// =============================================================
// ⑥ 振込先の設定
// =============================================================
ok('振込先の入力欄がある', /id="bl-bank"/.test(SRC));
ok('振込先も保存される', /BL_RATE_IDS=\[[^\]]*'bl-bank'\]/.test(SRC));
//  ここに他人の口座を入れられると、方針が崩れる。画面で釘を刺しておく
ok('お客様の口座は入れない旨が書いてある',
  /お客様・パートナーの口座はここには入れません/.test(SRC));

// =============================================================
// ⑦ 版
// =============================================================
const build = (SRC.match(/var APP_BUILD='([^']+)'/) || [])[1];
const vj = JSON.parse(fs.readFileSync(__dirname + '/../version.json', 'utf8'));
is('版が version.json と同じ', vj.build, build);

// =============================================================
console.log(n + ' 件中 ' + (n - bad.length) + ' 件 合格、' + bad.length + ' 件 不合格');
bad.forEach(b => console.log('  × ' + b.name + '\n      実際: ' + b.got + '\n    あるべき: ' + b.want));
process.exit(bad.length ? 1 : 0);
