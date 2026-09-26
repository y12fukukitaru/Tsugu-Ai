// =============================================================
// 課金・契約：口座の欄に「保存する」と保存の状態を出す試験（2026-09-26）
//   入力は0.8秒後に自動で保存していたが、「✓ 保存しました」が画面のいちばん上にしか
//   出ず、下の口座の欄を入れている人からは保存されたか分からなかった。
//   ① お振込先・委託者情報の欄それぞれに「保存する」と状態の表示がある
//   ② 状態は上の説明と、欄の横の両方に出る（失敗は赤）
//   ③ 総合振込の委託者情報は、payout-file と同じ決まりで足りないものを先に出す
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const FN = fs.readFileSync(__dirname + '/../supabase/functions/payout-file/index.ts', 'utf8');
let n = 0, bad = [];
function is(name, got, want) { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) bad.push({ name, got: g, want: w }); }
function ok(name, cond) { is(name, !!cond, true); }
function takeFn(name) {
  const re = new RegExp('\\n  (?:async )?function ' + name + '\\s*\\(', 'g');
  let m, last = null, cnt = 0;
  while ((m = re.exec(SRC)) !== null) { last = m; cnt++; }
  if (!last) throw new Error('見つかりません: ' + name);
  is('定義は一つだけ: ' + name, cnt, 1);
  return SRC.slice(last.index, SRC.indexOf('\n  }\n', last.index) + 4);
}
// ① 欄ごとの「保存する」
is('「保存する」は口座の欄2つに', (SRC.match(/onclick="blRatesSaveNow\(\)">保存する<\/button>/g) || []).length, 2);
is('状態の表示も2つ', (SRC.match(/class="bl-save-st"/g) || []).length, 2);
ok('お振込先の欄の中にある', /id="bl-bank"[\s\S]{0,400}blRatesSaveNow/.test(SRC));
ok('委託者情報の欄の中にある', /id="bl-sacct"[\s\S]{0,900}blRatesSaveNow/.test(SRC));
ok('委託者情報の確かめの枠', /id="bl-sender-check"/.test(SRC));
// ② 状態
ok('状態は上と欄の横の両方に出す', /querySelectorAll\('\.bl-save-st'\)/.test(takeFn('blRatesNote')));
ok('保存できたら時刻つきで「✓ 保存しました」', /✓ 保存しました（'\+blHm\(\)\+'・運営全員に反映）/.test(takeFn('blRatesWrite')));
ok('失敗は赤で出す', /保存に失敗しました：'\+r\.error\.message,'#A9403D'/.test(takeFn('blRatesWrite')));
ok('読み込んだら最終保存の時刻', /最終保存 '\+blHm\(r\.data\.updated_at\)/.test(takeFn('blRatesLoad')));
ok('保存の仕組みが無いときは「保存できません」と赤で', /保存できません（保存機能のSQL設定が未実施のため/.test(takeFn('blRatesLoad')));
ok('「保存する」は待たずに保存する', /clearTimeout\(BL_SAVE_T\)[\s\S]*blRatesWrite\(\);/.test(takeFn('blRatesSaveNow')));
ok('自動保存は0.8秒後に同じ書き込み', /setTimeout\(blRatesWrite, 800\)/.test(takeFn('blRatesSave')));
ok('読み込むのは value と updated_at', /select\('value,updated_at'\)/.test(takeFn('blRatesLoad')));
// ③ 委託者情報の決まり
const issues = new Function(takeFn('blSenderIssues') + 'return blSenderIssues;')();
is('空なら全部', issues({}), ['委託者コード（無い銀行は 0）', '委託者名（カナ）', '銀行コード（4桁）', '支店コード（3桁）', '口座番号']);
is('そろっていれば無し', issues({ 'bl-sc': '0', 'bl-sname': 'ｶ)ﾂｸﾞｱｲ', 'bl-sbank': '0310', 'bl-sbranch': '101', 'bl-sacct': '1234567' }), []);
is('桁の違い', issues({ 'bl-sc': '12345678901', 'bl-sname': 'ｱ', 'bl-sbank': '310', 'bl-sbranch': '1010', 'bl-sacct': '12345678' }),
  ['委託者コードは10桁まで', '銀行コード（4桁）', '支店コード（3桁）', '口座番号は7桁まで']);
ok('Edge Function も同じ項目を確かめている', /sender\.bank\.length !== 4/.test(FN) && /sender\.branch\.length !== 3/.test(FN) && /missing\.push\("委託者コード"\)/.test(FN));
ok('入力のたびに確かめる', /blSenderCheck\(\);/.test(takeFn('blRatesSave')));

if (bad.length) { bad.forEach(b => console.log('NG', b.name, '\n   got ', b.got, '\n   want', b.want)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK ' + n + ' checks, 0 failed');
