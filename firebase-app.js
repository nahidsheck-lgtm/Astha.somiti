import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, setPersistence, browserLocalPersistence,
  signOut, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendEmailVerification, sendPasswordResetEmail, updateProfile, updatePassword,
  verifyBeforeUpdateEmail, EmailAuthProvider, reauthenticateWithCredential
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp, runTransaction, collection, getDocs, deleteDoc
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const OWNER_UID = 'bjOeOH6etCYlguhidyLTDQImrJt1';
const OWNER_KEY = 'astha_firebase_local_owner_uid_v1';
const SHARED_DATA_REF = () => doc(firestore, 'appSettings', 'shared');
const isOwner = (user) => !!user && user.uid === OWNER_UID;
async function isApproved(user) {
  if (isOwner(user)) return true;
  const snap = await getDoc(doc(firestore, 'approvedUsers', user.uid));
  return snap.exists() && snap.data().active === true;
}
async function requestAccess(user, profile = {}) {
  const ref = doc(firestore, 'accessRequests', user.uid);
  const existing = await getDoc(ref);
  if (existing.exists()) return; // A pending request is created once; only owner can alter it.
  await setDoc(ref, { uid:user.uid, email:(user.email||'').toLowerCase(), name:profile.name||user.displayName||'', phone:profile.phone||'', status:'pending', requestedAt:serverTimestamp() });
}
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
  const ref = SHARED_DATA_REF();
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
  if (!await isApproved(user)) {
    await requestAccess(user);
    activeUser = null; window.__asthaGoogleUser = null;
    await signOut(auth);
    status('আপনার অ্যাকাউন্টের অনুমোদনের অনুরোধ পাঠানো হয়েছে। মালিক অনুমোদন দিলে লগইন করতে পারবেন।');
    announceAuthReady(false); return false;
  }
  activeUser = user; window.__asthaGoogleUser = user;
  status('অ্যাকাউন্টের অনুমতি যাচাই হয়েছে; ক্লাউড হিসাব লোড হচ্ছে…');
  const ref = SHARED_DATA_REF();
  let snap = await getDoc(ref);
  // One-time owner migration: retain the previous owner-UID document as the shared workspace.
  if (!snap.exists() && isOwner(user)) {
    const legacy = await getDoc(doc(firestore, 'appSettings', user.uid));
    if (legacy.exists() && validData(legacy.data().data)) {
      await setDoc(ref, legacy.data(), {merge:true});
      snap = await getDoc(ref);
    }
  }
  const previousOwner = localOwnerUid();
  if (snap.exists()) {
    const payload = snap.data();
    if (!validData(payload.data)) throw new Error('Firebase-এ পাওয়া ডেটার কাঠামো সঠিক নয়। ডেটা পরিবর্তন করা হয়নি।');
    const existingLocal = localData();
    if (nonEmptyLocal(existingLocal) && JSON.stringify(existingLocal) !== JSON.stringify(payload.data)) {
      const backupKey = ACCOUNT_BACKUP_PREFIX + user.uid + '_before_shared_' + Date.now();
      try { localStorage.setItem(backupKey, JSON.stringify(cleanData(existingLocal))); } catch (error) { console.warn('Could not preserve local copy', error); }
    }
    baseRevision = Number(payload.revision || 0); localDirty = false; applyingCloud = true;
    try { window.setAsthaData(payload.data); } finally { applyingCloud = false; }
    setLocalOwnerUid(user.uid); status('সমিতির শেয়ার করা ক্লাউড হিসাব লোড হয়েছে।');
  } else if (isOwner(user) && nonEmptyLocal(localData())) {
    baseRevision = 0; localDirty = true;
    const upload = confirm('এই ডিভাইসে পুরোনো স্থানীয় হিসাব পাওয়া গেছে। এটিকে প্রথমবার সমিতির শেয়ার করা ক্লাউড হিসাবে সংরক্ষণ করবেন?');
    if (!upload) { activeUser=null; window.__asthaGoogleUser=null; await signOut(auth); announceAuthReady(false); return false; }
    setLocalOwnerUid(user.uid); await syncNow();
  } else {
    baseRevision = 0; localDirty = false; applyingCloud = true;
    try { window.setAsthaData(emptyAccountData()); } finally { applyingCloud = false; }
    setLocalOwnerUid(user.uid);
    if (isOwner(user)) status('নতুন শেয়ার করা হিসাব প্রস্তুত।');
  }
  stopListening = onSnapshot(ref, (cloudSnap) => {
    if (!cloudSnap.exists() || applyingCloud || !activeUser || activeUser.uid !== user.uid) return;
    const payload = cloudSnap.data(); if (!validData(payload.data)) return;
    const incomingRevision = Number(payload.revision || 0); if (incomingRevision <= baseRevision) return;
    if (localDirty) { status('অন্য ডিভাইসে নতুন তথ্য এসেছে। স্থানীয় পরিবর্তন নিরাপদে রাখা হয়েছে; সংঘর্ষ মেটানো প্রয়োজন।'); return; }
    baseRevision = incomingRevision; applyingCloud = true;
    try { window.setAsthaData(payload.data); setLocalOwnerUid(user.uid); window.renderDash?.(); } finally { applyingCloud = false; }
    status('শেয়ার করা হিসাব অন্য ডিভাইস থেকে হালনাগাদ হয়েছে।');
  }, (error) => { console.error(error); status('লাইভ Sync বন্ধ: ' + (error.message || error)); });
  if (typeof window.openAsthaAfterGoogleLogin === 'function') window.openAsthaAfterGoogleLogin();
  if (isOwner(user)) installApprovalManager();
  announceAuthReady(true); return true;
}

function installApprovalManager() {
  const host = document.getElementById('firebaseSettingsStatus') || document.getElementById('firebaseLoginStatus');
  if (!host || document.getElementById('asthaApprovalManager')) return;
  const wrap = document.createElement('div'); wrap.id='asthaApprovalManager'; wrap.style='margin-top:12px;padding:12px;border:1px solid #cbd5e1;border-radius:12px';
  wrap.innerHTML='<h3>সদস্য নিবন্ধন অনুমোদন</h3><p class="muted">নতুন সদস্যের অনুরোধ যাচাই করে অনুমোদন দিন বা বাতিল করুন।</p><button type="button" class="secondary" id="asthaLoadRequests">অনুমোদনের অনুরোধ দেখুন</button><div id="asthaRequestList"></div>';
  host.parentNode?.appendChild(wrap);
  document.getElementById('asthaLoadRequests').onclick = loadApprovalRequests;
}
async function loadApprovalRequests() {
  if (!isOwner(activeUser)) return alert('শুধু মালিক এই কাজ করতে পারবেন।');
  const box=document.getElementById('asthaRequestList'); if(!box)return; box.textContent='লোড হচ্ছে…';
  try {
    const snap=await getDocs(collection(firestore,'accessRequests'));
    const rows=snap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.status!=='approved');
    if(!rows.length){box.textContent='নতুন কোনো অনুরোধ নেই।';return;}
    box.innerHTML=rows.map(x=>`<div style="padding:10px 0;border-top:1px solid #ddd"><b>${escapeHtml(x.name||'নাম নেই')}</b><div>${escapeHtml(x.email||'')} · ${escapeHtml(x.phone||'')}</div><small>UID: ${escapeHtml(x.uid||x.id)}</small><div style="display:flex;gap:8px;margin-top:7px"><button type="button" data-approve="${escapeHtml(x.id)}">অনুমোদন</button><button type="button" class="danger" data-reject="${escapeHtml(x.id)}">বাতিল</button></div></div>`).join('');
    box.querySelectorAll('[data-approve]').forEach(b=>b.onclick=()=>approveMember(b.dataset.approve));
    box.querySelectorAll('[data-reject]').forEach(b=>b.onclick=()=>rejectMember(b.dataset.reject));
  } catch(e){box.textContent='অনুরোধ লোড হয়নি: '+(e.message||e);}
}
function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function approveMember(uid){if(!isOwner(activeUser))return;try{const req=await getDoc(doc(firestore,'accessRequests',uid));if(!req.exists())throw new Error('অনুরোধ পাওয়া যায়নি');const d=req.data();await setDoc(doc(firestore,'approvedUsers',uid),{uid,email:d.email||'',name:d.name||'',active:true,approvedAt:serverTimestamp(),approvedBy:OWNER_UID});await deleteDoc(doc(firestore,'accessRequests',uid));await loadApprovalRequests();alert('সদস্য অনুমোদিত হয়েছে।');}catch(e){alert('অনুমোদন হয়নি: '+(e.message||e));}}
async function rejectMember(uid){if(!isOwner(activeUser)||!confirm('এই নিবন্ধন অনুরোধ বাতিল করবেন?'))return;try{await deleteDoc(doc(firestore,'accessRequests',uid));await loadApprovalRequests();}catch(e){alert('বাতিল হয়নি: '+(e.message||e));}}

window.toggleEmailRegistration = function(show){ const box=document.getElementById('emailRegistration'); if(box) box.classList.toggle('hidden',!show); };
window.registerEmailAccount = async function(){
 const name=(document.getElementById('regName')?.value||'').trim();
 const phone=(document.getElementById('regPhone')?.value||'').trim();
 const email=(document.getElementById('regEmail')?.value||'').trim().toLowerCase();
 const password=document.getElementById('regPassword')?.value||'';
 if(!name||!phone||!email||password.length<8){alert('নাম, মোবাইল, সঠিক Gmail এবং কমপক্ষে ৮ অক্ষরের Password দিন।');return;}
 try{
  await setPersistence(auth,browserLocalPersistence);
  manualSignInPending=true;
  const cred=await createUserWithEmailAndPassword(auth,email,password);
  await updateProfile(cred.user,{displayName:name});
  await sendEmailVerification(cred.user);
  await requestAccess(cred.user, {name,phone});
  try{localStorage.setItem('astha_pending_profile_'+cred.user.uid,JSON.stringify({name,phone,email}));}catch(e){}
  await signOut(auth);
  manualSignInPending=false;
  const statusNode=document.getElementById('firebaseLoginStatus');if(statusNode)statusNode.textContent='ভেরিফিকেশন লিংক পাঠানো হয়েছে। ইমেইল যাচাইয়ের পর মালিকের অনুমোদনের অপেক্ষা করুন।';
  alert('রেজিস্ট্রেশন অনুরোধ পাঠানো হয়েছে। Gmail-এর Inbox/Spam থেকে ইমেইল ভেরিফাই করুন। মালিক অনুমোদন না দেওয়া পর্যন্ত অ্যাপে প্রবেশ করা যাবে না।');
  window.toggleEmailRegistration(false);
 }catch(error){manualSignInPending=false;console.error(error);alert('রেজিস্ট্রেশন হয়নি: '+(error.message||error));}
};
window.emailLogin = async function(){
 const email=(document.getElementById('emailLogin')?.value||'').trim().toLowerCase();
 const password=document.getElementById('emailPassword')?.value||'';
 if(!email||!password){alert('Gmail ও Password লিখুন।');return;}
 try{await setPersistence(auth,browserLocalPersistence);manualSignInPending=true;const cred=await signInWithEmailAndPassword(auth,email,password);await cred.user.reload();if(!cred.user.emailVerified){await signOut(auth);manualSignInPending=false;alert('প্রথমে আপনার Gmail-এর Verification Link খুলে ইমেইল ভেরিফাই করুন।');announceAuthReady(false);return;}await openUserData(cred.user);manualSignInPending=false;
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
