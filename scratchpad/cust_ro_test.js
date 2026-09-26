// =============================================================
// 経営者の画面は「確かめる画面」の試験（2026-09-26 運営の方針）
//   「パートナーと顧客がコミュニケーションを取りながら伴走し、目標に向かう道筋を描く」。
//   ① 出口・株の持ち方・スケール・買った後・買いたい条件は、経営者の画面では選ぶ・書く・保存を止める
//   ② 継ナビくんに聞く・分類の切替・想像する、は残す（学ぶのは止めない）
//   ③ 目標（旗）：経営者が金額を出す・取り下げる・打ち手を足す、をやめて「担当パートナーに伝える」
//   ④ カルテのメニューに出口・スケール・買った後の入口を置く／目標の「社長の言葉」をパートナーが書ける
//   ⑤ 一緒に見る人も会社の内容を見られる（SCOPE で読む）
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
let n = 0, bad = [];
function is(name, got, want) { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) bad.push({ name, got: g, want: w }); }
function ok(name, cond) { is(name, !!cond, true); }
function no(name, cond) { is(name, !!cond, false); }
function takeFn(name) {
  const re = new RegExp('\\n  (?:async )?function ' + name + '\\s*\\(', 'g');
  let m, last = null, cnt = 0;
  while ((m = re.exec(SRC)) !== null) { last = m; cnt++; }
  if (!last) throw new Error('見つかりません: ' + name);
  is('定義は一つだけ: ' + name, cnt, 1);
  return SRC.slice(last.index, SRC.indexOf('\n  }\n', last.index) + 4);
}
function takeLine(name) { const i = SRC.indexOf('\n  var ' + name + '='); return SRC.slice(i + 1, SRC.indexOf('\n', i + 1)); }
// ① 止める関数と、止めない関数
const RO = new Function(takeLine('CUST_RO_FN') + takeLine('CUST_RO_HIDE') + 'return [CUST_RO_FN, CUST_RO_HIDE];')();
['exitPick(\'x\')', 'exitSave()', 'exitTarget(\'a\',this.value)', 'structPick(\'a\',\'b\')', 'structNote(\'a\',this.value)', 'structSave()',
 'scaleMain(\'a\')', 'scalePick(\'a\',\'b\')', 'scaleNote(\'a\',this.value)', 'scaleTarget(\'a\',this.value)', 'scaleSave()',
 'afterPick(\'scheme\',this.value)', 'afterStatus(\'a\',\'b\')', 'afterNote(\'a\',this.value)', 'afterSave()', "saveBuyCriteria('u','bc')"]
  .forEach(h => ok('止める: ' + h, RO[0].test(h)));
['exitAsk()', 'structAsk(\'a\')', 'scaleAsk()', 'afterAsk(\'a\')', 'afterCat(\'all\')', 'afterScenario()', "goSec('sec-billpay')", 'knvOpenAsk()', "custTell('x')", "planRequest('u','buyer')"]
  .forEach(h => no('止めない: ' + h, RO[0].test(h)));
['exitSave()', 'structSave()', 'scaleSave()', 'afterSave()', "saveBuyCriteria('u','bc')"].forEach(h => ok('保存のボタンは消す: ' + h, RO[1].test(h)));
no('選択肢は消さない（押せないだけ）', RO[1].test("exitPick('x')"));
const cr = takeFn('custReadOnly');
ok('入力欄は止める', /el\.disabled=true/.test(cr));
ok('選ばれているものは残して、ほかは薄く', /classList\.add\('on'\)/.test(cr) && /\.cust-ro-pick:not\(\.on\)/.test(SRC));
ok('案内と「担当パートナーに伝える」', /担当パートナーと一緒に決める内容です。/.test(takeFn('custRoNote')) && /custTell\(/.test(takeFn('custRoNote')));
ok('伝える：メッセージを開いて話題を添える', /knvShowTab\('msg'\)/.test(takeFn('custTell')) && /'【'\+topic\+'について】/.test(takeFn('custTell')));
// 描いたあとで止める（最初と描き直しの両方）
[['出口の設計', 2], ['株の持ち方・組織の検討', 2], ['スケールの設計', 2], ['買った後に備える', 2], ['買いたい条件', 1]].forEach(([t, c]) =>
  is('経営者の画面で止める: ' + t, (SRC.match(new RegExp("custReadOnly\\(box,'" + t + "'\\)", 'g')) || []).length, c));
ok('買いたい条件はカルテ（cbc）では止めない', /if\(pfx==='bc'\) custReadOnly\(box,'買いたい条件'\);/.test(SRC));
// ③ 目標（旗）
const vm = takeFn('vgMyHtml');
no('経営者は目標を出さない', /vgWishOpen\(\)/.test(vm));
no('経営者は取り下げ・旗を下ろすをしない', /vgWithdraw\(\)/.test(vm));
ok('打ち手は確かめるだけ', /vgActionsHtml\(acts, p, false, 'vg'\)/.test(vm));
ok('思うことは担当パートナーに伝える', (vm.match(/custTell\(\\'目標（いつまでに・いくらに）\\'\)/g) || []).length === 3);
// ④ カルテ
const items = SRC.slice(SRC.indexOf('var CL_ITEMS=['), SRC.indexOf('];', SRC.indexOf('var CL_ITEMS=[')));
['cs-exit', 'cs-scale', 'cs-after'].forEach(id => {
  ok('カルテのメニューに ' + id, new RegExp("\\['" + id + "','[a-zA-Z]+','[^']+','企業価値・承継'\\]").test(items));
  ok('カルテのタブに ' + id, new RegExp("var CL_SPY_IDS=\\[[^\\]]*'" + id + "'").test(SRC));
  ok('見出しがある ' + id, new RegExp('id="' + id + '"').test(SRC));
});
const order = ['cs-value', 'cs-exit', 'cs-scale', 'cs-after', 'cs-mna'].map(id => items.indexOf("['" + id + "'"));
ok('メニューの並び：企業価値→出口→スケール→買った後→M&A', order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])));
ok('社長の言葉をパートナーが書ける', /id="vgp-wish"/.test(takeFn('vgPartnerOpen')));
const ps = takeFn('vgPartnerSave');
ok('社長の言葉を保存する（直す・新しく）', /up\.wish_note=wishNote\|\|null/.test(ps) && /wish_note:wishNote\|\|null, status:'agreed'/.test(ps));
// ⑤ SCOPE
ok('一緒に見る人も会社の内容を見る', /loadBuyCriteria\(SCOPE,'bc'\)/.test(SRC) && /loadExitPlan\(SCOPE,'customer'\); loadScalePlan\(SCOPE,'customer'\); loadAfterPrep\(SCOPE,'customer'\);/.test(SRC));
no('ME で読んでいない', /load(ExitPlan|ScalePlan|AfterPrep)\(ME,'customer'\)|loadBuyCriteria\(ME,'bc'\)/.test(SRC));
// 継ナビくんの知識
ok('継ナビくん：確かめるだけ・担当パートナーに伝える', /ご本人の画面は確かめるだけで、思うことは「💬 担当パートナーに伝える」/.test(SRC));
no('継ナビくん：買いたい条件をご本人が書ける、は消えた', /「買いたい条件」\(業種・地域・規模・予算・目的\)をご本人が書ける/.test(SRC));

if (bad.length) { bad.forEach(b => console.log('NG', b.name, '\n   got ', b.got, '\n   want', b.want)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK ' + n + ' checks, 0 failed');
