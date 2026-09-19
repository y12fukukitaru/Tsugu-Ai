// =============================================================
// 【本日の予定】の段組み：1行目に時間と要件、場所は次の行に一段下げる
//   メール（emailHtml）・LINE（そのままの本文）・アプリ内（mdLite）の
//   3つとも、下げた行が潰れずに出ることを確かめる
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const FN = R('supabase/functions/agent-heartbeat/index.ts');
const VER = JSON.parse(R('version.json'));
let n = 0, bad = [];
function is(name, got, want) { n++; const g = JSON.stringify(got), w = JSON.stringify(want); if (g !== w) bad.push({ name, got: g, want: w }); }
function ok(name, cond) { is(name, !!cond, true); }
function no(name, cond) { is(name, !!cond, false); }

// ① Edge Function：予定は「時間と要件」と「場所」を分けて持つ
{
  ok('予定の型がある', /type AgendaItem = \{ text: string; place\?: string \| null \};/.test(FN));
  ok('場所は次の行に全角2つ下げる', /return items\.map\(\(a\) => \(a\.place \? `・\$\{a\.text\}\\n　　\$\{a\.place\}` : `・\$\{a\.text\}`\)\)\.join\("\\n"\);/.test(FN));
  ok('1行にまとめる形も残す（AIへの指示・reason欄）', /function agendaFlat\(a: AgendaItem\): string \{ return a\.place \? `\$\{a\.text\}（\$\{a\.place\}）` : a\.text; \}/.test(FN));
  no('組み立てのときに括弧で1行にしていない', /\$\{e\.place \? `（\$\{e\.place\}）` : ""\}/.test(FN));
  ok('今日の予定：時間と要件だけをtextに', /s: \{ text: `\$\{e\.all_day \? "終日" : fmtTimeJst\(e\.starts_at\)\} \$\{e\.title \?\? "予定"\}`, place: e\.place \}/.test(FN));
  ok('今週の予定：同じ形', /s: \{ text: `\$\{fmtDayTimeJst\(e\.starts_at, e\.all_day\)\} \$\{e\.title \?\? "予定"\}`, place: e\.place \}/.test(FN));
  ok('面談も同じ形', /s: \{ text: `\$\{fmtTimeJst\(m\.meet_at\)\} \$\{names\.get\(m\.customer_id\) \?\? "顧客"\}との面談`, place: m\.place \}/.test(FN));
  ok('本日・今週の枠が新しい形を使う', /return head \+ agendaLines\(agenda\) \+ "\\n\\n────────────\\n\\n";/.test(FN));
  is('枠は2か所（本日・今週）', (FN.match(/head \+ agendaLines\(agenda\)/g) || []).length, 2);
  ok('AIへの指示は1行の形', /agenda\.map\(\(a\) => "- " \+ agendaFlat\(a\)\)/.test(FN));
  ok('reason欄も1行の形', /agenda\.map\(\(a\) => "予定: " \+ agendaFlat\(a\)\)/.test(FN));
  no('素のまま連結している所が残っていない', /agenda\.map\(\(a\) => "- " \+ a\)|agenda\.map\(\(a\) => "予定: " \+ a\)|agenda\.map\(\(a\) => "・" \+ a\)/.test(FN));
}

// ② メール：下げた行が trim で潰れない
{
  ok('下げ幅を trim の前に控える', FN.indexOf('const indented = /^[ \\t\\u3000]/.test(line);') > 0);
  ok('下げた行は余白のある箱にする', /if \(l && indented\) l = `<div style="margin:0 0 0 1\.4em;color:#5A6981;">\$\{l\}<\/div>`;/.test(FN));
  ok('箱の前後の<br>は落とす', /\.replace\(\/<br>\(<div style="margin:0 0 0 1\\\.4em;\)\/g, "\$1"\)/.test(FN)
      && /\.replace\(\/\(<\\\/div>\)<br>\/g, "\$1"\)/.test(FN));
}

// ②-2 メール本文を実際に組んでみる
{
  const i = FN.indexOf('function emailHtml(');
  const end = FN.indexOf('\n}\n', i);
  const src = FN.slice(i, end + 3).replace('brief: { title: string; body: string }', 'brief');
  const emailHtml = new Function('MAIL_NOTE', 'MAIL_NOTE_DEFAULT', 'APP_URL', src + '\nreturn emailHtml;')({}, { eyebrow: 'e', foot: 'f', cta: 'c' }, 'u');
  const body = '**【本日の予定】**\n・終日 文化祭り\n\u3000\u3000安田幼稚園、広島市中区白島中町2-25\n・17:00 高重さん\n\n────────────\n\n文化祭りは終日。';
  const h = emailHtml({ title: '今日の一手', body });
  const inner = /<div style="font-size:14px[^>]*>([\s\S]*?)<\/div>\s*<div style="margin:18px/.exec(h)[1];
  ok('メール：場所は一段下げた箱で出る', /・終日 文化祭り<div style="margin:0 0 0 1\.4em;color:#5A6981;">安田幼稚園、広島市中区白島中町2-25<\/div>/.test(inner));
  no('メール：箱のうしろに余計な改行を入れない', /color:#5A6981;">[^<]*<\/div><br>/.test(inner));
  ok('メール：次の予定はそのまま続く', /<\/div>・17:00 高重さん/.test(inner));
  ok('メール：区切り線は残る', /border-top:1px solid #D8E0EC/.test(inner));
  ok('メール：見出しは太字', /<b>【本日の予定】<\/b><br>・終日/.test(inner));
}

// ②-3 LINE（素の文）では全角の下げがそのまま残る
{
  const i = FN.indexOf('function excerpt(');
  const end = FN.indexOf('\n}\n', i);
  const src = FN.slice(i, end + 3).replace('t: string, n: number', 't, n');
  const excerpt = new Function(src + '\nreturn excerpt;')();
  const out = excerpt('**【本日の予定】**\n・終日 文化祭り\n\u3000\u3000安田幼稚園\n\n本文。', 1400);
  is('LINE：下げた行はそのまま', out, '【本日の予定】\n・終日 文化祭り\n\u3000\u3000安田幼稚園\n\n本文。');
}

// ③ アプリ内（mdLite）：下げた行は直前の行に添えて出る
{
  const i = SRC.indexOf('\n  function mdLite(t){');
  const end = SRC.indexOf('\n  }\n', SRC.indexOf('return out.join', i));
  const e0 = SRC.indexOf('\n  function esc(s){');
  const mdLite = new Function(SRC.slice(e0, SRC.indexOf('\n', e0 + 1)) + SRC.slice(i, end + 4) + '\nreturn mdLite;')();

  const h = mdLite('**【本日の予定】**\n・終日 文化祭り\n\u3000\u3000安田幼稚園、広島市中区白島中町2-25\n・17:00 高重さん\n\n本文です。');
  ok('見出しは小見出しに', /<div class="ai-h">【本日の予定】<\/div>/.test(h));
  ok('場所は一段下げた箱で出る', /・終日 文化祭り<div style="margin:1px 0 0 1\.4em;font-size:\.92em;color:#5A6981;">安田幼稚園、広島市中区白島中町2-25<\/div>/.test(h));
  no('箱のうしろに余計な改行を入れない', /<\/div><br>/.test(h));
  ok('場所のない予定はそのまま次の行に', /<\/div>・17:00 高重さん/.test(h));
  ok('本文は別の段に', /<div style="margin:0 0 8px;line-height:1\.75;">本文です。<\/div>/.test(h));
  //  ふつうの文章と箇条書きは今までどおり
  const h2 = mdLite('あ\nい');
  is('ふだんの改行は<br>のまま', h2, '<div style="margin:0 0 8px;line-height:1.75;">あ<br>い</div>');
  const h3 = mdLite('- あ\n- い');
  ok('ふだんの箇条書きは変わらない', (h3.match(/<li /g) || []).length === 2 && !/margin:1px 0 0/.test(h3));
  //  「- 」で始まる箇条書きの下でも下げた行を拾う
  const h4 = mdLite('- 17:00 高重さん\n\u3000\u3000安田幼稚園');
  ok('箇条書きの中でも項目に入る', /<li style="margin:2px 0;">17:00 高重さん<div style="margin:1px 0 0;font-size:\.92em;color:#5A6981;">安田幼稚園<\/div><\/li>/.test(h4));
  //  行頭が下がっているだけの最初の行は、ふつうの行として出す（壊れない）
  ok('下げた行だけのときも落ちない', /安田幼稚園/.test(mdLite('\u3000\u3000安田幼稚園')));
}

// ④ 版
{
  const build = SRC.match(/var APP_BUILD='([^']+)'/)[1];
  is('版が揃う', [build, VER.build], ['20260919-01', '20260919-01']);
}
console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
