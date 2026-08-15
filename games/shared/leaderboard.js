/* ================= 共有アカウント・ランキング(Firebase Auth + Realtime Database) =================
   3つのクエスト(inorganic/aromatic/aliphatic)から共通で読み込む。
   使い方:
     LB.init('inorganic');                            // ゲームごとに一度呼ぶ
     LB.onAuth(user => ...)                            // ログイン状態が変わるたびに呼ばれる(user は {uid,email,nickname} か null)
     LB.currentUser()                                  // 現在のユーザー情報 (同期)
     LB.login() / LB.logout()
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
          if(!data){
            db.ref('users/'+fbUser.uid).set({email:fbUser.email||'', nickname, ts:firebase.database.ServerValue.TIMESTAMP});
          }
          user = {uid:fbUser.uid, email:fbUser.email||'', nickname};
          authListeners.forEach(cb=>cb(user));
        });
      });
    }catch(e){console.warn('[LB] init failed', e);}
  }

  function onAuth(cb){ authListeners.push(cb); if(auth) cb(user); }
  function currentUser(){ return user; }

  function login(){
    if(!auth) return Promise.reject('通信できませんでした');
    const provider = new firebase.auth.GoogleAuthProvider();
    return auth.signInWithPopup(provider).catch(err=>{
      if(err && (err.code==='auth/popup-blocked' || err.code==='auth/cancelled-popup-request')){
        return auth.signInWithRedirect(provider);
      }
      throw err;
    });
  }
  function logout(){ return auth ? auth.signOut() : Promise.resolve(); }

  function updateNickname(nick){
    nick = (nick||'').trim().slice(0,12);
    if(!nick || !user) return Promise.reject('ニックネームを入力してください');
    return db.ref('users/'+user.uid+'/nickname').set(nick).then(()=>{ user.nickname = nick; });
  }

  function deleteAccount(){
    if(!user || !auth.currentUser) return Promise.reject('未ログインです');
    const uid = user.uid;
    return db.ref('users/'+uid).remove()
      .then(()=>auth.currentUser.delete())
      .then(()=>{ user = null; });
  }

  function submitScore(kind, correct, sec, rank){
    if(!db || !user || !gameId) return Promise.resolve(false);
    const ref = db.ref('leaderboard/'+gameId+'/'+kind+'/'+user.uid);
    return ref.once('value').then(snap=>{
      const cur = snap.val();
      if(cur && (cur.correct>correct || (cur.correct===correct && cur.sec<=sec))) return false;
      return ref.set({name:user.nickname, correct, sec, rank, ts:firebase.database.ServerValue.TIMESTAMP}).then(()=>true);
    }).catch(()=>false);
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
      .lb-account-avatar{width:40px;height:40px;border-radius:50%;background:#2563eb;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;flex:none}
      .lb-account-email{font-size:12px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .lb-terms-link{font-size:12px;color:#2563eb;display:block;margin-top:12px;text-align:center}
      .accountBtn{flex:none;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:50%;width:34px;height:34px;font-size:16px;display:flex;align-items:center;justify-content:center}
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
      <div class="lb-btns">
        <button id="lbCancel" class="lb-btn-secondary">あとで</button>
        <button id="lbGoogle" class="lb-btn-google">Googleでログイン</button>
      </div>
      <a href="${TERMS_URL}" target="_blank" class="lb-terms-link">利用規約・プライバシーポリシー</a>
    `, (wrap, close)=>{
      wrap.querySelector('#lbCancel').onclick = close;
      wrap.querySelector('#lbGoogle').onclick = ()=>{
        login().then(close).catch(err=>{
          wrap.querySelector('#lbErr').textContent = 'ログインに失敗しました: '+(err && err.message ? err.message : err);
        });
      };
    });
  }

  function openAccountPanel(){
    openModal(`
      <h3>アカウント</h3>
      <div class="lb-account-row">
        <div class="lb-account-avatar">${escapeHtml((user.nickname||'?')[0])}</div>
        <div><div class="lb-account-email">${escapeHtml(user.email)}</div></div>
      </div>
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
      <div class="lb-btns">
        <button id="lbSkip" class="lb-btn-secondary">お試しでプレイ</button>
        <button id="lbGoogle" class="lb-btn-google">Googleで登録</button>
      </div>
      <a href="${TERMS_URL}" target="_blank" class="lb-terms-link">利用規約・プライバシーポリシー</a>
    `, (wrap, close)=>{
      wrap.querySelector('#lbSkip').onclick = close;
      wrap.querySelector('#lbGoogle').onclick = ()=>{
        login().then(close).catch(err=>{
          wrap.querySelector('#lbErr').textContent = 'ログインに失敗しました: '+(err && err.message ? err.message : err);
        });
      };
    });
  }

  return {
    init, onAuth, currentUser, login, logout, updateNickname, deleteAccount,
    submitScore, fetchTop, renderBoardHTML,
    pushState, pullState, attachStateSync, maybeShowOnboarding,
    openAccountModal, ensureStyle
  };
})();
