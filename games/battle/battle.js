/* ================= オンライン対戦（ルーム制・リアルタイム） 2026-10-30 独立ページ化 =================
   もとは化学基礎クエストの化学RUSH！の中にあった rush_battle.js。オンライン対戦は化学RUSH！とは別物として
   このページ（games/battle/index.html）だけで動く。問題データは化学RUSH！・各クエストのものを読んで使う。
   - 4桁のルームコードで1〜12人（うち観戦者を含む）。作成者が開始ボタンを押す
   - 2026-11 追加：ルーム作成時に「公開（コード不要・ロビー一覧に出る）」か「非公開（コード制・従来通り）」を選べる。
     対戦中の公開ルームに入ると観戦者（閲覧のみ）になる。対戦が終わると全員待機画面に戻り、観戦者も参加者になれる
   - 1人のまま開始したらゴースト1体と対戦（同じ分野の自分のベスト記録 → なければ同じ分野の他の人の記録からランダム）。
     ゴーストの再生は端末内だけ（試合中の通信なし）
   - 10問先取。正解+1・不正解/時間切れ−1（0未満にしない）
   - 問題は開始時に全員分まとめて配布（全員同じ順番）
   - 試合中に送るのは自分の現在位置（数字）とゴールタイム（各自の端末で計測）だけ
   - 切断してもすぐ負けにせず、DROP_MS のあいだ再接続を待つ（その間は席が残る。それを過ぎたら退室扱い）
   - 同じアカウントで別のタブ・端末から入ると後から入った方が勝ち、古い方は追い出される（SESSION_KEY で判定）
   - ?demo=1 を付けると、同じアカウントでもタブごとに別の参加者として入れる（動作確認用。多重入室の追い出しも働かない）
   - 分野は 化学基礎（化学RUSH！の○×問題）／芳香族・脂肪族・無機・高分子（各クエストの暗記カード）から選ぶ。
     化学基礎の問題は化学基礎クエストの index.html の RUNNER_QUESTIONS をそのまま読む（管理画面と同じやり方。写しは作らない）。
     4分野は ../chembasics-quest/rush_fields.js（tools/build_rush_fields.js で作る）を読み、元の選択式（多答は「決定」）のまま出す。
     画面はどの分野も同じ：背景の写真＋半透明の枠（横長は問題文が左・選択肢が右）で、枠に沿って時間のバーが12時から時計回りに減る。
     化学基礎は ○／× の2択
   問題ID：化学基礎は化学RUSH！のID（例 "q001"）、4分野は "分野|カードID|選択肢の並び"（例 "aro|d4-0|20413"）
   ルームの genre：化学基礎は化学RUSH！の範囲の値（'all' など）、4分野は "F:分野" か "F:分野:単元番号"
   Firebase のパス（mpRooms・mpLobby・mpLog・rbRecs・rbBest・rbBestF・rbGhostAv）は化学基礎クエストの中にあったときと同じ。

   Firebase Realtime Database のルールに次を追加すること（ルート "rules" の中）:
   "mpRooms": {
     "$code": {
       ".read": "auth != null",
       ".write": "auth != null && (!data.exists() || !data.child('meta/created').exists() || data.child('meta/created').val() < now - 10800000)",
       "meta": {
         ".write": "auth != null && data.exists()",
         "host":   { ".write": "auth != null && data.exists() && root.child('mpRooms/'+$code+'/members/'+newData.val()).exists()" }
       },
       "members": { "$pid": { ".write": "auth != null && $pid.beginsWith(auth.uid)" } },
       "$sub": { "$pid": { ".write": "auth != null && $pid.beginsWith(auth.uid)" } }
     }
   },
   2026-11 追加（公開ルーム一覧。mpRooms の要約だけを置くミラー。本体は mpRooms のまま）:
   "mpLobby": {
     "$quest": {
       ".read": "auth != null",
       "$code": {
         ".write": "auth != null && (!newData.exists() || (
             newData.child('host').val() === root.child('mpRooms/'+$code+'/meta/host').val() &&
             newData.child('genre').val() === root.child('mpRooms/'+$code+'/meta/genre').val() &&
             newData.child('status').val() === root.child('mpRooms/'+$code+'/meta/status').val() &&
             newData.child('created').val() === root.child('mpRooms/'+$code+'/meta/created').val()
           ))"
       }
     }
   },
   "rbRecs":    { "$uid": { ".read": "auth != null && auth.uid === $uid", ".write": "auth != null && auth.uid === $uid" } },
   "rbBest":    { ".read": "auth != null", "$uid": { ".write": "auth != null && auth.uid === $uid" } },
   "rbGhostAv": { "$uid": { ".read": "auth != null", ".write": "auth != null && auth.uid === $uid" } },
   2026-10-30 追加:
   "rbBestF":   { ".read": "auth != null", "$f": { "$uid": { ".write": "auth != null && auth.uid === $uid" } } },
   "mpLog": {
     ".read": （users の ".read" と同じ管理者の条件）,
     "$log": {
       "info":   { ".write": "auth != null && !data.exists()" },
       "rounds": { "$round": {
         "start": { ".write": "auth != null && !data.exists()" },
         "p": { "$pid": { ".write": "auth != null && $pid.beginsWith(auth.uid)" } } } }
     }
   }
   注：公開一覧(mpLobby)は mpRooms の値と一致する場合だけ書ける値なので、非公開ルームのコードや内容をここに書いて一覧に出すことはできない。
   mpRooms 自体は常に ".read": "auth != null" なので非公開ルームも「コードを知っていれば」読めるのは今まで通り（コードを知らない人が一覧から見つける方法が無いことが非公開の条件）。

   プレイ記録（ゴースト用）:
     rbRecs/{uid}/{push}  ゴールした試合すべて {ms, log, genre, n, at}
     rbBestF/{分野}/{uid} その人の分野ごとのベスト {ms, log, name, genre, at}（分野は basic/aro/ali/ino/pol）
     rbBest/{uid}         分野別にする前のベスト（読むだけ。分野が同じならゴーストに使う）   rbGhostAv/{uid} ベスト時の小さいアイコン
     log は "回答時刻ms,正誤(1/0);..."（時刻はスタートからの経過）

   データ構成 mpRooms/{code}:
     meta    {host, status:'wait'|'play', visibility:'public'|'private', genre, created, round, startAt,
              qs:[問題ID], players:[pid], ghost:{uid,name,ms,log,own}|null, maxMiss, endAfter}
     members/{pid} {name, joined, role:'player'|'spectator', session}
       session はこの pid の「今つながっている接続」を表すランダムな文字列。入室時に新しく発行し、
       自分の session と違う値に変わったら（後から別タブ/端末で入り直された）自分は追い出される
     av/{pid} 小さいアイコン(dataURL)   conn/{pid} true か 切断時刻
     pos_{round}/{pid} 現在位置    goal_{round}/{pid} ゴールまでのミリ秒（棄権は -1）
   データ構成 mpLobby/{quest}/{code}（公開ルームだけ。一覧表示用のミラー。$quest は basic/aro/ali/ino/pol）:
     {host, hostName, genre, status:'wait'|'play', playerCount, created}
*/
const RB=(function(){
  const ROOT='mpRooms', LOBBY='mpLobby', LOG='mpLog', GOAL=10, MIN_PLAYERS=1;
  const MAX_PLAYERS=10;          // レース（観戦者を含まない）の目安人数・ロビー一覧の「満室」表示に使う
  const HARD_CAP=12;             // 観戦者を含めた絶対上限。これを超える入室はトランザクションで拒否
  const GHOST='~ghost';         // ゴーストのレーン用の pid（Firebase のキーには使わない）
  const DROP_MS=60000;          // これより長く切断していたら「通信切れ」扱い（表示のみ）
  const LEAVE_GRACE_MS=45000;   // 切断からこの時間を過ぎたら実際に退室させる（iPhoneのアプリ切替・短いスリープ用の猶予）
  const EMPTY_ROOM_GRACE_MS=15000;  // 作成直後の一瞬だけメンバーが空なのを「誰もいない」と誤判定しないための猶予
  const ROOM_TTL=3*3600*1000;   // 古いルームのコードは再利用してよい
  const LOBBY_LIST_MAX=20;      // ロビー一覧に出す最大件数
  const QUESTION_COUNT=120;     // 配布する問題数（足りなければ同じ順番でもう一周）
  const AV_SIZE=48;
  const SESS_KEY='rbSession_v1';
  const DEMO=/[?&]demo=1\b/.test(location.search);
  const randTag=()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
  const TS=()=>firebase.database.ServerValue.TIMESTAMP;
  const esc=t=>String(t==null?'':t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const panel=document.getElementById('battlePanel');
  const shuffle=arr=>{ const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
  let qmap=new Map();
  const Q=id=>{
    if(!qmap.has(id)){ const q=id.includes('|')?fieldQ(id):basicQ(id); if(q) qmap.set(id,q); }
    return qmap.get(id);
  };
  let toastTimer=null;
  function toast(msg){
    const t=document.getElementById('toast'); if(!t) return;
    t.textContent=msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove('show'),2200);
  }

  /* ---------- 分野（化学基礎・芳香族・脂肪族・無機・高分子） ---------- */
  const BASICS={key:'basic',label:'化学基礎'};
  const FIELD_KEY='rbField_v1';  // 最後に選んだ分野と範囲 {field, genre}
  /* 化学基礎：化学RUSH！の○×問題（化学基礎クエストの index.html の RUNNER_QUESTIONS）。
     範囲の値・名前は化学RUSH！と同じ（ルームの genre・ゴーストの記録をそのまま使うため） */
  let BASIC_QS=null, BASIC_SCOPES=null, basicP=null;
  const BASIC_GENRE_NUM={'物質の構成':'①','化学結合と物質量':'②','酸と塩基・酸化還元':'③','状態変化・気体の法則・結晶格子':'④'};
  const BASIC_BUNKEI=['物質の構成','化学結合と物質量'];
  const BASIC_ONLY=['物質の構成','化学結合と物質量','酸と塩基・酸化還元'];
  function loadBasics(){
    if(BASIC_QS) return Promise.resolve();
    if(!basicP) basicP=fetch('../chembasics-quest/index.html').then(r=>{ if(!r.ok) throw new Error(r.status); return r.text(); }).then(text=>{
      const mk='const RUNNER_QUESTIONS = ', s=text.indexOf(mk);
      const e=s<0?-1:text.indexOf('}];',s);
      if(e<0) throw new Error('RUNNER_QUESTIONS が見つかりません');
      BASIC_QS=new Map(JSON.parse(text.slice(s+mk.length,e+2)).map(q=>[q.id,q]));
      const qs=[...BASIC_QS.values()], genres=[...new Set(qs.map(q=>q.genre))];
      BASIC_SCOPES=[
        {value:'all', label:'化学基礎＋α(理系向け) ①〜④', match:()=>true},
        {value:'bunkei', label:'化学基礎11月模試用(文系向け) ①＋②', match:g=>BASIC_BUNKEI.includes(g)},
        {value:'chemBasicsOnly', label:'化学基礎ALL ①〜③', match:g=>BASIC_ONLY.includes(g)},
        ...genres.map(g=>({value:g, label:(BASIC_GENRE_NUM[g]||'')+g, match:gg=>gg===g}))
      ].map(sc=>Object.assign(sc,{n:qs.filter(q=>sc.match(q.genre)).length}));
    }).catch(e=>{ basicP=null; console.warn('[RB] basics',e); throw new Error('問題データを読み込めませんでした。通信を確認してね'); });
    return basicP;
  }
  const basicScopeOf=v=>BASIC_SCOPES&&(BASIC_SCOPES.find(s=>s.value===v)||BASIC_SCOPES[0]);
  // 化学RUSH！の○×問題1問を ○／× の2択にする
  function basicQ(id){
    const q=BASIC_QS&&BASIC_QS.get(id); if(!q) return null;
    const ans=q.answer?'○':'×';
    return {id, field:BASICS.key, choice:true, ox:true, genre:BASICS.label+'｜'+q.genre, q:q.statement, pic:'', multi:false, ci:false,
      choices:[{html:'○',ok:!!q.answer},{html:'×',ok:!q.answer}],
      statement:`<div>${q.statement}</div><div class="rb-cand">正解：<b>${ans}</b></div>`,
      explanation:q.explanation||''};
  }
  let fieldsP=null;
  function loadFields(){
    if(typeof RUSH_FIELDS!=='undefined') return Promise.resolve();
    if(!fieldsP) fieldsP=new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src='../chembasics-quest/rush_fields.js?v=2';
      s.onload=resolve;
      s.onerror=()=>{ fieldsP=null; s.remove(); reject(new Error('問題データを読み込めませんでした。通信を確認してね')); };
      document.head.appendChild(s);
    });
    return fieldsP;
  }
  // 化学基礎と4分野の問題データをまとめて読む（片方が読めなくても、読めた分野は遊べる）
  function loadAll(){ return Promise.allSettled([loadBasics(),loadFields()]); }
  // 問題データを読み終わる前も分野のボタンは全部出しておく（あとから増えて画面がずれないように）
  const FIELD_STUBS=[{key:'aro',label:'芳香族'},{key:'ali',label:'脂肪族'},{key:'ino',label:'無機'},{key:'pol',label:'高分子'}];
  const fieldList=()=>[BASICS].concat(typeof RUSH_FIELDS!=='undefined'?RUSH_FIELDS:FIELD_STUBS);
  const fieldOf=key=>(typeof RUSH_FIELDS!=='undefined'&&RUSH_FIELDS.find(f=>f.key===key))||null;
  function parseScope(genre){
    const m=/^F:(\w+)(?::(\d+))?$/.exec(genre||'');
    return m ? {field:fieldOf(m[1]), deck:m[2]==null?null:+m[2]} : null;
  }
  function scopeLabel(genre){
    const s=parseScope(genre);
    if(!s) return BASICS.label+'：'+(BASIC_SCOPES?basicScopeOf(genre).label:'（問題データを読み込み中）');
    if(!s.field) return '（問題データを読み込み中）';
    return s.field.label+'：'+(s.deck==null?'全範囲':s.field.decks[s.deck].name);
  }
  function scopeOptions(fkey){
    if(fkey===BASICS.key) return (BASIC_SCOPES||[]).map(s=>({value:s.value,label:`${s.label}（${s.n}問）`}));
    const f=fieldOf(fkey); if(!f) return [];
    const total=f.decks.reduce((n,d)=>n+d.items.length,0);
    return [{value:'F:'+f.key,label:`全範囲（${total}問）`}]
      .concat(f.decks.map((d,i)=>({value:'F:'+f.key+':'+i,label:`${d.name}（${d.items.length}問）`})));
  }
  let cardIndex={};
  function cardOf(f,id){
    if(!cardIndex[f.key]){ const m=new Map(); f.decks.forEach(d=>d.items.forEach(it=>m.set(it.id,{it,deck:d}))); cardIndex[f.key]=m; }
    return cardIndex[f.key].get(id);
  }
  // 暗記カード1枚を選択式の問題にする。perm は選択肢の並び（カードの選択肢の番号を1桁ずつ並べたもの）
  function fieldQ(id){
    const [fk,cid,perm]=id.split('|');
    const f=fieldOf(fk), hit=f&&cardOf(f,cid);
    if(!hit||!perm) return null;
    const {it,deck}=hit;
    const order=perm.split('').map(Number);
    if(order.length!==it.c.length||order.some(i=>!(i<it.c.length))) return null;
    const src=n=>esc(f.img+encodeURIComponent(n));
    const html=t=>it.ci?`<img class="rb-cimg" src="${src(t)}" alt="構造式">`:t;
    const pic=it.img?`<img class="rb-qimg" src="${src(it.img)}" alt="構造式">`:'';
    const right=it.k.map(i=>html(it.c[i])).join(it.ci?'':'・');
    return {id, field:fk, choice:true, genre:f.label+'｜'+deck.name, q:it.q, pic, multi:it.k.length>1, ci:!!it.ci,
      choices:order.map(i=>({html:html(it.c[i]), ok:it.k.includes(i)})),
      // 振り返り用
      statement:`${pic}<div>${it.q}</div><div class="rb-cand">正解：<b>${right}</b></div>`,
      explanation:it.e};
  }
  // 開始時に配る問題IDの列。選択肢の並びも全員同じになるよう、ここで決めてIDに入れる
  function buildPool(genre){
    const s=parseScope(genre);
    if(!s){
      if(!BASIC_QS) throw new Error('問題データを読み込めませんでした');
      const sc=basicScopeOf(genre);
      let base=[...BASIC_QS.values()].filter(q=>sc.match(q.genre));
      if(base.length<5) base=[...BASIC_QS.values()];
      return shuffle(base).slice(0,QUESTION_COUNT).map(q=>q.id);
    }
    if(!s.field) throw new Error('問題データを読み込めませんでした');
    const cards=[];
    s.field.decks.forEach((d,i)=>{ if(s.deck==null||s.deck===i) cards.push(...d.items); });
    const ids=[];
    // 単元が小さいときは2周目以降も配る（選択肢の並びはその都度変える）
    while(ids.length<QUESTION_COUNT&&cards.length){
      for(const it of shuffle(cards)){
        const idx=it.c.map((_,i)=>i);
        ids.push(s.field.key+'|'+it.id+'|'+(it.fix?idx:shuffle(idx)).join(''));
        if(ids.length>=QUESTION_COUNT) break;
      }
    }
    return ids;
  }
  function loadFieldPref(){ try{ return JSON.parse(localStorage.getItem(FIELD_KEY))||{}; }catch(e){ return {}; } }
  function saveFieldPref(p){ try{ localStorage.setItem(FIELD_KEY,JSON.stringify(p)); }catch(e){} }

  let db=null, offset=0, online=true;
  function getDb(){
    if(db) return db;
    db=window.RB_TEST_DB||firebase.database();
    db.ref('.info/serverTimeOffset').on('value',s=>{ offset=s.val()||0; });
    db.ref('.info/connected').on('value',s=>{ online=s.val()===true; onConnChange(); });
    return db;
  }
  const serverNow=()=>Date.now()+offset;

  /* ---------- 自分 ---------- */
  function me(){
    const u=LB.currentUser(); if(!u) return null;
    if(!DEMO) return {pid:u.uid, uid:u.uid, name:u.nickname||'ゲスト', avatar:u.avatar||null};
    let tag=null;
    try{ tag=sessionStorage.getItem('rbDemoTag'); }catch(e){}
    if(!tag){
      tag=String.fromCharCode(65+Math.floor(Math.random()*26))+String.fromCharCode(65+Math.floor(Math.random()*26));
      try{ sessionStorage.setItem('rbDemoTag',tag); }catch(e){}
    }
    return {pid:u.uid+'-'+tag, uid:u.uid, name:(u.nickname||'ゲスト').slice(0,8)+'('+tag+')', avatar:null};
  }
  function loadSess(){ try{ return JSON.parse(sessionStorage.getItem(SESS_KEY)); }catch(e){ return null; } }
  function saveSess(s){ try{ s?sessionStorage.setItem(SESS_KEY,JSON.stringify(s)):sessionStorage.removeItem(SESS_KEY); }catch(e){} }

  // アイコンを小さく作り直す（待機画面で1回だけ送受信する）。画像が無ければ頭文字の丸アイコン
  function smallAvatar(src,name,seed){
    return new Promise(resolve=>{
      const c=document.createElement('canvas'); c.width=c.height=AV_SIZE;
      const x=c.getContext('2d');
      const letter=()=>{
        let h=0; for(const ch of String(seed)) h=(h*31+ch.charCodeAt(0))>>>0;
        x.fillStyle=`hsl(${h%360},65%,48%)`; x.beginPath(); x.arc(AV_SIZE/2,AV_SIZE/2,AV_SIZE/2,0,Math.PI*2); x.fill();
        x.fillStyle='#fff'; x.font=`bold ${AV_SIZE*0.5}px sans-serif`; x.textAlign='center'; x.textBaseline='middle';
        x.fillText([...String(name||'?')][0],AV_SIZE/2,AV_SIZE/2+1);
        resolve(c.toDataURL('image/png'));
      };
      if(!src) return letter();
      const im=new Image();
      im.onload=()=>{ const s=Math.min(im.width,im.height); x.drawImage(im,(im.width-s)/2,(im.height-s)/2,s,s,0,0,AV_SIZE,AV_SIZE); resolve(c.toDataURL('image/jpeg',0.7)); };
      im.onerror=letter;
      im.src=src;
    });
  }

  /* ---------- ルームの状態 ---------- */
  let room=null;
  let st=null;   // 試合中の画面の状態（問題・タイマー・答えた履歴）
  let lastRun=null;  // 振り返り用（直前の試合の答えた履歴）
  function newRoom(code){
    return {code, ref:getDb().ref(ROOT+'/'+code), me:me(), meta:null, members:{}, names:{}, imgs:{}, conn:{},
      pos:{}, goal:{}, round:0, offs:[], roundOffs:[], view:'lobby', laneSlots:null, tick:null, dropTick:null,
      goalSent:false, localStart:0, countdown:null, toasted:{}, ghost:null, ghostTick:null, log:[], myAv:null, mySession:null};
  }
  const roleOf=pid=>(room.members[pid]&&room.members[pid].role)||'player';
  // 公開ルームの一覧（mpLobby/{quest}/{code}）。本体(mpRooms)の値をそのまま写すだけ（ルールが一致を強制する）
  function questKeyOf(genre){ return fieldKeyOf(genre); }
  function mirrorLobby(r){
    if(!r||!r.meta||r.meta.visibility!=='public') return;
    getDb().ref(LOBBY+'/'+questKeyOf(r.meta.genre)+'/'+r.code).set({
      host:r.meta.host, hostName:nameOf(r.meta.host)||'?', genre:r.meta.genre,
      status:r.meta.status, playerCount:Object.keys(r.members||{}).length, created:r.meta.created
    }).catch(e=>console.warn('[RB] lobby mirror',e));
  }
  function unmirrorLobby(r){
    if(!r||!r.meta||r.meta.visibility!=='public') return;
    getDb().ref(LOBBY+'/'+questKeyOf(r.meta.genre)+'/'+r.code).remove().catch(()=>{});
  }
  function listen(ref,ev,cb,list){ ref.on(ev,cb); (list||room.offs).push(()=>ref.off(ev,cb)); }
  function active(){ return !!room; }
  function playing(){ return !!(room&&room.view==='play'&&!room.goalSent); }

  function img(pid){
    // 試合中はこの img を動かすだけで、読み込み直さない
    if(!room.imgs[pid]){ const i=new Image(); i.className='rb-av'+(pid===GHOST?' rb-ghost':''); i.alt=''; i.draggable=false; room.imgs[pid]=i; }
    return room.imgs[pid];
  }
  function nameOf(pid){ const m=room.members[pid]; return m?m.name:(room.names[pid]||'?'); }  // 退室した人も名前は残す
  function isOnline(pid){ return pid===room.me.pid ? online : pid===GHOST ? true : room.conn[pid]===true; }
  function isDropped(pid){ const c=room.conn[pid]; return typeof c==='number' && serverNow()-c>DROP_MS; }
  function effectiveHost(){
    const m=room.meta; if(!m) return null;
    if(room.members[m.host] && isOnline(m.host)) return m.host;
    const alive=sortedMembers().filter(isOnline);
    return alive[0]||m.host;
  }
  function sortedMembers(){
    return Object.keys(room.members).sort((a,b)=>(room.members[a].joined||0)-(room.members[b].joined||0)||a.localeCompare(b));
  }

  /* ---------- 入室・退室 ---------- */
  async function createRoom(genre,visibility){
    const m=me();
    const log=getDb().ref(LOG).push().key;  // 記録（mpLog）のキー。ルームのコードは使い回されるので別に持つ
    const vis=visibility==='public'?'public':'private';
    for(let i=0;i<10;i++){
      const code=String(1000+Math.floor(Math.random()*9000));
      try{
        await getDb().ref(ROOT+'/'+code).set({meta:{host:m.pid,status:'wait',visibility:vis,genre,created:TS(),round:0,log}});
        getDb().ref(LOG+'/'+log+'/info').set({code,host:m.uid,hostName:m.name,genre,created:TS()}).catch(e=>console.warn('[RB] log',e));
        return enterRoom(code,'player');
      }catch(e){
        if(!/permission/i.test(String(e&&(e.code||e.message)))) throw e;
      }
    }
    throw new Error('ルームを作れませんでした。時間をおいてもう一度試してね。（管理者の方へ：Firebase のルールに mpRooms が入っているか確認してください）');
  }
  // 入室はトランザクションで判定：部屋が無ければ拒否／満員(観戦者を含め12人)なら拒否／対戦中なら観戦者として受け入れ
  async function joinRoom(code){
    if(!/^\d{4}$/.test(code)) throw new Error('4桁の数字を入れてね');
    const m=me();
    const roomRef=getDb().ref(ROOT+'/'+code);
    const meta=(await roomRef.child('meta').once('value')).val();
    if(!meta||!meta.created||serverNow()-meta.created>ROOM_TTL) throw new Error('そのコードのルームは見つかりませんでした。解散したのかもしれません');
    const role=meta.status==='play'?'spectator':'player';
    const txn=await roomRef.child('members').transaction(curr=>{
      if(curr===null) return;              // members が無い＝消えている最中。拒否してあとで判定する
      if(curr[m.pid]) return curr;          // 再入室（同じ人）。人数は変わらないのでそのまま
      if(Object.keys(curr).length>=HARD_CAP) return;  // undefined を返すとトランザクション失敗＝満員で拒否
      curr[m.pid]={name:m.name,joined:Date.now(),role};
      return curr;
    });
    if(!txn.committed){
      const meta2=(await roomRef.child('meta').once('value')).val();
      if(!meta2) throw new Error('そのコードのルームは見つかりませんでした。解散したのかもしれません');
      throw new Error('このルームは満員です（観戦者を含め最大'+HARD_CAP+'人）');
    }
    const after=txn.snapshot.val()||{};
    const finalRole=(after[m.pid]&&after[m.pid].role)||role;
    return enterRoom(code,finalRole);
  }
  // 管理者だけの乱入（管理画面のルーム一覧から #intrude-1234 で来る）。
  // 試合中・満員でも入れる。試合中なら players に自分を足し、届いた時点からスタート。
  // 管理者かどうかは「users を読めるか」で判定（Firebase のルールで管理者だけが読める）
  async function intrude(code){
    if(!/^\d{4}$/.test(code)) throw new Error('4桁の数字を入れてね');
    const m=me(); if(!m) throw new Error('ログインしてね');
    try{ await getDb().ref('users').limitToFirst(1).once('value'); }
    catch(e){ throw new Error('乱入は管理者だけです'); }
    const meta=(await getDb().ref(ROOT+'/'+code+'/meta').once('value')).val();
    if(!meta) throw new Error('そのコードのルームは見つかりませんでした');
    await enterRoom(code,'player');
    if(meta.status==='play'){
      await getDb().ref(ROOT+'/'+code+'/meta/players').transaction(p=>{
        p=p||[]; if(!p.includes(m.pid)) p.push(m.pid); return p;
      });
    }
  }
  async function enterRoom(code,role){
    if(room) detach();
    room=newRoom(code);
    const r=room, m=r.me;
    const sess=loadSess();
    // 同じルームに入り直すとき（再読み込みなど）は、試合の途中経過を残す
    const same=sess&&sess.code===code&&sess.pid===m.pid;
    // ルームの問題を出せるよう、先に問題データを読んでおく
    await loadAll();
    if(room!==r) return;
    const av=await smallAvatar(m.avatar,m.name,m.pid);
    if(room!==r) return;
    r.myAv=av;
    const joined=(same&&sess.joined)||Date.now();
    const mySession=randTag();  // 多重入室対策：自分の在室印。後から別タブ/端末で入り直すとここが書き換わる
    r.mySession=mySession;
    saveSess(same?sess:{code,pid:m.pid,joined});
    // members はピンポイント更新（role・session を消さないように、まるごと置き換えない）
    await r.ref.update({
      ['members/'+m.pid+'/name']:m.name,
      ['members/'+m.pid+'/joined']:joined,
      ['members/'+m.pid+'/role']:role||'player',
      ['members/'+m.pid+'/session']:mySession,
      ['av/'+m.pid]:av
    });
    // 切断を検知したら時刻を書く。つながり直したら true に戻す
    const connRef=r.ref.child('conn/'+m.pid);
    listen(getDb().ref('.info/connected'),'value',s=>{
      if(s.val()!==true) return;
      connRef.onDisconnect().set(TS());
      connRef.set(true);
    });
    // 自分の session が書き換わったら、別の画面で入り直されたということ＝自分は退出する（後勝ち）
    if(!DEMO) listen(r.ref.child('members/'+m.pid+'/session'),'value',s=>{
      const v=s.val();
      if(v!=null&&v!==mySession) kicked();
    });
    listen(r.ref.child('members'),'value',s=>{
      const v=s.val();
      r.members=v||{};
      for(const k in r.members) r.names[k]=r.members[k].name;
      render();
      mirrorLobby(r);
      // 全員いなくなってから少し経ったら、見ている人がいないのでルームを消す（作成直後の一瞬だけ空なのは除く）
      if(!v&&r.meta&&typeof r.meta.created==='number'&&serverNow()-r.meta.created>EMPTY_ROOM_GRACE_MS){
        unmirrorLobby(r); r.ref.remove().catch(()=>{});
      }
    });
    // アイコンは1人1回だけ受け取る（child_added）
    listen(r.ref.child('av'),'child_added',s=>{ img(s.key).src=s.val(); if(r.view==='lobby') render(); });
    listen(r.ref.child('conn'),'value',s=>{ r.conn=s.val()||{}; render(); });
    listen(r.ref.child('meta'),'value',s=>onMeta(s.val()));
    r.tick=setInterval(()=>{ if(r.view==='play'||r.view==='result') render(); },2000);
    r.dropTick=setInterval(checkDrops,5000);
  }
  // 切断してから LEAVE_GRACE_MS を過ぎた人を実際に退室させる（復帰の猶予が終わった人だけ）
  function checkDrops(){
    const r=room; if(!r||!r.meta) return;
    const now=serverNow();
    let removedAny=false;
    sortedMembers().forEach(pid=>{
      if(pid===r.me.pid) return;
      const c=r.conn[pid];
      if(typeof c!=='number'||now-c<=LEAVE_GRACE_MS) return;
      removedAny=true;
      if(r.meta.host===pid){
        const next=sortedMembers().filter(p=>p!==pid&&isOnline(p))[0];
        if(next) r.ref.child('meta/host').set(next).catch(()=>{});
      }
      r.ref.update({['members/'+pid]:null,['av/'+pid]:null,['conn/'+pid]:null}).catch(()=>{});
    });
    if(removedAny) r.ref.child('members').once('value').then(snap=>{
      if(!snap.val()){ unmirrorLobby(r); r.ref.remove().catch(()=>{}); }
    }).catch(()=>{});
  }
  // 別タブ/別端末で入り直されて追い出されたとき
  function kicked(){
    if(!room) return;
    toast('別の画面で入室したため退出しました');
    if(st) destroyRun();
    detach();
    saveSess(null);
    openHome();
  }
  function detach(){
    if(!room) return;
    room.offs.forEach(f=>f()); room.roundOffs.forEach(f=>f());
    clearInterval(room.tick); clearInterval(room.countdown); clearInterval(room.ghostTick); clearInterval(room.endTick); clearInterval(room.dropTick);
    room=null;
  }
  function leave(){
    if(!room) return;
    const r=room, pid=r.me.pid;
    const upd={['members/'+pid]:null,['av/'+pid]:null,['conn/'+pid]:null};
    r.ref.child('conn/'+pid).onDisconnect().cancel();
    if(r.meta&&r.meta.host===pid){
      const next=sortedMembers().filter(p=>p!==pid&&isOnline(p))[0];
      if(next) r.ref.child('meta/host').set(next);
    }
    r.ref.update(upd).then(()=>r.ref.child('members').once('value')).then(snap=>{
      // 自分が最後の1人だったら、誰も見ていないので自分でルームを消す
      if(!snap.val()){ unmirrorLobby(r); r.ref.remove(); }
    }).catch(()=>{});
    detach();
    saveSess(null);
  }
  // 試合の途中でやめる（棄権）
  function quit(){
    if(room&&room.view==='play'&&!room.goalSent){
      room.goalSent=true;
      room.ref.child('goal_'+room.round+'/'+room.me.pid).set(-1).catch(()=>{});
      logEnd(-1);
    }
    if(st) destroyRun();
    leave();
  }

  /* ---------- meta の変化（開始・再戦） ---------- */
  function onMeta(meta){
    const r=room; if(!r) return;
    if(!meta){ toast('ルームがなくなりました'); if(st) destroyRun(); detach(); saveSess(null); openHome(); return; }
    r.meta=meta;
    mirrorLobby(r);
    if(meta.status==='play'&&(meta.players||[]).includes(r.me.pid)){
      if(r.round!==meta.round||r.view==='lobby'){
        if(r.round!==meta.round) setupRound(meta.round);
        const g=r.goal[r.me.pid];
        if(g!=null){ r.goalSent=true; r.view='result'; }
        else beginCountdown();
      }
    }else if(meta.status==='wait'&&r.view!=='lobby'){
      if(st) destroyRun();
      r.view='lobby';
    }
    render();
  }
  function setupRound(round){
    const r=room;
    r.roundOffs.forEach(f=>f()); r.roundOffs=[];
    r.round=round; r.pos={}; r.goal={}; r.goalSent=false; r.laneSlots=null; r.toasted={}; r.log=[]; r.newBest=false;
    setupGhost(r.meta&&r.meta.ghost);
    const posRef=r.ref.child('pos_'+round), goalRef=r.ref.child('goal_'+round);
    // 相手の位置は表示だけに使う（勝敗には使わない）
    const onPos=s=>{ if(s.key!==r.me.pid){ r.pos[s.key]=s.val()|0; renderLanes(); } };
    listen(posRef,'child_added',onPos,r.roundOffs);
    listen(posRef,'child_changed',onPos,r.roundOffs);
    const onGoal=s=>{
      r.goal[s.key]=s.val();
      // 再読み込みで戻ってきたが、もうゴール済みだった
      if(s.key===r.me.pid&&r.view!=='result'&&r.view!=='review'){ r.goalSent=true; if(st) destroyRun(); r.view='result'; }
      if(s.key!==r.me.pid&&s.val()>=0&&r.view==='play'&&!r.toasted[s.key]){ r.toasted[s.key]=1; toast('🏁 '+nameOf(s.key)+' がゴール！'); }
      render();
    };
    listen(goalRef,'child_added',onGoal,r.roundOffs);
    listen(goalRef,'child_changed',onGoal,r.roundOffs);
  }
  async function startMatch(){
    const r=room; if(!r||!r.meta) return;
    // 観戦者はレースに入れない（対戦中に入ってきた人・待機中でも自分で観戦のままにはできない仕様なので通常は player のみ）
    const players=sortedMembers().filter(pid=>isOnline(pid)&&roleOf(pid)==='player').slice(0,MAX_PLAYERS);
    if(players.length<MIN_PLAYERS) return;
    const ghost=players.length===1 ? await pickGhost(r.meta.genre) : null;  // 1人ならゴーストと対戦（同じ分野の記録から）
    if(room!==r) return;
    const qs=buildPool(r.meta.genre), round=(r.meta.round||0)+1;
    await r.ref.child('meta').update({status:'play',round,qs,players,ghost,startAt:serverNow()+4000});
    if(r.meta.log){
      const names={}; players.forEach(p=>names[p]=nameOf(p));
      logRef(r,round).child('start').set({at:TS(),genre:r.meta.genre,players:names,ghost:ghost?ghost.name:null,ghostMs:ghost?ghost.ms:null,maxMiss:missLimit(),endAfter:endAfterMs()/1000})
        .catch(e=>console.warn('[RB] log',e));
    }
  }
  /* ---------- 対戦の記録（管理画面用・消さない） 2026-10-30 ----------
     mpLog/{log}/info {code, host(uid), hostName, genre, created}          … ルームを作った人が書く
     mpLog/{log}/rounds/{round}/start {at, genre, players{pid:名前}, ghost, ghostMs} … スタートを押した人が書く
     mpLog/{log}/rounds/{round}/p/{pid} {uid, name, a/{i}:{q,ok,t}, end}  … 各自が書く。
       a は1問ごと（q 問題ID・ok 1/0・t スタートからのms）。棄権しても途中までの答えが残る。end はゴールのms、棄権は -1 */
  const logRef=(r,round)=>getDb().ref(LOG+'/'+r.meta.log+'/rounds/'+round);
  function logAnswer(qid,ok,t){
    const r=room; if(!r||!r.meta||!r.meta.log) return;
    logRef(r,r.round).child('p/'+r.me.pid+'/a/'+(r.log.length-1)).set({q:qid||'',ok:ok?1:0,t}).catch(e=>console.warn('[RB] log',e));
  }
  function logEnd(v){
    const r=room; if(!r||!r.meta||!r.meta.log) return;
    logRef(r,r.round).child('p/'+r.me.pid+'/end').set(v).catch(e=>console.warn('[RB] log',e));
  }
  // 再戦：対戦中に入ってきた観戦者も、次の対戦からは参加者になる
  function rematch(){
    const r=room; if(!r) return;
    r.ref.child('meta').update({status:'wait'});
    r.ref.child('members').transaction(curr=>{
      if(!curr) return curr;
      for(const k in curr) if(curr[k]) curr[k].role='player';
      return curr;
    });
  }

  /* ---------- ゴースト（1人で始めたとき） ---------- */
  const encLog=log=>log.map(e=>e[0]+','+(e[1]?1:0)).join(';');
  const decLog=s=>String(s||'').split(';').filter(Boolean).map(x=>{ const a=x.split(','); return [+a[0]||0,a[1]==='1']; });
  // まだ誰の記録もないときの練習用ゴースト（1問4〜7秒・だいたい8割正解）
  function practiceGhost(){
    const log=[]; let t=0,p=0;
    while(p<GOAL){
      t+=4000+Math.floor(Math.random()*3000);
      const ok=Math.random()<0.8; p=Math.max(0,p+(ok?1:-1)); log.push([t,ok]);
      t+=ok?1200:1600;
    }
    return {uid:null,name:'練習ゴースト',ms:log[log.length-1][0],log:encLog(log),own:false};
  }
  // ゴーストは分野ごと（2026-10-30）。ルームの genre から分野のキー（basic/aro/ali/ino/pol）を出す
  const fieldKeyOf=genre=>{ const m=/^F:(\w+)/.exec(genre||''); return m?m[1]:BASICS.key; };
  // 同じ分野の自分のベストがあればそれ、なければ同じ分野の他の人のベストからランダムに1つ。
  // 分野別にする前の rbBest（1人1つ）も、分野が同じなら使う
  async function pickGhost(genre){
    const d=getDb(), uid=room.me.uid, fk=fieldKeyOf(genre);
    const sameField=g=>g&&g.log&&g.ms>0&&fieldKeyOf(g.genre)===fk;
    try{
      let mine=(await d.ref('rbBestF/'+fk+'/'+uid).once('value')).val();
      if(!mine||!mine.log){ const old=(await d.ref('rbBest/'+uid).once('value')).val(); if(sameField(old)) mine=old; }
      if(mine&&mine.log) return {uid,name:mine.name||room.me.name,ms:mine.ms,log:mine.log,own:true};
      // ランダムなキーの位置から数件だけ読む（全員分は読まない）
      const abc='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
      let k=''; for(let i=0;i<28;i++) k+=abc[Math.floor(Math.random()*abc.length)];
      const take=async(q,ok)=>{ const v=(await q.once('value')).val()||{}; return Object.keys(v).filter(id=>id!==uid&&ok(v[id])).map(id=>Object.assign({uid:id},v[id])); };
      const has=g=>g&&g.log&&g.ms>0;
      const ref=d.ref('rbBestF/'+fk);
      let c=await take(ref.orderByKey().startAt(k).limitToFirst(3),has);
      if(!c.length) c=await take(ref.orderByKey().limitToFirst(3),has);
      // 分野別の記録がまだ無いときは、前の rbBest から同じ分野のものを探す
      if(!c.length) c=await take(d.ref('rbBest').orderByKey().startAt(k).limitToFirst(10),sameField);
      if(!c.length) c=await take(d.ref('rbBest').orderByKey().limitToFirst(10),sameField);
      if(c.length){ const g=c[Math.floor(Math.random()*c.length)]; return {uid:g.uid,name:g.name||'?',ms:g.ms,log:g.log,own:false}; }
    }catch(e){ console.warn('[RB] ghost',e); }
    return practiceGhost();
  }
  function setupGhost(g){
    const r=room;
    delete r.imgs[GHOST]; r.ghost=null;
    if(!g||!g.log) return;
    r.ghost={name:g.name,ms:g.ms,own:!!g.own,log:decLog(g.log)};
    r.names[GHOST]='👻 '+(g.own?'自分のベスト':g.name);
    // アイコンは開始時に1回だけ読む（元のプレイヤーのアイコンを半透明で出す）
    const set=src=>{ if(room===r) img(GHOST).src=src; };
    const fallback=()=>smallAvatar(null,'👻',GHOST).then(set);
    if(g.own&&r.myAv) set(r.myAv);
    else if(g.uid) getDb().ref('rbGhostAv/'+g.uid).once('value').then(s=>s.val()?set(s.val()):fallback()).catch(fallback);
    else fallback();
  }
  function ghostPos(t){
    let p=0;
    for(const [at,ok] of room.ghost.log){ if(at>t) break; p=Math.max(0,p+(ok?1:-1)); }
    return Math.min(GOAL,p);
  }
  // ゴーストもミスの上限を守る。上限に達する時刻（達しなければ null）
  function ghostOutAt(){
    const lim=missLimit(); if(!lim) return null;
    let m=0; for(const [at,ok] of room.ghost.log){ if(!ok&&++m>=lim) return at; }
    return null;
  }
  // 記録どおりのタイミングで前進・後退させる（端末内だけ）
  function startGhostTick(){
    const r=room; clearInterval(r.ghostTick);
    if(!r.ghost) return;
    const out=ghostOutAt();
    const step=()=>{
      if(room!==r||r.view!=='play'){ clearInterval(r.ghostTick); return; }
      if(r.goal[GHOST]!=null) return;
      const t=Date.now()-r.localStart;
      if(out!=null&&t>=out){ r.goal[GHOST]=-2; toast('👻 ゴーストがミスの上限に達しました'); renderLanes(); return; }
      const p=ghostPos(t);
      if(p!==r.pos[GHOST]){ r.pos[GHOST]=p; renderLanes(); }
      if(t>=r.ghost.ms){ r.goal[GHOST]=r.ghost.ms; toast('👻 ゴーストがゴール！'); renderLanes(); }
    };
    r.ghostTick=setInterval(step,200); step();
  }
  // 結果画面ではゴーストの結果を最初から出す（決まっているので）。
  // ミスの上限に達していれば -2、自分のゴールから強制終了までにゴールできなければ -3
  function revealGhost(){
    const r=room; if(!r||!r.ghost) return;
    const out=ghostOutAt(), mine=r.goal[r.me.pid], ea=endAfterMs();
    if(out!=null&&out<r.ghost.ms){ r.goal[GHOST]=-2; r.pos[GHOST]=ghostPos(out); }
    else if(ea&&mine>=0&&r.ghost.ms>mine+ea){ r.goal[GHOST]=-3; r.pos[GHOST]=ghostPos(mine+ea); }
    else{ r.goal[GHOST]=r.ghost.ms; r.pos[GHOST]=GOAL; }
  }
  function vsGhost(){ return !!(room&&room.ghost); }

  /* ---------- プレイ記録（ゴースト用） ---------- */
  function saveRecord(ms){
    const r=room, uid=r.me.uid, log=encLog(r.log), genre=r.meta.genre, d=getDb();
    d.ref('rbRecs/'+uid).push({ms,log,genre,n:racers().length,at:TS()}).catch(e=>console.warn('[RB] rec',e));
    const best=d.ref('rbBestF/'+fieldKeyOf(genre)+'/'+uid);  // ベストは分野ごと
    best.child('ms').once('value').then(s=>{
      const b=s.val(); if(b!=null&&b<=ms) return;
      return Promise.all([
        best.set({ms,log,name:r.me.name,genre,at:TS()}),
        r.myAv?d.ref('rbGhostAv/'+uid).set(r.myAv):null
      ]).then(()=>{ r.newBest=true; if(room===r&&r.view==='result') render(); });
    }).catch(e=>console.warn('[RB] best',e));
  }

  /* ---------- 試合 ---------- */
  function beginCountdown(){
    const r=room, meta=r.meta;
    const sess=loadSess()||{};
    const resume=sess.code===r.code&&sess.round===meta.round&&sess.localStart;
    // 開始の知らせが遅れて届いた人は、届いた時点からスタート（タイムは各自の端末で計る）
    r.localStart=resume?sess.localStart:Math.max(meta.startAt-offset,Date.now());
    saveSess(Object.assign(sess,{round:meta.round,localStart:r.localStart}));
    r.view='countdown';
    clearInterval(r.countdown);
    const step=()=>{
      if(room!==r||r.view!=='countdown'){ clearInterval(r.countdown); return; }
      const left=r.localStart-Date.now();
      if(left<=0){ clearInterval(r.countdown); startRun(resume?sess:null); return; }
      const el=document.getElementById('rbCount');
      if(el) el.textContent=Math.ceil(left/1000);
    };
    render();
    r.countdown=setInterval(step,100); step();
  }
  function startRun(resume){
    const r=room, meta=r.meta;
    const pool=(meta.qs||[]).map(Q).filter(Boolean);
    if(!pool.length){ toast('問題データを読み込めませんでした。ページを読み込み直してね'); return; }
    r.view='play';
    const myPos=resume&&resume.pos|0;
    r.pos[r.me.pid]=myPos;
    r.log=resume?decLog(resume.log):[];
    startChoiceRun({pool,genre:meta.genre,pos:myPos,idx:resume&&resume.idx|0});
    if(!resume){
      r.ref.child('pos_'+r.round+'/'+r.me.pid).set(0);
      if(meta.log) logRef(r,r.round).child('p/'+r.me.pid).update({uid:r.me.uid,name:r.me.name}).catch(e=>console.warn('[RB] log',e));
    }
    startGhostTick();
    startEndTick();
    renderLanes();
  }
  function clearTimers(){
    if(!st) return;
    clearInterval(st.timerInterval); st.timerInterval=null;
    clearTimeout(st.autoAdvanceTimeout); st.autoAdvanceTimeout=null;
  }
  function destroyRun(){
    if(!st) return;
    lastRun={history:st.history};
    clearTimers();
    if(st.ro) st.ro.disconnect();
    st=null;
  }
  // choiceAnswer から呼ばれる。位置を動かして送信し、次の問題かゴールへ
  function onAnswer(correct){
    const r=room;
    if(!r||!st) return;
    st.pos=Math.max(0,st.pos+(correct?1:-1));
    const p=st.pos;
    r.pos[r.me.pid]=p;
    r.log.push([Date.now()-r.localStart,correct]);
    const h=st.history[st.history.length-1];
    logAnswer(h&&h.qid,correct,r.log[r.log.length-1][0]);
    r.ref.child('pos_'+r.round+'/'+r.me.pid).set(p);
    const sess=loadSess(); if(sess) saveSess(Object.assign(sess,{pos:p,idx:st.idx+1,log:encLog(r.log)}));
    choiceHUD();
    renderLanes();
    if(p>=GOAL){
      const ms=Date.now()-r.localStart;
      r.goalSent=true; r.goal[r.me.pid]=ms; r.myGoalSaved=false;
      r.ref.child('goal_'+r.round+'/'+r.me.pid).set(ms).then(()=>{ r.myGoalSaved=true; if(room===r) render(); });
      saveRecord(ms);
      logEnd(ms);
      setTimeout(()=>{ if(room!==r) return; destroyRun(); r.view='result'; render(); },900);
    }else if(!correct&&missLimit()&&missCount()>=missLimit()){
      endOut(-2,'❌ ミスが上限（'+missLimit()+'回）に達しました');
    }else{
      st.autoAdvanceTimeout=setTimeout(choiceGoNext,correct?1200:2200);  // まちがえたときは解説を読む時間を長めに
    }
  }
  /* ---------- ミスの上限・1位のゴール後の強制終了（2026-10-30 先生） ----------
     ルームを作った人が待機画面で変える（meta.maxMiss 回・meta.endAfter 秒、0 は「なし」）。
     終わり方の goal の値：-1 棄権 / -2 ミスの上限 / -3 1位のゴールから時間切れ */
  const MISS_OPTS=[3,5,10,15,20,0], END_OPTS=[30,60,120,180,300,0];
  const DEF_MISS=10, DEF_END=60;
  function missLimit(){ const v=room&&room.meta&&room.meta.maxMiss; return v==null?DEF_MISS:+v; }
  function endAfterMs(){ const v=room&&room.meta&&room.meta.endAfter; return (v==null?DEF_END:+v)*1000; }
  const missCount=()=>room.log.filter(e=>!e[1]).length;
  const fmtSec=s=>!s?'なし':s<60?s+'秒':(s/60)+'分';
  // 自分の試合をゴール以外で終える（ミスの上限・時間切れ）
  function endOut(code,msg){
    const r=room; if(!r||r.goalSent) return;
    r.goalSent=true; r.goal[r.me.pid]=code;
    clearTimers();
    r.ref.child('goal_'+r.round+'/'+r.me.pid).set(code).catch(()=>{});
    logEnd(code);
    toast(msg);
    renderLanes();
    setTimeout(()=>{ if(room!==r) return; destroyRun(); r.view='result'; render(); },900);
  }
  // 1位（ゴーストを含む）のゴールから endAfter たったら、まだの人は終了。各自の端末で判定する
  function forceLeft(){
    const r=room, ea=endAfterMs(); if(!r||!ea) return null;
    const g=Object.values(r.goal).filter(v=>v>=0); if(!g.length) return null;
    return r.localStart+Math.min(...g)+ea-Date.now();
  }
  function startEndTick(){
    const r=room; clearInterval(r.endTick);
    r.endTick=setInterval(()=>{
      if(room!==r||r.view!=='play'||r.goalSent){ clearInterval(r.endTick); return; }
      const left=forceLeft(); if(left==null) return;
      if(left<=0){ endOut(-3,'⏰ 時間切れ（1位のゴールから'+fmtSec(endAfterMs()/1000)+'）'); return; }
      if(st) choiceHUD();
    },500);
  }
  function hudText(){
    const lim=missLimit(), left=forceLeft();
    return `🏁 ${st.pos}/${GOAL}`+(lim?`　❌ ${missCount()}/${lim}`:'')+(left!=null&&left>0?`　⏱ 残り${Math.ceil(left/1000)}秒`:'');
  }

  /* ---------- 試合の画面（どの分野も同じ） ----------
     背景の写真の上に半透明の枠。横長の画面は問題文が左・選択肢が右、縦長は上から問題文・選択肢。
     その外側の枠が時間のバー（12時から時計回りに減る）、さらに上にレーン。化学基礎は ○／× の2択 */
  const CHOICE_MS=15000, MULTI_MS=20000, OX_MS=10000;  // 1問の制限時間（「すべて選べ」は長め、○×は化学RUSH！と同じ10秒）
  function startChoiceRun(o){
    st={pos:o.pos||0, pool:o.pool, idx:o.idx||0, genre:o.genre,
      history:[], answered:false, timerInterval:null, autoAdvanceTimeout:null, ce:null, ro:null};
    panel.innerHTML=`<div class="rb-play">${laneHTML()}
      <div class="rb-frame" id="rbFrame">
        <svg class="rb-tsvg" aria-hidden="true"><path class="rb-tbg" id="rbTbg"/><path class="rb-tbar" id="rbTbar" pathLength="1000"/></svg>
        <span class="rb-hud" id="rbHud"></span>
        <div class="rb-inner" id="rbInner"><div class="rb-q" id="rbQ"></div><div class="rb-ch" id="rbCh"></div></div>
      </div></div>`;
    const $=id=>document.getElementById(id);
    st.ce={frame:$('rbFrame'), bar:$('rbTbar'), bg:$('rbTbg'), hud:$('rbHud'), inner:$('rbInner'), q:$('rbQ'), ch:$('rbCh')};
    if(window.ResizeObserver){ st.ro=new ResizeObserver(()=>framePath()); st.ro.observe(st.ce.frame); }
    framePath(); choiceHUD(); choiceShow();
  }
  // 時間のバーの通り道：枠の上の真ん中（12時）から時計回りに一周
  function framePath(){
    if(!st||!st.ce) return;
    const w=st.ce.frame.clientWidth, h=st.ce.frame.clientHeight, i=3, r=19;
    if(!w||!h) return;
    const d=`M${w/2},${i} H${w-i-r} A${r},${r} 0 0 1 ${w-i},${i+r} V${h-i-r} A${r},${r} 0 0 1 ${w-i-r},${h-i} H${i+r} A${r},${r} 0 0 1 ${i},${h-i-r} V${i+r} A${r},${r} 0 0 1 ${i+r},${i} Z`;
    st.ce.bar.setAttribute('d',d); st.ce.bg.setAttribute('d',d);
  }
  // 残り時間 = 今の位置から12時までの部分。使った分は12時から時計回りに消えていく
  function drawTime(left){
    const bar=st.ce.bar;
    bar.setAttribute('stroke-dasharray',`0 ${(1-left)*1000} ${left*1000} 1000`);
    bar.style.stroke= left>.5?'#06d6a0':left>.2?'#ffd166':'#ef476f';
  }
  function choiceHUD(){ if(st&&st.ce) st.ce.hud.textContent=hudText(); }
  function choiceGoNext(){ if(!st) return; clearTimers(); st.idx++; choiceShow(); }
  function choiceShow(){
    const el=st.ce;
    st.answered=false;
    if(st.idx>=st.pool.length) st.idx=0;
    const q=st.pool[st.idx];
    el.q.innerHTML=`<span class="rb-tag">${esc(q.genre)}</span>${q.pic}<div class="rb-qt">${q.q}</div>`
      +(q.multi?'<div class="rb-multi">☑ あてはまるものをすべて選んで「決定」</div>':'')
      +(q.ox?'<div class="rb-multi">正しければ ○、誤りなら ×</div>':'')
      +'<div class="rb-fb" id="rbFb"></div>';
    el.ch.className='rb-ch'+(q.ci?' imgs':'')+(q.ox?' ox':'');
    el.ch.innerHTML=q.choices.map((c,i)=>`<button class="rb-cbtn" data-i="${i}">${q.ox?'':`<b>${i+1}</b>`}<span>${c.html}</span></button>`).join('')
      +(q.multi?'<button class="rb-decide" disabled>決定</button>':'');
    el.inner.scrollTop=0; el.q.scrollTop=0; el.ch.scrollTop=0;
    const btns=[...el.ch.querySelectorAll('.rb-cbtn')], dec=el.ch.querySelector('.rb-decide');
    if(!q.multi) btns.forEach(b=>b.onclick=()=>choiceAnswer([+b.dataset.i]));
    else{
      btns.forEach(b=>b.onclick=()=>{ if(st.answered) return; b.classList.toggle('sel'); dec.disabled=!btns.some(x=>x.classList.contains('sel')); });
      dec.onclick=()=>{ const picked=btns.filter(x=>x.classList.contains('sel')).map(x=>+x.dataset.i); if(picked.length) choiceAnswer(picked); };
    }
    // 制限時間
    const limit=q.ox?OX_MS:q.multi?MULTI_MS:CHOICE_MS, t0=Date.now();
    drawTime(1);
    st.timerInterval=setInterval(()=>{
      const left=Math.max(0,1-(Date.now()-t0)/limit);
      drawTime(left);
      if(left<=0){ clearInterval(st.timerInterval); st.timerInterval=null; if(!st.answered) choiceAnswer(null); }
    },100);
  }
  // picked: 選んだ番号の配列（時間切れは null）。多答は正解を過不足なく選べたら正解
  function choiceAnswer(picked){
    if(!st||st.answered) return;
    clearTimers();
    st.answered=true;
    const q=st.pool[st.idx], el=st.ce;
    const ok=!!picked&&q.choices.every((c,i)=>c.ok===picked.includes(i));
    st.history.push({qid:q.id,genre:q.genre,statement:q.statement,explanation:q.explanation,correct:ok});
    el.ch.querySelectorAll('.rb-cbtn').forEach((b,i)=>{
      b.disabled=true; b.classList.remove('sel');
      if(q.choices[i].ok) b.classList.add('ok');
      else if(picked&&picked.includes(i)) b.classList.add('ng');
    });
    const dec=el.ch.querySelector('.rb-decide'); if(dec) dec.remove();
    const fb=document.getElementById('rbFb');
    fb.className='rb-fb '+(ok?'correct':'wrong');
    // タイムを競うので、正解のときは解説を出さない（2026-10-30 先生）
    fb.innerHTML=ok?'⭕ 正解！':(picked?'❌ 残念！ 緑が正解。 ':'⏰ 時間切れ！ 緑が正解。 ')+q.explanation;
    // 縦長の画面で解説が隠れるときは見えるところまで送る
    if(el.inner.scrollHeight>el.inner.clientHeight) fb.scrollIntoView({block:'nearest',behavior:'smooth'});
    drawTime(0);
    onAnswer(ok);
  }

  /* ---------- 順位 ---------- */
  function posOf(pid){ return pid===room.me.pid&&st ? st.pos : (room.pos[pid]|0); }
  function racers(){ const p=((room.meta&&room.meta.players)||[]).slice(); if(room.ghost) p.push(GHOST); return p; }
  function standings(){
    const r=room, order=sortedMembers();
    const players=racers();
    const g=pid=>r.goal[pid];
    const cls=pid=>{ const v=g(pid); return v>=0?0 : v<0?2 : isDropped(pid)?2 : 1; };
    return players.slice().sort((a,b)=>cls(a)-cls(b)
      || (cls(a)===0 ? g(a)-g(b) : 0)
      || posOf(b)-posOf(a)
      || order.indexOf(a)-order.indexOf(b));
  }
  function fmtMs(ms){ const s=ms/1000; const m=Math.floor(s/60); return (m?m+'分':'')+(s-m*60).toFixed(m?0:1)+'秒'; }

  /* ---------- レーン表示（問題画面の上の細い帯） ---------- */
  function laneCount(){ const n=room?racers().length:1; return Math.min(2,Math.max(1,n-1))*2+1; }
  const LANE_H=22;
  function laneHTML(){ return `<div class="rb-lanes" id="rbLanes" style="height:${laneCount()*LANE_H+8}px"></div>`; }
  function renderLanes(){
    const r=room; const box=document.getElementById('rbLanes');
    if(!r||!box) return;
    const L=laneCount(), k=(L-1)/2;
    if(!r.laneSlots||r.laneSlots.box!==box){
      box.innerHTML='';
      const slots=[];
      for(let i=0;i<L;i++){
        const lane=document.createElement('div');
        lane.className='rb-lane'+(i===k?' me':'');
        lane.innerHTML=`<span class="rb-rank"></span><div class="rb-road"><span class="rb-flag">🏁</span><span class="rb-runner"></span></div>`;
        box.appendChild(lane);
        slots.push({lane,rank:lane.querySelector('.rb-rank'),runner:lane.querySelector('.rb-runner'),pid:null});
      }
      const net=document.createElement('span'); net.className='rb-net'; box.appendChild(net);
      r.laneSlots={box,slots,net};
    }
    const S=standings(), mi=S.indexOf(r.me.pid);
    r.laneSlots.net.textContent=online?'':'📶 再接続中…';
    r.laneSlots.slots.forEach((slot,i)=>{
      const idx=mi+(i-k), pid=(idx>=0&&idx<S.length)?S[idx]:null;
      slot.lane.classList.toggle('empty',!pid);
      if(slot.pid!==pid){
        slot.pid=pid;
        slot.runner.innerHTML='';
        slot.runner.style.transition='none';
        if(pid){ slot.runner.appendChild(img(pid)); }
      }else slot.runner.style.transition='';
      if(!pid){ slot.rank.textContent=''; return; }
      const p=Math.min(GOAL,posOf(pid)), gv=r.goal[pid];
      slot.rank.textContent=(idx+1)+'位';
      slot.runner.style.left=`calc((100% - ${LANE_H-2}px) * ${p/GOAL})`;
      slot.runner.classList.toggle('off',pid!==r.me.pid&&!isOnline(pid));
      slot.runner.classList.toggle('out',gv<0||(!(gv>=0)&&isDropped(pid)));
      slot.runner.classList.toggle('done',gv>=0);
      slot.lane.title=nameOf(pid);
      if(slot.runner.style.transition==='none') void slot.runner.offsetWidth;
    });
  }
  function onConnChange(){ if(room) renderLanes(); }

  /* ---------- 画面 ---------- */
  function render(){
    const r=room; if(!r) return;
    if(r.view==='play'){ renderLanes(); return; }
    if(r.view==='review') return;
    if(r.view==='countdown'){
      if(!document.getElementById('rbCount')) panel.innerHTML=`<div class="rb-countwrap"><div class="muted">${vsGhost()?esc(r.names[GHOST])+' と対戦（記録 '+fmtMs(r.ghost.ms)+'）':'ルーム '+r.code+'　全員同じ問題・同じ順番です'}</div><div class="rb-count" id="rbCount"></div><div class="muted">10問先取！ 正解で前進、まちがえると後退<br>ミスの上限 ${missLimit()?missLimit()+'回':'なし'}・1位のゴールから${fmtSec(endAfterMs()/1000)}で終了</div></div>`;
      return;
    }
    if(r.view==='result') return renderResult();
    renderLobby();
  }
  function renderLobby(){
    const r=room, meta=r.meta; if(!meta) return;
    const mems=sortedMembers(), host=effectiveHost();
    const amHost=host===r.me.pid;
    const playing=meta.status==='play';
    const myRole=roleOf(r.me.pid);
    const aliveN=mems.filter(pid=>isOnline(pid)&&roleOf(pid)==='player').length;
    const specN=mems.filter(pid=>roleOf(pid)==='spectator').length;
    panel.innerHTML=`
      <button class="backbtn" id="rbLeave">← ルームを出る</button>
      <h2>⚔️ 対戦ルーム${meta.visibility==='public'?'　<span class="rb-pub">🌐 公開</span>':''}</h2>
      <div class="card-ui rb-codecard">
        <div class="muted">ルームコード</div>
        <div class="rb-code">${esc(r.code)}</div>
        <div class="muted">${meta.visibility==='public'?'公開ルームなのでロビー一覧からも入れるよ。':'この4桁を友だちに伝えてね。'}（${MIN_PLAYERS}〜${MAX_PLAYERS}人・観戦者を含め最大${HARD_CAP}人・1人ならゴーストと対戦）</div>
        <div class="rb-scope">出題：${esc(scopeLabel(meta.genre))}</div>
      </div>
      <div class="card-ui rb-rules">${amHost&&!playing
        ? `<label>ミスの上限 <select id="rbMiss">${MISS_OPTS.map(v=>`<option value="${v}" ${v===missLimit()?'selected':''}>${v?v+'回':'なし'}</option>`).join('')}</select></label>
           <label>1位のゴールから <select id="rbEnd">${END_OPTS.map(v=>`<option value="${v}" ${v*1000===endAfterMs()?'selected':''}>${fmtSec(v)}</option>`).join('')}</select> で終了</label>`
        : `<div class="muted">ミスの上限：<b>${missLimit()?missLimit()+'回':'なし'}</b>　1位のゴールから <b>${fmtSec(endAfterMs()/1000)}</b> で終了</div>`}
      </div>
      <div class="card-ui">
        <b>参加者 ${mems.length}/${HARD_CAP}${specN?`（参加 ${mems.length-specN}・観戦 ${specN}）`:''}</b>
        <div class="rb-members" id="rbMembers"></div>
      </div>
      <div id="rbStartArea">${
        myRole==='spectator' ? `<div class="card-ui muted" style="text-align:center">👀 観戦中：対戦が終わるまでお待ちください。次の対戦から参加できます</div>`
        : playing ? `<div class="card-ui muted" style="text-align:center">いまは試合中です。終わるまで待ってね</div>`
        : amHost ? `<button class="bigbtn" id="rbStart" ${aliveN<MIN_PLAYERS?'disabled':''}>⚔️ スタート！</button>
                    <div class="muted" style="text-align:center">${aliveN<=1?'このまま始めると 👻 ゴーストと対戦します':'全員そろったらスタートを押してね'}</div>`
        : `<div class="card-ui muted" style="text-align:center">ルームを作った人がスタートするのを待っています…</div>`
      }</div>
      ${DEMO?`<div class="muted" style="margin-top:8px">デモモード：このタブは「${esc(r.me.name)}」として参加しています</div>`:''}`;
    const box=document.getElementById('rbMembers');
    mems.forEach(pid=>{
      const chip=document.createElement('div');
      chip.className='rb-member'+(isOnline(pid)?'':' off')+(pid===r.me.pid?' me':'');
      chip.appendChild(img(pid).cloneNode());
      const nm=document.createElement('span'); nm.className='rb-mname';
      nm.textContent=(pid===meta.host?'👑':'')+(roleOf(pid)==='spectator'?'👀':'')+nameOf(pid)+(isOnline(pid)?'':'（接続待ち）');
      chip.appendChild(nm); box.appendChild(chip);
    });
    document.getElementById('rbLeave').onclick=()=>{ leave(); openHome(); };
    const ms=document.getElementById('rbMiss'), es=document.getElementById('rbEnd');
    if(ms) ms.onchange=()=>r.ref.child('meta/maxMiss').set(+ms.value).catch(()=>toast('変更できませんでした'));
    if(es) es.onchange=()=>r.ref.child('meta/endAfter').set(+es.value).catch(()=>toast('変更できませんでした'));
    const sb=document.getElementById('rbStart');
    if(sb) sb.onclick=()=>{ sb.disabled=true; startMatch().catch(e=>{ sb.disabled=false; toast('開始できませんでした'); console.warn(e); }); };
  }
  function renderResult(){
    const r=room;
    revealGhost();
    const S=standings();
    const mine=r.goal[r.me.pid];
    const winner=S[0];
    const allDone=S.every(p=>r.goal[p]!=null||isDropped(p));
    const rows=S.map((pid,i)=>{
      const gv=r.goal[pid];
      const sts= gv>=0 ? `<b>${fmtMs(gv)}</b>` : gv===-1 ? '棄権' : gv===-2 ? `ミス上限（${posOf(pid)}/${GOAL}）` : gv===-3 ? `時間切れ（${posOf(pid)}/${GOAL}）`
        : isDropped(pid) ? '通信切れ' : `プレイ中 ${posOf(pid)}/${GOAL}`;
      const medal= gv>=0 ? ['🥇','🥈','🥉'][i]||(i+1)+'位' : '';
      return `<div class="rb-row${pid===r.me.pid?' me':''}" data-pid="${esc(pid)}"><span class="rb-rmedal">${medal}</span><span class="rb-ravatar"></span><span class="rb-rname">${esc(nameOf(pid))}</span><span class="rb-rstat">${sts}</span></div>`;
    }).join('');
    const head = mine===-2 ? '❌ ミスが上限に達しました' : mine===-3 ? '⏰ 時間切れ' : !(mine>=0) ? '結果'
      : vsGhost() ? (!(r.goal[GHOST]>=0)||mine<r.goal[GHOST] ? '🏆 ゴーストに勝った！' : '👻 ゴーストの勝ち…')
      : winner===r.me.pid&&r.goal[winner]>=0 ? '🏆 優勝！' : `ゴール！ ${S.indexOf(r.me.pid)+1}位`;
    const amHost=effectiveHost()===r.me.pid;
    panel.innerHTML=`
      <h2>${head}</h2>
      <div class="card-ui" style="text-align:center">
        ${mine>=0?`<div class="score-line">${fmtMs(mine)}</div>`:''}
        ${r.newBest?`<div class="rb-best">✨ 自己ベスト更新！（次からゴーストになります）</div>`:''}
        ${mine>=0&&!r.myGoalSaved&&r.myGoalSaved!==undefined?`<div class="muted">記録を送信中…（つながると自動で送られます）</div>`:''}
        ${vsGhost()?'':`<div class="muted">${allDone?'全員の結果が出ました':'ほかの人がゴールすると順位が更新されます'}</div>`}
      </div>
      <div class="card-ui"><b>順位（ルーム ${esc(r.code)}）</b><div class="rb-results">${rows}</div></div>
      ${amHost?`<button class="bigbtn" id="rbAgain">🔁 同じルームでもう一度</button>`:`<div class="muted" style="text-align:center;margin-bottom:8px">ルームを作った人が「もう一度」を押すと待機画面に戻ります</div>`}
      <button class="bigbtn secondary" id="rbReview">📋 今回の問題を振り返る</button>
      <button class="bigbtn secondary" id="rbExit">ルームを出る</button>`;
    panel.querySelectorAll('.rb-row').forEach(row=>row.querySelector('.rb-ravatar').appendChild(img(row.dataset.pid).cloneNode()));
    const a=document.getElementById('rbAgain'); if(a) a.onclick=rematch;
    document.getElementById('rbReview').onclick=()=>{
      r.view='review';  // 振り返り中は順位画面の定期更新で上書きしない
      renderReview(()=>{ if(room===r&&r.view==='review') r.view='result'; render(); });
    };
    document.getElementById('rbExit').onclick=()=>{ leave(); openHome(); };
  }
  // 今回の振り返り（まちがえた問題を先に）。back は「戻る」で順位画面へ
  function renderReview(back){
    const history=(lastRun&&lastRun.history)||[];
    const list=history.length
      ? history.filter(h=>!h.correct).concat(history.filter(h=>h.correct)).map(h=>`
        <div class="rn-review-item ${h.correct?'':'is-wrong'}">
          <div class="rv-head"><span>${esc(h.genre)}</span><span class="rv-mark ${h.correct?'correct':'wrong'}">${h.correct?'○ 正解':'× 不正解'}</span></div>
          <div class="rv-statement">${h.statement}</div>
          <div class="rv-explanation">${h.explanation}</div>
        </div>`).join('')
      : '<div class="muted" style="text-align:center;padding:20px 0">振り返る問題がありません。</div>';
    panel.innerHTML=`
      <h2>📋 今回の振り返り</h2>
      <div>${list}</div>
      <button class="bigbtn secondary" id="rbReviewBack">戻る</button>`;
    document.getElementById('rbReviewBack').onclick=back;
    panel.parentElement.scrollTop=0;
  }

  /* ---------- 入口（ルームを作る／入る） ---------- */
  // fkey: ほかのクエストから来たときの分野（'aro' など）。なければ前回選んだ分野
  // 公開ルーム一覧を1回だけ取得（常時監視はしない。「更新」を押したときだけ読み直す）
  async function fetchLobby(questKey){
    const m=me(), sess=loadSess();
    const snap=await getDb().ref(LOBBY+'/'+questKey).orderByChild('created').limitToLast(LOBBY_LIST_MAX).once('value');
    const rows=[];
    snap.forEach(s=>{ const v=s.val(); if(v) rows.push(Object.assign({code:s.key},v)); });
    rows.reverse();  // 新しい順
    // 自分が作った部屋・自分が今いる部屋（前のルーム）は出さない。一覧は古い前提で、正確な判定は入室時に行う
    return rows.filter(v=>v.host!==m.pid&&!(sess&&sess.code===v.code));
  }
  let homeTab='create';
  function openHome(fkey){
    if(room){ render(); return; }  // ルームに入っている（試合中も含む）ならその画面のまま
    const sess=loadSess();
    const m=me();
    const pref=loadFieldPref();
    let field=(typeof fkey==='string'&&fieldList().some(f=>f.key===fkey)&&fkey)||pref.field||BASICS.key;
    let visibility='private';
    let err,run;  // draw() のたびに作り直す。loadLobby() からも使うので openHome のスコープに置く
    const fieldBtns=()=>fieldList().map(f=>`<button class="rb-field${f.key===field?' on':''}" data-f="${esc(f.key)}">${esc(f.label)}</button>`).join('');
    const draw=()=>{
    panel.innerHTML=`
      <h2>⚔️ オンライン対戦</h2>
      <div class="card-ui"><div class="muted"><b>10問先取</b>のスピード勝負。正解で1マス前進、まちがい・時間切れで1マス後退。${MIN_PLAYERS}〜${MAX_PLAYERS}人で遊べるよ（観戦者を含め最大${HARD_CAP}人）。1人で始めると、みんなのプレイ記録から作った 👻 ゴーストと対戦！<br>化学基礎は○×問題、芳香族・脂肪族・無機・高分子は各クエストと同じ選択式です。</div></div>
      ${sess&&sess.code?`<div class="card-ui"><b>前のルーム ${esc(sess.code)}</b><button class="bigbtn" id="rbResume">ルーム ${esc(sess.code)} に戻る</button></div>`:''}
      <div class="card-ui rb-hometabs">
        <button class="rb-tab${homeTab==='create'?' on':''}" data-tab="create">作る／コードで入る</button>
        <button class="rb-tab${homeTab==='public'?' on':''}" data-tab="public">🌐 公開ルームを探す</button>
      </div>
      ${homeTab==='create'?`
      <div class="card-ui">
        <b>① 分野を選ぶ</b>
        <div class="rb-fields" id="rbFields">${fieldBtns()}</div>
        <b>② 範囲を選んでルームを作る</b>
        <select class="genreSelect" id="rbGenre" style="margin-top:8px"></select>
        <div class="rb-vis" id="rbVis">
          <button class="rb-visbtn${visibility==='public'?' on':''}" data-v="public">🌐 公開（コード不要・一覧に出る）</button>
          <button class="rb-visbtn${visibility==='private'?' on':''}" data-v="private">🔒 非公開（コードを知っている人だけ）</button>
        </div>
        <button class="bigbtn" id="rbCreate" style="margin-top:10px">ルームを作る</button>
      </div>
      <div class="card-ui">
        <b>コードでルームに入る</b>
        <div class="muted">分野と範囲はルームを作った人が決めます</div>
        <input class="rb-codein" id="rbCode" type="tel" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="4桁のコード">
        <button class="bigbtn" id="rbJoin">参加する</button>
      </div>`:`
      <div class="card-ui">
        <b>分野を選ぶ</b>
        <div class="rb-fields" id="rbFields">${fieldBtns()}</div>
        <div class="rb-lobbyhead"><b>公開ルーム一覧</b><button class="bigbtn secondary" id="rbLobbyRefresh">🔄 更新</button></div>
        <div class="rb-lobbylist" id="rbLobbyList"><div class="muted">読み込み中…</div></div>
      </div>`}
      <div class="rb-err" id="rbErr"></div>
      ${DEMO&&m?`<div class="muted">デモモード：このタブは「${esc(m.name)}」として参加します（タブごとに別の参加者になります。多重入室の追い出しは働きません）</div>`:''}`;
    err=document.getElementById('rbErr');
    const busy=(on)=>panel.querySelectorAll('.bigbtn').forEach(b=>b.disabled=on);
    run=(p)=>{ err.textContent=''; busy(true); p.catch(e=>{ busy(false); err.textContent=(e&&e.message)||'通信できませんでした'; console.warn('[RB]',e); }); };
    panel.querySelectorAll('.rb-tab').forEach(b=>b.onclick=()=>{ homeTab=b.dataset.tab; draw(); });
    const bindFields=()=>panel.querySelectorAll('.rb-field').forEach(b=>b.onclick=()=>{
      field=b.dataset.f; err.textContent='';
      if(homeTab==='create') drawScopes(); else loadLobby();
    });
    if(homeTab==='public'){
      bindFields();
      const refreshBtn=document.getElementById('rbLobbyRefresh');
      refreshBtn.onclick=loadLobby;
      loadLobby();
      return;
    }
    const sel=document.getElementById('rbGenre'), createBtn=document.getElementById('rbCreate');
    // 分野を選ぶと範囲の一覧を入れ替える（前回その分野で選んだ範囲を最初に選ぶ）
    const drawScopes=()=>{
      panel.querySelectorAll('.rb-field').forEach(b=>b.classList.toggle('on',b.dataset.f===field));
      const opts=scopeOptions(field);
      const want=pref.field===field&&pref.genre ? pref.genre : null;
      sel.innerHTML=opts.length ? opts.map(o=>`<option value="${esc(o.value)}" ${o.value===want?'selected':''}>${esc(o.label)}</option>`).join('')
        : '<option value="">問題データを読み込み中…</option>';
      sel.disabled=createBtn.disabled=!opts.length;
    };
    bindFields(); drawScopes();
    loadAll().then(res=>{
      // 読み終わったら範囲の一覧だけ入れ替える（その間に別の画面へ移っていたら何もしない）
      if(room||document.getElementById('rbGenre')!==sel) return;
      drawScopes();
      const bad=res.find(x=>x.status==='rejected');
      if(bad) err.textContent=bad.reason.message;
    });
    document.getElementById('rbVis').querySelectorAll('.rb-visbtn').forEach(b=>b.onclick=()=>{
      visibility=b.dataset.v;
      panel.querySelectorAll('.rb-visbtn').forEach(x=>x.classList.toggle('on',x.dataset.v===visibility));
    });
    createBtn.onclick=()=>{
      if(!sel.value) return;
      saveFieldPref({field,genre:sel.value});
      run(createRoom(sel.value,visibility));
    };
    const code=document.getElementById('rbCode');
    code.oninput=()=>{ code.value=code.value.replace(/\D/g,'').slice(0,4); };
    code.onkeydown=e=>{ if(e.key==='Enter') document.getElementById('rbJoin').click(); };
    document.getElementById('rbJoin').onclick=()=>run(joinRoom(code.value));
    const rs=document.getElementById('rbResume');
    if(rs) rs.onclick=()=>run(joinRoom(sess.code).catch(e=>{ saveSess(null); throw e; }));
    };
    function loadLobby(){
      const box=document.getElementById('rbLobbyList'); if(!box) return;
      panel.querySelectorAll('.rb-field').forEach(b=>b.classList.toggle('on',b.dataset.f===field));
      box.innerHTML='<div class="muted">読み込み中…</div>';
      fetchLobby(field).then(rows=>{
        if(document.getElementById('rbLobbyList')!==box) return;
        if(!rows.length){ box.innerHTML='<div class="muted">公開ルームはまだ無いみたい。「作る」からあなたが最初の公開ルームを作れるよ</div>'; return; }
        box.innerHTML=rows.map(v=>`
          <button class="rb-lobbyrow" data-code="${esc(v.code)}">
            <span class="rb-lobbyhost">${esc(v.hostName||'?')}</span>
            <span class="rb-lobbyscope">${esc(scopeLabel(v.genre))}</span>
            <span class="rb-lobbystat">${v.status==='play'?'🏃 対戦中':(v.playerCount>=MAX_PLAYERS?'満室':'待機中')}　${v.playerCount}人</span>
          </button>`).join('');
        box.querySelectorAll('.rb-lobbyrow').forEach(b=>b.onclick=()=>run(joinRoom(b.dataset.code)));
      }).catch(e=>{ box.innerHTML='<div class="muted">読み込めませんでした。通信を確認してね</div>'; console.warn('[RB] lobby',e); });
    }
    draw();
  }

  // 管理画面の「乱入」リンクから。失敗したら対戦の入口画面にエラーを出す
  function intrudeFromLink(code){
    openHome();
    intrude(code).catch(e=>{
      console.warn('[RB] intrude',e);
      if(room) return;
      const el=document.getElementById('rbErr'); if(el) el.textContent=(e&&e.message)||'通信できませんでした';
    });
  }

  // ログインの確認を待つあいだに問題データを読み始める
  function preload(){ loadAll(); }

  return {openHome, intrudeFromLink, preload, active, playing, quit};
})();
