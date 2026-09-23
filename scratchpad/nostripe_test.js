// =============================================================
// ① 成長ロードマップ：折り返しても箱の左右・上下が揃うこと（格子で置く）
// ② Stripe（カード決済）をやめたこと
//    ・決済リンクの登録と一覧が無い
//    ・入金は記録の一本（Stripe自動記録は無い）
//    ・経営者のお支払いは請求ごとの銀行振込・口座振替
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const MANA = R('manual-admin.html'), MANC = R('manual-customer.html'), MANP = R('manual-partner.html');
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

// ① 成長ロードマップの並び
{
  const rm = takeFn('loadAdmRoadmap');
  ok('格子で置く（flex-wrap をやめた）', /var h='<div class="rm-grid">'/.test(rm) && !/display:flex;align-items:stretch;gap:6px;flex-wrap:wrap;/.test(rm));
  ok('箱は .rm-card、矢印は .rm-ar', /<div class="rm-card" onclick="goSec/.test(rm) && /var ar='<div class="rm-ar">→<\/div>';/.test(rm));
  ok('札は下端に寄せる（.rm-st）', /var st = '<div class="rm-st">'/.test(rm) && /達成<\/span>/.test(rm) && /現在地<\/span>/.test(rm) && /今後<\/span>/.test(rm));
  no('箱に flex:1 1 130px の指定は残っていない', /flex:1 1 130px;min-width:130px;background:'\+\(isCur/.test(rm));
  //  CSS：列は全段で同じ幅。狭いときは矢印を消す（消えた格子項目は枠を取らない）
  ok('広いときは 6箱＋5矢印', /\.rm-grid\{display:grid;grid-template-columns:repeat\(5,1fr auto\) 1fr;gap:6px;align-items:stretch;\}/.test(SRC));
  ok('箱は縦に積む', /\.rm-card\{display:flex;flex-direction:column;/.test(SRC));
  ok('札は margin-top:auto で下端', /\.rm-st\{margin-top:auto;/.test(SRC));
  ok('中くらいの画面は3列・矢印なし', /@media\(max-width:1100px\)\{ \.rm-grid\{grid-template-columns:repeat\(3,1fr\);\} \.rm-ar\{display:none;\} \}/.test(SRC));
  ok('スマホは2列', /@media\(max-width:700px\)\{ \.rm-grid\{grid-template-columns:repeat\(2,1fr\);\} \}/.test(SRC));
  //  段は6つのまま（TOKYO PRO Market → グロース）
  is('箱は6つ', (rm.match(/\+ card\('/g) || []).length, 6);
  is('矢印は5つ', (rm.match(/\n      \+ ar\n/g) || []).length, 5);
  ok('1 の説明から決済の名前を外す', /card\('1','サービス基盤','本番運用・請求と入金の記録'/.test(rm));
}
// ② Stripe をやめた（画面）
{
  no('画面に Stripe の文字は無い', /stripe/i.test(SRC));
  //  決済リンクの登録・一覧・関数が無い
  ['bl-tb-links', 'bl-tab-links', 'bl-new-url', 'bl-links-list', 'admAddBillingLink', 'admDelBillingLink', 'loadBillingAdminLinks', 'blLinkFilter', 'blAudChanged', 'billing_links', 'billpay-links']
    .forEach((k) => no('残っていない: ' + k, SRC.indexOf(k) >= 0));
  ok('課金のタブは6つ', /\['overview','partners','customers','payments','revenue','invoices'\]\.forEach/.test(SRC));
  is('タブのボタンも6つ', (SRC.match(/onclick="blShowTab\(\\'/g) || []).length, 6);
  //  入金は記録の一本。payment_events（Webhookの受け皿）は読まない
  no('payment_events は読まない', /payment_events/.test(SRC));
  const lp = takeFn('loadAdmPayEvents');
  ok('読むのは revenue_entries だけ', /from\('revenue_entries'\)/.test(lp) && !/from\('payment_events'\)/.test(lp));
  no('記録種別の絞り込みは無い', /bl-pay-src/.test(SRC));
  ok('合計の内訳（自動／手動）は無い', !/sumS/.test(lp) && !/sumM/.test(lp) && /var sum=0;/.test(lp));
  ok('絞り込みは年月・対象・区分', /bl-pay-month/.test(SRC) && /bl-pay-aud/.test(SRC) && /bl-pay-cat/.test(SRC));
  const lr = takeFn('loadAdmRevenue');
  ok('年間実績も記録した入金だけ', /from\('revenue_entries'\)/.test(lr) && !/from\('payment_events'\)/.test(lr));
  //  経営者・パートナーのお支払い
  no('カード決済の履歴の枠は無い', /billpay-history/.test(SRC));
  ok('経営者には請求ごとの振込・口座振替と書く', /請求ごとに、銀行振込または口座振替<\/b>でお願いしています/.test(SRC) && /カードでのお支払いはありません。<\/b><\/div>'/.test(SRC));
  no('お支払いを読む関数は無くなった', /loadBillingPay|loadMyPayEvents/.test(SRC));
  //  年の選択肢を作る処理は、読み込みの並びに移した（明細の年が空にならないこと）
  is('起動時に poInitDefaults を呼ぶ（経営者・パートナー）', (SRC.match(/poInitDefaults\(\); /g) || []).length, 2);
  ok('禁止行為の正規ルートから決済代行の名前を外す', /正規ルート（当社の請求）外での報酬受領/.test(SRC));
}
// ③ 説明書
{
  no('運営説明書に Stripe の頁は無い', /data-t="決済リンク"/.test(MANA));
  ok('運営説明書は6つのタブ', /<h2>6つのタブと、お金の流れ<\/h2>/.test(MANA) && /<td>6つのタブ。MRR試算/.test(MANA));
  ok('運営説明書：カード決済はありませんと書く', /<h3>カード決済はありません<\/h3>/.test(MANA) && /決済代行（Stripe）は使いません/.test(MANA));
  ok('運営説明書：絞り込みは3軸', /絞り込みは<b>年月／対象（顧客・パートナー）／区分<\/b>の3軸/.test(MANA));
  is('運営説明書に残る Stripe は「使いません」の一か所だけ', (MANA.match(/Stripe/g) || []).length, 1);
  no('経営者説明書に Stripe は無い', /[Ss]tripe/.test(MANC));
  no('パートナー説明書に Stripe は無い', /[Ss]tripe/.test(MANP));
}
// ④ 版
{
  const build = SRC.match(/var APP_BUILD='([^']+)'/)[1];
  is('版が揃う', [build, VER.build], ['20260923-04', '20260923-04']);
}
console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
