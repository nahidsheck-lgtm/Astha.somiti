import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, setPersistence, browserLocalPersistence,
  signOut
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, doc, getDoc, onSnapshot, serverTimestamp, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import {
  getStorage, ref as storageRef, uploadBytes, getBlob, deleteObject
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-storage.js';
import { firebaseConfig } from './firebase-config.js';

const OWNER_KEY = 'astha_firebase_local_owner_uid_v2';
const ACCOUNT_BACKUP_PREFIX = 'astha_local_backup_uid_v2_';
const LEGACY_OWNER_KEY = 'astha_firebase_local_owner_uid_v1';
const LEGACY_BACKUP_PREFIX = 'astha_local_backup_uid_v1_';
const REVISION_KEY = 'astha_cloud_revision_v1';
const status = (message) => {
  for (const id of ['firebaseSettingsStatus','firebaseLoginStatus','firebaseSetupStatus']) {
    const node = document.getElementById(id); if (node) node.textContent = message;
  }
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const firestore = getFirestore(app);
const storage = getStorage(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: 'select_account' });
let activeUser = null, stopListening = null, applyingCloud = false;
let syncTimer = null, manualSignInPending = false, initialRedirectChecked = false;
let cloudRevision = 0, localDirty = false, syncing = false;

window.__asthaFirebaseAuthReady = false;
window.__asthaFirebaseHasUser = false;
function announceAuthReady(hasUser) {
  window.__asthaFirebaseHasUser = !!hasUser;
  window.__asthaFirebaseAuthReady = true;
  window.dispatchEvent(new CustomEvent('astha-firebase-auth-ready', { detail: { hasUser: !!hasUser } }));
}
function localData() { return typeof window.getAsthaData === 'function' ? window.getAsthaData() : null; }
function validData(value) { return !!value && typeof value === 'object' && Array.isArray(value.customers); }
function nonEmptyLocal(data) { return !!(data && ((data.customers || []).length || (data.trash || []).length || data.admin || (data.admins || []).length)); }
function emptyAccountData() { return { admin: null, admins: [], customers: [], trash: [], cash: { opening: 0, entries: [] }, settings: {}, branches: [], audit: [], auditLog: [] }; }
function cleanData(data) { return JSON.parse(JSON.stringify(data ?? {})); }
function localOwnerUid() { try { return localStorage.getItem(OWNER_KEY) || localStorage.getItem(LEGACY_OWNER_KEY) || ''; } catch (_) { return ''; } }
function setLocalOwnerUid(uid) { try { localStorage.setItem(OWNER_KEY, uid); } catch (e) { console.warn(e); } }
function stashLocalForUid(uid) {
  if (!uid) return;
  const data = localData(); if (!validData(data)) return;
  try {
    const raw = JSON.stringify(cleanData(data));
    localStorage.setItem(ACCOUNT_BACKUP_PREFIX + uid, raw);
    localStorage.setItem(LEGACY_BACKUP_PREFIX + uid, raw);
  } catch (error) { console.warn('Could not preserve local account copy', error); }
}
function readStashedLocalForUid(uid) {
  if (!uid) return null;
  for (const prefix of [ACCOUNT_BACKUP_PREFIX, LEGACY_BACKUP_PREFIX]) {
    try { const raw = localStorage.getItem(prefix + uid); if (raw) { const data = JSON.parse(raw); if (validData(data)) return data; } } catch (_) {}
  }
  return null;
}
function stopCloudListener() { if (stopListening) { stopListening(); stopListening = null; } if (syncTimer) { clearTimeout(syncTimer); syncTimer = null; } }
function readRevision() { try { return Number(localStorage.getItem(REVISION_KEY) || 0); } catch (_) { return 0; } }
function saveRevision(n) { cloudRevision = Number(n || 0); try { localStorage.setItem(REVISION_KEY, String(cloudRevision)); } catch (_) {} }
function sizeBytes(value) { return new TextEncoder().encode(JSON.stringify(value)).length; }
function safeFileName(name) { return String(name || 'contract').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0,100) || 'contract'; }

async function archiveCloudCopy(uid, data, revision) {
  if (!uid || !validData(data)) return;
  const blob = new Blob([JSON.stringify({ backupType:'astha-cloud-conflict-snapshot', schemaVersion:2, uid, revision, createdAt:new Date().toISOString(), data }, null, 2)], {type:'application/json'});
  const path = `backups/${uid}/conflict-${Date.now()}-${revision}.json`;
  await uploadBytes(storageRef(storage, path), blob, {contentType:'application/json', customMetadata:{purpose:'pre-replacement-backup'}});
  return path;
}
async function migrateLegacyContracts(data) {
  if (!activeUser || !validData(data)) return 0;
  const customerRecords = [...(data.customers || []), ...(data.trash || []).filter(x => x?.type === 'customer' && x.record).map(x => x.record)];
  let migrated = 0;
  for (const customer of customerRecords) {
    for (const item of (customer.documents || [])) {
      if (!item?.data || item.storagePath || !String(item.data).startsWith('data:')) continue;
      const response = await fetch(item.data);
      const blob = await response.blob();
      const path = `contracts/${activeUser.uid}/${String(customer.id).replace(/[^a-zA-Z0-9_-]/g,'_')}/${Date.now()}-${safeFileName(item.name)}`;
      await uploadBytes(storageRef(storage, path), blob, {contentType:blob.type || item.contentType || 'application/octet-stream', customMetadata:{customerId:String(customer.id), originalName:safeFileName(item.name)}});
      item.storagePath = path; item.size = blob.size; item.contentType = blob.type || item.contentType || 'application/octet-stream';
      delete item.data; migrated++;
    }
  }
  return migrated;
}

async function syncNow({force=false}={}) {
  if (!activeUser) throw new Error('আগে Google / Gmail দিয়ে লগইন করুন।');
  if (localOwnerUid() !== activeUser.uid) throw new Error('এই ডিভাইসের স্থানীয় ডেটা অন্য Gmail-এর। নিরাপত্তার জন্য Sync বন্ধ রাখা হয়েছে।');
  const data = localData(); if (!validData(data)) throw new Error('অ্যাপের গ্রাহক ডেটা পাওয়া যায়নি।');
  const serialized = cleanData(data), bytes = sizeBytes(serialized);
  if (bytes > 850 * 1024) throw new Error('চুক্তিপত্র Firebase Storage-এ সরানোর পরও ডেটা ৮৫০ KB ছাড়িয়েছে। বড় প্রোফাইল/NID ছবি কমাতে হবে। ডিভাইসের স্থানীয় কপি অক্ষত আছে।');
  const ref = doc(firestore, 'appSettings', activeUser.uid);
  const currentSnap = await getDoc(ref);
  const currentPayload = currentSnap.exists() ? currentSnap.data() : {};
  const currentRevision = Number(currentPayload.revision || 0);
  if (currentRevision > cloudRevision && !force) {
    const err = new Error('এই Gmail-এর ক্লাউডে অন্য ডিভাইসের নতুন তথ্য আছে। আপনার স্থানীয় পরিবর্তন মুছে ফেলা হয়নি। Sync বোতাম চাপলে দুই কপির ব্যাকআপ রেখে স্থানীয় কপি ক্লাউডে বসাতে পারবেন।');
    err.code = 'ASTHA_SYNC_CONFLICT'; throw err;
  }
  if (currentRevision > cloudRevision && force) {
    status('পুরোনো ক্লাউড কপির নিরাপদ ব্যাকআপ নেওয়া হচ্ছে…');
    await archiveCloudCopy(activeUser.uid, currentPayload.data, currentRevision);
  }
  syncing = true;
  try {
    await runTransaction(firestore, async tx => {
      const latest = await tx.get(ref);
      const latestRevision = latest.exists() ? Number(latest.data().revision || 0) : 0;
      if (latestRevision !== currentRevision) throw new Error('Sync চলাকালে ক্লাউড ডেটা বদলে গেছে। আবার Sync করুন।');
      tx.set(ref, { data: serialized, updatedAt: serverTimestamp(), schemaVersion: 2, revision: latestRevision + 1 });
    });
    saveRevision(currentRevision + 1); localDirty = false;
    status('Firebase-এ তথ্য নিরাপদে Sync হয়েছে · Revision ' + (currentRevision + 1));
    return true;
  } finally { syncing = false; }
}
window.asthaFirebaseSyncNow = async () => {
  try { await syncNow(); alert('Firebase Sync সম্পন্ন হয়েছে।'); }
  catch (error) {
    if (error.code === 'ASTHA_SYNC_CONFLICT') {
      if (confirm(error.message + '\n\nআপনি কি স্থানীয় কপিটি ক্লাউডে বসাতে চান? আগে বর্তমান ক্লাউড কপির আলাদা Storage Backup নেওয়া হবে।')) {
        try { await syncNow({force:true}); alert('দুই কপির ব্যাকআপ রেখে স্থানীয় হিসাব ক্লাউডে আপডেট হয়েছে।'); }
        catch (e) { console.error(e); alert('Sync হয়নি: ' + (e.message || e)); }
      } else alert('কোনো তথ্য বদলানো হয়নি। ক্লাউডের নতুন তথ্য রাখতে পেজ রিফ্রেশ করুন।');
    } else { console.error(error); alert('Sync হয়নি: ' + (error.message || error)); }
  }
};

window.asthaUploadContractFile = async (file, customerId) => {
  if (!activeUser) throw new Error('চুক্তিপত্র ক্লাউডে রাখতে আগে Google অ্যাকাউন্টে লগইন করুন।');
  if (!file || !customerId) throw new Error('ফাইল বা গ্রাহক পাওয়া যায়নি।');
  const path = `contracts/${activeUser.uid}/${String(customerId).replace(/[^a-zA-Z0-9_-]/g,'_')}/${Date.now()}-${safeFileName(file.name)}`;
  await uploadBytes(storageRef(storage, path), file, {contentType:file.type || 'application/octet-stream', customMetadata:{customerId:String(customerId), originalName:safeFileName(file.name)}});
  return {storagePath:path, size:file.size, contentType:file.type || 'application/octet-stream'};
};
window.asthaOpenContractFile = async (path, name='contract') => {
  const popup = window.open('about:blank', '_blank');
  if (!popup) { alert('চুক্তিপত্র দেখার জন্য পপ-আপ অনুমতি দিন।'); return; }
  try {
    if (!activeUser || !String(path).startsWith(`contracts/${activeUser.uid}/`)) throw new Error('এই Gmail-এর চুক্তিপত্র দেখার অনুমতি নেই।');
    popup.document.write('<p style="font-family:sans-serif;padding:20px">চুক্তিপত্র খোলা হচ্ছে…</p>');
    const blob = await getBlob(storageRef(storage, path));
    const url = URL.createObjectURL(blob);
    popup.location.href = url;
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (error) { popup.close(); alert('চুক্তিপত্র খোলা যায়নি: ' + (error.message || error)); }
};
window.asthaDeleteContractFile = async path => {
  if (!activeUser || !String(path).startsWith(`contracts/${activeUser.uid}/`)) throw new Error('এই ফাইল মুছতে অনুমতি নেই।');
  await deleteObject(storageRef(storage, path));
};

async function applyCloudData(payload, user) {
  if (!validData(payload.data)) throw new Error('Firebase-এ পাওয়া ডেটার কাঠামো সঠিক নয়।');
  applyingCloud = true;
  try { window.setAsthaData(payload.data); setLocalOwnerUid(user.uid); saveRevision(payload.revision || 0); localDirty = false; }
  finally { applyingCloud = false; }
}
async function openUserData(user) {
  stopCloudListener(); activeUser = user; window.__asthaGoogleUser = user;
  status('Google অ্যাকাউন্ট যাচাই ও আগের ডেটা খোঁজা হচ্ছে…');
  const ref = doc(firestore, 'appSettings', user.uid);
  const snap = await getDoc(ref), previousOwner = localOwnerUid();
  const local = localData();
  if (snap.exists()) {
    const cloudPayload = snap.data();
    if (!validData(cloudPayload.data)) throw new Error('Firebase-এ পাওয়া ডেটার কাঠামো সঠিক নয়।');
    const revision = Number(cloudPayload.revision || 0);
    let localCandidate = null;
    if (previousOwner && previousOwner !== user.uid) {
      stashLocalForUid(previousOwner);
      localCandidate = readStashedLocalForUid(user.uid);
    } else if (nonEmptyLocal(local) && validData(local) && JSON.stringify(cleanData(local)) !== JSON.stringify(cleanData(cloudPayload.data))) {
      localCandidate = cleanData(local);
    }
    if (localCandidate && JSON.stringify(localCandidate) !== JSON.stringify(cleanData(cloudPayload.data))) {
      if (previousOwner === user.uid) stashLocalForUid(user.uid);
      const useCloud = confirm('এই Gmail-এর ডিভাইস কপি ও ক্লাউড কপি আলাদা।\n\nOK = ক্লাউডের কপি এই ডিভাইসে আনুন (ডিভাইসের কপি ব্যাকআপ হবে)।\nCancel = ডিভাইসের কপি রাখুন এবং ক্লাউডে পাঠান (ক্লাউড কপি Storage Backup হবে)।');
      if (useCloud) {
        await applyCloudData(cloudPayload, user);
      } else {
        // Archive the current cloud copy before replacing it with this device's version.
        await archiveCloudCopy(user.uid, cloudPayload.data, revision);
        applyingCloud = true; try { window.setAsthaData(localCandidate); } finally { applyingCloud = false; }
        setLocalOwnerUid(user.uid); saveRevision(revision); localDirty = true;
        await syncNow({force:true});
      }
    } else {
      await applyCloudData(cloudPayload, user);
    }
    status('এই Gmail-এর তথ্য প্রস্তুত। ক্লাউড Revision ' + cloudRevision);
  } else if (previousOwner && previousOwner !== user.uid) {
    stashLocalForUid(previousOwner);
    const returningCopy = readStashedLocalForUid(user.uid);
    if (returningCopy) {
      applyingCloud = true; try { window.setAsthaData(returningCopy); } finally { applyingCloud = false; }
      setLocalOwnerUid(user.uid); saveRevision(0);
      if (confirm('এই Gmail-এর ক্লাউডে এখনো হিসাব নেই, তবে এই Gmail-এর আগের ডিভাইস কপি পাওয়া গেছে। সেটি ক্লাউডে ফিরিয়ে রাখবেন?')) await syncNow();
      else { await signOut(auth); activeUser = null; window.__asthaGoogleUser = null; announceAuthReady(false); return false; }
    } else {
      applyingCloud = true; try { window.setAsthaData(emptyAccountData()); } finally { applyingCloud = false; }
      setLocalOwnerUid(user.uid); saveRevision(0); status('নতুন Gmail-এর জন্য আলাদা খালি হিসাব তৈরি হয়েছে।');
    }
  } else if (previousOwner === user.uid && nonEmptyLocal(local)) {
    stashLocalForUid(user.uid); saveRevision(0);
    if (confirm('এই Gmail-এর ক্লাউড ডেটা পাওয়া যায়নি, তবে এই ডিভাইসে একই Gmail-এর পুরোনো হিসাব আছে। সেটি ক্লাউডে পুনরায় সংরক্ষণ করবেন?')) {
      setLocalOwnerUid(user.uid); await syncNow();
    } else { await signOut(auth); activeUser = null; window.__asthaGoogleUser = null; announceAuthReady(false); return false; }
  } else if (!previousOwner && nonEmptyLocal(local)) {
    stashLocalForUid('legacy-unassigned');
    if (confirm('এই ডিভাইসে আগে থেকে স্থানীয় হিসাব পাওয়া গেছে, কিন্তু কোনো Gmail-এর নামে চিহ্নিত নয়।\n\nOK = পুরোনো হিসাব এই Gmail-এ নিন।\nCancel = লগইন বাতিল; পুরোনো হিসাব অক্ষত থাকবে.')) {
      setLocalOwnerUid(user.uid); saveRevision(0); await syncNow();
    } else { await signOut(auth); activeUser = null; window.__asthaGoogleUser = null; announceAuthReady(false); return false; }
  } else {
    applyingCloud = true; try { window.setAsthaData(emptyAccountData()); } finally { applyingCloud = false; }
    setLocalOwnerUid(user.uid); saveRevision(0); status('এই Gmail-এর জন্য নতুন আলাদা হিসাব প্রস্তুত।');
  }
  const currentData = localData();
  const migrated = await migrateLegacyContracts(currentData);
  if (migrated) { status(migrated + 'টি পুরোনো চুক্তিপত্র নিরাপদ Cloud Storage-এ নেওয়া হচ্ছে…'); await syncNow({force:true}); }
  stopListening = onSnapshot(ref, (cloudSnap) => {
    if (!cloudSnap.exists() || applyingCloud || !activeUser || activeUser.uid !== user.uid || syncing) return;
    const payload = cloudSnap.data(); if (!validData(payload.data)) { status('ক্লাউড ডেটার কাঠামো সঠিক নয়; বর্তমান তথ্য রাখা হয়েছে।'); return; }
    const incomingRevision = Number(payload.revision || 0);
    if (incomingRevision <= cloudRevision) return;
    if (localDirty) { status('অন্য ডিভাইসে নতুন তথ্য আছে। আপনার এই ডিভাইসের পরিবর্তন অক্ষত রাখা হয়েছে; Sync বোতামে গিয়ে কপি বেছে নিন।'); return; }
    applyCloudData(payload, user).then(() => {
      if (document.getElementById('app') && !document.getElementById('app').classList.contains('hidden')) {
        window.renderDash?.(); const activeTab = document.querySelector('nav button.active')?.id || '';
        if (activeTab === 'tabCustomers') window.renderCustomers?.();
      }
      status('অন্য ডিভাইসের নতুন তথ্য নিরাপদে Sync হয়েছে।');
    }).catch(error => status('ক্লাউড তথ্য লোড হয়নি: ' + error.message));
  }, error => { console.error(error); status('লাইভ Sync বন্ধ: ' + (error.message || error)); });
  if (typeof window.openAsthaAfterGoogleLogin === 'function') window.openAsthaAfterGoogleLogin();
  announceAuthReady(true); return true;
}

window.googleSignIn = async function () {
  const button = document.getElementById('googleSignInButton') || document.getElementById('googleFirstAccessButton');
  try {
    if (!firebaseConfig.apiKey || !firebaseConfig.appId || !firebaseConfig.messagingSenderId || String(firebaseConfig.apiKey).includes('YOUR_')) throw new Error('Firebase কনফিগারেশন অসম্পূর্ণ।');
    await setPersistence(auth, browserLocalPersistence); manualSignInPending = true;
    if (button) { button.disabled = true; button.textContent = 'Google যাচাই হচ্ছে…'; }
    status('Google লগইন খুলছে…');
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
    if (standalone) { await signInWithRedirect(auth, provider); return; }
    try {
      const result = await signInWithPopup(auth, provider);
      await openUserData(result.user); manualSignInPending = false;
    } catch (popupError) {
      const fallbackCodes = ['auth/popup-blocked','auth/operation-not-supported-in-this-environment','auth/web-storage-unsupported','auth/unsupported-persistence-type'];
      if (fallbackCodes.includes(popupError.code)) { await signInWithRedirect(auth, provider); return; }
      throw popupError;
    }
  } catch (error) {
    manualSignInPending = false; console.error(error); status('Google/Firebase লগইন হয়নি: ' + (error.message || error));
    if (button) { button.disabled = false; button.textContent = 'Google দিয়ে Sign in / Sign up'; }
    alert('Google/Firebase লগইন হয়নি।\n' + (error.message || error) + '\n\nFirebase Console-এ Google Authentication চালু, Storage চালু এবং আপনার ওয়েবসাইটের ডোমেইন Authorized আছে কি না দেখুন।');
    announceAuthReady(false);
  }
};

window.asthaGoogleSignOut = async () => {
  try {
    if (localDirty && activeUser) {
      try { await syncNow(); } catch (e) {
        if (!confirm('সর্বশেষ পরিবর্তন ক্লাউডে Sync হয়নি। স্থানীয় কপি এই ডিভাইসে থাকবে। তবুও লগআউট করবেন?')) return;
      }
    }
    stopCloudListener(); await signOut(auth); activeUser = null; localDirty = false;
    window.__asthaGoogleUser = null; window.__asthaFirebaseHasUser = false;
    for (const id of ['app','appFooterNav','customerView','customerLogin','setup']) document.getElementById(id)?.classList.add('hidden');
    document.getElementById('login')?.classList.remove('hidden');
    status('Google অ্যাকাউন্ট থেকে লগআউট হয়েছে।'); announceAuthReady(false);
  } catch (error) { alert('লগআউট হয়নি: ' + (error.message || error)); }
};

function attachSaveSync() {
  if (typeof window.save !== 'function' || window.save.__asthaFirebaseWrapped) return;
  const originalSave = window.save;
  const wrapped = function (...args) {
    const result = originalSave.apply(this, args);
    if (activeUser && !applyingCloud && localOwnerUid() === activeUser.uid) {
      localDirty = true; clearTimeout(syncTimer);
      syncTimer = setTimeout(() => syncNow().catch(error => {
        console.error(error); status('ডিভাইসে পরিবর্তন সংরক্ষিত; Cloud Sync আটকে আছে: ' + (error.message || error));
      }), 1100);
    }
    return result;
  };
  wrapped.__asthaFirebaseWrapped = true; window.save = wrapped;
}
attachSaveSync();
onAuthStateChanged(auth, async user => {
  if (!user) { activeUser = null; stopCloudListener(); announceAuthReady(false); return; }
  if (manualSignInPending || activeUser?.uid === user.uid) return;
  try {
    let resolvedUser = user;
    if (!initialRedirectChecked) { initialRedirectChecked = true; const result = await getRedirectResult(auth); if (result?.user) resolvedUser = result.user; }
    await openUserData(resolvedUser);
  } catch (error) { console.error(error); activeUser = null; status('Firebase সংযোগ হয়নি: ' + (error.message || error)); announceAuthReady(false); }
});
