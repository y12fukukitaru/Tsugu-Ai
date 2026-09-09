// =============================================================
// 企業価値：3系統の計算の試験
//
//  ここが間違っていると、社長に嘘の値段を見せることになります。
//  面談でその場で使われる数字なので、いちばん硬く確かめます。
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

//  index.html から取り出す（最後に定義されたものが実際に動く）
function takeFn(name) {
  const re = new RegExp('\\n  function ' + name + '\\s*\\(', 'g');
  let m, last = null;
  while ((m = re.exec(SRC)) !== null) last = m;
  if (!last) throw new Error('見つかりません: ' + name);
  const end = SRC.indexOf('\n  }\n', last.index);
  if (end < 0) throw new Error('終わりが見つかりません: ' + name);
  return SRC.slice(last.index, end + 4);
}
function takeVar(name) {
  const re = new RegExp('\\n  var ' + name + '\\s*=');
  const m = re.exec(SRC);
  if (!m) throw new Error('見つかりません: var ' + name);
  const i = m.index;
  //  その行で閉じていれば1行もの。閉じていなければ、行頭2スペースの
  //  「];」か「};」まで読む
  const lineEnd = SRC.indexOf('\n', i + 1);
  if (/;\s*$/.test(SRC.slice(i + 1, lineEnd))) return SRC.slice(i, lineEnd + 1);
  let end = -1;
  for (const close of ['\n  ];', '\n  };']) {
    const e = SRC.indexOf(close, i);
    if (e >= 0 && (end < 0 || e < end)) end = e + close.length;
  }
  if (end < 0) throw new Error('終わりが見つかりません: var ' + name);
  return SRC.slice(i, end + 1);
}

const mod = new Function(
  takeVar('VF_TAX') + takeVar('VF_DEF') +
  takeFn('vfNum') + takeFn('vfMan') + takeFn('vfClone') +
  takeFn('vfEbitda') + takeFn('vfRealOp') + takeFn('vfNetAsset') +
  takeFn('vfNenbai') + takeFn('vfMultiple') + takeFn('vfIncome') +
  takeFn('vfCloseVal') + takeFn('vfAll') + takeFn('vfGap') +
  takeVar('VF_ACTIONS') + takeFn('vfAction') + takeFn('vfApply') +
  takeVar('VF_STAGES') + takeFn('vfTimeline') +
  takeVar('VF_KINDS') + takeFn('vfKindName') + takeFn('vfKindFocus') +
  'return { VF_TAX, VF_DEF, vfNum, vfMan, vfEbitda, vfRealOp, vfNetAsset, vfNenbai,' +
  ' vfMultiple, vfIncome, vfCloseVal, vfAll, vfGap, VF_ACTIONS, vfAction, vfApply,' +
  ' vfTimeline, VF_KINDS, vfKindName, vfKindFocus };'
)();

//  面談で使いそうな、ふつうの会社（単位：万円）
function co(over) {
  const d = {
    op: 1500, dep: 300, realOp: 1800,
    bsNet: 5000, cash: 3000, debt: 6000,
    adjEstate: 4000, adjIns: 800, adjSec: 0, adjRetire: 1200, adjOther: 0,
    mult: 5, years: 3, capRate: 20, closeCost: 2000
  };
  for (const k in (over || {})) d[k] = over[k];
  return d;
}

// =============================================================
// ① それぞれの手法が、式のとおりに出ること
// =============================================================
const d = co();
is('EBITDA＝営業利益＋減価償却', mod.vfEbitda(d), 1800);
//  5000 + 4000 + 800 + 0 − 1200 + 0
is('時価純資産＝簿価＋含み損益−未計上債務', mod.vfNetAsset(d), 8600);
//  8600 + 1800×3
is('年買法＝時価純資産＋実質利益×年数', mod.vfNenbai(d), 14000);
//  1800×5 + 3000 − 6000
is('マルチプル＝EBITDA×倍率−純有利子負債', mod.vfMultiple(d), 6000);
//  1800×(1−0.34)=1188 → 1188/0.20=5940 → +3000−6000
is('収益還元＝税引後の実質利益÷還元率−純有利子負債', mod.vfIncome(d), 2940);
//  8600 − 2000
is('清算価値＝時価純資産−清算コスト', mod.vfCloseVal(d), 6600);

// =============================================================
// ② 実質営業利益の扱い
// =============================================================
//  役員報酬の取り方だけで会社の値段が変わってしまうのを防ぐ数字なので、
//  入っていればそちらを使う
is('実質営業利益が入っていればそれを使う', mod.vfRealOp(co({ realOp: 2500 })), 2500);
is('空なら営業利益で代用する', mod.vfRealOp(co({ realOp: '' })), 1500);
is('null でも営業利益で代用する', mod.vfRealOp(co({ realOp: null })), 1500);
is('代用した年買法', mod.vfNenbai(co({ realOp: '' })), 8600 + 1500 * 3);

// =============================================================
// ③ 赤字の会社で、おかしな値段にならないこと
// =============================================================
//  年数ぶんを引くと、時価純資産まで割り込む。稼ぐ力がマイナスなら
//  上乗せは0として扱う
is('赤字でも年買法は時価純資産を割り込まない',
  mod.vfNenbai(co({ op: -500, realOp: -500 })), 8600);
is('赤字でも収益還元はマイナスの利益を足さない',
  mod.vfIncome(co({ op: -500, realOp: -500 })), 3000 - 6000);
//  債務超過はそのまま出す。ここを0で隠すと、危ない会社が危なく見えない
is('債務超過は隠さずマイナスで出す',
  mod.vfNetAsset(co({ bsNet: -3000, adjEstate: 0, adjIns: 0, adjRetire: 0 })), -3000);

// =============================================================
// ④ 空欄・でたらめな値で落ちないこと
// =============================================================
is('空の入力でも0を返す', mod.vfNetAsset({}), 0);
is('文字が入っていても0として扱う', mod.vfNum('あ'), 0);
is('全部空でも落ちない', mod.vfEbitda({ op: '', dep: '' }), 0);
is('倍率が0なら既定の5倍', mod.vfMultiple(co({ mult: 0 })), 1800 * 5 + 3000 - 6000);
is('年数が0なら既定の3年', mod.vfNenbai(co({ years: 0 })), 14000);
//  0は「未入力」とみなして既定の20%に落とす（倍率・年数と同じ扱い）
is('還元率が0なら既定の20%に落とす', mod.vfIncome(co({ capRate: 0 })), 2940);
is('還元率がマイナスでも計算しない', mod.vfIncome(co({ capRate: -5 })), null);

// =============================================================
// ⑤ 簿価と実勢のひらき（相続税の話を始めるための算数）
// =============================================================
const g = mod.vfGap(d);
is('含み損益の合計', g.hidden, 3600);
is('簿価', g.bs, 5000);
is('実勢（年買法）', g.market, 14000);
is('実勢は簿価の何倍か', Math.round(g.ratio * 10) / 10, 2.8);
//  簿価が0か債務超過だと倍率は出せない。ここで割り算すると壊れる
is('簿価0なら倍率は出さない', mod.vfGap(co({ bsNet: 0 })).ratio, null);
is('債務超過なら倍率は出さない', mod.vfGap(co({ bsNet: -100 })).ratio, null);

// =============================================================
// ⑥ 打ち手を当てたときの動き
// =============================================================
//  ★いちばん教えたいところ：手元資金で借入を返しても、株主価値は変わらない
const repay = mod.vfApply(d, [{ id: 'repay', amount: 1000 }]);
is('借入返済でマルチプルは変わらない', mod.vfMultiple(repay), mod.vfMultiple(d));
is('借入返済で収益還元も変わらない', mod.vfIncome(repay), mod.vfIncome(d));
is('借入返済で現金は減る', repay.cash, 2000);
is('借入返済で借入も減る', repay.debt, 5000);

//  利益はすべての手法に効く
const prof = mod.vfApply(d, [{ id: 'profit', amount: 300 }]);
is('利益が増えるとEBITDAも増える', mod.vfEbitda(prof), 2100);
is('利益が増えると年買法が上がる', mod.vfNenbai(prof), 8600 + 2100 * 3);
ok('利益が増えるとマルチプルも上がる', mod.vfMultiple(prof) > mod.vfMultiple(d));
ok('利益が増えると収益還元も上がる', mod.vfIncome(prof) > mod.vfIncome(d));

//  簿外債務の解消は、いったん値段を下げる（それでもやる価値がある）
const clean = mod.vfApply(d, [{ id: 'cleanup', amount: 500 }]);
ok('簿外債務を認識すると時価純資産は下がる', mod.vfNetAsset(clean) < mod.vfNetAsset(d));
is('下がる額は認識した額そのもの', mod.vfNetAsset(d) - mod.vfNetAsset(clean), 500);

//  遊休資産の売却：時価純資産は変わらず、含み益が現金に変わる。
//  ★ここが「借入返済は効かない」との対比になる
const idle = mod.vfApply(d, [{ id: 'idle', amount: 2000 }]);
is('遊休資産を売っても時価純資産は変わらない', mod.vfNetAsset(idle), mod.vfNetAsset(d));
is('含み益のぶん現金が増える', idle.cash, 5000);
is('含み益が実現して簿価純資産に乗る', idle.bsNet, 7000);
is('含み益はもう未実現ではない', idle.adjEstate, 2000);
is('マルチプルは現金のぶん上がる', mod.vfMultiple(idle), mod.vfMultiple(d) + 2000);
is('収益還元も現金のぶん上がる', mod.vfIncome(idle), mod.vfIncome(d) + 2000);
//  借入返済とは効き方が逆。ここを並べて見せるのが、この画面の値打ち
ok('借入返済は効かないが、遊休資産の売却は効く',
  mod.vfMultiple(repay) === mod.vfMultiple(d) && mod.vfMultiple(idle) > mod.vfMultiple(d));

//  倍率の打ち手は金額を取らない
const mult = mod.vfApply(d, [{ id: 'mult' }]);
is('属人性を減らすと倍率が0.5上がる', mult.mult, 5.5);
is('倍率が上がるとマルチプルも上がる', mod.vfMultiple(mult), 1800 * 5.5 + 3000 - 6000);

//  下げる側
const ret = mod.vfApply(d, [{ id: 'retire', amount: 3000 }]);
is('役員退職金で簿価純資産が減る', ret.bsNet, 2000);
is('役員退職金で現金も減る', ret.cash, 0);
ok('役員退職金で時価純資産が下がる', mod.vfNetAsset(ret) < mod.vfNetAsset(d));

//  事業承継税制は数字を動かさない（話題として置くだけ）
const sho = mod.vfApply(d, [{ id: 'shokei' }]);
is('事業承継税制の検討では数字が動かない', mod.vfAll(sho), mod.vfAll(d));

//  知らない打ち手は黙って無視する（画面が古いまま呼ばれても壊さない）
is('知らない打ち手は無視する', mod.vfAll(mod.vfApply(d, [{ id: 'zzz', amount: 999 }])), mod.vfAll(d));
is('打ち手が空でも落ちない', mod.vfAll(mod.vfApply(d, [])), mod.vfAll(d));
is('打ち手が未指定でも落ちない', mod.vfAll(mod.vfApply(d, null)), mod.vfAll(d));

// =============================================================
// ⑦ 元の入力を書き換えないこと
// =============================================================
//  ここが壊れていると、画面に出した数字と保存する数字がずれます
const before = JSON.stringify(d);
mod.vfApply(d, [{ id: 'profit', amount: 500 }, { id: 'retire', amount: 1000 }]);
is('打ち手を当てても元の入力は変わらない', JSON.stringify(d), before);

// =============================================================
// ⑧ マイルストーン（いつ何をすると、どこに着くか）
// =============================================================
const tl = mod.vfTimeline(d, [
  { id: 'cost', amount: 200, when: '3m' },
  { id: 'profit', amount: 300, when: '1y' },
  { id: 'mult', when: '3y' }
]);
is('三段になる', tl.length, 3);
is('段の名前', tl.map(x => x.label), ['3ヶ月', '1年', '3年']);
//  積み上がること。3ヶ月の打ち手は1年時点でも効いている
is('3ヶ月：固定費200を削った', mod.vfEbitda(tl[0].d), 2000);
is('1年：さらに利益300（積み上がる）', mod.vfEbitda(tl[1].d), 2300);
is('3年：倍率が上がる', tl[2].d.mult, 5.5);
ok('段を追うごとに年買法が上がる',
  tl[0].v.nenbai < tl[1].v.nenbai && tl[1].v.nenbai <= tl[2].v.nenbai);
is('各段が「そこまでに打った手」を持つ', tl.map(x => x.all.length), [1, 2, 3]);
is('打ち手が無くても三段は出る', mod.vfTimeline(d, []).length, 3);
is('打ち手が無ければ数字は動かない', mod.vfTimeline(d, [])[2].v, mod.vfAll(d));

// =============================================================
// ⑨ 承継の型で、見るべきものが変わること
// =============================================================
is('親族内は時価純資産を主に見る', mod.vfKindFocus('family').main, 'netAsset');
is('従業員は年買法', mod.vfKindFocus('employee').main, 'nenbai');
is('第三者は年買法', mod.vfKindFocus('ma').main, 'nenbai');
is('廃業は清算価値', mod.vfKindFocus('close').main, 'close');
is('未定でも何か返す', mod.vfKindFocus('undecided').main, 'nenbai');
is('知らない型でも落ちない', mod.vfKindFocus('zzz').main, 'nenbai');
is('型の名前', mod.vfKindName('ma'), '第三者へ（M&A）');
is('知らない型の名前', mod.vfKindName('zzz'), 'まだ決めていない');
VF_KIND_ALL();
function VF_KIND_ALL() {
  mod.VF_KINDS.forEach(function (k) {
    const f = mod.vfKindFocus(k[0]);
    ok('「' + k[1] + '」に注意点がある', f.notes && f.notes.length >= 2);
    ok('「' + k[1] + '」に見出しがある', !!f.lead);
  });
}

// =============================================================
// ⑩ 法に触れないための、決めごと
// =============================================================
//  ★相続税評価額の「金額」は、どの型でも出さない。
//    具体的に算定して示すのは税理士法52条の税務相談にあたるおそれがある
ok('親族内の注意に「別の計算方法」と書いてある',
  /財産評価基本通達/.test(mod.vfKindFocus('family').notes.join('')));
ok('親族内の注意に「税理士でなければ算定できない」と書いてある',
  /金額は税理士でなければ算定できません/.test(mod.vfKindFocus('family').notes.join('')));
//  保険は、募集人としての立場との利益相反があるので、必ず警告を出す
const ins = mod.vfAction('insurance');
ok('保険の打ち手に警告がついている', !!ins.warn);
ok('保険の警告が募集人の立場に触れている', /募集人としてのお立場/.test(ins.warn));
//  退職金の適正額は税務の論点
ok('退職金の説明が税理士へ回している', /顧問税理士にご確認ください/.test(mod.vfAction('retire').why));
//  事業承継税制も税理士の領分
ok('事業承継税制の説明が税理士の領分と言っている',
  /税理士の領分/.test(mod.vfAction('shokei').why));
//  すべての打ち手に、なぜそうなるかの説明があること（黙って数字を動かさない）
mod.VF_ACTIONS.forEach(function (a) {
  ok('「' + a.label + '」に理由がある', !!a.why && a.why.length > 10);
  ok('「' + a.label + '」の向きが決まっている', a.dir === 'up' || a.dir === 'down');
});

// =============================================================
console.log(n + ' 件中 ' + (n - bad.length) + ' 件 合格、' + bad.length + ' 件 不合格');
bad.forEach(b => console.log('  × ' + b.name + '\n      実際: ' + b.got + '\n    あるべき: ' + b.want));
process.exit(bad.length ? 1 : 0);
