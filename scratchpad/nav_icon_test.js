// =============================================================
// 左メニューの絵の試験
//   絵が無いキーを渡されても icoSvg は黙って空を返すので、
//   抜けていても画面が壊れず、気づけません。ここで数えます。
//     ・メニューに出る項目は、全部 NAV_ICON に載っているか
//     ・NAV_ICON の指す絵が、ICON_PATH にあるか
//     ・icoSvg('…') の呼び出し先が、全部 ICON_PATH にあるか
// =============================================================
const fs = require('fs');
const SRC = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const VER = JSON.parse(fs.readFileSync(__dirname + '/../version.json', 'utf8'));
let n = 0, bad = [];
function is(name, got, want) { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) bad.push({ name, got: g, want: w }); }
function ok(name, cond) { is(name, !!cond, true); }

const PATHS = new Set([...SRC.match(/var ICON_PATH=\{[\s\S]*?\n  \};/)[0].matchAll(/\n    ([a-zA-Z]+):'/g)].map((x) => x[1]));
const NAV = [...SRC.match(/var NAV_ICON=\{[\s\S]*?\};/)[0].matchAll(/'(sec-[a-z]+)':'([a-zA-Z]+)'/g)].map((x) => [x[1], x[2]]);
const MAPPED = new Set(NAV.map((x) => x[0]));

// ① メニューに出る項目に、絵が付いているか
//    ['sec-xxx','名前'] の形で書かれたものだけを拾う（要素のIDは拾わない）
const MENU = [...new Set([...SRC.matchAll(/\['(sec-[a-z]+)','(?![a-z-]+'\])/g)].map((x) => x[1]))];
is('絵の無いメニュー項目', MENU.filter((id) => !MAPPED.has(id)), []);
ok('メニューは10項目以上ある（拾い方が壊れていないこと）', MENU.length >= 10);

// ② NAV_ICON の指す絵が、本当にあるか
is('NAV_ICON が指す先で、絵の無いもの', NAV.filter((x) => !PATHS.has(x[1])).map((x) => x[0]), []);

// ③ 画面のどこかで icoSvg('…') と書かれた先が、全部あるか
const CALLS = [...new Set([...SRC.matchAll(/icoSvg\('([a-zA-Z]+)'\)/g)].map((x) => x[1]))];
is('icoSvg の呼び出し先で、絵の無いもの', CALLS.filter((k) => !PATHS.has(k)), []);

// ④ 今回足した2つ
is('出口の設計は扉', NAV.filter((x) => x[0] === 'sec-exit').map((x) => x[1]), ['door']);
is('買った後に備えるは鍵', NAV.filter((x) => x[0] === 'sec-after').map((x) => x[1]), ['key']);
ok('扉は部屋の外へ出る形', /door:'<path d="M9\.5 21H5/.test(SRC));
ok('鍵は横向きで刻みがある', /key:'<circle cx="7" cy="12" r="5"\/><path d="M12 12h9"/.test(SRC));

// ⑤ 絵はすべて同じ寸法・同じ描き方（24四方・線だけ）で書かれているか
{
  const body = SRC.match(/var ICON_PATH=\{[\s\S]*?\n  \};/)[0];
  const nums = [...body.matchAll(/(?:cx|cy|x|y|width|height)="([0-9.]+)"/g)].map((x) => Number(x[1]));
  is('24四方からはみ出す座標は無い', nums.filter((v) => v > 24), []);
  ok('塗りは使わない（線だけ）', body.indexOf('fill="') < 0);
  ok('icoSvg は 24 四方・線・角丸で描く', /viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1\.5" stroke-linecap="round"/.test(SRC));
}

// ⑥ 版
{
  const build = SRC.match(/var APP_BUILD='([^']+)'/)[1];
  is('版が揃う', [build, VER.build], ['20260924-03', '20260924-03']);
}

console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
