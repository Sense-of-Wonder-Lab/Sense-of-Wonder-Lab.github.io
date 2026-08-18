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
  let db = null, auth = null, gameId = null;
  let user = null; // {uid,email,nickname}
  const authListeners = [];
  const pushTimers = {};

  function init(gid){
    gameId = gid;
    try{
      if(!window.firebase){console.warn('[LB] Firebase SDK not loaded');return;}
      if(!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      db = firebase.database();
      auth = firebase.auth();
      auth.onAuthStateChanged(fbUser=>{
        if(!fbUser){ user = null; authListeners.forEach(cb=>cb(null)); return; }
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
          authListeners.forEach(cb=>cb(user));
        });
      });
    }catch(e){console.warn('[LB] init failed', e);}
  }

  function onAuth(cb){ authListeners.push(cb); if(auth) cb(user); }
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
      const val = snap.val();
      if(!val) return;
      const updates = {};
      Object.entries(val).forEach(([mid,m])=>{
        if(!m.read){ showToast(m.text); updates[mid+'/read'] = true; }
      });
      if(Object.keys(updates).length) db.ref('users/'+uid+'/messages').update(updates).catch(()=>{});
    }).catch(()=>{});
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

  function updateNickname(nick){
    nick = (nick||'').trim().slice(0,12);
    if(!nick || !user) return Promise.reject('ニックネームを入力してください');
    return db.ref('users/'+user.uid+'/nickname').set(nick).then(()=>{ user.nickname = nick; });
  }

  function updateAvatar(dataUrl){
    if(!user) return Promise.reject('未ログインです');
    return db.ref('users/'+user.uid+'/avatar').set(dataUrl).then(()=>{ user.avatar = dataUrl; });
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
      return ref.set({name:user.nickname, correct, sec, rank, ts:firebase.database.ServerValue.TIMESTAMP}).then(()=>true);
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
      }).catch(()=>[]);
  }

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function renderBoardHTML(entries, myUid){
    if(!entries || !entries.length){
      return '<div class="lb-empty">まだ登録者がいません。最初の1人になろう!</div>';
    }
    return '<div class="lb-board">' + entries.map((e,i)=>
      `<div class="lb-row${e.uid && e.uid===myUid?' lb-row-me':''}"><span class="lb-rank">${i+1}</span><span class="lb-name">${escapeHtml(e.name)}</span><span class="lb-score">正解${e.correct}問・${e.sec}秒</span></div>`
    ).join('') + '</div>';
  }

  /* ---------- 進捗データのクラウド同期 ---------- */
  function pushState(key, obj){
    if(!user || !db) return;
    clearTimeout(pushTimers[key]);
    pushTimers[key] = setTimeout(()=>{
      db.ref('users/'+user.uid+'/data/'+key).set(obj).catch(()=>{});
    }, 1200);
  }
  function pullState(key){
    if(!user || !db) return Promise.resolve(null);
    return db.ref('users/'+user.uid+'/data/'+key).once('value').then(s=>s.exists()?s.val():null).catch(()=>null);
  }
  // storageKey: localStorage キー名。getLocal(): 生JSON文字列を返す関数
  function attachStateSync(storageKey, getLocalRaw){
    onAuth(u=>{
      if(!u) return;
      pullState(storageKey).then(cloud=>{
        if(cloud){
          const cloudRaw = JSON.stringify(cloud);
          if(cloudRaw !== getLocalRaw()){
            localStorage.setItem(storageKey, cloudRaw);
            location.reload();
          }
        }else{
          const local = getLocalRaw();
          if(local){
            try{ db.ref('users/'+u.uid+'/data/'+storageKey).set(JSON.parse(local)); }catch(e){}
          }
        }
      });
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
      .lb-row{display:flex;gap:8px;align-items:center;padding:6px 4px;border-bottom:1px solid #f1f5f9;font-size:13px}
      .lb-row-me{background:#eff6ff;border-radius:8px}
      .lb-rank{width:22px;font-weight:800;color:#64748b;flex:none}
      .lb-name{flex:1;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .lb-score{color:#64748b;font-size:12px;flex:none}
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
      .accountBtn{flex:none;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:50%;width:34px;height:34px;font-size:16px;display:flex;align-items:center;justify-content:center}
      .lb-toast{position:fixed;left:50%;top:calc(16px + env(safe-area-inset-top));transform:translateX(-50%);background:#1e293b;color:#fff;padding:12px 20px;border-radius:14px;font-size:14px;font-weight:700;z-index:400;box-shadow:0 8px 24px rgba(0,0,0,.3);max-width:88vw;text-align:center;transition:opacity .3s}
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
    `, (wrap, close)=>{
      wrap.querySelector('#lbCancel').onclick = close;
      wrap.querySelector('#lbSave').onclick = ()=>{
        updateNickname(wrap.querySelector('#lbNick').value).then(close)
          .catch(msg=>{ wrap.querySelector('#lbErr').textContent = msg; });
      };
      wrap.querySelector('#lbAvatarInput').onchange = e=>{
        const f = e.target.files[0];
        if(!f) return;
        resizeImageToDataUrl(f,120).then(updateAvatar).then(()=>{ close(); openAccountPanel(); })
          .catch(err=>{ wrap.querySelector('#lbErr').textContent = err && err.message ? err.message : String(err); });
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
    submitScore, fetchTop, renderBoardHTML,
    pushState, pullState, attachStateSync, maybeShowOnboarding,
    openAccountModal, ensureStyle
  };
})();
