// הגדרות Firebase של הפרויקט (אלה לא סודות — ההגנה על הנתונים היא בחוקי האבטחה של Firestore)
export const firebaseConfig = {
  apiKey: "AIzaSyDaX2sYYm4B7GjNoIcH8LrFR7dsHTBOaP4",
  authDomain: "limud-yomi-41532.firebaseapp.com",
  projectId: "limud-yomi-41532",
  storageBucket: "limud-yomi-41532.firebasestorage.app",
  messagingSenderId: "998596560359",
  appId: "1:998596560359:web:c071b4b812b6c499926942"
};

// מזהה "Web client ID" של גוגל — נחוץ רק לכניסה עם גוגל מתוך אפליקציית האנדרואיד
// (Firebase → Authentication → Sign-in method → Google → Web SDK configuration → Web client ID)
export const googleWebClientId = '';
