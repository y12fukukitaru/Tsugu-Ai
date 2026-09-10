// =============================================================
// ⑦ 柱の可視化の試験
//
//   「柱」＝本業の1本＋譲受でクロージング（stage 7）まで行った会社。
//   一か所（pillarsOf）で数え、5つの画面に同じ数を出す：
//     経営者の帯・経営者の「買い手になる」・パートナーのカルテ・
//     パートナーの顧客一覧・パートナーの帯
//
//  守りたいのは「数えかたが一つであること」。画面ごとに数えかたが
//  分かれると、経営者とパートナーで柱の本数が食い違う。
//  線引きは⑤のレベル判定（成約 hd = 譲受 かつ stage>=7）と同じ。
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const MANP = fs.readFileSync(__dirname + '/../manual-partner.html', 'utf8');
const MANC = fs.readFileSync(__dirname + '/../manual-customer.html', 'utf8');

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
  takeArr('MA_STAGES') + takeArr('MA_STAGES_BUY') + takeVar('PMI_STAGE') +
  takeFn('maStages') + takeFn('pillarsOf') + takeFn('pillarSub') + takeFn('pillarHtml');
const M = new Function(base + 'return {pillarsOf:pillarsOf,pillarSub:pillarSub,pillarHtml:pillarHtml,PMI_STAGE:PMI_STAGE};')();

// ---------------------------------------------------------------
// ① 数えかた
// ---------------------------------------------------------------
{
  const p = M.pillarsOf([]);
  is('案件なし＝本業の1本', [p.count, p.done, p.active, p.next], [1, 0, 0, null]);
  is('undefined でも落ちない', M.pillarsOf(undefined).count, 1);

  const p2 = M.pillarsOf([{ deal_type: '譲受', stage: 7 }, { deal_type: '譲受', stage: 8 }]);
  is('譲受でクロージング以降は柱に数える（7と8）', [p2.count, p2.done, p2.next], [3, 2, null]);

  const p3 = M.pillarsOf([{ deal_type: '譲渡', stage: 8 }]);
  is('譲渡（売った）は柱に数えない', [p3.count, p3.done, p3.active], [1, 0, 0]);

  const p4 = M.pillarsOf([{ deal_type: '譲受', stage: 6 }]);
  is('stage 6 はまだ柱ではない', [p4.count, p4.done, p4.active], [1, 0, 1]);
  is('次の1社の段階名は買い手の表から', p4.next.name, '最終契約');
  is('次の1社の進み具合', p4.next.prog, 75);

  const p5 = M.pillarsOf([{ deal_type: '譲受', stage: 2 }, { deal_type: '譲受', stage: 5 }, { deal_type: '譲受', stage: 7 }]);
  is('進行中が複数なら、最も進んだものを「次の1社」に', [p5.count, p5.active, p5.next.stage], [2, 2, 5]);

  is('stage が null なら 0 として扱う', M.pillarsOf([{ deal_type: '譲受', stage: null }]).next.stage, 0);
  is('PMI_STAGE は 7 のまま（⑤の hd と同じ線）', M.PMI_STAGE, 7);
}
//  ⑤のレベル判定の hd と同じ線引きであること（コード上で）
ok('レベル判定の hd は「stage>=7 かつ 譲受」', /\(d\.stage\|\|0\)>=7 && d\.deal_type==='譲受'\) hd\+\+/.test(SRC));
ok('pillarsOf も PMI_STAGE（7）と譲受で切る', /function pillarsOf[\s\S]{0,400}deal_type!=='譲受'[\s\S]{0,200}s>=PMI_STAGE/.test(SRC));

// ---------------------------------------------------------------
// ② 一言と絵
// ---------------------------------------------------------------
{
  is('本業だけの一言', M.pillarSub(M.pillarsOf([])), '本業の1本。次の1社へ');
  is('柱が増えた後の一言', M.pillarSub(M.pillarsOf([{ deal_type: '譲受', stage: 8 }])), '次の1社へ');
  is('進行中の一言', M.pillarSub(M.pillarsOf([{ deal_type: '譲受', stage: 3 }])), '次の1社：面談・交渉 38%');

  const h0 = M.pillarHtml(M.pillarsOf([]), 'me');
  ok('絵に本業の1本がある', /title="本業"/.test(h0));
  is('絵の本数（本業だけ）', (h0.match(/title="本業"|title="譲り受けた会社"/g) || []).length, 1);
  ok('本数の文字', /1本/.test(h0));
  ok('経営者向けは「買いたい条件」へ誘う', /「買いたい条件」から/.test(h0));

  const h1 = M.pillarHtml(M.pillarsOf([{ deal_type: '譲受', stage: 8 }, { deal_type: '譲受', stage: 4 }]), 'partner');
  is('絵の本数（本業＋1社）', (h1.match(/title="本業"|title="譲り受けた会社"/g) || []).length, 2);
  ok('進行中は点線の柱', /border:1\.5px dashed/.test(h1));
  ok('進行中の段階名が出る', /「基本合意」の段階（50%）/.test(h1));
  ok('増えた本数の文', /柱が1本増えました/.test(h1));
  ok('増えたら緑', /color:#27684A/.test(h1));
}

// ---------------------------------------------------------------
// ③ 5つの画面
// ---------------------------------------------------------------
//  経営者の帯
{
  const f = takeFn('loadDashHero');
  ok('帯は ma_deals を読む', /sb\.from\('ma_deals'\)\.select\('deal_type,stage'\)\.eq\('customer_id',SCOPE\)/.test(f));
  ok('帯の柱は pillarsOf で数える', /var pil=pillarsOf\(r\[6\]/.test(f));
  ok('帯に「柱」のチップ（行き先は買い手になる）', /chip\('柱', pil\.count\+'本'[^;]*'sec-ma', pillarSub\(pil\)\)/.test(f));
  //  新規ユーザーの判定は変えていない（案件の有無は初回カードに関係ない）
  ok('初回判定は変えていない', /var isNew = !fin\.length && !snap && !acts\.length && !note && !lastMsg;/.test(f));
}
//  経営者の「買い手になる」
{
  const f = takeFn('loadMyMa');
  ok('案件が無くても柱の絵を出す（早期 return の前）', /pb\.innerHTML=pillarHtml\(pillarsOf[\s\S]*if\(res\.error \|\| !\(res\.data\|\|\[\]\)\.length\)\{ box\.innerHTML=''; return; \}/.test(f));
  ok('置き場 my-pillar が「買いたい条件」の上にある', /id="my-pillar"><\/div>'\s*\n\s*\+'<div[^>]*>買いたい条件<\/div>'/.test(SRC));
  ok('起動時に loadMyMa が呼ばれる', /loadMyMa\(\); loadBuyCriteria\(ME,'bc'\);/.test(SRC));
}
//  パートナーのカルテ
{
  const f = takeFn('loadClientPillars');
  ok('カルテは同じ列を読む', /sb\.from\('ma_deals'\)\.select\('deal_type,stage'\)\.eq\('customer_id',custId\)/.test(f));
  ok('カルテも pillarsOf で数える', /pillarHtml\(pillarsOf\(res\.error\?\[\]:\(res\.data\|\|\[\]\)\),'partner'\)/.test(f));
  ok('置き場 cpil-box が「買いたい条件」の上にある', /id="cpil-box"><\/div>'\s*\n\s*\+'<div[^>]*>買いたい条件（経営者と共有/.test(SRC));
  ok('viewClient で呼ばれる', /loadBuyCriteria\(custId,'cbc'\); loadClientBuyInterests\(custId\); loadClientPillars\(custId\);/.test(SRC));
}
//  パートナーの顧客一覧（実際に描かせる）
{
  const f = takeFn('renderClientList');
  const els = {};
  const mod = new Function(
    base +
    'var CL_CACHE={clients:[{id:"a",email:"a@x",company_name:"A社",stage:1},{id:"b",email:"b@x",company_name:"B社",stage:1},{id:"c",email:"c@x",company_name:"C社",stage:1}],' +
    '  cnt:{},lastMsg:{},unread:{},' +
    '  maDeals:[{customer_id:"a",deal_type:"譲受",stage:8},{customer_id:"a",deal_type:"譲受",stage:3},{customer_id:"b",deal_type:"譲渡",stage:8},{customer_id:"c",deal_type:"譲受",stage:2}]};' +
    'var CL_FILTER="all"; var SUB_IDS={}; var STAGE_NAMES={1:"導入"};' +
    'var els=arguments[0]; function $(id){ return els[id]||(els[id]={value:"",innerHTML:""}); }' +
    'function escJ(s){return String(s||"");} function jstMin(){return "";}' +
    f + 'renderClientList(); return els["cl-list"].innerHTML;'
  );
  const html = mod(els);
  ok('A社：柱2本・次 38%（金）', /柱 2本・次 38%<\/span>/.test(html) && /tag gold">柱 2本/.test(html));
  ok('B社：譲渡は数えず柱1本（灰）', /tag gray">柱 1本<\/span>/.test(html));
  ok('C社：進行中は青', /tag blue">柱 1本・次 25%<\/span>/.test(html));
  is('全社に札が付く', (html.match(/>柱 \d本/g) || []).length, 3);
}
//  パートナーの帯
{
  const f = takeFn('loadClients');
  ok('帯の「増えた柱」は各社の done の合計', /var pilAdd=0; clients\.forEach\(function\(c\)\{ pilAdd\+=pillarsOf\(maDeals\.filter/.test(f));
  ok('帯に「増えた柱」チップ', /heroChip\('増えた柱', pilAdd\+'本', pilAdd\?'#27684A':'#94A2B6'\)/.test(f));
  ok('maDeals は帯より前で読んでいる', f.indexOf("var maDeals=[]") < f.indexOf('var pilAdd=0'));
}

// ---------------------------------------------------------------
// ④ 案内と説明書、版
// ---------------------------------------------------------------
ok('継ナビくんの案内に柱の絵がある', /買い手になる=上に「柱」の絵/.test(SRC));
ok('経営者の説明書', /<b>「柱」の絵<\/b>が出ます/.test(MANC));
ok('パートナーの説明書', /<b>「柱 N本」<\/b>の札/.test(MANP) && /「増えた柱」は、その合計/.test(MANP));
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
