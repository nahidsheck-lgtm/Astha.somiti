# আস্থা সমিতি — Firebase-ready PWA

এই সংস্করণে পুরোনো অ্যাপের মূল HTML/JavaScript কাঠামো রেখে Firebase Google Authentication ও Firestore Sync যোগ করা হয়েছে। Firebase Config বসানো না হওয়া পর্যন্ত Google লগইন চালু হবে না।

## এই সংস্করণে পরিবর্তন

- লগইন এখন শুধু Google/Gmail দিয়ে হবে; মোবাইল নম্বর ও পাসওয়ার্ডের লগইন স্ক্রিন সরানো হয়েছে। নতুন ব্যবহারকারী প্রথমবার Google দিয়ে প্রবেশ করলে অ্যাকাউন্ট তৈরি হবে।
- একই Google অ্যাকাউন্টের UID-ভিত্তিক Firestore ডকুমেন্টে অ্যাপের ডেটা Sync হবে: `appSettings/{uid}`। অন্য Gmail দিয়ে লগইন করলে তার UID-তে আলাদা ডেটা থাকবে।
- আলাদা ম্যানুয়াল Firebase Backup `appBackups/{uid}/snapshots/{backupId}`-এ append-only ভাবে রাখা হয়; এটি মূল Sync ডেটা বদলায় না এবং অ্যাপ পুরোনো Backup মুছে না।
- নতুন/পরিবর্তিত তথ্য স্বয়ংক্রিয়ভাবে প্রায় ১ সেকেন্ডের মধ্যে Sync হয়; অন্য ডিভাইসের আপডেট লাইভ শোনা হয়।
- রিপোর্টের তারিখ যাচাই, CSV-তে বর্তমান নির্বাচিত তারিখ/শাখা পুনরায় গণনা এবং শুধু রিপোর্ট প্রিন্ট/PDF করা হয়েছে।
- WhatsApp নোটিশে “আগামী ৭ দিনের মধ্যে” ডিফল্ট prompt ও মাধ্যম বাছাইয়ের prompt বাদ; WhatsApp সরাসরি খোলে এবং মেসেজে “যত দ্রুত সম্ভব” লেখা হয়।
- মোবাইলের লেখা, বাটন ও কার্ড আরও compact করা হয়েছে।
- নতুন গ্রাহক তৈরির সময় শাখা নির্বাচন এবং ক্যাশ এন্ট্রি এডিট/ডিলিট যোগ হয়েছে।
- গ্রাহক লগইনে PIN বাধ্যতামূলক করা হয়েছে; PIN না থাকলে অ্যাডমিনের কাছে সেট করতে বলবে।
- মূল অ্যাপের অন্যান্য পেজ/ফিচার অপরিবর্তিত রাখার চেষ্টা করা হয়েছে।

## ধাপ ১ — Firebase Web Config বসান

1. Firebase Console খুলুন: https://console.firebase.google.com/
2. `astha-somiti-d441b` প্রজেক্ট → Project settings → Your apps → Web App → SDK setup and configuration → Config খুলুন।
3. এই ZIP-এর `firebase-config.js` ফাইলে `apiKey`, `messagingSenderId`, `appId` এবং `storageBucket`-এর placeholder-গুলো Firebase Console-এর সঠিক মান দিয়ে বদলান। `projectId` আগে থেকেই `astha-somiti-d441b` দেওয়া আছে।
4. `firebase-config.js`-এ Service Account key, private key বা কোনো পাসওয়ার্ড রাখবেন না। Firebase Web API key ক্লায়েন্ট কনফিগারেশনের অংশ; নিরাপত্তা Firestore Rules দিয়ে নিয়ন্ত্রণ করতে হবে।

## ধাপ ২ — Google Authentication চালু করুন

Firebase Console → Authentication → Sign-in method → Google → Enable → Save।

Authentication → Settings → Authorized domains-এ আপনার চালু ডোমেইন যোগ করুন:
- `nahidsheck-lgtm.github.io` (GitHub Pages ব্যবহার করলে)
- Firebase Hosting-এর ডোমেইন (যেমন `PROJECT_ID.web.app`) ব্যবহার করলে সেটিও।

## ধাপ ৩ — Firestore Rules

`firestore.rules` ফাইলে UID-ভিত্তিক নিয়ম দেওয়া আছে। Firebase Console → Firestore Database → Rules-এ আপনার বর্তমান Rules-এর সঙ্গে মিলিয়ে প্রয়োজনীয় অংশ যোগ করে Publish করুন। `appSettings/{uid}`-এর নিয়ম মূল Sync-এর জন্য এবং `appBackups/{uid}/snapshots/{backupId}`-এর নিয়ম আলাদা Backup-এর জন্য। `appBackups`-এ read/create অনুমতি কেবল নিজের UID-তে; update/delete বন্ধ। আপনার বর্তমান Rules-এর অন্য প্রয়োজনীয় নিয়ম যাচাই ছাড়া মুছবেন না।

## ধাপ ৪ — চালানো / হোস্ট করা

সব ফাইল একই ফোল্ডারে রাখুন। `file://` দিয়ে খুলবেন না; HTTPS ওয়েবসাইটে চালান। GitHub Pages-এ আপলোড করতে ZIP-এর ভেতরের ফাইলগুলো repository root-এ রাখুন। Firebase Hosting ব্যবহার করতে Firebase CLI দিয়ে এই ফোল্ডারকে Hosting public directory হিসেবে deploy করা যায়; `firebase.json` ও `.firebaserc` প্রস্তুত আছে।

## ব্যাকআপ ব্যবহারের নিয়ম

- অ্যাপের “আরও সুবিধা” অংশে “Firebase-এ নতুন ব্যাকআপ রাখুন” চাপলে বর্তমান ডেটার একটি নতুন কপি আলাদা Firestore path-এ যোগ হবে। এটি Restore করে না।
- “ফোনে JSON ব্যাকআপ ডাউনলোড” চাপলে একটি স্থানীয় ফাইল নামবে; সেটি নিরাপদ স্থানে রাখুন।
- পুরোনো `cloudEndpoint` সেটিং থাকলেও এই সংস্করণে GitHub Pages-এ PUT পাঠানো হয় না; GitHub Pages ব্যাকআপ API নয়।
- Firebase Console-এ Rules প্রকাশ না করলে আলাদা Backup ব্যর্থ হবে; তখনও মূল Firebase Sync আলাদা থাকবে।

## প্রথমবারের ডেটা স্থানান্তর

যে ফোনে আগের Local Storage ডেটা আছে, সেখানে নতুন সংস্করণ HTTPS-এ খুলে Google লগইন করুন। ঐ Gmail-এর Firestore-এ ডেটা না থাকলে অ্যাপ জিজ্ঞেস করবে এই ফোনের বর্তমান ডেটা প্রথমবার ক্লাউডে পাঠাবেন কি না। সঠিক ডেটা আছে নিশ্চিত হয়ে সম্মতি দিন। এরপর অন্য ফোনে একই Gmail দিয়ে লগইন করলে ক্লাউড ডেটা আসবে।

## গুরুত্বপূর্ণ সীমাবদ্ধতা ও সতর্কতা

- বিদ্যমান অ্যাপের সম্পূর্ণ `db` অবজেক্ট `appSettings/{uid}`-এর একটি Firestore document-এ রাখা হয়। আলাদা Backup-ও প্রতিটি snapshot-এ একটি document; ডেটা ১ MiB ছাড়ালে Firestore সেটি প্রত্যাখ্যান করবে। এ অবস্থায় ফোনে JSON ব্যাকআপ ডাউনলোড করুন এবং পরবর্তী সময়ে ডেটা ভাগ করার পরিকল্পনা করুন।
- একাধিক ফোনে একই সময়ে একই রেকর্ড সম্পাদনা করলে সর্বশেষ Sync হওয়া সম্পূর্ণ অ্যাপ-ডেটা আগের পরিবর্তনকে প্রতিস্থাপন করতে পারে। গুরুত্বপূর্ণ হিসাব পরিবর্তনের আগে ব্যাকআপ রাখুন। পরবর্তী সংস্করণে সদস্য/লেনদেন আলাদা ডকুমেন্টে Sync করা উচিত।
- Google Authentication সক্রিয় করার জন্য Firebase Console-এ Web App Config ও Authorized domain ঠিকভাবে বসানো আবশ্যক। এই ZIP-এ Firebase Web Config আগে থেকেই যুক্ত আছে; কখনো Service Account key বা পাসওয়ার্ড এখানে রাখবেন না।
- WhatsApp-এর মেসেজ পাঠানোর শেষ ধাপ WhatsApp অ্যাপেই ব্যবহারকারীকে Send চাপতে হবে; ওয়েবসাইট নিজে থেকে মেসেজ পাঠাতে পারে না।
- পুরোনো Local Storage ডেটা স্বয়ংক্রিয়ভাবে মুছে ফেলা হয় না। ক্লাউডে প্রথমবার আপলোডের আগে JSON backup ডাউনলোড করে রাখুন।

## ফাইল

- `index.html` — অ্যাপ
- `firebase-config.js` — Firebase Web App Config (আপনার প্রকৃত মান বসাতে হবে)
- `firebase-app.js` — Google Auth ও Firestore Sync
- `firestore.rules` — UID-ভিত্তিক নিরাপত্তা নিয়ম
- `firebase.json`, `.firebaserc` — Firebase Hosting/Project config
- `manifest.webmanifest`, `sw.js`, `assets/` — PWA ফাইল
