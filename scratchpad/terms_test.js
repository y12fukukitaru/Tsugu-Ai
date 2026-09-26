// =============================================================
// 言い方の統一：融資 → デット、出資・投資 → エクイティ（区分・見出し・商品名）
//   制度の正式名（制度融資・保証協会付融資など）と、銀行に見せる資料の言い方は変えない
//   ＋ 商談用のプロダクト説明に、今日の追加分（8つの出口・株の持ち方）が入っていること
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html');
const MANC = R('manual-customer.html'), MANP = R('manual-partner.html'), MANA = R('manual-admin.html');
const PITC = R('pitch-customer.html'), PITP = R('pitch-partner.html'), PITG = R('pitch-general.html'), PITB = R('pitch-bank.html');
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
  const end = SRC.indexOf('\n  }\n', last.index);
  return SRC.slice(last.index, end + 4);
}
function takeArr(name) { const i = SRC.indexOf('\n  var ' + name + '=['); const end = SRC.indexOf('\n  ];', i); return SRC.slice(i, end + 5); }

// ① 商品名と区分
{
  const ALL = [['index', SRC], ['経営者説明書', MANC], ['パートナー説明書', MANP], ['運営説明書', MANA], ['経営者向け資料', PITC]];
  ALL.forEach(([w, s]) => {
    no(w + '：「投資・融資・M&A」が残っていない', /投資・融資・M&(amp;)?A/.test(s));
    ok(w + '：「エクイティ・デット・M&A」になっている', /エクイティ・デット・M&(amp;)?A/.test(s));
  });
  no('「投融資」「投資・融資マッチング」が残っていない', /投融資|投資・融資マッチング/.test(SRC));
  ok('案件の種別の札', /function mkKindLabel\(k\)\{ return k==='mna'\?'M&A':\(k==='equity'\?'エクイティ':'デット'\); \}/.test(SRC));
  is('案件の種別の選択肢（運営・パートナー）', (SRC.match(/<option value="loan">デット（融資）<\/option><option value="equity">エクイティ（出資）<\/option><option value="mna">M&A<\/option>/g) || []).length, 2);
  ok('運営の経営計画の区分から「融資」を外し、デット・エクイティ', /<select id="exf-cat" class="inp2"><option>自己資金<\/option><option>デット<\/option><option>資本性ローン<\/option><option>エクイティ<\/option><option>補助金<\/option><option>その他<\/option><\/select>/.test(SRC));
  const fg = takeArr('FUND_GROUPS');
  ok('調達ロードマップの区分：公的デット・民間デット・エクイティ', /\['公的デット',/.test(fg) && /\['民間デット',/.test(fg) && /\['エクイティ',\['VC・CVC出資'/.test(fg));
  ok('制度の正式名は残す', /制度融資（自治体・信用保証付）/.test(fg) && /保証協会付融資/.test(fg) && /銀行融資（プロパー）/.test(fg));
  //  前の行の表示だけ寄せる
  const fc = new Function(takeFn('fundCatLabel') + 'return fundCatLabel;')();
  is('古い区分は表示だけ今の言い方に', ['融資', '出資', '投資', '出資・投資', '公的融資', '民間融資', 'デット', '補助金', ''].map(fc), ['デット', 'エクイティ', 'エクイティ', 'エクイティ', '公的デット', '民間デット', 'デット', '補助金', '']);
  ok('調達ロードマップの表と一覧で使う', /esc\(fundCatLabel\(r\.source_type\)\)/.test(takeFn('fundTable')) && /esc\(fundCatLabel\(f\.source_type\)\)/.test(SRC));
  const lf = takeFn('loadExecFunding');
  ok('運営の経営計画の集計と札でも使う', /var ck=fundCatLabel\(it\.category\)\|\|'その他'; byCat\[ck\]/.test(lf) && /EX_CATSTYLE\[fundCatLabel\(it\.category\)\]/.test(lf) && /esc\(fundCatLabel\(it\.category\)\)/.test(lf));
  //  デットナビ
  ok('カルテのナビはデットナビ', /\['cs-loan','yen','デットナビ','資金・銀行'\]/.test(SRC));
  ok('見出しもデットナビ', /デットナビ（最適な借入の優先順位）/.test(SRC) && !/融資ナビ（最適な融資の優先順位）/.test(SRC));
  ok('デットナビから登録する行はデット', /source_type:'デット', title:name,/.test(SRC) && /note:'デットナビから登録'/.test(SRC));
  ok('継ナビくんの話題の判定にデット・エクイティ', /承継\|M&A\|融資\|デット\|エクイティ\|資金繰り/.test(SRC));
  ok('運営のロードマップ：シード調達はエクイティ', /card\('3','シード調達','エクイティ（FUNDINNO・VC）5,000万〜'/.test(SRC));
  //  銀行に見せる資料の言い方は変えない（銀行は「融資」と言う）
  ok('銀行提出パッケージの題は「融資ご検討資料」のまま', /融資ご検討資料/.test(SRC));
  ok('銀行向け資料は「融資先」のまま', /融資先/.test(PITB));
}
// ② 説明書
{
  ok('パートナー説明書：デットナビ・返済不要→デット', /資金調達ロードマップ／デットナビ／補助金ナビ/.test(MANP) && /返済不要 → デット（融資） の順で提案できます/.test(MANP));
  ok('パートナー説明書：デットナビの説明と言い方', /<b>デットナビ<\/b>（旧 融資ナビ）は/.test(MANP) && /デット＝借入・融資、エクイティ＝出資/.test(MANP));
  ok('パートナー説明書：経営者の画面に3つの設計（同じもの）', /「出口の設計」（8つの出口）・「株の持ち方・組織の検討」・「スケールの設計」で目標の年と数字を見ます/.test(MANP));
  ok('経営者説明書：言葉の使い方（デット・エクイティ）', /<th>言葉の使い方<\/th>/.test(MANC) && /<b>デット<\/b>（借入・融資。返す資金）と<b>エクイティ<\/b>（出資/.test(MANC) && /デット（融資）／エクイティ（出資）／M&amp;A<\/b>の3つ/.test(MANC));
  ok('運営説明書：調達の区分', /data-t="経営計画・調達（デット・エクイティ）"/.test(MANA) && /区分は「デット」「エクイティ」で登録します/.test(MANA));
  ok('運営説明書：経営者・パートナーの3つの設計と言い方', /「出口の設計」<\/b>（8つの出口/.test(MANA) && /「株の持ち方・組織の検討」<\/b>/.test(MANA) && /「スケールの設計」<\/b>（7つの道/.test(MANA) && /デット＝借入・融資、エクイティ＝出資/.test(MANA));
}
// ③ 商談用のプロダクト説明に今日の追加分
{
  ok('経営者向け：写しのボタンが8つ', (PITC.match(/scr-sbtn[^>]*>(?:<i[^>]*>1<\/i>)?(🤝|🏠|👥|🤲|📈|🏛️|🏁|🏗️) /g) || []).length >= 8);
  ok('経営者向け：株の持ち方・組織の検討の段', /出口とは別に「株の持ち方・組織の検討」/.test(PITC) && /税額は計算しません/.test(PITC));
  ok('パートナー向け：8つの出口と株の持ち方', /上場（TOKYO PRO Market・グロース）／畳む／続けて買い手になる、の8つ/.test(PITP) && /株の持ち方・組織の検討/.test(PITP));
  ok('一般向け：8つの出口', /出口は8つ（第三者へ譲る/.test(PITG) && /株の持ち方の検討も、出口とは別に/.test(PITG));
  ok('銀行向け：8つの出口', /出口は8つ（第三者へ譲る/.test(PITB));
  [['経営者向け', PITC], ['パートナー向け', PITP], ['一般向け', PITG], ['銀行向け', PITB]].forEach(([w, s]) => no(w + '：「5つの出口」が残っていない', /5つの出口/.test(s)));
}
// ④ 版
{
  const build = SRC.match(/var APP_BUILD='([^']+)'/)[1];
  is('版が揃う', [build, VER.build], ['20260926-02', '20260926-02']);
}
console.log(bad.length ? JSON.stringify(bad, null, 1) : 'ALL OK', n, 'checks,', bad.length, 'failed');
process.exit(bad.length ? 1 : 0);
