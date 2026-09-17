// =============================================================
// 顧問料は2プランだけ、の試験
//   ・運営直接担当の一律 30,000円 が、どこにも残っていないこと
//   ・請求を立てる関数が一つだけで、プランで額を決めていること
//   ・過去の請求（種別 direct）は読めるままであること
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const MANA = R('manual-admin.html');
const SQL = R('supabase/migrations/20260916010000_direct_to_plan.sql');
const OLD = R('supabase/migrations/20260908010000_invoice_manual.sql');
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

// ① 画面：一律の額はもう無い
{
  no('料率の入力欄から消えている', /id="bl-direct"/.test(SRC));
  const ids = SRC.match(/var BL_RATE_IDS=\[[^\]]+\]/)[0];
  no('保存する設定からも消えている', ids.indexOf("'bl-direct'") >= 0);
  const rb = takeFn('renderAdmBilling');
  no('試算で一律の額を読まない', /blRate\('bl-direct'/.test(rb));
  //  額を決めるのはプランだけ
  ok('額はプランで決まる', /var base=\(planOf\(c\)==='seller'\)\?sellerFee:adv;/.test(rb));
  no('運営担当だけ別の額にする分岐は無い', /advGross\+=direct/.test(rb));
  //  担当が運営かどうかは、印としては残す（金額ではなく事実）
  ok('運営が直接担当かは印として持つ', /direct:!!\(c\.consultant_id && adminIds\[c\.consultant_id\]\)/.test(rb));
  ok('一覧にはプランの印と、運営の印', /planTag\(r\.c\)/.test(rb) && /運営が直接担当/.test(rb));
  no('「一律」という言い方は残さない', /運営直接担当・一律/.test(rb));
}
// ② 画面：過去の請求は読めるまま
{
  const kl = takeFn('invKindLabel');
  ok('種別 direct の名前は残す', /direct:'顧問料（運営直接・旧）'/.test(kl));
  ok('顧問料は advisory', /advisory:'顧問料'/.test(kl));
}
// ③ 請求を立てる案内
{
  ok('その月の1日のプランで決まると書く', /その月の1日に効いているプラン/.test(SRC));
  ok('運営が担当でも同じ額だと書く', /運営が直接担当している顧客も同じ額です/.test(SRC));
}
// ④ SQL
{
  //  いちばん効くのはここ。同じ名前の関数が二つあり、画面が呼ぶほうが
  //  プランを見ていなかった（売り手にも 45,000円 が立っていた）
  ok('呼ばれていない2引数の関数を消す', /drop function if exists public\.invoice_generate\(text, int\);/.test(SQL));
  ok('画面が呼ぶ3引数のほうを作り直す', /create or replace function public\.invoice_generate\(\s*\n?\s*p_period text, p_due_day int default 27, p_method text default 'bank'\)/.test(SQL));
  ok('額はプランから', /v_plan := public\.plan_effective\(r\.id, v_start\);/.test(SQL) && /v_ex\s+:= public\.plan_fee\(v_plan\);/.test(SQL));
  no('一律の額はもう読まない', /bl-direct'\), ''\)::numeric, 30000/.test(SQL));
  ok('種別は全員 advisory', /values\s*\n?\s*\(r\.id, p_period, 'advisory',/.test(SQL));
  ok('題はプランで分ける', /顧問料（売り手プラン）/.test(SQL) && /顧問料（買い手プラン）/.test(SQL));
  ok('集金方法は引き続き入れる', /due_on, method\)/.test(SQL) && /v_due, v_method\)/.test(SQL));
  ok('料金表から一律の設定を外す', /value = value - 'bl-direct'/.test(SQL));
  //  実行前に、値上がりする相手の数が分かること
  ok('確かめに、運営が直接担当の件数と、うち買い手の件数', /運営が直接担当/.test(SQL) && /うち買い手/.test(SQL));
  ok('関数が一つになったことを数える', /where n\.nspname='public' and p\.proname='invoice_generate'/.test(SQL));
  ok('実行方法が書いてある', /SQL Editor に貼り付けて Run/.test(SQL));
  //  古い migration は履歴として残す（書き換えない）
  ok('古い migration はそのまま残っている', /v_direct := coalesce/.test(OLD));
}
// ⑤ 説明書
{
  no('料率の表から一律の行が消えている', /<tr><th>運営直接担当<\/th>/.test(MANA));
  ok('2プランだけだと書く', /顧問料はこの2つだけ/.test(MANA));
  ok('廃止したことと、その理由', /「運営直接担当 30,000円・一律」は廃止しました/.test(MANA) && /本当の反応が読めなくなる/.test(MANA));
  ok('値上がりする相手がいることを書く', /30,000円 でお立てしていた買い手プランの顧客は、次にお立てになる月から 45,000円/.test(MANA));
  ok('過去の請求は書き換えないと書く', /過去の請求は書き換えません/.test(MANA));
  no('顧客別の説明に一律30,000円は残さない', /運営直接担当30,000円/.test(MANA));
  //  切替の入口（今回いただいた質問そのもの）
  const pages = (MANA.match(/data-t="([^"]+)"/g) || []).map((s) => s.slice(8, -1));
  ok('「プランを切り替える」の頁がある', pages.indexOf('プランを切り替える') >= 0);
  ok('二つの入口を両方書く', /🔁 顧問プランの切替依頼/.test(MANA) && /「プラン」のプルダウン/.test(MANA));
  ok('効くのは翌月と書く', /翌月の請求から/.test(MANA));
  ok('差額は自動では立たないと書く', /初期導入費の差額は自動では立ちません/.test(MANA));
  //  章が飛び飛びだと目次が割れる
  const gs = (MANA.match(/data-g="([^"]+)"/g) || []).map((s) => s.slice(8, -1));
  const seen = []; const dup = [];
  gs.forEach((g, i) => { if (g !== gs[i - 1]) { if (seen.indexOf(g) >= 0) dup.push(g); seen.push(g); } });
  is('章は続けて並んでいる', dup, []);
}
// ⑥ 版
{
  const build = SRC.match(/var APP_BUILD='([^']+)'/)[1];
  is('版が揃う', [build, VER.build], ['20260917-12', '20260917-12']);
}
console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
