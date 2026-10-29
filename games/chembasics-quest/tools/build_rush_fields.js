/* 化学RUSH！対戦の「芳香族・脂肪族・無機・高分子」の問題データを作る
   各クエストの暗記カード（問題・正解・誤答・解説）を読み、選択式の問題として rush_fields.js に書き出す。
   1問 = {id, q:問題文, c:[選択肢], k:[正解の番号], e:解説, img:問題の画像, ci:選択肢が画像, fix:選択肢の順番を固定}
   k が2つ以上なら「すべて選べ」（高分子）。選択肢の並べ替えは rush_battle.js が試合ごとに行う。
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

// 正解を先に並べた選択肢の配列にする。order があればその順に並べて固定する（高分子クエストと同じ）
function card(id,q,answers,wrongs,exp,img,order){
  const c=answers.map(t=>({t,ok:true})).concat(wrongs.map(t=>({t,ok:false})));
  if(order) c.sort((a,b)=>order.indexOf(a.t)-order.indexOf(b.t));
  const o={id,q,c:c.map(x=>x.t),k:c.map((x,i)=>x.ok?i:-1).filter(i=>i>=0),e:exp||''};
  if(img) o.img=img;
  if(order) o.fix=1;
  return o;
}
// 暗記カード形式（芳香族・脂肪族）
function fromMemoDecks(file){
  return grab(file,'MEMO_DECKS').map(d=>({
    name:d.name,
    items:d.items.filter(it=>!it.hidden&&it.a&&it.wrongs&&it.wrongs.length)
      .map(it=>card(it.id,it.q,[it.a],it.wrongs,it.exp,it.img))
  })).filter(d=>d.items.length);
}
// カテゴリ＋問題の形式（無機・高分子）
function fromCatData(file,fix){
  const D=grab(file,'DATA');
  return D.categories.map(c=>({
    name:c.name,
    items:D.items.filter(it=>it.cat===c.name&&(it.answers||it.correct)&&it.wrongs&&it.wrongs.length)
      .map(it=>fix(card(it.id,it.q,it.answers||[it.correct],it.wrongs,it.exp,it.img,it.order),it,D))
  })).filter(d=>d.items.length);
}
// 高分子クエストと同じ表記の整え（o-/m-/p- を斜体に、構造式名の (五員環) などは消す）と画像ファイル名
const ITAL={o:'\u{1D45C}',m:'\u{1D45A}',p:'\u{1D45D}'};
const ital=t=>String(t).replace(/(^|[^A-Za-z])([omp])-/g,(_,a,b)=>a+ITAL[b]+'-');
const lbl=t=>ital(String(t).replace(/\((五員環|六員環|鎖状構造)\)/g,''));
const imgFile=(name,D)=>(D.images&&D.images[name])||name;
function polymerFix(o,src,D){
  o.q=ital(o.q);
  if(src.choiceImg){ o.ci=1; o.c=o.c.map(n=>imgFile(n,D)); }  // 選択肢は構造式の画像ファイル名
  else o.c=o.c.map(lbl);
  if(o.img) o.img=imgFile(o.img,D);
  return o;
}

const FIELDS=[
  {key:'aro',label:'芳香族',img:'../aromatic-quest/assets/memo/',decks:fromMemoDecks('aromatic-quest/index.html')},
  {key:'ali',label:'脂肪族',img:'../aliphatic-quest/assets/memo/',decks:fromMemoDecks('aliphatic-quest/index.html')},
  {key:'ino',label:'無機',img:'',decks:fromCatData('inorganic-quest/index.html',o=>o)},
  {key:'pol',label:'高分子',img:'../polymer-quest/assets/memo/',decks:fromCatData('polymer-quest/data.js',polymerFix)},
];
for(const f of FIELDS){
  for(const d of f.decks) for(const it of d.items){
    for(const im of [it.img].concat(it.ci?it.c:[])) if(im&&!fs.existsSync(path.join(GAMES,'chembasics-quest',f.img,im))) throw new Error('画像がありません: '+f.img+im);
    if(it.c.length>9) throw new Error('選択肢が多すぎます: '+it.id);  // 並べ替えを1桁ずつの番号で持つため
  }
  console.log(f.label, f.decks.length+'単元', f.decks.reduce((n,d)=>n+d.items.length,0)+'問');
}
const out='/* 自動生成ファイル（tools/build_rush_fields.js）。直接編集しないこと */\n'
  +'const RUSH_FIELDS='+JSON.stringify(FIELDS)+';\n';
fs.writeFileSync(path.join(GAMES,'chembasics-quest','rush_fields.js'),out);
console.log('rush_fields.js',(out.length/1024).toFixed(0)+'KB');
