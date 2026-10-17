// =============================================================
// 予定の日の一覧（2026-10-17）：「いま」の線・あと n件・日の細い札
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
const dk = (d) => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
const endOf = new Function(takeFn('calEndOf') + 'return calEndOf;')();
const per = new Function(takeFn('calPer') + 'return calPer;')();
const lab = new Function(takeFn('calPerLab') + 'return calPerLab;')();
const nowLine = new Function(takeFn('calNowLine') + 'return calNowLine;')();
const cards = new Function('calPer', 'calPerLab', 'calCard', 'calAllDayGroup', 'calDkey', 'calEndOf', 'calNowLine', takeFn('calCardsAmpm') + 'return calCardsAmpm;')(per, lab, (x) => '[' + x.title + ']', () => '', dk, endOf, () => '|NOW|');
const strip = (h) => h.replace(/<div class="cev-per (\w+)"><span>[^<]+<\/span><\/div>/g, '');
const now = new Date(), iso = (m) => { const d = new Date(now.getTime() + m * 60000); return dk(d) + 'T' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':00'; };

// ① 「いま」の線
if (now.getHours() >= 3 && now.getHours() <= 20) {
  is('済んだ予定と、これから（行っている最中を含む）のあいだ', strip(cards([
    { title: 'A', when: iso(-180), ends: iso(-120) }, { title: 'B', when: iso(-30), ends: iso(30) }, { title: 'C', when: iso(120) }])), '[A]|NOW|[B][C]');
  is('全部済んでいたら最後に', strip(cards([{ title: 'A', when: iso(-180), ends: iso(-120) }])), '[A]|NOW|');
}
is('今日でなければ線は引かない', strip(cards([{ title: 'X', when: '2030-01-01T10:00:00' }])), '[X]');
ok('線の札は「いま HH:MM」', /<div class="cev-nowl"><span>いま 09:05<\/span><\/div>/.test(nowLine(new Date(2026, 9, 17, 9, 5))));
ok('終わりの無い予定は1時間', endOf({ when: '2026-10-17T10:00:00' }).getHours() === 11);

// ② あと n件
{
  const rest = new Function('calEndOf', takeFn('calRestCount') + 'return calRestCount;')(endOf);
  is('終わっていない予定・終日は数える', rest([{ when: iso(-180), ends: iso(-120) }, { when: iso(-30), ends: iso(30) }, { allDay: true, when: iso(-500) }]), 2);
  const dh = takeFn('calDayHead');
  ok('今日だけ「あと n件」（全部済んだら「すべて終わりました」）', /var rest=\(extra==='今日' && items && items\.length\) \? calRestCount\(items\) : null;/.test(dh) && /'あと <b>'\+rest\+'<\/b>件':'すべて終わりました'/.test(dh));
  ok('月・週・一覧から予定を渡す', /calDayHead\(pd, calRel\(pd\), true, \(byDay\[pick\]\|\|\[\]\)\.length, byDay\[pick\]\)/.test(SRC) && /byDay\[wkPick\]\)/.test(SRC) && /byDay\[k2\]\)\+calCardsAmpm/.test(SRC));
}

// ③ 日の細い札
{
  const rc = takeFn('knvRenderCal');
  ok('月・週で帯に入れる（一覧は帯の日付が変わるので不要）', /if\(view!=='list'\)\{[\s\S]{0,900}class="cal-dstrip" id="cal-dstrip" onclick="calPickMore\(/.test(rc));
  const ds = takeFn('calDayStrip');
  ok('日の見出しが帯の下に隠れ、一覧の終わりはまだ下にあるときだけ', /on=head\.bottom<line && endTop>line\+40;/.test(ds) && /box\.querySelector\('\.cal-lg'\)/.test(ds));
  ok('縦に送るたびに', /function both\(\)\{ calAmpm\(\); calListNow\(\); calDayStrip\(\); \}/.test(takeFn('calAmpmBind')));
  ok('CSS：帯の高さを変えない（absolute・top:100%）', /\.cal-dstrip\{position:absolute;left:12px;right:12px;top:100%;/.test(SRC) && /\.cal-dstrip\.on\{opacity:1;/.test(SRC));
  ok('CSS：いまの線は週表示の赤', /\.cev-nowl::after\{content:"";flex:1;height:2px;background:#A9403D;/.test(SRC));
}

// ④ 説明書
for (const f of ['manual-customer.html', 'manual-partner.html']) {
  const m = R(f);
  ok('説明書（' + f + '）', /<b>赤い「いま」の線<\/b>/.test(m) && /<b>「あと n件」<\/b>/.test(m) && /<b>どの日かを示す細い札<\/b>/.test(m));
}
is('版が揃う', [SRC.match(/var APP_BUILD='([^']+)'/)[1], VER.build], [VER.build, VER.build]);
if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b.name, '\n   got ', b.got, '\n   want', b.want)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
