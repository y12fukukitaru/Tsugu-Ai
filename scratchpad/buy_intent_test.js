// =============================================================
// ⑥ 経営者が「買う意思」を表明する一手の試験
//
//   ・買いたい条件（buy_criteria）：経営者本人とパートナーが同じ書式で書く
//   ・関心を出す（market_interests）：Tsugime の案件に経営者が自分で出す
//   ・出した関心が、パートナーの朝の便りに載る
//
//  守りたいのは「同名の関数を上書きしていないこと」。loadClientInterests は
//  自動化の関心を出す別物が先にあり、同じ名前で定義すると後のほうが勝って
//  元の画面が壊れる。名前を分けたことを機械で見張る。
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
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
  let m, last = null;
  while ((m = re.exec(SRC)) !== null) last = m;
  if (!last) throw new Error('見つかりません: ' + name);
  const end = SRC.indexOf('\n  }\n', last.index);
  if (end < 0) throw new Error('終わりが見つかりません: ' + name);
  return SRC.slice(last.index, end + 4);
}
function takeVar(name) {
  const re = new RegExp('\\n  var ' + name + '\\s*=', 'g');
  let m, last = null;
  while ((m = re.exec(SRC)) !== null) last = m;
  if (!last) throw new Error('見つかりません: var ' + name);
  const from = SRC.indexOf('=', last.index) + 1;
  const nl = SRC.indexOf('\n', from);
  return 'var ' + name + '=' + SRC.slice(from, nl).trim();
}
function countDefs(name) { return (SRC.match(new RegExp('function ' + name + '\\(', 'g')) || []).length; }

//  素の esc / escA を本体から
const helpers = takeFn('esc') + takeFn('escA') +
  'function jstDay(s){ return String(s).slice(0,10); }';

// ---------------------------------------------------------------
// ① 名前の衝突
// ---------------------------------------------------------------
is('loadClientInterests は元の1つだけ', countDefs('loadClientInterests'), 1);
is('loadClientBuyInterests は1つ', countDefs('loadClientBuyInterests'), 1);
is('loadBuyCriteria は1つ', countDefs('loadBuyCriteria'), 1);
is('saveBuyCriteria は1つ', countDefs('saveBuyCriteria'), 1);
is('sendInterest は1つ', countDefs('sendInterest'), 1);
ok('元の loadClientInterests は自動化の関心のまま',
   /function loadClientInterests\(custId\)\{\s*\n\s*var box=\$\('cl-interest'\)/.test(SRC));

// ---------------------------------------------------------------
// ② 買いたい条件の書式
// ---------------------------------------------------------------
const bc = new Function(
  helpers + takeVar('BC_PURPOSES') + takeFn('bcFormHtml') +
  'return { html: bcFormHtml, purposes: BC_PURPOSES };'
)();
{
  const h = bc.html('cid-1', 'bc', { industries: '製造業', region: '関東', size_note: '年商1〜3億円', budget_man: 5000, purpose: 'エリア拡大', memo: 'メモ', updated_at: '2026-09-10T00:00:00Z' });
  ok('業種が入る', /id="bc-ind"[^>]*value="製造業"/.test(h));
  ok('地域が入る', /id="bc-region"[^>]*value="関東"/.test(h));
  ok('規模が入る', /id="bc-size"[^>]*value="年商1〜3億円"/.test(h));
  ok('予算が入る', /id="bc-budget"[^>]*value="5000"/.test(h));
  ok('目的が選ばれている', /<option selected>エリア拡大<\/option>/.test(h));
  ok('メモが入る', /id="bc-memo"[^>]*value="メモ"/.test(h));
  //  描画後のHTMLなので、ソースの \' は ' になっている
  ok('保存ボタンが顧客IDと接頭辞を持つ', /saveBuyCriteria\('cid-1','bc'\)/.test(h));
  ok('最終更新が出る', /最終更新 2026-09-10/.test(h));
}
{
  const h = bc.html('cid-2', 'cbc', {});
  ok('空でも落ちない', h.length > 0);
  ok('カルテ用の接頭辞で id が変わる', /id="cbc-ind"/.test(h) && !/id="bc-ind"/.test(h));
  no('予算が空なら value は空', /id="cbc-budget"[^>]*value="[^"]+"/.test(h));
  no('最終更新は出ない', /最終更新/.test(h));
}
{
  //  入力値に " や < が入っても壊れない
  const h = bc.html('c', 'bc', { industries: 'a"b<c>', memo: "x'y" });
  ok('業種の " が属性を壊さない', /value="a&quot;b&lt;c&gt;"/.test(h));
  ok("メモの ' が属性を壊さない", /value="x&#39;y"/.test(h));
}
is('目的の選択肢は5つ', bc.purposes.length, 5);

// ---------------------------------------------------------------
// ③ 保存：行の組み立て
// ---------------------------------------------------------------
async function runSave(fields, pfx) {
  const calls = [];
  const dom = {};
  Object.keys(fields).forEach(k => { dom[pfx + '-' + k] = { value: fields[k] }; });
  dom[pfx + '-msg'] = { style: {}, textContent: '' };
  const mod = new Function(
    'calls', 'dom',
    'var ME="me-1";' +
    'function $(id){ return dom[id]||null; }' +
    'var sb={ from:function(t){ return { upsert:function(row,opt){ calls.push({t,row,opt}); return Promise.resolve({error:null}); } }; } };' +
    takeFn('saveBuyCriteria') +
    'return saveBuyCriteria;'
  )(calls, dom);
  await mod('cust-9', pfx);
  return { calls, msg: dom[pfx + '-msg'].textContent };
}
(async () => {
  const r = await runSave({ ind: ' 製造業 ', region: '', size: '年商1億', budget: '5000', purpose: 'その他', memo: '' }, 'bc');
  is('upsert 先は buy_criteria', r.calls[0].t, 'buy_criteria');
  is('customer_id が入る', r.calls[0].row.customer_id, 'cust-9');
  is('前後の空白を落とす', r.calls[0].row.industries, '製造業');
  is('空は null', r.calls[0].row.region, null);
  is('予算は数', r.calls[0].row.budget_man, 5000);
  is('updated_by は本人', r.calls[0].row.updated_by, 'me-1');
  is('customer_id で衝突を解く', r.calls[0].opt.onConflict, 'customer_id');
  ok('経営者には「担当パートナーに届く」と言う', /担当パートナーに届きます/.test(r.msg));
  const r2 = await runSave({ ind: 'x', region: '', size: '', budget: '', purpose: 'その他', memo: '' }, 'cbc');
  is('予算が空なら null', r2.calls[0].row.budget_man, null);
  ok('パートナーには「経営者の画面にも出る」と言う', /経営者の画面にも出ます/.test(r2.msg));

  // ---------------------------------------------------------------
  // ④ 関心を出す
  // ---------------------------------------------------------------
  function runInterest(insertResult, msgText) {
    const state = { rendered: 0, MK_INT: null, out: '' };
    const dom = { 'mk-msg-L1': { value: msgText }, 'mk-int-L1': { set innerHTML(v) { state.out = v; } } };
    const mod = new Function(
      'state', 'dom', 'insertResult',
      'var ME="me-1"; var MK_INT={};' +
      'function $(id){ return dom[id]||null; }' +
      'function esc(s){ return String(s); }' +
      'function renderMarket(){ state.rendered++; state.MK_INT=Object.assign({},MK_INT); }' +
      'var sb={ from:function(){ return { insert:function(row){ state.row=row; return Promise.resolve(insertResult); } }; } };' +
      takeFn('sendInterest') +
      'return sendInterest;'
    )(state, dom, insertResult);
    return mod('L1').then(() => state);
  }
  return Promise.all([
    runInterest({ error: null }, ' 詳しく聞きたい '),
    runInterest({ error: { message: 'duplicate key value violates unique constraint' } }, ''),
    runInterest({ error: { message: 'new row violates row-level security policy' } }, ''),
  ]).then(([okc, dup, err]) => {
    is('送った行に listing_id', okc.row.listing_id, 'L1');
    is('送った行に from_id', okc.row.from_id, 'me-1');
    is('ひとことは空白を落として入る', okc.row.message, '詳しく聞きたい');
    ok('送れたら描き直す', okc.rendered === 1 && okc.MK_INT.L1 === 1);
    ok('二度押しでも「出した」状態に描き直す', dup.rendered === 1 && dup.MK_INT.L1 === 1);
    ok('二度押しはエラー表示しない', dup.out === '');
    ok('権限エラーは赤字で出す', /送れませんでした/.test(err.out) && err.rendered === 0);
    is('ひとことが空なら null', dup.row.message, null);

    // ---------------------------------------------------------------
    // ⑤ 案件カードの見え方
    // ---------------------------------------------------------------
    const rm = new Function(
      'MK_CACHE', 'MK_INT', 'box',
      'var MK_FILTER="all";' +
      'function $(){ return box; }' +
      'function esc(s){ return String(s==null?"":s); }' +
      'function mkSideLabel(){ return "譲渡（売り手）"; } function mkKindLabel(){ return "M&A"; } function mkAmount(){ return "—"; }' +
      takeFn('renderMarket') +
      'renderMarket(); return box.innerHTML;'
    );
    const row = { id: 'L1', title: '製造業を譲渡', side: 'raise', kind: 'mna', industry: '製造', anonymous: true };
    const notYet = rm([row], {}, { innerHTML: '' });
    ok('まだなら「関心を出す」ボタン', /onclick="sendInterest\('L1'\)">関心を出す</.test(notYet));
    ok('ひとことの入力欄がある', /id="mk-msg-L1"/.test(notYet));
    no('古い「メッセージで担当に」の案内が残っていない', /この案件が気になる場合は「メッセージ」/.test(notYet));
    const done = rm([row], { L1: 1 }, { innerHTML: '' });
    ok('出したら「関心を出しました」', /関心を出しました/.test(done));
    no('出したらボタンは消える', /関心を出す</.test(done));

    // ---------------------------------------------------------------
    // ⑥ 朝の便り
    // ---------------------------------------------------------------
    const a = SRC.indexOf("    (CL_CACHE.interests||[]).forEach(function(x){");
    ok('朝の便りに関心の節がある', a > 0);
    const b = SRC.indexOf('\n    });', a);
    const snippet = SRC.slice(a, b + 8);
    function todoTags(daysAgo) {
      const tags = [];
      const now = new Date('2026-09-10T12:00:00Z');
      const created = new Date(now.getTime() - daysAgo * 86400000).toISOString();
      new Function('CL_CACHE', 'now', 'add', snippet)(
        { interests: [{ from_id: 'c1', listing_id: 'L1', created_at: created }] }, now,
        (cid, score, html) => tags.push({ cid, score, html }));
      return tags;
    }
    is('今日出した関心は載る', todoTags(0).length, 1);
    ok('今日は「今日」と出る', /今日/.test(todoTags(0)[0].html));
    ok('金色の札', /tag gold/.test(todoTags(3)[0].html));
    ok('橋渡しを促す', /橋渡し/.test(todoTags(3)[0].html));
    is('顧客に紐づく', todoTags(3)[0].cid, 'c1');
    is('重さは返信待ち（100〜）より下、未読（80）より下、課題期日（56〜）より上', todoTags(3)[0].score, 72);
    is('14日は載る', todoTags(14).length, 1);
    is('15日は載らない（古い関心を引きずらない）', todoTags(15).length, 0);

    // ---------------------------------------------------------------
    // ⑦ つなぎこみ
    // ---------------------------------------------------------------
    ok('経営者の読み込みに買いたい条件が入っている', /loadMyMa\(\); loadBuyCriteria\(ME,'bc'\); loadMyPdca\(\);/.test(SRC));
    ok('経営者パネルに買いたい条件の枠がある', /id="bc-box"/.test(SRC));
    ok('Tsugime の読み込みで自分の関心を先に取る', /await loadMyInterests\(\);\s*\n\s*renderMarket\(\);/.test(SRC));
    ok('カルテに買いたい条件の枠がある', /id="cbc-box"/.test(SRC));
    ok('カルテに関心の枠がある', /id="cbc-int"/.test(SRC));
    ok('カルテを開いたら両方読む', /loadBuyCriteria\(custId,'cbc'\); loadClientBuyInterests\(custId\);/.test(SRC));
    ok('パートナーの控えに関心が入る', /interests:interests,pdca:pdcaItems/.test(SRC));
    ok('関心の取得は表が無くても落ちない（try で包む）', /try\{\s*\n\s*var mi=await sb\.from\('market_interests'\)/.test(SRC));
    ok('継ナビくんの案内に「買いたい条件」', /買い手になる=「買いたい条件」/.test(SRC));
    ok('継ナビくんの案内に「関心を出す」', /「関心を出す」ボタンでご本人が関心を出せる/.test(SRC));
    ok('説明書にも両方', /「買いたい条件」/.test(MANC) && /「関心を出す」/.test(MANC));

    // ---------------------------------------------------------------
    // ⑧ 版と移行ファイル
    // ---------------------------------------------------------------
    const bld = /var APP_BUILD='([^']+)';/.exec(SRC);
    const v = JSON.parse(fs.readFileSync(__dirname + '/../version.json', 'utf8'));
    ok('APP_BUILD と version.json が同じ', bld && bld[1] === v.build);
    const mig = fs.readFileSync(__dirname + '/../supabase/migrations/20260911000000_buy_criteria.sql', 'utf8');
    ok('移行に customer_may がある', /create or replace function public\.customer_may/.test(mig));
    ok('移行の判定は chat_att_may と同じ中身', /select public\.chat_att_may\(p_customer\)/.test(mig));
    ok('関心は一意', /market_interests_once/.test(mig));
    ok('関心は公開中の他社案件にだけ', /l\.status = 'open'\s*\n\s*and l\.owner_id <> auth\.uid\(\)/.test(mig));

    console.log('試験 ' + n + '件');
    if (bad.length) {
      console.log('\n合わないもの ' + bad.length + '件:');
      bad.forEach(b => console.log('  ✗ ' + b.name + '\n      出た: ' + b.got + '\n      欲しい: ' + b.want));
      process.exit(1);
    }
    console.log('ぜんぶ通りました。');
  });
})().catch(e => { console.error('試験が途中で落ちました:', e); process.exit(1); });
