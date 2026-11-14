import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  onAuthStateChanged, signOut, getRedirectResult, setPersistence, browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

const status = (message, isError=false) => {
  let node = document.getElementById('firebaseStatus');
  if (!node) {
    node = document.createElement('p'); node.id='firebaseStatus';
    node.className='muted';
    const target=document.querySelector('#login') || document.querySelector('#setup');
    target?.appendChild(node);
  }
  node.textContent=message; node.style.color=isError?'#b91c1c':'#166534';
};
const hasConfig = firebaseConfig.apiKey && !firebaseConfig.apiKey.includes('PASTE_') &&
  firebaseConfig.appId && !firebaseConfig.appId.includes('PASTE_') &&
  firebaseConfig.messagingSenderId && !firebaseConfig.messagingSenderId.includes('PASTE_');
let auth=null, dbFirestore=null, activeUser=null, stopSnapshot=null, syncTimer=null;
let applyingRemote=false, lastRemoteJson='';

function openApp(){
  window.__asthaGoogleUser=activeUser;
  window.openAsthaAfterGoogleLogin?.();
  addSignOutButton();
}
function addSignOutButton(){
  if(document.getElementById('asthaGoogleSignOut')) return;
  const host=document.querySelector('header .head')||document.querySelector('header');
  if(!host)return;
  const b=document.createElement('button');b.id='asthaGoogleSignOut';b.className='secondary no-print';
  b.type='button';b.textContent='Google লগআউট';b.style.cssText='font-size:11px;margin:5px';
  b.onclick=()=>window.asthaGoogleSignOut();host.appendChild(b);
}
function appStateRef(uid){ return doc(dbFirestore,'appSettings',uid); }
function showLogin(){
  document.querySelectorAll('#setup,#app,#appFooterNav,#customerLogin,#customerView').forEach(x=>x?.classList.add('hidden'));
  document.getElementById('login')?.classList.remove('hidden');
}
function showMainApp(){
  const user=activeUser;
  let data=window.getAsthaData?.();
  if(!data || typeof data!=='object')data={customers:[],trash:[],cash:{entries:[]},settings:{}};
  if(!data.admin)data.admin={phone:'',pin:''};
  data.admin.name=data.admin.name||user?.displayName||'Google Admin';
  data.admin.email=user?.email||data.admin.email||'';
  data.admin.uid=user?.uid||data.admin.uid||'';
  if(!Array.isArray(data.customers))data.customers=[];
  if(!Array.isArray(data.trash))data.trash=[];
  window.setAsthaData?.(data);
  openApp();
}
async function loadCloud(uid){
  const ref=appStateRef(uid), snap=await getDoc(ref);
  const local=window.getAsthaData?.();
  if(snap.exists()){
    const payload=snap.data();
    if(!payload || !payload.data || !Array.isArray(payload.data.customers)) throw new Error('ক্লাউড ডেটার গঠন সঠিক নয়।');
    applyingRemote=true;
    window.setAsthaData(payload.data);
    lastRemoteJson=JSON.stringify(payload.data);
    applyingRemote=false;
    status('Firebase থেকে তথ্য Sync হয়েছে।');
  } else if(local && Array.isArray(local.customers)){
    const yes=confirm('এই Gmail-এ এখনো ক্লাউড ডেটা নেই। এই ফোনের বর্তমান গ্রাহক ও হিসাব Firebase-এ প্রথমবার সংরক্ষণ করবেন?');
    if(yes){ const cleanLocal=JSON.parse(JSON.stringify(local));await setDoc(ref,{data:cleanLocal,updatedAt:serverTimestamp(),schemaVersion:1});lastRemoteJson=JSON.stringify(cleanLocal);status('এই ফোনের তথ্য Firebase-এ সংরক্ষিত হয়েছে।'); }
    else status('ক্লাউডে তথ্য নেই। এই ডিভাইসের ডেটা অপরিবর্তিত আছে।',true);
  } else {
    status('Firebase সংযোগ হয়েছে। নতুন অ্যাডমিন সেটআপ করুন।');
  }
  if(stopSnapshot)stopSnapshot();
  stopSnapshot=onSnapshot(ref,snap2=>{
    if(!snap2.exists()||applyingRemote)return;
    const incoming=snap2.data()?.data;
    if(!incoming||!Array.isArray(incoming.customers))return;
    const json=JSON.stringify(incoming);
    if(json===lastRemoteJson)return;
    // Do not replace data while local edits are waiting to sync.
    if(syncTimer){status('অন্য ডিভাইসের আপডেট এসেছে; স্থানীয় পরিবর্তন Sync শেষ হলে রিফ্রেশ হবে।');return;}
    applyingRemote=true;window.setAsthaData(incoming);lastRemoteJson=json;applyingRemote=false;
    const active=document.querySelector('#app:not(.hidden)');
    if(active){
      const selected=document.querySelector('#app>nav button.active')?.id||'tabDash';
      if(selected==='tabCustomers')window.renderCustomers?.();else if(selected==='tabCash')window.renderCash?.();else window.renderDash?.();
    }
    status('অন্য মোবাইলের নতুন তথ্য পাওয়া গেছে।');
  },err=>status('লাইভ Sync সমস্যা: '+err.message,true));
}
async function syncNow(){
  if(!activeUser||!dbFirestore||applyingRemote)return;
  const data=window.getAsthaData?.();if(!data)return;
  try{
    const json=JSON.stringify(data);
    if(json===lastRemoteJson)return;
    const cleanData=JSON.parse(json);
    await setDoc(appStateRef(activeUser.uid),{data:cleanData,updatedAt:serverTimestamp(),schemaVersion:1});
    lastRemoteJson=JSON.stringify(cleanData);status('Firebase Sync সম্পন্ন।');
  }catch(e){status('Firebase-এ সংরক্ষণ হয়নি: '+e.message,true);}
}
function scheduleSync(){
  if(!activeUser||applyingRemote)return;
  clearTimeout(syncTimer);syncTimer=setTimeout(syncNow,900);
}
window.googleSignIn=async function(){
  if(!hasConfig){status('Firebase Config অসম্পূর্ণ। firebase-config.js-এ Firebase Console-এর সঠিক মান বসাতে হবে।',true);return;}
  try{status('Google অ্যাকাউন্ট সংযোগ করা হচ্ছে…');const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});await signInWithPopup(auth,provider);}
  catch(e){
    if(['auth/popup-blocked','auth/popup-closed-by-user','auth/operation-not-supported-in-this-environment'].includes(e.code)){
      try{await signInWithRedirect(auth,new GoogleAuthProvider());return;}catch(e2){status('Google লগইন ব্যর্থ: '+e2.message,true);}
    }else status('Google লগইন ব্যর্থ: '+e.message,true);
  }
};
window.asthaGoogleSignOut=async function(){try{if(stopSnapshot)stopSnapshot();stopSnapshot=null;await signOut(auth);activeUser=null;window.__asthaGoogleUser=null;location.reload();}catch(e){status('লগআউট হয়নি: '+e.message,true);}};

if(!hasConfig){
  status('Firebase প্রস্তুত করতে firebase-config.js-এ Web App Config বসান।');
} else {
  try{
    const app=initializeApp(firebaseConfig);auth=getAuth(app);dbFirestore=getFirestore(app);
    // Keep the Google account signed in on this device until explicit logout.
    await setPersistence(auth,browserLocalPersistence);
    // Google auth is required for admin login/setup; local PIN alone is not enough.
    const oldLogin=window.login;
    if(typeof oldLogin==='function')window.login=function(){if(!activeUser){status('আগে Google/Gmail দিয়ে লগইন করুন।',true);return;}return oldLogin.apply(this,arguments)};
    const oldFinishSetup=window.finishSetup;
    if(typeof oldFinishSetup==='function')window.finishSetup=function(){if(!activeUser){status('অ্যাডমিন সেটআপের আগে Google/Gmail দিয়ে লগইন করুন।',true);return;}const r=oldFinishSetup.apply(this,arguments);scheduleSync();return r};
    const originalSave=window.save;
    if(typeof originalSave==='function')window.save=function(){const r=originalSave.apply(this,arguments);scheduleSync();return r};
    getRedirectResult(auth).catch(e=>status('Google লগইন ফলাফল পাওয়া যায়নি: '+e.message,true));
    onAuthStateChanged(auth,async user=>{
      activeUser=user;
      if(!user){window.__asthaGoogleUser=null;showLogin();status('প্রবেশ করতে Google/Gmail দিয়ে লগইন করুন।');return;}
      window.__asthaGoogleUser=user;
      status('Google অ্যাকাউন্ট যাচাই হয়েছে: '+(user.email||'ইমেইল অজানা'));
      try{await loadCloud(user.uid);showMainApp();}catch(e){status('Firebase ডেটা লোড হয়নি: '+e.message,true);}
    });
  }catch(e){status('Firebase চালু করা যায়নি: '+e.message,true);}
}
