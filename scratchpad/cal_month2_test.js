// =============================================================
// 予定の月表示（2026-10-17）：曜日の帯を上に残す・終日は1枚・選んだ日の一覧へ送る札
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
const calDkey = (d) => d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
const rc = takeFn('knvRenderCal');

// ① 曜日の帯は上の帯（#knv-calbar）へ
ok('月表示は曜日の帯を上の帯に入れる', /if\(view==='month'\)\{\s*\n\s*bh\+='<div class="cal-grid cal-hds">'/.test(rc) && /bar\.classList\.toggle\('month', view==='month'\);/.test(rc));
ok('本体には曜日の帯を置かない（日のますだけ）', /h\+='<div class="cal-grid'\+\(rich\?' rich':''\)\+'">';/.test(rc) && (rc.match(/cal-hds/g) || []).length === 1);
ok('本体の上の余白：月は 6px', /\(bar\.classList\.contains\('month'\)\?6:10\)/.test(takeFn('calLayout')));

// ② 終日が2件以上は「終日 n件」1枚（パソコンの月表示）
ok('終日2件以上は1枚にまとめる', /if\(ads\.length>=2\)\{\s*\n\s*chips\.push\('<button type="button" class="cal-ev cal-many"/.test(rc) && /'<span>終日<b>'\+ads\.length\+'<\/b>件<\/span><\/button>'/.test(rc));
ok('押すとその日の一覧へ', /class="cal-ev cal-many"[\s\S]{0,120}calPickMore\(\\''\+key\+'\\'\)/.test(rc));
ok('時刻のある予定はそのあと・3枚まで', /its\.forEach\(function\(x\)\{ if\(!x\.allDay\) chips\.push\(calChip\(x\)\); \}\);/.test(rc) && /var MAXE=3, showN=chips\.length>MAXE\?MAXE-1:chips\.length;/.test(rc));
ok('CSS：札の形', /\.cal-ev\.cal-many\{display:flex;/.test(SRC));

// ③ 選んだ日の一覧へ送る札
{
  const html = new Function('calRel', 'calDkey', takeFn('calPeekHtml') + 'return calPeekHtml;')((d) => '', calDkey);
  const a = html(new Date(2026, 9, 15), 3);
  ok('日付と件数', /<b>10\/15（木）<\/b><span>の予定 <em>3<\/em>件<\/span>/.test(a) && /calPickMore\('2026-10-15'\)/.test(a));
  ok('最初は隠しておく（見えないときだけ出す）', /class="cal-peekw off" id="cal-peekw"/.test(a));
  is('予定なし', /は予定なし/.test(html(new Date(2026, 9, 15), 0)), true);
  const html2 = new Function('calRel', 'calDkey', takeFn('calPeekHtml') + 'return calPeekHtml;')(() => '今日', calDkey);
  ok('今日・明日は頭に付ける', /<b>今日 10\/15（木）<\/b>/.test(html2(new Date(2026, 9, 15), 1)));
  ok('月・週の両方で', (rc.match(/calPeekHtml\(/g) || []).length === 2 && /calPeekBind\(box\);/.test(SRC));
  const b = takeFn('calPeekBind');
  ok('一覧の見出しが見えたら（通り過ぎても）消す', /new IntersectionObserver/.test(b) && /w\.classList\.toggle\('off', e\.isIntersecting \|\| e\.boundingClientRect\.top<e\.rootBounds\.top\)/.test(b) && /calPeekBind\.io\.disconnect\(\)/.test(b));
  ok('一覧へは帯の下に来るよう送る', /box\.scrollTo\(\{ top:Math\.max\(0,y\), behavior:'smooth' \}\)/.test(takeFn('calPickMore')));
  ok('CSS：画面の下に浮かぶ（場所は取らない）', /\.cal-peekw\{position:sticky;bottom:14px;z-index:6;height:0;/.test(SRC) && /\.cal-peekw\.off \.cal-peek\{opacity:0;/.test(SRC));
}

// ④ 説明書
for (const f of ['manual-customer.html', 'manual-partner.html']) {
  const m = R(f);
  ok('説明書（' + f + '）', /<b>曜日の帯は上に残る<\/b>/.test(m) && /<b>終日の予定が2件以上ある日は「終日 n件」の札1枚<\/b>/.test(m) && /紺の札<\/b>が出て、押すと一覧まで送ります/.test(m));
}
is('版が揃う', [SRC.match(/var APP_BUILD='([^']+)'/)[1], VER.build], [VER.build, VER.build]);
if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b.name, '\n   got ', b.got, '\n   want', b.want)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
