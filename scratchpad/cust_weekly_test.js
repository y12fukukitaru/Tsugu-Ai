// =============================================================
// 経営者に届くのは週に一度の便り。「毎朝の今日の一手」はパートナー宛
//   agent-heartbeat が経営者に出すのは weekly_brief・meeting_eve・survey で、
//   毎日の便りは無い。文面をそちらに揃えたことを見る
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const HB = R('supabase/functions/agent-heartbeat/index.ts');
const MANC = R('manual-customer.html'), MANP = R('manual-partner.html');
const PITC = R('pitch-customer.html'), PITG = R('pitch-general.html'), PITB = R('pitch-bank.html');
const VER = JSON.parse(R('version.json'));
let n = 0, bad = [];
function is(name, got, want) { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) bad.push({ name, got: g, want: w }); }
function ok(name, cond) { is(name, !!cond, true); }
function no(name, cond) { is(name, !!cond, false); }

// ① 仕組みのほうを確かめる（文面の根拠）
{
  ok('毎朝の便りはパートナー宛', /user_id: partnerId,\s*\n\s*kind: "daily_brief",/.test(HB));
  ok('経営者に出すのは週の便り', /user_id: c\.id, kind: "weekly_brief",/.test(HB));
  ok('経営者宛のもう一つは面談の前日', /user_id: m\.customer_id, kind: "meeting_eve",/.test(HB));
  no('経営者宛の daily_brief は無い', /user_id: c\.id, kind: "daily_brief"|user_id: m\.customer_id, kind: "daily_brief"/.test(HB));
  ok('メールの見出しも週の便り', /eyebrow: "✦ 継ナビくんから、今週のお便り",/.test(HB));
}

// ② 経営者向けの文面に「毎朝」を残さない
{
  [['経営者説明書', MANC], ['経営者向け資料', PITC], ['一般向け資料', PITG], ['銀行向け資料', PITB]].forEach(([w, s]) => {
    no(w + '：「毎朝」が残っていない', /毎朝/.test(s));
    no(w + '：「今日の一手」が残っていない', /今日の一手/.test(s));
  });
}

// ③ 週の便りとして書き直せている
{
  ok('説明書：便りの行', /<tr><th>毎週月曜の朝｜今週のひとこと<\/th>/.test(MANC));
  ok('説明書：お知らせタブの先頭', /メール・LINEで届いたものと同じ内容が、<b>「お知らせ」タブの先頭<\/b>にあります/.test(MANC));
  ok('説明書：翌週に入れ替わる', /その週のうちは同じ場所で読み返せます。まとめて畳むときは<b>「すべて既読」<\/b>。翌週には新しいものに入れ替わります。/.test(MANC));
  ok('説明書：週の行が二重になっていない', (MANC.match(/<tr><th>毎週月曜の朝/g) || []).length === 1);
  ok('説明書：結びも週', /<b>お伝えすることが無い週は、無理にお送りしません。<\/b>今週のひとことは、数字も予定も動いていない週は届かないことがあります。/.test(MANC));
  ok('説明書：画面の写しの説明', /<b>④<\/b> 毎週月曜の「今週のひとこと」は「お知らせ」タブの先頭。/.test(MANC));
  ok('説明書：Google連携の但し書き', /毎週月曜の「今週のひとこと」でも触れます。/.test(MANC));
  ok('説明書：予定の枠は【今週の予定】', /<th>今週の予定の並び<\/th>/.test(MANC));
  ok('経営者向け資料：3か所', /相談。毎週月曜に「今週のひとこと」も届きます。/.test(PITC)
      && /「お知らせ」タブの先頭に、毎週月曜の「今週のひとこと」/.test(PITC)
      && /バッジの数は、未読のメッセージとお知らせの合計。/.test(PITC));
  [['一般向け', PITG], ['銀行向け', PITB]].forEach(([w, s]) =>
    ok(w + '：経営者の画面の説明', /次の面談の材料に。毎週月曜は「今週のひとこと」がメール・LINEで。/.test(s)));
  ok('継ナビくんの知識', /お知らせ\(先頭に毎週月曜の「今週のひとこと」。開いても既読にならず「すべて既読」で消す。経営者に毎朝の便りは無い。毎朝の「今日の一手」はパートナー宛\)/.test(SRC));
}

// ④ パートナー向けは今までどおり
{
  ok('パートナー説明書：毎朝の今日の一手', /継ナビくんが毎朝「今日の一手」を届けます/.test(MANP));
  ok('パートナー説明書：【本日の予定】', /<th>本文の【本日の予定】<\/th>/.test(MANP));
  ok('継ナビくんの知識（パートナー側）は残す', /毎朝の「今日の一手」とお知らせは右下ボタンのバッジに届きます。/.test(SRC));
}

// ⑤ 版
{
  const build = SRC.match(/var APP_BUILD='([^']+)'/)[1];
  is('版が揃う', [build, VER.build], ['20260924-03', '20260924-03']);
}
console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
