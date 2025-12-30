// firebase.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
    getAuth,
    onAuthStateChanged,
    signInAnonymously,
    signInWithEmailAndPassword,
    signOut
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-auth.js";
import {
    getDatabase,
    ref,
    set,
    push,
    remove,
    onValue,
    get,
    runTransaction,
    serverTimestamp,
    update
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyBVGeIZpatxXCXVOq1956yMnoh_j2Be9xc",
    authDomain: "orden-lm.firebaseapp.com",
    databaseURL: "https://orden-lm-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "orden-lm",
    storageBucket: "orden-lm.firebasestorage.app",
    messagingSenderId: "486264813568",
    appId: "1:486264813568:web:504c3804c5cbd5e5fd40e5"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

export {
    auth,
    db,
    onAuthStateChanged,
    signInAnonymously,
    signInWithEmailAndPassword,
    signOut,
    ref,
    set,
    push,
    remove,
    onValue,
    get,
    runTransaction,
    serverTimestamp,
    update
};
