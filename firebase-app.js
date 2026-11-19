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
provider.setCustomParameters({ prompt: 'select_account' });
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
  return { admin: null, admins: [], customers: [], trash: [], cash: { opening: 0, entries: [] }, settings: {}, branches: [], audit: [], auditLog: [] };
}
function cleanData(data) {
  return JSON.parse(JSON.stringify(data ?? {}));
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

function keepSignedInWhenCloudUnavailable(user, error) {
  activeUser = user;
  window.__asthaGoogleUser = user;
  const owner = localOwnerUid();
  // Never show another Gmail's local records under this account.
  if (owner && owner !== user.uid) {
    stashLocalForUid(owner);
    applyingCloud = true;
    try { window.setAsthaData(emptyAccountData()); }
    catch (e) { console.warn('Could not isolate local data for this account', e); }
    finally { applyingCloud = false; }
    setLocalOwnerUid(user.uid);
  }
  status('Gmail লগইন আছে। ক্লাউড সংযোগ সাময়িকভাবে পাওয়া যাচ্ছে না; ইন্টারনেট চালু হলে আবার Sync হবে।');
  console.warn('Firebase session restored; Firestore unavailable:', error);
  if (typeof window.openAsthaAfterGoogleLogin === 'function') window.openAsthaAfterGoogleLogin();
  announceAuthReady(true);
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
  status('Firebase-এ সর্বশেষ তথ্য Sync হয়েছে।');
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
  const snap = await getDoc(ref);
  const previousOwner = localOwnerUid();

  if (snap.exists()) {
    const payload = snap.data();
    if (!validData(payload.data)) throw new Error('Firebase-এ পাওয়া ডেটার কাঠামো সঠিক নয়। ডেটা পরিবর্তন করা হয়নি।');
    applyingCloud = true;
    try { window.setAsthaData(payload.data); }
    finally { applyingCloud = false; }
    setLocalOwnerUid(user.uid);
    status('এই Gmail-এর ক্লাউড হিসাব লোড হয়েছে।');
  } else if (previousOwner && previousOwner !== user.uid) {
    // Preserve the previous account's device copy before switching local storage.
    stashLocalForUid(previousOwner);
    const returningCopy = readStashedLocalForUid(user.uid);
    if (returningCopy) {
      applyingCloud = true;
      try { window.setAsthaData(returningCopy); }
      finally { applyingCloud = false; }
      setLocalOwnerUid(user.uid);
      const upload = confirm('এই Gmail-এর ক্লাউডে হিসাব পাওয়া যায়নি, তবে এই Gmail-এর আগের স্থানীয় কপি পাওয়া গেছে। সেটি ক্লাউডে ফিরিয়ে সংরক্ষণ করবেন?');
      if (!upload) {
        activeUser = null;
        window.__asthaGoogleUser = null;
        await signOut(auth);
        status('লগইন বাতিল হয়েছে; এই Gmail-এর স্থানীয় কপি অক্ষত আছে।');
        announceAuthReady(false);
        return false;
      }
      await syncNow();
    } else {
      // A different Gmail with no cloud data starts empty; never inherit another account's data.
      applyingCloud = true;
      try { window.setAsthaData(emptyAccountData()); }
      finally { applyingCloud = false; }
      setLocalOwnerUid(user.uid);
      status('নতুন Gmail-এর জন্য আলাদা খালি হিসাব তৈরি হয়েছে।');
    }
  } else if (!previousOwner && nonEmptyLocal(localData())) {
    const upload = confirm('এই ডিভাইসে আগে থেকে স্থানীয় হিসাব পাওয়া গেছে, কিন্তু এটি এখনো কোনো Gmail-এর নামে চিহ্নিত নয়।\n\nআপনি কি এই পুরোনো হিসাবটি প্রথমবার এই Gmail-এর ক্লাউডে নিতে চান?\n\nOK = এই Gmail-এ স্থানান্তর\nCancel = লগইন বাতিল; পুরোনো হিসাব অক্ষত থাকবে।');
    if (!upload) {
      activeUser = null;
      window.__asthaGoogleUser = null;
      await signOut(auth);
      status('লগইন বাতিল হয়েছে। পুরোনো স্থানীয় হিসাব অক্ষত আছে।');
      announceAuthReady(false);
      return false;
    }
    setLocalOwnerUid(user.uid);
    await syncNow();
    status('পুরোনো স্থানীয় হিসাব এই Gmail-এর ক্লাউডে সংরক্ষিত হয়েছে।');
  } else {
    // First use on an empty device, or a previously-owned account whose cloud doc was removed.
    if (previousOwner === user.uid && nonEmptyLocal(localData())) {
      const upload = confirm('এই Gmail-এর ক্লাউডে এখনো হিসাব নেই, তবে এই ডিভাইসে একই Gmail-এর স্থানীয় হিসাব পাওয়া গেছে। সেটি ক্লাউডে সংরক্ষণ করবেন?');
      if (!upload) {
        activeUser = null;
        window.__asthaGoogleUser = null;
        await signOut(auth);
        status('লগইন বাতিল হয়েছে; স্থানীয় হিসাব অক্ষত আছে।');
        announceAuthReady(false);
        return false;
      }
      await syncNow();
    } else {
      if (!validData(localData()) || !nonEmptyLocal(localData())) {
        applyingCloud = true;
        try { window.setAsthaData(emptyAccountData()); }
        finally { applyingCloud = false; }
      }
      setLocalOwnerUid(user.uid);
      status('এই Gmail-এর জন্য নতুন আলাদা হিসাব প্রস্তুত।');
    }
  }

  stopListening = onSnapshot(ref, (cloudSnap) => {
    if (!cloudSnap.exists() || applyingCloud || !activeUser || activeUser.uid !== user.uid) return;
    const payload = cloudSnap.data();
    if (!validData(payload.data)) { status('ক্লাউড ডেটার কাঠামো সঠিক নয়; বর্তমান তথ্য রাখা হয়েছে।'); return; }
    applyingCloud = true;
    try {
      window.setAsthaData(payload.data);
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
      try {
        await openUserData(result.user);
      } catch (cloudError) {
        keepSignedInWhenCloudUnavailable(result.user, cloudError);
      }
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
    if (auth.currentUser) {
      keepSignedInWhenCloudUnavailable(auth.currentUser, error);
      return;
    }
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

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    activeUser = null;
    stopCloudListener();
    announceAuthReady(false);
    return;
  }
  if (manualSignInPending || activeUser?.uid === user.uid) return;
  try {
    let resolvedUser = user;
    if (!initialRedirectChecked) {
      initialRedirectChecked = true;
      const redirectResult = await getRedirectResult(auth);
      if (redirectResult?.user) resolvedUser = redirectResult.user;
    }
    await openUserData(resolvedUser);
  } catch (error) {
    // Firebase Auth has restored the Gmail session. A Firestore/network error
    // must not send the user back to the Google login screen.
    keepSignedInWhenCloudUnavailable(user, error);
  }
});
