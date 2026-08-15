/* ================= 共有ランキング(Firebase Realtime Database) =================
   3つのクエスト(inorganic/aromatic/aliphatic)から共通で読み込む。
   使い方:
     LB.init('inorganic');                         // ゲームごとに一度呼ぶ
     LB.isRegistered()                              // ニックネーム登録済みか
     LB.openRegisterModal(onSuccess)                 // 登録モーダルを開く
     LB.submitScore(kind, correct, sec, rank)         // チャレンジ結果を送信(登録済みのみ)
     LB.fetchTop(kind, 10).then(list=>...)            // 上位N件を取得
     LB.renderBoardHTML(list)                         // 表示用HTML
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
  const PROFILE_KEY = 'lbProfile';
  let db = null, gameId = null;

  function init(gid){
    gameId = gid;
    try{
      if(!window.firebase){console.warn('[LB] Firebase SDK not loaded');return;}
      if(!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
      db = firebase.database();
    }catch(e){console.warn('[LB] init failed', e);}
  }

  function profile(){
    try{return JSON.parse(localStorage.getItem(PROFILE_KEY)) || null;}catch(e){return null;}
  }
  function isRegistered(){return !!(profile() && profile().nickname);}
  function nickname(){const p=profile(); return p ? p.nickname : null;}
  function saveProfile(nick){
    try{localStorage.setItem(PROFILE_KEY, JSON.stringify({nickname:nick, registered:true}));}catch(e){}
  }
  function validEmail(e){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);}
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function register(nick, email){
    return new Promise((resolve, reject)=>{
      nick = (nick||'').trim().slice(0,12);
      email = (email||'').trim();
      if(!nick){reject('ニックネームを入力してください');return;}
      if(!validEmail(email)){reject('メールアドレスの形式が正しくありません');return;}
      if(!db){reject('通信できませんでした。時間をおいて試してください');return;}
      db.ref('leads').push({
        email, name: nick, ts: firebase.database.ServerValue.TIMESTAMP
      }).then(()=>{
        saveProfile(nick);
        resolve(nick);
      }).catch(err=>reject('送信に失敗しました: '+err.message));
    });
  }

  function submitScore(kind, correct, sec, rank){
    if(!db || !isRegistered() || !gameId) return Promise.resolve(false);
    return db.ref('leaderboard/'+gameId+'/'+kind).push({
      name: nickname(), correct, sec, rank, ts: firebase.database.ServerValue.TIMESTAMP
    }).then(()=>true).catch(()=>false);
  }

  function fetchTop(kind, n){
    n = n || 10;
    if(!db || !gameId) return Promise.resolve([]);
    return db.ref('leaderboard/'+gameId+'/'+kind).orderByChild('correct').limitToLast(50).once('value')
      .then(snap=>{
        const arr = [];
        snap.forEach(ch=>arr.push(ch.val()));
        arr.sort((a,b)=>(b.correct-a.correct)||(a.sec-b.sec));
        return arr.slice(0, n);
      }).catch(()=>[]);
  }

  function renderBoardHTML(entries){
    if(!entries || !entries.length){
      return '<div class="lb-empty">まだ登録者がいません。最初の1人になろう!</div>';
    }
    return '<div class="lb-board">' + entries.map((e,i)=>
      `<div class="lb-row"><span class="lb-rank">${i+1}</span><span class="lb-name">${escapeHtml(e.name)}</span><span class="lb-score">正解${e.correct}問・${e.sec}秒</span></div>`
    ).join('') + '</div>';
  }

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
      .lb-btn-secondary{background:#f1f5f9;color:#64748b;border:none;border-radius:10px;padding:11px 14px;font-size:13.5px}
      .lb-board{margin-top:4px}
      .lb-row{display:flex;gap:8px;align-items:center;padding:6px 4px;border-bottom:1px solid #f1f5f9;font-size:13px}
      .lb-rank{width:22px;font-weight:800;color:#64748b;flex:none}
      .lb-name{flex:1;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .lb-score{color:#64748b;font-size:12px;flex:none}
      .lb-empty{font-size:12.5px;color:#94a3b8;margin-top:6px}
      .lb-cta{font-size:12.5px;color:#64748b;margin:6px 0 10px;line-height:1.6}
      .lb-loading{font-size:12px;color:#94a3b8;margin-top:6px}
    `;
    document.head.appendChild(st);
  }

  function openRegisterModal(onSuccess){
    ensureStyle();
    const wrap = document.createElement('div');
    wrap.className = 'lb-modal-wrap';
    wrap.innerHTML = `
      <div class="lb-modal">
        <h3>🏆 ランキングに登録</h3>
        <p class="lb-note">ニックネームとメールアドレスを登録すると、スコアが全国ランキングに反映され、記録もクラウドに残ります。ご入力いただいたメールアドレスは、個別指導に関するご案内のみに使用します。</p>
        <input id="lbName" placeholder="ニックネーム(12文字以内)" maxlength="12">
        <input id="lbEmail" type="email" placeholder="メールアドレス">
        <div class="lb-err" id="lbErr"></div>
        <div class="lb-btns">
          <button id="lbCancel" class="lb-btn-secondary">あとで</button>
          <button id="lbSubmit" class="lb-btn-primary">登録する</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const close = ()=>wrap.remove();
    wrap.addEventListener('click', e=>{ if(e.target===wrap) close(); });
    document.getElementById('lbCancel').onclick = close;
    document.getElementById('lbSubmit').onclick = ()=>{
      const name = document.getElementById('lbName').value;
      const email = document.getElementById('lbEmail').value;
      const errEl = document.getElementById('lbErr');
      errEl.textContent = '';
      register(name, email).then(nick=>{
        close();
        if(onSuccess) onSuccess(nick);
      }).catch(msg=>{ errEl.textContent = msg; });
    };
  }

  return { init, isRegistered, nickname, register, submitScore, fetchTop, renderBoardHTML, openRegisterModal, ensureStyle };
})();
