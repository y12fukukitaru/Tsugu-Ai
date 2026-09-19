// =============================================================
// 説明書に、今日の追加分が入っていること
//   ・今日の一手の【本日の予定】が2段（時間と要件／場所）
//   ・Google→TsuguAi の向きだけ間があること（画面を開いたときに取りにいく）
//   ・入れた予定はその場でGoogleに出る／取り込んだ予定を消すと向こうに残る
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const MANC = R('manual-customer.html'), MANP = R('manual-partner.html');
const VER = JSON.parse(R('version.json'));
let n = 0, bad = [];
function is(name, got, want) { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) bad.push({ name, got: g, want: w }); }
function ok(name, cond) { is(name, !!cond, true); }

// ① 今日の一手の【本日の予定】
{
  //  経営者に届くのは週に一度の便り（【今週の予定】）。毎朝の今日の一手は
  //  パートナー宛で、枠の名前も中身も違う
  ok('経営者説明書：今週の予定の並び', /<th>今週の予定の並び<\/th>/.test(MANC)
      && /月曜の便りは、いちばん上の<b>【今週の予定】<\/b>から始まります。/.test(MANC));
  ok('経営者説明書：1行目に日付・時間と要件', /<b>1行目に日付・時間と要件、場所はその下に一段下げて<\/b>並びます/.test(MANC));
  ok('経営者説明書：予定が無い週の言い方', /予定が無い週も<b>「今週は予定が入っていません」<\/b>と出ます。/.test(MANC));
  ok('パートナー説明書：見出しの行がある', /<th>本文の【本日の予定】<\/th>/.test(MANP));
  ok('パートナー説明書：1行目に時間と要件、場所は一段下げ', /<b>1行目に時間と要件、場所はその下に一段下げて<\/b>並びます/.test(MANP));
  ok('パートナー説明書：例が入っている', /「17:00 高重さん」の下に「安田幼稚園、広島市中区…」/.test(MANP));
  ok('パートナー説明書：予定が無い日は「なし」', /予定が無い日も<b>「なし」<\/b>と出ます。/.test(MANP));
}

// ② Google → こちらへの反映のタイミング（今日いただいた質問）
{
  [['経営者説明書', MANC], ['パートナー説明書', MANP]].forEach(([w, s]) => {
    ok(w + '：間があることを書く', /<b>Googleに入れた予定が、こちらに出るまで少し間があります。<\/b>/.test(s));
    ok(w + '：取りにいくのは画面を開いたとき', /<b>この画面（予定タブ）を開いたときに取りにいきます<\/b>（開くたび、最短5分おき）。TsuguAiを開いていないあいだは取りにいきません。/.test(s));
    ok(w + '：すぐ合わせる方法', /すぐ合わせたいときは<b>「いま同期する」<\/b>を押してください。/.test(s));
  });
  //  朝の便りとの関係は、後日 agent-heartbeat 側で取り込むようにした（gcalmorning_test.js）
  ok('パートナー説明書：朝の便りとの関係も書く', /<b>毎朝の「今日の一手」だけは、届く前に取り込みます。<\/b>/.test(MANP));
  is('継ナビくんの知識にも入れる', (SRC.match(/Google→TsuguAiの向きだけ間がある\(こちらからGoogleへは入れた時点ですぐ。逆は予定タブを開いたときに取りにいく。開くたび・最短5分おき。TsuguAiを開いていない間は取りにいかない\)/g) || []).length, 2);
}

// ③ 昨日までの分が消えていないこと
{
  [['経営者説明書', MANC], ['パートナー説明書', MANP]].forEach(([w, s]) => {
    ok(w + '：入れた予定はその場でGoogleに出る', /<b>この画面で入れた予定は、直しても消しても、その場でGoogleに出ます<\/b>/.test(s));
    ok(w + '：取り込んだ予定を消すと向こうに残る', /<b>Googleカレンダーには残ります<\/b>（削除を押す前にその旨が出ます）。/.test(s));
  });
}

// ④ 版
{
  const build = SRC.match(/var APP_BUILD='([^']+)'/)[1];
  is('版が揃う', [build, VER.build], ['20260919-06', '20260919-06']);
}
console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
