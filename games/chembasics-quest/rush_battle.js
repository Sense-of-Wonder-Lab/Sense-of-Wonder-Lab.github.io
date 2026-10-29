/* ================= 化学RUSH！ みんなで対戦（ルーム制・リアルタイム） 2026-10-29 =================
   化学RUSH！の問題・判定・画面をそのまま使い、上に細いレーン表示を足した対戦モード。
   - 4桁のルームコードで2〜10人。作成者が開始ボタンを押す
   - 10問先取。正解+1・不正解/時間切れ−1（0未満にしない）
   - 問題は開始時に全員分まとめて配布（全員同じ順番）
   - 試合中に送るのは自分の現在位置（数字）とゴールタイム（各自の端末で計測）だけ
   - 切断してもすぐ負けにせず、DROP_MS のあいだ再接続を待つ
   - ?demo=1 を付けると、同じアカウントでもタブごとに別の参加者として入れる（動作確認用）

   Firebase Realtime Database のルールに次を追加すること（ルート "rules" の中）:
   "mpRooms": {
     "$code": {
       ".read": "auth != null",
       ".write": "auth != null && (!data.exists() || !data.child('meta/created').exists() || data.child('meta/created').val() < now - 10800000)",
       "meta": { ".write": "auth != null && data.exists()" },
       "$sub": { "$pid": { ".write": "auth != null && $pid.beginsWith(auth.uid)" } }
     }
   }

   データ構成 mpRooms/{code}:
     meta    {host, status:'wait'|'play', genre, created, round, startAt, qs:[問題ID], players:[pid]}
     members/{pid} {name, joined}   av/{pid} 小さいアイコン(dataURL)   conn/{pid} true か 切断時刻
     pos_{round}/{pid} 現在位置    goal_{round}/{pid} ゴールまでのミリ秒（棄権は -1）
*/
const RB=(function(){
  const ROOT='mpRooms', GOAL=10, MAX_PLAYERS=10, MIN_PLAYERS=2;
  const DROP_MS=60000;          // これより長く切断していたら「通信切れ」扱い（表示のみ）
  const ROOM_TTL=3*3600*1000;   // 古いルームのコードは再利用してよい
  const QUESTION_COUNT=120;     // 配布する問題数（足りなければ同じ順番でもう一周）
  const AV_SIZE=48;
  const SESS_KEY='rbSession_v1';
  const DEMO=/[?&]demo=1\b/.test(location.search);
  const TS=()=>firebase.database.ServerValue.TIMESTAMP;
  const esc=t=>String(t==null?'':t).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let qmap=null;
  const Q=id=>{ if(!qmap) qmap=new Map(RUNNER_QUESTIONS.map(q=>[q.id,q])); return qmap.get(id); };

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
    if(!DEMO) return {pid:u.uid, name:u.nickname||'ゲスト', avatar:u.avatar||null};
    let tag=null;
    try{ tag=sessionStorage.getItem('rbDemoTag'); }catch(e){}
    if(!tag){
      tag=String.fromCharCode(65+Math.floor(Math.random()*26))+String.fromCharCode(65+Math.floor(Math.random()*26));
      try{ sessionStorage.setItem('rbDemoTag',tag); }catch(e){}
    }
    return {pid:u.uid+'-'+tag, name:(u.nickname||'ゲスト').slice(0,8)+'('+tag+')', avatar:null};
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
  function newRoom(code){
    return {code, ref:getDb().ref(ROOT+'/'+code), me:me(), meta:null, members:{}, names:{}, imgs:{}, conn:{},
      pos:{}, goal:{}, round:0, offs:[], roundOffs:[], view:'lobby', laneSlots:null, tick:null,
      goalSent:false, localStart:0, countdown:null, toasted:{}};
  }
  function listen(ref,ev,cb,list){ ref.on(ev,cb); (list||room.offs).push(()=>ref.off(ev,cb)); }
  function active(){ return !!room; }

  function img(pid){
    // 試合中はこの img を動かすだけで、読み込み直さない
    if(!room.imgs[pid]){ const i=new Image(); i.className='rb-av'; i.alt=''; i.draggable=false; room.imgs[pid]=i; }
    return room.imgs[pid];
  }
  function nameOf(pid){ const m=room.members[pid]; return m?m.name:(room.names[pid]||'?'); }  // 退室した人も名前は残す
  function isOnline(pid){ return pid===room.me.pid ? online : room.conn[pid]===true; }
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
  async function createRoom(genre){
    const m=me();
    for(let i=0;i<10;i++){
      const code=String(1000+Math.floor(Math.random()*9000));
      try{
        await getDb().ref(ROOT+'/'+code).set({meta:{host:m.pid,status:'wait',genre,created:TS(),round:0}});
        return enterRoom(code);
      }catch(e){
        if(!/permission/i.test(String(e&&(e.code||e.message)))) throw e;
      }
    }
    throw new Error('ルームを作れませんでした。時間をおいてもう一度試してね。（管理者の方へ：Firebase のルールに mpRooms が入っているか確認してください）');
  }
  async function joinRoom(code){
    if(!/^\d{4}$/.test(code)) throw new Error('4桁の数字を入れてね');
    const m=me();
    const snap=await getDb().ref(ROOT+'/'+code+'/meta').once('value');
    const meta=snap.val();
    if(!meta||!meta.created||serverNow()-meta.created>ROOM_TTL) throw new Error('そのコードのルームは見つかりませんでした');
    const memSnap=await getDb().ref(ROOT+'/'+code+'/members').once('value');
    const mem=memSnap.val()||{};
    if(!mem[m.pid]){
      if(meta.status!=='wait') throw new Error('このルームは試合中です。終わってから入ってね');
      if(Object.keys(mem).length>=MAX_PLAYERS) throw new Error('このルームは満員です（最大'+MAX_PLAYERS+'人）');
    }
    return enterRoom(code);
  }
  async function enterRoom(code){
    if(room) detach();
    room=newRoom(code);
    const r=room, m=r.me;
    const sess=loadSess();
    // 同じルームに入り直すとき（再読み込みなど）は、試合の途中経過を残す
    const same=sess&&sess.code===code&&sess.pid===m.pid;
    const av=await smallAvatar(m.avatar,m.name,m.pid);
    if(room!==r) return;
    const joined=(same&&sess.joined)||Date.now();
    saveSess(same?sess:{code,pid:m.pid,joined});
    await r.ref.update({['members/'+m.pid]:{name:m.name,joined},['av/'+m.pid]:av});
    // 切断を検知したら時刻を書く。つながり直したら true に戻す
    const connRef=r.ref.child('conn/'+m.pid);
    listen(getDb().ref('.info/connected'),'value',s=>{
      if(s.val()!==true) return;
      connRef.onDisconnect().set(TS());
      connRef.set(true);
    });
    listen(r.ref.child('members'),'value',s=>{ r.members=s.val()||{}; for(const k in r.members) r.names[k]=r.members[k].name; render(); });
    // アイコンは1人1回だけ受け取る（child_added）
    listen(r.ref.child('av'),'child_added',s=>{ img(s.key).src=s.val(); if(r.view==='lobby') render(); });
    listen(r.ref.child('conn'),'value',s=>{ r.conn=s.val()||{}; render(); });
    listen(r.ref.child('meta'),'value',s=>onMeta(s.val()));
    r.tick=setInterval(()=>{ if(r.view==='play'||r.view==='result') render(); },2000);
  }
  function detach(){
    if(!room) return;
    room.offs.forEach(f=>f()); room.roundOffs.forEach(f=>f());
    clearInterval(room.tick); clearInterval(room.countdown);
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
    r.ref.update(upd).catch(()=>{});
    detach();
    saveSess(null);
  }
  // 試合の途中でやめる（棄権）
  function quit(){
    if(room&&room.view==='play'&&!room.goalSent){
      room.goalSent=true;
      room.ref.child('goal_'+room.round+'/'+room.me.pid).set(-1).catch(()=>{});
    }
    if(typeof runnerState!=='undefined'&&runnerState&&runnerState.battle) destroyRun();
    leave();
  }

  /* ---------- meta の変化（開始・再戦） ---------- */
  function onMeta(meta){
    const r=room; if(!r) return;
    if(!meta){ toast('ルームがなくなりました'); detach(); saveSess(null); renderRunnerHome(); return; }
    r.meta=meta;
    if(meta.status==='play'&&(meta.players||[]).includes(r.me.pid)){
      if(r.round!==meta.round||r.view==='lobby'){
        if(r.round!==meta.round) setupRound(meta.round);
        const g=r.goal[r.me.pid];
        if(g!=null){ r.goalSent=true; r.view='result'; }
        else beginCountdown();
      }
    }else if(meta.status==='wait'&&r.view!=='lobby'){
      if(runnerState&&runnerState.battle) destroyRun();
      r.view='lobby';
    }
    render();
  }
  function setupRound(round){
    const r=room;
    r.roundOffs.forEach(f=>f()); r.roundOffs=[];
    r.round=round; r.pos={}; r.goal={}; r.goalSent=false; r.laneSlots=null; r.toasted={};
    const posRef=r.ref.child('pos_'+round), goalRef=r.ref.child('goal_'+round);
    // 相手の位置は表示だけに使う（勝敗には使わない）
    const onPos=s=>{ if(s.key!==r.me.pid){ r.pos[s.key]=s.val()|0; renderLanes(); } };
    listen(posRef,'child_added',onPos,r.roundOffs);
    listen(posRef,'child_changed',onPos,r.roundOffs);
    const onGoal=s=>{
      r.goal[s.key]=s.val();
      // 再読み込みで戻ってきたが、もうゴール済みだった
      if(s.key===r.me.pid&&r.view!=='result'){ r.goalSent=true; if(runnerState&&runnerState.battle) destroyRun(); r.view='result'; }
      if(s.key!==r.me.pid&&s.val()>=0&&r.view==='play'&&!r.toasted[s.key]){ r.toasted[s.key]=1; toast('🏁 '+nameOf(s.key)+' がゴール！'); }
      render();
    };
    listen(goalRef,'child_added',onGoal,r.roundOffs);
    listen(goalRef,'child_changed',onGoal,r.roundOffs);
  }
  async function startMatch(){
    const r=room; if(!r||!r.meta) return;
    const players=sortedMembers().filter(isOnline).slice(0,MAX_PLAYERS);
    if(players.length<MIN_PLAYERS){ toast('2人以上そろってから始めてね'); return; }
    const qs=buildRunnerPool(r.meta.genre).slice(0,QUESTION_COUNT).map(q=>q.id);
    await r.ref.child('meta').update({status:'play',round:(r.meta.round||0)+1,qs,players,startAt:serverNow()+4000});
  }
  function rematch(){ if(room) room.ref.child('meta').update({status:'wait'}); }

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
    r.view='play';
    const myPos=resume&&resume.pos|0;
    r.pos[r.me.pid]=myPos;
    startRunner('battle',{pool,genre:meta.genre,pos:myPos,idx:resume&&resume.idx|0});
    if(!resume) r.ref.child('pos_'+r.round+'/'+r.me.pid).set(0);
    renderLanes();
  }
  function destroyRun(){
    const st=runnerState; if(!st) return;
    lastRunnerRun={history:st.history,correct:st.correct,total:st.total,battle:true};
    try{ st.flaskEngine&&st.flaskEngine.app.destroy(true); }catch(e){}
    stopRunner();
  }
  // runnerAnswer から呼ばれる。位置を動かして送信し、次の問題かゴールへ
  function onAnswer(correct){
    const r=room, st=runnerState;
    if(!r||!st||!st.battle) return;
    st.battle.pos=Math.max(0,st.battle.pos+(correct?1:-1));
    const p=st.battle.pos;
    r.pos[r.me.pid]=p;
    r.ref.child('pos_'+r.round+'/'+r.me.pid).set(p);
    const sess=loadSess(); if(sess) saveSess(Object.assign(sess,{pos:p,idx:st.idx+1}));
    runnerRenderHUD(); renderLanes();
    if(p>=GOAL){
      const ms=Date.now()-r.localStart;
      r.goalSent=true; r.goal[r.me.pid]=ms; r.myGoalSaved=false;
      r.ref.child('goal_'+r.round+'/'+r.me.pid).set(ms).then(()=>{ r.myGoalSaved=true; if(room===r) render(); });
      setTimeout(()=>{ if(room!==r) return; destroyRun(); r.view='result'; render(); },900);
    }else{
      st.autoAdvanceTimeout=setTimeout(runnerGoNext,correct?1200:1600);
    }
  }
  function hudHTML(){ const st=runnerState; return `<span class="rb-hud">🏁 ${st.battle.pos}/${GOAL}</span>`; }

  /* ---------- 順位 ---------- */
  function posOf(pid){ return pid===room.me.pid&&runnerState&&runnerState.battle ? runnerState.battle.pos : (room.pos[pid]|0); }
  function standings(){
    const r=room, order=sortedMembers();
    const players=(r.meta&&r.meta.players)||[];
    const g=pid=>r.goal[pid];
    const cls=pid=>{ const v=g(pid); return v>=0?0 : v===-1?2 : isDropped(pid)?2 : 1; };
    return players.slice().sort((a,b)=>cls(a)-cls(b)
      || (cls(a)===0 ? g(a)-g(b) : 0)
      || posOf(b)-posOf(a)
      || order.indexOf(a)-order.indexOf(b));
  }
  function fmtMs(ms){ const s=ms/1000; const m=Math.floor(s/60); return (m?m+'分':'')+(s-m*60).toFixed(m?0:1)+'秒'; }

  /* ---------- レーン表示（問題画面の上の細い帯） ---------- */
  function laneCount(){ const n=((room&&room.meta&&room.meta.players)||[]).length; return Math.min(2,Math.max(1,n-1))*2+1; }
  const LANE_H=17;
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
      slot.runner.classList.toggle('out',gv===-1||(!(gv>=0)&&isDropped(pid)));
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
    if(r.view==='countdown'){
      if(!document.getElementById('rbCount')) runnerPanel.innerHTML=`<div class="rb-countwrap"><div class="muted">ルーム ${r.code}　全員同じ問題・同じ順番です</div><div class="rb-count" id="rbCount"></div><div class="muted">10問先取！ 正解で前進、まちがえると後退</div></div>`;
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
    const aliveN=mems.filter(isOnline).length;
    const scope=runnerScopeOf(meta.genre);
    runnerPanel.innerHTML=`
      <button class="backbtn" id="rbLeave">← ルームを出る</button>
      <h2>⚔️ 対戦ルーム</h2>
      <div class="card-ui rb-codecard">
        <div class="muted">ルームコード</div>
        <div class="rb-code">${esc(r.code)}</div>
        <div class="muted">この4桁を友だちに伝えてね（${MIN_PLAYERS}〜${MAX_PLAYERS}人）</div>
        <div class="rb-scope">出題：${esc(scope.label)}</div>
      </div>
      <div class="card-ui">
        <b>参加者 ${mems.length}/${MAX_PLAYERS}</b>
        <div class="rb-members" id="rbMembers"></div>
      </div>
      <div id="rbStartArea">${
        playing ? `<div class="card-ui muted" style="text-align:center">いまは試合中です。終わるまで待ってね</div>`
        : amHost ? `<button class="bigbtn" id="rbStart" ${aliveN<MIN_PLAYERS?'disabled':''}>⚔️ スタート！</button>
                    <div class="muted" style="text-align:center">${aliveN<MIN_PLAYERS?'あと'+(MIN_PLAYERS-aliveN)+'人そろうと始められます':'全員そろったらスタートを押してね'}</div>`
        : `<div class="card-ui muted" style="text-align:center">ルームを作った人がスタートするのを待っています…</div>`
      }</div>
      ${DEMO?`<div class="muted" style="margin-top:8px">デモモード：このタブは「${esc(r.me.name)}」として参加しています</div>`:''}`;
    const box=document.getElementById('rbMembers');
    mems.forEach(pid=>{
      const chip=document.createElement('div');
      chip.className='rb-member'+(isOnline(pid)?'':' off')+(pid===r.me.pid?' me':'');
      chip.appendChild(img(pid).cloneNode());
      const nm=document.createElement('span'); nm.className='rb-mname';
      nm.textContent=(pid===meta.host?'👑':'')+nameOf(pid)+(isOnline(pid)?'':'（接続待ち）');
      chip.appendChild(nm); box.appendChild(chip);
    });
    document.getElementById('rbLeave').onclick=()=>{ leave(); openHome(); };
    const sb=document.getElementById('rbStart');
    if(sb) sb.onclick=()=>{ sb.disabled=true; startMatch().catch(e=>{ sb.disabled=false; toast('開始できませんでした'); console.warn(e); }); };
  }
  function renderResult(){
    const r=room, meta=r.meta;
    const S=standings();
    const mine=r.goal[r.me.pid];
    const winner=S[0];
    const allDone=S.every(p=>r.goal[p]!=null||isDropped(p));
    const rows=S.map((pid,i)=>{
      const gv=r.goal[pid];
      const st= gv>=0 ? `<b>${fmtMs(gv)}</b>` : gv===-1 ? '棄権' : isDropped(pid) ? '通信切れ' : `プレイ中 ${posOf(pid)}/${GOAL}`;
      const medal= gv>=0 ? ['🥇','🥈','🥉'][i]||(i+1)+'位' : '';
      return `<div class="rb-row${pid===r.me.pid?' me':''}" data-pid="${esc(pid)}"><span class="rb-rmedal">${medal}</span><span class="rb-ravatar"></span><span class="rb-rname">${esc(nameOf(pid))}</span><span class="rb-rstat">${st}</span></div>`;
    }).join('');
    const head = mine>=0 ? (winner===r.me.pid&&r.goal[winner]>=0 ? '🏆 優勝！' : `ゴール！ ${S.indexOf(r.me.pid)+1}位`) : '結果';
    const amHost=effectiveHost()===r.me.pid;
    runnerPanel.innerHTML=`
      <h2>${head}</h2>
      <div class="card-ui" style="text-align:center">
        ${mine>=0?`<div class="score-line">${fmtMs(mine)}</div>`:''}
        ${mine>=0&&!r.myGoalSaved&&r.myGoalSaved!==undefined?`<div class="muted">記録を送信中…（つながると自動で送られます）</div>`:''}
        <div class="muted">${allDone?'全員の結果が出ました':'ほかの人がゴールすると順位が更新されます'}</div>
      </div>
      <div class="card-ui"><b>順位（ルーム ${esc(r.code)}）</b><div class="rb-results">${rows}</div></div>
      ${amHost?`<button class="bigbtn" id="rbAgain">🔁 同じルームでもう一度</button>`:`<div class="muted" style="text-align:center;margin-bottom:8px">ルームを作った人が「もう一度」を押すと待機画面に戻ります</div>`}
      <button class="bigbtn secondary" id="rbReview">📋 今回の問題を振り返る</button>
      <button class="bigbtn secondary" id="rbExit">ルームを出る</button>`;
    runnerPanel.querySelectorAll('.rb-row').forEach(row=>row.querySelector('.rb-ravatar').appendChild(img(row.dataset.pid).cloneNode()));
    const a=document.getElementById('rbAgain'); if(a) a.onclick=rematch;
    document.getElementById('rbReview').onclick=()=>{
      renderRunnerReview();
      // 振り返りの「戻る」は1人用の結果画面ではなく対戦の順位画面へ
      const b=document.getElementById('rnReviewBack'), nb=b.cloneNode(true);
      b.replaceWith(nb); nb.onclick=()=>render();
    };
    document.getElementById('rbExit').onclick=()=>{ leave(); openHome(); };
  }

  /* ---------- 入口（ルームを作る／入る） ---------- */
  function openHome(){
    if(room){ render(); return; }  // ルームに入っている（試合中も含む）ならその画面のまま
    stopRunner();
    const sess=loadSess();
    const m=me();
    const opts=RUNNER_SCOPES.map(s=>`<option value="${esc(s.value)}" ${selectedRunnerGenre===s.value?'selected':''}>${esc(s.label)}</option>`).join('');
    runnerPanel.innerHTML=`
      <button class="backbtn" id="rbBack">← 化学RUSH！に戻る</button>
      <h2>⚔️ みんなで対戦</h2>
      <div class="card-ui"><div class="muted">化学RUSH！の○×問題で<b>10問先取</b>のスピード勝負。正解で1マス前進、まちがい・時間切れで1マス後退。${MIN_PLAYERS}〜${MAX_PLAYERS}人で遊べるよ。</div></div>
      ${sess&&sess.code?`<div class="card-ui"><b>前のルーム ${esc(sess.code)}</b><button class="bigbtn" id="rbResume">ルーム ${esc(sess.code)} に戻る</button></div>`:''}
      <div class="card-ui">
        <b>ルームを作る</b>
        <select class="genreSelect" id="rbGenre" style="margin-top:8px">${opts}</select>
        <button class="bigbtn" id="rbCreate" style="margin-top:10px">ルームを作る</button>
      </div>
      <div class="card-ui">
        <b>ルームに入る</b>
        <input class="rb-codein" id="rbCode" type="tel" inputmode="numeric" maxlength="4" autocomplete="off" placeholder="4桁のコード">
        <button class="bigbtn" id="rbJoin">参加する</button>
      </div>
      <div class="rb-err" id="rbErr"></div>
      ${DEMO&&m?`<div class="muted">デモモード：このタブは「${esc(m.name)}」として参加します（タブごとに別の参加者になります）</div>`:''}`;
    const err=document.getElementById('rbErr');
    const busy=(on)=>runnerPanel.querySelectorAll('.bigbtn').forEach(b=>b.disabled=on);
    const run=(p)=>{ err.textContent=''; busy(true); p.catch(e=>{ busy(false); err.textContent=(e&&e.message)||'通信できませんでした'; console.warn('[RB]',e); }); };
    document.getElementById('rbBack').onclick=()=>renderRunnerHome();
    document.getElementById('rbCreate').onclick=()=>run(createRoom(document.getElementById('rbGenre').value));
    const code=document.getElementById('rbCode');
    code.oninput=()=>{ code.value=code.value.replace(/\D/g,'').slice(0,4); };
    code.onkeydown=e=>{ if(e.key==='Enter') document.getElementById('rbJoin').click(); };
    document.getElementById('rbJoin').onclick=()=>run(joinRoom(code.value));
    const rs=document.getElementById('rbResume');
    if(rs) rs.onclick=()=>run(joinRoom(sess.code).catch(e=>{ saveSess(null); throw e; }));
  }

  return {openHome, active, render, quit, onAnswer, hudHTML, laneHTML, renderLanes, TRACK_MIN_H:180, STATEMENT_MIN_H:200};
})();
