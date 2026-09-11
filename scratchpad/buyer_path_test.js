// =============================================================
// 買い手の道筋の試験（④ ステージ表／⑤ レベル／⑧ 停滞）
//
//   ④ 譲受の案件には買い手の手順が、譲渡には売り手の手順が出ること。
//      段階の数と名前は揃っていること。stage の数字を DB にそのまま
//      持っていて、PMI_STAGE=7 の判定を両方の表で共有しているため。
//
//   ⑤ 顧問先の成約（譲受）でもレベルが上がること。売り手の成約は
//      数えないこと。顧問契約の件数だけの道も、これまでどおり生きて
//      いること。
//
//   ⑧ 検討・準備（stage 0）で止まった案件も朝の便りに出ること。
//      どの段階で止まっているかが添えられ、60日を超えたら色が上がること。
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
function no(name, cond) { is(name, !!cond, false); }

function takeFn(name) {
  const re = new RegExp('\\n  function ' + name + '\\s*\\(', 'g');
  let m, last = null;
  while ((m = re.exec(SRC)) !== null) last = m;
  if (!last) throw new Error('見つかりません: ' + name);
  //  一行関数（{ ... } が同じ行で閉じる）にも対応する
  const nl = SRC.indexOf('\n', last.index + 1);
  const line = SRC.slice(last.index, nl);
  if (/\{.*\}\s*$/.test(line)) return line + '\n';
  const end = SRC.indexOf('\n  }\n', last.index);
  if (end < 0) throw new Error('終わりが見つかりません: ' + name);
  return SRC.slice(last.index, end + 4);
}
function takeArr(name) {
  const re = new RegExp('\\n  var ' + name + '\\s*=\\s*\\[', 'g');
  let m, last = null;
  while ((m = re.exec(SRC)) !== null) last = m;
  if (!last) throw new Error('見つかりません: var ' + name);
  const end = SRC.indexOf('\n  ];', last.index);
  return SRC.slice(last.index, end + 5);
}

// ---------------------------------------------------------------
// ④ ステージ表
// ---------------------------------------------------------------
const stg = new Function(
  takeArr('MA_STAGES') + takeArr('MA_STAGES_BUY') + takeFn('maStages') +
  'return { SELL: MA_STAGES, BUY: MA_STAGES_BUY, of: maStages };'
)();

is('段階の数が同じ', stg.BUY.length, stg.SELL.length);
is('段階の名前が同じ', stg.BUY.map(s => s.n), stg.SELL.map(s => s.n));
ok('9段階ある', stg.SELL.length === 9);
ok('譲受の案件には買い手の表', stg.of({ deal_type: '譲受' }) === stg.BUY);
ok('譲渡の案件には売り手の表', stg.of({ deal_type: '譲渡' }) === stg.SELL);
ok('種類が無いときは売り手の表（これまでの案件を壊さない）', stg.of({}) === stg.SELL);
ok('案件そのものが無くても落ちない', stg.of(null) === stg.SELL);
//  買い手の手順が、買い手の動きになっていること
const buyAll = stg.BUY.map(s => s.t.join('／')).join('／');
ok('買い手は意向表明書を「提出」する', /意向表明書の提出/.test(buyAll));
no('買い手が意向表明書を「受領」していない', /意向表明書の受領/.test(buyAll));
ok('買い手は株式を「受領」する', /株式の受領/.test(buyAll));
no('買い手が株式を「引渡し」ていない', /株式の引渡し/.test(buyAll));
ok('買い手はノンネームシートを「受領」する', /ノンネームシートの受領/.test(buyAll));
no('買い手がノンネームシートを「作成」していない', /ノンネームシートの作成/.test(buyAll));
ok('買い手の手順に譲受余力が出てくる', /譲受余力/.test(buyAll));
ok('買い手の手順に資金調達が出てくる', /資金調達/.test(buyAll));
ok('買い手の完了に「柱」がある', /柱が一本増えた/.test(stg.BUY[8].t.join('')));
//  売り手の表は触っていない
ok('売り手の手順はこれまでどおり（意向表明書の受領）', /意向表明書の受領/.test(stg.SELL.map(s => s.t.join('')).join('')));
//  PMI の段階は両方で 7 番目
is('PMI の段階の名前（買い手）', stg.BUY[7].n, 'クロージング・PMI');
is('PMI の段階の名前（売り手）', stg.SELL[7].n, 'クロージング・PMI');
//  各段階に「やること」がある
ok('買い手のどの段階にも、やることが2つ以上ある', stg.BUY.every(s => s.t.length >= 2));

//  描画が表を選んで使っていること（直に MA_STAGES を引いていない）
{
  const partner = /var STG=maStages\(d\);\s*\n\s*var st=STG\[d\.stage\]\|\|STG\[0\];\s*\n\s*var done=d\.done_tasks/.test(SRC);
  const customer = /var STG=maStages\(d\);\s*\n\s*var st=STG\[d\.stage\]\|\|STG\[0\];\s*\n\s*var prog=/.test(SRC);
  ok('パートナー側の描画が案件の種類で表を選ぶ', partner);
  ok('経営者側の描画が案件の種類で表を選ぶ', customer);
  no('描画に MA_STAGES[d.stage] の直引きが残っていない', /MA_STAGES\[d\.stage\]/.test(SRC));
}
//  新しい案件の既定は買い手
ok('案件の種類の選択肢は譲受が先', /<option>譲受<\/option><option>譲渡<\/option>/.test(SRC));
ok('作るときの既定も譲受', /deal_type:\(\$\('ma-type'\)\|\|\{\}\)\.value\|\|'譲受'/.test(SRC));

// ---------------------------------------------------------------
// ⑤ レベル
// ---------------------------------------------------------------
//  判定の式は loadPartnerGrowth の中にある。そこだけ切り出して動かす。
//  写しを書くと、本体を直したときに試験だけ古いままになる
const judgeSrc = (() => {
  const a = SRC.indexOf('PG_LEVELS.forEach(function(L){\n      var byClients');
  if (a < 0) throw new Error('レベル判定が見つかりません');
  const b = SRC.indexOf('});', a);
  return SRC.slice(a, b + 3);
})();
function levelFor(cl, hd) {
  return new Function(
    takeArr('PG_LEVELS') +
    'var cl=' + cl + ', hd=' + hd + ', lv=1;' + judgeSrc + 'return lv;'
  )();
}
const LV = new Function(takeArr('PG_LEVELS') + 'return PG_LEVELS;')();

is('顧問0・成約0 → Lv1', levelFor(0, 0), 1);
is('顧問1 → Lv2', levelFor(1, 0), 2);
is('顧問4 → まだ Lv2', levelFor(4, 0), 2);
is('顧問5 → Lv2（改定：Lv3 は10件から）', levelFor(5, 0), 2);
is('顧問10 → Lv3（改定）', levelFor(10, 0), 3);
is('顧問19 → Lv3 のまま', levelFor(19, 0), 3);
is('顧問20 → Lv4（改定：Lv4 は20件から）', levelFor(20, 0), 4);
is('顧問1・成約1 → Lv3（成約の道）', levelFor(1, 1), 3);
is('顧問1・成約3 → Lv4（成約の道）', levelFor(1, 3), 4);
is('顧問1・成約2 → Lv3 のまま（3件に届かない）', levelFor(1, 2), 3);
is('顧問0・成約1 → Lv3（顧問0でも成約が効く。ただし Lv2 は飛ぶ）', levelFor(0, 1), 3);
is('顧問5・成約1 → Lv3（重ねても4には届かない）', levelFor(5, 1), 3);
ok('Lv3 に成約の道がある', LV[2].alt && LV[2].alt.hd === 1);
ok('Lv4 に成約の道がある', LV[3].alt && LV[3].alt.hd === 3);
no('Lv2 には成約の道が無い（最初の顧問契約が先）', !!LV[1].alt);
ok('Lv3 の条件文に「成約」が書いてある', /成約/.test(LV[2].cond));
ok('Lv4 の条件文に「成約」が書いてある', /成約/.test(LV[3].cond));
//  数え方：譲受だけ、クロージング以降だけ
ok('成約は deal_type を見て数える', /select\('customer_id,stage,deal_type'\)\.in\('customer_id',ids\)/.test(SRC));
ok('成約は譲受だけを数える', /\(d\.stage\|\|0\)>=7 && d\.deal_type==='譲受'\) hd\+\+/.test(SRC));
//  見せ方
ok('次のレベルの札に「または」の道が出る', /bar\('顧問先の成約（譲受）', hd, L\.alt\.hd\)/.test(SRC));
ok('あと何件、に成約の道も並ぶ', /または 顧問先の成約 あと'\+needHd\+'件/.test(SRC));
ok('現在の数に成約も出る', /顧問契約 '\+cl\+'件・顧問先の成約 '\+hd\+'件/.test(SRC));
//  外注費率は触っていない（運営が手で入れる fde_rank から引く）
ok('料率は fde_rank から引いたまま', /function rankFeeRate\(rankName/.test(SRC));
is('料率の値はこれまでどおり', LV.map(L => L.fee), ['—', '50%', '60%', '70%']);

// ---------------------------------------------------------------
// ⑧ 停滞
// ---------------------------------------------------------------
//  buildTodos の停滞の節だけを切り出して動かす
const stallSrc = (() => {
  const a = SRC.indexOf('      if(d.stage<8 && d.updated_at){\n        var silent=');
  if (a < 0) throw new Error('停滞の節が見つかりません');
  //  対応する閉じ括弧まで：この節は 2段のネスト
  const b = SRC.indexOf('\n      }\n', a);
  return SRC.slice(a, b + 8);
})();
function stallTags(d, daysAgo) {
  const tags = [];
  const now = new Date('2026-09-10T00:00:00Z');
  const upd = new Date(now.getTime() - daysAgo * 86400000).toISOString();
  new Function(
    'd', 'now', 'add', 'maStages', 'esc',
    stallSrc
  )(Object.assign({ updated_at: upd }, d), now,
    (cid, score, html) => tags.push({ score, html }),
    stg.of, s => String(s));
  return tags;
}
is('29日は出ない', stallTags({ stage: 0, deal_type: '譲受' }, 29).length, 0);
{
  const t = stallTags({ stage: 0, deal_type: '譲受' }, 30);
  is('検討・準備（stage 0）で30日止まると出る', t.length, 1);
  ok('段階の名前が添えられる', /検討・準備/.test(t[0].html));
  ok('30日は灰色', /tag gray/.test(t[0].html));
  is('30日の重さ', t[0].score, 45);
}
{
  const t = stallTags({ stage: 3, deal_type: '譲受' }, 60);
  ok('60日で金色に上がる', /tag gold/.test(t[0].html));
  is('60日の重さ', t[0].score, 58);
  ok('面談・交渉、と段階が出る', /面談・交渉/.test(t[0].html));
}
{
  const t = stallTags({ stage: 2, deal_type: '譲渡' }, 45);
  ok('売り手の案件にも出る（段階名は共通）', /相手探し・打診/.test(t[0].html));
}
is('完了（stage 8）は出ない', stallTags({ stage: 8, deal_type: '譲受' }, 90).length, 0);
is('updated_at が無ければ出ない', (() => {
  const tags = [];
  new Function('d', 'now', 'add', 'maStages', 'esc', stallSrc)(
    { stage: 1, deal_type: '譲受' }, new Date(), (c, s, h) => tags.push(h), stg.of, s => s);
  return tags.length;
})(), 0);

// ---------------------------------------------------------------
// 版
// ---------------------------------------------------------------
{
  const b = /var APP_BUILD='([^']+)';/.exec(SRC);
  const v = JSON.parse(fs.readFileSync(__dirname + '/../version.json', 'utf8'));
  ok('APP_BUILD と version.json が同じ', b && b[1] === v.build);
}

console.log('試験 ' + n + '件');
if (bad.length) {
  console.log('\n合わないもの ' + bad.length + '件:');
  bad.forEach(b => console.log('  ✗ ' + b.name + '\n      出た: ' + b.got + '\n      欲しい: ' + b.want));
  process.exit(1);
}
console.log('ぜんぶ通りました。');
