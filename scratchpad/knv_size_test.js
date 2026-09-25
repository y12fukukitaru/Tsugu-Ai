// =============================================================
// 継ナビくんの大きさ（標準・右半分・左半分・中央に大きく）と、
// 呼び出し口の場所（右下・左下・右上・左上）を設定で選べる
//   ・設定に出る／ログインしている方ごとの表示設定に入る
//   ・半分は本体を横に寄せて並べる（1200px以上）。外側を押しても閉じない
//   ・中央に大きく、は背後を留めて幕を出す。幕を押すと閉じる
//   ・スマホは大きさを選ばない（いつも画面いっぱい・背後を留める）
//   ・以前の「⤢ 拡大表示」を覚えている方は、中央に大きく、から
//   実際の動き（送り・留め・位置）はブラウザで116項目を確かめた（knvsz_check）
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
let n = 0, bad = [];
function ok(name, cond) { n++; if (!cond) bad.push(name); }
function no(name, cond) { ok(name, !cond); }
function takeFn(name) {
  const re = new RegExp('\\n  (?:async )?function ' + name + '\\s*\\(', 'g');
  const all = SRC.match(re) || [];
  if (all.length !== 1) { bad.push('定義は一つだけ: ' + name + '（' + all.length + '）'); }
  const i = SRC.search(new RegExp('\\n  (?:async )?function ' + name + '\\s*\\('));
  return SRC.slice(i, SRC.indexOf('\n  }\n', i) + 4);
}
function takeVar(name) { const i = SRC.indexOf('\n  var ' + name + '='); return SRC.slice(i, SRC.indexOf(';\n', i) + 2); }

// ① 選べるもの
{
  const env = new Function(takeVar('KNV_SIZES') + takeVar('KNV_FABPOS') + takeFn('knvPick') +
    'var PREF={}; function loadPrefs(){ return PREF; }' +
    'var LS={}; var localStorage={ getItem:function(k){ return LS[k]||null; } };' +
    takeFn('knvLayout') +
    'return { set:function(p,ls){ PREF=p; LS=ls||{}; }, lay:knvLayout, S:KNV_SIZES, F:KNV_FABPOS };')();
  ok('大きさは4つ', JSON.stringify(env.S.map((x) => x[0])) === '["float","right","left","center"]');
  ok('場所は4つ', JSON.stringify(env.F.map((x) => x[0])) === '["rb","lb","rt","lt"]');
  env.set({}); ok('何も選んでいなければ 標準・右下', JSON.stringify(env.lay()) === '{"size":"float","fab":"rb"}');
  env.set({ knvSize: 'right', knvFab: 'lt' }); ok('選んだものを返す', JSON.stringify(env.lay()) === '{"size":"right","fab":"lt"}');
  env.set({ knvSize: 'huge', knvFab: 'zz' }); ok('知らない値は既定へ', JSON.stringify(env.lay()) === '{"size":"float","fab":"rb"}');
  env.set({}, { tsugu_knv_max: '1' }); ok('以前の拡大表示を覚えていれば 中央に大きく', env.lay().size === 'center');
  env.set({ knvSize: 'left' }, { tsugu_knv_max: '1' }); ok('選び直したものが優先', env.lay().size === 'left');
}

// ② 設定と見出しの ⤢
{
  const rs = takeFn('renderSettings');
  ok('設定に「継ナビくん」', /font-weight:700;color:var\(--navy\);margin:16px 0 8px;">継ナビくん<\/div>/.test(rs));
  ok('設定：画面の大きさ', /画面の大きさ（パソコン）/.test(rs) && /KNV_SIZES\.map/.test(rs) && /knvSetSize\(/.test(rs));
  ok('設定：ボタンの場所', />ボタンの場所</.test(rs) && /KNV_FABPOS\.map/.test(rs) && /knvSetFab\(/.test(rs));
  ok('見出しの ⤢ は大きさの一覧を開く', /id="knv-max-btn" onclick="knvSizeMenu\(\)" title="大きさを変える"/.test(SRC) && /<div id="knv-szmenu" class="knv-szmenu hidden"><\/div>/.test(SRC));
  no('古い拡大表示の仕掛けは残さない', /function knvMaxToggle|function knvMaxRestore|\.knv-panel\.max\{/.test(SRC));
  ok('表示設定を読むときに付ける', /applyDisplayPrefs\(\)\{[\s\S]{0,300}knvApplyLayout\(\)/.test(SRC));
  ok('継ナビくんを用意するときに付ける', /knvShowTab\('chat'\);\n    knvApplyLayout\(\);/.test(SRC));
  ok('保存はログインしている方ごとの表示設定', /p\.knvSize=knvPick\(KNV_SIZES, v, 'float'\); savePrefs\(p\);/.test(takeFn('knvSetSize'))
    && /p\.knvFab=knvPick\(KNV_FABPOS, v, 'rb'\); savePrefs\(p\);/.test(takeFn('knvSetFab')));
  ok('開いたまま変えたら、留めを選び直す', /knvLock\(false\); knvLock\(true\);/.test(takeFn('knvSetSize')));
  ok('一覧は、ほかの所を押したら畳む', /var m=\$\('knv-szmenu'\); if\(!m \|\| m\.classList\.contains\('hidden'\)\) return;/.test(takeFn('knvOutsideBind')));
}

// ③ 背後を留める・外側で閉じる・本体を寄せる
{
  ok('留めるのは スマホ か 中央に大きく', /if\(KNV_LOCK_Y!==null \|\| !\(knvNarrow\(\) \|\| knvCentered\(\)\)\) return;/.test(takeFn('knvLock')));
  ok('留めるときはスクロールバーの幅を埋める（本体が跳ねない）', /if\(sbw>0\) b\.style\.paddingRight=sbw\+'px';/.test(takeFn('knvLock'))
    && /b\.style\.paddingRight='';/.test(takeFn('knvLock')));
  ok('半分で並べているときは、外側を押しても閉じない', /if\(typeof knvDocked==='function' && knvDocked\(\)\) return;/.test(takeFn('knvOutside')));
  ok('並べるのは1200px以上だけ', /matchMedia\('\(min-width:1200px\)'\)/.test(takeFn('knvDocked')));
  const t = takeFn('knvToggle');
  ok('開くと knv-open', /document\.body\.classList\.add\('knv-open'\);/.test(t));
  ok('閉じると knv-open を外す', /document\.body\.classList\.remove\('knv-open'\);/.test(t));
  ok('別の道で隠すときも外す', /document\.body\.classList\.remove\('knv-open'\);/.test(takeFn('knvHideAll')));
  ok('本体を寄せる（右半分）', /body\.knv-open\.knv-sz-right #app\{padding-right:max\(600px,50vw\);\}/.test(SRC));
  ok('本体を寄せる（左半分）', /body\.knv-open\.knv-sz-left #app\{padding-left:max\(600px,50vw\);\}/.test(SRC));
  ok('半分の幅は週表示（555px）が入る600px以上', /width:max\(600px,50vw\);height:100vh;/.test(SRC));
  ok('中央の幕は、中央のときだけ', /body\.knv-open\.knv-sz-center #knv-scrim\{display:block;\}/.test(SRC) && /<div id="knv-scrim" aria-hidden="true"><\/div>/.test(SRC));
  ok('大きさの指定はパソコンだけ（601px以上）', /@media\(min-width:601px\)\{\n    \/\*  半分：/.test(SRC));
  ok('左のボタンは左メニュー（238px）に重ねない', /body\.knv-fab-lb \.knv-fab,body\.knv-fab-lt \.knv-fab\{right:auto;left:270px;\}/.test(SRC));
  ok('上のボタンは見出しの下', /body\.knv-fab-rt \.knv-fab,body\.knv-fab-lt \.knv-fab\{bottom:auto;top:84px;\}/.test(SRC));
}

// ④ 説明書・継ナビくんの知識
{
  ok('経営者の説明書', /<tr><th>継ナビくん<\/th><td><b>画面の大きさ<\/b>（標準・右半分・左半分・中央に大きく）と<b>ボタンの場所<\/b>/.test(R('manual-customer.html')));
  ok('パートナーの説明書', /<tr><th>継ナビくん<\/th><td><b>画面の大きさ<\/b>/.test(R('manual-partner.html')));
  ok('継ナビくんの知識', (SRC.match(/ボタンの場所は設定で右下・左下・右上・左上から/g) || []).length === 3);
}

console.log(bad.length ? bad.join('\n') : 'ALL OK', n + ' checks, ' + bad.length + ' failed');
process.exit(bad.length ? 1 : 0);
