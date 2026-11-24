import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, setPersistence, browserLocalPersistence,
  signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, updateProfile, updatePassword, verifyBeforeUpdateEmail,
  EmailAuthProvider, reauthenticateWithCredential
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

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
let openingUid = null;
let baseRevision = 0;
let localDirty = false;
let authResolved = false;

window.__asthaFirebaseAuthReady = false;
window.__asthaFirebaseHasUser = false;
function announceAuthReady(hasUser) {
  window.__asthaFirebaseHasUser = !!hasUser;
  window.__asthaFirebaseAuthReady = true;
  authResolved = true;
  window.dispatchEvent(new CustomEvent('astha-firebase-auth-ready', { detail: { hasUser: !!hasUser } }));
}
function status(message) {
  for (const id of ['firebaseSettingsStatus', 'firebaseLoginStatus']) {
    const node = document.getElementById(id);
    if (node) node.textContent = message;
  }
}
function emptyAccountData() {
  return { admin: null, admins: [], customers: [], trash: [], cash: { opening: 0, entries: [] }, settings: {}, branches: [], audit: [], auditLog: [] };
}
function cleanData(data) { return JSON.parse(JSON.stringify(data ?? emptyAccountData())); }
function localData() { return typeof window.getAsthaData === 'function' ? window.getAsthaData() : null; }
function validData(value) { return !!value && typeof value === 'object' && Array.isArray(value.customers); }
function stopCloudListener() {
  if (stopListening) { stopListening(); stopListening = null; }
  if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; }
}

async function syncNow() {
  const user = activeUser;
  if (!user) throw new Error('আগে Gmail দিয়ে লগইন করুন।');
  const data = localData();
  if (!validData(data)) throw new Error('অ্যাপের ডেটা পাওয়া যায়নি।');
  const clean = cleanData(data);
  const bytes = new TextEncoder().encode(JSON.stringify(clean)).length;
  if (bytes > 850 * 1024) throw new Error('ডেটা ৮৫০ KB ছাড়িয়েছে। ছবি কমিয়ে আবার চেষ্টা করুন।');
  const ref = doc(firestore, 'appSettings', user.uid);
  let committedRevision = baseRevision;
  await runTransaction(firestore, async transaction => {
    const latest = await transaction.get(ref);
    const latestRevision = latest.exists() ? Number(latest.data().revision || 0) : 0;
    if (latestRevision !== baseRevision) throw new Error('অন্য ডিভাইসে নতুন পরিবর্তন এসেছে। আগে সর্বশেষ ডেটা যাচাই করুন।');
    committedRevision = latestRevision + 1;
    transaction.set(ref, { uid: user.uid, email: user.email || '', data: clean, updatedAt: serverTimestamp(), schemaVersion: 2, revision: committedRevision });
  });
  baseRevision = committedRevision;
  localDirty = JSON.stringify(localData()) !== JSON.stringify(clean);
  status(localDirty ? 'পরিবর্তন Sync হচ্ছে…' : 'আপনার Gmail অ্যাকাউন্টের ডেটা Sync হয়েছে।');
  if (localDirty) scheduleSync();
  return true;
}
function scheduleSync() {
  if (!activeUser || applyingCloud) return;
  localDirty = true;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow().catch(error => {
    console.error('Astha sync failed', error);
    status('ডিভাইসে সংরক্ষিত; ক্লাউড Sync হয়নি: ' + (error.message || error));
  }), 1100);
}
window.asthaFirebaseSyncNow = async () => {
  try { await syncNow(); alert('আপনার অ্যাকাউন্টের ডেটা Sync হয়েছে।'); }
  catch (error) { console.error(error); alert('Sync হয়নি: ' + (error.message || error)); }
};

async function openUserData(user) {
  if (openingUid === user.uid && activeUser?.uid === user.uid) return;
  openingUid = user.uid;
  stopCloudListener();
  activeUser = user;
  window.__asthaGoogleUser = user;
  status('আপনার Gmail-এর ব্যক্তিগত ডেটা লোড হচ্ছে…');
  try {
    const ref = doc(firestore, 'appSettings', user.uid);
    const snap = await getDoc(ref);
    if (activeUser?.uid !== user.uid) return;
    if (snap.exists()) {
      const payload = snap.data();
      if (!validData(payload.data)) throw new Error('ক্লাউড ডেটার কাঠামো সঠিক নয়।');
      baseRevision = Number(payload.revision || 0);
      localDirty = false;
      applyingCloud = true;
      try { window.setAsthaData(payload.data, user.uid); }
      finally { applyingCloud = false; }
    } else {
      baseRevision = 0;
      localDirty = false;
      applyingCloud = true;
      try { window.setAsthaData(emptyAccountData(), user.uid); }
      finally { applyingCloud = false; }
      // Create an empty account document so each account has its own isolated workspace.
      await syncNow();
    }
    if (activeUser?.uid !== user.uid) return;
    window.openAsthaAfterGoogleLogin?.();
    status('লগইন সফল। ' + (user.email || 'এই Gmail') + ' অ্যাকাউন্টের আলাদা ডেটা চালু আছে।');
    stopListening = onSnapshot(ref, cloudSnap => {
      if (!cloudSnap.exists() || !activeUser || activeUser.uid !== user.uid || applyingCloud) return;
      const payload = cloudSnap.data();
      if (!validData(payload.data)) return;
      const revision = Number(payload.revision || 0);
      if (revision <= baseRevision) return;
      if (localDirty) {
        status('অন্য ডিভাইসে পরিবর্তন আছে। আপনার বর্তমান পরিবর্তন নিরাপদে রাখা হয়েছে; Sync যাচাই প্রয়োজন।');
        return;
      }
      baseRevision = revision;
      applyingCloud = true;
      try { window.setAsthaData(payload.data, user.uid); window.renderDash?.(); }
      finally { applyingCloud = false; }
      status('আপনার অ্যাকাউন্টের নতুন ডেটা Sync হয়েছে।');
    }, error => { console.error(error); status('লাইভ Sync সংযোগ বিচ্ছিন্ন: ' + (error.message || error)); });
    announceAuthReady(true);
  } finally {
    if (openingUid === user.uid) openingUid = null;
  }
}

window.registerEmailAccount = async function () {
  const name = (document.getElementById('regName')?.value || '').trim();
  const phone = (document.getElementById('regPhone')?.value || '').trim();
  const email = (document.getElementById('regEmail')?.value || '').trim().toLowerCase();
  const password = document.getElementById('regPassword')?.value || '';
  if (!name || !email || password.length < 8) { alert('নাম, সঠিক Gmail এবং কমপক্ষে ৮ অক্ষরের Password দিন।'); return; }
  try {
    await setPersistence(auth, browserLocalPersistence);
    manualSignInPending = true;
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    await updateProfile(credential.user, { displayName: name });
    await openUserData(credential.user);
    manualSignInPending = false;
    window.toggleEmailRegistration(false);
    status('রেজিস্ট্রেশন সম্পন্ন। আপনার ব্যক্তিগত হিসাব তৈরি হয়েছে।');
  } catch (error) {
    manualSignInPending = false;
    console.error(error);
    alert('রেজিস্ট্রেশন হয়নি: ' + (error.message || error));
    announceAuthReady(false);
  }
};
window.emailLogin = async function () {
  const email = (document.getElementById('emailLogin')?.value || '').trim().toLowerCase();
  const password = document.getElementById('emailPassword')?.value || '';
  if (!email || !password) { alert('Gmail ও Password লিখুন।'); return; }
  try {
    await setPersistence(auth, browserLocalPersistence);
    manualSignInPending = true;
    const credential = await signInWithEmailAndPassword(auth, email, password);
    await openUserData(credential.user);
    manualSignInPending = false;
  } catch (error) {
    manualSignInPending = false;
    console.error(error);
    status('লগইন হয়নি: ' + (error.message || error));
    alert('লগইন হয়নি: ' + (error.message || error));
    announceAuthReady(false);
  }
};
window.forgotEmailPassword = async function () {
  const email = (document.getElementById('emailLogin')?.value || '').trim().toLowerCase();
  if (!email) { alert('প্রথমে Gmail ঘরে আপনার Gmail লিখুন।'); return; }
  try { await sendPasswordResetEmail(auth, email); alert('Password reset link আপনার Gmail-এ পাঠানো হয়েছে।'); }
  catch (error) { alert('রিকভারি ইমেইল পাঠানো যায়নি: ' + (error.message || error)); }
};
window.googleSignIn = async function () {
  try {
    if (!firebaseConfig.apiKey || !firebaseConfig.appId || String(firebaseConfig.apiKey).includes('YOUR_')) throw new Error('Firebase কনফিগারেশন অসম্পূর্ণ।');
    await setPersistence(auth, browserLocalPersistence);
    manualSignInPending = true;
    status('Google লগইন খুলছে…');
    try {
      const result = await signInWithPopup(auth, provider);
      await openUserData(result.user);
      manualSignInPending = false;
    } catch (popupError) {
      if (['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(popupError.code)) {
        await signInWithRedirect(auth, provider);
        return;
      }
      throw popupError;
    }
  } catch (error) {
    manualSignInPending = false;
    console.error(error);
    status('Google লগইন হয়নি: ' + (error.message || error));
    alert('Google লগইন হয়নি: ' + (error.message || error));
    announceAuthReady(false);
  }
};
window.asthaLogout = async function () {
  try {
    stopCloudListener();
    activeUser = null;
    window.__asthaGoogleUser = null;
    openingUid = null;
    applyingCloud = false;
    localDirty = false;
    await signOut(auth);
    window.clearAsthaSessionData?.();
    document.getElementById('app')?.classList.add('hidden');
    document.getElementById('appFooterNav')?.classList.add('hidden');
    document.getElementById('login')?.classList.remove('hidden');
    status('নিরাপদে লগআউট হয়েছে। আবার Gmail ও Password দিয়ে প্রবেশ করুন।');
    announceAuthReady(false);
  } catch (error) { alert('লগআউট হয়নি: ' + (error.message || error)); }
};

window.changeAccountEmail = async function () {
  const next = (document.getElementById('newAccountEmail')?.value || '').trim().toLowerCase();
  const password = document.getElementById('currentAccountPassword')?.value || '';
  if (!activeUser || !next || !password) { alert('নতুন Gmail ও বর্তমান Password দিন।'); return; }
  try {
    await reauthenticateWithCredential(activeUser, EmailAuthProvider.credential(activeUser.email, password));
    await verifyBeforeUpdateEmail(activeUser, next);
    document.getElementById('accountChangeStatus').textContent = 'নতুন Gmail-এ verification link পাঠানো হয়েছে।';
  } catch (error) { alert('Gmail পরিবর্তন করা যায়নি: ' + (error.message || error)); }
};
window.changeAccountPassword = async function () {
  const password = document.getElementById('newAccountPassword')?.value || '';
  const current = document.getElementById('currentAccountPassword')?.value || '';
  if (!activeUser || password.length < 8 || !current) { alert('বর্তমান Password ও কমপক্ষে ৮ অক্ষরের নতুন Password দিন।'); return; }
  try {
    await reauthenticateWithCredential(activeUser, EmailAuthProvider.credential(activeUser.email, current));
    await updatePassword(activeUser, password);
    document.getElementById('newAccountPassword').value = '';
    document.getElementById('accountChangeStatus').textContent = 'Password সফলভাবে পরিবর্তন হয়েছে।';
  } catch (error) { alert('Password পরিবর্তন করা যায়নি: ' + (error.message || error)); }
};

// Bridge the legacy application save() function to this signed-in account only.
function attachSaveSync() {
  if (typeof window.save !== 'function' || window.save.__asthaFirebaseWrapped) return;
  const original = window.save;
  const wrapped = function (...args) {
    const result = original.apply(this, args);
    if (activeUser && !applyingCloud) scheduleSync();
    return result;
  };
  wrapped.__asthaFirebaseWrapped = true;
  window.save = wrapped;
}
attachSaveSync();

onAuthStateChanged(auth, async user => {
  if (manualSignInPending) return;
  if (!user) {
    activeUser = null;
    window.__asthaGoogleUser = null;
    stopCloudListener();
    if (authResolved) window.clearAsthaSessionData?.();
    announceAuthReady(false);
    return;
  }
  try {
    const redirect = await getRedirectResult(auth).catch(() => null);
    await openUserData(redirect?.user || user);
  } catch (error) {
    console.error('Auth restore failed', error);
    activeUser = null;
    window.__asthaGoogleUser = null;
    status('Firebase সংযোগ হয়নি: ' + (error.message || error));
    announceAuthReady(false);
  }
});
