// =============================================================
// 予定の一覧表示（2026-10-17）：今日から・日ごとに終日→午前→午後・終日はまとめる・いま見ている日
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const VER = JSON.parse(R('version.json'));
let n = 0, bad = [];
function is(name, got, want) { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) bad.push({ name, got: g, want: w }); }
function ok(name, cond) { is(name, !!cond, true); }
function takeFn(name) {
  const re = new RegExp('\\n  (?:async )?function ' + name + '\\s*\\(', 'g');
  let m, last = null, cnt = 0;
  while ((m = re.exec(SRC)) !== null) { last = m; cnt++; }
  if (!last) throw new Error('見つかりません: ' + name);
  is('定義は一つだけ: ' + name, cnt, 1);
  const end = SRC.indexOf('\n  }\n', last.index);
  return SRC.slice(last.index, end + 4);
}
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rc = takeFn('knvRenderCal');

// ① 今日の0時から
ok('今日の0時から（昨日は出さない）', /var t0=new Date\(\); t0\.setHours\(0,0,0,0\);/.test(rc) && /filter\(function\(x\)\{ return new Date\(x\.when\)>=t0; \}\)/.test(rc) && !/Date\.now\(\)-24\*3600\*1000/.test(rc));

// ② 日ごとにまとめて終日→午前→午後
ok('日ごとにまとめてから並べる', /days2\.forEach\(function\(k2\)\{/.test(rc) && /'<div class="cal-dayk" data-k="'\+k2\+'"><\/div>'\+calDayHead\(d2, calRel\(d2\), false, \(byDay\[k2\]\|\|\[\]\)\.length, byDay\[k2\]\)\+calCardsAmpm\(byK\[k2\]\)/.test(rc));
{
  const per = new Function(takeFn('calPer') + 'return calPer;')();
  const lab = new Function(takeFn('calPerLab') + 'return calPerLab;')();
  const kinds = { todo: { fg: '#147A6E', bg: '#eee', bd: '#BFE0DA', label: 'TODO' } };
  const grp = new Function('calKindOf', 'calIsTodo', 'esc', takeFn('calAllDayGroup') + 'return calAllDayGroup;')((x) => kinds[x.kind] || null, (x) => x.kind === 'todo' || x.kind === 'task', esc);
  const dk = (d) => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  const endOf = new Function(takeFn('calEndOf') + 'return calEndOf;')();
  const cards = new Function('calPer', 'calPerLab', 'calCard', 'calAllDayGroup', 'calDkey', 'calEndOf', 'calNowLine', takeFn('calCardsAmpm') + 'return calCardsAmpm;')(per, lab, (x) => '[' + x.title + ']', grp, dk, endOf, () => '');
  const one = cards([{ title: 'A', when: '2026-10-17T09:00:00' }, { title: 'Z', when: '2026-10-17T09:00:00', allDay: true }]);
  is('終日1件はふつうの札・終日が先', one.replace(/<div class="cev-per (\w+)"><span>[^<]+<\/span><\/div>/g, '|$1|'), '|all|[Z]|am|[A]');
  const two = cards([{ title: 'B', when: '2026-10-17T14:00:00' }, { title: 'Y', kind: 'own', when: '2026-10-17T09:00:00', allDay: true, _ri: 4 }, { title: 'T<', kind: 'todo', when: '2026-10-17T09:00:00', allDay: true, _ri: 5 }]);
  ok('終日2件以上は1枚の箱に1行ずつ', /\|all\|<div class="cev-adg">/.test(two.replace(/<div class="cev-per (\w+)"><span>[^<]+<\/span><\/div>/g, '|$1|')) && (two.match(/class="cev-adr/g) || []).length === 2 && !/\[Y\]/.test(two));
  ok('行：押すと小窓・TODO は白抜き・種類の札（自分の予定は札なし）', /class="cev-adr td"[^>]*onclick="calPeek\(5\)"/.test(two) && /<span class="cev-adt">T&lt;<\/span><span class="cev-kind">TODO<\/span>/.test(two) && /<span class="cev-adt">Y<\/span><\/div>/.test(two));
  ok('Enter でも開く', /onkeydown="if\(event\.key===\\'Enter\\'\)calPeek\(4\)"/.test(two) || /onkeydown="if\(event\.key==='Enter'\)calPeek\(4\)"/.test(two));
  ok('時刻のある予定はそのあと', /\|pm\|\[B\]$/.test(two.replace(/<div class="cev-per (\w+)"><span>[^<]+<\/span><\/div>/g, '|$1|')));
}

// ③ いま見ている日
{
  const f = takeFn('calListNow');
  ok('一覧のときだけ', /if\(calViewGet\(\)!=='list'\) return;/.test(f));
  ok('帯の下の線を越えた最後の日', /var line=bar\.getBoundingClientRect\(\)\.bottom\+24, cur=ks\[0\];/.test(f) && /if\(ks\[i\]\.getBoundingClientRect\(\)\.top<=line\) cur=ks\[i\]; else break;/.test(f));
  ok('日付・曜日・今日／明日', /日<span class="lwd">（'/.test(f) && /'<span class="cl-rel">'\+rel\+'<\/span>'/.test(f) && /if\(main\.__k===k\) return;/.test(f));
  ok('縦に送るたびに書き換える', /function both\(\)\{ calAmpm\(\); calListNow\(\); calDayStrip\(\); \}/.test(takeFn('calAmpmBind')) && /\n    calAmpmBind\(\);   \/\/ 週は午前・午後の角/.test(SRC));
  ok('CSS：箱と行', /\.cev-adg\{/.test(SRC) && /\.cev-adr\.td \.cev-adk\{/.test(SRC) && /\.cal-lab \.cl-rel\{/.test(SRC));
}

// ④ 説明書
for (const f of ['manual-customer.html', 'manual-partner.html']) {
  const m = R(f);
  ok('説明書（' + f + '）', /<b>一覧<\/b>…<b>今日から<\/b>これからの順番に。/.test(m) && /<b>1枚の箱に1行ずつ<\/b>/.test(m) && /<b>いま見ている日<\/b>/.test(m));
}
is('版が揃う', [SRC.match(/var APP_BUILD='([^']+)'/)[1], VER.build], [VER.build, VER.build]);
if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b.name, '\n   got ', b.got, '\n   want', b.want)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
