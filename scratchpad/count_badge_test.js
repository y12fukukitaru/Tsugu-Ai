// =============================================================
// 数字の見せ方（2026-10-15）：継ナビくんボタン・タブの数字、内訳の札、TODO の要約と束
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
// ① 数の見せ方
{
  const c = new Function(SRC.match(/\n  function knvCnt\(n\)\{[^\n]*\}/)[0] + 'return knvCnt;')();
  is('99 までそのまま・それより多いと 99+', [c(0), c(3), c(10), c(99), c(100), c(1234), c('5')], ['0', '3', '10', '99', '99+', '99+', '5']);
  ok('タブ・ボタン・TODO・メッセージの数字は同じ見せ方', /b\.textContent=knvCnt\(fabN\);/.test(SRC) && /tb\.textContent=knvCnt\(total\);/.test(SRC) && /b\.textContent=knvCnt\(n\); b\.classList\.toggle\('hidden', !n\);/.test(SRC) && /mb\.textContent=knvCnt\(n\);/.test(SRC) && !/'9\+'/.test(SRC));
}
// ② 継ナビくんボタンの数字
{
  ok('大きく（26px・スマホ24px）・赤の濃淡・白い縁・影', /\.knv-badge\{position:absolute;top:-5px;right:-5px;min-width:26px;height:26px;/.test(SRC) && /linear-gradient\(180deg,#F06A5F 0%,#C23B36 100%\)/.test(SRC) && /border:2\.5px solid #fff;/.test(SRC) && /@media \(max-width:600px\)\{ \.knv-badge\{min-width:24px;height:24px;/.test(SRC));
  ok('数字は等幅（桁が揃う）', /\.knv-badge\{[^}]*font-variant-numeric:tabular-nums/.test(SRC));
  const br = takeFn('knvBadgesRender');
  ok('増えたときだけ、広がる輪で知らせる（3回で止まる）', /if\(fabN>\(window\.__KNV_LAST\|\|0\)\)\{ b\.classList\.remove\('ping'\); void b\.offsetWidth; b\.classList\.add\('ping'\); \}/.test(br) && /\.knv-badge\.ping::after\{animation:knv-ping 1\.6s cubic-bezier\(\.2,\.6,\.3,1\) 3;\}/.test(SRC));
  ok('動きを減らす設定では輪を出さない', /prefers-reduced-motion:reduce\)\{ \.knv-badge\.ping::after\{animation:none;\} \}/.test(SRC));
  ok('読み上げ：未確認の件数', /b\.setAttribute\('aria-label', fabN\?\('未確認 '\+fabN\+'件'\):''\);/.test(br));
  ok('タブの数字も同じ赤・TODO は青緑で見分ける', /\.knv-tbadge\{[^}]*linear-gradient\(180deg,#F06A5F 0%,#C23B36 100%\)/.test(SRC) && /#knv-todobadge\{background:linear-gradient\(180deg,#22A895 0%,#0F6559 100%\);\}/.test(SRC));
}
// ③ 内訳の札（実際に描かせる）
{
  const f = takeFn('knvSummaryRender');
  const box = { innerHTML: '', classList: { add() {}, remove() {} } };
  const run = new Function('$', 'window', 'agentInsightsUnread', 'knvCnt', f + 'knvSummaryRender(); return box;'.replace('box', 'arguments[0]("knv-summary")'));
  const html = run(() => box, { __KNV_UNREAD: 2, __KNV_TODO: 1, __KNV_MYTODO: 120, __eff: 'customer' }, () => 1, (x) => (x > 99 ? '99+' : String(x))).innerHTML;
  ok('絵文字をやめ、色の点＋名前＋数の玉', /<button class="k-red" onclick="knvShowTab\('notif'\)"><i class="dt"><\/i>未読<span class="cnt red">2<\/span><\/button>/.test(html) && !/[📩📌✦✅🛟⚠]/u.test(html));
  ok('意味で色を分ける（期日・対応＝紺／提案＝金／TODO＝青緑・99+）', /<span class="cnt navy">1<\/span>/.test(html) && /継ナビくんの提案<span class="cnt gold">1<\/span>/.test(html) && /今日までのTODO<span class="cnt teal">99\+<\/span>/.test(html));
}
// ④ TODO の要約と束
{
  const p = takeFn('todoPaint');
  ok('今日やることは輪（済んだ割合）と残りの数', /class="todo-ring"/.test(p) && /stroke-dasharray="'\+C\.toFixed\(1\)\+'" stroke-dashoffset="'\+off\.toFixed\(1\)\+'"/.test(p) && /<div class="num"><b>'\+dueN\+'<\/b><small>件<\/small><\/div>/.test(p));
  ok('期限切れは赤い数の玉で目立たせる', /<span class="warn"><span class="cnt red">'\+cnt\.over\+'<\/span>期限切れ<\/span>/.test(p));
  ok('束の札：名前＋数の玉（期限切れは赤）', /'<span class="cnt '\+\(g\[0\]==='over'\?'red':'light'\)\+'">'\+knvCnt\(cnt\[g\[0\]\]\)\+'<\/span><\/button>'/.test(p));
  ok('束の見出し：その束の色の数の玉', /'<span class="cnt n" style="background:'\+g\[2\]\+';">'\+knvCnt\(list\.length\)\+'<\/span>'/.test(SRC));
  ok('輪の CSS（金のにじみ・回転・数字は等幅）', /\.todo-ring \.fg\{stroke:url\(#todo-ring-g\);stroke-linecap:round;/.test(SRC) && /\.todo-ring svg\{width:100%;height:100%;transform:rotate\(-90deg\);\}/.test(SRC) && /\.todo-ring \.num b\{[^}]*font-variant-numeric:tabular-nums/.test(SRC));
  ok('古い帯（todo-bar）はもう使わない', !/todo-bar/.test(SRC));
  ok('期限の札の数（その日のやること）も同じ形の金の玉', /\.todo-chip-n\{[^}]*background:linear-gradient\(180deg,#DDB862,#B38A2E\)/.test(SRC));
}
ok('説明書：TODO の輪と数の玉', /今日やること ◯件」<\/b>（期限切れ＋今日）を<b>輪<\/b>で/.test(R('manual-customer.html')) && /今日やること ◯件」<\/b>（期限切れ＋今日）を<b>輪<\/b>で/.test(R('manual-partner.html')));
is('版が揃う', [SRC.match(/var APP_BUILD='([^']+)'/)[1], VER.build], [VER.build, VER.build]);
if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b.name, '\n   got ', b.got, '\n   want', b.want)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
