// =============================================================
// 予定の週表示（2026-10-17）：午前・午後がひと目で分かる／終日は1段／畳んだ見出しを細く
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
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ① 日の一覧の小見出し（終日・午前・午後）
{
  const per = new Function(takeFn('calPer') + 'return calPer;')();
  is('終日', per({ allDay: true, when: '2026-10-17T09:00:00' }), 'all');
  is('11:59 は午前', per({ when: '2026-10-17T11:59:00' }), 'am');
  is('12:00 から午後', per({ when: '2026-10-17T12:00:00' }), 'pm');
  const lab = new Function(takeFn('calPerLab') + 'return calPerLab;')();
  const cards = new Function('calPer', 'calPerLab', 'calCard', takeFn('calCardsAmpm') + 'return calCardsAmpm;')(per, lab, (x) => '[' + x.title + ']');
  const out = cards([
    { title: 'B', when: '2026-10-17T14:00:00' }, { title: 'A', when: '2026-10-17T09:00:00' },
    { title: 'Z', when: '2026-10-17T09:00:00', allDay: true }, { title: 'C', when: '2026-10-17T15:00:00' }]);
  is('終日→午前→午後の順に、区切りは1回ずつ', out.replace(/<div class="cev-per (\w+)"><span>[^<]+<\/span><\/div>/g, '|$1|'), '|all|[Z]|am|[A]|pm|[B][C]');
  ok('一覧（月・週・これから）でも区切る', /h\+=pit\.length \? calCardsAmpm\(pit\)/.test(SRC) && /h\+=wit\.length \? calCardsAmpm\(wit\)/.test(SRC) && /var p2=calPer\(x\); if\(p2!==per\)\{ per=p2; h\+=calPerLab\(p2\); \}/.test(SRC));
}

// ② 左上の角：いま見ている時間帯
{
  const amp = takeFn('calAmpm');
  ok('見出しの帯の下の端から、本体の何時かを数える', /bar\.getBoundingClientRect\(\)\.bottom/.test(amp) && /lo\+Math\.max\(0, top-r\.top\)\/px/.test(amp));
  ok('午前◯時台・正午・午後◯時台', /lab=pm\?'午後':'午前'/.test(amp) && /\(hr===12\)\?'正午':\(\(pm\?hr-12:hr\)\+'時台'\)/.test(amp));
  ok('本体に何時から・1時間の高さを持たせる', /data-lo="'\+lo\+'" data-px="'\+PX\+'"/.test(SRC));
  ok('角に置く', /<div class="wk-corner wk-ampc"><span class="wk-ampm" id="wk-ampm"><\/span><\/div>/.test(SRC));
  ok('縦に送るたびに・畳み終わってからも', /box\.addEventListener\('scroll', function\(\)\{ go\(\); clearTimeout\(tm\); tm=setTimeout\(calAmpm, 520\); \}/.test(takeFn('calAmpmBind')));
  ok('週表示を描いたら結ぶ', /if\(view==='week'\) calAmpmBind\(\);/.test(SRC));
  ok('CSS：午前は金・午後は紺', /\.wk-ampm\.am\{background:linear-gradient\(160deg,#FCF3DA,#F2DFA9\)/.test(SRC) && /\.wk-ampm\.pm\{background:linear-gradient\(160deg,#1E3A66,#0E1B33\);color:#F6E3B4/.test(SRC));
}

// ③ 目盛りの帯と正午
{
  const wk = takeFn('calWeekVertical');
  ok('午前・午後の帯', /class="wk-band am"/.test(wk) && /class="wk-band pm"/.test(wk));
  ok('12時は「正午」・罫線を濃く', /\(t2===12\?'正午':t2\+':00'\)/.test(wk) && /\(t4===12\?' noon':''\)/.test(wk) && /\.wk-line\.noon\{border-top:1\.5px solid/.test(SRC));
}

// ④ 終日は1段
{
  const wk = takeFn('calWeekVertical');
  ok('2件以上は「n件あり」1枚', /if\(ads\.length>=2\)\{/.test(wk) && /<b>'\+ads\.length\+'<\/b>件<span class="ari">あり<\/span>/.test(wk));
  ok('色の点（TODO・課題は白抜き）2つまで', /ads\.slice\(0,2\)\.map/.test(wk) && /'<i class="td" style="border-color:'/.test(wk));
  ok('押すとその日の一覧へ', /calPickMore\(\\''\+k0\+'\\'\)/.test(wk));
  ok('週表示にも一覧の目印', /h\+='<div id="cal-pickday"><\/div>'\+calDayHead\(wpd/.test(SRC));
  ok('一覧へは帯の下に来るよう送る', /box\.scrollTo\(\{ top:Math\.max\(0,y\), behavior:'smooth' \}\)/.test(takeFn('calPickMore')));
  ok('CSS：スマホは「あり」を省く', /\.wk-many \.ari\{display:none;\}/.test(SRC));
}

// ⑤ 畳んだ見出し（2026-10-17 その2：出し入れを滑らかに）
{
  ok('指の 0.4倍の速さでついていく', /var KNV_CPT_RATE=0\.4;/.test(SRC) && /KNV_CPT\.tgt\+d\*KNV_CPT_RATE/.test(SRC) && /t=Math\.min\(t, y\);/.test(SRC));
  ok('畳み具合 --cpt（0〜1）を入れる', /bar\.style\.setProperty\('--cpt', KNV_CPT\.D>0 \? Math\.max\(0, Math\.min\(1, off\/KNV_CPT\.D\)\)\.toFixed\(3\) : '0'\);/.test(takeFn('calSetOff')));
  ok('CSS：曜日の段は --cpt に合わせて少しずつ細く（六曜・丸・余白）', /\.knv-panel\.knv-caltab \.wk-hcell \.kyo\{overflow:hidden;max-height:calc\(15px\*\(1 - var\(--cpt,0\)\)\);/.test(SRC) && /\.knv-panel\.knv-caltab \.wk-hcell \.n\{width:calc\(28px - 5px\*var\(--cpt,0\)\);/.test(SRC) && !/knv-compact \.wk-hcell\{flex-direction:row/.test(SRC));
  ok('CSS：端の札も同じ割合で', /\.knv-panel\.knv-caltab \.wk5-edge\{height:calc\(var\(--wk5-eh,52px\) - \(var\(--wk5-eh,52px\) - 24px\)\*var\(--cpt,0\)\);/.test(SRC) && /head\.style\.setProperty\('--wk5-eh'/.test(SRC));
  ok('CSS：指についている間は動きの時間なし・離したら 0.42秒', /\.knv-panel\.knv-caltab\.knv-cal-drag \.wk-hcell,/.test(SRC) && /transition-duration:\.42s;transition-timing-function:cubic-bezier\(\.4,0,\.2,1\);/.test(SRC));
  const lay = takeFn('calLayout');
  ok('本体の上の余白は、出ているときの高さで（中身が動かない）', /if\(KNV_CPT\.off<=0 && !KNV_CPT\.loop && !p\.classList\.contains\('knv-cpt-anim'\)\)\{ KNV_CPT\.full=barH; KNV_CPT\.stale=false; \}/.test(lay) && /if\(KNV_CPT\.off>0 \|\| KNV_CPT\.loop \|\| p\.classList\.contains\('knv-cpt-anim'\)\) barH=KNV_CPT\.full;/.test(lay));
  ok('描き直した直後は、動きを止めて --cpt=0 で測る', /p\.classList\.add\('knv-cpt-measure'\); bar\.style\.setProperty\('--cpt','0'\);/.test(lay) && /KNV_CPT\.stale=true;/.test(takeFn('knvRenderCal')));
  ok('収まる動きの間は測り直さない', /p\.classList\.add\('knv-cpt-anim'\);/.test(SRC) && /setTimeout\(function\(\)\{ p\.classList\.remove\('knv-cpt-anim'\); calLayout\(\); \}, 480\)/.test(SRC));
}

// ⑥ 説明書
for (const f of ['manual-customer.html', 'manual-partner.html']) {
  const m = R(f);
  ok('説明書（' + f + '）', /<b>午前・午後がひと目で分かります。<\/b>/.test(m) && /<b>終日の予定が2件以上ある日は、「2件あり」の札1枚<\/b>/.test(m) && /<b>曜日の段も細くなり<\/b>/.test(m) && /指の動きよりゆっくり/.test(m) && /<b>その位置で止まります<\/b>（勝手に全部開いたり閉じたりはしません）/.test(m) && !/近いほうへゆっくり収まります/.test(m) && !/3件までを出し/.test(m));
}
is('版が揃う', [SRC.match(/var APP_BUILD='([^']+)'/)[1], VER.build], [VER.build, VER.build]);
if (bad.length) { console.log('FAILED', bad.length, 'of', n); bad.forEach((b) => console.log(' ✗', b.name, '\n   got ', b.got, '\n   want', b.want)); process.exit(1); }
console.log('ALL OK', n, 'checks, 0 failed');
