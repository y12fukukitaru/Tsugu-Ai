// =============================================================
// ⑨ 承継準備度 → 買い手になる準備度（譲受準備度）の試験
//
//   五つの軸（自己資金・借入余力・経営陣の余裕・PMI体制・目的の明確さ）
//   財務の自動評価と面談項目を混ぜて軸ごとに 0〜100、総合はその平均。
//   保存先は従来の succession_checks.answers のまま。右腕・マニュアル・
//   経営者保証は従来の鍵を共有し、保存済みの答えを引き継ぐ。
//   継がせる側の9項目は消さず、たたんだ中に残す。
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const MANP = fs.readFileSync(__dirname + '/../manual-partner.html', 'utf8');

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
  let m, last = null, cnt = 0;
  while ((m = re.exec(SRC)) !== null) { last = m; cnt++; }
  if (!last) throw new Error('見つかりません: ' + name);
  is('定義は一つだけ: ' + name, cnt, 1);
  const end = SRC.indexOf('\n  }\n', last.index);
  return SRC.slice(last.index, end + 4);
}
function takeArr(name) {
  const i = SRC.indexOf('\n  var ' + name + '=[');
  if (i < 0) throw new Error('見つかりません: var ' + name);
  const end = SRC.indexOf('\n  ];', i);
  return SRC.slice(i, end + 5);
}

//  実物の finMetrics / finJudge / finFmt / nOr を使い、画面の数字と同じ計算で試す
const base =
  'function esc(s){ return String(s==null?"":s).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];}); }' +
  'function nOr(v){ return (v==null||v==="")?null:Number(v); }' +
  takeFn('finMetrics') + takeFn('finJudge') + takeFn('finFmt') +
  takeArr('SHINDAN_CHECKS') + takeArr('BUY_AXES') +
  '\n  var SHINDAN={ cust:null, ans:{}, fin:[], bc:null };' +
  takeFn('shindanAutoItems') + takeFn('shindanAxisScore') + takeFn('shindanScore') +
  takeFn('renderShindan') + takeFn('shindanTick');

function make(state) {
  const els = {};
  const mod = new Function(
    base +
    'var els=arguments[0]; function $(id){ return els[id]||(els[id]={innerHTML:""}); }' +
    'SHINDAN=arguments[1];' +
    'return { score:shindanScore, render:function(){ renderShindan(); return els["shindan-body"].innerHTML; }, axes:BUY_AXES, checks:SHINDAN_CHECKS, tick:shindanTick, S:function(){ return SHINDAN; } };'
  );
  return mod(els, Object.assign({ cust: 'c1', ans: {}, fin: [], bc: null }, state || {}));
}

// ---------------------------------------------------------------
// ① 軸の形
// ---------------------------------------------------------------
{
  const M = make();
  is('軸は五つ', M.axes.map(a => a.l), ['自己資金', '借入余力', '経営陣の余裕', 'PMI体制', '目的の明確さ']);
  const keys = [].concat(...M.axes.map(a => a.checks.map(c => c[0])));
  is('面談項目の鍵に重複がない', keys.length, new Set(keys).size);
  //  従来の鍵を共有している（保存済みの答えを引き継ぐ）
  ok('右腕は従来の鍵 deputy', keys.indexOf('deputy') >= 0);
  ok('マニュアルは従来の鍵 manual', keys.indexOf('manual') >= 0);
  ok('経営者保証は従来の鍵 guarantee', keys.indexOf('guarantee') >= 0);
  const old = M.checks.map(c => c[0]);
  keys.filter(k => old.indexOf(k) >= 0).forEach(k => {
    const a = M.checks.filter(c => c[0] === k)[0][1];
    const b = [].concat(...M.axes.map(x => x.checks)).filter(c => c[0] === k)[0][1];
    is('共有する鍵は文言も同じ: ' + k, a, b);
  });
  ok('新しい鍵は b_ で始まる', keys.filter(k => old.indexOf(k) < 0).every(k => /^b_/.test(k)));
  is('継がせる側の9項目はそのまま', M.checks.length, 9);
}

// ---------------------------------------------------------------
// ② 点のつけかた
// ---------------------------------------------------------------
{
  //  何も無い：財務データなし、条件なし、面談項目なし
  const M = make();
  const s = M.score();
  is('データなしの総合は 0', s.score, 0);
  const byK = {}; s.axes.forEach(a => byK[a.k] = a);
  is('自己資金：自動評価は母数に入らず、面談1項目だけ', [byK.cash.max, byK.cash.score], [2, 0]);
  is('目的：買いたい条件が無ければ ×（母数に入る）', [byK.aim.max, byK.aim.score], [6, 0]);
  is('PMI：月次データ 0か月は ×', byK.pmi.auto[0].j, 'bad');
}
{
  //  財務が良く、条件も揃い、面談も全部 ○
  const fin = [{ revenue: 1000, cogs: 600, profit: 100, depreciation: 20, cash: 2500, total_assets: 5000, equity: 2000, short_debt: 300, long_debt: 500 },
               { revenue: 900 }, { revenue: 950 }];
  const ans = {}; const M0 = make();
  [].concat(...M0.axes.map(a => a.checks)).forEach(c => ans[c[0]] = true);
  const M = make({ fin: fin, ans: ans, bc: { purpose: '人材・技術の獲得', industries: '製造業', region: null, budget_man: 5000 } });
  const s = M.score();
  is('全部そろえば 100', s.score, 100);
  const byK = {}; s.axes.forEach(a => byK[a.k] = a);
  is('現預金 2.5か月分は ○', byK.cash.auto[0].j, 'good');
  is('自己資金の仮置きは現預金の 50%', byK.cash.auto[1].v, '1,250万円');
  is('債務償還年数 800/(120×12)=0.56年 は ○', byK.debt.auto[0].j, 'good');
  is('自己資本比率 40% は ○', byK.debt.auto[1].j, 'good');
  is('営業利益率 10% は ○', byK.team.auto[0].j, 'good');
  is('月次 3か月は ○', byK.pmi.auto[0].j, 'good');
  is('買いたい条件 3/3 は ○', [byK.aim.auto[0].j, byK.aim.auto[0].v], ['good', '3／3 記入']);
}
{
  //  途中：財務は普通、条件は目的だけ、面談は右腕だけ
  const fin = [{ revenue: 1000, cogs: 700, profit: 30, depreciation: 10, cash: 1200, total_assets: 5000, equity: 800, short_debt: 2000, long_debt: 3000 }];
  const M = make({ fin: fin, ans: { deputy: true }, bc: { purpose: '売上・シェア拡大' } });
  const s = M.score();
  const byK = {}; s.axes.forEach(a => byK[a.k] = a);
  is('現預金 1.2か月分は △', byK.cash.auto[0].j, 'mid');
  is('自己資金：△(1)＋未チェック(0)／4 = 25', byK.cash.score, 25);
  is('債務償還年数 5000/(40×12)=10.4年 は △', byK.debt.auto[0].j, 'mid');
  is('自己資本比率 16% は △', byK.debt.auto[1].j, 'mid');
  is('借入余力：1+1+0+0／8 = 25', byK.debt.score, 25);
  is('営業利益率 3% は △', byK.team.auto[0].j, 'mid');
  is('経営陣：△(1)＋右腕(2)＋任せる人(0)／6 = 50', byK.team.score, 50);
  is('PMI：月次1か月 △(1)＋0+0+0／8 = 13', byK.pmi.score, 13);
  is('目的：条件 1/3 △(1)＋0+0／6 = 17', byK.aim.score, 17);
  is('総合は五軸の平均 (25+25+50+13+17)/5 = 26', s.score, 26);
  //  従来の承継準備度と違い、継がせる側の項目を付けても点は動かない
  M.tick('shares', true); M.tick('will', true);
  is('継がせる側の項目は点に入らない', M.score().score, 26);
  M.tick('guarantee', true);
  is('共有する鍵（経営者保証）は借入余力に効く', M.score().axes.filter(a => a.k === 'debt')[0].score, 50);
}

// ---------------------------------------------------------------
// ③ 描画
// ---------------------------------------------------------------
{
  const M = make({ fin: [{ revenue: 1000, cogs: 700, profit: 30, depreciation: 10, cash: 1200, total_assets: 5000, equity: 800, short_debt: 2000, long_debt: 3000 }], ans: { deputy: true }, bc: { purpose: '売上・シェア拡大' } });
  const h = M.render();
  ok('総合点が出る', /26<span[^>]*>点<\/span>/.test(h));
  ok('段の言葉（45未満）', /まず地盤を固める段階です/.test(h));
  is('五つの軸のバー', (h.match(/id="shx-/g) || []).length, 5);
  ok('軸の点が出る', /shx-cash[\s\S]*?>25<\/span>/.test(h));
  //  次の一手は弱い軸（PMI 13）から
  const todo = /準備度を上げる次の一手<\/div><ul[^>]*>([\s\S]*?)<\/ul>/.exec(h);
  ok('次の一手がある', !!todo);
  const items = (todo ? todo[1] : '').match(/<li>(.*?)<\/li>/g) || [];
  is('次の一手は最大4つ', items.length, 4);
  ok('最初の一手は最も弱い軸（PMI体制）', /^<li>【PMI体制】/.test(items[0]));
  //  面談項目は軸ごとに並び、従来の9項目はたたんだ中
  ok('面談項目は軸ごと', /面談で確かめて記録（軸ごと）/.test(h));
  ok('継がせる側はたたんである', /<details[^>]*><summary[^>]*>継がせる側の準備（従来の承継準備度・9項目）も記録する<\/summary>/.test(h));
  is('チェックボックスの数＝五軸10＋従来9', (h.match(/type="checkbox"/g) || []).length, 19);
  ok('右腕は両方で checked（同じ答え）', (h.match(/checked onchange="shindanTick\('deputy'/g) || []).length === 2);
  ok('株対策シミュレーターの入口はたたんだ中', /<details[\s\S]*tsugu-succession-form\.html[\s\S]*<\/details>/.test(h));
  ok('次の1社へ誘うボタン', /onclick="shindanGoMna\(\)">次の1社を探す（買いたい条件・提案へ）<\/button>/.test(h));
  ok('譲受余力の試算へ', /onclick="shindanGoValue\(\)">譲受余力を試算する（承継シミュレーション）<\/button>/.test(h));
  ok('注意書きは「保証するものではない」', /M&Aの成立・融資の可否・企業価値を保証するものではありません/.test(h));
  no('相続税評価額は出さない', /相続税評価額/.test(h));
}
{
  const ans = {}; const M0 = make();
  [].concat(...M0.axes.map(a => a.checks)).forEach(c => ans[c[0]] = true);
  const M = make({ fin: [{ revenue: 1000, cogs: 600, profit: 100, depreciation: 20, cash: 2500, total_assets: 5000, equity: 2000, short_debt: 300, long_debt: 500 }, {}, {}], ans: ans, bc: { purpose: 'x', industries: 'y', budget_man: 1 } });
  const h = M.render();
  ok('100点の言葉', /次の1社を引き受ける準備が整っています/.test(h));
  no('100点なら次の一手は出ない', /準備度を上げる次の一手/.test(h));
}

// ---------------------------------------------------------------
// ④ 読み込み・保存・置き場
// ---------------------------------------------------------------
{
  const f = takeFn('loadShindan');
  ok('買いたい条件も読む', /sb\.from\('buy_criteria'\)\.select\('industries,region,purpose,budget_man'\)\.eq\('customer_id',custId\)\.maybeSingle\(\)/.test(f));
  ok('従来の答えを読む', /sb\.from\('succession_checks'\)\.select\('answers'\)/.test(f));
  const g = takeFn('shindanSave');
  ok('保存先は従来のまま', /sb\.from\('succession_checks'\)\.upsert\(payload, \{onConflict:'customer_id'\}\)/.test(g));
  ok('見出しが「買い手になる準備度」', /id="cs-shindan"[^>]*><span class="ph-t">'\+icoSvg\('trend'\)\+'買い手になる準備度（譲受準備度）<\/span>/.test(SRC));
  ok('説明に五つの軸', /自己資金・借入余力・経営陣の余裕・PMI体制・目的の明確さ<\/b>の五つの軸で測ります/.test(SRC));
  ok('カルテで買いたい条件を書いたら準備度を読み直す', /if\(pfx==='cbc'\) loadShindan\(cid\);/.test(SRC));
  ok('viewClient で読まれる', /\n    loadShindan\(custId\);/.test(SRC));
  //  画面に出る文字列として「承継準備度スコア」が残っていない
  const shown = SRC.split('\n').filter(l => /承継準備度スコア/.test(l) && !/^\s*\/\//.test(l));
  is('画面に出る「承継準備度スコア」の残り', shown.map(l => l.trim().slice(0, 80)), []);
  ok('説明書も改めた', /<h3>買い手になる準備度（譲受準備度）<\/h3>/.test(MANP) && /企業価値診断＋買い手になる準備度/.test(MANP));
  no('説明書に旧名が残っていない', /承継準備度スコア/.test(MANP));
}
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
