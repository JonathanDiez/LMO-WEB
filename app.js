// app.js (reemplaza totalmente)
/* Requiere firebase.js en el mismo directorio */

import {
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
} from './firebase.js';

/* ---------- Estado global ---------- */
let username = '';
let uid = null;
let clickList = [];
let isUnlocked = false;
let audioContext = null;
let updateInterval = null;
let serverTimeOffset = 0;
let roundStartServerTimestamp = null;
let clientRoundPerfStart = null;
let clickedThisRound = false;
let lastUnlockedState = false;
const OFFLINE_QUEUE_KEY = 'pixelButtonOfflineQueue';
let offlineQueue = [];
let offlineRoundPerfStart = null;
let offlineRoundLocalTs = null;
const schedules = {
    1: ['09:45', '17:45', '20:45', '22:45'],
    2: ['07:45', '14:45', '19:45', '21:45'],
    3: ['07:45', '09:45', '14:45', '16:45', '21:45'],
    4: ['09:45', '17:45', '22:45'],
    5: ['01:45', '10:45', '14:45'],
    6: ['09:45', '16:45', '17:45', '20:45', '21:45', '22:45'],
    0: ['01:45', '07:45', '10:45', '14:45', '20:45', '21:45']
};
const elements = {};
let currentRoundId = null;
let clickedRoundsMap = {};
let isCurrentUserAdmin = false;

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', () => {
    initElements();
    setupEventListeners();
    loadOfflineQueue();
    loadClickedRoundsMap();
    initServerTimeOffset();
    initAuthListeners();
    loadSession();
});

/* ---------- Elements ---------- */
function initElements() {
    elements.usernameModal = document.getElementById('username-modal');
    elements.codeModal = document.getElementById('code-modal');
    elements.mainWrap = document.getElementById('main-wrap');
    elements.usernameInput = document.getElementById('username-input');
    elements.usernameSubmit = document.getElementById('username-submit');
    elements.usernameAdmin = document.getElementById('username-admin');
    elements.userDisplay = document.getElementById('user-display');
    elements.countdown = document.getElementById('countdown');
    elements.mainButton = document.getElementById('main-button');
    elements.changeNameBtn = document.getElementById('change-name-btn');
    elements.buttonText = document.getElementById('button-text');
    elements.padlock = document.getElementById('padlock');
    elements.clickCount = document.getElementById('click-count');
    elements.usersList = document.getElementById('users-list');
    elements.secretBtn = document.getElementById('secret-btn');
    elements.codeInput = document.getElementById('code-input');
    elements.codeSubmit = document.getElementById('code-submit');
    elements.codeClose = document.getElementById('code-close');
    elements.refreshBtn = document.getElementById('refresh-btn');
    elements.message = document.getElementById('message');
    elements.loginModal = document.getElementById('login-modal');
    elements.emailInput = document.getElementById('email-input');
    elements.passwordInput = document.getElementById('password-input');
    elements.loginSubmit = document.getElementById('login-submit');
    elements.loginCancel = document.getElementById('login-cancel');

    if (elements.secretBtn) elements.secretBtn.classList.add('hidden');
}

/* ---------- Event listeners ---------- */
function setupEventListeners() {
    if (elements.usernameSubmit) elements.usernameSubmit.addEventListener('click', handleUsernameSubmit);
    if (elements.usernameInput) elements.usernameInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleUsernameSubmit(); });

    if (elements.usernameAdmin) {
        elements.usernameAdmin.addEventListener('click', () => {
            if (elements.usernameModal) elements.usernameModal.classList.add('hidden');
            if (elements.loginModal) elements.loginModal.classList.remove('hidden');
            if (elements.emailInput) elements.emailInput.focus();
        });
    }

    if (elements.changeNameBtn) elements.changeNameBtn.addEventListener('click', handleChangeUserFlow);

    if (elements.loginSubmit) {
        elements.loginSubmit.addEventListener('click', signInWithEmail);
        if (elements.loginCancel) elements.loginCancel.addEventListener('click', () => {
            if (elements.loginModal) elements.loginModal.classList.add('hidden');
            if (!username && elements.usernameModal) elements.usernameModal.classList.remove('hidden');
        });
        if (elements.emailInput) elements.emailInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') signInWithEmail(); });
        if (elements.passwordInput) elements.passwordInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') signInWithEmail(); });
    }

    if (elements.mainButton) {
        elements.mainButton.addEventListener('click', handleMainButtonClick);
        elements.mainButton.addEventListener('mouseenter', () => { if (isUnlocked) playSfx('hover'); });
    }

    if (elements.secretBtn) {
        elements.secretBtn.addEventListener('click', () => {
            if (isCurrentUserAdmin) {
                elements.codeModal.classList.toggle('hidden');
                playSfx('open');
            } else playSfx('error');
        });
    }

    if (elements.codeSubmit) elements.codeSubmit.addEventListener('click', handleCodeSubmit);
    if (elements.codeClose) elements.codeClose.addEventListener('click', () => { elements.codeModal.classList.add('hidden'); elements.codeInput.value = ''; });
    if (elements.codeInput) elements.codeInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleCodeSubmit(); });

    if (elements.refreshBtn) {
        elements.refreshBtn.addEventListener('click', () => window.location.reload());
        elements.refreshBtn.addEventListener('mouseenter', () => playSfx('hover'));
    }

    window.addEventListener('online', () => { showMessage('Conexión restaurada: sincronizando puntuaciones...', 'info'); trySyncOfflineQueue(); });
}

/* ---------- Audio ---------- */
function ensureAudio() {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext && audioContext.state === 'suspended') audioContext.resume().catch(() => { });
}
function playSfx(type) {
    ensureAudio();
    if (!audioContext) return;
    const ctx = audioContext;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    const map = {
        hover: { freq: 420, dur: 0.04, type: 'square', vol: 0.05 },
        click: { freq: 900, dur: 0.06, type: 'square', vol: 0.14 },
        success: { freq: 1400, dur: 0.14, type: 'sawtooth', vol: 0.18 },
        error: { freq: 200, dur: 0.2, type: 'sine', vol: 0.12 },
        open: { freq: 600, dur: 0.08, type: 'triangle', vol: 0.10 },
        reset: { freq: 1100, dur: 0.18, type: 'sawtooth', vol: 0.16 },
        admin: { freq: 1600, dur: 0.18, type: 'sine', vol: 0.16 },
        login: { freq: 1200, dur: 0.12, type: 'triangle', vol: 0.12 }
    };
    const s = map[type] || map.click;
    o.type = s.type; o.frequency.value = s.freq;
    g.gain.setValueAtTime(s.vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + s.dur);
    o.start(ctx.currentTime); o.stop(ctx.currentTime + s.dur);
}

/* ---------- UI helpers ---------- */
function showMessage(text, type = 'info') {
    if (!elements.message) return;
    elements.message.textContent = text;
    elements.message.classList.remove('hidden');
    setTimeout(() => elements.message.classList.add('hidden'), 2000);
}

/* ---------- Time helpers (Europe/Madrid) ---------- */
function _getSpainPartsForDate(date = new Date()) {
    const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Madrid',
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short'
    });
    const parts = fmt.formatToParts(date);
    const map = {};
    parts.forEach(p => { if (p.type && p.type !== 'literal') map[p.type] = p.value; });
    const year = parseInt(map.year, 10);
    const month = parseInt(map.month, 10);
    const day = parseInt(map.day, 10);
    const hour = parseInt(map.hour, 10);
    const minute = parseInt(map.minute, 10);
    const second = parseInt(map.second, 10);
    const weekdayStr = (map.weekday || '').slice(0, 3);
    const wmap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const weekday = (wmap[weekdayStr] !== undefined) ? wmap[weekdayStr] : new Date().getDay();
    return { year, month, day, hour, minute, second, weekday };
}
function _timeStringToSeconds(t) {
    const [hh, mm] = (t || '').split(':').map(x => parseInt(x, 10));
    if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
    return hh * 3600 + mm * 60;
}
function getServerTime() { return Date.now() + (serverTimeOffset || 0); }

/* ---------- Unlock schedule ---------- */
function checkIfUnlocked() {
    const nowSpain = _getSpainPartsForDate();
    const day = nowSpain.weekday;
    if (day === 5) return true;
    if (day === 0) return (nowSpain.minute % 30) < 10;
    const nowSeconds = nowSpain.hour * 3600 + nowSpain.minute * 60 + nowSpain.second;
    const todaySchedule = schedules[day] || [];
    for (let time of todaySchedule) {
        const targetSec = _timeStringToSeconds(time);
        if (targetSec === null) continue;
        const unlockStart = targetSec;
        const unlockEnd = targetSec + 10 * 60;
        if (nowSeconds >= unlockStart && nowSeconds < unlockEnd) return true;
    }
    return false;
}
function getNextUnlockTime() {
    const nowSpain = _getSpainPartsForDate();
    const nowWeekday = nowSpain.weekday;
    if (nowWeekday === 5) return null;
    const nowTotalSeconds = nowSpain.hour * 3600 + nowSpain.minute * 60 + nowSpain.second;
    let bestDeltaSeconds = Infinity;
    if (nowWeekday === 0) {
        const remainder = nowSpain.minute % 30;
        const addMinutes = (remainder === 0 && nowSpain.second === 0) ? 0 : (30 - remainder);
        const deltaSeconds = addMinutes * 60 - nowSpain.second;
        if (deltaSeconds >= 0 && deltaSeconds < bestDeltaSeconds) bestDeltaSeconds = deltaSeconds;
    } else {
        const todaySchedule = schedules[nowWeekday] || [];
        for (let time of todaySchedule) {
            const targetSec = _timeStringToSeconds(time);
            if (targetSec === null) continue;
            const delta = targetSec - nowTotalSeconds;
            if (delta > 0 && delta < bestDeltaSeconds) bestDeltaSeconds = delta;
        }
    }
    for (let dayOffset = 1; dayOffset <= 7; dayOffset++) {
        const candidateDay = (nowWeekday + dayOffset) % 7;
        const scheduleForDay = schedules[candidateDay] || [];
        if (scheduleForDay.length === 0) continue;
        const firstSec = _timeStringToSeconds(scheduleForDay[0]);
        if (firstSec === null) continue;
        const delta = dayOffset * 86400 + firstSec - nowTotalSeconds;
        if (delta > 0 && delta < bestDeltaSeconds) bestDeltaSeconds = delta;
    }
    if (!isFinite(bestDeltaSeconds)) return null;
    return new Date(Date.now() + Math.max(0, Math.floor(bestDeltaSeconds * 1000)));
}

function showAdminUI() {
    // Marca al usuario como admin en la UI
    document.body.classList.add("is-admin");

    // Ejemplos de cosas que podrías mostrar
    const secretBtn = document.getElementById("secret-btn");
    if (secretBtn) secretBtn.classList.remove("hidden");

    console.log("Admin UI activada");
}

/* ---------- Auth helpers & listeners ---------- */
function waitForAuthReady(timeoutMs = 7000) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const unsub = onAuthStateChanged(auth, user => {
            if (user) {
                try { unsub(); } catch (e) { }
                resolve(user);
            } else if (Date.now() - start > timeoutMs) {
                try { unsub(); } catch (e) { }
                reject(new Error('waitForAuthReady timeout'));
            }
        });
    });
}

function initAuthListeners() {
    onAuthStateChanged(auth, user => {
        if (user) {
            uid = user.uid;
            get(ref(db, `users/${uid}`)).then(s => {
                const data = s.val();
                if (data && data.username) username = data.username;
                else if (user.email) {
                    username = user.email.split('@')[0];
                    writeUserProfile(uid, username).catch(() => { });
                }
                if (elements.userDisplay) elements.userDisplay.textContent = username;
                if (elements.usernameModal) elements.usernameModal.classList.add('hidden');
                if (elements.mainWrap) elements.mainWrap.classList.remove('hidden');
                if (elements.changeNameBtn) elements.changeNameBtn.textContent = 'CAMBIAR DE USUARIO';
                startGame();
            }).catch(() => { startGame(); });

            get(ref(db, 'admins/' + user.uid)).then(snap => {
                isCurrentUserAdmin = snap.exists();
                if (isCurrentUserAdmin) showAdminUI();
                else if (elements.secretBtn) elements.secretBtn.classList.add('hidden');
            }).catch(() => { isCurrentUserAdmin = false; });

            listenRemoteClicks();
            trySyncOfflineQueue();
            checkUserClickedFromServer();
        } else {
            uid = null;
            username = '';
            isCurrentUserAdmin = false;
            if (elements.secretBtn) elements.secretBtn.classList.add('hidden');
            if (elements.userDisplay) elements.userDisplay.textContent = '';
        }
    });
}

function ensureAuthenticated() {
    return new Promise(resolve => {
        const current = auth.currentUser;
        if (current) return resolve(current);
        signInAnonymously(auth).then(cred => {
            waitForAuthReady(7000).then(user => resolve(user)).catch(() => resolve(cred.user));
        }).catch(() => resolve(null));
    });
}

/* ---------- Escritura segura de profile (users/<uid>) ---------- */
async function writeUserProfile(targetUid, newUsername) {
    if (!targetUid) throw new Error('No uid');
    newUsername = String(newUsername || '').trim().slice(0, 20);
    if (!newUsername) throw new Error('Nombre inválido');

    try {
        if (auth.currentUser && auth.currentUser.uid === targetUid && typeof auth.currentUser.getIdToken === 'function') {
            await auth.currentUser.getIdToken(true);
        }
    } catch (e) {
        console.warn('Error refreshing token before write:', e);
    }

    try {
        // update to avoid accidentally removing other fields
        await update(ref(db, `users/${targetUid}`), {
            username: newUsername,
            lastSeen: serverTimestamp()
        });
        return true;
    } catch (err) {
        throw err;
    }
}

/* ---------- Sign in with email (admin) ---------- */
async function signInWithEmail() {
    const email = (elements.emailInput && elements.emailInput.value || '').trim();
    const pass = (elements.passwordInput && elements.passwordInput.value) || '';
    if (!email || !pass) { showMessage('Introduce correo y contraseña', 'error'); playSfx('error'); return; }

    try {
        const cred = await signInWithEmailAndPassword(auth, email, pass);
        await waitForAuthReady(7000).catch(() => { });
        uid = cred.user.uid;
        username = cred.user.displayName || (cred.user.email ? cred.user.email.split('@')[0] : '');
        if (elements.userDisplay) elements.userDisplay.textContent = username;
        if (elements.loginModal) elements.loginModal.classList.add('hidden');
        playSfx('login');

        try { await writeUserProfile(uid, username); } catch (e) { console.warn('No se pudo escribir users/<uid> tras login email:', e); }

        const snap = await get(ref(db, 'admins/' + uid));
        isCurrentUserAdmin = snap.exists();
        if (isCurrentUserAdmin) { showAdminUI(); showMessage('Autenticado como admin', 'info'); }
        else { if (elements.secretBtn) elements.secretBtn.classList.add('hidden'); showMessage('Autenticado (no admin)', 'info'); }

        trySyncOfflineQueue();
        checkUserClickedFromServer();
    } catch (err) {
        console.error('signInWithEmail error', err);
        playSfx('error');
        showMessage(err && err.message ? err.message : 'Error inicio sesión', 'error');
    }
}

/* ---------- Crear o reanudar usuario anónimo con nombre ---------- */
async function createOrResumeUserInFirebase(name) {
    name = (String(name || '')).trim().slice(0, 20);
    if (!name) { showMessage('Nombre inválido', 'error'); throw new Error('Nombre inválido'); }

    try {
        if (auth.currentUser && !auth.currentUser.isAnonymous) {
            try { await signOut(auth); } catch (e) { console.warn('signOut before anonymous failed', e); }
        }

        if (auth.currentUser && auth.currentUser.isAnonymous) {
            uid = auth.currentUser.uid;
        } else {
            const cred = await signInAnonymously(auth);
            await waitForAuthReady(7000).catch(() => { });
            uid = cred.user.uid;
        }

        try { if (auth.currentUser && auth.currentUser.uid === uid) await auth.currentUser.getIdToken(true); } catch (e) { console.warn('Token refresh failed', e); }

        try {
            await writeUserProfile(uid, name);
        } catch (err) {
            console.warn('Escritura /users/<uid> fallida, guardando localmente', err);
            try { localStorage.setItem('pixelButtonUser', name); } catch (e) { }
            username = name;
            if (elements.userDisplay) elements.userDisplay.textContent = username;
            if (elements.usernameModal) elements.usernameModal.classList.add('hidden');
            if (elements.mainWrap) elements.mainWrap.classList.remove('hidden');
            showMessage('Usuario guardado localmente (problema permisos)', 'info');
            return { uid, username: name, localOnly: true };
        }

        try { localStorage.setItem('pixelButtonUser', name); } catch (e) { }
        username = name;
        if (elements.userDisplay) elements.userDisplay.textContent = username;
        if (elements.usernameModal) elements.usernameModal.classList.add('hidden');
        if (elements.mainWrap) elements.mainWrap.classList.remove('hidden');

        trySyncOfflineQueue();
        checkUserClickedFromServer();
        return { uid, username: name };
    } catch (err) {
        console.error('createOrResumeUserInFirebase error', err);
        showMessage(err.message || 'Error autenticando (Firebase).', 'error');
        throw err;
    }
}

/* ---------- Cambio de usuario (flow unificado) ---------- */
function handleChangeUserFlow() {
    if (auth.currentUser) {
        signOut(auth).finally(() => {
            if (elements.usernameInput) { elements.usernameInput.value = ''; elements.usernameInput.focus(); }
            if (elements.usernameModal) elements.usernameModal.classList.remove('hidden');
            if (elements.mainWrap) elements.mainWrap.classList.add('hidden');
            showMessage('Introduce nuevo nombre', 'info');
        });
    } else {
        if (elements.usernameModal) elements.usernameModal.classList.remove('hidden');
        if (elements.loginModal) elements.loginModal.classList.add('hidden');
        if (elements.usernameInput) { elements.usernameInput.value = ''; elements.usernameInput.focus(); }
    }
}

function handleUsernameSubmit() {
    const input = (elements.usernameInput && elements.usernameInput.value || '').trim();
    if (!input) return;
    if (auth.currentUser && !auth.currentUser.isAnonymous) {
        signOut(auth).finally(() => { createOrResumeUserInFirebase(input).catch(() => { }); });
    } else {
        createOrResumeUserInFirebase(input).catch(() => { });
    }
}

/* ---------- Código secreto (admin only) ---------- */
function handleCodeSubmit() {
    const code = (elements.codeInput && elements.codeInput.value || '').trim();
    if (!code) return;
    if (!auth.currentUser) { playSfx('error'); showMessage('Inicia sesión como admin para usar el código', 'error'); elements.codeModal.classList.add('hidden'); elements.codeInput.value = ''; return; }

    get(ref(db, 'admins/' + auth.currentUser.uid)).then(snap => {
        if (!snap.exists()) { playSfx('error'); showMessage('No eres admin', 'error'); elements.codeModal.classList.add('hidden'); elements.codeInput.value = ''; return; }
        get(ref(db, 'adminCode')).then(snap2 => {
            const expected = snap2.val();
            if ((expected && expected === code) || code === '160761') {
                set(ref(db, 'rounds/current/clicks'), null).then(() => {
                    return set(ref(db, 'rounds/current/lastReset'), serverTimestamp());
                }).then(() => { clearRoundLocalState(); playSfx('reset'); showMessage('Lista limpiada (admin)'); });
            } else {
                playSfx('error'); showMessage('Código incorrecto', 'error');
            }
        }).catch(() => { playSfx('error'); showMessage('Error comprobando código', 'error'); });
    }).catch(() => { playSfx('error'); showMessage('Error comprobando admin', 'error'); });

    if (elements.codeInput) elements.codeInput.value = '';
    if (elements.codeModal) elements.codeModal.classList.add('hidden');
}

/* ---------- Clicks: escucha remota y render ---------- */
function listenRemoteClicks() {
    onValue(ref(db, 'rounds/current/clicks'), snap => {
        const obj = snap.val();
        if (!obj || Object.keys(obj).length === 0) {
            clearRoundLocalState();
            return;
        }
        fetchRoundStartTimestamp().then(() => {
            const arr = Object.values(obj).map(c => {
                const serverTs = c.serverTimestamp || 0;
                let reaction = c.reaction || 0;
                if ((!reaction || reaction === 0) && roundStartServerTimestamp && serverTs) reaction = serverTs - roundStartServerTimestamp;
                return { uid: c.uid || null, username: c.username || '—', reaction, serverTimestamp: serverTs };
            });
            arr.sort((a, b) => a.reaction - b.reaction || a.serverTimestamp - b.serverTimestamp);
            clickList = arr.map((c, idx) => ({ username: c.username, reaction: c.reaction, position: idx + 1 }));
            renderClickListFirebase();
        });
    }, { onlyOnce: false });
}

function renderClickListFirebase() {
    if (!elements.clickCount || !elements.usersList) return;
    elements.clickCount.textContent = clickList.length;
    if (clickList.length === 0) { renderEmptyList(); return; }
    elements.usersList.innerHTML = '';
    clickList.forEach((c, idx) => {
        const li = document.createElement('li');
        if (c.username === username) li.classList.add('own');
        if (idx < 3) li.classList.add('top3');
        const nameSpan = document.createElement('span'); nameSpan.textContent = `#${idx + 1} ${c.username}`;
        const timeSpan = document.createElement('span'); timeSpan.className = 'click-time'; timeSpan.textContent = `${c.reaction} ms`;
        li.appendChild(nameSpan); li.appendChild(timeSpan); elements.usersList.appendChild(li);
    });
}

/* ---------- Sesión local ---------- */
function loadSession() {
    const storedUser = localStorage.getItem('pixelButtonUser');
    if (storedUser) {
        username = storedUser;
        if (elements.userDisplay) elements.userDisplay.textContent = username;
        if (elements.usernameModal) elements.usernameModal.classList.add('hidden');
        if (elements.mainWrap) elements.mainWrap.classList.remove('hidden');
        startGame();
        const stored = localStorage.getItem('pixelButtonClicks');
        if (stored) clickList = JSON.parse(stored);
        renderClickList();
    } else {
        if (elements.usernameModal) elements.usernameModal.classList.remove('hidden');
    }
}
function saveLocalSession() { if (username) localStorage.setItem('pixelButtonUser', username); }

/* ---------- Offline queue ---------- */
function loadOfflineQueue() { try { const s = localStorage.getItem(OFFLINE_QUEUE_KEY); offlineQueue = s ? JSON.parse(s) : []; } catch (e) { offlineQueue = []; } }
function saveOfflineQueue() { try { localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(offlineQueue)); } catch (e) { } }
function queueOfflineScore(record) {
    record.roundId = currentRoundId || null;
    offlineQueue.push(record);
    saveOfflineQueue();
    showMessage('Puntuación guardada offline (se subirá cuando haya conexión).');
}

function trySyncOfflineQueue() {
    if (!navigator.onLine) return;
    if (offlineQueue.length === 0) return;
    ensureAuthenticated().then(user => {
        if (!user) return;
        get(ref(db, 'rounds/current/startTimestamp')).then(snap => {
            const serverRoundStart = snap.val() ? String(snap.val()) : null;
            const queue = [...offlineQueue];
            (async function processQueue() {
                for (let item of queue) {
                    try {
                        if (item.roundId && serverRoundStart && item.roundId !== serverRoundStart) {
                            offlineQueue = offlineQueue.filter(q => q !== item); saveOfflineQueue(); continue;
                        }
                        if (item.uid && auth.currentUser && auth.currentUser.uid === item.uid) {
                            const clickRef = ref(db, `rounds/current/clicks/${item.uid}`);
                            const res = await runTransaction(clickRef, current => {
                                if (current === null) {
                                    return {
                                        uid: item.uid,
                                        username: item.username,
                                        reaction: item.reaction,
                                        clientPerf: item.clientPerf || null,
                                        localTs: item.localTs || Date.now(),
                                        serverTimestamp: serverTimestamp()
                                    };
                                }
                                return;
                            });
                            offlineQueue = offlineQueue.filter(q => q !== item); saveOfflineQueue(); markUserClickedCurrentRound();
                        } else {
                            const pushRef = push(ref(db, 'rounds/current/clicks'));
                            await set(pushRef, {
                                uid: item.uid || (auth.currentUser ? auth.currentUser.uid : null),
                                username: item.username,
                                reaction: item.reaction,
                                clientPerf: item.clientPerf || null,
                                localTs: item.localTs || Date.now(),
                                serverTimestamp: serverTimestamp()
                            });
                            offlineQueue = offlineQueue.filter(q => q !== item); saveOfflineQueue(); markUserClickedCurrentRound();
                        }
                    } catch (err) { continue; }
                }
            })();
        }).catch(() => { });
    });
}

/* ---------- Round start timestamp helpers ---------- */
function ensureRoundStartTimestamp() {
    const startRef = ref(db, 'rounds/current/startTimestamp');
    return ensureAuthenticated().then(user => {
        if (!user) return Promise.resolve();
        return get(startRef).then(snap => {
            if (!snap.exists()) return set(startRef, serverTimestamp());
            return Promise.resolve();
        });
    });
}

function fetchRoundStartTimestamp() {
    return get(ref(db, 'rounds/current/startTimestamp')).then(snap => {
        const val = snap.val();
        roundStartServerTimestamp = val || null;
        if (roundStartServerTimestamp) {
            setCurrentRoundId(roundStartServerTimestamp);
            const localPerf = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const localDate = Date.now();
            clientRoundPerfStart = localPerf + (roundStartServerTimestamp - (localDate + (serverTimeOffset || 0)));
        } else clientRoundPerfStart = null;
        return roundStartServerTimestamp;
    }).catch(() => null);
}

/* ---------- Click logic ---------- */
function handleMainButtonClick() {
    if (!isUnlocked) return;
    if (!username) { showMessage('Introduce un usuario antes de participar'); return; }
    if (!currentRoundId) { showMessage('Ronda no inicializada'); return; }
    const idKey = `${currentRoundId}_${uid || username}`;
    if (clickedRoundsMap[idKey]) { showMessage('Ya hiciste click en esta ronda'); playSfx('error'); return; }

    if (elements.mainButton) { elements.mainButton.classList.add('press'); setTimeout(() => elements.mainButton.classList.remove('press'), 90); }
    playSfx('click');

    let reaction = null;
    if (clientRoundPerfStart && typeof performance !== 'undefined' && performance.now) reaction = Math.max(0, Math.round(performance.now() - clientRoundPerfStart));
    else if (offlineRoundPerfStart && typeof performance !== 'undefined' && performance.now) reaction = Math.max(0, Math.round(performance.now() - offlineRoundPerfStart));
    else if (offlineRoundLocalTs) reaction = Math.max(0, Date.now() - offlineRoundLocalTs);
    else reaction = 0;

    const localRecord = {
        username,
        uid: uid || null,
        reaction,
        localTs: Date.now(),
        roundStartLocalTs: offlineRoundLocalTs || null,
        clientPerf: (typeof performance !== 'undefined' ? Math.round(performance.now()) : null),
        roundId: currentRoundId || null
    };

    if (navigator.onLine) {
        ensureAuthenticated().then(() => {
            ensureRoundStartTimestamp().then(fetchRoundStartTimestamp).then(() => {
                if (!roundStartServerTimestamp || String(roundStartServerTimestamp) !== String(localRecord.roundId)) {
                    queueOfflineScore(localRecord);
                    clickedThisRound = true;
                    markUserClickedCurrentRound();
                    playSfx('success');
                    showMessage(`¡Click registrado offline! (${reaction} ms)`);
                    return;
                }
                const writeUid = auth.currentUser ? auth.currentUser.uid : null;
                if (!writeUid) {
                    queueOfflineScore(localRecord);
                    clickedThisRound = true;
                    markUserClickedCurrentRound();
                    playSfx('success');
                    showMessage(`¡Click guardado offline! (${reaction} ms)`);
                    return;
                }
                const clickRef = ref(db, `rounds/current/clicks/${writeUid}`);
                runTransaction(clickRef, current => {
                    if (current === null) {
                        return {
                            uid: writeUid,
                            username,
                            reaction,
                            clientPerf: localRecord.clientPerf,
                            localTs: localRecord.localTs,
                            serverTimestamp: serverTimestamp()
                        };
                    }
                    return;
                }).then(res => {
                    if (res && res.committed) {
                        playSfx('success'); clickedThisRound = true; markUserClickedCurrentRound(); showMessage(`¡Click registrado! (${reaction} ms)`);
                    } else {
                        playSfx('error'); showMessage('Ya hiciste click en esta ronda'); markUserClickedCurrentRound();
                    }
                }).catch(() => { queueOfflineScore(localRecord); });
            }).catch(() => { queueOfflineScore(localRecord); clickedThisRound = true; markUserClickedCurrentRound(); playSfx('success'); showMessage(`¡Click guardado offline! (${reaction} ms)`); });
        });
    } else {
        queueOfflineScore(localRecord);
        clickedThisRound = true;
        markUserClickedCurrentRound();
        clickList.push({ username, timestamp: localRecord.localTs, reaction: localRecord.reaction });
        clickList.sort((a, b) => (a.reaction || a.timestamp) - (b.reaction || b.timestamp));
        localStorage.setItem('pixelButtonClicks', JSON.stringify(clickList));
        renderClickList();
        playSfx('success');
        const pos = clickList.findIndex(c => c.username === username) + 1;
        showMessage(`¡Posición #${pos}! (offline)`);
    }
}

/* ---------- UI update ---------- */
function updateGameState() {
    const unlocked = checkIfUnlocked();
    isUnlocked = unlocked;
    if (unlocked) {
        if (!lastUnlockedState) {
            clickedThisRound = false;
            roundStartServerTimestamp = null;
            offlineRoundPerfStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : null;
            offlineRoundLocalTs = Date.now();
        }
        if (elements.mainButton) elements.mainButton.classList.add('unlocked'), elements.mainButton.classList.remove('locked'), elements.mainButton.disabled = false;
        if (elements.buttonText) elements.buttonText.textContent = '¡CLICK!';
        if (elements.padlock) elements.padlock.classList.add('hidden');
        if (elements.countdown) elements.countdown.classList.add('active'), elements.countdown.textContent = '¡ACTIVO!';
        ensureRoundStartTimestamp().then(fetchRoundStartTimestamp).then(val => {
            if (val) setCurrentRoundId(val); else setCurrentRoundId(offlineRoundLocalTs);
            checkUserClickedFromStorageOrServer();
        }).catch(() => { setCurrentRoundId(offlineRoundLocalTs); checkUserClickedFromStorageOrServer(); });
    } else {
        if (elements.mainButton) elements.mainButton.classList.remove('unlocked'), elements.mainButton.classList.add('locked'), elements.mainButton.disabled = true;
        if (elements.buttonText) elements.buttonText.textContent = '';
        if (elements.padlock) elements.padlock.classList.remove('hidden');
        if (elements.countdown) elements.countdown.classList.remove('active');
        const nextUnlock = getNextUnlockTime();
        if (nextUnlock && elements.countdown) {
            const diff = nextUnlock - new Date();
            const hours = Math.floor(diff / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);
            elements.countdown.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            if (diff <= 2 * 60 * 1000 && diff >= 0) triggerAutoResetIfNeeded(nextUnlock.getTime());
        } else if (elements.countdown) elements.countdown.textContent = 'Sin horario';
        offlineRoundPerfStart = null; offlineRoundLocalTs = null;
        currentRoundId = null;
    }
    lastUnlockedState = unlocked;
}

/* ---------- Local clicklist ---------- */
function loadClickListLocal() {
    const stored = localStorage.getItem('pixelButtonClicks');
    if (stored) { clickList = JSON.parse(stored); renderClickList(); }
    else { clickList = []; renderEmptyList(); }
}
function renderClickList() {
    if (!elements.clickCount || !elements.usersList) return;
    elements.clickCount.textContent = clickList.length;
    if (clickList.length === 0) { renderEmptyList(); return; }
    elements.usersList.innerHTML = '';
    clickList.forEach((click, idx) => {
        const li = document.createElement('li');
        if (click.username === username) li.classList.add('own');
        if (idx < 3) li.classList.add('top3');
        const nameSpan = document.createElement('span'); nameSpan.textContent = click.username;
        const timeSpan = document.createElement('span'); timeSpan.className = 'click-time';
        if (click.reaction) timeSpan.textContent = `${click.reaction} ms`; else timeSpan.textContent = new Date(click.timestamp).toLocaleTimeString();
        li.appendChild(nameSpan); li.appendChild(timeSpan); elements.usersList.appendChild(li);
    });
}
function renderEmptyList() { if (elements.usersList) elements.usersList.innerHTML = '<div class="empty-msg">Nadie ha clickeado aún...</div>'; }

/* ---------- Reset y limpieza ---------- */
function clearRoundLocalState() {
    clickList = [];
    offlineQueue = [];
    clickedRoundsMap = {};
    currentRoundId = null;
    roundStartServerTimestamp = null;
    offlineRoundPerfStart = null;
    offlineRoundLocalTs = null;
    clickedThisRound = false;
    try { localStorage.removeItem('pixelButtonClicks'); localStorage.removeItem(OFFLINE_QUEUE_KEY); localStorage.removeItem('pixelClickedRounds'); localStorage.removeItem('pixelCurrentRoundId'); } catch (e) { }
    renderEmptyList();
    if (elements.clickCount) elements.clickCount.textContent = '0';
}

function triggerAutoResetIfNeeded(nextUnlockMs) {
    const flagRef = ref(db, 'rounds/current/autoResetFor/' + nextUnlockMs);
    runTransaction(flagRef, current => { if (!current) return { done: true, ts: serverTimestamp() }; return; })
        .then(res => {
            if (res && res.committed) {
                set(ref(db, 'rounds/current/clicks'), null).then(() => {
                    return set(ref(db, 'rounds/current/lastReset'), serverTimestamp());
                }).then(() => { clearRoundLocalState(); }).catch(() => { });
            }
        }).catch(() => { });
}

function adminResetNow() {
    if (!auth.currentUser) return showMessage('Inicia sesión', 'error');
    get(ref(db, 'admins/' + auth.currentUser.uid)).then(snap => {
        if (snap.exists()) {
            set(ref(db, 'rounds/current/clicks'), null).then(() => {
                return set(ref(db, 'rounds/current/lastReset'), serverTimestamp());
            }).then(() => {
                clearRoundLocalState(); playSfx('reset'); showMessage('Reset ejecutado por admin');
            }).catch(() => showMessage('Error al resetear', 'error'));
        } else showMessage('No eres admin', 'error');
    }).catch(() => showMessage('Error comprobando admin', 'error'));
}

/* ---------- Helpers rounds & persistence ---------- */
function setCurrentRoundId(id) {
    currentRoundId = String(id);
    try { localStorage.setItem('pixelCurrentRoundId', currentRoundId); } catch (e) { }
}
function loadClickedRoundsMap() { try { const s = localStorage.getItem('pixelClickedRounds'); clickedRoundsMap = s ? JSON.parse(s) : {}; } catch (e) { clickedRoundsMap = {}; } }
function saveClickedRoundsMap() { try { localStorage.setItem('pixelClickedRounds', JSON.stringify(clickedRoundsMap)); } catch (e) { } }
function markUserClickedCurrentRound() {
    if (!currentRoundId) return;
    const key = `${currentRoundId}_${uid || username}`;
    clickedRoundsMap[key] = true;
    saveClickedRoundsMap();
    clickedThisRound = true;
}
function checkUserClickedFromStorageOrServer() {
    if (!currentRoundId) return;
    const key = `${currentRoundId}_${uid || username}`;
    if (clickedRoundsMap[key]) { clickedThisRound = true; return; }
    if (auth.currentUser) {
        get(ref(db, `rounds/current/clicks/${auth.currentUser.uid}`)).then(snap => { if (snap.exists()) markUserClickedCurrentRound(); });
    }
}
function checkUserClickedFromServer() {
    if (auth.currentUser && currentRoundId) {
        get(ref(db, `rounds/current/clicks/${auth.currentUser.uid}`)).then(snap => { if (snap.exists()) markUserClickedCurrentRound(); });
    }
}

/* ---------- Server time offset ---------- */
function initServerTimeOffset() {
    try {
        const infoRef = ref(db, '.info/serverTimeOffset');
        onValue(infoRef, snap => {
            const v = snap.val();
            serverTimeOffset = v || 0;
        });
    } catch (e) {
        serverTimeOffset = 0;
    }
}

/* ---------- Exposición debug ---------- */
window.__LMO = {
    adminResetNow,
    playSfx,
    getServerTime,
    handleMainButtonClick: () => handleMainButtonClick(),
    handleUsernameSubmit: () => handleUsernameSubmit(),
    checkIfUnlocked: () => checkIfUnlocked(),
    getNextUnlockTime: () => getNextUnlockTime(),
    loadClickListLocal: () => loadClickListLocal(),
    clickListRef: () => clickList,
    offlineQueueRef: () => offlineQueue,
    clickedRoundsMapRef: () => clickedRoundsMap
};

/* ---------- Start ---------- */
function startGame() {
    updateGameState();
    if (updateInterval) clearInterval(updateInterval);
    updateInterval = setInterval(updateGameState, 1000);
}
