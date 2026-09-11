// =============================================================
// 労働分配率の試験
//   ・月次データの「人件費」と、財務レポートの労働分配率（業種の目安つき）
//   ・業種別の目安と打ち手の例（全業種にある）
//   ・シミュレーター：時給を上げたときの率・利益・打ち手（時短／配置転換／値上げ）
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const MANP = fs.readFileSync(__dirname + '/../manual-partner.html', 'utf8');
const MANC = fs.readFileSync(__dirname + '/../manual-customer.html', 'utf8');
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
function takeObj(name) {
  const i = SRC.indexOf('\n  var ' + name + '={');
  if (i < 0) throw new Error('見つかりません: var ' + name);
  const end = SRC.indexOf('\n  };', i);
  return SRC.slice(i, end + 5);
}
function takeArr(name) {
  const i = SRC.indexOf('\n  var ' + name + '=[');
  const end = SRC.indexOf('\n  ];', i);
  return SRC.slice(i, end + 5);
}
const base =
  'function esc(s){ return String(s==null?"":s).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];}); }' +
  'function nOr(v){ return (v==null||v==="")?null:Number(v); }' +
  takeFn('finFmt') + takeFn('finMetrics') + takeFn('finJudge') + takeObj('LABOR_BENCH') + takeObj('INDUSTRY_PC') +
  takeFn('laborBench') + takeFn('laborJudge') + takeFn('laborSimCalc') + takeFn('laborBox') +
  'var LS_SUMMARY="";' + takeFn('laborSimHtml');
const M = new Function(base + 'return {bench:LABOR_BENCH, ind:INDUSTRY_PC, laborBench:laborBench, laborJudge:laborJudge, calc:laborSimCalc, metrics:finMetrics, box:laborBox, html:function(i,r){ var h=laborSimHtml(i,r); return {h:h, sum:LS_SUMMARY}; }};')();

// ---------------------------------------------------------------
// ① 業種の目安
// ---------------------------------------------------------------
{
  const inds = Object.keys(M.ind), benches = Object.keys(M.bench);
  is('業種の一覧と目安の業種が一致', inds.filter(k => !benches.includes(k)), []);
  ok('全業種に lo<hi と打ち手3つ', benches.every(k => M.bench[k].lo < M.bench[k].hi && M.bench[k].levers.length === 3));
  is('知らない業種は「その他」', M.laborBench('宇宙業'), M.bench['その他']);
  is('製造業 50% は良', M.laborJudge(50, '製造業'), 'good');
  is('製造業 58% は普（目安+5以内）', M.laborJudge(58, '製造業'), 'mid');
  is('製造業 65% は要注意', M.laborJudge(65, '製造業'), 'bad');
  is('介護 72% は良（業種で目安が違う）', M.laborJudge(72, '介護・福祉施設'), 'good');
  is('null は判定なし', M.laborJudge(null, '製造業'), null);
}

// ---------------------------------------------------------------
// ② 月次データと財務レポート
// ---------------------------------------------------------------
ok('月次データに人件費の欄', /\{ k:'labor_cost',\s+l:'人件費（役員報酬＋給料手当＋賞与＋法定福利費＋福利厚生費の合計）', s:'人件費', g:'pl' \}/.test(SRC));
ok('取り込みの照合に人件費', /\['labor_cost',\s+\/人件費\|労務費合計\|人件費合計\/\]/.test(SRC));
{
  const m = M.metrics({ revenue: 1000, cogs: 600, labor_cost: 220 });
  is('粗利 400', m.gross, 400);
  is('労働分配率 55%', m.laborShare, 55);
  is('人件費率 22%', m.laborRate, 22);
  is('人件費が無ければ null', M.metrics({ revenue: 1000, cogs: 600 }).laborShare, null);
  is('粗利がゼロ以下なら null', M.metrics({ revenue: 1000, cogs: 1000, labor_cost: 100 }).laborShare, null);
  const h = M.box(55, '製造業');
  ok('レポートの箱：率と業種の目安', /労働分配率（対粗利）/.test(h) && /55\.0%/.test(h) && /製造業の目安 45〜55%/.test(h));
  ok('目安の内側は緑', /color:#27684A/.test(h));
}
ok('レポートは人件費があるときだけ箱を出す', /\+\(m\.laborShare!=null\?laborBox\(m\.laborShare, industry\):''\)/.test(SRC));
ok('レポートは業種を引数か画面から取る', /function finReportHtml\(e, industry\)\{[\s\S]*?industry=industry\|\|finIndustry\(\);/.test(SRC));
{
  const f = takeFn('finIndustry');
  ok('業種はカルテの欄→本人のプロフィールの順', /cpi-industry/.test(f) && /window\.__prof && window\.__prof\.industry/.test(f));
}

// ---------------------------------------------------------------
// ③ シミュレーターの計算
// ---------------------------------------------------------------
{
  //  月商1000・粗利率40（粗利400）・人件費220・1600時間・時給+5%
  const r = M.calc({ industry: '製造業', rev: 1000, gr: 40, labor: 220, hours: 1600, up: 5, target: '' });
  ok('計算できる', r.ok);
  is('いまの率 55%', Math.round(r.ls * 1000) / 10, 55);
  is('引上げ後 57.75%', Math.round(r.ls2 * 10000) / 100, 57.75);
  is('利益への影響 −11万円/月', Math.round(r.dProfit), -11);
  is('年 −132万円', Math.round(r.dProfitY), -132);
  is('実質時給 1,375円', Math.round(r.wage), 1375);
  is('引上げ後の時給 1,444円', Math.round(r.wage2), 1444);
  is('人時生産性 2,500円/時', Math.round(r.hourGp), 2500);
  ok('守りたい率は既定で「いまの率」', Math.abs(r.target - r.ls) < 1e-9);
  ok('打ち手が要る', r.need);
  is('時短：−4.8%（= 1−1/1.05）', Math.round(r.hoursCut * 1000) / 10, 4.8);
  is('時短後の時間 1,524時間', Math.round(r.hours2), 1524);
  is('配置転換：粗利 +5.0%', Math.round(r.gpUp * 1000) / 10, 5);
  is('必要な粗利 420万円', Math.round(r.needGp), 420);
  is('値上げ：+2.0%（粗利20万円÷月商1000）', Math.round(r.priceUp * 1000) / 10, 2);
  is('組み合わせ：粗利 +2.5%', Math.round(r.gHalf * 1000) / 10, 2.5);
  ok('組み合わせの時短は単独より小さい', r.hHalf > 0 && r.hHalf < r.hoursCut);
  is('判定：製造業 55% は良、57.75% は普', [r.judge, r.judge2], ['good', 'mid']);
  //  守りたい率を高めに置けば打ち手は不要
  const r2 = M.calc({ industry: '製造業', rev: 1000, gr: 40, labor: 220, hours: 1600, up: 5, target: 60 });
  no('60% を守るなら打ち手は不要', r2.need);
  is('不要なら打ち手はゼロ', [r2.hoursCut, r2.gpUp, r2.priceUp], [0, 0, 0]);
  //  引上げゼロ
  const r0 = M.calc({ industry: '製造業', rev: 1000, gr: 40, labor: 220, up: 0 });
  no('引上げゼロなら打ち手は不要', r0.need);
  is('時間が無ければ時給は null', [r0.wage, r0.hourGp, r0.hours2], [null, null, null]);
  //  入力が足りない
  no('粗利ゼロなら計算しない', M.calc({ rev: 0, gr: 40, labor: 100 }).ok);
  no('人件費ゼロなら計算しない', M.calc({ rev: 1000, gr: 40, labor: 0 }).ok);
  ok('空でも落ちない', M.calc({}).ok === false);
  //  粗利率の上限
  is('粗利率は100で頭打ち', M.calc({ rev: 100, gr: 250, labor: 10, up: 1 }).gp, 100);
}

// ---------------------------------------------------------------
// ④ 画面と写し
// ---------------------------------------------------------------
{
  const i = { industry: '飲食業', rev: 800, gr: 65, labor: 320, hours: 2000, up: 10, target: '' };
  const r = M.calc(i);
  const { h, sum } = M.html(i, r);
  ok('現状・引上げ後・利益・時給・人時生産性の5枠', /いまの労働分配率/.test(h) && /時給 \+10% のあと/.test(h) && /利益への影響/.test(h) && /実質時給/.test(h) && /人時生産性/.test(h));
  ok('業種の目安の一文', /飲食業の目安は <b>55〜65%<\/b>/.test(h));
  ok('三つの打ち手', /① 労働時間の短縮/.test(h) && /② 配置転換で粗利を増やす/.test(h) && /③ 値上げ/.test(h));
  ok('業種の例が添う', /ピークにシフトを寄せ/.test(h) && /仕込みの集約/.test(h) && /券売機/.test(h));
  ok('組み合わせの例', /組み合わせの例：/.test(h));
  ok('写しに業種・率・打ち手', /【労働分配率の試算】飲食業/.test(sum) && /いまの労働分配率：61\.5%/.test(sum) && /労働時間の短縮：−9\.1%/.test(sum) && /値上げ：\+/.test(sum));
  ok('写しに注意書き', /社会保険労務士/.test(sum));
  const i2 = { industry: '製造業', rev: 1000, gr: 40, labor: 220, hours: '', up: 5, target: 60 };
  const { h: h2 } = M.html(i2, M.calc(i2));
  ok('打ち手が不要なときはその旨', /打ち手は要りません/.test(h2));
  no('不要なときは打ち手の枠を出さない', /① 労働時間の短縮/.test(h2));
  const { h: h3 } = M.html({ rev: 0 }, M.calc({ rev: 0 }));
  ok('入力が足りないときの案内', /月商・粗利率・人件費を入れると/.test(h3));
}

// ---------------------------------------------------------------
// ⑤ 入口・案内・説明書・SQL・版
// ---------------------------------------------------------------
ok('各種シミュレーターに枠がある', /労働分配率シミュレーター<\/div>/.test(SRC) && /onclick="openLaborSim\(\)">労働分配率シミュレーターを開く<\/button>/.test(SRC));
ok('カルテの月次レポートの上から、この会社の数字で開ける', /onclick="openLaborSimFor\(\\''\+custId\+'\\'\)">💴 労働分配率シミュレーター（この会社の数字で）<\/button>/.test(SRC));
{
  const f = takeFn('openLaborSimFor');
  ok('最新の月次（売上・原価・人件費）と業種を読む', /select\('year_month,revenue,cogs,labor_cost'\)/.test(f) && /select\('industry'\)/.test(f));
  const a = takeFn('laborSimAsk');
  ok('継ナビくんへの頼みに業種・率・目安・打ち手', /業種：'\+\(i\.industry\|\|'その他'\)/.test(a) && /業種の目安'\+b\.lo\+'〜'\+b\.hi/.test(a) && /労働時間−/.test(a) && /3か月で確かめる指標/.test(a));
  no('頼みに◯◯が残らない', /◯◯/.test(a));
}
ok('質問ガイドに賃上げ・労働分配率', /\{t:'💴 賃上げ・労働分配率', subs:\[/.test(SRC) && /\['賃上げと利益の両立'/.test(SRC) && /\['配置転換の進めかた'/.test(SRC));
ok('継ナビくんのパートナー向け案内に労働分配率', /労働分配率=時給を上げたとき人件費÷粗利をどこに保ち利益を出し続けるか/.test(SRC));
ok('保存は端末の中（価格転嫁と同じ）', /var LS_KEY='tsugu\.laborsim\.v1';/.test(SRC));
ok('人員整理を勧めない注意書き', /人員整理を勧めるものではありません/.test(SRC));
ok('パートナー説明書：労働分配率の頁', /<h2>労働分配率 ― 時給を上げても利益を出し続ける<\/h2>/.test(MANP) && /① 労働時間の短縮/.test(MANP));
ok('パートナー説明書：シミュレーターの一覧に労働分配率', /退職金、価格転嫁、労働分配率の試算ツール/.test(MANP));
ok('経営者説明書：財務レポートに労働分配率', /財務レポートに<b>労働分配率<\/b>/.test(MANC));
{
  const SQL = fs.readFileSync(__dirname + '/../supabase/migrations/20260911020000_labor_share.sql', 'utf8');
  ok('SQL：人件費の列を足す（何度流しても同じ）', /alter table public\.financial_entries add column if not exists labor_cost numeric;/.test(SQL));
}
{
  const b = /var APP_BUILD='([^']+)';/.exec(SRC);
  const v = JSON.parse(fs.readFileSync(__dirname + '/../version.json', 'utf8'));
  ok('APP_BUILD と version.json が同じ', b && b[1] === v.build);
}
console.log('試験 ' + n + '件');
if (bad.length) { console.log('\n合わないもの ' + bad.length + '件:'); bad.forEach(b => console.log('  ✗ ' + b.name + '\n      出た: ' + b.got + '\n      欲しい: ' + b.want)); process.exit(1); }
console.log('ぜんぶ通りました。');
