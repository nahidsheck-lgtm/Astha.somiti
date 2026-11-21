import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, setPersistence, browserLocalPersistence,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const OWNER_KEY = 'astha_firebase_local_owner_uid_v1';
const ACCOUNT_BACKUP_PREFIX = 'astha_local_backup_uid_v1_';
const DIRTY_KEY = 'astha_local_dirty_uid_v1';
const status = (message) => {
  const node = document.getElementById('firebaseSettingsStatus');
  if (node) node.textContent = message;
  const loginNode = document.getElementById('firebaseLoginStatus');
  if (loginNode) loginNode.textContent = message;
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const firestore = getFirestore(app);
const provider = new GoogleAuthProvider();
// Do not force account selection on every manual sign-in. Existing Firebase sessions restore silently.
let activeUser = null;
let stopListening = null;
let applyingCloud = false;
let syncTimer = null;
let manualSignInPending = false;
let initialRedirectChecked = false;

window.__asthaFirebaseAuthReady = false;
window.__asthaFirebaseHasUser = false;
function announceAuthReady(hasUser) {
  window.__asthaFirebaseHasUser = !!hasUser;
  window.__asthaFirebaseAuthReady = true;
  window.dispatchEvent(new CustomEvent('astha-firebase-auth-ready', { detail: { hasUser: !!hasUser } }));
}
function localData() {
  return typeof window.getAsthaData === 'function' ? window.getAsthaData() : null;
}
function validData(value) {
  return !!value && typeof value === 'object' && Array.isArray(value.customers);
}
function nonEmptyLocal(data) {
  return !!(data && ((data.customers || []).length || (data.trash || []).length || data.admin || (data.admins || []).length));
}
function emptyAccountData() {
  return { admin: null, admins: [], customers: [], trash: [], cash: { opening: 0, entries: [] }, settings: {} };
}
function cleanData(data) {
  const copy = JSON.parse(JSON.stringify(data ?? {}));
  // Contract files and the optional "more features" module are intentionally removed.
  const strip = (list) => (Array.isArray(list) ? list : []).map((item) => {
    if (!item || typeof item !== 'object') return item;
    const value = { ...item };
    delete value.documents;
    delete value.branchId;
    delete value.customerPin;
    return value;
  });
  copy.customers = strip(copy.customers);
  copy.trash = strip(copy.trash);
  delete copy.branches;
  delete copy.audit;
  delete copy.auditLog;
  if (copy.settings && typeof copy.settings === 'object') {
    delete copy.settings.biometric;
    delete copy.settings.cloudEndpoint;
  }
  return copy;
}
function localOwnerUid() {
  try { return localStorage.getItem(OWNER_KEY) || ''; } catch (_) { return ''; }
}
function setLocalOwnerUid(uid) {
  try { localStorage.setItem(OWNER_KEY, uid); } catch (error) { console.warn('Could not save local account owner marker', error); }
}
function stashLocalForUid(uid) {
  if (!uid) return;
  const data = localData();
  if (!validData(data)) return;
  try { localStorage.setItem(ACCOUNT_BACKUP_PREFIX + uid, JSON.stringify(cleanData(data))); }
  catch (error) { console.warn('Could not preserve this account local copy', error); }
}
function readStashedLocalForUid(uid) {
  if (!uid) return null;
  try { const raw = localStorage.getItem(ACCOUNT_BACKUP_PREFIX + uid); if (!raw) return null; const data = JSON.parse(raw); return validData(data) ? data : null; }
  catch (_) { return null; }
}
function stopCloudListener() {
  if (stopListening) { stopListening(); stopListening = null; }
  if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
}
async function syncNow() {
  if (!activeUser) {
    status('আগে Google / Gmail দিয়ে লগইন করুন।');
    return false;
  }
  if (localOwnerUid() !== activeUser.uid) {
    throw new Error('এই ডিভাইসের স্থানীয় ডেটা অন্য Gmail-এর। নিরাপত্তার জন্য Sync বন্ধ রাখা হয়েছে।');
  }
  const data = localData();
  if (!validData(data)) throw new Error('অ্যাপের গ্রাহক ডেটা পাওয়া যায়নি।');
  const ref = doc(firestore, 'appSettings', activeUser.uid);
  await setDoc(ref, { data: cleanData(data), updatedAt: serverTimestamp(), schemaVersion: 1 }, { merge: true });
  try { if (localStorage.getItem(DIRTY_KEY) === activeUser.uid) localStorage.removeItem(DIRTY_KEY); } catch (_) {}
  status('Firebase-এ সর্বশেষ তথ্য Sync হয়েছে।')
  return true;
}
window.asthaFirebaseSyncNow = async () => {
  try { await syncNow(); alert('Firebase Sync সম্পন্ন হয়েছে।'); }
  catch (error) { console.error(error); alert('Sync হয়নি: ' + (error.message || error)); }
};
window.asthaGoogleSignOut = async () => {
  try {
    stopCloudListener();
    await signOut(auth);
    activeUser = null;
    window.__asthaGoogleUser = null;
    status('Google অ্যাকাউন্ট থেকে লগআউট হয়েছে।');
    announceAuthReady(false);
  } catch (error) { alert('লগআউট হয়নি: ' + (error.message || error)); }
};

async function openUserData(user) {
  stopCloudListener();
  activeUser = user;
  window.__asthaGoogleUser = user;
  status('Google অ্যাকাউন্ট যাচাই হচ্ছে…');
  const ref = doc(firestore, 'appSettings', user.uid);
  const previousOwner = localOwnerUid();
  const local = localData();
  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    // On refresh without a network connection, keep this Gmail's own local data usable.
    if (previousOwner === user.uid && validData(local)) {
      setLocalOwnerUid(user.uid);
      status('ইন্টারনেট সংযোগ নেই; এই Gmail-এর ডিভাইসে থাকা তথ্য দিয়ে চালু হয়েছে। অনলাইনে এলে Sync হবে।');
      if (typeof window.openAsthaAfterGoogleLogin === 'function') window.openAsthaAfterGoogleLogin();
      announceAuthReady(true);
      return true;
    }
    throw error;
  }

  if (snap.exists()) {
    const payload = snap.data();
    if (!validData(payload.data)) throw new Error('Firebase-এ পাওয়া ডেটার কাঠামো সঠিক নয়। ডেটা পরিবর্তন করা হয়নি।');
    let localHasPendingChanges = false;
    try { localHasPendingChanges = localStorage.getItem(DIRTY_KEY) === user.uid && validData(local); } catch (_) {}
    if (localHasPendingChanges) {
      // A save made just before refresh may still be waiting for the 900ms sync.
      // Restore that same-Gmail local copy first so a refresh cannot discard it.
      applyingCloud = true;
      try { window.setAsthaData(cleanData(local)); }
      finally { applyingCloud = false; }
      setLocalOwnerUid(user.uid);
      await syncNow();
      status('রিফ্রেশের আগের অসম্পূর্ণ Sync সম্পন্ন হয়েছে।');
    } else {
      // With no pending local save, the cloud copy is canonical. No repeated prompts.
      applyingCloud = true;
      try { window.setAsthaData(cleanData(payload.data)); }
      finally { applyingCloud = false; }
      setLocalOwnerUid(user.uid);
      status('এই Gmail-এর ক্লাউড হিসাব লোড হয়েছে।');
      // Rewrite once to remove legacy contract blobs and optional-feature data from cloud.
      await syncNow();
    }
  } else {
    let seed = null;
    if (previousOwner === user.uid && validData(local)) seed = local;
    else if (!previousOwner && nonEmptyLocal(local)) seed = local;
    else if (previousOwner && previousOwner !== user.uid) seed = readStashedLocalForUid(user.uid);

    if (seed) {
      applyingCloud = true;
      try { window.setAsthaData(cleanData(seed)); }
      finally { applyingCloud = false; }
      setLocalOwnerUid(user.uid);
      await syncNow();
      status('এই Gmail-এর আগের ডিভাইসের হিসাব ক্লাউডে সংরক্ষিত হয়েছে।');
    } else {
      applyingCloud = true;
      try { window.setAsthaData(emptyAccountData()); }
      finally { applyingCloud = false; }
      setLocalOwnerUid(user.uid);
      await syncNow();
      status('এই Gmail-এর নতুন হিসাব প্রস্তুত।');
    }
  }

  stopListening = onSnapshot(ref, (cloudSnap) => {
    if (!cloudSnap.exists() || applyingCloud || !activeUser || activeUser.uid !== user.uid) return;
    const payload = cloudSnap.data();
    if (!validData(payload.data)) { status('ক্লাউড ডেটার কাঠামো সঠিক নয়; বর্তমান তথ্য রাখা হয়েছে।'); return; }
    applyingCloud = true;
    try {
      window.setAsthaData(cleanData(payload.data));
      setLocalOwnerUid(user.uid);
      if (document.getElementById('app') && !document.getElementById('app').classList.contains('hidden')) {
        window.renderDash?.();
        const activeTab = document.querySelector('nav button.active')?.id || '';
        if (activeTab === 'tabCustomers') window.renderCustomers?.();
      }
      status('এই Gmail-এর নতুন তথ্য Firebase থেকে Sync হয়েছে।');
    } finally { applyingCloud = false; }
  }, (error) => { console.error(error); status('লাইভ Sync বন্ধ: ' + (error.message || error)); });

  if (typeof window.openAsthaAfterGoogleLogin === 'function') window.openAsthaAfterGoogleLogin();
  announceAuthReady(true);
  return true;
}

window.googleSignIn = async function () {
  try {
    if (!firebaseConfig.apiKey || !firebaseConfig.appId || !firebaseConfig.messagingSenderId || String(firebaseConfig.apiKey).includes('YOUR_')) {
      throw new Error('Firebase কনফিগারেশন অসম্পূর্ণ।');
    }
    await setPersistence(auth, browserLocalPersistence);
    manualSignInPending = true;
    status('Google লগইন খুলছে…');
    try {
      const result = await signInWithPopup(auth, provider);
      await openUserData(result.user);
      manualSignInPending = false;
    } catch (popupError) {
      if (popupError.code === 'auth/popup-blocked' || popupError.code === 'auth/operation-not-supported-in-this-environment') {
        await signInWithRedirect(auth, provider);
        return;
      }
      throw popupError;
    }
  } catch (error) {
    manualSignInPending = false;
    console.error(error);
    status('Google/Firebase লগইন হয়নি: ' + (error.message || error));
    alert('Google/Firebase লগইন হয়নি।\n' + (error.message || error) + '\n\nFirebase Console-এ Google Authentication চালু আছে কি না এবং GitHub Pages ডোমেইন অনুমোদিত কি না দেখুন।');
    announceAuthReady(false);
  }
};

function attachSaveSync() {
  if (typeof window.save !== 'function' || window.save.__asthaFirebaseWrapped) return;
  const originalSave = window.save;
  const wrapped = function (...args) {
    const result = originalSave.apply(this, args);
    if (activeUser && !applyingCloud && localOwnerUid() === activeUser.uid) {
      try { localStorage.setItem(DIRTY_KEY, activeUser.uid); } catch (_) {}
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => syncNow().catch((error) => {
        console.error(error); status('ডিভাইসে সংরক্ষিত; Firebase Sync ব্যর্থ: ' + (error.message || error));
      }), 900);
    }
    return result;
  };
  wrapped.__asthaFirebaseWrapped = true;
  window.save = wrapped;
}
attachSaveSync();

// Initialize persistence before the first auth observer. This prevents startup code
// from treating the not-yet-restored session as a signed-out user.
(async function initializeAsthaAuth() {
  try {
    await setPersistence(auth, browserLocalPersistence);
    let redirectUser = null;
    try {
      const redirectResult = await getRedirectResult(auth);
      if (redirectResult && redirectResult.user) redirectUser = redirectResult.user;
    } catch (e) { console.warn('Redirect result check:', e); }
    onAuthStateChanged(auth, async (user) => {
      const resolvedUser = user || redirectUser;
      if (!resolvedUser) {
        activeUser = null;
        stopCloudListener();
        announceAuthReady(false);
        return;
      }
      if (manualSignInPending || activeUser?.uid === resolvedUser.uid) return;
      try {
        await openUserData(resolvedUser);
      } catch (error) {
        console.error(error);
        activeUser = null;
        status('Firebase সংযোগ হয়নি: ' + (error.message || error));
        announceAuthReady(false);
      }
    });
  } catch (error) {
    console.error('Firebase Auth initialization failed:', error);
    status('Google লগইন সেশন প্রস্তুত হয়নি: ' + (error.message || error));
    announceAuthReady(false);
  }
})();
