// =============================================================
// 予定を入れたら、その場でGoogleに出す（同期ボタンを押させない）
//   ・入れる／直すの3つの道（＋予定・相談から登録・カルテの次回面談）から走る
//   ・消したときは呼ばない（向こうに伝える道がまだ無いため）
//   ・つないでいない人には何もしない／5分の見送りは通さない
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const MANC = R('manual-customer.html'), MANP = R('manual-partner.html');
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
  return SRC.slice(last.index, SRC.indexOf('\n  }\n', last.index) + 4);
}

// ① その場で送る関数
{
  const f = takeFn('gcalPushNow');
  ok('つないでいるか分からなければ一度だけ確かめる', /if\(!GCAL\)\{ var gs=await sb\.rpc\('google_cal_status'\); if\(gs && !gs\.error\) GCAL=gs\.data; \}/.test(f));
  ok('つないでいない人には何もしない', /if\(!GCAL \|\| !GCAL\.linked\) return;/.test(f));
  ok('5分の見送りを通さず、その場で走らせる', /GCAL_AT=Date\.now\(\);\s*\n\s*await googleCalSync\(false\);/.test(f));
  ok('黙って走る（失敗しても次の同期で送り直す）', /await googleCalSync\(false\);/.test(f) && /\}catch\(e\)\{\}/.test(f));
  no('声は出さない', /googleCalSync\(true\)/.test(f));
  //  5分の見送りは、開いたときの自動同期のほうに残っている
  ok('開いたときの見送りは残す', /if\(Date\.now\(\)-GCAL_AT < 300000\) return;/.test(takeFn('gcalAuto')));
}

// ② 入れる／直す道からは走る
{
  ok('＋予定の保存から', /await knvRenderCal\(true\);\s*\n\s*gcalPushNow\(\);\s*\/\/ 押さなくても Google に出す/.test(takeFn('calSave')));
  ok('相談から「登録する」を押したとき', /knvAgendaReset\(\); renderSecLog\(\); aisecSave\(\);\s*\n\s*gcalPushNow\(\);/.test(takeFn('calDraftSave')));
  ok('カルテの次回面談から', /gcalPushNow\(\);\s*\/\/ 面談も、決めたその場で Google に出す/.test(takeFn('saveNextMeeting')));
  //  待たせない（await しない）。保存の手応えが Google 待ちにならないこと
  ['calSave', 'calDraftSave', 'saveNextMeeting'].forEach((fn) => {
    no(fn + '：Google を待たない', /await gcalPushNow\(\)/.test(takeFn(fn)));
  });
  is('呼んでいるのは3か所だけ', (SRC.match(/^\s*gcalPushNow\(\);/gm) || []).length, 3);
}

// ③ 消したとき（くわしくは gcaldel_test.js）
{
  const f = takeFn('calDelete');
  ok('こちらの予定を消したときだけ走らせる', /if\(onG\) gcalPushNow\(\);/.test(f));
  no('取り込んだ予定では走らせない', /^\s*gcalPushNow\(\);\s*$/m.test(f));
}

// ④ 画面と説明書の言い方
{
  ok('連携欄に「押す必要はありません」と書く', /そのままGoogleに出ます（押す必要はありません）。/.test(SRC));
  ok('「いま同期する」の役割も書く', /「いま同期する」は、Google側で入れた予定を待たずに取り込みたいときにお使いください。/.test(SRC));
  ok('ボタンは残す', /onclick="googleCalSync\(true\)">いま同期する<\/button>/.test(SRC));
  is('継ナビくんの知識にも入れる', (SRC.match(/その場でGoogleに出る\(同期のボタンを押す必要はない/g) || []).length, 2);
  [['経営者説明書', MANC], ['パートナー説明書', MANP]].forEach(([w, s]) => {
    ok(w + '：その場で出る', /その場でGoogleに出ます<\/b>（同期のボタンを押す必要はありません）/.test(s));
  });
  ok('パートナー説明書：次回面談も同じ', /カルテで決めた次回面談も同じで、保存した時点でGoogleに出ます。/.test(MANP));
}

// ⑤ 版
{
  const build = SRC.match(/var APP_BUILD='([^']+)'/)[1];
  is('版が揃う', [build, VER.build], ['20260919-04', '20260919-04']);
}
console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
