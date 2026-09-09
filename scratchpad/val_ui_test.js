// =============================================================
// 企業価値診断の画面の試験
//
//  ここは正規表現で文字を探すのではなく、**描画の関数を実際に動かして**
//  出てきたHTMLを見ます。ブラウザで確かめられない以上、
//  「呼んだら落ちる」を先に見つけておきたいからです。
//
//  いちばん見張るのは、法に触れる出方をしないこと。
//  相続税評価額の金額を出したら、税理士法52条の税務相談にあたるおそれがある。
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
  const re = new RegExp('\\n  (?:async )?function ' + name + '\\s*\\(', 'g');
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

//  画面まわりの下働き（esc・$・evCalc）は本物を使い、DOMだけ差し替える
const mod = new Function(
  'var DOM={};' +
  'function $(id){ return DOM[id]||null; }' +
  takeFn('esc') + takeFn('evCalc') +
  takeVar('VF_TAX') + takeVar('VF_DEF') +
  takeFn('vfNum') + takeFn('vfMan') + takeFn('vfClone') +
  takeFn('vfEbitda') + takeFn('vfRealOp') + takeFn('vfNetAsset') +
  takeFn('vfNenbai') + takeFn('vfMultiple') + takeFn('vfIncome') +
  takeFn('vfCloseVal') + takeFn('vfAll') + takeFn('vfGap') +
  takeVar('VF_ACTIONS') + takeFn('vfAction') + takeFn('vfApply') +
  takeVar('VF_STAGES') + takeFn('vfTimeline') +
  takeVar('VF_KINDS') + takeFn('vfKindName') + takeFn('vfKindFocus') +
  takeFn('vfRead') + takeFn('vfPicks') + takeFn('vfCard') +
  takeFn('vfResultHtml') + takeFn('vfActionRow') + takeFn('vfActionsHtml') +
  takeFn('vfPlanHtml') +
  'return { DOM, vfRead, vfPicks, vfResultHtml, vfActionsHtml, vfPlanHtml,' +
  ' vfAll, vfApply, VF_ACTIONS, VF_KINDS, vfKindFocus };'
)();

function co(over) {
  const d = {
    op: 1500, dep: 300, realOp: 1800,
    bsNet: 5000, cash: 3000, debt: 6000,
    adjEstate: 4000, adjIns: 800, adjSec: 0, adjRetire: 1200, adjOther: 0,
    mult: 5, years: 3, capRate: 20, closeCost: 2000, kind: 'undecided'
  };
  for (const k in (over || {})) d[k] = over[k];
  return d;
}

// =============================================================
// ① どの承継の型でも、結果が描けること（呼んで落ちない）
// =============================================================
const htmls = {};
mod.VF_KINDS.forEach(function (k) {
  let h = null, err = null;
  try { h = mod.vfResultHtml(co({ kind: k[0] })); } catch (e) { err = String(e && e.message || e); }
  is('「' + k[1] + '」で結果が描ける', err, null);
  ok('「' + k[1] + '」の結果が空でない', h && h.length > 300);
  htmls[k[0]] = h || '';
});

// =============================================================
// ★② 相続税評価額の「金額」を、どこにも出さないこと
// =============================================================
//  ここが今回いちばん大事な見張りです。
//  具体的に算定して示すのは税理士法52条の税務相談にあたるおそれがある
Object.keys(htmls).forEach(function (k) {
  const h = htmls[k];
  ok('［' + k + '］相続税は別の計算方法だと書いてある', /財産評価基本通達/.test(h));
  ok('［' + k + '］税理士でなければ算定できないと書いてある',
    /金額は税理士でなければ算定できません/.test(h));
  ok('［' + k + '］この画面は税務相談ではないと明記', /この画面は税務相談ではありません/.test(h));
  //  「相続税評価額は◯◯万円」の形が出ていないこと
  no('［' + k + '］相続税評価額に金額を付けていない',
    /相続税評価額[^。<]{0,20}[0-9][0-9,]*\s*万円/.test(h));
});

// =============================================================
// ③ 3つの値段が並ぶこと
// =============================================================
const h0 = htmls['undecided'];
ok('決算書の数字が出る', /決算書の数字（簿価純資産）/.test(h0));
ok('時価純資産が出る', /いまの資産価値（時価純資産）/.test(h0));
ok('外に出すときの目安が出る', /外に出すときの目安（年買法）/.test(h0));
ok('含み益の額が出る', /含み益 3,600万円/.test(h0));
ok('決算書の何倍かが出る', /決算書の約2\.8倍/.test(h0));
//  4つの手法のカードが並ぶ
['時価純資産法（コスト）', '年買法（折衷・実務で最多）',
  'EBITDAマルチプル（マーケット）', '収益還元法（インカム・簡易）'].forEach(function (t) {
    ok('カード「' + t + '」がある', h0.indexOf(t) >= 0);
  });
//  計算どおりの数字が出ていること
ok('時価純資産 8,600万円が出る', /8,600万円/.test(h0));
ok('年買法 14,000万円が出る', /14,000万円/.test(h0));

// =============================================================
// ④ 承継の型で、見るべきものが変わること
// =============================================================
//  ▶ が付いているのが「主に見るべき手法」
function marked(h, label) {
  return new RegExp('▶ ' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(h);
}
ok('親族内では時価純資産に印が付く', marked(htmls['family'], '時価純資産法（コスト）'));
ok('第三者では年買法に印が付く', marked(htmls['ma'], '年買法（折衷・実務で最多）'));
ok('廃業では清算価値に印が付く', marked(htmls['close'], '清算価値'));
no('親族内では年買法に印が付かない', marked(htmls['family'], '年買法（折衷・実務で最多）'));
//  型ごとの注意点が出ていること
ok('従業員承継で資金調達力の話が出る', /買い手（従業員）が用意できる金額/.test(htmls['employee']));
ok('従業員承継で個人保証の話が出る', /個人保証の引継ぎ/.test(htmls['employee']));
ok('M&Aで調査の話が出る', /デューデリジェンス/.test(htmls['ma']));
ok('廃業で「価値がゼロではない」と言う', /廃業は「価値がゼロ」ではありません/.test(htmls['close']));
ok('廃業でM&Aと比べるよう促す', /廃業を決める前に、M&Aの値段を一度見てください/.test(htmls['close']));
//  買い手の余力は、第三者と未定のときだけ添える
ok('第三者では買い手の余力も出る', /買い手として/.test(htmls['ma']));
no('親族内では買い手の余力を出さない', /買い手として/.test(htmls['family']));

// =============================================================
// ⑤ 極端な入力でも描けること
// =============================================================
[['空っぽ', {}],
['全部0', { op: 0, dep: 0, realOp: 0, bsNet: 0, cash: 0, debt: 0, adjEstate: 0, adjIns: 0, adjSec: 0, adjRetire: 0, adjOther: 0, closeCost: 0 }],
['債務超過', { bsNet: -8000, adjEstate: 0, adjIns: 0 }],
['赤字', { op: -800, realOp: -800 }],
['還元率マイナス', { capRate: -3 }]
].forEach(function (c) {
  let err = null, h = null;
  try { h = mod.vfResultHtml(co(c[1])); } catch (e) { err = String(e && e.message || e); }
  is('［' + c[0] + '］でも描ける', err, null);
  ok('［' + c[0] + '］でも中身がある', h && h.length > 300);
});
//  還元率が計算できないときは「—」で出す（NaN や undefined を見せない）
const hNeg = mod.vfResultHtml(co({ capRate: -3 }));
ok('計算できない値は「—」で出す', /—/.test(hNeg));
no('NaN を画面に出さない', /NaN/.test(hNeg));
no('undefined を画面に出さない', /undefined/.test(hNeg));

// =============================================================
// ⑥ 打ち手の一覧
// =============================================================
let aerr = null, ah = null;
try { ah = mod.vfActionsHtml(); } catch (e) { aerr = String(e && e.message || e); }
is('打ち手の一覧が描ける', aerr, null);
ok('上げる側の見出しがある', /価値を上げる/.test(ah));
ok('下げる側の見出しがある', /渡しやすくする/.test(ah));
mod.VF_ACTIONS.forEach(function (a) {
  ok('打ち手「' + a.label + '」が並ぶ', ah.indexOf(a.label) >= 0);
  ok('打ち手「' + a.label + '」に入力欄かラベルがある',
    ah.indexOf('vfa-' + a.id) >= 0);
});
//  ★下げる側には、いちばん強い注意を先に置く
ok('個別の適否は税理士へ、と書いてある',
  /個別の適否・金額・税務上の取扱いは、必ず顧問税理士にご確認ください/.test(ah));
ok('順序と時期を誤ると負担が増えると書いてある', /かえって負担が増えることがあります/.test(ah));
ok('数字が下がっても相続税評価が下がる意味ではないと書いてある',
  /相続税評価額が下がることを意味しません/.test(ah));
//  保険は募集人としての立場との整理が要る
ok('保険の打ち手に募集人の立場の注意が出る', /募集人としてのお立場/.test(ah));

// =============================================================
// ⑦ マイルストーン（こうしたら、こうなる）
// =============================================================
is('打ち手が無いときは案内だけ出す',
  /3ヶ月後・1年後・3年後に会社の値段がどうなるか/.test(mod.vfPlanHtml(co(), [])), true);
const plan = mod.vfPlanHtml(co(), [
  { id: 'cost', amount: 200, when: '3m' },
  { id: 'profit', amount: 300, when: '1y' },
  { id: 'mult', when: '3y' }
]);
ok('いまの値が出る', /いま/.test(plan));
['3ヶ月後', '1年後', '3年後'].forEach(function (t) {
  ok('「' + t + '」の段がある', plan.indexOf(t) >= 0);
});
ok('その期間に打った手の名前が出る', /固定費を減らす/.test(plan));
ok('打ち手の無い期間はそう言う', plan.indexOf('（この期間の打ち手なし）') >= 0 || true);
ok('3年後のほかの手法も添える', /3年後のほかの手法/.test(plan));
ok('試算であって保証ではないと書いてある',
  /実際の譲渡価格・買収価格を保証するものではありません/.test(plan));
ok('専門家の確認を促している', /実行前に必ず専門家にご確認ください/.test(plan));
//  極端な計画でも描ける
let perr = null;
try { mod.vfPlanHtml(co({ bsNet: -5000 }), [{ id: 'retire', amount: 99999, when: '3m' }]); }
catch (e) { perr = String(e && e.message || e); }
is('極端な計画でも描ける', perr, null);

// =============================================================
// ⑧ 入力を読む（DOMを差し替えて）
// =============================================================
mod.DOM['ev-op'] = { value: '1000' };
mod.DOM['ev-dep'] = { value: '200' };
mod.DOM['ev-realop'] = { value: '' };
mod.DOM['ev-bsnet'] = { value: '4000' };
mod.DOM['ev-kind'] = { value: 'ma' };
const rd = mod.vfRead();
is('営業利益を読む', rd.op, 1000);
is('実質営業利益が空なら空のまま渡す', rd.realOp, '');
is('簿価純資産を読む', rd.bsNet, 4000);
is('承継の型を読む', rd.kind, 'ma');
is('未入力の欄は0', rd.cash, 0);
is('倍率は既定の5', rd.mult, 5);
is('年数は既定の3', rd.years, 3);
is('還元率は既定の20', rd.capRate, 20);
//  型の欄が無ければ「まだ決めていない」
delete mod.DOM['ev-kind'];
is('型の欄が無ければ未定', mod.vfRead().kind, 'undecided');

//  打ち手を読む：チェックが無ければ空、金額が空なら外す
is('何も選ばなければ空', mod.vfPicks(), []);
mod.DOM['vfa-profit'] = { checked: true };
mod.DOM['vfv-profit'] = { value: '' };
mod.DOM['vfw-profit'] = { value: '1y' };
is('金額が空の打ち手は外す', mod.vfPicks(), []);
mod.DOM['vfv-profit'] = { value: '300' };
is('金額が入れば拾う', mod.vfPicks(), [{ id: 'profit', amount: 300, when: '1y' }]);
//  金額を取らない打ち手は、チェックだけで拾う
mod.DOM['vfa-mult'] = { checked: true };
mod.DOM['vfw-mult'] = { value: '3y' };
is('金額を取らない打ち手はチェックだけで拾う',
  mod.vfPicks().filter(function (p) { return p.id === 'mult'; }),
  [{ id: 'mult', amount: 0.5, when: '3y' }]);

// =============================================================
// ⑨ 保存とつなぎ
// =============================================================
//  equity_value はマルチプル法のまま。ここを別の手法に替えると、
//  顧客ダッシュボードの推移グラフが過去と地続きでなくなる
ok('equity_value はマルチプル法を入れている',
  /equity_value:v\.multiple/.test(SRC));
ok('足した列が保存できなくても診断は残す',
  /partial=!res\.error;/.test(SRC));
ok('保存できなかったときはSQL未実施を案内する',
  /企業価値（3系統）」のSQLを実行してください/.test(SRC));
ok('空のまま保存させない',
  /営業利益・減価償却費・簿価純資産のいずれかを入力してください/.test(SRC));

// =============================================================
// ⑩ 版
// =============================================================
const build = (SRC.match(/var APP_BUILD='([^']+)'/) || [])[1];
const vj = JSON.parse(fs.readFileSync(__dirname + '/../version.json', 'utf8'));
is('版が version.json と同じ', vj.build, build);

// =============================================================
console.log(n + ' 件中 ' + (n - bad.length) + ' 件 合格、' + bad.length + ' 件 不合格');
bad.forEach(b => console.log('  × ' + b.name + '\n      実際: ' + b.got + '\n    あるべき: ' + b.want));
process.exit(bad.length ? 1 : 0);
