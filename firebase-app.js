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
let redirectHandled = false;
let manualSignInPending = false;

function localData() {
  return typeof window.getAsthaData === 'function' ? window.getAsthaData() : null;
}
function validData(value) {
  return !!value && typeof value === 'object' && Array.isArray(value.customers);
}
function nonEmptyLocal(data) {
  return !!(data && ((data.customers || []).length || (data.trash || []).length || data.admin));
}
function cleanData(data) {
  // Firestore cannot store undefined values. JSON round-trip also strips functions.
  return JSON.parse(JSON.stringify(data ?? {}));
}
function stopCloudListener() {
  if (stopListening) { stopListening(); stopListening = null; }
}
async function syncNow() {
  if (!activeUser) {
    status('আগে Google / Gmail দিয়ে লগইন করুন।');
    return false;
  }
  const data = localData();
  if (!validData(data)) throw new Error('অ্যাপের গ্রাহক ডেটা পাওয়া যায়নি।');
  const ref = doc(firestore, 'appSettings', activeUser.uid);
  await setDoc(ref, {
    data: cleanData(data),
    updatedAt: serverTimestamp(),
    schemaVersion: 1
  }, { merge: true });
  status('Firebase-এ সর্বশেষ তথ্য Sync হয়েছে।');
  return true;
}
window.asthaFirebaseSyncNow = async () => {
  try { await syncNow(); alert('Firebase Sync সম্পন্ন হয়েছে।'); }
  catch (error) { console.error(error); alert('Sync হয়নি: ' + (error.message || error)); }
};
window.asthaGoogleSignOut = async () => {
  try { await signOut(auth); stopCloudListener(); activeUser = null; status('Google অ্যাকাউন্ট থেকে লগআউট হয়েছে।'); }
  catch (error) { alert('লগআউট হয়নি: ' + (error.message || error)); }
};

async function openUserData(user) {
  activeUser = user;
  window.__asthaGoogleUser = user;
  status('Google অ্যাকাউন্ট যাচাই হচ্ছে…');
  const ref = doc(firestore, 'appSettings', user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const payload = snap.data();
    if (!validData(payload.data)) throw new Error('Firebase-এ পাওয়া ডেটার কাঠামো সঠিক নয়। ডেটা পরিবর্তন করা হয়নি।');
    applyingCloud = true;
    try { window.setAsthaData(payload.data); }
    finally { applyingCloud = false; }
    status('পুরোনো Firebase তথ্য লোড হয়েছে।');
  } else {
    const data = localData();
    if (nonEmptyLocal(data)) {
      const upload = confirm('এই Google অ্যাকাউন্টের Firebase-এ এখনো কোনো অ্যাপ ডেটা পাওয়া যায়নি। এই ডিভাইসের বর্তমান স্থানীয় ডেটা কি প্রথমবার ক্লাউডে সংরক্ষণ করবেন?\n\nনা চাপলে কোনো ডেটা আপলোড হবে না।');
      if (upload) await syncNow();
      else status('স্থানীয় তথ্য অপরিবর্তিত আছে; Firebase-এ এখনো কিছু সংরক্ষণ হয়নি।');
    } else {
      status('এই Firebase অ্যাকাউন্টে এখনো ডেটা নেই। নতুন খালি অ্যাপ খুলছে।');
    }
  }
  stopCloudListener();
  stopListening = onSnapshot(ref, (cloudSnap) => {
    if (!cloudSnap.exists() || applyingCloud) return;
    const payload = cloudSnap.data();
    if (!validData(payload.data)) { status('ক্লাউড ডেটার কাঠামো সঠিক নয়; বর্তমান তথ্য রাখা হয়েছে।'); return; }
    applyingCloud = true;
    try {
      window.setAsthaData(payload.data);
      if (document.getElementById('app') && !document.getElementById('app').classList.contains('hidden')) {
        window.renderDash?.();
        const activeTab = document.querySelector('nav button.active')?.id || '';
        if (activeTab === 'tabCustomers') window.renderCustomers?.();
      }
      status('Firebase থেকে নতুন তথ্য Sync হয়েছে।');
    } finally { applyingCloud = false; }
  }, (error) => { console.error(error); status('লাইভ Sync বন্ধ: ' + (error.message || error)); });
  if (typeof window.openAsthaAfterGoogleLogin === 'function') window.openAsthaAfterGoogleLogin();
}

window.googleSignIn = async function () {
  try {
    if (!firebaseConfig.apiKey || !firebaseConfig.appId || !firebaseConfig.messagingSenderId ||
        String(firebaseConfig.apiKey).includes('YOUR_')) {
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
  }
};

// Keep the app's existing local save behavior, then sync changes to this user's cloud document.
function attachSaveSync() {
  if (typeof window.save !== 'function' || window.save.__asthaFirebaseWrapped) return;
  const originalSave = window.save;
  const wrapped = function (...args) {
    const result = originalSave.apply(this, args);
    if (activeUser && !applyingCloud) {
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => syncNow().catch((error) => {
        console.error(error); status('স্থানীয়ভাবে সংরক্ষিত; Firebase Sync ব্যর্থ: ' + (error.message || error));
      }), 900);
    }
    return result;
  };
  wrapped.__asthaFirebaseWrapped = true;
  window.save = wrapped;
}
attachSaveSync();

onAuthStateChanged(auth, async (user) => {
  if (!user) { activeUser = null; stopCloudListener(); return; }
  // The explicit sign-in handler opens the data. Avoid opening the same session twice.
  if (manualSignInPending || activeUser?.uid === user.uid) return;
  if (redirectHandled) return;
  try {
    const redirectResult = await getRedirectResult(auth);
    if (redirectResult?.user) { redirectHandled = true; await openUserData(redirectResult.user); }
    else {
      // Existing persisted Google session: restore its cloud data automatically.
      redirectHandled = true;
      await openUserData(user);
    }
  } catch (error) { console.error(error); status('Firebase সংযোগ হয়নি: ' + (error.message || error)); }
});
