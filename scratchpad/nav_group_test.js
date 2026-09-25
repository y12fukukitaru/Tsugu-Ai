// =============================================================
// メニューの組（カテゴリー）
//   運営・パートナー・経営者の左メニュー（PC・スマホ）と設定の並び替えに
//   見出しを出し、カルテの組には「何があるか」を一行添える。
//   ・出ている項目は、どれも一度だけ、決めた組に入る
//   ・先頭（ダッシュボード）は見出しなし
//   ・並び替えは組の中だけ
// =============================================================
const fs = require('fs'), vm = require('vm');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
let n = 0, bad = [];
function ok(name, cond, d) { n++; if (!cond) bad.push(name + (d !== undefined ? ' ' + JSON.stringify(d) : '')); }
function no(name, cond) { ok(name, !cond); }
function takeFn(name) {
  const re = new RegExp('\\n  (?:async )?function ' + name + '\\s*\\(');
  const m = re.exec(SRC); if (!m) throw new Error(name);
  return SRC.slice(m.index, SRC.indexOf('\n  }\n', m.index) + 4);
}
function takeVar(name) { const i = SRC.indexOf('\n  var ' + name + '='); if (i < 0) throw new Error(name); return SRC.slice(i, SRC.indexOf(';\n', i) + 2); }

function world(role, o) {
  o = o || {};
  const ctx = { PREF: o.pref || {}, window: { __prof: { plan: o.plan || 'buyer' } } };
  vm.createContext(ctx);
  vm.runInContext(
    'var ACCESS=' + JSON.stringify(o.access || '') + '; var EP_ME=' + (o.ep ? '{}' : 'null') + ';' +
    'function planOf(p){ return (p&&p.plan)||"buyer"; }' +
    'var ADMIN_ROLE="owner"; function isOwner(){ return true; } function adminCanSee(){ return true; }' +
    'function loadPrefs(){ return PREF; }' +
    takeFn('adminNavAll') + takeFn('navDefs') + takeVar('KNV_ABSORBED') + takeFn('knvAbsorbed') +
    takeVar('NAV_TUCKED') + takeFn('navTucked') + takeVar('NAV_GROUPS') + takeFn('navGrouped') + takeFn('navGroupOf') + takeFn('effectiveNav'),
    ctx);
  const items = vm.runInContext('effectiveNav(' + JSON.stringify(role) + ')', ctx);
  const groups = vm.runInContext('navGrouped(' + JSON.stringify(role) + ', effectiveNav(' + JSON.stringify(role) + '))', ctx);
  return { items, groups, ctx };
}
function flat(gs) { return gs.reduce((a, g) => a.concat(g.items.map((x) => x[0])), []); }

// ① 役割ごとの組
const CASES = [
  ['customer', { plan: 'buyer' }, ['', '毎月のこと', '会社の数字', '出口と成長']],
  ['customer', { plan: 'seller' }, ['', '毎月のこと', '会社の数字', '出口と成長']],
  ['consultant', {}, ['', '顧客の伴走', '広げる', '自分のこと']],
  ['consultant', { ep: true }, ['', '顧客の伴走', '広げる', '自分のこと']],
  ['admin', {}, ['', '全体を見る', '人と顧客', '案件と情報', 'お金・サポート・記録']],
];
CASES.forEach(([role, o, names]) => {
  const w = world(role, o), tag = role + JSON.stringify(o);
  ok(tag + '：組の並び', JSON.stringify(w.groups.map((g) => g.name)) === JSON.stringify(names), w.groups.map((g) => g.name));
  ok(tag + '：出ている項目はどれも一度だけ（抜け・重なりなし）', JSON.stringify(flat(w.groups).slice().sort()) === JSON.stringify(w.items.map((x) => x[0]).sort()), { g: flat(w.groups), i: w.items.map((x) => x[0]) });
  ok(tag + '：先頭はダッシュボードで見出しなし', w.groups[0].name === '' && w.groups[0].items.length === 1 && w.groups[0].items[0][0] === 'sec-flow');
  no(tag + '：「そのほか」に落ちる項目がない（今の項目はすべて組に入っている）', w.groups.some((g) => g.name === 'そのほか'));
  ok(tag + '：どの組にも説明がある', w.groups.slice(1).every((g) => g.desc && g.desc.length > 4));
});
ok('パートナー（法人所属）：エンタープライズは「自分のこと」', world('consultant', { ep: true }).groups.find((g) => g.name === '自分のこと').items.some((x) => x[0] === 'sec-ep'));
ok('経営者（売り手）：買い手の2つは出ない', !flat(world('customer', { plan: 'seller' }).groups).includes('sec-ma'));
ok('経営者（顧問税理士の入力だけ）：見出しなしの1項目', (function () { const w = world('customer', { access: 'finance' }); return w.groups.length === 1 && w.groups[0].name === '' && w.groups[0].items.length === 1; })());
//  知らない項目（これから足すもの）は「そのほか」へ
{
  const w = world('admin');
  const g = vm.runInContext('navGrouped("admin", effectiveNav("admin").concat([["sec-new","新しい画面"]]))', w.ctx);
  ok('知らない項目は最後の「そのほか」へ', g[g.length - 1].name === 'そのほか' && g[g.length - 1].items[0][0] === 'sec-new');
}
//  設定で並べ替えてあっても、組は崩れない（組の中の順だけが効く）
{
  const pref = { nav: { consultant: { order: ['sec-flow', 'sec-billpay', 'sec-madeals', 'sec-growth', 'sec-clients', 'sec-sales', 'sec-pdca', 'sec-biz', 'sec-market'], hidden: ['sec-pdca'] } } };
  const w = world('consultant', { pref });
  const bf = w.groups.find((g) => g.name === '顧客の伴走').items.map((x) => x[0]);
  ok('並べ替え：組の中は設定の順', JSON.stringify(bf) === JSON.stringify(['sec-madeals', 'sec-clients', 'sec-market']), bf);
  ok('並べ替え：隠した項目は出ない', !flat(w.groups).includes('sec-pdca'));
  ok('並べ替え：組の順は変わらない', JSON.stringify(w.groups.map((g) => g.name)) === JSON.stringify(['', '顧客の伴走', '広げる', '自分のこと']));
}

// ② 並び替えは組の中だけ
{
  const mv = takeFn('moveNav');
  ok('同じ組の隣とだけ入れ替える', /if\(navGroupOf\(r,o\[j\]\)!==g\) return;/.test(mv));
  ok('メニューに出ない項目は飛ばす', /while\(j>=0 && j<o\.length && skip\.indexOf\(o\[j\]\)>=0\) j\+=dir;/.test(mv));
  const w = world('consultant');
  const g = (id) => vm.runInContext('navGroupOf("consultant",' + JSON.stringify(id) + ')', w.ctx);
  ok('組の番号：ダッシュボードは -1', g('sec-flow') === -1);
  ok('組の番号：顧客管理と課題PDCAは同じ組', g('sec-clients') === g('sec-pdca') && g('sec-clients') === 0);
  ok('組の番号：お支払いは「自分のこと」', g('sec-billpay') === 2);
  const rs = takeFn('renderSettings');
  ok('設定：組の見出しと説明を出す', /var gd=\(NAV_GROUPS\[r\]\|\|\[\]\)\[gi\];/.test(rs) && /組（見出し）ごとに並んでいます/.test(rs));
  ok('設定：組の端では ▲▼ を押せない', /\(!prevSame\?'opacity:\.3;pointer-events:none;':''\)/.test(rs) && /\(!nextSame\?'opacity:\.3;pointer-events:none;':''\)/.test(rs));
  ok('設定：メニューに出ない項目は並べない', /var shownOrder=order\.filter\(function\(id\)\{ return skip\.indexOf\(id\)<0; \}\);/.test(rs));
}

// ③ 画面に出す所
{
  ok('左メニュー（PC・スマホのドロワー）に見出し', /navGrouped\(r, items\)\.map\(function\(g\)\{\n        return \(g\.name\?'<div class="sb-sec" title="'\+escA\(g\.desc\)\+'">'\+esc\(g\.name\)\+'<\/div>':''\)/.test(takeFn('buildNav')));
  no('「フラットなメニュー」の書き置きを残さない', /フラットなメニュー（カテゴリー見出しなし/.test(SRC));
  ok('経営者のスマホのタイルも組ごと', /navGrouped\('customer', effectiveNav\('customer'\)\)\.forEach/.test(takeFn('dashSheetOpen')));
  ok('カルテ：組ごとの説明が6つ', (function () { const m = /var CL_GROUP_DESC=\[([\s\S]*?)\];/.exec(SRC); return m && (m[1].match(/'[^']+'/g) || []).length === 6; })());
  ok('カルテ：開いた組の見出しの下に説明', /<div class="cl-gi"><div class="cl-gd">'\+esc\(CL_GROUP_DESC\[CL_GROUPS\.indexOf\(grp\.name\)\]\|\|''\)/.test(SRC));
  ok('カルテ：スマホのメニューにも説明', /<div class="cl-tgh">'\+esc\(grp\.name\)\+'<span class="cl-tgd">'/.test(SRC));
}

// ④ 説明書
{
  const MP = R('manual-partner.html'), MC = R('manual-customer.html'), MA = R('manual-admin.html');
  no('パートナーの説明書に「組分けはありません」を残さない', /組分けはありません/.test(MP));
  ok('パートナーの説明書：組の名前', /顧客の伴走/.test(MP) && /広げる/.test(MP) && /自分のこと/.test(MP));
  ok('経営者の説明書：組の名前', /毎月のこと/.test(MC) && /会社の数字/.test(MC) && /出口と成長/.test(MC));
  ok('運営の説明書：組の名前', /全体を見る/.test(MA) && /人と顧客/.test(MA) && /案件と情報/.test(MA) && /お金・サポート・記録/.test(MA));
}

console.log(bad.length ? bad.join('\n') : 'ALL OK', n + ' checks, ' + bad.length + ' failed');
process.exit(bad.length ? 1 : 0);
