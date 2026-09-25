// =============================================================
// 朝の便りの前に、Googleカレンダーを取り込む
//   ・google-sync に service_role からの入口を足す（user_id を本文で受ける）
//   ・agent-heartbeat が、予定を読む前にそれを呼ぶ（つないでいる方だけ）
//   ・20秒で見切り、失敗しても便りは出す
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const HB = R('supabase/functions/agent-heartbeat/index.ts');
const GS = R('supabase/functions/google-sync/index.ts');
const DOC = R('docs/google-calendar-setup.md');
const MANC = R('manual-customer.html'), MANP = R('manual-partner.html');
const VER = JSON.parse(R('version.json'));
let n = 0, bad = [];
function is(name, got, want) { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) bad.push({ name, got: g, want: w }); }
function ok(name, cond) { is(name, !!cond, true); }
function no(name, cond) { is(name, !!cond, false); }

// ① google-sync：運営の仕組みからの入口
{
  ok('合鍵かどうかを最後まで見て比べる', /function sameSecret\(a: string, b: string\): boolean \{/.test(GS)
      && /for \(let i = 0; i < a\.length; i\+\+\) diff \|= a\.charCodeAt\(i\) \^ b\.charCodeAt\(i\);/.test(GS));
  no('== での付き合わせを残していない', /token === SERVICE_KEY/.test(GS));
  ok('service_role なら本文から誰のぶんかを読む', /if \(sameSecret\(token, SERVICE_KEY\)\) \{/.test(GS)
      && /uid = String\(\(body as any\)\?\.user_id \?\? ""\);/.test(GS));
  ok('user_id が無ければ断る', /if \(!uid\) return json\(\{ ok: false, error: "user_id が要ります" \}, 400\);/.test(GS));
  ok('それ以外は今までどおりログインを確かめる', /const \{ data: u, error: ue \} = await sb\.auth\.getUser\(token\);/.test(GS));
  ok('鍵が無ければ何もしない', /if \(!token\) return json\(\{ ok: false, error: "ログインが必要です" \}, 401\);/.test(GS));
  ok('頭の説明に誰が呼ぶかを書く', /■ 誰が呼ぶか/.test(GS) && /毎朝の便り（agent-heartbeat）… service_role の鍵で/.test(GS));
}

// ② agent-heartbeat：便りを作る前に呼ぶ
{
  ok('呼ぶ関数がある', /async function syncGoogle\(userId: string\) \{/.test(HB));
  ok('service_role の鍵で、user_id を添えて呼ぶ', /headers: \{ authorization: `Bearer \$\{SERVICE_KEY\}`, "content-type": "application\/json" \},/.test(HB)
      && /body: JSON\.stringify\(\{ user_id: userId \}\),/.test(HB));
  ok('20秒で見切る', /const t = setTimeout\(\(\) => ac\.abort\(\), 20000\);/.test(HB) && /signal: ac\.signal,/.test(HB));
  ok('見切りの札は必ず片づける', /\} finally \{\s*\n\s*clearTimeout\(t\);\s*\n\s*\}/.test(HB));
  ok('失敗しても便りは出す', /console\.error\("google sync skipped:", userId, String\(\(e as Error\)\.message\)\);/.test(HB));
  ok('つないでいる方の一覧を引く', /async function googleLinked\(sb: any\): Promise<Set<string>> \{/.test(HB)
      && /\.select\("user_id"\)\.not\("refresh_enc", "is", null\);/.test(HB));
  ok('表がまだ無い環境でも止めない', /\} catch \{ return new Set<string>\(\); \}   \/\/ 表がまだ無い環境でも止めない/.test(HB));
  //  毎朝（パートナー）と毎週（経営者）の両方。どちらも自分の場所で一覧を引く
  is('一覧を引くのは2か所（毎朝・毎週）', (HB.match(/const linked = await googleLinked\(sb\);/g) || []).length, 2);
  ok('毎朝：予定を読む前に取り込む', /if \(linked\.has\(partnerId\)\) await syncGoogle\(partnerId\);\s*\n\s*\n\s*const signals = await collectSignals\(sb, customerIds\);\s*\n\s*const agenda = await todayAgenda\(sb, partnerId, customerIds\);/.test(HB));
  ok('毎週：今週の予定を読む前に取り込む', /if \(linked\.has\(c\.id\)\) await syncGoogle\(c\.id\);   \/\/ 今週の予定を読む前に取り込む\s*\n\s*const agenda = await weekAgenda\(sb, c\.id\);/.test(HB));
  //  二重生成を避ける確かめのあと。出さない相手のぶんまで取り込まない
  const i = HB.indexOf('if (dup?.length) continue;');
  ok('毎朝：二重生成の確かめより後', i > 0 && HB.indexOf('if (linked.has(partnerId)) await syncGoogle(partnerId);') > i);
}

// ③ 説明書と手引き
{
  ok('パートナー説明書：朝の便りの前に取り込む', /<b>毎朝の「今日の一手」だけは、届く前に取り込みます。<\/b>/.test(MANP)
      && /Googleにだけ入れて一度もTsuguAiを開いていない予定も、朝の便りにはきちんと出ます。/.test(MANP));
  no('パートナー説明書：古い言い方が残っていない', /朝の便りに出ません。前の晩に予定タブを一度開いておくと確実です。/.test(MANP));
  ok('経営者説明書：月曜の便りの前に取り込む', /<b>毎週月曜の「今週のひとこと」だけは、届く前に取り込みます。<\/b>/.test(MANC));
  is('継ナビくんの知識にも入れる', (SRC.match(/本文を作る前にこちらからGoogleを見にいくので、画面を開いていなくてもGoogleの予定が入る。/g) || []).length, 2);
  ok('手引き：もう一つの入口を書く', /`google-sync` には、もう一つの入口があります。/.test(DOC));
  ok('手引き：版を揃える注意', /\*\*`agent-heartbeat` を入れ替えたときは、`google-sync` も同じ版に揃えてください\*\*/.test(DOC));
}

// ④ 版
{
  const build = SRC.match(/var APP_BUILD='([^']+)'/)[1];
  is('版が揃う', [build, VER.build], ['20260925-01', '20260925-01']);
}
console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
