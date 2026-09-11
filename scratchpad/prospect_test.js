// =============================================================
// 顧客ゼロのアソシエイト向け「はじめの30日」と、見込み客の型の試験
//
//   ・ダッシュボード：顧客が0社のときだけ「はじめの30日 ― 最初の1社まで」
//     4段（研修=自動／10人=手動／3人=手動／1社=自動）
//   ・営業ツール：3つの型（誰に・どこで・見分け方・最初の一言・見せるもの・
//     ゴールへの筋）、断り文句5つ、Yesの形
//   ・継ナビくん：型ごとの商談練習、質問ガイドに「見込み客」
//   ・レベル条件の文言（成約の道）を研修・説明書で揃える
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
const base =
  'function esc(s){ return String(s==null?"":s).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];}); }' +
  takeArr('PROSPECT_PERSONAS') + takeArr('PROSPECT_OBJECTIONS') + takeArr('PROSPECT_YES') + takeArr('ASSOC_STEPS') +
  takeFn('assocKey') + takeFn('assocLoad') + takeFn('assocTick') + takeFn('assocDone') +
  takeFn('renderAssocStart') + takeFn('prospectPractice') + takeFn('prospectSectionHtml');

function make(opts) {
  opts = opts || {};
  const els = {}; const asked = [];
  const store = {};
  const mod = new Function(
    'var ME="me-1"; var CL_CACHE={clients:[]};' +
    'var localStorage={ getItem:function(k){ return arguments[0] in this.s ? this.s[k] : null; }, setItem:function(k,v){ this.s[k]=String(v); }, s:arguments[2] };' +
    'function trIsComplete(){ return ' + (opts.trained ? 'true' : 'false') + '; }' +
    'function knvAsk(q){ arguments[0]; asked.push(q); } var asked=arguments[1];' +
    'var els=arguments[0]; function $(id){ return els[id]||(els[id]={innerHTML:""}); }' +
    base +
    'return { render:function(nc){ CL_CACHE.clients=new Array(nc); renderAssocStart(nc); return els["assoc-start"].innerHTML; },' +
    '  tick:assocTick, practice:prospectPractice, section:prospectSectionHtml, P:PROSPECT_PERSONAS, O:PROSPECT_OBJECTIONS, Y:PROSPECT_YES, S:ASSOC_STEPS };'
  );
  return { M: mod(els, asked, store), asked, store };
}

// ---------------------------------------------------------------
// ① 型の中身
// ---------------------------------------------------------------
{
  const { M } = make();
  is('型は3つ', M.P.map(p => p.name), ['堅い本業、厚い現預金', '隣の廃業を見ている', '通帳の残高が気になる']);
  ok('どの型も6つの欄が埋まっている', M.P.every(p => p.who && p.where && p.signs.length === 3 && p.first && p.show && p.link));
  ok('最初の一言はすべて問い（？で終わる）', M.P.every(p => /？$/.test(p.first)));
  ok('どの型も「既契約者」か「顧問先」の中に見込み客がいると言う', M.P.every(p => /既契約者|顧問先|取引先/.test(p.where)));
  ok('ゴールへの筋に「買い手」「柱」「余力」「現金」のいずれか', M.P.every(p => /買い手|柱|余力|現金/.test(p.link)));
  is('断り文句は5つ', M.O.map(o => o.q), ['顧問税理士がいるから', '今は忙しい', 'M&Aは考えていない', '費用に見合うのか', 'AIは信用できない']);
  ok('費用の返しは「金額の約束をしない」', /増える金額の約束はしません/.test(M.O[3].a));
  ok('M&Aの返しは「売る話ではない」', /売る話ではありません/.test(M.O[2].a));
  ok('AIの返しは「判断は担当の私」', /判断と説明は担当の私/.test(M.O[4].a));
  ok('税理士の返しは「役割がぶつからない」', /役割がぶつかりません/.test(M.O[0].a));
  is('Yesの形は4手', M.Y.length, 4);
  ok('Yesの形に「90日で土台」「料金表のとおり」「顧客管理に登録」', /90日で土台/.test(M.Y[0]) && /料金表のとおり/.test(M.Y[1]) && /顧客管理/.test(M.Y[2]));
  //  金額や成果の断定が入っていない
  const all = JSON.stringify([M.P, M.O, M.Y]);
  no('「必ず」「保証」の語が無い', /必ず|保証し/.test(all));
  no('具体的な金額を書いていない', /[0-9０-９]+万円|[0-9０-９]+円/.test(all));
}

// ---------------------------------------------------------------
// ② はじめの30日（ダッシュボード）
// ---------------------------------------------------------------
{
  const { M, store } = make({ trained: false });
  const h0 = M.render(0);
  ok('顧客0社なら出る', /はじめの30日 ― 最初の1社まで/.test(h0));
  ok('0 / 4 から', /0 \/ 4/.test(h0));
  is('手動の印は2つ（10人・3人）', (h0.match(/type="checkbox"/g) || []).length, 2);
  ok('研修は「自動で確認」', /研修を修了する（Lv\.1 アソシエイト）<span[^>]*>自動で確認/.test(h0));
  ok('未了の段には行き先', /onclick="goSec\('sec-growth'\)">研修へ →/.test(h0) && /onclick="goSec\('sec-clients'\)">顧客管理へ →/.test(h0));
  ok('型を見るボタンと練習ボタン', /見込み客の3つの型を見る/.test(h0) && /prospectPractice\(0\)/.test(h0));
  is('顧客が1社でもいれば消える', M.render(1), '');
  //  印を付けると進む（この端末に保存）
  M.tick('p10', true);
  const h1 = M.render(0);
  ok('10人に印が付く', /checked onchange="assocTick\('p10'/.test(h1));
  ok('1 / 4 に進む', /1 \/ 4/.test(h1));
  ok('保存先は本人ごとの鍵', !!store['tsugu_assoc_me-1']);
  const t = make({ trained: true });
  ok('研修修了は自動で✓', /background:#27684A[^>]*>✓<\/span><div[^>]*text-decoration:line-through;">研修を修了する/.test(t.M.render(0)));
}

// ---------------------------------------------------------------
// ③ 営業ツールの型、練習、案内
// ---------------------------------------------------------------
{
  const { M, asked } = make();
  const h = M.section();
  is('3つの型の枠', (h.match(/id="persona-/g) || []).length, 3);
  ok('最初の一言が出る', /最初の一言：<\/b>「社長、いま「会社の値段を出せ」と言われたら、出せますか？」/.test(h));
  ok('断り文句はたたんである', /<details[^>]*><summary[^>]*>よくある断り文句と、返しかた（5つ）<\/summary>/.test(h));
  ok('Yesの形もたたんである', /<summary[^>]*>「Yes」の形/.test(h));
  is('型ごとに練習ボタン', (h.match(/onclick="prospectPractice\(\d\)"/g) || []).length, 3);
  M.practice(1);
  is('練習は継ナビくんに1回頼む', asked.length, 1);
  ok('練習の頼みかたに型名・最初の一言・断り文句', /「隣の廃業を見ている」の経営者役/.test(asked[0]) && /私の最初の一言「あの会社を引き受けるとしたら/.test(asked[0]) && /断り文句「今は忙しい」/.test(asked[0]));
  ok('営業ツールの画面に型の枠がある（診断の前）', /id="prospect-box">'\+prospectSectionHtml\(\)\+'<\/div>'\s*\n\s*\+'<div id="sales-stage">/.test(SRC));
  ok('ダッシュボードに置き場がある（今日やることの前）', /id="assoc-start"><\/div>'\s*\n\s*\+'<div class="panel" id="sec-todo">/.test(SRC));
  ok('顧客一覧の読み込みで描く', /renderTodos\(\);\n    renderAssocStart\(clients\.length\);/.test(SRC));
  ok('質問ガイドに「見込み客」の項', /\{t:'🧲 見込み客', subs:\[/.test(SRC) && /\['見込み客の見つけ方'/.test(SRC) && /\['断り文句への返し'/.test(SRC) && /\['最初の1社を決める'/.test(SRC));
}

// ---------------------------------------------------------------
// ④ レベル条件と研修の向き（文言の整合）
// ---------------------------------------------------------------
ok('研修 t1-2 の Lv.3 は「または成約1件」', /lv\(3,'エグゼクティブ','顧問契約10件 または 顧問先の成約1件'/.test(SRC));
ok('研修 t1-2 の Lv.4 は「または成約3件」', /lv\(4,'プレミアム','顧問契約20件 または 成約3件'/.test(SRC));
ok('研修 t1-2 に「成約」の行と場面', /tgRow\('成約　＝ 顧問先が譲り受けてクロージングまで行った件数'/.test(SRC) && /chip:'成約', focus:'agg2'/.test(SRC));
ok('PG_LEVELS の条件と研修の文言が同じ趣旨', /cond:'顧問契約10件、または顧問先の成約1件'/.test(SRC) && /cond:'顧問契約20件、または顧問先の成約3件'/.test(SRC));
no('研修に「私たちが接するのはほとんど譲る側」が残っていない', /私たちが日常的に接するのは、ほとんどが譲る側です/.test(SRC));
ok('M&A章の第3は「顧問先が買い手になる」を先に言う', /desc:'私たちのゴールは「顧問先が買い手になる」ことです。買い手が何を見ているかを知ると/.test(SRC));
ok('説明書のレベル条件も「または成約」', /顧問契約10件<br>または成約1件/.test(MANP) && /顧問契約20件<br>または成約3件/.test(MANP));
no('説明書に「ランクは顧問契約数だけ」が残っていない', /ランクは顧問契約数だけで上がります/.test(MANP));
ok('説明書の営業ツールの行に3つの型と「はじめの30日」', /<b>見込み客の3つの型<\/b>/.test(MANP) && /「はじめの30日 ― 最初の1社まで」/.test(MANP));
no('説明書に「左メニューの10画面」が残っていない', /左メニューの10画面/.test(MANP));
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
