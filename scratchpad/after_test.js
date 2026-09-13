// =============================================================
// 買った後に備える（買い手プラン）の試験
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html'), SQL = R('supabase/migrations/20260913000000_buyer_prep.sql');
const MANP = R('manual-partner.html'), MANC = R('manual-customer.html');
const VER = JSON.parse(R('version.json'));
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
  const end = SRC.indexOf('\n  }\n', last.index);
  return SRC.slice(last.index, end + 4);
}
function takeObj(name) { const i = SRC.indexOf('\n  var ' + name + '={'); const end = SRC.indexOf('\n  };', i); return SRC.slice(i, end + 5); }
function takeArr(name) { const i = SRC.indexOf('\n  var ' + name + '=['); const end = SRC.indexOf('\n  ];', i); return SRC.slice(i, end + 5); }
function takeVar(name) { const i = SRC.indexOf('\n  var ' + name + '='); const end = SRC.indexOf(';\n', i); return SRC.slice(i, end + 2); }
const IND_KEYS = (() => { const i = SRC.indexOf('\n  var INDUSTRY_PC={'); const j = SRC.indexOf('\n  };', i); return [...SRC.slice(i, j).matchAll(/\n    '([^']+)':\[/g)].map((m) => m[1]); })();
const base =
  'function esc(s){ return String(s==null?"":s).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];}); }' +
  'function nOr(v){ return (v==null||v==="")?null:Number(v); }' +
  'function finMetrics(f){ return { debtYears:f.debtYears }; }' +
  'var ME="me"; var asked=[]; function knvAsk(q){ asked.push(q); }' +
  takeArr('AFTER_CATS') + takeVar('AFTER_SCHEMES') + takeVar('AFTER_LEADERS') + takeObj('AFTER_IND') + takeArr('AFTER_TOPICS') + takeVar('AFTER_ST') +
  'var AFTER={ scope:"c1", who:"customer", row:null, ctx:null, edit:{ items:{} }, cat:"all", sqlOk:true };' +
  takeFn('afterIndOf') + takeFn('afterCtx') + takeFn('afterFlags') + takeFn('afterProgress') + takeFn('afterHtml') + takeFn('afterAsk') + takeFn('afterScenario');
const M = new Function(base + 'return {cats:AFTER_CATS, ind:AFTER_IND, topics:AFTER_TOPICS, indOf:afterIndOf, ctx:afterCtx, flags:afterFlags, progress:afterProgress, html:afterHtml, ask:afterAsk, scenario:afterScenario, asked:asked, A:AFTER};')();

// ① 中身
{
  is('分類は6つ', M.cats.map((c) => c.k), ['admin', 'money', 'people', 'outside', 'industry', 'pmi']);
  ok('項目は20以上', M.topics.length >= 20);
  ok('全項目に待ち受けること・いつ・準備・分類', M.topics.every((t) => t.t && t.when && t.what && t.prep && M.cats.some((c) => c.k === t.cat) && typeof t.fit === 'function'));
  ok('全分類に項目がある', M.cats.every((c) => M.topics.some((t) => t.cat === c.k)));
  is('業種の目安は INDUSTRY_PC と同じ鍵', Object.keys(M.ind).filter((k) => !IND_KEYS.includes(k)), []);
  is('INDUSTRY_PC の全業種に業種の目安', IND_KEYS.filter((k) => !M.ind[k]), []);
  ok('業種ごとに許認可・人・落とし穴', Object.keys(M.ind).every((k) => M.ind[k].lic && M.ind[k].ppl && M.ind[k].risk));
  ok('鍵は重複しない', new Set(M.topics.map((t) => t.k)).size === M.topics.length);
}
// ② 自社に効く（fit）
{
  const d = { fin: [{ cash: 500, revenue: 1000, debtYears: 12 }], ans: { deputy: false, guarantee: false, sales_dep: true }, bc: { industries: '建設業、製造業', purpose: '人材・技術', budget_man: 8000 }, deals: [{ deal_type: '譲受', stage: 2 }], val: { buy_power: 5000 }, prof: { industry: '飲食業', company_name: 'A社' } };
  const e = { scheme: 'asset', leader: 'self', target_industry: null, items: {} };
  const c = M.ctx(d, e);
  is('対象の業種は買いたい条件から（先に出た業種）', c.ind, '建設業');
  is('数字', [c.cashM, c.debtYears, c.budget, c.buyPower, c.dealsN, c.scheme, c.leader], [0.5, 12, 8000, 5000, 1, 'asset', 'self']);
  const f = M.flags(e, c), keys = f.map((x) => x.k);
  ok('事業譲渡：許認可の取り直しと転籍', keys.includes('admin_license') && keys.includes('admin_labor'));
  ok('右腕なしで兼務：責任者に警告', f.find((x) => x.k === 'people_leader').note.indexOf('右腕') >= 0);
  ok('債務償還年数12年：買収資金', f.find((x) => x.k === 'money_fund').note.indexOf('12.0年') >= 0);
  ok('現預金0.5か月：運転資金の谷', f.find((x) => x.k === 'money_wc').note.indexOf('0.5か月') >= 0);
  ok('保証の解除がまだ', keys.includes('money_guarantee'));
  ok('業種の落とし穴・許認可・人（建設業）', f.find((x) => x.k === 'ind_risk').note.indexOf('未成工事') >= 0 && f.find((x) => x.k === 'out_authority').note.indexOf('建設業許可') >= 0 && f.find((x) => x.k === 'people_key').note.indexOf('一級技術者') >= 0);
  ok('案件が動いていれば PMI に引き継ぐ案内', f.find((x) => x.k === 'pmi_100').note.indexOf('1件') >= 0);
  ok('目的があればシナジーの検証', f.find((x) => x.k === 'pmi_synergy').note.indexOf('人材・技術') >= 0);
  const e2 = { scheme: 'stock', leader: 'deputy', target_industry: '介護・福祉施設', items: {} };
  const c2 = M.ctx({ fin: [], ans: { deputy: true, guarantee: true, sales_dep: true }, bc: null, deals: [], val: null, prof: {} }, e2);
  is('業種は選んだものが勝つ', c2.ind, '介護・福祉施設');
  const f2 = M.flags(e2, c2).map((x) => x.k);
  ok('株式譲渡・右腕あり：許認可の取り直しや責任者の警告は出ない', !f2.includes('admin_license') && !f2.includes('admin_labor') && !f2.includes('people_leader') && !f2.includes('money_guarantee'));
  ok('業種の3項目は出る', f2.includes('ind_risk') && f2.includes('out_authority') && f2.includes('people_key'));
  is('責任者が未定なら警告', M.flags({ items: {} }, M.ctx({ fin: [], ans: { guarantee: true, sales_dep: true }, bc: null, deals: [], val: null, prof: {} }, { items: {} })).map((x) => x.k), ['people_leader']);
  is('予算が余力を超える', M.flags({ items: {} }, Object.assign(M.ctx({ fin: [], ans: {}, bc: { budget_man: 9000 }, deals: [], val: { buy_power: 4000 }, prof: {} }, { leader: 'hire', items: {} }))).find((x) => x.k === 'money_fund').note.indexOf('超えています') >= 0, true);
}
// ③ 進み具合と画面
{
  is('進み具合', M.progress({ items: { admin_license: { st: 'ready' }, money_wc: { st: 'learned' }, x: { st: 'ready' } } }), { total: M.topics.length, ready: 1, learned: 1 });
  const d = { fin: [{ cash: 500, revenue: 1000, debtYears: 12 }], ans: { deputy: false }, bc: { industries: '建設業', purpose: '人材', budget_man: 8000 }, deals: [], val: null, prof: { industry: '飲食業', company_name: 'A社' } };
  const e = { scheme: 'asset', leader: 'self', target_industry: null, items: { admin_license: { st: 'ready', note: '行政書士に確認済み' } } };
  const c = M.ctx(d, e);
  const h = M.html(e, c, 'customer', 'all');
  ok('想定の3つの選択と、進み具合', /想定する形/.test(h) && /責任者の想定/.test(h) && /対象の業種/.test(h) && /準備した 1／学んだ 0／全/.test(h));
  ok('分類の切替と「自社に効く」', /afterCat\('flag'\)/.test(h) && /自社に効く \d+</.test(h) && M.cats.every((x) => h.indexOf("afterCat('" + x.k + "')") > 0));
  ok('項目に待ち受けること・準備・自社では・学ぶ・状態・メモ', /待ち受けること：/.test(h) && /いま準備できること：/.test(h) && /<b>自社では：<\/b>/.test(h) && /afterAsk\('admin_license'\)/.test(h) && /afterStatus\('admin_license','ready'\)/.test(h) && /行政書士に確認済み/.test(h));
  ok('準備した項目は緑の印', /<span class="tag green" style="font-size:10px;">準備した<\/span>/.test(h));
  ok('1年を想像するボタンと保存', /onclick="afterScenario\(\)"/.test(h) && /onclick="afterSave\(\)"/.test(h));
  const hf = M.html(e, c, 'customer', 'flag');
  ok('「自社に効く」だけに絞れる', (hf.match(/待ち受けること：/g) || []).length === M.flags(e, c).length);
  const hp = M.html(e, c, 'customer', 'pmi');
  is('分類で絞れる', (hp.match(/待ち受けること：/g) || []).length, M.topics.filter((t) => t.cat === 'pmi').length);
  const h0 = M.html({ items: {} }, c, 'customer', 'all');
  ok('SQL 未実行でも読める（案内つき）', (() => { M.A.sqlOk = false; const x = M.html({ items: {} }, c, 'customer', 'all'); M.A.sqlOk = true; return /SQL を実行してください/.test(x); })());
  ok('学ぶは継ナビくんへ（会社の状況つき）', (() => { M.A.ctx = c; M.A.edit = e; M.asked.length = 0; M.ask('people_leader'); return M.asked.length === 1 && /責任者を誰にするか/.test(M.asked[0]) && /右腕/.test(M.asked[0]) && /建設業/.test(M.asked[0]) && /税額の計算はしない/.test(M.asked[0]); })());
  ok('1年を想像するは月ごとの場面を頼む', (() => { M.asked.length = 0; M.scenario(); return /契約前・クロージング当日・最初の1週間・100日・半年・1年/.test(M.asked[0]) && /飲食業/.test(M.asked[0]); })());
}
// ④ 配線・SQL・説明書・版
{
  ok('経営者のメニュー：買い手だけ「買った後に備える」', /\[\['sec-ma','買い手になる'\],\['sec-after','買った後に備える'\]\]/.test(SRC));
  ok('経営者の画面：案件の後ろに、買い手だけ', /id="sec-after"/.test(SRC) && /id="my-after"/.test(SRC) && SRC.indexOf('id="market-open"') < SRC.indexOf('id="sec-after"'));
  ok('起動時に読む', /loadExitPlan\(ME,'customer'\); loadAfterPrep\(ME,'customer'\); knvInit\(\);/.test(SRC));
  ok('カルテ：見出し・案内・枠・読み込み', /id="cs-after"/.test(SRC) && /id="knav-after"/.test(SRC) && /id="cl-after"/.test(SRC) && /loadExitPlan\(custId,'partner'\);\n    loadAfterPrep\(custId,'partner'\);/.test(SRC));
  const knav = takeArr('KARTE_NAV');
  ok('カルテのナビに「買った後に備える」（出口の次）', /id:'after', sec:'cs-after'/.test(knav) && knav.indexOf("id:'after'") > knav.indexOf("id:'exit'") && knav.indexOf("id:'after'") < knav.indexOf("id:'ready'"));
  ok('売り手では任意', /st\.id==='ready'\|\|st\.id==='bc'\|\|st\.id==='after'/.test(takeFn('karteOpt')));
  ok('カルテの文脈に buyer_prep', /from\('buyer_prep'\)/.test(takeFn('loadClientScript')) && /ctx\.after=bp\?/.test(takeFn('loadClientScript')));
  ok('保存は upsert', /from\('buyer_prep'\)\.upsert\(row\)/.test(takeFn('afterSave')));
  ok('SQL：表と RLS', /create table if not exists public\.buyer_prep/.test(SQL) && /customer_may\(customer_id\)/.test(SQL) && /期待値：表=1/.test(SQL));
  ok('説明書：経営者・パートナー', /<h3>買った後に備える<\/h3>/.test(MANC) && /<h3>買った後に備える<\/h3>/.test(MANP));
  const build = SRC.match(/var APP_BUILD='([^']+)'/)[1];
  is('版が揃う', [build, VER.build], ['20260913-01', '20260913-01']);
}
console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
