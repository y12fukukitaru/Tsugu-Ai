// =============================================================
// 四半期アンケート（匿名）の試験：画面・配線・便り・LINE・説明書・版
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html'), HB = R('supabase/functions/agent-heartbeat/index.ts'), LW = R('supabase/functions/line-webhook/index.ts');
const SQL = R('supabase/migrations/20260911040000_survey.sql');
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
function takeVar(name) { const i = SRC.indexOf('\n  var ' + name + '='); const end = SRC.indexOf(';\n', i); return SRC.slice(i, end + 2); }
const base =
  'function esc(s){ return String(s==null?"":s).replace(/[&<>"\']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c];}); }' +
  takeObj('SURVEY_Q') + takeObj('SURVEY_FREE') + takeVar('SURVEY_SCALE') + takeVar('SURVEY_ANON') +
  takeFn('surveyPeriodLabel') + takeFn('surveyHtml') + takeFn('surveyAgg') + takeFn('admSurveyHtml');
const M = new Function(base + 'return {Q:SURVEY_Q, label:surveyPeriodLabel, html:surveyHtml, agg:surveyAgg, adm:admSurveyHtml, anon:SURVEY_ANON};')();

// ① 問いと文言
{
  is('経営者5問・パートナー5問', [M.Q.customer.length, M.Q.consultant.length], [5, 5]);
  ok('問いは相手ごとに違う', M.Q.customer.every((q, i) => q.t !== M.Q.consultant[i].t));
  ok('経営者の問いに顧問料と買い手', M.Q.customer.some((q) => /顧問料/.test(q.t)) && M.Q.customer.some((q) => /買い手/.test(q.t)));
  ok('パートナーの問いに利用料と運営', M.Q.consultant.some((q) => /利用料/.test(q.t)) && M.Q.consultant.some((q) => /運営/.test(q.t)));
  //  朝の便り（LINE では本文の問いを見て数字で答える）と同じ文
  const hbC = HB.match(/customer: \[\n([\s\S]*?)\n  \],/)[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1));
  const hbP = HB.match(/consultant: \[\n([\s\S]*?)\n  \],/)[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1));
  is('便りの問い（経営者）は画面と同じ', hbC, M.Q.customer.map((q) => q.t));
  is('便りの問い（パートナー）は画面と同じ', hbP, M.Q.consultant.map((q) => q.t));
  ok('匿名の文言：誰が答えたかは記録されない', /誰が答えたかは記録されず/.test(M.anon) && /印だけ/.test(M.anon));
  is('期の表示', [M.label('2026-Q3'), M.label('2027-Q1'), M.label('x')], ['2026年7〜9月', '2027年1〜3月', 'x']);
}
// ② 回答枠
{
  const w = { open: true, period: '2026-Q3', until: '2026-10-21' };
  const h = M.html('customer', w, false);
  ok('目立つ枠（金の太枠）と 🗳', /id="survey-card"/.test(h) && /border:2px solid var\(--gold\)/.test(h) && /🗳/.test(h));
  ok('見出しに「匿名」と期と締め切り', /3分アンケート（匿名）/.test(h) && /2026年7〜9月/.test(h) && /2026-10-21 まで/.test(h));
  ok('匿名の説明が枠の中に', /🔒 /.test(h) && h.indexOf('誰が答えたかは記録されず') > 0);
  is('5問 × 5つのボタン', (h.match(/onclick="surveyPick\('q\d',\d\)"/g) || []).length, 25);
  ok('ボタンに数字と言葉（1=そう思わない … 5=そう思う）', /<b style="font-size:14px;display:block;">1<\/b>そう思わない/.test(h) && /<b style="font-size:14px;display:block;">5<\/b>そう思う/.test(h));
  ok('ひとこと欄は任意・匿名', /id="sv-comment"/.test(h) && /（任意）/.test(h) && /匿名です/.test(h));
  ok('送るボタンは「匿名で送る」', /onclick="surveySubmit\(\)">匿名で送る</.test(h));
  const hp = M.html('consultant', w, false);
  ok('パートナーはパートナーの問い', /継ナビくんのナビ/.test(hp) && !/顧問料に見合う/.test(hp));
  const hd = M.html('customer', w, true);
  ok('答えたあとは短いお礼だけ', /ありがとうございました/.test(hd) && !/surveySubmit/.test(hd) && /3か月後/.test(hd));
}
// ③ 集計
{
  const rows = [
    { audience: 'customer', period: '2026-Q3', answers: { q1: 4, q2: 5, q3: 3, q4: 4, q5: 5 }, comment: '助かる' },
    { audience: 'customer', period: '2026-Q3', answers: { q1: 2, q2: 3, q3: 3, q4: 2, q5: 1 }, comment: null },
    { audience: 'consultant', period: '2026-Q3', answers: { q1: 5, q2: 4, q3: 4, q4: 2, q5: 3 }, comment: '台本が良い' },
    { audience: 'consultant', period: '2026-Q2', answers: { q1: 3, q2: 3, q3: 3, q4: 3, q5: 3 }, comment: '' },
  ];
  const a = M.agg(rows);
  is('期ごと・相手ごと', Object.keys(a).sort(), ['2026-Q2', '2026-Q3']);
  is('経営者 Q3：2件・平均', [a['2026-Q3'].customer.n, a['2026-Q3'].customer.avg], [2, [3, 4, 3, 3, 3]]);
  is('分布（q1: 2 と 4）', a['2026-Q3'].customer.dist[0], [0, 1, 0, 1, 0]);
  is('ひとこと（空は入れない）', [a['2026-Q3'].customer.comments, a['2026-Q2'].consultant.comments], [['助かる'], []]);
  const w = { open: true, period: '2026-Q3', until: '2026-10-21', manual: false };
  const h = M.adm(w, rows, { '2026-Q3': 3, '2026-Q2': 1 });
  ok('受付中の表示と「いま受付を開く」', /受付中：2026年7〜9月/.test(h) && /admSurveyOpen\(\)/.test(h));
  ok('答えた人数は印の表から', /答えた人 3名/.test(h));
  ok('平均と分布と文章', /<b style="color:#8A6A12;font-size:13px;">3\.0<\/b>/.test(h) && /1:0 2:1 3:0 4:1 5:0/.test(h) && /台本が良い/.test(h));
  ok('LINE の答え方を運営にも案内', /4 5 3 4 5/.test(h));
  const hm = M.adm({ open: true, period: '2026-Q3', until: '2026-10-05', manual: true }, [], {});
  ok('手動で開いているときは閉じるボタン', /admSurveyClose\(\)/.test(hm) && /手動/.test(hm));
  const hc = M.adm({ open: false, period: '2026-Q3', next: '2026-10-01', manual: false }, [], {});
  ok('期間外は次の日付', /受付期間外（次は 2026-10-01 から）/.test(hc) && /まだ回答はありません/.test(hc));
}
// ④ 配線
{
  ok('経営者・パートナーのダッシュボードの先頭に枠', (SRC.match(/id="survey-box"/g) || []).length === 2);
  ok('起動時に読む', /loadAgentInsights\(\); loadSurvey\('customer'\); loadExitPlan\(ME,'customer'\); knvInit\(\);/.test(SRC) && /loadAgentInsights\(\); loadSurvey\('consultant'\); knvInit\(\);/.test(SRC));
  ok('運営ダッシュボードに集計', /id="adm-survey"/.test(SRC) && /loadAdmMoves\(rows, nameOf\);\n    loadAdmSurvey\(\);/.test(SRC));
  const ls = takeFn('loadSurvey');
  ok('受付期間はサーバーに聞く', /rpc\('survey_window'\)/.test(ls));
  ok('SQL 未実行・期間外は何も出さない', /if\(!w \|\| !w\.open\)\{ box\.innerHTML=''; return; \}/.test(ls));
  ok('答えたかどうかは印の表', /from\('survey_done'\)/.test(ls));
  ok('便りのリンク（?survey=1）で枠まで連れて行く', /survey=1/.test(ls) && /scrollIntoView/.test(ls));
  const ss = takeFn('surveySubmit');
  ok('全問そろうまで送らない', /あと '\+miss\.length\+' 問/.test(ss));
  ok('送るのは RPC（匿名の分岐はサーバー）', /rpc\('survey_submit'/.test(ss));
  ok('手動オープンは app_settings.survey_open', /key:'survey_open'/.test(takeFn('admSurveyOpen')) && /key:'survey_open'/.test(takeFn('admSurveyClose')));
}
// ⑤ 便りと LINE
{
  ok('毎朝の巡回にアンケートのお願い', /const surveys = await surveyInvites\(sb\);/.test(HB) && /surveys=\$\{surveys\}/.test(HB));
  ok('受付中だけ・答えていない人だけ・一度だけ', /rpc\("survey_window"\)/.test(HB) && /doneSet\.has\(p\.id\)/.test(HB) && /"survey_invite"/.test(HB));
  ok('7日後に一度だけ思い出す', /7 \* DAY/.test(HB) && /"survey_remind"/.test(HB));
  ok('便りの本文に匿名・問い・二つの答え方', /回答は匿名です/.test(HB) && /問い：/.test(HB) && /\?survey=1/.test(HB) && /5つの数字を返信/.test(HB));
  ok('メールのボタンは回答欄の真上へ', /survey: \{[\s\S]*link: APP_URL \+ "\?survey=1"/.test(HB) && /const link = note\.link \?\? APP_URL;/.test(HB) && /href="\$\{link\}"/.test(HB));
  ok('LINE：数字5つで答えられる（区切りあり・なし）', /const compact = text\.replace\(/.test(LW) && /\/\^\[1-5\]\{5\}\$\/\.test\(compact\)/.test(LW));
  ok('LINE：連携コード（6桁）より先に見るが取り違えない', LW.indexOf('answerSurvey(sb, lineUserId, compact') < LW.indexOf('/^\\d{6}$/.test(code)'));
  ok('LINE：本人の分として service_role が代わりに送る', /rpc\("survey_submit_for"/.test(LW) && /p_user: link\.user_id/.test(LW));
  ok('LINE：期間外・未連携・二度目は言葉で返す', /受付期間ではありません/.test(LW) && /まずアプリと連携してください/.test(LW) && /replace\(\/\^error:\\s\*\/, ""\)/.test(LW));
  //  数字5つの判定を実際に動かす
  const compact = (t) => t.replace(/[\s,、，.．/／・]/g, '');
  ok('「4 5 3 4 5」「45345」「4,5,3,4,5」「4・5・3・4・5」は答え', ['4 5 3 4 5', '45345', '4,5,3,4,5', '4・5・3・4・5'].every((t) => /^[1-5]{5}$/.test(compact(t))));
  no('「123456」（連携コード）は答えではない', /^[1-5]{5}$/.test(compact('123456')));
  no('「4 5 6 4 5」は答えではない', /^[1-5]{5}$/.test(compact('4 5 6 4 5')));
}
// ⑥ SQL・説明書・版
{
  ok('答えの表に user_id が無い（匿名）', /create table if not exists public\.survey_responses \([\s\S]*?\);/.test(SQL) && !/survey_responses \([\s\S]*?user_id[\s\S]*?\);/.test(SQL.match(/create table if not exists public\.survey_responses \([\s\S]*?\);/)[0]));
  ok('印の表は別', /create table if not exists public\.survey_done/.test(SQL));
  ok('答えは運営だけ読める', /survey responses admin read/.test(SQL));
  ok('書き込みは関数だけ（authenticated に insert 方針なし）', !/for insert/.test(SQL));
  ok('LINE 用の内部関数は authenticated から呼べない', /revoke all on function public\.survey_submit_for\(uuid, text, jsonb, text\)  from public, anon, authenticated;/.test(SQL));
  ok('四半期の窓は 1〜21日', /if d - q1 < 21 then/.test(SQL) && /q1 \+ 20/.test(SQL));
  ok('初期導入費の条文を新しい版として公開', /第2条の2（初期導入費）/.test(SQL) && /はじめの90日（土台づくり）/.test(SQL) && /月額の顧問料には含まれません/.test(SQL));
  ok('確かめの期待値', /期待値：表=2、関数=3、契約書に初期導入費=1/.test(SQL));
  ok('SQL にデプロイの手順（heartbeat と line-webhook）', /deploy agent-heartbeat --no-verify-jwt/.test(SQL) && /deploy line-webhook --no-verify-jwt/.test(SQL));
  ok('運営説明書：アンケート', /<h3>四半期アンケート（匿名）<\/h3>/.test(MANA) && /いま受付を開く/.test(MANA));
  ok('運営説明書：契約書の初期導入費', /第2条の2（初期導入費）/.test(MANA));
  ok('パートナー・経営者の説明書：アンケート', /<h3>3分アンケート（匿名）<\/h3>/.test(MANP) && /<h3>3分アンケート（匿名）<\/h3>/.test(MANC));
  ok('パートナー説明書：初期導入費の説明のしかた', /初期導入費の説明は/.test(MANP) && /第2条の2/.test(MANP));
  ok('経営者向け pitch と説明書：初期導入費の定義', /はじめの90日（土台づくり）で担当パートナーと運営が動くぶんの費用/.test(PITC) && /はじめの90日（土台づくり）で担当パートナーと運営が動くぶんの費用/.test(MANC));
  const build = SRC.match(/var APP_BUILD='([^']+)'/)[1];
  is('版が揃う', [build, VER.build], ['20260912-02', '20260912-02']);
}
console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
