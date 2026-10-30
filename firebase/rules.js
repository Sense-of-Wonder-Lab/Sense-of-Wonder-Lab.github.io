// Firebase Realtime Database のルールを取得・反映する（GitHub Actions から使う）
//   node firebase/rules.js pull   … 今のルールを firebase/database.rules.json に保存
//   node firebase/rules.js push   … firebase/database.rules.json の内容を反映（前のルールは backup に保存）
// 認証は GOOGLE_APPLICATION_CREDENTIALS（サービスアカウントの鍵ファイル）
const fs = require('fs');
const path = require('path');
const { GoogleAuth } = require('google-auth-library');

const DB = 'https://sense-of-wonder-lab-default-rtdb.asia-southeast1.firebasedatabase.app';
const FILE = path.join(__dirname, 'database.rules.json');

async function token() {
  const auth = new GoogleAuth({ scopes: [
    'https://www.googleapis.com/auth/firebase.database',
    'https://www.googleapis.com/auth/userinfo.email',
  ] });
  const t = await (await auth.getClient()).getAccessToken();
  return t.token || t;
}
async function getRules(tk) {
  const res = await fetch(DB + '/.settings/rules.json', { headers: { Authorization: 'Bearer ' + tk } });
  const body = await res.text();
  if (!res.ok) throw new Error('取得に失敗: ' + res.status + ' ' + body);
  return body;
}

(async () => {
  const mode = process.argv[2];
  const tk = await token();
  if (mode === 'pull') {
    fs.writeFileSync(FILE, (await getRules(tk)).trimEnd() + '\n');
    console.log('保存しました: ' + FILE);
  } else if (mode === 'push') {
    fs.writeFileSync(path.join(__dirname, 'backup.rules.json'), await getRules(tk));
    const res = await fetch(DB + '/.settings/rules.json', {
      method: 'PUT', headers: { Authorization: 'Bearer ' + tk }, body: fs.readFileSync(FILE, 'utf8'),
    });
    const body = await res.text();
    if (!res.ok) throw new Error('反映に失敗（ルールは変わっていません）: ' + res.status + ' ' + body);
    console.log('反映しました: ' + body);
  } else {
    throw new Error('pull か push を指定してください');
  }
})().catch(e => { console.error(e.message || e); process.exit(1); });
