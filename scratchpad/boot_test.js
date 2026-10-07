// =============================================================
// 「急に白くなる」への手当て（2026-10-07）
//   ① アプリは自分で読み込み直さない（版の確認は帯を出すだけ・時計で reload しない）
//   ② 最初の描画で起動中の幕を出す。Supabase と文字（Google Fonts）は描画を止めない
//   ③ init の終わりで必ず幕を消す（失敗しても・通信が止まっても15秒で）
//   ④ 読み込み直したときだけ、開いていた画面・カルテ・位置に戻す
//   ⑤ 暗い画面の方は幕も暗く・継ナビくんの知識
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
let n = 0, bad = [];
function ok(name, c) { n++; if (!c) bad.push(name); }
const head = SRC.slice(0, SRC.indexOf('<body>')), body = SRC.slice(SRC.indexOf('<body>'));
const main = SRC.slice(SRC.indexOf('<script>\n'), SRC.lastIndexOf('</script>'));

// ①
ok('版の確認は帯を出すだけ', /UPD_SEEN=true;\s*var b=\$\('upd-bar'\); if\(b\) b\.classList\.remove\('hidden'\);/.test(SRC) && !/appVerCheck[\s\S]{0,400}location\.reload/.test(SRC.slice(SRC.indexOf('async function appVerCheck'), SRC.indexOf('async function appVerCheck') + 500)));
ok('時計で読み込み直さない', !/setInterval\([^)]*reload/.test(SRC) && !/setTimeout\([^)]*location\.reload/.test(SRC));
ok('読み込み直すのは「最新に更新する」を押したときと、はじめの設定に失敗したときだけ', /function appReload\(\)\{ location\.reload\(\); \}/.test(SRC) && (SRC.match(/location\.reload\(\)/g) || []).length === 2);

// ②
ok('head で Supabase を読まない（描画を止めない）', !/supabase-js@2/.test(head));
ok('幕のあとで Supabase を読む（本体のスクリプトより前）', body.indexOf('<div id="boot"') >= 0 && body.indexOf('<div id="boot"') < body.indexOf('supabase-js@2') && body.indexOf('supabase-js@2') < body.indexOf('const sb = supabase.createClient'));
ok('文字（Google Fonts）は preload で、描画を止めない', /<link rel="preload" as="style" href="https:\/\/fonts\.googleapis\.com[^"]+" onload="this\.onload=null;this\.rel='stylesheet'">/.test(head) && /<noscript><link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com/.test(head) && !/<link href="https:\/\/fonts\.googleapis\.com[^>]+rel="stylesheet">/.test(head));
ok('幕は最初から見えて、何も読まずに描ける（CSS は head の中）', /#boot\{position:fixed;inset:0;z-index:9999;/.test(head) && /<div id="boot" role="status" aria-live="polite">/.test(body) && /読み込んでいます…/.test(body));
ok('動きを控える設定では点を動かさない', /@media \(prefers-reduced-motion: reduce\)\{ #boot \.bd i\{animation:none;/.test(head));

// ③
ok('init は finally で必ず幕を消す', /\} finally \{ bootDone\(\); \}\s*\}\)\(\);/.test(SRC));
ok('通信が止まっても15秒で幕を消す', /setTimeout\(bootDone, 15000\);/.test(SRC));
ok('幕は薄くしてから外す', /b\.style\.opacity='0';\s*setTimeout\(function\(\)\{ if\(b\.parentNode\) b\.parentNode\.removeChild\(b\); \}, 260\);/.test(SRC));

// ④
ok('裏に回すとき・離れるときに、いまの場所を覚える（このタブだけ）', /else appResumeSave\(\);/.test(SRC) && /window\.addEventListener\('pagehide', appResumeSave\);/.test(SRC) && /sessionStorage\.setItem\(RESUME_KEY,/.test(SRC));
ok('戻すのは読み込み直したときだけ（破棄・reload・戻る）', /document\.wasDiscarded/.test(SRC) && /n\.type==='reload' \|\| n\.type==='back_forward'/.test(SRC) && /!appWasReloaded\(\)/.test(SRC));
ok('別の人・12時間より古い記録では戻さない', /r\.me!==ME/.test(SRC) && /Date\.now\(\)-r\.t>12\*3600\*1000/.test(SRC));
ok('パートナーは開いていたカルテに戻る（経営者は開かない）', /viewClient\(r\.client\.id, r\.client\.email, r\.client\.company\)/.test(SRC) && /currentRole\(\)!=='customer'/.test(SRC));
ok('位置は届いたころに一度だけ・触っていたら何もしない', /setTimeout\(function\(\)\{ if\(!moved\) window\.scrollTo\(0, r\.y\); \}, 1200\);/.test(SRC));
ok('ログインのあとで戻す', /await routeFromSession\(s\.data\.session\); appResumeRestore\(\);/.test(SRC));

// ⑤
ok('暗い画面の方は幕も暗い（前回の設定を覚えておく）', /localStorage\.setItem\('tsugu_boot_dark', p\.dark===true\?'1':'0'\)/.test(SRC) && /<script id="boot-theme">try\{ if\(localStorage\.getItem\('tsugu_boot_dark'\)==='1'\) document\.getElementById\('boot'\)\.classList\.add\('dark'\); \}catch\(e\)\{\}<\/script>/.test(body) && /#boot\.dark\{background:#0C0F16;/.test(head));
ok('継ナビくんの知識（パートナー・経営者の両方）', (SRC.match(/画面が急に白くなる・読み込み直される→アプリが自分で読み込み直すことはない。/g) || []).length === 2);

if (bad.length) { bad.forEach((b) => console.log('NG ' + b)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK ' + n + ' checks, 0 failed');
