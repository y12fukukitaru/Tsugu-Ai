// =============================================================
// 顧問プラン（買い手／売り手）・出口の設計・M&A の優遇（画面側）の試験
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html'), SQL = R('supabase/migrations/20260912000000_plan_exit.sql');
const MANA = R('manual-admin.html'), MANP = R('manual-partner.html'), MANC = R('manual-customer.html'), PITC = R('pitch-customer.html');
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
const base =
  'function esc(s){ return String(s==null?"":s).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];}); }' +
  'function nOr(v){ return (v==null||v==="")?null:Number(v); }' +
  'function jstDay(s){ return String(s||"").slice(0,10); }' +
  'var EP_STD_FEE=45000; var EP_SELLER_FEE=30000; var ME="me"; var SHINDAN_CHECKS=[["deputy","右腕"],["manual","手順"],["sales_dep","偏り"],["successor","方向性"],["shares","株主"],["will","遺言"],["contracts","契約書"],["offbalance","簿外"],["guarantee","保証"]];' +
  'var EXIT={ scope:"c1", who:"customer", row:null, ctx:null, edit:{} };' +
  takeObj('PLANS') + takeVar('PLAN_RATES') + takeFn('planOf') + takeFn('planName') + takeFn('planFee') + takeFn('planTag') + takeFn('faPerk') +
  takeArr('EXIT_TYPES') + takeObj('EXIT_TARGETS') + takeObj('EXIT_CHECKS') + takeFn('exitCheckLabel') + takeFn('exitTypeOf') +
  takeFn('holdingSignals') + takeFn('exitFmt') + takeFn('exitHtml') +
  takeArr('JOURNEY_Q') + takeArr('JOURNEY_Q_SELLER') + takeFn('journeyPhase') + takeFn('karteOpt');
const M = new Function(base + 'return {PLANS:PLANS, planOf:planOf, planName:planName, planFee:planFee, planTag:planTag, faPerk:faPerk, types:EXIT_TYPES, targets:EXIT_TARGETS, checks:EXIT_CHECKS, signals:holdingSignals, html:exitHtml, phase:journeyPhase, QS:JOURNEY_Q_SELLER, Q:JOURNEY_Q, karteOpt:karteOpt};')();

// ① プラン
{
  is('既定は買い手', [M.planOf(null), M.planOf({}), M.planOf({ plan: 'seller' })], ['buyer', 'buyer', 'seller']);
  is('名前と月額', [M.planName('buyer'), M.planName('seller'), M.planFee('buyer'), M.planFee('seller')], ['買い手プラン（成長）', '売り手プラン（譲渡準備）', 45000, 30000]);
  ok('印', /gold[^>]*>売り手プラン/.test(M.planTag({ plan: 'seller' })) && /blue[^>]*>買い手プラン/.test(M.planTag({})));
}
// ② M&A の優遇
{
  is('1年未満は対象外', M.faPerk('2026-01-01', '2026-09-12'), { years: 0, rate: 0, eligible: false });
  is('1年で10%', M.faPerk('2025-09-01', '2026-09-12'), { years: 1, rate: 10, eligible: true });
  is('3年で30%', M.faPerk('2023-06-01', '2026-09-12'), { years: 3, rate: 30, eligible: true });
  is('7年でも上限50%', M.faPerk('2019-01-01', '2026-09-12'), { years: 7, rate: 50, eligible: true });
  is('日付が無ければ対象外', M.faPerk(null, '2026-09-12'), { years: 0, rate: 0, eligible: false });
}
// ③ 出口の設計
{
  is('出口は5つ', M.types.map((t) => t.k), ['sell', 'family', 'employee', 'close', 'buyer']);
  ok('全出口に目標と整えることがある', M.types.every((t) => (M.targets[t.k] || []).length >= 2 && (M.checks[t.k] || []).length >= 3));
  const ctx = { eq: 12000, eqGrowth: 25, net: 8000, debt: 3000, cash: 5000, opY: 1500, cashM: 2.1, ready: 60, ans: { deputy: true }, prof: { plan: 'seller', created_at: '2024-01-01' } };
  is('持株会社の合図：親族承継で4つ', M.signals(ctx, { exit_type: 'family' }).length, 4);
  is('譲渡なら合図なし', M.signals(ctx, { exit_type: 'sell' }).length, 0);
  is('保証と株主が整っていれば2つ', M.signals(Object.assign({}, ctx, { ans: { guarantee: true, shares: true } }), { exit_type: 'employee' }).length, 2);
  ok('合図に税額は出ない', !/相続税|税額/.test(M.signals(ctx, { exit_type: 'family' }).join('')));
  const h0 = M.html({ exit_type: null, targets: {} }, ctx, 'customer');
  ok('プランと優遇の箱', /いまの顧問プラン/.test(h0) && /売り手プラン（譲渡準備）/.test(h0) && /FA報酬 20% 割引・最低報酬なし/.test(h0));
  ok('経営者には「担当パートナーへ」', /プランの切替は担当パートナーにお申し出ください/.test(h0) && !/planRequest/.test(h0));
  is('出口のボタンは5つ', (h0.match(/onclick="exitPick\('/g) || []).length, 5);
  ok('出口を選ぶ前は案内だけ', /いちばん近いものを選んでください/.test(h0) && !/id="ex-year"/.test(h0));
  const h1 = M.html({ exit_type: 'sell', target_year: 2029, targets: { price: 15000, debt: 1000 }, holding_flag: false }, ctx, 'partner');
  ok('目標の年と数字の表', /id="ex-year"/.test(h1) && /目標譲渡価格/.test(h1) && /12,000万円/.test(h1) && /\+3,000万円/.test(h1));
  ok('借入は下げる目標（達していれば緑）', /color:#A9403D;font-weight:600;">-2,000万円/.test(h1));
  ok('整えること（承継チェックの残り）', /この出口で整えること（残り 5）/.test(h1) && /手順/.test(h1) && !/右腕/.test(h1));
  ok('パートナーには切替の依頼ボタン', /planRequest\('c1','buyer'\)/.test(h1) && /買い手プラン（成長） への切替を運営に依頼/.test(h1));
  ok('保存と継ナビくん', /onclick="exitSave\(\)"/.test(h1) && /onclick="exitAsk\(\)"/.test(h1));
  const h2 = M.html({ exit_type: 'family', target_year: 2030, targets: {}, holding_flag: true, holding_note: '税理士と相談中' }, ctx, 'partner');
  ok('持株会社の合図と検討中', /合図あり/.test(h2) && /1億円を超えています/.test(h2) && /checked/.test(h2) && /税理士と相談中/.test(h2) && /税額を計算しません/.test(h2));
  const h3 = M.html({ exit_type: 'sell', targets: {} }, Object.assign({}, ctx, { pending: { to_plan: 'buyer' } }), 'partner');
  ok('依頼中は依頼ボタンを出さない', /切替を依頼中/.test(h3) && !/planRequest/.test(h3));
  const h4 = M.html({ exit_type: null, targets: {} }, { sqlOk: false, prof: {} }, 'customer');
  ok('SQL 未実行の案内', /SQL を実行してください/.test(h4));
}
// ④ 伴走の1年（売り手）・カルテのナビ・面談台本
{
  is('売り手の第3・第4', [M.QS[2].title, M.QS[3].title], ['会社の値段を上げる', '出口の条件を決める']);
  is('土台と現金は共通', [M.QS[0], M.QS[1]], [M.Q[0], M.Q[1]]);
  is('journeyPhase はプランで題が変わる', [M.phase({ mi: 7 }, 'seller').title, M.phase({ mi: 7 }).title, M.phase({ mi: 7 }, 'seller').plan], ['会社の値段を上げる', '買い手の余力を測る', 'seller']);
  is('売り手では準備度・買いたい条件が任意', [M.karteOpt({ id: 'ready' }, { plan: 'seller' }), M.karteOpt({ id: 'bc' }, { plan: 'seller' }), M.karteOpt({ id: 'ready' }, { plan: 'buyer' }), M.karteOpt({ id: 'ai', opt: true }, { plan: 'buyer' })], [true, true, false, true]);
  const ms = takeFn('meetingScript');
  ok('台本は売り手の問い', /var seller=\(ctx\.plan==='seller'\);/.test(ms) && /いま会社を譲るとしたら、いくらなら納得できますか/.test(ms) && /譲渡の時期は、いつごろをお考えですか/.test(ms));
  ok('売り手には買い手の問いを出さない', /if\(!seller && ph\.qi>=2 && bcN<3\)/.test(ms) && /if\(seller && ph\.qi>=2 && !\(ctx\.exit&&ctx\.exit\.exit_type\)\)/.test(ms));
  const knav = takeArr('KARTE_NAV');
  ok('カルテのナビに出口の設計', /id:'exit', sec:'cs-exit'/.test(knav) && knav.indexOf("id:'exit'") < knav.indexOf("id:'ready'"));
  const lcs = takeFn('loadClientScript');
  ok('カルテの文脈にプランと出口', /select\('created_at,onboard_start,company_name,plan'\)/.test(lcs) && /from\('exit_plans'\)/.test(lcs) && /ctx\.plan=planOf\(prof\);/.test(lcs));
}
// ⑤ 配線
{
  ok('経営者のメニュー：出口の設計は全員、買い手になるは買い手だけ', /\['sec-exit','出口の設計'\]\]\.concat\(planOf\(window\.__prof\)==='buyer'\?\[\['sec-ma','買い手になる'\]\]:\[\]\)/.test(SRC));
  ok('経営者の画面：出口の設計の枠と、買い手だけの「買い手になる」', /id="sec-exit"/.test(SRC) && /id="my-exit"/.test(SRC) && /\+\(planOf\(prof\)==='buyer' \? \(''/.test(SRC));
  ok('起動時に出口を読む', /loadSurvey\('customer'\); loadExitPlan\(ME,'customer'\); knvInit\(\);/.test(SRC));
  ok('カルテ：出口の設計の見出し・案内・枠と読み込み', /id="cs-exit"/.test(SRC) && /id="knav-exit"/.test(SRC) && /id="cl-exit"/.test(SRC) && /loadShindan\(custId\);\n    loadExitPlan\(custId,'partner'\);/.test(SRC));
  ok('顧客一覧にプランの印', /tags\+=planTag\(c\);/.test(SRC) && /select\('id,email,company_name,role,stage,created_at,plan'\)/.test(SRC));
  const cs = takeFn('ctSend');
  ok('契約書はプランを選ぶ（金額はプランから）', /var feeEl=\$\(pfx\+'-plan'\);/.test(cs) && /plan=v; fee=planFee\(v\);/.test(cs) && /row\.plan=plan;/.test(cs));
  ok('契約の送信画面：プランの選択肢2つ', /id="ctp-plan"/.test(SRC) && /<option value="buyer">/.test(SRC) && /<option value="seller">/.test(SRC) && !/id="ctp-fee"/.test(SRC));
  ok('月額は my_billing_rates から', /await loadPlanRates\(\);/.test(takeFn('loadMyContracts')) && /rpc\('my_billing_rates'\)/.test(takeFn('loadPlanRates')));
  ok('運営：概要に売り手の月額、保存対象', /id="bl-seller"/.test(SRC) && /'bl-seller'\]/.test(SRC.match(/var BL_RATE_IDS=\[[^\]]+\]/)[0]));
  const rb = takeFn('renderAdmBilling');
  ok('MRR はプランごとの月額', /var base=\(planOf\(c\)==='seller'\)\?sellerFee:adv;/.test(rb) && /売り手 '\+custs\.filter/.test(rb));
  const rc = takeFn('renderAdmCust');
  ok('運営の顧客一覧：プランの印と直接切替', /planTag\(u\)/.test(rc) && /admPlanSet\(\\''\+u\.id\+'\\',this\.value\)/.test(rc));
  ok('運営：切替依頼の枠と読み込み', /id="adm-plans"/.test(SRC) && /loadAdmSurvey\(\);\n    loadAdmPlans\(\);/.test(SRC));
  const ap = takeFn('admPlanSet');
  ok('切替は確認してから RPC', /confirm\(/.test(ap) && /rpc\('plan_set'/.test(ap) && /翌月の請求から/.test(ap));
  ok('依頼は RPC（理由つき）', /rpc\('plan_request'/.test(takeFn('planRequest')) && /rpc\('plan_reject'/.test(takeFn('admPlanReject')));
  ok('出口の保存は upsert', /from\('exit_plans'\)\.upsert\(row\)/.test(takeFn('exitSave')));
}
// ⑥ SQL・説明書・版
{
  ok('SQL：列・表・関数・契約書', /add column if not exists plan      text not null default 'buyer'/.test(SQL) && /create table if not exists public\.plan_requests/.test(SQL) && /create table if not exists public\.exit_plans/.test(SQL));
  ok('SQL：切替は運営だけ・翌月1日', /運営のみが切り替えられます/.test(SQL) && /nxt date := \(date_trunc\('month', d\) \+ interval '1 month'\)::date;/.test(SQL));
  ok('SQL：請求はその月に効くプラン', /v_plan := public\.plan_effective\(r\.id, v_start\);/.test(SQL) && /顧問料（売り手プラン）/.test(SQL));
  ok('SQL：契約書に {{プラン}}・優遇・利益相反', /replace\(final_body, '\{\{プラン\}\}'/.test(SQL) && /最低報酬額を設けず/.test(SQL) && /利益相反/.test(SQL) && /if position\('プラン' in cur\.body\) > 0 then return; end if;/.test(SQL));
  ok('SQL：登録時にプランを引き継ぐ', /update public\.profiles set plan = o\.plan, plan_from = null, plan_prev = null/.test(SQL));
  ok('SQL：出口の設計は相続税評価額を持たない', /相続税評価額は持たない/.test(SQL) && !/inheritance|相続税評価額 integer/.test(SQL));
  ok('SQL の期待値', /期待値：列=4、表=2、関数=6、契約書にプラン=1/.test(SQL));
  ok('pitch：2つのプランと優遇', /買い手プラン（成長）45,000円/.test(PITC) && /売り手プラン（譲渡準備）30,000円/.test(PITC) && /最大50%/.test(PITC));
  ok('経営者説明書：プラン・優遇・出口の設計', /2つのプラン/.test(MANC) && /<h3>出口の設計<\/h3>/.test(MANC) && /持株会社の検討/.test(MANC));
  ok('パートナー説明書：プランを選ぶ・切替依頼・出口の設計', /金額ではなく<b>プラン<\/b>を選びます/.test(MANP) && /運営に依頼し、運営が切り替えます/.test(MANP) && /<h3>出口の設計<\/h3>/.test(MANP));
  ok('運営説明書：2プラン・切替は運営だけ・契約書の条文', /顧問料（2プラン）/.test(MANA) && /切替は運営だけ/.test(MANA) && /第2条の3/.test(MANA));
  ok('税額は出さないと明記', /税額は計算しません/.test(MANC) && /税額を計算しません/.test(SRC));
  const build = SRC.match(/var APP_BUILD='([^']+)'/)[1];
  is('版が揃う', [build, VER.build], ['20260912-02', '20260912-02']);
}
console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
