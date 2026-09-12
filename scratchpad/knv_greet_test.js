// =============================================================
// 継ナビくんの最初のひとこと（時間帯・曜日・名前）と、今日の一手の置き場の試験
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const MANP = fs.readFileSync(__dirname + '/../manual-partner.html', 'utf8');
const VER = JSON.parse(fs.readFileSync(__dirname + '/../version.json', 'utf8'));
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
const M = new Function('var JST_MS=9*3600*1000;' + takeFn('knvGreeting') + 'return knvGreeting;')();
const at = (y, mo, d, h) => new Date(Date.UTC(y, mo - 1, d, h, 0));   // 日本時間の時刻を UTC 欄に載せた Date

// ① 時間帯
{
  is('朝7時は「おはようございます」', M({}, 'consultant', at(2026, 9, 16, 7)).hello, 'おはようございます');
  is('10時台も朝', M({}, 'consultant', at(2026, 9, 16, 10)).hello, 'おはようございます');
  is('13時は「こんにちは」', M({}, 'consultant', at(2026, 9, 16, 13)).hello, 'こんにちは');
  is('19時は「こんばんは」', M({}, 'consultant', at(2026, 9, 16, 19)).hello, 'こんばんは');
  is('深夜2時は「夜遅くまでお疲れさまです」', M({}, 'consultant', at(2026, 9, 16, 2)).hello, '夜遅くまでお疲れさまです');
}
// ② 曜日
{
  is('月曜（2026-09-14）', M({}, 'consultant', at(2026, 9, 14, 9)).day, '今週もよろしくお願いします。');
  is('金曜（2026-09-18）', M({}, 'consultant', at(2026, 9, 18, 9)).day, '今週もお疲れさまでした。');
  is('日曜（2026-09-13）', M({}, 'consultant', at(2026, 9, 13, 9)).day, 'お休みの日もありがとうございます。');
  is('水曜は曜日のひとことなし', M({}, 'consultant', at(2026, 9, 16, 9)).day, '');
}
// ③ 名前
{
  is('パートナー：氏名で「さん」', M({ full_name: '小笠原 康', company_name: '福來' }, 'consultant', at(2026, 9, 16, 9)).name, '小笠原 康さん');
  is('経営者：担当者名で「さん」', M({ contact_name: '継 太郎', company_name: '株式会社継' }, 'customer', at(2026, 9, 16, 9)).name, '継 太郎さん');
  is('名前が無ければ会社名で「さま」', M({ company_name: '株式会社継' }, 'customer', at(2026, 9, 16, 9)).name, '株式会社継さま');
  is('何も無ければ名前なし', M({}, 'customer', at(2026, 9, 16, 9)).name, '');
  is('全文（日曜の朝・名前あり）', M({ contact_name: '継 太郎' }, 'customer', at(2026, 9, 13, 8)).text, 'おはようございます、継 太郎さん。継ナビくんです🌱 お休みの日もありがとうございます。');
  is('全文（平日の昼・名前なし）', M({}, 'admin', at(2026, 9, 16, 13)).text, 'こんにちは。継ナビくんです🌱');
  ok('前後の空白は落とす', M({ contact_name: '  山田  ' }, 'customer', at(2026, 9, 16, 9)).name === '山田さん');
}
// ④ 配線：挨拶は画面の文脈から、今日の一手は相談タブに出さない
{
  const rl = takeFn('renderSecLog');
  ok('最初のひとことは knvGreeting（本人の名前と役割）', /var g=knvGreeting\(window\.__prof, window\.__eff\|\|window\.__role\|\|''\);/.test(rl) && /'<div class="ai-bubble">'\+esc\(g\.text\)\+'<br>/.test(rl));
  no('「こんにちは、継ナビくんです」の決め打ちは無い', /こんにちは、継ナビくんです🌱<br>/.test(SRC));
  no('相談タブに今日の一手の枠は無い', /id="knv-insights"/.test(SRC));
  const ra = takeFn('renderAgentInsights');
  ok('今日の一手はダッシュボードと、開いていればお知らせタブへ', /\$\('agent-insights-box'\)/.test(ra) && /renderNotifCenter\(\)/.test(ra) && !/knv-insights/.test(ra));
  const rn = takeFn('renderNotifCenter');
  ok('お知らせタブの先頭に今日の一手', /var insH=\(typeof agentInsightsHtml==='function'\)\?agentInsightsHtml\(\):'';/.test(rn) && /b\.innerHTML=insH\+html;/.test(rn));
  const st = takeFn('knvShowTab');
  no('相談タブを開いても既読にしない', /agentInsightReadAll/.test(st));
  const kb = takeFn('knvBadgesRender');
  ok('お知らせタブのバッジは提案を含む合計', /tb\.textContent=total>9\?'9\+':total; tb\.classList\.toggle\('hidden', !total\);/.test(kb));
  const ks = takeFn('knvSummaryRender');
  ok('内訳の「提案」ボタンはお知らせタブへ', /onclick="knvShowTab\(\\'notif\\'\)">✦ 継ナビくんの提案/.test(ks));
  ok('説明書：今日の一手はお知らせタブの先頭', /「お知らせ」タブの先頭<\/b>にあります（相談タブには出ません）/.test(MANP));
  const build = SRC.match(/var APP_BUILD='([^']+)'/)[1];
  is('版が揃う', [build, VER.build], ['20260912-02', '20260912-02']);
}
console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
