
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.3.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-auth.js";
import {
  getFirestore
} from "https://www.gstatic.com/firebasejs/13.3.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyC6HhTsOkiKAcS48EVw9eGhcMH1de8-sIs",
  authDomain: "luar-finanzas.firebaseapp.com",
  projectId: "luar-finanzas",
  storageBucket: "luar-finanzas.firebasestorage.app",
  messagingSenderId: "207908898393",
  appId: "1:207908898393:web:15b3e2bb67e09e7cd61348"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
