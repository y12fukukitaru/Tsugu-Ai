// =============================================================
// プロダクト説明（パートナー・経営者）の試験（2026-10-06／10-07 LP にそろえる）
//   ① パートナー：法人営業の壁（問題提起）→ 越え方（解決）→ あなたが描く未来
//   ② 書いてあることが、アプリにある（研修の章数・決算書の読み取り・面談台本・
//      商談練習・保険の棚卸し・退職金と株対策のシミュレーター）
//   ③ お金の数字はアプリの決まりから計算して一致、保証しない・0円の月を同じ頁に
//   ④ 決まりごと（非公開金融情報・抱き合わせ禁止・了承のうえで）を外さない
//   ⑤ 説明会・募集案内・運営キット・経営者向け資料にも同じ筋を通す
// =============================================================
const fs = require('fs');
const R = (f) => fs.readFileSync(__dirname + '/../' + f, 'utf8');
const SRC = R('index.html'), PP = R('pitch-partner.html'), WP = R('webinar-partner.html'), RP = R('recruit-partner.html');
const PC = R('pitch-customer.html'), KIT = R('docs/webinar-partner-kit.md');
let n = 0, bad = [];
function ok(name, c) { n++; if (!c) bad.push(name); }
const secs = (h) => h.split('<section class="slide').slice(1).map((s) => s.slice(0, s.indexOf('</section>')));
const slideOf = (h, t) => secs(h).find((s) => s.indexOf('data-t="' + t + '"') >= 0) || '';
const order = (h) => secs(h).map((s) => (s.match(/data-t="([^"]*)"/) || [])[1]);

// ① パートナー向け：問題 → 解決（始める前・社長の前で）→ 未来（2026-10-07 LP にそろえる）
const P = order(PP);
const wall = slideOf(PP, '法人営業の壁'), A = slideOf(PP, '壁の越え方（始める前）'), B = slideOf(PP, '壁の越え方（社長の前で）'), fut = slideOf(PP, 'あなたが描く未来');
const over = A + B;
ok('並び（ニード喚起）：3つの問い → 法人営業の壁 → 市場 → 創業の理由 → たどり着いた答え → 買い手に育てる顧問 → 始める前 → 社長の前で → プロダクト',
  ['表紙', '3つの問い', '法人営業の壁', '社長に感謝される使い道', '市場', '創業の理由', 'たどり着いた答え', '買い手に育てる顧問', '壁の越え方（始める前）', '壁の越え方（社長の前で）', 'プロダクト'].join(',') === P.slice(0, 11).join(','));
{
  //  社長の悩み → その場で応える → 感謝される（2026-10-10）
  const th = slideOf(PP, '社長に感謝される使い道');
  ok('パートナー：問いは「相談をされる法人営業」「その場で答えを見せられるか」「ゼロに戻る関係」', /「相談」をされる<\/b>法人営業を、してみたいと思いませんか？/.test(slideOf(PP, '3つの問い')) && /その場で答えを見せられますか？/.test(slideOf(PP, '3つの問い')) && /「ゼロ」に戻っていませんか？/.test(slideOf(PP, '3つの問い')));
  ok('パートナー：感謝される使い道＝社長の口ぐせ6つ → アプリで応える → 残るもの・なぜ感謝されるか', (th.match(/<tr><td>/g) || []).length === 6 && /「うちの会社、いくらなの？」/.test(th) && /承継シミュレーション/.test(th) && /だから、感謝されます。/.test(th) && /毎月会う理由/.test(th));
}
ok('目指す社会は最後（始め方の前）', P.indexOf('目指す社会') === P.length - 2 && P[P.length - 1] === '始め方');
ok('古い「法人営業の壁の越え方」の1頁は無い', P.indexOf('法人営業の壁の越え方') < 0);
ok('並び：あなたに残るもの → あなたが描く未来 → 画面で見る', P.indexOf('あなたが描く未来') === P.indexOf('あなたに残るもの') + 1 && P.indexOf('画面で見る') === P.indexOf('あなたが描く未来') + 1);
ok('表紙：LP と同じ「法人営業に挑むための、コンサルツール」', /<h1>社長と、<br><span style="color:#CFAD62;">経営の話ができる人<\/span>へ。<\/h1>/.test(PP) && /法人営業に挑むための、コンサルツール/.test(secs(PP)[0]));
ok('問いかけ：法人営業を、してみたいと思いませんか？ → なぜ、踏み出せないのか', /法人営業を、してみたいと思いませんか？/.test(slideOf(PP, '3つの問い')) && /<h2>なぜ、踏み出せないのか<\/h2>/.test(wall) && /こんな悩みはありませんか。/.test(wall));
ok('保険に限らない言い方（営業のプロ）', !/保険の営業をされている方へ|したくないですか/.test(PP + WP + RP) && /営業のプロのあなたに、3つだけ/.test(PP));
['何を学ぶか', 'どのセミナーか', '時間とお金', '決算書が読めない', '社長と何を話すか'].forEach((w) => ok('壁：' + w, wall.indexOf('<div class="w-t">' + w + '</div>') >= 0));
const rows = (h) => (h.match(/<tr><td>([^<]+)<\/td>/g) || []).map((x) => x.replace(/<tr><td>|<\/td>/g, ''));
ok('始める前の壁：経験・知識・時間・お金・ひとり', rows(A).join(',') === '経験,知識,時間,お金,ひとり');
ok('社長の前での壁：切り出す・面談の前・面談の場で・面談のあと・続ける', rows(B).join(',') === '切り出す,面談の前,面談の場で,面談のあと,続ける');
ok('どの行も「つまずき」と「越え方」の2つを持つ', [A, B].every((h) => (h.match(/<tr><td>[^<]+<\/td><td>[^<]+<\/td><td>/g) || []).length === 5));
ok('なぜハードルが高いか：商品ではなく経営の判断', /なぜ、ハードルが高いのか。/.test(wall) && /<b>「経営の判断」<\/b>/.test(wall) && /社長の隣で数字を話せる立場/.test(wall));
ok('未来：LP の4つのステージ（いち営業から、一緒に会社を強くする人へ）', /<h2>いち営業から、一緒に会社を強くする人へ<\/h2>/.test(fut)
  && ['1期 — START', '2期 — 副業スタート', '3期 — 成長期', '4期 — 最上位'].every((x) => fut.indexOf('<div class="n">' + x + '</div>') >= 0)
  && ['アソシエイト', 'シニア（50%）', 'エグゼクティブ（60%）', 'プレミアム（70%）'].every((x) => fut.indexOf('<div class="h">' + x + '</div>') >= 0));
ok('どの頁にも話す内容・質問から探せる', [wall, A, B, fut].every((s) => /<div class="talk">/.test(s) && /data-q="/.test(s)));
ok('表紙の話す内容：流れ（問いかけ → 悩み → 機会 → 私たちの答え → 壁の越え方 …）', /<b>流れ<\/b>問いかけ（法人営業をしてみたい？）→ 悩み（なぜ踏み出せない）→ 機会（社長は隣で支える人を待っている）→ 私たちの答え（買い手に育てる顧問）→ 壁の越え方/.test(PP));
ok('収入：30社で全社の率が80%に', /<b>30社で、全社の率が80%に。<\/b>/.test(slideOf(PP, '収入')) && /scale:\{cl:30, fee:'80%'\}/.test(SRC));

// ② 書いてあることが、アプリにある
ok('研修は全5章・必修11（アプリの知識と同じ）', /研修プログラム\(全5章。必修11レッスン＋発展のM&A講座8レッスン/.test(SRC) && /全5章・必修11レッスン/.test(over) && /全5章・必修11レッスン/.test(PP));
ok('古い「全4章」がパートナー向け資料に残っていない', ![PP, WP, RP].some((h) => /全4章/.test(h)));
ok('FA実務講座の中身（財務三表・正常収益力・企業価値評価）', /財務三表 → 正常収益力 → 企業価値評価/.test(SRC) && /財務三表・正常収益力・企業価値評価/.test(over));
ok('決算書は形式を問わずAIが読み取る', /試算表・決算書を読み取る経理アシスタントです。様式・書式は問わず/.test(SRC) && /形式は問いません/.test(over));
ok('面談台本：見せる数字3つ・問い3つ', /見せる数字（3つ）/.test(SRC) && /問い（3つ）/.test(SRC) && /見せる数字3つ・問い3つ/.test(over));
ok('研修の最後にロールプレイ（継ナビくんが社長役）', /kind:'roleplay'/.test(SRC) && /🎭 継ナビくんと商談練習/.test(SRC) && /社長役になる<b>ロールプレイ<\/b>/.test(over));
ok('切り出し：事業承継リスク診断（5つの質問・登録不要）と課題ヒアリング診断（8つの問い）', /<b>1分の事業承継リスク診断<\/b>（5つの質問・登録不要）/.test(B) && /8つの問いかけで潜在ニーズを引き出し/.test(SRC) && /<b>課題ヒアリング診断<\/b>（8つの問い）/.test(B));
ok('面談のあと：議事録はAIで整える（アプリにある）', /runMeetingAi/.test(SRC) && /議事録担当です/.test(SRC) && /<b>AIが議事録に<\/b>整え/.test(B));
ok('準備ブリーフ・ナビ・今日の一手', /<b>準備ブリーフ<\/b>/.test(B) && /<b>「今日の一手」<\/b>/.test(B) && /カルテの<b>ナビ<\/b>/.test(B));
ok('本業の相談はあとから（固定費 → 退職金・承継 → 次の1社）。道具はアプリにある', /t:'保険・固定費の棚卸し'/.test(SRC) && /役員退職金シミュレーター/.test(SRC) && /事業承継・株対策シミュレーター/.test(SRC)
  && /固定費の見直し → 役員退職金・事業承継の準備 → 次の1社の買収/.test(B));
ok('前払いなし・入金のない月は0円（説明会の「ご負担」・アプリの計算と同じ）', /先にお支払いいただくことはありません/.test(slideOf(WP, 'ご負担')) && /<b>前払いはありません<\/b>/.test(A) && /<b>入金のない月は0円<\/b>/.test(A) && /if\(n<=0\) return \{ ex:0, inc:0/.test(SRC));

// ③ お金の数字はアプリの決まりから
const STD = Number((SRC.match(/var EP_STD_FEE=(\d+);/) || [])[1]), SELL = Number((SRC.match(/var EP_SELLER_FEE=(\d+);/) || [])[1]);
const lv2 = /\{ lv:2, key:'Senior',[^\n]*need:\{cl:1,hd:0\}, fee:'50%' \}/.test(SRC), lv3 = /\{ lv:3, key:'Executive',[^\n]*fee:'60%'/.test(SRC);
const six = (STD * 3 + SELL * 3) * 0.5;
ok('例の金額：6社（買い手3・売り手3）×50% = 月120,000円', lv2 && six === 120000 && /<b>月120,000円<\/b>（税別）/.test(fut) && /シニア（50%）/.test(fut));
const lv4 = /\{ lv:4, key:'Premium Partner',[^\n]*need:\{cl:20,hd:0\}, fee:'70%', scale:\{cl:30, fee:'80%'\}/.test(SRC);
ok('レベルの条件がアプリと同じ（10件／20件／30社で80%。成約の道は無い）', lv2 && lv3 && lv4 && /顧問契約<b>10件<\/b>/.test(fut) && /顧問契約<b>20件<\/b>/.test(fut) && /<b>30社で80%<\/b>/.test(fut) && !/または成約/.test(fut));
ok('未来の頁に「保証しない・0円の月・差し引く前・運営が認定」', /収入を保証・約束するものではありません/.test(fut) && /担当先を得られない月は、報酬もご利用料も0円です/.test(fut) && /ご利用料・源泉徴収を差し引く前/.test(fut) && /率の適用とレベルの認定は運営が行います/.test(fut));
ok('法人営業の成約を約束しない（話す内容）', /「すぐ法人の契約が取れるか」→ 約束しない/.test(over));

// ④ 決まりごと
const rules = (h) => /事前の同意なく募集に使わない/.test(h) && /抱き合わせ/.test(h);
ok('越え方の頁：立場の明示・非公開金融情報・抱き合わせ禁止', /顧問の立場と本業の立場を<b>先に明示<\/b>/.test(B) && /事前の同意なく募集・本業の提案に使わない/.test(B) && /抱き合わせ/.test(B));
ok('提案は社長の了承を得てから・本業として', /<b>社長の了承を得てから<\/b>、あなたの本業として/.test(over) && /非公開金融情報の扱い（保険業法施行規則）/.test(over));
ok('アプリの知識と同じ決まり', /顧問先の事前の同意なく募集に使わない\(非公開金融情報の授受制限\)。顧問契約と保険の契約の抱き合わせもしない/.test(SRC));

// ⑤ ほかの資料にも同じ筋
const w = slideOf(WP, '法人営業の壁'), WO = order(WP);
ok('説明会：あなたの役割 → 法人営業の壁 → 保険・士業の方へ', WO.indexOf('法人営業の壁') === WO.indexOf('あなたの役割') + 1 && WO.indexOf('保険・士業の方へ') === WO.indexOf('法人営業の壁') + 1);
ok('説明会：5つの理由と5つの答え・了承のうえで・約束しない', /踏み出せない、5つの理由/.test(w) && (w.match(/<br>/g) || []).length === 8 && /<b>社長の了承のうえで<\/b>/.test(w) && /法人営業の成約や収入を約束するものではない/.test(w));
ok('説明会：流れの②に法人営業', /② 認定パートナーの役割（保険の方へ：法人営業の壁の越え方）と、1日の動き/.test(WP));
const r = slideOf(RP, '法人営業に挑む'), RO = order(RP);
ok('募集案内：なぜ、いま → 法人営業に挑む → あなたの役割', RO.indexOf('法人営業に挑む') === RO.indexOf('なぜ、いま') + 1 && RO.indexOf('あなたの役割') === RO.indexOf('法人営業に挑む') + 1);
ok('募集案内：決まりと「約束しない」', rules(r) && /法人営業の成約や収入を約束するものではありません/.test(r) && /<b>社長の了承のうえで<\/b>/.test(r));
ok('運営キット：告知の「こんな方へ」と弁護士の確認事項', /法人営業をしたいのに、決算書の読み方や社長との話し方に自信がない方/.test(KIT) && /「法人営業の壁」の頁（法人の成約が増えると受け取られない書き方か）/.test(KIT));
ok('説明会・募集案内：⑤ は承継リスク診断で切り出す', [w, r].every((h) => /⑤ <b>1分の承継リスク診断<\/b>で切り出し、<b>面談台本<\/b>（数字3つ・問い3つ）で話す/.test(h)));
const MP = R('manual-partner.html'), mp = slideOf(MP, '法人営業の始め方'), MO = order(MP);
ok('説明書（パートナー）：「法人営業の始め方」は位置づけの次', MO.indexOf('法人営業の始め方') === MO.indexOf('TsuguAiの位置づけ') + 1);
ok('説明書：場面ごと（切り出す〜続ける）と、画面のボタン名がアプリと同じ', ['切り出す', '練習する', '契約する', '面談の前', '面談の場で', '面談のあと', '続ける'].every((x) => mp.indexOf('<tr><th>' + x + '</th>') >= 0)
  && />AIで整形する</.test(SRC) && /<b>「AIで整形する」<\/b>/.test(mp) && /<b>「🎭 継ナビくんと商談練習」<\/b>/.test(mp) && rules(mp));
ok('知識：法人営業が初めての人の進め方', /法人営業が初めての人の進め方\(説明書「法人営業の始め方」\)=切り出しは経営者向けページの「事業承継リスク診断」/.test(SRC));
const ten = slideOf(PC, '十年の未来設計図'), CO = order(PC);
ok('経営者向け：十年の未来設計図（Phase 1〜5）は3年間の次・価値のあるうちに→譲る側の前', CO.indexOf('十年の未来設計図') === CO.indexOf('3年間を数字で') + 1 && CO.indexOf('価値のあるうちに') === CO.indexOf('十年の未来設計図') + 1 && CO.indexOf('譲る側の社長へ') === CO.indexOf('価値のあるうちに') + 1
  && ['承継期', '軌道化・安定期', '拡大期', '柱を増やす', '次世代承継'].every((x) => ten.indexOf('<div class="h">' + x + '</div>') >= 0));
ok('経営者向け：年数は目安・持株会社は目的ではない', /年数は目安で、進み方は会社ごとに違います。/.test(ten) && /目的ではなく、選び方の一つ/.test(ten) && /結果を約束するものではない/.test(ten));
const MR = slideOf(MP, 'ランクと報酬');
ok('M&Aの報酬は運営とパートナーで折半（商談スライド・説明会・募集案内・説明書・知識）。古い「案件ごとに取り決め」は残さない',
  [PP, WP, RP].every((h) => /運営とパートナーで折半/.test(h) && !/案件ごとに(運営と事前に)?取り決め/.test(h)) && /<b>M&amp;Aの報酬は、運営とパートナーで折半します。<\/b>/.test(MR)
  && /当社が受け取る報酬を運営とパートナーで折半\)/.test(SRC));
// 研修のロールプレイ（2026-10-07 LP「動画 → ロールプレイ → 認定試験」と同じ順）
{
  const a = SRC.indexOf('var TRAINING=['), z = SRC.indexOf('var FA_COURSE=[');
  const T = new Function('tgShell', 'tgCard', 'tgRow', 'esc', SRC.slice(a, z) + '; return TRAINING;')(() => '', () => '', () => '', (x) => x);
  const ch5 = T.find((c) => c.n === 5), ids = ch5.lessons.map((l) => l.id);
  const req = T.filter((c) => !c.opt).reduce((n, c) => n + c.lessons.length, 0);
  ok('研修：第5章はロールプレイ → 理解度チェック', ids.join(',') === 't4-0,t4-1' && ch5.lessons[0].kind === 'roleplay');
  ok('研修：必修は11レッスン（資料の「必修11」と同じ）', req === 11 && /全5章・必修11レッスン/.test(PP) && /全5章・必修11レッスン/.test(WP) && /全5章・必修11レッスン/.test(RP) && /必修11レッスン/.test(MP));
  ok('研修：ロールプレイは始めてから「終えた」を押せる・相手の型が入れ替わる', /function trRoleplayStart\(\)/.test(SRC) && /prospectPractice\(n % PROSPECT_PERSONAS\.length\)/.test(SRC) && /\(started\?'':' disabled/.test(SRC));
  ok('研修：ロールプレイを足す前に修了した方は修了のまま（記録は書かない）', /function trGrandfather\(\)\{\s*if\(TR_PROG\['t4-1'\] && !TR_PROG\['t4-0'\] && String\(TR_PROG\['t4-1'\]\) < TR_RP_SINCE\) TR_PROG\['t4-0'\]=TR_PROG\['t4-1'\];/.test(SRC)
    && (SRC.match(/trGrandfather\(\);/g) || []).length === 2);
  {
    const g = new Function("var TR_PROG=arguments[0], TR_RP_SINCE='2026-10-08';" + SRC.slice(SRC.indexOf('function trGrandfather(){'), SRC.indexOf('var TR_RP_SINCE')) + 'trGrandfather(); return TR_PROG;');
    const old = g({ 't4-1': '2026-09-01T00:00:00Z' }), neu = g({ 't4-1': '2026-10-09T00:00:00Z' });
    ok('研修：以前の合格はロールプレイ済み、これからの合格はロールプレイが要る', old['t4-0'] === '2026-09-01T00:00:00Z' && !neu['t4-0']);
  }
  ok('知識・説明書：修了はロールプレイと理解度チェック', /第5章のロールプレイ\(継ナビくんが社長役の商談練習\)と理解度チェックで修了/.test(SRC) && /<b>ロールプレイ<\/b>（継ナビくんが社長役になり/.test(MP));
}
// 買い手に育てる顧問（このプロダクトの肝。2026-10-07）
{
  const core = slideOf(PP, '買い手に育てる顧問'), cc = slideOf(PC, '買い手に育てる顧問'), CO2 = order(PC);
  ok('パートナー：買い手に育てる顧問（仲介・コンサルとの違い・買い手プランが肝）', /<h2>顧問先を「買い手」に育てる。<br>これからの、法人営業の仕事です<\/h2>/.test(core) && /<h3>仲介会社<\/h3>/.test(core) && /<h3>コンサル・顧問<\/h3>/.test(core) && /<b>買い手プラン（月45,000円・税別）が、このプロダクトの肝です。<\/b>/.test(core) && /var EP_STD_FEE=45000;/.test(SRC));
  ok('パートナー：言い切らない（日本初・唯一）・否定しない・架空の例', /「日本初」「唯一」とは言い切らない/.test(core) && /仲介やコンサルを否定しない/.test(core) && /架空の会社の例で、結果を約束するものではありません/.test(core) && !/日本初|唯一の/.test(core.replace(/<div class="talk">[\s\S]*$/, '')));
  ok('パートナー：数字は物語と同じ（9,700万 → 約2.2億・M&Aの報酬は折半）', /9,700万 → 約2\.2億/.test(core) && /会社の値段<\/td><td>9,700万<\/td>/.test(PP) && /M&amp;Aの報酬（運営と折半）/.test(core));
  ok('経営者：表紙は「次の1社を引き受けて、大きく育つ会社へ」', /<h1>次の1社を引き受けて、<br><span style="color:#CFAD62;">大きく育つ会社<\/span>へ。<\/h1>/.test(PC) && /「買い手」に育てる<\/b>、これまでになかった顧問です/.test(PC));
  ok('経営者：並び 3つの問い → 先送りのコスト → 4つの壁 → なぜ生まれたのか → 買い手に育てる顧問 → 答え①', ['表紙', '3つの問い', '先送りのコスト', '4つの壁', 'なぜ生まれたのか', '買い手に育てる顧問', '答え①シミュレーション'].join(',') === CO2.slice(0, 7).join(','));
  ok('経営者：買い手となり、大きく成長しましょう・ほかの専門家を否定しない', /<b>買い手となり、大きく成長しましょう。<\/b>/.test(cc) && /どれも大切な役割/.test(cc) && /「日本初」「唯一」とは言い切らない/.test(cc));
  ok('経営者：4つの壁は「買える側に立つ手前」（LP と同じ）', /<h2>買える側に立つ手前に、4つの壁があります<\/h2>/.test(slideOf(PC, '4つの壁')));
  ok('経営者：次の一歩は「この会社を買ったら？」から', /「この会社を買ったら？」を見てみませんか。/.test(slideOf(PC, '次の一歩')) && /画面②の「買う側を体験」を開く/.test(slideOf(PC, '次の一歩')));
  ok('経営者：目指す社会は最後（次の一歩の前）', CO2.indexOf('目指す社会') === CO2.length - 2);
  ok('説明会：TsuguAiとは＝買い手に育てる顧問・3つの問いは営業のプロへ', /買い手に育てる顧問は、これまでほとんどありませんでした/.test(slideOf(WP, 'TsuguAiとは')) && /法人営業を、してみたいと思いませんか？/.test(slideOf(WP, '3つの問い')));
}
const prom = slideOf(PC, '約束すること・しないこと');
ok('経営者向け：担当の本業（保険など）を押し付けない', /✔ 担当の本業（保険など）を押し付けない（ご了承なく財務の情報を使わず、抱き合わせもしない）/.test(prom) && /保険を売り込まれない？/.test(prom) && /<b>担当が保険の方なら<\/b>/.test(prom));

// ⑥ EP-I・EP-II・所属パートナー候補（2026-10-07）と、経営者向けに個人の経歴を入れない
{
  const E1 = R('pitch-ep1.html'), E2 = R('pitch-ep2.html'), EM = R('pitch-ep2-member.html');
  const o1 = order(E1), o2 = order(E2), om = order(EM);
  const noTalk = (h) => h.replace(/<div class="talk">[\s\S]*?<\/div>\s*<\/section>/g, '</section>');
  ok('EP-II：表紙は「御社に、法人営業部門を創りませんか？」', /<h1>御社に、<br><span style="color:#CFAD62;">法人営業部門<\/span>を<br>創りませんか？<\/h1>/.test(E2) && /<title>御社に、法人営業部門を/.test(E2));
  ok('EP-II：並び 3つの問い → 法人営業部門の壁 → いま起きていること → 買い手に育てる顧問 → 部門の創り方 → EP-IIとは',
    ['表紙', '3つの問い', '法人営業部門の壁', 'いま起きていること', '買い手に育てる顧問', '部門の創り方', 'EP-IIとは'].join(',') === o2.slice(0, 7).join(','));
  ok('EP-II：本部の収入の形は配分の直前', o2.indexOf('本部の収入の形') === o2.indexOf('配分') - 1);
  ok('EP-II：1つ目の問いが法人営業部門', /御社に、法人営業部門を創りませんか？/.test(slideOf(E2, '3つの問い')));
  ok('EP-II：部門の創り方に研修（必修11・ロールプレイ）・本部の負担0円・面談台本・承継リスク診断・担当表', (function (h) {
    return /全5章・必修11レッスン/.test(h) && /ロールプレイ/.test(h) && /本部のご負担は0円/.test(h) && /面談台本/.test(h) && /1分の事業承継リスク診断/.test(h) && /担当表と記録/.test(h); })(slideOf(E2, '部門の創り方')));
  ok('EP-II：保険の提案の決まり（了承・明示・非公開情報・抱き合わせ）', /社長の了承を得てから/.test(slideOf(E2, '部門の創り方')) && /事前の同意なく募集に使わない/.test(slideOf(E2, '部門の創り方')) && /抱き合わせはしない/.test(slideOf(E2, '部門の創り方')));
  ok('EP-II：M&Aは本部1割・所属4割・運営5割（折半の内側）', /本部に1割、担当の所属パートナーに4割<\/b>をお支払いします（運営が5割）/.test(slideOf(E2, '配分')) && /運営とパートナー側で折半/.test(slideOf(E2, '配分')));
  ok('EP-II：保険だけに寄せない（本業の手数料）', /本業（保険など）の手数料/.test(slideOf(E2, '本部の収入の形')) && !/<h2>保険の手数料/.test(E2));
  ok('EP-II：始め方は必修11・所属の方向けの資料へ', /認定研修（全5章・必修11レッスン）を修了し、個別に契約/.test(slideOf(E2, '始め方')) && /所属パートナー候補向けの資料/.test(slideOf(E2, '始め方')));
  ok('EP-I：つかみは「顧問先の担当者を、買い手に育てるコンサルにしませんか？」・その先に部門', /<h1 style="font-size:40px;">顧問先の担当者を、<br><span style="color:#CFAD62;">買い手に育てるコンサル<\/span>に<br>しませんか？<\/h1>/.test(E1) && /事業承継・M&amp;A支援部門<\/b>が生まれます/.test(secs(E1)[0]) && /買い手企業に育てられるコンサルにしたいと思いませんか？/.test(slideOf(E1, '3つの問い')) && /<title>顧問先の担当者を、買い手に育てるコンサルに/.test(E1));
  ok('EP-I：並び 3つの問い → いま起きていること → 顧問先の行き先 → 買い手に育てる顧問 → 2つの顧問契約',
    ['表紙', '3つの問い', 'いま起きていること', '顧問先の行き先', '買い手に育てる顧問', '2つの顧問契約'].join(',') === o1.slice(0, 6).join(','));
  ok('EP-I：研修は必修11・ロールプレイ', /全5章・必修11レッスン・AIが社長役のロールプレイ/.test(slideOf(E1, '部門をつくる')) && /必修11レッスン/.test(slideOf(E1, '担当者の方へ')) && /必修11レッスン/.test(slideOf(E1, '始め方')));
  ok('EP-I：説明の頁はすべて「つなぎ」で次へ（画面と始め方を除く）', secs(E1).filter((x) => !/class="slide (cover|dm|divider)/.test('<section class="slide' + x) && !/data-t="(始め方|デモの地図|お金の流れ|決めごと)"/.test(x)).every((x) => /<b>つなぎ<\/b>/.test(x)));
  ok('EP-I・EP-II：言い切らない（日本初・唯一）', [E1, E2, EM].every((h) => !/日本初|唯一の/.test(noTalk(h))));
  ok('所属候補：表紙は「本部に所属したまま、法人営業へ。」', /<h1>本部に所属したまま、<br><span style="color:#CFAD62;">法人営業<\/span>へ。<\/h1>/.test(EM));
  ok('所属候補：並び 問い → 壁 → 市場 → 買い手に育てる顧問 → 越え方2つ → 本部と一緒に → あなたの収入',
    ['表紙', '3つの問い', '法人営業の壁', '市場', '買い手に育てる顧問', '壁の越え方（始める前）', '壁の越え方（社長の前で）', '本部と一緒に', 'あなたの収入'].join(',') === om.slice(0, 9).join(','));
  ok('所属候補：最後は始め方', om[om.length - 1] === '始め方');
  ok('所属候補：個人の率から本部10%を差し引く・顧客はTsuguAiに帰属・離れたら終了', (function (h) {
    return /本部の10%を差し引いた率<\/b>/.test(h) && /あなたの料率から差し引く形<\/b>/.test(h) && /顧客はTsuguAiに帰属<\/b>し、本部を離れたときはこの契約は終了/.test(h) && !/同じ料率|手取りは減りません/.test(h); })(slideOf(EM, '本部と一緒に')));
  ok('所属候補：収入は 40%・50%・60%・30社以上70%・M&Aは4割', (function (h) {
    return /<b>18,000<\/b>/.test(h) && /Lv\.2（40%）/.test(h) && /10件でLv\.3（50%）/.test(h) && /20件でLv\.4（60%）/.test(h) && /30社以上で70%/.test(h) && /あなたに4割、本部に1割<\/b>（運営が5割）/.test(h) && /54,000円/.test(h) && /−5,513円/.test(h) && /38,587円/.test(h); })(slideOf(EM, 'あなたの収入')));
  ok('所属候補：80%・折半（個人の決まり）を持ち込まない', !/で80%|運営と折半/.test(noTalk(EM)));
  ok('所属候補：始め方は必修11・ロールプレイ', /必修11レッスン/.test(slideOf(EM, '始め方')) && /ロールプレイ/.test(slideOf(EM, '始め方')));
  ok('所属候補：資料一覧に EP-II 所属の方だけへ出す', /f:'pitch-ep2-member\.html'[^\n]*who:\{ consultant:'ep2', admin:/.test(SRC) && /d\.who\[eff\]==='ep2'\) return !!\(EP_ME && EP_ME\.org && EP_ME\.org\.kind==='EP2'\)/.test(SRC));
  ok('所属候補：個人の経歴（19年など）を入れない', !/19年|保険19年/.test(EM));
  const why = slideOf(PC, 'なぜ生まれたのか');
  ok('経営者：創業者の経歴を入れない（どのパートナーでも話せる）', !/19年|保険の仕事で/.test(PC) && /経営者の隣で仕事をしてきた人ほど/.test(why) && /認定研修を修了した伴走者/.test(why) && /ほかの人の経歴を自分のことのように話さない/.test(why));
  ok('経営者：「私たちは始めました」を言わせない', !/私たちは始めました/.test(PC) && /だから、TsuguAi -継- が生まれました/.test(slideOf(PC, '4つの壁')));
  ok('経営者：目指す社会は運営会社の社名として', /運営会社の社名「<b>福來（ふくきたる）<\/b>」/.test(slideOf(PC, '目指す社会')) && !/私たちにとっても/.test(PC));
}

// ⑦ EP-II の料率（2026-10-07）：所属の方は個人の率から本部の10%を差し引く
//     シニア40%・エグゼクティブ50%・プレミアム60%・30社以上70%。本部は10%、継の取り分は個人と同じ
{
  const take = (name) => { const i = SRC.indexOf('function ' + name + '('); if (i < 0) throw new Error(name); return SRC.slice(i, SRC.indexOf('\n  }\n', i) + 4); };
  const lv = SRC.slice(SRC.indexOf('var PG_LEVELS=['), SRC.indexOf('\n  ];\n', SRC.indexOf('var PG_LEVELS=[')) + 5);
  const F = new Function('var EP_HQ_PCT=0.10;\n' + lv + '\nfunction epMemberRate(r){ return (r==null) ? null : Math.round((Number(r)-EP_HQ_PCT)*100)/100; }\n'
    + take('pgLevelOf') + '\n' + SRC.match(/function pgPct\(v\)\{[^\n]*\n/)[0] + take('rankFeeRate') + '\n' + take('epSplit')
    + '\nreturn { rankFeeRate: rankFeeRate, epSplit: epSplit };')();
  ok('EP-II の率を作る関数がアプリにある', /function epMemberRate\(r\)\{ return \(r==null\) \? null : Math\.round\(\(Number\(r\)-EP_HQ_PCT\)\*100\)\/100; \}/.test(SRC));
  const r = (rk, cl, e) => F.rankFeeRate(rk, cl, e);
  ok('個人：50%・60%・70%・30社以上80%（これまでどおり）', [r('Senior', 3), r('Executive', 12), r('Premium Partner', 25), r('Premium Partner', 30)].join() === '0.5,0.6,0.7,0.8');
  ok('EP-II：40%・50%・60%・30社以上70%', [r('Senior', 3, true), r('Executive', 12, true), r('Premium Partner', 25, true), r('Premium Partner', 30, true)].join() === '0.4,0.5,0.6,0.7');
  ok('社数が分からないときは基本の率（上へ倒さない）', r('Premium Partner', undefined, true) === 0.6 && r('Premium Partner') === 0.7);
  ok('個別設定・未設定は率なし', r('なし', 3, true) === null && r('', 3, true) === null);
  const s2 = F.epSplit(45000, 'EP2', 0.4), s1 = F.epSplit(45000, 'solo', 0.5);
  ok('EP-II 45,000円・Lv.2：所属18,000／本部4,500／継22,500（継は個人と同じ）', s2.partner === 18000 && s2.hq === 4500 && s2.tsugu === 22500 && s1.tsugu === 22500);
  ok('配分の画面の表は差し引いた率で（30社以上の行も）', /var r=epMemberRate\(pgPct\(L\.fee\)\);/.test(SRC) && /'（'\+L\.scale\.cl\+'社以上）'/.test(SRC));
  ok('振込の計算は rankFeeRate に EP-II かどうかを渡す', /rankFeeRate\(p\.fde_rank, payClients\[c\.consultant_id\]\|\|0, !!ep2\[c\.consultant_id\]\)/.test(SRC) && /rankFeeRate\(\(window\.__prof\|\|\{\}\)\.fde_rank, myClients==null\?undefined:myClients, !!myEp2\[ME\]\)/.test(SRC));
  ok('アプリから古い説明（同じ料率・70%上限・スケール対象外）が消えた', !/スケール対象外|スケール到達（80%）はありません|Lvの料率そのまま|担当者の方の手取りは減りません/.test(SRC));
  ok('成長の画面：EP-II の方には差し引いた率を出す', /function pgFeeFor\(fee\)/.test(SRC) && /外注費率 <b>'\+pgFeeFor\(L\.fee\)\+'<\/b>'/.test(SRC));
  const E2b = R('pitch-ep2.html'), ME_ = R('manual-ep.html'), MP = R('manual-partner.html'), MA = R('manual-admin.html'), E1b = R('pitch-ep1.html'), EMb = R('pitch-ep2-member.html');
  ok('EP-II 資料：配分の表は 40/50/60/70%', /買い手 45,000円　Lv\.2<\/th><td style="text-align:right;">40%<\/td><td style="text-align:right;"><b>18,000<\/b>/.test(E2b) && /買い手 45,000円　30社以上<\/th><td style="text-align:right;">70%<\/td>/.test(E2b) && /本部の10%は<b>所属の方の取り分から<\/b>出します/.test(E2b));
  ok('EP-II 資料：明細の例は 54,000円・源泉5,513円・お振込み38,587円', [E2b, EMb].every((h) => /<b>54,000 円<\/b>/.test(h) && /− 5,513 円/.test(h) && /<b>38,587 円<\/b>/.test(h) && /シニア・料率40%（EP-II）/.test(h)));
  ok('EP 資料・説明書に古い率が残っていない', [E2b, EMb, E1b, ME_, MP, MA].every((h) => !/同じ料率です|手取りは減りません|手取りは、減りません|70%が上限|Lv\.4（70%）が上限|スケール対象外|Lvの料率（50〜70%）/.test(h)));
  ok('違いの表：担当者は個人の料率−10%（40〜70%）', /個人の料率−10%（<b>40〜70%<\/b>）/.test(E2b) && /個人の料率−10%（40〜70%）/.test(E1b) && /個人の料率から10%を差し引いた率（40〜70%）/.test(ME_));
  ok('説明書：EP-II の方は各段−10%', /各段の率から本部の10%を差し引いた率です。<\/b>シニア40%／エグゼクティブ50%／プレミアム60%／30社以上70%/.test(MP) && /個人の率から<b>10%を差し引いた率<\/b>（40〜70%）/.test(MA));
}

if (bad.length) { bad.forEach((b) => console.log('NG ' + b)); console.log(n + ' checks, ' + bad.length + ' failed'); process.exit(1); }
console.log('ALL OK ' + n + ' checks, 0 failed');
