// =============================================================
// 継ナビくんの「資料から探す」と、カルテの枝葉（ツリー）の試験（2026-09-26）
//   ① 役割ごとに出す資料（エンタープライズの説明書は所属している方だけ）
//   ② 資料から探す：質問＞題名＞組＞本文の順に点数。言葉は全部含むものだけ
//   ③ 見つかった頁は「目次から読む」形で、その頁から開く（?view=read#t=）
//   ④ カルテ：組は最初から全部ひらく／いま見ている項目の下に画面の中の見出し（小枝）／パンくず
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
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
function takeBlock(name) { const i = SRC.indexOf('\n  var ' + name + '='); if (i < 0) throw new Error(name); return SRC.slice(i, SRC.indexOf('\n  ];\n', i) + 5); }
// ① 資料
const D = new Function('EP_ME', takeBlock('KNV_DOCS') + takeFn('knvDocsFor') + 'return { KNV_DOCS: KNV_DOCS, knvDocsFor: knvDocsFor };');
const f = (eff, ep) => D(ep).knvDocsFor(eff).map(d => d.f);
is('経営者には経営者向けの説明書だけ', f('customer', null), ['manual-customer.html']);
is('パートナー（個人）', f('consultant', null), ['manual-customer.html', 'manual-partner.html', 'pitch-customer.html']);
is('パートナー（法人所属）にはエンタープライズも', f('consultant', { org: {} }), ['manual-customer.html', 'manual-partner.html', 'manual-ep.html', 'pitch-customer.html']);
is('運営には全部', f('admin', null).length, 11);
ok('どの資料にも2つの開き方', /📑 目次から読む/.test(takeFn('knvDocRow')) && /▶ スライドで見る/.test(takeFn('knvDocRow')));
ok('開き方：?view=read／?view=slide と #t=題名', /'\?view=read':'\?view=slide'/.test(takeFn('knvDocOpen')) && /'#t='\+encodeURIComponent\(t\)/.test(takeFn('knvDocOpen')));
// ② 探す
const S = new Function(takeFn('knvNorm') + takeFn('knvDocSearch') + takeFn('knvSnip') + 'return { search: knvDocSearch, snip: knvSnip };')();
const idx = [
  { f: 'a.html', dn: 'A', t: 'ご契約について', g: 'お支払い', q: ['解約したいときは？', 'プランを変えたい'], x: 'いちばん上に「ご契約について」。解約を依頼する。' },
  { f: 'a.html', dn: 'A', t: '解約のお金', g: 'お支払い', q: [], x: '申し出た月の末日で終了。' },
  { f: 'a.html', dn: 'A', t: '出口の設計', g: '承継', q: ['出口の設計は自分で入力するの？'], x: '担当パートナーと一緒に決めます。解約とは関係ありません。' },
  { f: 'b.html', dn: 'B', t: 'ＡＩ利用料', g: '料金', q: [], x: '顧問先1社につき2,000円' }
];
is('質問に当たるものが先', S.search(idx, '解約').map(r => r.p.t), ['ご契約について', '解約のお金', '出口の設計']);
is('言葉は全部含むものだけ', S.search(idx, '解約 末日').map(r => r.p.t), ['解約のお金']);
is('全角・半角の違いは気にしない', S.search(idx, 'ai利用料').map(r => r.p.t), ['ＡＩ利用料']);
is('見つからない', S.search(idx, '存在しない言葉').length, 0);
is('質問に当たったら、その質問を見せる', S.snip(idx[0], '解約'), { k: 'q', s: '解約したいときは？' });
ok('本文に当たったら、その前後を見せる', /末日/.test(S.snip(idx[1], '末日').s));
const run = takeFn('knvDocSearchRun');
ok('見つかった頁は「目次から読む」でその頁から', /knvDocOpen\(\\''\+p\.f\+'\\',\\'read\\',/.test(run));
ok('話す内容（.talk）は探す対象にしない', /querySelectorAll\('\.talk,script,style'\)/.test(takeFn('knvDocIndex')));
ok('サポートは「探す」を先に置く', /var h=knvDocHubHtml\(eff\);/.test(takeFn('knvRenderSupport')));
ok('よく聞かれること（資料の質問から）', /よく聞かれること：/.test(takeFn('knvDocChips')));
// ④ カルテ
ok('組は最初から全部ひらく', /if\(a===null\) return true;/.test(takeFn('clOpenIs')));
ok('畳んだ組は覚える（最初は全部ひらいている前提で）', /a=CL_GROUPS\.map\(function\(g,i\)\{ return i; \}\)/.test(takeFn('clOpenSet')));
ok('項目の下に小枝の入れ物', /<div class="cl-twigs" id="tw-'\+id\+'"><\/div>/.test(takeFn('clNi')));
//  2段のメニュー（Supabase 風、2026-09-26）：左に組、右に選んだ組の項目
const side = takeFn('clSideHtml');
ok('2段：左の列（組のアイコンと名前）と右の枠', /class="cl-side cl-rail2"/.test(side) && /<div class="cl-rail">/.test(side) && /<div class="cl-panel">/.test(side));
ok('組にカーソルでのぞく・押して開く・離れたら戻る', /onmouseenter="clRailHover\('\+gi\+'\)"/.test(side) && /onclick="clRailPick\('\+gi\+'\)"/.test(side) && /onmouseleave="clRailLeave\(\)"/.test(side));
ok('件数の札と項目の id は前と同じ', /id="clgb-'\+gi\+'"/.test(side) && /id="clg-'\+gi\+'"/.test(side) && /clNi\(it\[0\],it\[1\],it\[2\]\)/.test(side));
ok('組を押したら、前にその組で見ていた項目へ', /CL_LAST_IN_G\[gi\]/.test(takeFn('clRailPick')) && /CL_LAST_IN_G\[gi\]=id; clPanelShow\(gi\);/.test(takeFn('clSpySet')));
ok('右の枠の見た目', /\.cl-pg\.on\{display:block;/.test(SRC) && /\.cl-rg\.on \.ci\{background:var\(--gold\)/.test(SRC) && /\.cl-panel \.cl-tw\.on\{/.test(SRC));
{
  //  のぞく・戻る（DOM の代わりに作り物）
  const mk = id => ({ id: id, cls: {}, classList: { toggle(c, f) { this.o[c] = !!f; }, o: {} } });
  const pgs = [0, 1, 2].map(i => mk('clg-' + i)), rgs = [0, 1, 2].map(i => mk('clr-' + i));
  const doc = { querySelectorAll: q => /cl-pg/.test(q) ? pgs : rgs };
  const show = new Function('document', 'clGroupIdx', 'CL_ACTIVE', takeFn('clPanelShow') + 'return clPanelShow;')(doc, () => 1, 'x');
  show(2);
  is('のぞいている組の中身を出す', pgs.map(g => !!g.classList.o.on), [false, false, true]);
  is('いま見ている組の印はそのまま', rgs.map(r => !!r.classList.o.on), [false, true, false]);
  is('のぞいている組に印', rgs.map(r => !!r.classList.o.hov), [false, false, true]);
}
ok('いま見ている項目の見出しを拾う（.ph）', /classList\.contains\('ph'\)/.test(takeFn('clSubHeads')));
ok('見出しへ動く', /scrollIntoView/.test(takeFn('clTwig')));
ok('項目を移ると小枝を描き直す', /clTwigsRender\(id\);/.test(takeFn('clSpySet')));
ok('本文の上にパンくず', /<div class="cl-crumb" id="cl-crumb"><\/div>/.test(SRC) && /cl-crumb-path/.test(takeFn('clTwigsRender')));
ok('スマホ：小枝をパンくずの下に並べ、上に残す', /#cl-modal \.cl-crumb-twigs\{display:flex;\}/.test(SRC) && /#cl-modal \.cl-crumb\{position:sticky;top:0;/.test(SRC) && /overflow-x:clip;/.test(SRC));
// 小枝の拾い方（DOM の代わりに簡単な作り物で）
{
  const mk = (id, ph, text) => ({ id: id || '', textContent: text || '', classList: { contains: c => c === 'ph' && ph } });
  const wraps = { 'ctab-tools': { children: [mk('cs-value', true, '企業価値'), mk('', true, '承継チェック（10項目）'), mk('', false, 'x'), mk('', true, '承継シミュレーション'), mk('cs-exit', true, '出口'), mk('', true, '別の画面の見出し')] } };
  const sub = new Function('$', 'CL_TAB_WRAPS', 'CL_SPY_IDS', takeFn('clSubHeads') + 'return clSubHeads;')(id => wraps[id], ['ctab-tools'], ['cs-value', 'cs-exit']);
  is('いま見ている項目の見出しだけ（括弧は落とす）', sub('cs-value').map(x => x.t), ['承継チェック', '承継シミュレーション']);
  is('見出しに印を付けて、そこへ動けるように', wraps['ctab-tools'].children[1].id, 'clsub-cs-value-0');
}

if (bad.length) { bad.forEach(b => console.log('NG', b.name, '\n   got ', b.got, '\n   want', b.want)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK ' + n + ' checks, 0 failed');
