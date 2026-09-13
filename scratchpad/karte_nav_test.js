// =============================================================
// カルテ「継ナビくんのナビ」の試験
//
//   道具をやる順番（土台→現金→余力→条件）を実データから 済／△／次／あと で
//   出し、各道具の見出しの下に「なぜ今・やると分かること・次の一手」の案内と
//   「結果を継ナビくんと読む」（数字を埋めて渡す）を置く。
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
const base =
  'function esc(s){ return String(s==null?"":s).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];}); }' +
  takeFn('finFmt') + takeArr('KARTE_NAV') + '\n  var KARTE_CTX=null;' +
  takeFn('karteState') + takeFn('karteOpt') + takeFn('karteNavHtml') + takeFn('karteStripHtml') + takeFn('karteAsk') + takeFn('renderKarteNav');
function make() {
  const els = {}; const asked = [];
  const M = new Function(
    base + 'var asked=arguments[1]; function knvAsk(q){ asked.push(q); }' +
    'var els=arguments[0]; function $(id){ return els[id]||(els[id]={innerHTML:""}); }' +
    'return { NAV:KARTE_NAV, state:karteState, nav:karteNavHtml, strip:karteStripHtml, ask:karteAsk, render:renderKarteNav, els:els };'
  )(els, asked);
  return { M, els, asked };
}
const empty = { m: {}, months: 0, snap: null, d: { fin: 0, cash: 0, ins: 0, pay: 0, obr: 0 }, val: 0, ai: 0, ready: null, readyN: 0, bcN: 0, weak: null };
const mid = { m: { opRate: 8, equityRate: 40, debtYears: 6 }, months: 3, snap: { score: 70, runway: 5 }, d: { fin: 3, cash: 1, ins: 1, pay: 0, obr: 0 }, val: 0, ai: 0, ready: null, readyN: 0, bcN: 1, weak: null, company: '山田製作所' };
const full = { m: { opRate: 8, equityRate: 40, debtYears: 6 }, months: 6, snap: { score: 70, runway: 5 }, d: { fin: 6, cash: 1, ins: 1, pay: 1, obr: 1 }, val: 1, ai: 1, ready: { score: 55 }, readyN: 4, bcN: 3, weak: { l: '自己資金', score: 25 }, company: '山田製作所', exit: { exit_type: 'buyer', target_year: 2028 }, after: { leader: 'self', readyN: 5 } };

// ---------------------------------------------------------------
// ① 順番と状態
// ---------------------------------------------------------------
{
  const { M } = make();
  is('道具は12（出口の設計・買った後に備えるは企業価値の次）', M.NAV.map(x => x.id), ['fin', 'cashsim', 'ins', 'pay', 'obr', 'val', 'exit', 'after', 'ready', 'bc', 'ai', 'bank']);
  ok('全部に なぜ今・分かること・次・行き先 がある', M.NAV.every(x => x.why && x.learn && x.next && x.sec && typeof x.ask === 'function'));
  is('任意は AI自動化診断と銀行提出パッケージ', M.NAV.filter(x => x.opt).map(x => x.id), ['ai', 'bank']);
  is('空なら全部「あと」（銀行は判定なし＝free）', M.NAV.map(x => M.state(x, empty)), ['todo', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo', 'todo', 'free']);
  is('途中：試算表と資金と保険は済、支払は未、条件は△', ['fin', 'cashsim', 'ins', 'pay', 'bc'].map(id => M.state(M.NAV.filter(x => x.id === id)[0], mid)), ['done', 'done', 'done', 'todo', 'part']);
  is('全部そろえば済', M.NAV.filter(x => x.done).map(x => M.state(x, full)).every(s => s === 'done'), true);
  is('試算表1か月分は△', M.state(M.NAV[0], Object.assign({}, empty, { months: 1 })), 'part');
}

// ---------------------------------------------------------------
// ② 一覧の描画
// ---------------------------------------------------------------
{
  const { M } = make();
  const h = M.nav(mid);
  ok('題', /🧭 継ナビくんのナビ ― この会社でやる順番/.test(h));
  is('行は12（出口の設計・買った後に備えるを含む）', (h.match(/→<\/span>\s*<\/div>/g) || []).length, 12);
  ok('「次はこれ」は最初の未了（支払予定の登録）', /支払予定の登録<span class="tag gold"[^>]*>次はこれ<\/span>/.test(h));
  is('「次はこれ」は1つだけ', (h.match(/次はこれ/g) || []).length, 1);
  ok('次にだけ「なぜ今」「分かること」が添う', /なぜ今：<\/b>資金繰りの見通しに、実際の支払日を乗せます/.test(h) && (h.match(/なぜ今：/g) || []).length === 1);
  ok('済んだ行は「見る」、未了は「開く」', /clNav\('cs-mreport'\)">見る →/.test(h) && /clNav\('cs-pay'\)">開く →/.test(h));
  ok('任意の札', /銀行提出パッケージ<span[^>]*>任意<\/span>/.test(h));
  const h0 = M.nav(empty);
  ok('空なら「次はこれ」は試算表', /試算表の取り込み（3か月分）<span class="tag gold"/.test(h0));
  const hf = M.nav(full);
  no('全部済めば「次はこれ」は無い', /次はこれ/.test(hf));
}

// ---------------------------------------------------------------
// ③ 見出しの下の案内と、継ナビくんへの頼みかた
// ---------------------------------------------------------------
{
  const { M, asked } = make();
  const st = M.NAV.filter(x => x.id === 'cashsim')[0];
  const before = M.strip(st, empty);
  ok('計算前は「なぜ今」「やると分かること」「終わったら」', /なぜ今：<\/b>手元資金が何か月もつかを数字で知ります/.test(before) && /やると分かること：<\/b>資金スコア/.test(before) && /終わったら 保険・固定費の棚卸しへ/.test(before));
  ok('計算前のボタンは「進め方を聞く」', /karteAsk\('cashsim'\)">進め方を聞く<\/button>/.test(before));
  const after = M.strip(st, mid);
  ok('計算後は「済んでいます」「次の一手」', /済んでいます。<\/b>分かったこと：資金スコア/.test(after) && /次の一手：<\/b>保険・固定費の棚卸しへ/.test(after));
  ok('計算後のボタンは「結果を継ナビくんと読む」', /karteAsk\('cashsim'\)">結果を継ナビくんと読む<\/button>/.test(after));
  //  頼みかた：数字を埋める
  M.render(mid); M.ask('cashsim');
  is('継ナビくんへの頼みは1回', asked.length, 1);
  ok('会社名と数字が入る', /担当顧客（山田製作所）について。/.test(asked[0]) && /資金スコア70点/.test(asked[0]) && /手元資金のもち5\.0か月/.test(asked[0]));
  no('◯◯（穴埋め）が残らない', /◯◯/.test(asked[0]));
  M.ask('fin');
  ok('試算表の頼みに営業利益率・自己資本比率・債務償還年数', /営業利益率8\.0%/.test(asked[1]) && /自己資本比率40\.0%/.test(asked[1]) && /債務償還年数6\.0年/.test(asked[1]));
  M.render(empty); M.ask('fin');
  ok('未取り込みなら進め方の頼み', /試算表の取り込みをこれから始めます（いま0か月分）/.test(asked[2]));
  M.render(full); M.ask('ready');
  ok('準備度の頼みに点と弱い軸', /買い手になる準備度が55点でした。弱い軸は「自己資金」/.test(asked[3]));
  M.ask('bc');
  ok('条件が揃えば案件の見かた', /買いたい条件（目的・業種か地域・予算）が揃いました/.test(asked[4]));
  //  描画：一覧と各見出しの下
  ok('一覧は cl-nav に', /🧭 継ナビくんのナビ/.test(M.els['cl-nav'].innerHTML));
  ok('各見出しの下に案内（10）', M.NAV.every(x => /🌱/.test((M.els['knav-' + x.id] || {}).innerHTML || '')));
  M.ask('nope');
  is('無い id は何もしない', asked.length, 5);
}

// ---------------------------------------------------------------
// ④ 置き場と読み込み
// ---------------------------------------------------------------
ok('一覧の置き場は台本の下', /id="cl-script"><\/div>'\s*\n\s*\+'<div id="cl-nav"><\/div>'/.test(SRC));
{
  const ids = ['fin', 'pay', 'cashsim', 'obr', 'val', 'ready', 'bc', 'ai', 'bank', 'ins'];
  ok('各道具の見出しの下に置き場', ids.every(id => new RegExp('id="knav-' + id + '"').test(SRC)));
  is('置き場は一つずつ', ids.map(id => (SRC.match(new RegExp('id="knav-' + id + '"', 'g')) || []).length), ids.map(() => 1));
  ok('資金繰りシミュレーターの見出しの直後（手元資金の申告ではない）', /資金繰りシミュレーター[^\n]*\n\s*\+'<div id="knav-cashsim"><\/div>'/.test(SRC));
  ok('保険の見出し（関数の中）の直後', /return '<div class="ph" id="cs-ins"[^\n]*\n\s*\+'<div id="knav-ins"><\/div>'/.test(SRC));
  const f = takeFn('loadClientScript');
  ok('企業価値とAI診断の有無を読む', /sb\.from\('valuation_snapshots'\)\.select\('ym'\)/.test(f) && /sb\.from\('ai_proposals'\)\.select\('id'\)/.test(f));
  ok('準備度の記録数と条件の記入数を持つ', /ctx\.readyN=Object\.keys\(ans\)\.length;/.test(f) && /ctx\.bcN=/.test(f));
  ok('台本のあとにナビを描く', /ctx\.weak=sc\.weak;\n\s*renderKarteNav\(ctx\);/.test(f));
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
