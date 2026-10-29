/* 化学RUSH！対戦の「芳香族・脂肪族・無機・高分子」の問題データを作る
   各クエストの暗記カード（問題・正解・誤答・解説）を読み、rush_fields.js に書き出す。
   ○×問題への変換（正解 or 誤答のどれかを「答え」として見せる）は rush_battle.js が試合ごとに行う。
   クエストの問題を直したら、games フォルダで次を実行し直すこと:
     node chembasics-quest/tools/build_rush_fields.js
*/
const fs=require('fs'), path=require('path');
const GAMES=path.join(__dirname,'..','..');

// ソースから `const NAME = [...]` / `{...}` の値の部分を取り出す（文字列の中の括弧は数えない）
function grab(file,name){
  const s=fs.readFileSync(path.join(GAMES,file),'utf8');
  const i=s.indexOf('const '+name);
  if(i<0) throw new Error(name+' が '+file+' にありません');
  let j=s.indexOf('=',i)+1; while(s[j]===' ') j++;
  const open=s[j], close=open==='['?']':'}';
  let d=0,k=j,inStr=false,q='';
  for(;k<s.length;k++){
    const c=s[k];
    if(inStr){ if(c==='\\'){k++;continue} if(c===q) inStr=false; continue; }
    if(c==='"'||c==="'"||c==='`'){ inStr=true; q=c; continue; }
    if(c===open) d++; else if(c===close){ d--; if(d===0) break; }
  }
  return (0,eval)('('+s.slice(j,k+1)+')');
}

// 暗記カード形式（芳香族・脂肪族）
function fromMemoDecks(file){
  return grab(file,'MEMO_DECKS').map(d=>({
    name:d.name,
    items:d.items.filter(it=>!it.hidden&&it.a&&it.wrongs&&it.wrongs.length)
      .map(it=>({id:it.id,q:it.q,a:it.a,w:it.wrongs,e:it.exp||'',img:it.img||undefined}))
  })).filter(d=>d.items.length);
}
// カテゴリ＋問題の形式（無機・高分子）
function fromCatData(file,fix){
  const D=grab(file,'DATA');
  return D.categories.map(c=>({
    name:c.name,
    items:D.items.filter(it=>it.cat===c.name&&!it.choiceImg&&it.correct&&it.wrongs&&it.wrongs.length).map(it=>fix({id:it.id,q:it.q,a:it.correct,w:it.wrongs,e:it.exp||'',img:it.img||undefined},D))
  })).filter(d=>d.items.length);
}
// 高分子クエストと同じ表記の整え（o-/m-/p- を斜体に、構造式名の (五員環) などは消す）と画像ファイル名
const ITAL={o:'\u{1D45C}',m:'\u{1D45A}',p:'\u{1D45D}'};
const ital=t=>String(t).replace(/(^|[^A-Za-z])([omp])-/g,(_,a,b)=>a+ITAL[b]+'-');
const lbl=t=>ital(String(t).replace(/\((五員環|六員環|鎖状構造)\)/g,''));
function polymerFix(it,D){
  it.q=ital(it.q); it.a=lbl(it.a); it.w=it.w.map(lbl);
  if(it.img) it.img=(D.images&&D.images[it.img])||it.img;
  return it;
}

const FIELDS=[
  {key:'aro',label:'芳香族',icon:'⌬',img:'../aromatic-quest/assets/memo/',decks:fromMemoDecks('aromatic-quest/index.html')},
  {key:'ali',label:'脂肪族',icon:'🧪',img:'../aliphatic-quest/assets/memo/',decks:fromMemoDecks('aliphatic-quest/index.html')},
  {key:'ino',label:'無機',icon:'⚗️',img:'',decks:fromCatData('inorganic-quest/index.html',it=>it)},
  {key:'pol',label:'高分子',icon:'🧬',img:'../polymer-quest/assets/memo/',decks:fromCatData('polymer-quest/data.js',polymerFix)},
];
for(const f of FIELDS){
  for(const d of f.decks) for(const it of d.items) if(it.img&&!fs.existsSync(path.join(GAMES,'chembasics-quest',f.img,it.img))) throw new Error('画像がありません: '+f.img+it.img);
  console.log(f.label, f.decks.length+'単元', f.decks.reduce((n,d)=>n+d.items.length,0)+'問');
}
const out='/* 自動生成ファイル（tools/build_rush_fields.js）。直接編集しないこと */\n'
  +'const RUSH_FIELDS='+JSON.stringify(FIELDS)+';\n';
fs.writeFileSync(path.join(GAMES,'chembasics-quest','rush_fields.js'),out);
console.log('rush_fields.js',(out.length/1024).toFixed(0)+'KB');
