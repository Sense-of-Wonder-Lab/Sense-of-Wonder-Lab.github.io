/* ================= 共有アカウント・ランキング(Firebase Auth + Realtime Database) =================
   3つのクエスト(inorganic/aromatic/aliphatic)から共通で読み込む。
   使い方:
     LB.init('inorganic');                            // ゲームごとに一度呼ぶ
     LB.onAuth(user => ...)                            // ログイン状態が変わるたびに呼ばれる(user は {uid,email,nickname} か null)
     LB.currentUser()                                  // 現在のユーザー情報 (同期)
     LB.logout()
     LB.openAccountModal()                             // ログイン/アカウント編集モーダル
     LB.submitScore(kind, correct, sec, rank)           // チャレンジ結果を送信(ログイン時のみ)
     LB.fetchTop(kind, 10).then(list=>...)              // 上位N件を取得
     LB.renderBoardHTML(list, uid)                      // 表示用HTML
     LB.attachStateSync(storageKey, ()=>state, mergeFn)  // 進捗データのクラウド同期を有効化
     LB.pushState(storageKey, obj)                       // 進捗データを保存(デバウンス済み)
     LB.maybeShowOnboarding(storageKey)                  // 初回訪問の登録案内ポップアップ
*/
const LB = (function(){
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBVmC7sIj4mRwgLyNmqJN5CQg6y_XMHiC0",
    authDomain: "sense-of-wonder-lab.firebaseapp.com",
    databaseURL: "https://sense-of-wonder-lab-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "sense-of-wonder-lab",
    storageBucket: "sense-of-wonder-lab.firebasestorage.app",
    messagingSenderId: "120466477782",
    appId: "1:120466477782:web:f0ec79bf0cbbf8ef186f77"
  };
  const GOOGLE_CLIENT_ID = '120466477782-k5o5f91ugi2pc17bpcje8o6ojvj699rv.apps.googleusercontent.com';
  const TERMS_URL = '../shared/terms.html';
  const ONBOARD_FLAG = 'lbOnboardSeen';
  // 同期処理がバグって毎回「更新あり」と誤判定すると location.reload() が延々と
  // 繰り返され、ページが完全に固まる事故になり得る(実際に発生した)。
  // 短時間に何度もリロードが起きた場合は同期をスキップして無限ループを断ち切る。
  function reloadGuardOk(storageKey){
    try{
      const key = 'lbReloadGuard_'+storageKey;
      const now = Date.now();
      let rec; try{ rec = JSON.parse(sessionStorage.getItem(key)) || null; }catch(e){ rec = null; }
      if(!rec || now - rec.ts > 15000) rec = {count:0, ts:now};
      rec.count++;
      sessionStorage.setItem(key, JSON.stringify(rec));
      if(rec.count > 3){ console.error('[LB] reload loop detected for', storageKey, '- skipping sync this load'); return false; }
      return true;
    }catch(e){ return true; }
  }
  let db = null, auth = null, gameId = null;
  let user = null; // {uid,email,nickname}
  const authListeners = [];
  const pushTimers = {};
  const pendingPush = {}; // key -> 保存待ちのオブジェクト(ページ離脱時に即時送信するため保持)
  let messages = []; // [{id,text,read,ts}]
  const messageListeners = [];

  // Firebase Realtime Database のキー名は . # $ [ ] / を含められない。
  // ゲーム側のstateオブジェクトのキーには単元名などの生の文字列(例:「No.1 アルカリ金属」)が
  // そのまま使われることがあるため、送信前に可逆エスケープし、受信後に復元する。
  // (順序重要: エスケープ時は%を最初に、復元時は%25を最後に処理する)
  const FB_KEY_ESCAPE = [['%','%25'],['.','%2E'],['#','%23'],['$','%24'],['[','%5B'],[']','%5D'],['/','%2F']];
  const FB_KEY_UNESCAPE = [['%2E','.'],['%23','#'],['%24','$'],['%5B','['],['%5D',']'],['%2F','/'],['%25','%']];
  function mapKeysDeep(obj, pairs){
    if(Array.isArray(obj)) return obj.map(v=>mapKeysDeep(v, pairs));
    if(obj && typeof obj==='object'){
      const out = {};
      Object.keys(obj).forEach(k=>{
        let nk = k;
        pairs.forEach(([from,to])=>{ nk = nk.split(from).join(to); });
        out[nk] = mapKeysDeep(obj[k], pairs);
      });
      return out;
    }
    return obj;
  }
  function escapeFbKeys(obj){ return mapKeysDeep(obj, FB_KEY_ESCAPE); }
  function unescapeFbKeys(obj){ return mapKeysDeep(obj, FB_KEY_UNESCAPE); }
  function escapeFbKeyStr(s){
    let out = String(s);
    FB_KEY_ESCAPE.forEach(([from,to])=>{ out = out.split(from).join(to); });
    return out;
  }

  // オブジェクトのキー順序に依存しない比較用シリアライズ。
  // mergeProgress はオブジェクトを Set 経由で組み直すため、中身が同じでも
  // JSON.stringify の結果がキー順の違いで一致しなくなることがある。
  // それをそのまま「変化あり」と誤判定すると、保存→再読込→再度「変化あり」…と
  // 無限リロードになる(実際に発生した重大な事故)。比較は必ずこちらを使う。
  function stableStringify(obj){
    if(Array.isArray(obj)) return '['+obj.map(stableStringify).join(',')+']';
    if(obj && typeof obj==='object') return '{'+Object.keys(obj).sort().map(k=>JSON.stringify(k)+':'+stableStringify(obj[k])).join(',')+'}';
    return JSON.stringify(obj);
  }

  // 2つの端末の進捗を「進んでいる方が勝つ」方式でマージする。
  // クラウド/ローカルのどちらか片方が古くても、進捗(正答率・マスター済み等)が
  // 消えることがないようにするための安全策(単純な上書きだと後から同期した方が
  // 先に進んでいた方を消してしまう事故が起きるため)。
  function mergeProgress(a, b){
    if(a===undefined || a===null) return b===undefined ? null : b;
    if(b===undefined || b===null) return a;
    if(Array.isArray(a) || Array.isArray(b)){
      if(!Array.isArray(a) || !Array.isArray(b)) return a; // 型が食い違う場合は形の壊れていなさそうな方を優先できないので現状維持
      // 中身(内容)で重複除去する。Set([...a,...b]) はオブジェクト要素を参照で比較するため
      // 同じ内容でも別物とみなして毎回2倍に膨れ上がる事故が起きた(実際に発生、quota超過)。
      const seen = new Set();
      const out = [];
      [...a, ...b].forEach(item=>{
        const key = (item && typeof item==='object') ? stableStringify(item) : item;
        if(!seen.has(key)){ seen.add(key); out.push(item); }
      });
      if(out.length > 500) out.length = 500; // 想定外の増殖バグに対する保険(通常この規模の配列は起こり得ない)
      return out;
    }
    if(typeof a==='object' && typeof b==='object'){
      if(typeof a.correct==='number' && typeof a.total==='number' && typeof b.correct==='number' && typeof b.total==='number'){
        // {correct,total,best} 形式のスコアレコード。best が保存されていない古い記録
        // (best集計が入る前の記録や、片方だけbest欠けの記録同士のマージでbestがnull落ちするケース)
        // でも取りこぼさないよう、correct/totalから算出した値で補って比較する。
        const scoreOf = s => typeof s.best==='number' ? s.best : Math.round(100*s.correct/s.total);
        const winner = scoreOf(a)>=scoreOf(b) ? a : b;
        return {correct: winner.correct, total: winner.total, best: Math.max(scoreOf(a), scoreOf(b))};
      }
      const out = {};
      new Set([...Object.keys(a), ...Object.keys(b)]).forEach(k=>{ out[k] = mergeProgress(a[k], b[k]); });
      return out;
    }
    return a; // プリミティブ値(設定系)はローカル側を優先
  }

  function init(gid){
    gameId = gid;
    ensureStyle();
    try{
      if(!window.firebase){console.warn('[LB] Firebase SDK not loaded');return;}
      if(!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      db = firebase.database();
      auth = firebase.auth();
      auth.onAuthStateChanged(fbUser=>{
        if(!fbUser){ user = null; messages = []; notifyMessages(); notifyAuth(null); return; }
        db.ref('users/'+fbUser.uid).once('value').then(snap=>{
          const data = snap.val();
          const nickname = (data && data.nickname) || (fbUser.displayName||'').slice(0,12) || 'ゲスト';
          const avatar = (data && data.avatar) || null;
          if(!data){
            db.ref('users/'+fbUser.uid).set({email:fbUser.email||'', nickname, ts:firebase.database.ServerValue.TIMESTAMP});
          }
          user = {uid:fbUser.uid, email:fbUser.email||'', nickname, avatar};
          recordActivity(fbUser.uid);
          checkMessages(fbUser.uid);
          notifyAuth(user);
        });
      });
    }catch(e){console.warn('[LB] init failed', e);}
  }

  function notifyAuth(u){
    authListeners.forEach(cb=>{ try{ cb(u); }catch(e){ console.error('[LB] onAuth listener failed', e); } });
  }
  function onAuth(cb){ authListeners.push(cb); if(auth){ try{ cb(user); }catch(e){ console.error('[LB] onAuth listener failed', e); } } }
  function currentUser(){ return user; }

  function recordActivity(uid){
    if(!db || !gameId) return;
    const day = new Date().toISOString().slice(0,10);
    db.ref('users/'+uid+'/lastActive').set(firebase.database.ServerValue.TIMESTAMP).catch(()=>{});
    db.ref('users/'+uid+'/lastGame').set(gameId).catch(()=>{});
    db.ref('users/'+uid+'/activityDays/'+day).set(true).catch(()=>{});
  }

  function checkMessages(uid){
    if(!db) return;
    db.ref('users/'+uid+'/messages').once('value').then(snap=>{
      const val = snap.val() || {};
      messages = Object.entries(val).map(([id,m])=>Object.assign({id}, m)).sort((a,b)=>(b.ts||0)-(a.ts||0));
      notifyMessages();
    }).catch(()=>{});
  }
  function unreadCount(){ return messages.filter(m=>!m.read).length; }
  function notifyMessages(){ messageListeners.forEach(cb=>cb(unreadCount())); }
  function onMessages(cb){ messageListeners.push(cb); cb(unreadCount()); }
  function fmtMsgTime(ts){
    if(!ts) return '';
    const d = new Date(ts);
    return d.getFullYear()+'/'+(d.getMonth()+1)+'/'+d.getDate()+' '+String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  }
  function notifListHTML(){
    if(!messages.length) return '<div class="lb-empty">お知らせはまだありません。</div>';
    return '<div class="lb-msg-list">' + messages.map(m=>{
      const tag = (m.game || m.setName) ? `<div class="lb-msg-tag">🏆 ${escapeHtml(m.game||'')}${m.game&&m.setName?'・':''}${escapeHtml(m.setName||'')}</div>` : '';
      return `<div class="lb-msg-item${m.read?'':' unread'}">${tag}<div class="lb-msg-text">${escapeHtml(m.text||'')}</div><div class="lb-msg-time">${fmtMsgTime(m.ts)}</div></div>`;
    }).join('') + '</div>';
  }
  function markAllMessagesRead(){
    if(!user || !db) return;
    const updates = {};
    messages.forEach(m=>{ if(!m.read){ updates[m.id+'/read'] = true; m.read = true; } });
    if(Object.keys(updates).length){
      db.ref('users/'+user.uid+'/messages').update(updates).catch(()=>{});
      notifyMessages();
    }
  }
  function fetchLikes(gameKey){
    if(!db || !user) return Promise.resolve({});
    return db.ref('users/'+user.uid+'/likes/'+gameKey).once('value').then(s=>unescapeFbKeys(s.val()||{})).catch(()=>({}));
  }
  // 問題ごとの正答率カウンター。デッキ/カテゴリを1周解き終えた時点で一括送信する
  // (1問答えるたびに送るのではない)。
  // pushState/attachStateSync のマージ処理は一切経由せず、Firebase の increment() で
  // サーバー側に直接加算する。これなら複数端末から同時に送っても正しく合算されるので、
  // 自前マージロジックが二重カウントする事故(このセッションで何度か起きた)が起こり得ない。
  // 書き込み先は users/{uid}/data/{storageKey} (進捗データ本体、mergeで上書きされ得る場所) とは
  // 完全に別の場所(questionStats, users/{uid}/qStats)にしているのもそのため。
  function recordQuizResults(gameKey, results){
    if(!db || !user || !results || !results.length) return;
    const escGame = escapeFbKeyStr(gameKey);
    const updates = {};
    results.forEach(r=>{
      const escId = escapeFbKeyStr(r.id);
      updates['questionStats/'+escGame+'/'+escId+'/total'] = firebase.database.ServerValue.increment(1);
      updates['users/'+user.uid+'/qStats/'+escGame+'/'+escId+'/total'] = firebase.database.ServerValue.increment(1);
      if(r.ok){
        updates['questionStats/'+escGame+'/'+escId+'/correct'] = firebase.database.ServerValue.increment(1);
        updates['users/'+user.uid+'/qStats/'+escGame+'/'+escId+'/correct'] = firebase.database.ServerValue.increment(1);
      }
    });
    db.ref().update(updates).catch(err=>console.error('[LB] recordQuizResults failed', err));
  }
  function showToast(text){
    ensureStyle();
    const t = document.createElement('div');
    t.className = 'lb-toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(()=>{ t.style.opacity = '0'; setTimeout(()=>t.remove(), 300); }, 4500);
  }

  function friendlyAuthError(err){
    if(err && err.code==='auth/network-request-failed') return '通信エラーが発生しました。電波の良い場所でもう一度お試しください。';
    return 'ログインできませんでした。プレイ自体はこのままお楽しみいただけます。';
  }

  // Google Identity Services: ページとGoogleが直接やり取りする方式(Firebaseの中継iframeを使わない)
  let gisLoadPromise = null;
  function loadGIS(){
    if(gisLoadPromise) return gisLoadPromise;
    gisLoadPromise = new Promise((resolve,reject)=>{
      if(window.google && google.accounts && google.accounts.id){ resolve(); return; }
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = ()=>resolve();
      s.onerror = ()=>reject(new Error('Googleログインの読み込みに失敗しました'));
      document.head.appendChild(s);
    });
    return gisLoadPromise;
  }
  let gisInitialized = false;
  function handleCredentialResponse(resp){
    if(!auth || !resp || !resp.credential) return;
    const credential = firebase.auth.GoogleAuthProvider.credential(resp.credential);
    auth.signInWithCredential(credential).catch(err=>console.warn('[LB] signInWithCredential failed', err));
  }
  function renderGoogleButton(container, onError){
    loadGIS().then(()=>{
      if(!gisInitialized){
        google.accounts.id.initialize({client_id: GOOGLE_CLIENT_ID, callback: handleCredentialResponse});
        gisInitialized = true;
      }
      google.accounts.id.renderButton(container, {theme:'outline', size:'large', text:'signin_with', shape:'pill', width:260});
    }).catch(err=>{ if(onError) onError(friendlyAuthError(err)); });
  }
  function logout(){ return auth ? auth.signOut() : Promise.resolve(); }

  const GAME_IDS = ['inorganic','aromatic','aliphatic'];
  const CHAL_KINDS = ['score','time'];
  function propagateField(field, value){
    const jobs = [];
    GAME_IDS.forEach(gid=>CHAL_KINDS.forEach(kind=>{
      const ref = db.ref('leaderboard/'+gid+'/'+kind+'/'+user.uid);
      jobs.push(
        ref.once('value').then(snap=>{
          if(!snap.exists()){ console.warn('[LB] propagate '+field+' skip(no entry)', gid, kind); return null; }
          return ref.child(field).set(value).then(()=>console.warn('[LB] propagate '+field+' ok', gid, kind));
        }).catch(err=>console.warn('[LB] propagate '+field+' FAILED', gid, kind, err))
      );
    }));
    return Promise.all(jobs);
  }
  function updateNickname(nick){
    nick = (nick||'').trim().slice(0,12);
    if(!nick || !user) return Promise.reject('ニックネームを入力してください');
    return db.ref('users/'+user.uid+'/nickname').set(nick).then(()=>{
      user.nickname = nick;
      return propagateField('name', nick);
    });
  }

  function updateAvatar(dataUrl){
    if(!user) return Promise.reject('未ログインです');
    return db.ref('users/'+user.uid+'/avatar').set(dataUrl).then(()=>{
      user.avatar = dataUrl;
      return propagateField('avatar', dataUrl);
    }).catch(err=>{ console.warn('[LB] updateAvatar failed', err); throw err; });
  }
  function resizeImageToDataUrl(file, size){
    return new Promise((resolve,reject)=>{
      const reader = new FileReader();
      reader.onerror = ()=>reject(new Error('画像の読み込みに失敗しました'));
      reader.onload = e=>{
        const img = new Image();
        img.onerror = ()=>reject(new Error('画像の読み込みに失敗しました'));
        img.onload = ()=>{
          const canvas = document.createElement('canvas');
          canvas.width = size; canvas.height = size;
          const ctx = canvas.getContext('2d');
          const side = Math.min(img.width, img.height);
          const sx = (img.width-side)/2, sy = (img.height-side)/2;
          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
          resolve(canvas.toDataURL('image/jpeg', 0.8));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function deleteAccount(){
    if(!user || !auth.currentUser) return Promise.reject('未ログインです');
    const uid = user.uid;
    return db.ref('users/'+uid).remove()
      .then(()=>auth.currentUser.delete())
      .then(()=>{ user = null; });
  }

  function submitScore(kind, correct, sec, rank){
    if(!db || !user || !gameId){ console.warn('[LB] submitScore skipped', {db:!!db, user, gameId}); return Promise.resolve(false); }
    const ref = db.ref('leaderboard/'+gameId+'/'+kind+'/'+user.uid);
    return ref.once('value').then(snap=>{
      const cur = snap.val();
      if(cur && (cur.correct>correct || (cur.correct===correct && cur.sec<=sec))){
        console.warn('[LB] submitScore: existing score is not worse, skipped', cur, {correct,sec});
        return false;
      }
      return ref.set({name:user.nickname, avatar:user.avatar||null, correct, sec, rank, ts:firebase.database.ServerValue.TIMESTAMP}).then(()=>true);
    }).catch(err=>{ console.warn('[LB] submitScore failed', err); return false; });
  }

  function fetchTop(kind, n){
    n = n || 10;
    if(!db || !gameId) return Promise.resolve([]);
    return db.ref('leaderboard/'+gameId+'/'+kind).orderByChild('correct').limitToLast(50).once('value')
      .then(snap=>{
        const arr = [];
        snap.forEach(ch=>arr.push(Object.assign({uid:ch.key}, ch.val())));
        arr.sort((a,b)=>(b.correct-a.correct)||(a.sec-b.sec));
        return arr.slice(0, n);
      }).catch(err=>{ console.warn('[LB] fetchTop failed', err); return []; });
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function rankMedal(i){ return i===0 ? '🥇' : i===1 ? '🥈' : i===2 ? '🥉' : '🔵'; }
  function rankBadge(i){
    return i<3
      ? `<span class="lb-medal">${rankMedal(i)}</span>`
      : `<span class="lb-rankn">${i+1}</span>`;
  }
  function rankClass(i){ return i===0?' lb-row-1st':i===1?' lb-row-2nd':i===2?' lb-row-3rd':''; }
  function avatarHtml(avatar, name){
    return avatar
      ? `<img class="lb-avatar" src="${avatar}">`
      : `<span class="lb-avatar lb-avatar-fallback">${escapeHtml((name||'?')[0])}</span>`;
  }

  function renderBoardHTML(entries, myUid, kind){
    ensureStyle();
    if(!entries || !entries.length){
      return '<div class="lb-empty">まだ登録者がいません。最初の1人になろう!</div>';
    }
    const showSec = kind!=='time';
    return '<div class="lb-list">' + entries.map((e,i)=>
      `<div class="lb-pill${rankClass(i)}${e.uid && e.uid===myUid?' lb-row-me':''}">`
      + `<span class="lb-badge">${rankBadge(i)}</span>`
      + avatarHtml(e.avatar, e.name)
      + `<span class="lb-pill-name">${escapeHtml(e.name)}</span>`
      + `<span class="lb-pill-stats">`
      +   `<span class="lb-stat"><b>${e.correct}</b><small>問</small></span>`
      +   (showSec?`<span class="lb-stat"><b>${e.sec}</b><small>秒</small></span>`:'')
      +   `<span class="lb-grade">${escapeHtml(e.rank||'-')}</span>`
      + `</span>`
      + `</div>`
    ).join('') + '</div>';
  }

  function renderSelfBestHTML(list, kind){
    ensureStyle();
    if(!list || !list.length){
      return '<div class="lb-empty">まだ記録がありません。</div>';
    }
    const myName = (user && user.nickname) || '自己ベスト';
    const myAvatar = user && user.avatar;
    const showSec = kind!=='time';
    return '<div class="lb-list">' + list.map((b,i)=>
      `<div class="lb-pill${rankClass(i)}">`
      + `<span class="lb-badge">${rankBadge(i)}</span>`
      + avatarHtml(myAvatar, myName)
      + `<span class="lb-pill-name">${escapeHtml(myName)}</span>`
      + `<span class="lb-pill-stats">`
      +   `<span class="lb-stat"><b>${b.correct}</b><small>問</small></span>`
      +   (showSec?`<span class="lb-stat"><b>${b.sec}</b><small>秒</small></span>`:'')
      +   `<span class="lb-grade">${escapeHtml(b.rank||'-')}</span>`
      + `</span>`
      + `</div>`
    ).join('') + '</div>';
  }

  /* ---------- 進捗データのクラウド同期 ---------- */
  function doPush(key){
    const obj = pendingPush[key];
    clearTimeout(pushTimers[key]);
    delete pushTimers[key];
    if(obj===undefined || !user || !db) return;
    delete pendingPush[key];
    try{
      db.ref('users/'+user.uid+'/data/'+key).set(escapeFbKeys(obj)).catch(err=>console.error('[LB] pushState failed', key, err));
    }catch(err){ console.error('[LB] pushState failed (sync)', key, err); }
  }
  function pushState(key, obj){
    if(!user || !db) return;
    pendingPush[key] = obj;
    clearTimeout(pushTimers[key]);
    pushTimers[key] = setTimeout(()=>doPush(key), 1200);
  }
  // タブが隠れる/閉じられる瞬間に、保留中の保存(デバウンス待ち)を即座に送る。
  // これがないと、結果画面を出した直後にページを離れるモバイル操作で保存が飛ぶ。
  function flushPendingPushes(){
    Object.keys(pendingPush).forEach(doPush);
  }
  if(typeof document !== 'undefined'){
    document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='hidden') flushPendingPushes(); });
    window.addEventListener('pagehide', flushPendingPushes);
  }
  function pullState(key){
    if(!user || !db) return Promise.resolve(null);
    return db.ref('users/'+user.uid+'/data/'+key).once('value').then(s=>s.exists()?unescapeFbKeys(s.val()):null).catch(()=>null);
  }
  // storageKey: localStorage キー名。getLocal(): 生JSON文字列を返す関数
  // 注意: クラウド側の読み取りが失敗した場合は s.exists() の結果ではなく
  // rejected Promise になるため、下の .then(cloud=>...) には来ない(=何もしない)。
  // 読み取り失敗を「クラウドにデータがない」と誤認してローカルで上書きしないための安全策。
  // 単純な「違ったらクラウドで上書き」ではなく mergeProgress で合成する。
  // 別端末での保存がまだサーバーに届いていないタイミングで同期が走っても、
  // 進捗が巻き戻って消えることがないようにするため。
  function attachStateSync(storageKey, getLocalRaw){
    onAuth(u=>{
      if(!u) return;
      db.ref('users/'+u.uid+'/data/'+storageKey).once('value').then(snap=>{
        const exists = snap.exists();
        const cloud = exists ? unescapeFbKeys(snap.val()) : null;
        const localRaw = getLocalRaw();
        let local = null;
        try{ local = localRaw ? JSON.parse(localRaw) : null; }catch(e){}
        const merged = mergeProgress(local, cloud);
        const mergedStable = stableStringify(merged);
        const needLocalUpdate = mergedStable !== stableStringify(local);
        const needCloudUpdate = mergedStable !== stableStringify(cloud);
        if(needCloudUpdate){
          try{ db.ref('users/'+u.uid+'/data/'+storageKey).set(escapeFbKeys(merged)); }catch(e){}
        }
        if(needLocalUpdate){
          localStorage.setItem(storageKey, JSON.stringify(merged));
          if(reloadGuardOk(storageKey)) location.reload();
        }
      }).catch(err=>{ console.error('[LB] attachStateSync read failed, skipping sync to avoid overwriting data', err); });
    });
  }

  /* ---------- UI ---------- */
  function ensureStyle(){
    if(document.getElementById('lb-style')) return;
    const st = document.createElement('style');
    st.id = 'lb-style';
    st.textContent = `
      .lb-modal-wrap{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:300;padding:16px}
      .lb-modal{background:#fff;border-radius:16px;padding:22px;max-width:360px;width:100%;box-shadow:0 12px 32px rgba(0,0,0,.25)}
      .lb-modal h3{margin:0 0 10px;font-size:17px}
      .lb-note{font-size:12px;color:#64748b;line-height:1.6;margin:0 0 14px}
      .lb-modal input{width:100%;box-sizing:border-box;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:14px;margin-bottom:8px;font-family:inherit}
      .lb-err{color:#dc2626;font-size:12.5px;min-height:16px;margin-bottom:2px}
      .lb-btns{display:flex;gap:8px;margin-top:6px}
      .lb-btn-primary{flex:1;background:#2563eb;color:#fff;border:none;border-radius:10px;padding:11px;font-weight:700;font-size:13.5px}
      .lb-btn-google{flex:1;background:#fff;color:#3c4043;border:1.5px solid #dadce0;border-radius:10px;padding:11px;font-weight:700;font-size:13.5px;display:flex;align-items:center;justify-content:center;gap:8px}
      .lb-btn-secondary{background:#f1f5f9;color:#64748b;border:none;border-radius:10px;padding:11px 14px;font-size:13.5px}
      .lb-btn-danger{background:none;color:#dc2626;border:none;font-size:12px;padding:8px 0;text-decoration:underline}
      .lb-board{margin-top:4px}
      .lb-list{display:flex;flex-direction:column;gap:8px;margin-top:12px}
      .lb-pill{display:grid;grid-template-columns:36px 36px minmax(0,1fr) auto;align-items:center;gap:12px;padding:12px 16px;border-radius:14px;background:#f8fafc;border:1px solid #e9edf2;box-sizing:border-box}
      .lb-badge{grid-column:1;color:#94a3b8;font-weight:800;font-size:13px;text-align:center;white-space:nowrap;font-variant-numeric:tabular-nums}
      .lb-row-1st,.lb-row-2nd,.lb-row-3rd{border-left-width:4px;border-left-style:solid;padding-left:12px}
      .lb-row-1st{border-left-color:#eab308;background:linear-gradient(90deg,rgba(234,179,8,.12),rgba(248,250,252,0) 70%)}
      .lb-row-2nd{border-left-color:#94a3b8;background:linear-gradient(90deg,rgba(148,163,184,.14),rgba(248,250,252,0) 70%)}
      .lb-row-3rd{border-left-color:#c2703d;background:linear-gradient(90deg,rgba(194,112,61,.12),rgba(248,250,252,0) 70%)}
      .lb-row-1st .lb-badge{color:#92400e}
      .lb-row-2nd .lb-badge{color:#334155}
      .lb-row-3rd .lb-badge{color:#7c3f19}
      .lb-row-me{box-shadow:0 0 0 2px #60a5fa inset}
      .lb-avatar{grid-column:2;width:36px;height:36px;border-radius:50%;object-fit:cover}
      .lb-avatar-fallback{background:#2563eb;color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800}
      .lb-pill-name{grid-column:3;min-width:0;font-weight:700;font-size:14px;color:#1e293b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .lb-pill-stats{grid-column:4;display:flex;align-items:baseline;gap:10px;white-space:nowrap}
      .lb-stat{display:inline-flex;align-items:baseline;gap:2px}
      .lb-stat b{font-size:16px;font-weight:800;color:#1e293b;font-variant-numeric:tabular-nums}
      .lb-stat small{font-size:11px;font-weight:500;color:#94a3b8}
      .lb-grade{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:22px;padding:0 6px;border-radius:7px;background:#eef2ff;color:#4338ca;font-size:12px;font-weight:800}
      .lb-medal{font-size:20px;line-height:1}
      .lb-rankn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;margin:0 auto;border-radius:50%;background:#e0f2fe;color:#0369a1;font-size:12px;font-weight:800}
      .lb-empty{font-size:12.5px;color:#94a3b8;margin-top:6px}
      .lb-cta{font-size:12.5px;color:#64748b;margin:6px 0 10px;line-height:1.6}
      .lb-loading{font-size:12px;color:#94a3b8;margin-top:6px}
      .lb-account-row{display:flex;align-items:center;gap:10px;margin-bottom:14px}
      .lb-account-avatar-wrap{position:relative;cursor:pointer;flex:none}
      .lb-account-avatar{width:44px;height:44px;border-radius:50%;background:#2563eb;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;object-fit:cover}
      .lb-avatar-edit{position:absolute;right:-2px;bottom:-2px;background:#fff;border:1.5px solid #e2e8f0;border-radius:50%;width:18px;height:18px;font-size:10px;display:flex;align-items:center;justify-content:center}
      .lb-account-email{font-size:12px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .lb-field-label{font-size:11.5px;color:#64748b;font-weight:700;margin-bottom:4px}
      .lb-terms-link{font-size:12px;color:#2563eb;display:block;margin-top:12px;text-align:center}
      .accountBtn{flex:none;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:50%;width:34px;height:34px;font-size:16px;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:0}
      .accountBtn img{width:100%;height:100%;object-fit:cover;display:block}
      .lb-toast{position:fixed;left:50%;top:calc(16px + env(safe-area-inset-top));transform:translateX(-50%);background:#1e293b;color:#fff;padding:12px 20px;border-radius:14px;font-size:14px;font-weight:700;z-index:400;box-shadow:0 8px 24px rgba(0,0,0,.3);max-width:88vw;text-align:center;transition:opacity .3s}
      .accountBtnWrap{position:relative;display:inline-flex;flex:none;margin-left:auto}
      .lb-notif-badge{position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;border-radius:9px;font-size:10px;font-weight:800;min-width:16px;height:16px;line-height:16px;padding:0 4px;box-shadow:0 0 0 2px rgba(30,58,138,.9);pointer-events:none}
      .lb-notif-section{margin-top:4px;border-top:1px solid #e2e8f0;padding-top:12px}
      .lb-msg-list{display:flex;flex-direction:column;gap:8px;max-height:40vh;overflow-y:auto;margin-top:6px}
      .lb-msg-item{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px}
      .lb-msg-item.unread{background:#fffbeb;border-color:#fde68a}
      .lb-msg-tag{font-size:11px;font-weight:800;color:#2563eb;margin-bottom:4px}
      .lb-msg-text{font-size:13.5px;font-weight:700;line-height:1.5;color:#1e293b}
      .lb-msg-time{font-size:11px;color:#94a3b8;margin-top:4px}
      html[data-theme="navy"] .lb-notif-section{border-color:rgba(255,255,255,.16)}
      html[data-theme="navy"] .lb-msg-item{background:rgba(255,255,255,.05);border-color:rgba(120,210,255,.2)}
      html[data-theme="navy"] .lb-msg-item.unread{background:rgba(245,185,63,.14);border-color:rgba(245,185,63,.4)}
      html[data-theme="navy"] .lb-msg-tag{color:#4fd8ff}
      html[data-theme="navy"] .lb-msg-text{color:#eaf6ff}
      html[data-theme="navy"] .lb-msg-time{color:#7f97b3}
      /* ---- 深海ラボ・ネイビーテーマ ---- */
      html[data-theme="navy"] .lb-modal-wrap{background:rgba(2,6,14,.65)}
      html[data-theme="navy"] .lb-modal{background:rgba(16,26,46,.96);backdrop-filter:blur(18px) saturate(140%);-webkit-backdrop-filter:blur(18px) saturate(140%);border:1px solid rgba(120,210,255,.2);color:#eaf6ff}
      html[data-theme="navy"] .lb-note,html[data-theme="navy"] .lb-cta,html[data-theme="navy"] .lb-loading{color:#9db6d6}
      html[data-theme="navy"] .lb-modal input{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.18);color:#eaf6ff}
      html[data-theme="navy"] .lb-btn-primary{background:linear-gradient(135deg,#2dd4ff,#7c5cff);color:#081018}
      html[data-theme="navy"] .lb-btn-secondary{background:rgba(255,255,255,.08);color:#9db6d6}
      html[data-theme="navy"] .lb-pill{background:rgba(255,255,255,.05);border-color:rgba(120,210,255,.2);color:#eaf6ff}
      html[data-theme="navy"] .lb-badge{color:#7f97b3}
      html[data-theme="navy"] .lb-pill-name{color:#eaf6ff}
      html[data-theme="navy"] .lb-stat b{color:#eaf6ff}
      html[data-theme="navy"] .lb-stat small{color:#7f97b3}
      html[data-theme="navy"] .lb-grade{background:rgba(124,92,255,.22);color:#c9befe}
      html[data-theme="navy"] .lb-rankn{background:rgba(45,212,255,.18);color:#7fe3ff}
      html[data-theme="navy"] .lb-row-1st .lb-badge{color:#f5c15f}
      html[data-theme="navy"] .lb-row-2nd .lb-badge{color:#c7d0db}
      html[data-theme="navy"] .lb-row-3rd .lb-badge{color:#e6b483}
      html[data-theme="navy"] .lb-row-1st{border-left-color:#f5c15f;background:linear-gradient(90deg,rgba(245,185,63,.18),rgba(255,255,255,.03) 70%)}
      html[data-theme="navy"] .lb-row-2nd{border-left-color:#c7d0db;background:linear-gradient(90deg,rgba(185,195,207,.16),rgba(255,255,255,.03) 70%)}
      html[data-theme="navy"] .lb-row-3rd{border-left-color:#e6b483;background:linear-gradient(90deg,rgba(217,151,106,.16),rgba(255,255,255,.03) 70%)}
      html[data-theme="navy"] .lb-row-me{box-shadow:0 0 0 2px #4fd8ff inset}
      html[data-theme="navy"] .lb-empty{color:#7f97b3}
      html[data-theme="navy"] .lb-avatar-fallback{background:#2dd4ff;color:#081018}
      html[data-theme="navy"] .lb-account-avatar{background:#2dd4ff;color:#081018}
      html[data-theme="navy"] .lb-avatar-edit{background:rgba(16,26,46,.96);border-color:rgba(120,210,255,.3);color:#eaf6ff}
      html[data-theme="navy"] .lb-account-email{color:#7f97b3}
      html[data-theme="navy"] .lb-field-label{color:#9db6d6}
    `;
    document.head.appendChild(st);
  }

  function openModal(html, wireUp){
    ensureStyle();
    const wrap = document.createElement('div');
    wrap.className = 'lb-modal-wrap';
    wrap.innerHTML = `<div class="lb-modal">${html}</div>`;
    document.body.appendChild(wrap);
    const close = ()=>wrap.remove();
    wrap.addEventListener('click', e=>{ if(e.target===wrap) close(); });
    wireUp(wrap, close);
    return wrap;
  }

  function openLoginModal(){
    openModal(`
      <h3>🏆 ログイン</h3>
      <p class="lb-note">Googleアカウントでログインすると、進捗が他の端末とも同期され、チャレンジのスコアを全国ランキングに送れます。プレイ自体はログインなしでも自由に楽しめます。</p>
      <div class="lb-err" id="lbErr"></div>
      <div id="gsiBox" style="display:flex;justify-content:center;margin:10px 0 4px"></div>
      <div class="lb-btns" style="justify-content:center"><button id="lbCancel" class="lb-btn-secondary" style="width:260px">あとで</button></div>
      <a href="${TERMS_URL}" target="_blank" class="lb-terms-link">利用規約・プライバシーポリシー</a>
    `, (wrap, close)=>{
      wrap.querySelector('#lbCancel').onclick = close;
      onAuth(u=>{ if(u) close(); });
      renderGoogleButton(wrap.querySelector('#gsiBox'), msg=>{ wrap.querySelector('#lbErr').textContent = msg; });
    });
  }

  function openAccountPanel(){
    openModal(`
      <h3>アカウント管理</h3>
      <div class="lb-account-row">
        <label class="lb-account-avatar-wrap">
          ${user.avatar
            ? `<img class="lb-account-avatar" src="${user.avatar}">`
            : `<div class="lb-account-avatar">${escapeHtml((user.nickname||'?')[0])}</div>`}
          <span class="lb-avatar-edit">✎</span>
          <input type="file" accept="image/*" id="lbAvatarInput" style="display:none">
        </label>
        <div><div class="lb-account-email">${escapeHtml(user.email)}</div></div>
      </div>
      <div class="lb-field-label">ユーザーネーム(ランキング登録名)</div>
      <input id="lbNick" placeholder="ニックネーム(12文字以内)" maxlength="12" value="${escapeHtml(user.nickname)}">
      <div class="lb-err" id="lbErr"></div>
      <div class="lb-btns">
        <button id="lbCancel" class="lb-btn-secondary">閉じる</button>
        <button id="lbSave" class="lb-btn-primary">保存</button>
      </div>
      <a href="${TERMS_URL}" target="_blank" class="lb-terms-link">利用規約・プライバシーポリシー</a>
      <div style="text-align:center">
        <button id="lbLogout" class="lb-btn-danger">ログアウト</button>
        <span style="color:#cbd5e1">|</span>
        <button id="lbDelete" class="lb-btn-danger">アカウント削除</button>
      </div>
      <div class="lb-notif-section">
        <div class="lb-field-label" style="margin-top:14px">🔔 お知らせ</div>
        ${notifListHTML()}
      </div>
    `, (wrap, close)=>{
      markAllMessagesRead();
      let pendingAvatar = null;
      wrap.querySelector('#lbCancel').onclick = close;
      wrap.querySelector('#lbSave').onclick = ()=>{
        const btn = wrap.querySelector('#lbSave');
        const errBox = wrap.querySelector('#lbErr');
        errBox.textContent = ''; errBox.style.color = '';
        btn.disabled = true; btn.textContent = '保存中…';
        const tasks = [updateNickname(wrap.querySelector('#lbNick').value)];
        if(pendingAvatar) tasks.push(updateAvatar(pendingAvatar));
        Promise.all(tasks).then(()=>{ notifyAuth(user); close(); }).catch(err=>{
          btn.disabled = false; btn.textContent = '保存';
          errBox.style.color = '';
          errBox.textContent = err && err.message ? err.message : String(err);
        });
      };
      wrap.querySelector('#lbAvatarInput').onchange = e=>{
        const f = e.target.files[0];
        if(!f) return;
        resizeImageToDataUrl(f,120).then(dataUrl=>{
          pendingAvatar = dataUrl;
          const img = document.createElement('img');
          img.className = 'lb-account-avatar';
          img.src = dataUrl;
          wrap.querySelector('.lb-account-avatar').replaceWith(img);
          const errBox = wrap.querySelector('#lbErr');
          errBox.textContent = '「保存」を押すと反映されます';
          errBox.style.color = '#64748b';
        }).catch(err=>{ wrap.querySelector('#lbErr').textContent = err && err.message ? err.message : String(err); });
      };
      wrap.querySelector('#lbLogout').onclick = ()=>{ logout().then(close); };
      wrap.querySelector('#lbDelete').onclick = ()=>{
        if(!confirm('アカウントを削除します。ランキング登録・クラウド上の進捗データも削除されます。よろしいですか?')) return;
        deleteAccount().then(close).catch(err=>{
          wrap.querySelector('#lbErr').textContent = 'エラー: '+(err && err.message ? err.message : err);
        });
      };
    });
  }

  function openAccountModal(){
    if(user) openAccountPanel(); else openLoginModal();
  }

  function maybeShowOnboarding(storageKey){
    if(user) return;
    if(localStorage.getItem(ONBOARD_FLAG)) return;
    if(localStorage.getItem(storageKey)) return;
    localStorage.setItem(ONBOARD_FLAG, '1');
    openModal(`
      <h3>ようこそ!</h3>
      <p class="lb-note">Googleでログインすると、進捗がスマホ・タブレットなど複数端末で共有され、チャレンジのスコアを全国ランキングに送れます。あとからでも登録できます。</p>
      <div class="lb-err" id="lbErr"></div>
      <div id="gsiBox" style="display:flex;justify-content:center;margin:10px 0 4px"></div>
      <div class="lb-btns" style="justify-content:center"><button id="lbSkip" class="lb-btn-secondary" style="width:260px">お試しでプレイ</button></div>
      <a href="${TERMS_URL}" target="_blank" class="lb-terms-link">利用規約・プライバシーポリシー</a>
    `, (wrap, close)=>{
      wrap.querySelector('#lbSkip').onclick = close;
      onAuth(u=>{ if(u) close(); });
      renderGoogleButton(wrap.querySelector('#gsiBox'), msg=>{ wrap.querySelector('#lbErr').textContent = msg; });
    });
  }

  return {
    init, onAuth, currentUser, logout, updateNickname, deleteAccount,
    submitScore, fetchTop, renderBoardHTML, renderSelfBestHTML,
    pushState, pullState, attachStateSync, maybeShowOnboarding,
    openAccountModal, ensureStyle, onMessages, fetchLikes, recordQuizResults
  };
})();
