// שמירת הנתונים: בענן (Firebase) או מקומית בדפדפן (מצב הדגמה)

// ספריות Firebase שמורות בתוך האתר עצמו (תיקיית vendor), כדי שהאפליקציה תעבוד גם בלי אינטרנט
const FB = new URL('../vendor/firebase', import.meta.url).href;

export const isNative = !!window.Capacitor?.isNativePlatform?.();

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
    this.onWriteError = (e) => onError?.(e);
    return this.fs.onSnapshot(
      this.col,
      (snap) => cb(snap.docs.map((d) => d.data())),
      (err) => onError?.(err),
    );
  }
  // כתיבה לענן: Firestore שומר מיד במכשיר ומעדכן את המסך, ושולח לשרת כשיש חיבור.
  // לא מחכים לאישור מהשרת — אחרת בלי אינטרנט הכפתורים "נתקעים" עד שהחיבור חוזר.
  _bg(promise) {
    promise.catch((e) => this.onWriteError?.(e));
  }
  async saveTrack(t) { this._bg(this.fs.setDoc(this.fs.doc(this.col, t.id), t)); }
  async deleteTrack(id) { this._bg(this.fs.deleteDoc(this.fs.doc(this.col, id))); }
  async setLog(id, ds, amount) {
    this._bg(this.fs.updateDoc(this.fs.doc(this.col, id), `log.${ds}`, amount ? amount : this.fs.deleteField()));
  }
  async replaceAll(tracks) {
    const snap = await this.fs.getDocs(this.col);
    const batch = this.fs.writeBatch(this.db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    tracks.forEach((t) => batch.set(this.fs.doc(this.col, t.id), t));
    this._bg(batch.commit());
  }
}

const AUTH_ERRORS = {
  'auth/invalid-credential': 'המייל או הסיסמה שגויים',
  'auth/wrong-password': 'המייל או הסיסמה שגויים',
  'auth/user-not-found': 'המייל או הסיסמה שגויים',
  'auth/invalid-email': 'כתובת המייל לא תקינה',
  'auth/missing-password': 'צריך להקליד סיסמה',
  'auth/weak-password': 'הסיסמה צריכה להכיל לפחות 6 תווים',
  'auth/email-already-in-use': 'כבר יש חשבון עם המייל הזה. אם נכנסת עד עכשיו עם גוגל, היכנס עם גוגל ואז קבע סיסמה במסך ההגדרות.',
  'auth/provider-already-linked': 'כבר קבעת סיסמה לחשבון הזה',
  'auth/credential-already-in-use': 'המייל הזה כבר משויך לחשבון אחר',
  'auth/requires-recent-login': 'מטעמי אבטחה צריך להתנתק, להתחבר מחדש ולנסות שוב',
  'auth/too-many-requests': 'יותר מדי ניסיונות. נסה שוב בעוד כמה דקות',
  'auth/network-request-failed': 'אין חיבור לאינטרנט',
  'auth/operation-not-allowed': 'סוג הכניסה הזה עוד לא הופעל ב-Firebase',
  'auth/unauthorized-domain': 'הכתובת של האתר לא מאושרת ב-Firebase (Authorized domains)',
};

/** הודעת שגיאה בעברית */
export function authErrorText(e) {
  return AUTH_ERRORS[e?.code] || e?.message || String(e);
}

/** טוען את Firebase ומחזיר פונקציות להתחברות */
export async function initFirebase(config, googleWebClientId) {
  const [appMod, authMod, fs] = await Promise.all([
    import(`${FB}/firebase-app.js`),
    import(`${FB}/firebase-auth.js`),
    import(`${FB}/firebase-firestore.js`),
  ]);
  const app = appMod.initializeApp(config);
  // באפליקציית אנדרואיד אין חלונות קופצים, לכן הכניסה עם גוגל נעשית דרך מערכת ההפעלה
  const auth = isNative
    ? authMod.initializeAuth(app, { persistence: [authMod.indexedDBLocalPersistence] })
    : authMod.getAuth(app);
  let db;
  try {
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
  } catch {
    db = fs.getFirestore(app);
  }

  let socialReady = null;
  async function nativeGoogle() {
    if (!googleWebClientId) throw new Error('הכניסה עם גוגל באפליקציה עוד לא הוגדרה. אפשר בינתיים להיכנס עם מייל וסיסמה.');
    // הרכיב של אנדרואיד לכניסה עם גוגל (נבנה מ-app/native-entry.js)
    const { SocialLogin } = await import(new URL('../vendor/capacitor/native.js', import.meta.url).href);
    socialReady ??= SocialLogin.initialize({ google: { webClientId: googleWebClientId, skipAuthOnlyAuthorizationAfterSignIn: true } });
    await socialReady;
    let res;
    try {
      res = await SocialLogin.login({ provider: 'google', options: {} });
    } catch (e) {
      if (/cancel/i.test(e?.message || '')) return;
      if (/no provider dependencies|play services/i.test(e?.message || '')) {
        throw new Error('במכשיר הזה אין שירותי Google Play מעודכנים, ולכן הכניסה עם גוגל לא זמינה בו. אפשר להיכנס עם מייל וסיסמה.');
      }
      throw new Error('הכניסה עם גוגל נכשלה (' + (e?.message || e) + '). אפשר להיכנס עם מייל וסיסמה.');
    }
    const idToken = res?.result?.idToken || res?.idToken;
    if (!idToken) throw new Error('לא התקבל אישור מגוגל');
    await authMod.signInWithCredential(auth, authMod.GoogleAuthProvider.credential(idToken));
  }

  return {
    onUser(cb) { return authMod.onAuthStateChanged(auth, cb); },
    async signIn() {
      if (isNative) return nativeGoogle();
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
    signInEmail(email, password) { return authMod.signInWithEmailAndPassword(auth, email.trim(), password); },
    signUpEmail(email, password) { return authMod.createUserWithEmailAndPassword(auth, email.trim(), password); },
    resetPassword(email) { return authMod.sendPasswordResetEmail(auth, email.trim()); },
    hasPassword() { return !!auth.currentUser?.providerData.some((p) => p.providerId === 'password'); },
    /** קביעת סיסמה לחשבון שנכנס עם גוגל, כדי שאפשר יהיה להיכנס גם עם מייל וסיסמה */
    async setPassword(password) {
      const user = auth.currentUser;
      if (this.hasPassword()) return authMod.updatePassword(user, password);
      return authMod.linkWithCredential(user, authMod.EmailAuthProvider.credential(user.email, password));
    },
    signOut() { return authMod.signOut(auth); },
    storeFor(uid) { return new CloudStore(db, fs, uid); },
    /** רישום המשתמש ברשימת המשתמשים (רק מייל, שם ותאריכים — בלי שום נתון על הלימוד) */
    recordMember(user) {
      const ref = fs.doc(db, 'members', user.uid);
      fs.setDoc(ref, {
        email: user.email || '',
        name: user.displayName || '',
        createdAt: user.metadata?.creationTime ? new Date(user.metadata.creationTime).toISOString() : '',
        lastLogin: fs.serverTimestamp(),
        app: isNative ? 'android' : 'web',
      }, { merge: true }).catch(() => {});
    },
    /** רשימת כל המשתמשים — עובד רק למנהל (לפי חוקי האבטחה) */
    async listMembers() {
      const snap = await fs.getDocs(fs.collection(db, 'members'));
      return snap.docs.map((d) => ({ ...d.data(), lastLogin: d.data().lastLogin?.toDate?.() || null }));
    },
  };
}
