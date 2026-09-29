// =============================================================
// 専門家と連携／資格の確認で預かるもの（2026-09-29）
//   ① IT・自動化は資格ではない：本業と連携の「保有資格」から外し、専門家と連携で扱う
//   ② パートナーのポータルに「専門家と連携」（顧客カルテのAI自動化診断から会社名つきで開ける）
//   ③ 資格証の写しは預からない：登録番号だけ。運営は名簿で照合／その場で見せてもらう
//      確認済みの番号は末尾4桁表示。以前の写しは確認時に削除。契約終了で資格の記録を消す
//   ④ SQL・説明書・継ナビくんの知識
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const SQL = R('supabase/migrations/20260929000000_license_minimize.sql');
const MANP = R('manual-partner.html'), MANA = R('manual-admin.html');
let n = 0, bad = [];
function ok(name, c) { n++; if (!c) bad.push(name); }
function takeFn(name) {
  const re = new RegExp('\\n  (?:async )?function ' + name + '\\s*\\(', 'g');
  let m, last = null, cnt = 0;
  while ((m = re.exec(SRC)) !== null) { last = m; cnt++; }
  if (!last) throw new Error('見つかりません: ' + name);
  ok('定義は一つだけ: ' + name, cnt === 1);
  return SRC.slice(last.index, SRC.indexOf('\n  }\n', last.index) + 4);
}
const block = (name) => { const i = SRC.indexOf('\n  var ' + name + '='); return i < 0 ? '' : SRC.slice(i, SRC.indexOf(';\n', i) + 2); };

// ① IT・自動化の置き場所
const BF = block('BIZ_FIELDS');
ok('保有資格の領域は7つ（ITは入らない）', (BF.match(/\{ id:'/g) || []).length === 7 && !/'it'/.test(BF));
ok('IT・自動化は資格の要らない領域として別に持つ', /var IT_FIELD=\{ id:'it', n:'IT・自動化', lic:'（資格要件なし）', desc:'業務のデジタル化・ツール導入・自動化の実装' \};/.test(SRC));
ok('専門家につなぐ領域は、資格の7つ＋IT・自動化', /var EXPERT_FIELDS=BIZ_FIELDS\.concat\(\[IT_FIELD\]\);/.test(SRC));
ok('主戦場に「その他（資格の要らない本業）」', /var BIZ_MAIN_OTHER=\{ id:'other', n:'その他（資格の要らない本業）' \};/.test(SRC) && /BIZ_FIELDS\.concat\(\[BIZ_MAIN_OTHER\]\)\.map/.test(takeFn('renderBiz')));
ok('保有資格のボタンは資格の7つだけ', /\+BIZ_FIELDS\.map\(function\(f\)\{\s*var on=P\.lic\.indexOf\(f\.id\)>=0;/.test(takeFn('renderBiz')));
ok('以前の登録から IT を外す（主戦場の IT は「その他」へ）', /BIZ\.profile\.lic=\(BIZ\.profile\.lic\|\|\[\]\)\.filter\(bizIsLic\);/.test(takeFn('bizLoad')) && /if\(BIZ\.profile\.main==='it'\) BIZ\.profile\.main=BIZ_MAIN_OTHER\.id;/.test(takeFn('bizLoad')));
ok('名前は IT・その他も引ける', /EXPERT_FIELDS\.concat\(\[BIZ_MAIN_OTHER\]\)/.test(takeFn('bizFieldName')));
ok('実行できる領域は確認済みだけ（「確認不要」は無くした）', /return \(lic\|\|\[\]\)\.indexOf\(f\.id\)>=0 && licStatus\(f\.id\)==='approved';/.test(takeFn('licExecFields')));
ok('実行体制も IT を資格に数えない', /split\(','\)\.filter\(bizIsLic\)/.test(takeFn('netExecLicenses')) && !/id==='it'/.test(takeFn('netExecLicenses')));
ok('運営の実行体制・名簿の領域は IT を含む', /EXPERT_FIELDS\.forEach\(function\(f\)\{ byField\[f\.id\]/.test(SRC) && /id="nx-field"[^\n]*\n\s*\+EXPERT_FIELDS\.map/.test(SRC));
ok('紹介の依頼の領域は IT を含む', /id="rf-field"[^\n]*\n\s*\+EXPERT_FIELDS\.map/.test(SRC));
ok('本業と連携には名簿を置かず、専門家と連携へ案内', !/id="ref-box"/.test(takeFn('renderBiz')) && /goSec\(\\'sec-experts\\'\)">専門家と連携 →<\/button>/.test(takeFn('renderBiz')));

// ② 専門家と連携
ok('メニュー：本業と連携の次に「専門家と連携」', /\['sec-biz','本業と連携'\],\['sec-experts','専門家と連携'\]/.test(SRC));
ok('メニューの組：広げる に入る', /\['広げる','新しい顧客・本業と専門家とのつながり',\['sec-sales','sec-biz','sec-experts'\]\]/.test(SRC));
ok('メニューのアイコン', /'sec-experts':'net'/.test(SRC));
ok('画面：専門家と連携のパネル', /<div class="panel" id="sec-experts">/.test(SRC) && /<div id="exp-body">読み込み中\.\.\.<\/div>/.test(SRC));
ok('パートナーの読み込みで開く', /loadBiz\(\)\.then\(loadExperts\)/.test(SRC));
const re = takeFn('renderExperts');
ok('領域の札（IT・自動化は青緑、あなたが実行の印）', /EXPERT_FIELDS\.map/.test(re) && /あなたが実行/.test(re) && /refPrefill\(\\''\+f\.id\+'\\'\)/.test(re));
ok('名簿と依頼はそのまま使う', /<div id="ref-box">読み込み中\.\.\.<\/div>/.test(re) && /renderRefBox\(\);/.test(re));
const go = takeFn('expToExperts');
ok('カルテから：会社名と領域を入れて開く', /CURRENT_CLIENT\.company/.test(go) && /closeClientModal\(\)/.test(go) && /goSec\('sec-experts'\)/.test(go) && /refPrefill\(field\|\|'it', cust\);/.test(go));
ok('カルテのAI自動化診断に入口', /onclick="expToExperts\(\\'it\\'\)">専門家と連携で依頼 →<\/button>/.test(SRC)
  && SRC.indexOf("expToExperts(\\'it\\')") > SRC.indexOf('<div class="ph" id="cs-ai"'));
ok('紹介の依頼：会社名も入れられる', /if\(cust!=null\)\{ var c=\$\('rf-cust'\); if\(c\) c\.value=cust; \}/.test(takeFn('refPrefill')));

// ③ 資格の確認で預かるもの
const rows = takeFn('licRowsHtml');
ok('写しを選ぶ欄は無い', !/type="file"/.test(rows) && !/licFileNote/.test(SRC));
ok('預かるのは番号だけ・使い道・見える人・消す時期', /資格証の写しはお預かりしません/.test(rows) && /資格の確認のためだけ/.test(rows) && /ご本人と運営だけ/.test(rows) && /ご契約が終わったときに消します/.test(rows));
const sub = takeFn('licSubmit');
ok('番号が無ければ出せない', /資格の登録番号を入れてください。/.test(sub) && !/upload/.test(sub) && /var row=\{ user_id:ME, field:id, reg_no:no \};/.test(sub));
ok('確認の方法は3つ（名簿・その場で提示・所属先）', /var LIC_VIA=\[\['registry','公開の名簿で照合した'\],\['shown','資格証をその場で見せてもらった（写しは預からない）'\],\['affiliation','所属先（代理店・事務所）に確かめた'\]\];/.test(SRC));
{
  const mask = new Function(takeFn('licMask') + '; return licMask;')();
  ok('確認済みの番号は末尾4桁', mask('1234567') === '•••4567' && mask('123') === '123' && mask('12345678901234') === '••••••1234');
}
const rv = takeFn('netLicReview');
ok('確認済みにするとき方法を残す', /upd\.verified_via=via/.test(rv) && /\$\('lv-'\+uid\+'-'\+field\)/.test(rv));
ok('方法の列が無い環境でも確認は済ませる', /\/verified_via\/\.test/.test(rv) && /delete upd\.verified_via/.test(rv));
ok('確認済みにしたら以前の写しを消す', /if\(l && l\.file_path\)\{ var er=await licDropFile\(l\);/.test(rv));
ok('写しの削除はファイルと参照の両方', /storage\.from\('license-docs'\)\.remove\(\[l\.file_path\]\)/.test(takeFn('licDropFile')) && /update\(\{ file_path:null, file_name:null \}\)/.test(takeFn('licDropFile')));
ok('残っている写しをまとめて削除', /確認が済んだのに、以前お預かりした資格証の写しが/.test(SRC) && /licDropFile\(olds\[i\]\)/.test(takeFn('netLicDropAll')));
ok('契約の終了を対応済みにしたら資格の記録を消す', /if\(pid\) await licPurge\(pid\);/.test(takeFn('admPexitDone')) && /\.delete\(\)\.eq\('user_id',uid\)/.test(takeFn('licPurge')));
ok('差し戻しの文面も「写しは預からない」', /写しはお預かりしません）。'\);/.test(rv));

// ④ SQL
ok('SQL：確認の方法の列（3つ）', /add column if not exists verified_via text;/.test(SQL) && /verified_via in \('registry','shown','affiliation'\)/.test(SQL));
ok('SQL：番号か写しは確認待ちのあいだだけ要る', /check \(status <> 'pending' or coalesce\(btrim\(reg_no\),''\) <> '' or coalesce\(file_path,''\) <> ''\);/.test(SQL));
ok('SQL：本人は写しの参照を付けられず、方法も書けない', /new\.verified_via := null;/.test(SQL) && /new\.file_path := old\.file_path;/.test(SQL) && /new\.file_path := null;/.test(SQL));
ok('SQL：本人のアップロードをやめる', /drop policy if exists "license docs own upload" on storage\.objects;/.test(SQL) && !/create policy "license docs own upload"/.test(SQL));
ok('SQL：運営は写しを消せる', /create policy "license docs admin delete" on storage\.objects\s+for delete to authenticated\s+using \(bucket_id = 'license-docs' and public\.ep_is_admin\(\)\);/.test(SQL));
ok('SQL：何度流しても同じ・確かめかた', /何度流しても同じ結果になります/.test(SQL) && /確認の方法の列=1/.test(SQL) && /写しのアップロード=0/.test(SQL) && /運営の削除=1/.test(SQL));

// 説明書・知識
ok('説明書（パートナー）：主戦場に IT は無い', /資金調達・財務／その他（資格の要らない本業）<\/span>/.test(MANP) && !/資金調達・財務／IT・自動化/.test(MANP));
ok('説明書（パートナー）：写しは預からない', /<b>資格証の写しはお預かりしません。<\/b>/.test(MANP));
ok('説明書（パートナー）：専門家と連携の頁', /data-t="専門家と連携"/.test(MANP) && /左メニューの<b>「専門家と連携」<\/b>/.test(MANP) && /<tr><th>専門家と連携<\/th>/.test(MANP));
ok('説明書（運営）：写しは預からない・4桁・契約終了で消す', /<b>資格証の写しは預からない<\/b>/.test(MANA) && /末尾4桁/.test(MANA) && /その方の資格の記録も消える/.test(MANA));
ok('知識：本業と連携に IT は入らない・写しは預からない', /IT・自動化は資格ではないので入らない/.test(SRC) && /資格証の写しは預からない。番号は資格の確認だけに使い/.test(SRC));
ok('知識：専門家と連携', /／専門家と連携=資格外の領域と、IT・自動化/.test(SRC));
ok('知識：各種シミュレーターは本業と連携の中のまま', /本業と連携=[^／]*各種シミュレーター[^／]*この画面の中から開く/.test(SRC));

if (bad.length) { bad.forEach((b) => console.log('NG ' + b)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK ' + n + ' checks, 0 failed');
