// =============================================================
// カルテ「今月の面談台本」の試験
//
//   その会社の数字（財務・資金繰り・柱・準備度・買いたい条件）と
//   伴走の1年の節目から、見せる数字3つ・問い3つ・買い手の基盤への
//   つながりを組み立てる。組み立ては meetingScript（純粋な関数）。
//
//  守りたいのは「数字が語っていることが先頭に来ること」と
//  「節目ごとに見せる数字が変わること」。
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
function takeVar(name) {
  const re = new RegExp('\\n  var ' + name + '\\s*=', 'g');
  let m, last = null;
  while ((m = re.exec(SRC)) !== null) last = m;
  const from = SRC.indexOf('=', last.index) + 1;
  const nl = SRC.indexOf('\n', from);
  return 'var ' + name + '=' + SRC.slice(from, nl).trim();
}
const base =
  'function esc(s){ return String(s==null?"":s).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];}); }' +
  takeFn('finFmt') + takeArr('JOURNEY_Q') + takeFn('journeyYM') + takeFn('journeyPhase') +
  takeFn('meetingScript') + takeFn('meetingScriptHtml');
const M = new Function(base + 'var asked=[]; function knvAsk(q){ asked.push(q); } var MSCRIPT_LAST=null;' + takeFn('meetingScriptAsk') +
  'return {script:meetingScript, html:meetingScriptHtml, ask:function(sc){ MSCRIPT_LAST=sc; meetingScriptAsk("c1"); return asked; }};')();

const ready = { score: 40, axes: [{ k: 'cash', l: '自己資金', score: 25 }, { k: 'debt', l: '借入余力', score: 50 }, { k: 'team', l: '経営陣の余裕', score: 60 }, { k: 'pmi', l: 'PMI体制', score: null }, { k: 'aim', l: '目的の明確さ', score: 33 }] };

// ---------------------------------------------------------------
// ① 節目ごとに見せる数字が変わる
// ---------------------------------------------------------------
{
  const s1 = M.script({ pos: { mi: 0 }, months: 3, m: { opRate: 8, debtYears: 6, cashMonths: 2.5 }, snap: { score: 70, runway: 5 }, pil: { count: 1, done: 0, next: null }, ready: ready, bc: {} });
  is('第1：月次データ・資金のもち・現預金月商倍率', s1.numbers.map(x => x.l), ['月次データ', '手元資金のもち', '現預金の月商倍率']);
  is('第1の問いは資料と気になるお金', s1.questions[0], '試算表は毎月、税理士の先生からいつ届きますか？');
  ok('第1のつながりは「第2で現金を増やす」', /第2の節目で「現金を増やす」/.test(s1.link));
  const s2 = M.script({ pos: { mi: 4 }, months: 6, m: { opRate: 8, debtYears: 6, cashMonths: 2.5 }, snap: { score: 70, runway: 5 }, pil: { count: 1, done: 0, next: null }, ready: ready, bc: {} });
  is('第2：資金のもち・営業利益率・現預金月商倍率', s2.numbers.map(x => x.l), ['手元資金のもち', '営業利益率', '現預金の月商倍率']);
  ok('第2のつながりは「自己資金」「借入余力」', /「自己資金」「借入余力」/.test(s2.link));
  const s3 = M.script({ pos: { mi: 7 }, months: 6, m: { opRate: 8, debtYears: 6, cashMonths: 2.5 }, snap: { score: 70, runway: 5 }, pil: { count: 1, done: 0, next: null }, ready: ready, bc: { purpose: 'x' } });
  is('第3：債務償還年数・準備度・柱', s3.numbers.map(x => x.l), ['債務償還年数', '買い手になる準備度', '柱']);
  ok('第3の準備度は弱い軸を添える（null は除く）', /いちばん弱い軸は「自己資金」（25）/.test(s3.numbers[1].why));
  ok('第3の問いに弱い軸と買いたい条件', /どんな会社なら引き受けたいですか/.test(s3.questions.join('')) && /準備度でいちばん弱いのは「自己資金」/.test(s3.questions.join('')));
  ok('第3のつながりに弱い軸を課題に', /弱い軸「自己資金」を上げる一手を、課題に登録しましょう/.test(s3.link));
  const s4 = M.script({ pos: { mi: 10 }, months: 6, m: { opRate: 8, debtYears: 6, cashMonths: 2.5 }, snap: { score: 70, runway: 5 }, pil: { count: 2, done: 1, next: { name: '基本合意', prog: 50, stage: 4 } }, ready: ready, bc: { purpose: 'x', industries: 'y', budget_man: 3000 } });
  is('第4：準備度・柱・買いたい条件', s4.numbers.map(x => x.l), ['買い手になる準備度', '柱', '買いたい条件']);
  is('買いたい条件が揃えば「案件を見る番」', s4.numbers[2].why, '業種・地域・予算が揃っています。案件を見る番');
  ok('次の1社が止まっていれば先頭の問い', /次の1社は「基本合意」で止まっています/.test(s4.questions[0]));
  ok('第4のつながりは「柱が1本増える周回」', /柱が1本増える周回の入口/.test(s4.link));
  is('問いは3つまで', [s1.questions.length, s2.questions.length, s3.questions.length, s4.questions.length], [3, 3, 3, 3]);
}

// ---------------------------------------------------------------
// ② 数字が語っていることが先頭に来る
// ---------------------------------------------------------------
{
  const s = M.script({ pos: { mi: 7 }, months: 6, m: { opRate: 3, debtYears: 14, cashMonths: 0.8 }, snap: { score: 30, runway: 1.5 }, pil: { count: 1, done: 0, next: null }, ready: null, bc: null });
  is('資金のもちが3か月未満なら節目に関係なく先頭', s.numbers[0].l, '手元資金のもち');
  ok('資金の一言は「最優先」', /3か月を切っています。今月はここが最優先/.test(s.numbers[0].why));
  is('先頭の問いは来月の支払', s.questions[0], '来月の支払で、いちばん大きいものは何ですか？');
  ok('営業利益率5%未満の問い（値上げ）が入る', /値上げを最後にしたのはいつですか/.test(s.questions.join('')));
  ok('債務償還年数10年超の問い（銀行）が入る', /メインバンクとは、次の借入の話をしていますか/.test(s.questions.join('')));
  ok('債務償還年数の一言は「余地が狭い」', /10年を超えています。新しい借入の余地が狭い/.test(s.numbers.filter(x => x.l === '債務償還年数')[0].why));
  const s0 = M.script({ pos: { mi: 0 }, months: 0, m: {}, snap: null, pil: { count: 1, done: 0, next: null }, ready: null, bc: null });
  is('データが無ければ 月次データ・資金・柱', s0.numbers.map(x => x.l), ['月次データ', '手元資金のもち', '柱']);
  is('月次ゼロの一言', s0.numbers[0].why, 'まず試算表3か月分をお預かりするところから');
  is('月次ゼロなら先頭の問いは資料', s0.questions[0], '試算表（直近3か月分）と保険証券を、いつお預かりできますか？');
  is('未診断は「未診断」', s0.numbers[1].v, '未診断');
  is('準備度が未記録でも落ちない', M.script({ pos: { mi: 7 }, months: 3, m: {}, snap: null, pil: { count: 1, done: 0, next: null }, ready: null, bc: null }).numbers[1].v, '未記録');
  is('空の ctx でも落ちない', M.script({}).numbers.length, 3);
  //  土台が残ったまま第2に入ると、先頭の問いは土台の残り
  const sr = M.script({ pos: { mi: 4 }, remain: ['1年の道筋が決まる'], months: 3, m: { opRate: 8, debtYears: 6, cashMonths: 2.5 }, snap: { score: 70, runway: 5 }, pil: { count: 1, done: 0, next: null }, ready: null, bc: null });
  is('土台の残りが先頭の問い', sr.questions[0], '土台の「1年の道筋が決まる」がまだです。今月それを整えるのに、何をお預かりすればよいですか？');
  ok('つながりにも「並行して進めます」', /土台の残り（1年の道筋が決まる）も並行して進めます/.test(sr.link));
  no('第1のあいだは土台の残りを問いに出さない（土台の帯が担う）', /土台の「/.test(M.script({ pos: { mi: 1 }, remain: ['1年の道筋が決まる'], months: 3, m: {}, snap: null, pil: { count: 1, done: 0, next: null } }).questions.join('')));
}

// ---------------------------------------------------------------
// ③ 描画と継ナビくんへの渡しかた
// ---------------------------------------------------------------
{
  const sc = M.script({ pos: { mi: 7 }, months: 6, m: { opRate: 8, debtYears: 6, cashMonths: 2.5 }, snap: { score: 70, runway: 5 }, pil: { count: 1, done: 0, next: null }, ready: ready, bc: {} });
  const h = M.html(sc, 'c1');
  ok('題と節目', /📋 今月の面談台本/.test(h) && /第3の節目「買い手の余力を測る」/.test(h));
  is('見せる数字は3行（開くボタン付き）', (h.match(/開く →<\/span>/g) || []).length, 3);
  ok('数字の行き先はカルテの見出し', /clNav\('cs-bank'\)/.test(h) && /clNav\('cs-shindan'\)/.test(h) && /clNav\('cs-mna'\)/.test(h));
  is('問いは3つの番号つき', (h.match(/<li>/g) || []).length, 3);
  ok('買い手の基盤への一文', /<b>買い手の基盤へ：<\/b>/.test(h));
  ok('継ナビくんに仕上げてもらうボタン', /onclick="meetingScriptAsk\('c1'\)"/.test(h));
  sc.company = '山田製作所';
  const asked = M.ask(sc);
  is('継ナビくんへの頼みは1回', asked.length, 1);
  ok('頼みに会社名・節目・数字・問い・ねらい', /担当顧客（山田製作所）/.test(asked[0]) && /第3の節目/.test(asked[0]) && /債務償還年数=6\.0年/.test(asked[0]) && /問い：/.test(asked[0]) && /ねらい：/.test(asked[0]));
  no('頼みに◯◯（穴埋め）が残らない', /◯◯/.test(asked[0]));
  ok('30分の流れを頼む', /30分の面談の流れ/.test(asked[0]));
}

// ---------------------------------------------------------------
// ④ 置き場、定型作業、案内、説明書、版
// ---------------------------------------------------------------
ok('カルテの「やること」の下に置き場', /id="cl-todo-body">読み込み中\.\.\.<\/div>'\s*\n\s*\+'<div id="cl-script"><\/div>'/.test(SRC));
ok('viewClient で読む', /loadClientTodo\(custId\);\n    loadClientScript\(custId\);/.test(SRC));
{
  const f = takeFn('loadClientScript');
  ok('準備度は SHINDAN を差し替えて数え、必ず戻す', /var keep=SHINDAN;[\s\S]*SHINDAN=keep;/.test(f));
  ok('柱は pillarsOf で数える', /ctx\.pil=pillarsOf\(/.test(f));
  ok('節目は契約の翌月起点', /ctx\.pos=journeyPos\(journeyStart\(prof\|\|\{\}\)\);/.test(f));
  ok('土台の残りを取ってナビと台本に渡す', /ctx\.remain=ob90Remain\(ob90Judge\(ctx\.d\)\);/.test(f) && /renderKarteNav\(ctx\);/.test(f));
}
{
  const f = takeFn('loadClientTodo');
  ok('3か月ごとに準備度の記録', /clCheckRow\(sig\.ready90, '買い手になる準備度の記録（90日以内）'/.test(f));
  ok('3か月ごとに買いたい条件の見直し', /clCheckRow\(sig\.bc90, '買いたい条件の見直し（90日以内）'/.test(f));
  ok('判定は updated_at が90日以内', /sig\.ready90=!!\(d\(13\)\[0\]&&within\(d\(13\)\[0\]\.updated_at,90\)\);/.test(f) && /sig\.bc90=!!\(d\(14\)\[0\]&&within\(d\(14\)\[0\]\.updated_at,90\)\);/.test(f));
  ok('未了の数に入る', /q:\(sig\.cash90\?0:1\)\+\(sig\.ins90\?0:1\)\+\(sig\.ai90\?0:1\)\+\(sig\.ready90\?0:1\)\+\(sig\.bc90\?0:1\)/.test(f));
  ok('読む表が2つ増えた', /sb\.from\('succession_checks'\)\.select\('updated_at'\)/.test(f) && /sb\.from\('buy_criteria'\)\.select\('updated_at'\)/.test(f));
}
ok('質問ガイドに「今月の面談」', /\{t:'📋 今月の面談', subs:\[/.test(SRC) && /\['今月の面談で何を話すか'/.test(SRC) && /\['数字の説明のしかた'/.test(SRC));
ok('説明書に台本の頁', /<h2>カルテの「今月の面談台本」― 数字→問い→買い手の基盤へ<\/h2>/.test(MANP) && /買い手になる準備度の記録<\/b>と<b>買いたい条件の見直し<\/b>/.test(MANP));
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
