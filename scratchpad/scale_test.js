// =============================================================
// スケールの設計（大きくする道を選び、数字で追う）の試験
//   ・7つの道、主軸は一つ、道ごとの札
//   ・数字からの合図は目安。借入・出資・上場の可否を断定しない
//   ・経営者と担当パートナーが同じ表を見る
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const MANC = R('manual-customer.html'), MANP = R('manual-partner.html'), PITC = R('pitch-customer.html');
const SQL = R('supabase/migrations/20260917070000_scale_plans.sql');
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
function takeArr(name) { const i = SRC.indexOf('\n  var ' + name + '=['); const end = SRC.indexOf('\n  ];', i); return SRC.slice(i, end + 5); }
const base =
  'function esc(s){ return String(s==null?"":s).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];}); }' +
  'function nOr(v){ return (v==null||v==="")?null:Number(v); }' +
  'function jstDay(s){ return String(s||"").slice(0,10); }' +
  'function $(id){ return null; }' +
  'function exitFmt(v, u){ return (v==null||!isFinite(v))?"—":(Number(v).toLocaleString("ja-JP")+u); }' +
  'var SCALE={ scope:"c1", who:"customer", row:null, ctx:null, edit:{}, sqlOk:true };' +
  takeArr('SCALE_PATHS') + takeArr('SCALE_STATUS') + takeArr('SCALE_NUMS') + takeFn('scaleStatusName') + takeFn('scalePathOf') + takeFn('scaleSignals') +
  takeFn('scaleHtml') + takeFn('scaleRedraw') + takeFn('scaleMain') + takeFn('scalePick') + takeFn('scaleNote') + takeFn('scaleTarget');
const S = new Function(base + 'return {paths:SCALE_PATHS, st:SCALE_STATUS, nums:SCALE_NUMS, signals:scaleSignals, html:scaleHtml, main:scaleMain, pick:scalePick, note:scaleNote, target:scaleTarget, S:function(){return SCALE;}};')();

// ① 道・札・数字
{
  is('7つの道', S.paths.map((x) => x.k), ['deepen', 'pillar', 'buy', 'debt', 'equity', 'group', 'list']);
  ok('どの道にも、何か・向く状況・使う道具・行き先がある', S.paths.every((x) => x.what && x.fit && x.tools && /^sec-/.test(x.sec)));
  ok('行き先はぜんぶ経営者のメニューにある', S.paths.every((x) => SRC.indexOf("['" + x.sec + "','") > 0));
  is('札は4つ', S.st.map((x) => x[0]), ['consider', 'doing', 'done', 'skip']);
  is('見る数字は4つ', S.nums.map((x) => x.k), ['revY', 'opY', 'cashM', 'pillars']);
  ok('デット・エクイティの言い方', S.paths.some((x) => x.name === 'デットで加速') && S.paths.some((x) => x.name === 'エクイティで加速') && !S.paths.some((x) => /融資|出資で/.test(x.name)));
}
// ② 数字からの合図（目安。可否は断定しない）
{
  const lean = { opRate: 3.2, pillars: 1, cashM: 2.4, dscYears: 5, opY: 900, net: 500, eqGrowth: 5, plan: 'buyer' };
  const sg = S.signals(lean);
  ok('利益率5%未満→深める', /5%未満/.test((sg.deepen || []).join('')));
  ok('柱1本→柱を増やす', /柱が1本/.test((sg.pillar || []).join('')));
  ok('現預金2か月以上・買い手→M&Aで買う', /買い手になる準備度/.test((sg.buy || []).join('')));
  ok('債務償還年数7年未満→デットで加速', /返済原資に余裕/.test((sg.debt || []).join('')));
  ok('売り手プランには M&A で買うの合図を出さない', !S.signals(Object.assign({}, lean, { plan: 'seller' })).buy);
  const heavy = { opRate: 12, pillars: 3, cashM: 1, dscYears: 12, opY: 4200, net: 8000, eqGrowth: 30, plan: 'seller' };
  const sh = S.signals(heavy);
  ok('10年超→先に返済原資', /10年を超えています/.test((sh.debt || []).join('')) && /加速する前に/.test((sh.debt || []).join('')));
  ok('利益率と伸びが高い→エクイティ', /株を渡してでも/.test((sh.equity || []).join('')));
  ok('柱2本以上→グループ化', /持株会社の下に/.test((sh.group || []).join('')));
  ok('営業利益3,000万超・純資産プラス→上場（可否は J-Adviser）', /TOKYO PRO Market が視野/.test((sh.list || []).join('')) && /可否は J-Adviser の判断/.test((sh.list || []).join('')));
  is('数字が無ければ合図なし', Object.keys(S.signals({})).length, 0);
  no('合図に税額は出ない', /税額|相続税/.test(JSON.stringify(sg) + JSON.stringify(sh)));
}
// ③ 画面
{
  const ctx = { revY: 24000, opY: 900, opRate: 3.75, cashM: 2.4, dscYears: 5, pillars: 1, net: 500, eqGrowth: 5, plan: 'buyer', prof: { company_name: '◯◯商事' } };
  const h0 = S.html({ main: null, targets: {}, items: {} }, ctx, 'customer', true);
  ok('経営者には「パートナーと同じもの」', /担当パートナーと<b>同じもの<\/b>を見ています/.test(h0));
  is('主軸のボタンは7つ', (h0.match(/onclick="scaleMain\('/g) || []).length, 7);
  ok('合図のある道は主軸のボタンにも印', /🔧 いまの事業を深める<span class="tag gold"[^>]*>合図<\/span>/.test(h0));
  ok('見る数字の表（いま・目標・差）', /年商（直近12か月）/.test(h0) && /24,000万円/.test(h0) && /2\.4か月/.test(h0) && /1本/.test(h0));
  is('道ごとに4つの札', (h0.match(/onclick="scalePick\('/g) || []).length, 28);
  ok('使う道具は経営者なら押して移れる', /onclick="goSec\('sec-cash'\)">デットナビ・資金調達ロードマップ・銀行提出パッケージ →<\/span>/.test(h0));
  ok('可否は断定しないと書く', /借入・出資・上場の可否は金融機関・投資家・J-Adviser が決めます/.test(h0));
  const h1 = S.html({ main: 'debt', target_year: 2029, targets: { revY: 36000, opY: 2000 }, items: { debt: { status: 'doing', note: '公庫に相談中' }, list: { status: 'skip' } } }, ctx, 'partner', true);
  ok('パートナーには「経営者と同じもの」', /経営者の画面「スケールの設計」と<b>同じもの<\/b>です/.test(h1));
  ok('主軸の道に印と、向く状況', /<span class="tag" style="font-size:10px;background:var\(--navy\);color:#fff;">主軸<\/span>/.test(h1) && /返済原資（営業利益＋減価償却）に余裕がある／債務償還年数が短い/.test(h1));
  ok('目標との差（届いていなければ赤）', /color:#A9403D;font-weight:600;">\+12,000万円/.test(h1) && /\+1,100万円/.test(h1));
  ok('札とメモ', /取り組み中/.test(h1) && /公庫に相談中/.test(h1) && /scaleNote\('debt'/.test(h1));
  ok('パートナーには道具の名前だけ（リンクなし）', !/goSec\(/.test(h1) && /デットナビ・資金調達ロードマップ・銀行提出パッケージ/.test(h1));
  ok('保存と継ナビくん', /onclick="scaleSave\(\)"/.test(h1) && /onclick="scaleAsk\(\)"/.test(h1));
  ok('SQL 未実行の案内', /「スケールの設計」の SQL を実行してください/.test(S.html({ items: {} }, ctx, 'customer', false)));
  //  状態の動き
  S.main('debt'); is('主軸を選ぶ', S.S().edit.main, 'debt');
  S.main('debt'); is('もう一度押すと外れる', S.S().edit.main, null);
  S.pick('pillar', 'doing'); is('札を付ける', S.S().edit.items.pillar.status, 'doing');
  S.pick('pillar', 'doing'); ok('同じ札でもう一度押すと外れる', !S.S().edit.items.pillar);
  S.note('list', 'x'.repeat(400)); is('メモは300字まで', S.S().edit.items.list.note.length, 300);
  S.target('revY', '36,000'); is('目標は数字だけ残す', S.S().edit.targets.revY, 36000);
  //  継ナビくんへの頼み方
  const sa = takeFn('scaleAsk');
  ok('継ナビくん：3つに絞り、可否は断定せず、税額は出さない', /今四半期の一手を3つ/.test(sa) && /借入・出資・上場の可否や条件は断定せず/.test(sa) && /税額の計算はしないでください/.test(sa));
}
// ④ 置き場所・読み込み・絵
{
  ok('経営者のメニュー：出口の設計の次', /\['sec-exit','出口の設計'\],\['sec-scale','スケールの設計'\]\]/.test(SRC));
  ok('経営者の枠と、カルテの枠', /<div class="panel" id="sec-scale">/.test(SRC) && /<div id="my-scale">読み込み中\.\.\.<\/div>/.test(SRC) && /<div class="ph" id="cs-scale"/.test(SRC) && /<div id="cl-scale">読み込み中\.\.\.<\/div>/.test(SRC));
  ok('経営者の初期化で読む', /loadExitPlan\(ME,'customer'\); loadScalePlan\(ME,'customer'\);/.test(SRC));
  is('カルテを開くと読む（出口の設計と一緒に）', (SRC.match(/loadExitPlan\(custId,'partner'\); loadScalePlan\(custId,'partner'\);/g) || []).length, 2);
  ok('絵は右肩上がり', /'sec-scale':'growth'/.test(SRC) && /growth:'<path d="M3\.5 17\.5 9 12l3\.5 3\.5L20\.5 7"\/>/.test(SRC));
  const lp = takeFn('loadScalePlan');
  ok('数字は試算表12か月・案件・企業価値から', /from\('financial_entries'\)/.test(lp) && /from\('ma_deals'\)/.test(lp) && /from\('valuation_snapshots'\)/.test(lp) && /pillarsOf\(/.test(lp));
  ok('債務償還年数＝有利子負債÷（営業利益＋減価償却）×12', /ctx\.dscYears=\(debt>0 && ebY>0\)\?debt\/ebY:null;/.test(lp));
}
// ⑤ SQL・説明書・案内
{
  ok('表と RLS', /create table if not exists public\.scale_plans/.test(SQL) && /using \(public\.customer_may\(customer_id\)\)/.test(SQL) && /with check \(public\.customer_may\(customer_id\)\)/.test(SQL));
  ok('主軸は7つに限る', /check \(main in \('deepen','pillar','buy','debt','equity','group','list'\)\)/.test(SQL));
  no('税額の列は無い', /税額|tax/.test(SQL.replace('税額は持たない', '')));
  ok('経営者説明書：頁と表の行とメニュー', /data-t="スケールの設計"/.test(MANC) && /<th>スケールの設計<\/th>/.test(MANC) && /出口の設計／スケールの設計。買い手プランの方には/.test(MANC));
  ok('経営者説明書：目安であって可否ではない', /目安であって、可否の判断ではありません/.test(MANC));
  ok('パートナー説明書：頁と、12の道具には含めない', /data-t="スケールの設計"/.test(MANP) && /ナビの12の道具には含めません/.test(MANP) && /経営者に断定しないでください/.test(MANP));
  is('経営者説明書の写しのメニューに出る', (MANC.match(/スケールの設計<\/div>/g) || []).length, (MANC.match(/⇢<\/b>出口の設計<\/div>/g) || []).length);
  is('経営者向け資料の写しのメニューにも出る', (PITC.match(/スケールの設計<\/div>/g) || []).length, (PITC.match(/⇢<\/b>出口の設計<\/div>/g) || []).length);
  ok('継ナビくんの画面ガイド（経営者・パートナー）', /スケールの設計\(左メニュー。出口の設計の次\)=大きくする道を7つ/.test(SRC) && /その次に「スケールの設計」=大きくする道を7つ/.test(SRC));
}
// ⑥ 版
{
  const build = SRC.match(/var APP_BUILD='([^']+)'/)[1];
  is('版が揃う', [build, VER.build], ['20260926-01', '20260926-01']);
}
console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
