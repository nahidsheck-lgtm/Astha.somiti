import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, setPersistence, browserLocalPersistence,
  signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, updateProfile, updatePassword,
  verifyBeforeUpdateEmail, EmailAuthProvider, reauthenticateWithCredential
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp, runTransaction
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
let baseRevision = 0;
let localDirty = false;

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
  const clean = cleanData(data);
  const bytes = new TextEncoder().encode(JSON.stringify(clean)).length;
  // Firestore documents are limited to 1 MiB; keep headroom for metadata/indexing.
  if (bytes > 850 * 1024) {
    throw new Error('ডেটা ৮৫০ KB ছাড়িয়েছে। ছবি/পুরোনো তথ্যের কারণে Firestore-এর এক ডকুমেন্ট সীমার কাছাকাছি পৌঁছেছে। নিরাপদে Sync বন্ধ রাখা হয়েছে; ডেটা মুছে ফেলা হয়নি।');
  }
  const ref = doc(firestore, 'appSettings', activeUser.uid);
  let committedRevision = baseRevision;
  await runTransaction(firestore, async (transaction) => {
    const latest = await transaction.get(ref);
    const latestRevision = latest.exists() ? Number(latest.data().revision || 0) : 0;
    if (latestRevision !== baseRevision) {
      throw new Error('অন্য ডিভাইস থেকে নতুন পরিবর্তন এসেছে। আপনার এই ডিভাইসের তথ্য নিরাপদে রাখা হয়েছে; সংঘর্ষ মেটানো ছাড়া Sync করা হয়নি। আগে JSON Backup নিন এবং অন্য ডিভাইসের সর্বশেষ তথ্য যাচাই করুন।');
    }
    committedRevision = latestRevision + 1;
    transaction.set(ref, { data: clean, updatedAt: serverTimestamp(), schemaVersion: 1, revision: committedRevision }, { merge: true });
  });
  baseRevision = committedRevision;
  // Keep edits made while the network transaction was in flight pending.
  localDirty = JSON.stringify(localData()) !== JSON.stringify(clean);
  if (localDirty) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncNow().catch((error) => {
      console.error(error); status('ডিভাইসে সংরক্ষিত; Firebase Sync ব্যর্থ: ' + (error.message || error));
    }), 900);
  }
  status(localDirty ? 'নতুন পরিবর্তন পাওয়া গেছে; পরের Sync-এর জন্য অপেক্ষা করছে।' : 'Firebase-এ সর্বশেষ তথ্য নিরাপদে Sync হয়েছে।');
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
    // Preserve any pre-existing local copy before cloud data replaces the app state.
    const existingLocal = localData();
    if (nonEmptyLocal(existingLocal) && JSON.stringify(existingLocal) !== JSON.stringify(payload.data)) {
      const backupKey = previousOwner && previousOwner !== user.uid
        ? ACCOUNT_BACKUP_PREFIX + previousOwner
        : ACCOUNT_BACKUP_PREFIX + user.uid + '_before_cloud_' + Date.now();
      try { localStorage.setItem(backupKey, JSON.stringify(cleanData(existingLocal))); }
      catch (error) { console.warn('Could not preserve pre-cloud local copy', error); }
    }
    baseRevision = Number(payload.revision || 0);
    localDirty = false;
    applyingCloud = true;
    try { window.setAsthaData(payload.data); }
    finally { applyingCloud = false; }
    setLocalOwnerUid(user.uid);
    status('এই Gmail-এর ক্লাউড হিসাব লোড হয়েছে।');
  } else if (previousOwner && previousOwner !== user.uid) {
    baseRevision = 0; localDirty = false;
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
    baseRevision = 0; localDirty = true;
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
    baseRevision = 0; localDirty = false;
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
    const incomingRevision = Number(payload.revision || 0);
    if (incomingRevision <= baseRevision) return;
    if (localDirty) {
      status('অন্য ডিভাইসে নতুন তথ্য এসেছে। আপনার স্থানীয় পরিবর্তন মুছে ফেলা হয়নি; সংঘর্ষ মেটানো পর্যন্ত স্বয়ংক্রিয় Sync বন্ধ।');
      return;
    }
    baseRevision = incomingRevision;
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

window.toggleEmailRegistration = function(show){ const box=document.getElementById('emailRegistration'); if(box) box.classList.toggle('hidden',!show); };
window.registerEmailAccount = async function(){
 const name=(document.getElementById('regName')?.value||'').trim();
 const phone=(document.getElementById('regPhone')?.value||'').trim();
 const email=(document.getElementById('regEmail')?.value||'').trim().toLowerCase();
 const password=document.getElementById('regPassword')?.value||'';
 if(!name||!phone||!email||password.length<8){alert('নাম, মোবাইল, সঠিক Gmail এবং কমপক্ষে ৮ অক্ষরের Password দিন।');return;}
 try{
  await setPersistence(auth,browserLocalPersistence);
  const cred=await createUserWithEmailAndPassword(auth,email,password);
  await updateProfile(cred.user,{displayName:name});
  await sendEmailVerification(cred.user);
  await setDoc(doc(firestore, 'appSettings', cred.user.uid), {data: emptyAccountData(), profile:{name,phone,email}, revision:0, schemaVersion:1}, {merge:true});
  try{localStorage.setItem('astha_pending_profile_'+cred.user.uid,JSON.stringify({name,phone,email}));}catch(e){}
  await signOut(auth);
  const statusNode=document.getElementById('firebaseLoginStatus');if(statusNode)statusNode.textContent='Gmail-এ Verification Link পাঠানো হয়েছে। ইমেইল যাচাই করে তারপর Gmail ও Password দিয়ে লগইন করুন।';
  alert('রেজিস্ট্রেশন হয়েছে। আপনার Gmail-এর Inbox/Spam থেকে Verification Link খুলে ভেরিফাই করুন। একবার ভেরিফাই হলেই পরেরবার শুধু Gmail ও Password লাগবে।');
  window.toggleEmailRegistration(false);
 }catch(error){console.error(error);alert('রেজিস্ট্রেশন হয়নি: '+(error.message||error));}
};
window.emailLogin = async function(){
 const email=(document.getElementById('emailLogin')?.value||'').trim().toLowerCase();
 const password=document.getElementById('emailPassword')?.value||'';
 if(!email||!password){alert('Gmail ও Password লিখুন।');return;}
 try{await setPersistence(auth,browserLocalPersistence);manualSignInPending=true;const cred=await signInWithEmailAndPassword(auth,email,password);await cred.user.reload();if(!cred.user.emailVerified){await signOut(auth);manualSignInPending=false;alert('প্রথমে আপনার Gmail-এর Verification Link খুলে ইমেইল ভেরিফাই করুন।');announceAuthReady(false);return;}await openUserData(cred.user);manualSignInPending=false;
  const pendingKey='astha_pending_profile_'+cred.user.uid;let profile=null;try{profile=JSON.parse(localStorage.getItem(pendingKey)||'null')}catch(e){}
  const profileSnap=await getDoc(doc(firestore,'appSettings',cred.user.uid));
  const remoteProfile=profileSnap.exists()?profileSnap.data().profile:null;
  profile=profile||remoteProfile;
  if(profile){const d=localData()||emptyAccountData();d.settings=d.settings||{};d.settings.accountProfile={name:profile.name||cred.user.displayName||'',phone:profile.phone||'',email:profile.email||cred.user.email};window.setAsthaData(d);try{localStorage.removeItem(pendingKey)}catch(e){}await syncNow();}
 }catch(error){manualSignInPending=false;console.error(error);alert('লগইন হয়নি: '+(error.message||error));announceAuthReady(false);}
};
window.forgotEmailPassword=async function(){const email=(document.getElementById('emailLogin')?.value||document.getElementById('regEmail')?.value||'').trim();if(!email){alert('প্রথমে Gmail ঘরে আপনার Gmail লিখুন।');return;}try{await sendPasswordResetEmail(auth,email);alert('Password reset link আপনার Gmail-এ পাঠানো হয়েছে।');}catch(error){alert('রিকভারি ইমেইল পাঠানো যায়নি: '+(error.message||error));}};
window.changeAccountEmail=async function(){
 const next=(document.getElementById('newAccountEmail')?.value||'').trim().toLowerCase();const password=document.getElementById('currentAccountPassword')?.value||'';
 if(!activeUser||!next||!password){alert('লগইন থাকা অবস্থায় নতুন Gmail ও বর্তমান Password দিন।');return;}
 try{const cred=EmailAuthProvider.credential(activeUser.email,password);await reauthenticateWithCredential(activeUser,cred);await verifyBeforeUpdateEmail(activeUser,next);const n=document.getElementById('accountChangeStatus');if(n)n.textContent='নতুন Gmail-এ verification link পাঠানো হয়েছে। লিংক খুললে Gmail পরিবর্তন সম্পন্ন হবে।';alert('নতুন Gmail-এ verification link পাঠানো হয়েছে।');}catch(error){alert('Gmail পরিবর্তন করা যায়নি: '+(error.message||error));}
};
window.changeAccountPassword=async function(){const password=document.getElementById('newAccountPassword')?.value||'';const current=document.getElementById('currentAccountPassword')?.value||'';if(!activeUser||password.length<8||!current){alert('বর্তমান Password ও কমপক্ষে ৮ অক্ষরের নতুন Password দিন।');return;}try{await reauthenticateWithCredential(activeUser,EmailAuthProvider.credential(activeUser.email,current));await updatePassword(activeUser,password);document.getElementById('newAccountPassword').value='';const n=document.getElementById('accountChangeStatus');if(n)n.textContent='Password সফলভাবে পরিবর্তন হয়েছে।';alert('Password পরিবর্তন হয়েছে।');}catch(error){alert('Password পরিবর্তন করা যায়নি: '+(error.message||error));}};

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
      localDirty = true;
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
  if (user.providerData?.some(p => p.providerId === 'password') && !user.emailVerified) {
    status('Gmail ভেরিফাই করা হয়নি। ইমেইলের Verification Link খুলুন।');
    try { await signOut(auth); } catch (_) {}
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
    console.error(error);
    activeUser = null;
    status('Firebase সংযোগ হয়নি: ' + (error.message || error));
    announceAuthReady(false);
  }
});
