// =============================================================
// 消した予定を、Googleカレンダーからも消す（墓標＝agenda_deletions）
//   ・墓標を立てるのは source='tsugu' だけ。取り込んだ予定には立てない
//     （連携の解除・取り込むカレンダーのチェック外しで、本物のGoogleの
//       予定がまとめて消える事故を、作りの側で起こらなくする）
//   ・同期が墓標をたどってGoogle側を消し、消せたら墓標を下ろす
//   ・押す前に、何が起きるかを伝える
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const SQL = R('supabase/migrations/20260919010000_agenda_deletions.sql');
const FN = R('supabase/functions/google-sync/index.ts');
const MANC = R('manual-customer.html'), MANP = R('manual-partner.html');
const VER = JSON.parse(R('version.json'));
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

// ① 墓標の表
{
  ok('表を作る', /create table if not exists public\.agenda_deletions \(/.test(SQL));
  ok('番号だけ持つ（題名や日時は持たない）', /google_id  text not null,/.test(SQL)
      && !/title/.test(SQL.slice(SQL.indexOf('create table if not exists public.agenda_deletions'), SQL.indexOf('alter table public.agenda_deletions'))));
  ok('同じ予定の墓標は一つ', /create unique index if not exists agenda_deletions_uniq\s*\n\s*on public\.agenda_deletions \(user_id, google_id\);/.test(SQL));
  ok('アカウントを解除したら墓標も消える', /link_id    uuid references public\.google_cal_links\(id\)        on delete cascade,/.test(SQL));
  ok('利用者ごと消えたら墓標も消える', /user_id    uuid not null references auth\.users\(id\)            on delete cascade,/.test(SQL));
  ok('RLSを入れる', /alter table public\.agenda_deletions enable row level security;/.test(SQL));
  ok('画面からは触らせない', /revoke all on public\.agenda_deletions from authenticated, anon, public;/.test(SQL));
  ok('service_role だけに渡す', /grant all on public\.agenda_deletions to service_role/.test(SQL));
}

// ② 引き金（ここが事故を防ぐ要）
{
  const i = SQL.indexOf('create or replace function public.agenda_event_deleted()');
  const f = SQL.slice(i, SQL.indexOf('$$;', i) + 3);
  ok('SECURITY DEFINER（消した本人は書けない表のため）', /security definer/.test(f));
  ok('search_path を固定する', /set search_path = public, pg_temp/.test(f));
  //  引き金の関数から EXECUTE を取り上げると、予定そのものが消せなくなる
  no('実行権限を取り上げていない', /revoke all on function public\.agenda_event_deleted\(\)/.test(SQL));
  ok('取り上げない理由を書いてある', /取り上げると予定そのものが消せなくなります/.test(SQL));
  ok('Googleに出ていない予定には立てない', /if old\.google_id is null or old\.google_id = '' then\s*\n\s*return old;/.test(f));
  ok('★取り込んだ予定には立てない★', /if coalesce\(old\.source, 'tsugu'\) <> 'tsugu' then\s*\n\s*return old;/.test(f));
  ok('立てるときは番号と行き先だけ', /insert into public\.agenda_deletions \(user_id, google_id, link_id, cal_id\)\s*\n\s*values \(old\.owner_id, old\.google_id, old\.link_id, old\.cal_id\)\s*\n\s*on conflict \(user_id, google_id\) do nothing;/.test(f));
  ok('消えたあとに走る（after delete）', /create trigger agenda_events_deleted\s*\n\s*after delete on public\.agenda_events\s*\n\s*for each row execute function public\.agenda_event_deleted\(\);/.test(SQL));
  ok('入れ直しても同じ結果', /drop trigger if exists agenda_events_deleted on public\.agenda_events;/.test(SQL));
  ok('確かめの問い合わせが付いている', /as 墓標の表,/.test(SQL) && /as 引き金,/.test(SQL) && /as 画面から読めるか;/.test(SQL));
}

// ③ 同期がGoogle側を消す
{
  ok('墓標を一度だけ読む', /const \{ data: graves \} = await sb\.from\("agenda_deletions"\)\s*\n\s*\.select\("id, google_id, link_id, cal_id"\)\.eq\("user_id", uid\)\.limit\(200\);/.test(FN));
  ok('数え上げる', /let pushed = 0, pulled = 0, removed = 0, deleted = 0;/.test(FN));
  ok('二度触らない', /const doneGraves = new Set<string>\(\);/.test(FN) && /if \(doneGraves\.has\(gv\.id\)\) continue;/.test(FN));
  ok('どのアカウントが引き受けるか', /const here = gv\.link_id \? gv\.link_id === link\.id : !!link\.push_target;/.test(FN));
  ok('カレンダーを指して消す', /const evUrl = \(cal: string\) =>/.test(FN)
      && /const url = `\$\{evUrl\(gv\.cal_id \|\| CAL\)\}\/\$\{encodeURIComponent\(gv\.google_id\)\}`;/.test(FN));
  ok('DELETE を投げる', /const r = await fetch\(url, \{ method: "DELETE", headers: H \}\);/.test(FN));
  ok('消えた・すでに無いなら墓標を下ろす', /if \(r\.ok \|\| r\.status === 404 \|\| r\.status === 410\) \{/.test(FN)
      && /if \(r\.ok\) deleted\+\+;/.test(FN));
  ok('見るだけのカレンダーは書き残して下ろす', /\} else if \(r\.status === 403\) \{/.test(FN)
      && /lnotes\.push\("Googleからは消せませんでした（見るだけのカレンダーです）"\);/.test(FN));
  ok('それ以外は次の同期でもう一度', /lnotes\.push\(`Googleから消せませんでした（\$\{r\.status\}）`\);/.test(FN));
  ok('行き先の無い墓標は30日で掃除', /\.eq\("user_id", uid\)\.lt\("created_at", new Date\(Date\.now\(\) - 30 \* DAY\)\.toISOString\(\)\);/.test(FN));
  ok('件数を返す', /return json\(\{ ok: true, pushed, pulled, removed, deleted, relink, accounts: live\.length, notes: notes\.slice\(0, 3\) \}\);/.test(FN));
  ok('頭の説明にも足す', /②-2 こちらで消した予定を Google からも消す（墓標をたどる）/.test(FN));
}

// ④ 押す前に、何が起きるかを伝える
{
  const f = takeFn('calDelete');
  ok('予定の行から見分ける', /var fromG=!!\(row && row\.g\);/.test(f) && /var onG=!!\(row && row\.gid && !fromG\);/.test(f));
  ok('こちらの予定：向こうからも消えると言う', /if\(onG\) q\+='Googleカレンダーからも消えます。';/.test(f));
  ok('取り込んだ予定：向こうには残ると言う', /else if\(fromG\) q\+='これはGoogleから取り込んだ予定です。この画面からは消えますが、Googleカレンダーには残ります（Google側でも消してください）。';/.test(f));
  ok('こちらの予定のときだけ同期を走らせる', /if\(onG\) gcalPushNow\(\);/.test(f));
  no('取り込んだ予定で無駄に呼ばない', /^\s*gcalPushNow\(\);\s*$/m.test(f));
  ok('番号を持たせている', /gid:e\.google_id\|\|'', calId:e\.cal_id\|\|''/.test(takeFn('calFetch')));
  ok('同期の結果に件数を出す', /if\(j\.deleted\) t\.push\('Googleから消し '\+j\.deleted\+'件'\);/.test(takeFn('googleCalSync')));
}

// ⑤ 言い方（画面・説明書・継ナビくんの知識）
{
  ok('連携欄', /この画面で入れた予定は、直しても消しても、そのままGoogleに出ます（押す必要はありません）。Googleから取り込んだ予定をこの画面で消した場合は、Google側には残ります。/.test(SRC));
  is('継ナビくんの知識（経営者・パートナー）', (SRC.match(/ただしGoogleから取り込んだ予定をこの画面で消したときは、この画面から消えるだけでGoogle側には残る/g) || []).length, 2);
  [['経営者説明書', MANC], ['パートナー説明書', MANP]].forEach(([w, s]) => {
    ok(w + '：入れた予定は消してもGoogleに出る', /<b>この画面で入れた予定は、直しても消しても、その場でGoogleに出ます<\/b>/.test(s));
    ok(w + '：取り込んだ予定は残る', /<b>Googleカレンダーには残ります<\/b>（削除を押す前にその旨が出ます）。Google側でも消してください。/.test(s));
    ok(w + '：なぜそうしているかも書く', /家族や共有のカレンダーの予定を、こちらの操作でほかの方のぶんまで消してしまわないための決まりです。/.test(s));
    no(w + '：古い言い方が残っていない', /この画面で消した予定はGoogle側に残ります/.test(s));
  });
  ok('パートナー説明書：次回面談も同じ', /カルテで決めた次回面談も同じで、保存した時点でGoogleに出ます。/.test(MANP));
}

// ⑥ 版
{
  const build = SRC.match(/var APP_BUILD='([^']+)'/)[1];
  is('版が揃う', [build, VER.build], ['20260919-02', '20260919-02']);
}
console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
