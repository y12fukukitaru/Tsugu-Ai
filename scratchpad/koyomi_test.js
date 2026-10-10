// =============================================================
// 予定の暦（六曜・天赦日・一粒万倍日・寅の日・二十四節気）2026-10-10
//   旧暦は天文計算で前もって作った表（2024〜2032年）から。公表されている日付と合うかを確かめる
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
let n = 0, bad = [];
function is(name, got, want) { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) bad.push({ name, got: g, want: w }); }
function ok(name, c) { is(name, !!c, true); }
function takeFn(name) {
  let i = SRC.indexOf('\n  function ' + name + '('); if (i < 0) i = SRC.indexOf('\n  async function ' + name + '(');
  if (i < 0) throw new Error(name);
  return SRC.slice(i, SRC.indexOf('\n  }\n', i) + 4);
}
let PREFS = {};
const K = new Function('loadPrefs', 'savePrefs', 'knvRenderCal', SRC.slice(SRC.indexOf('  var KOYOMI='), SRC.indexOf('  function calDayHead(')) + 'return { koyomi, koyoCell, koyoLine, koyoLegend, koyoAiNote, koyoToggle };')(
  () => PREFS, (p) => { PREFS = p; }, () => {});
const D = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const k = (s) => K.koyomi(D(s));
const days = (y, f) => { const out = []; for (let d = new Date(y, 0, 1); d.getFullYear() === y; d.setDate(d.getDate() + 1)) { const r = K.koyomi(d); if (f(r)) out.push((d.getMonth() + 1) + '/' + d.getDate()); } return out; };

// 干支・六曜・旧暦
is('2024-01-01 は甲子・赤口・旧暦11月20日', [k('2024-01-01').kan, k('2024-01-01').rk, k('2024-01-01').lm, k('2024-01-01').ld], ['甲子', '赤口', 11, 20]);
is('2025-01-01 は先勝（旧暦12月2日）', [k('2025-01-01').rk, k('2025-01-01').lm, k('2025-01-01').ld], ['先勝', 12, 2]);
is('旧暦1月1日はいつも先勝', ['2024-02-10', '2025-01-29', '2026-02-17', '2027-02-07', '2028-01-27'].map((s) => [k(s).lm, k(s).ld, k(s).rk].join('')), ['11先勝', '11先勝', '11先勝', '11先勝', '11先勝']);
is('旧正月の前日は12月（大晦日）', [k('2026-02-16').lm, k('2026-02-16').leap], [12, false]);
is('閏月：2025年閏6月・2028年閏5月・2031年閏3月', [k('2025-07-25'), k('2028-06-23'), k('2031-04-22')].map((r) => [r.leap, r.lm, r.ld]), [[true, 6, 1], [true, 5, 1], [true, 3, 1]]);
// 天赦日（公表の一覧と同じ）
is('天赦日 2024年', days(2024, (r) => r.ten), ['1/1', '3/15', '5/30', '7/29', '8/12', '10/11', '12/26']);
is('天赦日 2025年', days(2025, (r) => r.ten), ['3/10', '5/25', '7/24', '8/7', '10/6', '12/21']);
is('天赦日 2026年', days(2026, (r) => r.ten), ['3/5', '5/4', '5/20', '7/19', '10/1', '12/16']);
is('天赦日 2026-10-01 は旧暦8月21日', [k('2026-10-01').lm, k('2026-10-01').ld], [8, 21]);
// 一粒万倍日（節で区切った月。小寒の前と後で決まりが変わる）
is('一粒万倍日 2024年1月', days(2024, (r) => r.mb).filter((x) => x.startsWith('1/')), ['1/1', '1/13', '1/16', '1/25', '1/28']);
ok('2025年 天赦日と一粒万倍日が重なる日（3/10・10/6・12/21）', ['2025-03-10', '2025-10-06', '2025-12-21'].every((s) => k(s).ten && k(s).mb));
ok('寅の日', k('2026-10-07').tora && k('2026-10-07').kan.endsWith('寅'));
// 二十四節気
is('節気：立春・春分・冬至', [k('2025-02-03').sk, k('2026-02-04').sk, k('2026-03-20').sk, k('2025-12-22').sk, k('2025-12-21').sk], ['立春', '立春', '春分', '冬至', '']);
// 表の外は出さない（2033年は旧暦の決まりで月が定まらない年）
is('表の外は null', [K.koyomi(new Date(2023, 11, 31)), K.koyomi(new Date(2033, 0, 1))], [null, null]);
ok('表の最後の日まで出る', K.koyomi(new Date(2032, 11, 31)) && K.koyomi(new Date(2032, 11, 31)).rk);

// 画面
ok('月表示（広い・狭い）と週の見出しに暦', /'<div class="cal-dr"><span class="d">'[\s\S]*?\+koyoCell\(d\)\+'<\/div>'/.test(takeFn('knvRenderCal')) && /\+'<span class="d">'\+d\.getDate\(\)\+'<\/span>'\s*\n\s*\+koyoCell\(d\)/.test(takeFn('knvRenderCal')) && /'<span class="n">'\+d\.getDate\(\)\+'<\/span>'\+koyoCell\(d\)/.test(SRC));
ok('日の見出しの下に、その日の暦', /\+'<\/div>'\+koyoLine\(d\);/.test(takeFn('calDayHead')));
const cell = K.koyoCell(D('2026-10-01'));
ok('札：大安は赤・天赦・万倍', /kyo-rk/.test(cell) && /kyo-b ten" title="天赦日">天赦/.test(cell) && /kyo-b mb" title="一粒万倍日">万倍/.test(cell) && /kyo-rk tai">大安/.test(K.koyoCell(D('2026-10-13'))));
const line = K.koyoLine(D('2026-10-01'));
ok('その日の暦：六曜・吉日・干支・旧暦', /天赦日<i>最上の吉日<\/i>/.test(line) && /一粒万倍日<i>始めごとに良い<\/i>/.test(line) && /戊申・旧暦8月21日/.test(line));
ok('表示を切れる（チェック）', /onchange="koyoToggle\(this\.checked\)"/.test(K.koyoLegend()));
K.koyoToggle(false);
is('切ると、マスにも見出しにも出ない', [K.koyoCell(D('2026-10-01')), K.koyoLine(D('2026-10-01')), /type="checkbox" checked/.test(K.koyoLegend())], ['', '', false]);
K.koyoToggle(true);
ok('戻すと出る', K.koyoCell(D('2026-10-01')).length > 0);
ok('目安であることを書く', /昔からの目安です（2024〜2032年）/.test(K.koyoLegend()));
// 継ナビくん
const ai = K.koyoAiNote(D('2026-10-10'));
ok('継ナビくんに今日の暦とこの先60日の吉日を渡す', /今日は先勝（丁巳、旧暦8月30日）/.test(ai) && /この先60日の大安: 10\/13\(火\)、10\/19\(月\)/.test(ai) && /一粒万倍日: 10\/11\(日\)/.test(ai) && /良し悪しを断定しない/.test(ai));
ok('システム指示の【今日の情報】に添える', /'）です。日付や曜日を聞かれたらこれを使ってください。'\+koyoAiNote\(d\);/.test(takeFn('knvAgendaNote')));
// 説明書
ok('説明書（経営者・買い手・売り手・パートナー）：暦', ['manual-customer.html', 'manual-buyer.html', 'manual-seller.html', 'manual-partner.html'].every((f) => /<h3>日本の暦（大安・天赦日・一粒万倍日）<\/h3>/.test(R(f)) && /「次の大安は？」/.test(R(f))));
ok('説明書（運営）：暦', /六曜（大安は赤）・天赦日・一粒万倍日<\/b>の札/.test(R('manual-admin.html')));

if (bad.length) { console.log(JSON.stringify(bad, null, 1)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
