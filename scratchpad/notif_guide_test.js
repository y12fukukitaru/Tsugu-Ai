// =============================================================
// お知らせタブの道すじ（2026-10-10）
//   「お知らせが2件、右下は3。どこを処理すればよいか分からない」への対応
//   ・いちばん上に「片づけることが N つ」と、右下の数字の内訳
//   ・やることを ①②③… の番号つきで（未読 → 期日・対応 → 今日までのTODO）
//   ・札ごとに「✅ 片づけ方」（何をすれば消えるか）と、それを済ませる青いボタン
//   ・今日の一手（長い文）は、やることの後ろ（パートナー）
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const MANP = fs.readFileSync(__dirname + '/../manual-partner.html', 'utf8');
let n = 0, bad = [];
function ok(name, c) { n++; if (!c) bad.push(name); }
function takeFn(name) {
  const i = SRC.indexOf('\n  function ' + name + '(');
  if (i < 0) throw new Error(name);
  return SRC.slice(i, SRC.indexOf('\n  }\n', i) + 4);
}
const R = new Function(takeFn('notifResolve') + 'return notifResolve;')();
const t = (s) => '<span class="tag">' + s + '</span>';
const first = (tags) => R(tags.map(t))[0];
ok('やり取りなし → メッセージを1通送ると消える（メッセージのボタン）', first(['52日間やり取りなし']).k === 'msg' && /メッセージを1通送ると消えます/.test(first(['52日間やり取りなし']).how));
ok('返信待ち → 返信すると消える', first(['返信待ち 3日']).k === 'msg' && /返信すると消えます/.test(first(['返信待ち 3日']).how));
ok('レポート承認待ち → カルテで確定すると消える', first(['レポート承認待ち（9月分）']).k === 'karte' && /月次レポートを確定すると消えます/.test(first(['レポート承認待ち（9月分）']).how));
ok('面談予定日を過ぎ → 次回の面談日を入れると消える', /次回の面談日を入れると消えます/.test(first(['面談予定日を過ぎています（要更新）']).how));
ok('資金調達の期日超過と、課題の期日超過を取り違えない', /資金調達/.test(first(['期日超過：運転資金（3日）']).how) && /経営課題/.test(first(['課題期日超過：値上げ']).how));
{
  const rs = R([t('レポート承認待ち（9月分）'), t('110日間やり取りなし')]);
  ok('いくつもあるときは、急ぐもの（レポート）を先に、両方を並べる', rs.length === 2 && rs[0].k === 'karte' && rs[1].k === 'msg');
}
ok('わからないタグでも、カルテを開く道は出す', R([t('なにか')])[0].k === 'karte');
const rn = takeFn('renderNotifCenter');
ok('道すじ：片づけることの数と、右下の数字の内訳', /'<div class="nt-guide-t">片づけることが '\+steps\+' つあります<\/div>'/.test(rn) && /右下の継ナビくんの数字は、/.test(rn) && /①から順に、青いボタンを押して/.test(rn));
ok('数えるもの：未読の社・期日対応の社・今日までのTODO', /var steps=unreadIds\.length\+todoCount\+\(myTodo\?1:0\);/.test(rn));
ok('番号つきの札（未読 → 期日・対応 → TODO）', (rn.match(/notifNum\(num\)/g) || []).length === 3 && rn.indexOf('<span>未読メッセージ（返信）</span>') > 0 && rn.indexOf('<span>未読メッセージ（返信）</span>') < rn.indexOf('<span>期日・対応事項</span>') && rn.indexOf('<span>期日・対応事項</span>') < rn.indexOf('<span>あなたのTODO</span>'));
ok('札ごとに「✅ 片づけ方」', /✅ 片づけ方：/.test(rn) && /つとも済むと、この札が消えます/.test(rn));
ok('青いボタンは、いちばん急ぐ片づけ方のもの', /'<button class="btn2" '\+\(first==='msg'\?bMsg:bKar\)/.test(rn));
ok('TODO の札：TODO タブを開く', /onclick="knvShowTab\(\\'todo\\'\)">☑️ TODO を開く →/.test(rn));
ok('TODO だけ残っているときも、順調とは言わずに道すじを出す', /if\(!steps\)\{/.test(rn));
ok('今日の一手は、パートナーではやることの後ろ', /b\.innerHTML=insAfter \? html\+insH : insH\+html;/.test(rn));
ok('説明書：お知らせの道すじ', /<b>①②③…の番号つき<\/b>/.test(MANP) && /<b>「✅ 片づけ方」<\/b>/.test(MANP));
if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
