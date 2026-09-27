// =============================================================
// 課金・契約：口座の欄は「保存する」を押したときだけ保存する（2026-09-27）
//   以前は料率と同じ自動保存（入力の0.8秒後）に乗っていて、
//   ・口座を打ちかけた途中の値が、押さなくても保存されていた
//   ・受け取る口座（お振込先）と振り込む口座（委託者情報）の「保存する」が、
//     どちらを押しても両方を保存していた（連動）
//   ① 口座の欄は入力しても保存しない（「● まだ保存していません」と出す）
//   ② 欄ごとの「保存する」は、その欄の口座だけを保存する
//   ③ 料率の自動保存は、口座を保存済みの値のまま書く（打ちかけを混ぜない）
//   ④ 取り消す・足りない項目の確かめ・書き込みの順番
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const MANA = fs.readFileSync(__dirname + '/../manual-admin.html', 'utf8');
let n = 0, bad = [];
function ok(name, c) { n++; if (!c) bad.push(name); }
function takeFn(name) {
  const re = new RegExp('\\n  (?:async )?function ' + name + '\\s*\\(', 'g');
  let m, last = null, cnt = 0;
  while ((m = re.exec(SRC)) !== null) { last = m; cnt++; }
  if (!last) throw new Error('見つかりません: ' + name);
  ok('定義は一つだけ: ' + name, cnt === 1);
  return SRC.slice(last.index, SRC.indexOf('\n  }\n', last.index) + 4);
}

// ① 入力しても保存しない
const acctIds = ['bl-bank', 'bl-sc', 'bl-sname', 'bl-sbank', 'bl-sbranch', 'bl-stype', 'bl-sacct'];
acctIds.forEach((id) => {
  const m = SRC.match(new RegExp('id="' + id + '"[^>]*>'));
  ok('入力しても保存しない: ' + id, m && !/blRatesSave/.test(m[0]) && /blAcctDirty\(\\'(recv|send)\\'\)/.test(m[0]));
});
ok('受け取る口座は recv、振り込む口座は send', /var BL_ACCT=\{ recv:\['bl-bank'\], send:\['bl-sc','bl-sname','bl-sbank','bl-sbranch','bl-stype','bl-sacct'\] \};/.test(SRC));
const dirty = takeFn('blAcctDirty');
ok('保存していない変更があると知らせる', /● まだ保存していません。「保存する」を押すと保存されます','#8A6A12'/.test(dirty) && /bl-acct-undo-'\+g/.test(dirty));
ok('絞り込みの欄も保存しない', !/placeholder="🔍 名前で絞り込み" oninput="renderAdmBilling\(\);blRatesSave\(\)"/.test(SRC) && !/placeholder="🔍 会社名で絞り込み" oninput="renderAdmBilling\(\);blRatesSave\(\)"/.test(SRC));
ok('料率の欄は自動保存のまま', /oninput="renderAdmBilling\(\);blRatesSave\(\)"><span class="u">/.test(SRC) && /setTimeout\(blRatesWrite, 800\)/.test(takeFn('blRatesSave')));

// ② 欄ごとの保存
const save = takeFn('blAcctSave');
ok('その欄の口座だけを差し替える', /BL_ACCT\[g\]\.forEach\(function\(id\)\{ v\[id\]=cur\[id\]; \}\);/.test(save) && /var cur=blAcctValues\(g\);/.test(save));
ok('押している間は二度押しできない', /btn\.disabled=true/.test(save) && /btn\.disabled=false/.test(save));
ok('保存した時刻を欄ごとに残す', /v\.__acctAt\[g\]=new Date\(\)\.toISOString\(\);/.test(save));

// ③ 料率の自動保存
const rw = takeFn('blRatesWrite');
ok('料率の自動保存は口座を書かない', /if\(blIsAcct\(id\)\) return;/.test(rw) && /blWrite\(function\(v\)\{ Object\.keys\(cur\)\.forEach\(function\(id\)\{ v\[id\]=cur\[id\]; \}\); \}\)/.test(rw));
const w = takeFn('blWrite');
ok('書き込みは保存済みの値を土台にする（知らない項目も消さない）', /var v=JSON\.parse\(JSON\.stringify\(BL_SAVED\|\|\{\}\)\);/.test(w) && /BL_SAVED=v; return null;/.test(w));
ok('書き込みは一つずつ順に', /var job=BL_WRITE_Q\.then\(async function\(\)\{/.test(w) && /BL_WRITE_Q=job\.catch/.test(w));
ok('料率と口座をまとめて保存する関数は無い', !/blRatesSaveNow/.test(SRC));

// ④ 取り消す・確かめ・読み込み
ok('取り消すと保存済みの値に戻る', /blAcctFill\(g\);/.test(takeFn('blAcctUndo')) && /BL_SAVED\[id\]/.test(takeFn('blAcctFill')));
ok('委託者情報は足りない項目を聞いてから保存', /if\(g==='send'\)\{\s*var iss=blSenderIssues\(cur\);\s*if\(iss\.length && !confirm\(/.test(save));
const load = takeFn('blRatesLoad');
ok('読み込みは打ちかけの口座を上書きしない（空なら入れ直す）', /if\(!BL_DIRTY\[g\] \|\| blank\)\{ BL_DIRTY\[g\]=false; blAcctFill\(g\); \}/.test(load) && /el && !blIsAcct\(id\)/.test(load));
ok('読み込んだら欄ごとの状態を出す', /\['recv','send'\]\.forEach\(blAcctDirty\);/.test(load));
{
  //  変えていないかどうかの判定（種別は空なら「普通」=1 とみなす）
  const env = 'var BL_ACCT={ recv:["bl-bank"], send:["bl-sc","bl-stype"] }; var BL_SAVED=arguments[0]; var DOM=arguments[1]; function $(id){ return { value: DOM[id] }; }';
  const f = new Function(env + takeFn('blAcctValues') + takeFn('blAcctSame') + '; return blAcctSame;');
  ok('同じなら変更なし', f({ 'bl-bank': 'A' }, { 'bl-bank': 'A' })('recv') === true);
  ok('違えば変更あり', f({ 'bl-bank': 'A' }, { 'bl-bank': 'B' })('recv') === false);
  ok('種別の既定は普通', f({ 'bl-sc': '0' }, { 'bl-sc': '0', 'bl-stype': '1' })('send') === true);
}

// 画面と説明書の文言
ok('画面の説明：口座は「保存する」を押したときだけ', /口座（お振込先・総合振込の委託者情報）は、それぞれの「保存する」を押したときだけ保存されます。/.test(SRC));
ok('説明書（運営）：口座は自動で保存しない', /口座の2つの欄（お振込先・総合振込の委託者情報）だけは自動で保存しません。/.test(MANA) && /その欄だけが保存されます（もう一方の口座は変わりません）/.test(MANA) && /お振込先と委託者情報（口座）は自動では保存されません。/.test(MANA));

if (bad.length) { bad.forEach((b) => console.log('NG ' + b)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK ' + n + ' checks, 0 failed');
