/* =============================================================
   一枚紙（sheet-*.html）の共通の動き
   ・閉じる／印刷する（アプリの枠の中では、別のタブで開いてから印刷）
   ・担当パートナーの名前と連絡先を、右下の欄に自動で入れる
     アプリの資料一覧から開くと、アプリがログイン中のパートナーの
     名前・所属・メールを localStorage（tsugu_sheet_me）に置いてから開く。
     電話番号など、直したところはそのパートナーの設定（tsugu_prefs_…）に覚える。
     アプリを通らずに開いたときは、手書き用の下線のまま。
   ============================================================= */
function inFrame(){ try{ return window.self!==window.top; }catch(e){ return true; } }
//  アプリの中（枠の中）で開いたときは、別のタブで開いてから印刷する。
//  枠のまま印刷すると、スマホでは画面全体が印刷されることがあるため
function sheetPrint(){
  if(inFrame()){ var w=window.open(location.href.split('#')[0]+'#print','_blank'); if(w) return; }
  window.print();
}
function sheetClose(){
  if(inFrame()){ try{ window.parent.postMessage({ tsugu:'closeManual' }, '*'); }catch(e){} return; }
  if(history.length>1) history.back(); else window.close();
}

var SHEET_ME=null;
var SHEET_BLANK='＿＿＿＿＿＿＿＿';
function sheetMeLoad(){
  try{ var v=JSON.parse(localStorage.getItem('tsugu_sheet_me')||'null'); return (v && typeof v==='object') ? v : null; }catch(e){ return null; }
}
//  右下の欄に書く。空の項目は手書き用の下線
function sheetMePaint(){
  var me=SHEET_ME||{};
  var n=document.getElementById('who-n'), c=document.getElementById('who-c');
  if(n) n.textContent=me.n ? (me.n+(me.co?'（'+me.co+'）':'')) : SHEET_BLANK;
  if(c){ var parts=[me.tel, me.mail].filter(function(x){ return x; }); c.textContent=parts.length ? parts.join('　') : SHEET_BLANK; }
}
//  直したところは、そのパートナーの設定に覚える（次に開いたときも同じ内容で出る）
function sheetMeSave(){
  try{ localStorage.setItem('tsugu_sheet_me', JSON.stringify(SHEET_ME)); }catch(e){}
  try{
    if(SHEET_ME.key && /^tsugu_prefs_/.test(SHEET_ME.key)){
      var p=JSON.parse(localStorage.getItem(SHEET_ME.key)||'{}')||{};
      p.sheetContact={ n:SHEET_ME.n||'', co:SHEET_ME.co||'', tel:SHEET_ME.tel||'', mail:SHEET_ME.mail||'' };
      localStorage.setItem(SHEET_ME.key, JSON.stringify(p));
    }
  }catch(e){}
}
function sheetMeEdit(){
  var box=document.getElementById('who-edit'); if(!box) return;
  box.classList.toggle('on');
}
function sheetMeInput(el){
  SHEET_ME=SHEET_ME||{};
  SHEET_ME[el.getAttribute('data-k')]=el.value.trim();
  sheetMePaint(); sheetMeSave();
}
function sheetMeInit(){
  if(!document.getElementById('who-n')) return;   //  担当の欄がない紙（パートナーの手元用）
  SHEET_ME=sheetMeLoad();
  sheetMePaint();
  var box=document.getElementById('who-edit');
  if(box){
    Array.prototype.forEach.call(box.querySelectorAll('input[data-k]'), function(el){
      el.value=(SHEET_ME && SHEET_ME[el.getAttribute('data-k')]) || '';
    });
  }
}
document.addEventListener('DOMContentLoaded', sheetMeInit);
if(location.hash==='#print') window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 400); });
