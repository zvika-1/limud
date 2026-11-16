// שמירת הנתונים: בענן (Firebase) או מקומית בדפדפן (מצב הדגמה)

const FB = 'https://www.gstatic.com/firebasejs/13.3.0';

/** אחסון מקומי — משמש כשעוד לא הוגדר Firebase */
export class LocalStore {
  constructor() {
    this.key = 'limud-local-tracks';
    this.listeners = [];
  }
  _read() {
    try { return JSON.parse(localStorage.getItem(this.key)) || {}; } catch { return {}; }
  }
  _write(all) {
    localStorage.setItem(this.key, JSON.stringify(all));
    const list = Object.values(all);
    this.listeners.forEach((cb) => cb(list));
  }
  subscribe(cb) {
    this.listeners.push(cb);
    cb(Object.values(this._read()));
    return () => { this.listeners = this.listeners.filter((x) => x !== cb); };
  }
  async saveTrack(t) { const all = this._read(); all[t.id] = t; this._write(all); }
  async deleteTrack(id) { const all = this._read(); delete all[id]; this._write(all); }
  async setLog(id, ds, amount) {
    const all = this._read();
    const t = all[id];
    if (!t) return;
    t.log = t.log || {};
    if (amount) t.log[ds] = amount; else delete t.log[ds];
    this._write(all);
  }
  async replaceAll(tracks) {
    const all = {};
    tracks.forEach((t) => { all[t.id] = t; });
    this._write(all);
  }
}

/** אחסון בענן של Firebase (Firestore), כל משתמש רואה רק את הנתונים שלו */
export class CloudStore {
  constructor(db, fs, uid) {
    this.db = db;
    this.fs = fs;
    this.col = fs.collection(db, 'users', uid, 'tracks');
  }
  subscribe(cb, onError) {
    return this.fs.onSnapshot(
      this.col,
      (snap) => cb(snap.docs.map((d) => d.data())),
      (err) => onError?.(err),
    );
  }
  async saveTrack(t) { await this.fs.setDoc(this.fs.doc(this.col, t.id), t); }
  async deleteTrack(id) { await this.fs.deleteDoc(this.fs.doc(this.col, id)); }
  async setLog(id, ds, amount) {
    await this.fs.updateDoc(this.fs.doc(this.col, id), `log.${ds}`, amount ? amount : this.fs.deleteField());
  }
  async replaceAll(tracks) {
    const snap = await this.fs.getDocs(this.col);
    const batch = this.fs.writeBatch(this.db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    tracks.forEach((t) => batch.set(this.fs.doc(this.col, t.id), t));
    await batch.commit();
  }
}

/** טוען את Firebase ומחזיר פונקציות להתחברות */
export async function initFirebase(config) {
  const [appMod, authMod, fs] = await Promise.all([
    import(`${FB}/firebase-app.js`),
    import(`${FB}/firebase-auth.js`),
    import(`${FB}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(config);
  const auth = authMod.getAuth(app);
  let db;
  try {
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
  } catch {
    db = fs.getFirestore(app);
  }
  return {
    onUser(cb) { return authMod.onAuthStateChanged(auth, cb); },
    async signIn() {
      const provider = new authMod.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await authMod.signInWithPopup(auth, provider);
      } catch (e) {
        if (e?.code === 'auth/popup-blocked' || e?.code === 'auth/operation-not-supported-in-this-environment') {
          await authMod.signInWithRedirect(auth, provider);
        } else if (e?.code !== 'auth/popup-closed-by-user' && e?.code !== 'auth/cancelled-popup-request') {
          throw e;
        }
      }
    },
    signOut() { return authMod.signOut(auth); },
    storeFor(uid) { return new CloudStore(db, fs, uid); },
  };
}
