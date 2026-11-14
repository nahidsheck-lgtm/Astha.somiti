# আস্থা সমিতি — Firebase-ready PWA

এই সংস্করণে পুরোনো অ্যাপের মূল HTML/JavaScript কাঠামো রেখে Firebase Google Authentication ও Firestore Sync যোগ করা হয়েছে। Firebase Config বসানো না হওয়া পর্যন্ত Google লগইন চালু হবে না।

## এই সংস্করণে পরিবর্তন

- Google/Gmail Authentication-এর বাটন যোগ হয়েছে। অ্যাডমিনের পুরোনো মোবাইল/PIN লগইন একা দিয়ে অ্যাডমিন প্যানেলে ঢোকা যাবে না; আগে Google লগইন প্রয়োজন।
- একই Google অ্যাকাউন্টের UID-ভিত্তিক Firestore ডকুমেন্টে অ্যাপের ডেটা Sync হবে: `appSettings/{uid}`।
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
3. এই ZIP-এর `firebase-config.js` ফাইলে আপনার দেওয়া Web App Config বসানো আছে। Firebase Console-এ Google provider Enabled এবং `nahidsheck-lgtm.github.io` Authorized domain-এ যোগ করা থাকতে হবে।
4. `firebase-config.js`-এ Service Account key, private key বা কোনো পাসওয়ার্ড রাখবেন না। Firebase Web API key ক্লায়েন্ট কনফিগারেশনের অংশ; নিরাপত্তা Firestore Rules দিয়ে নিয়ন্ত্রণ করতে হবে।

## ধাপ ২ — Google Authentication চালু করুন

Firebase Console → Authentication → Sign-in method → Google → Enable → Save।

Authentication → Settings → Authorized domains-এ আপনার চালু ডোমেইন যোগ করুন:
- `nahidsheck-lgtm.github.io` (GitHub Pages ব্যবহার করলে)
- Firebase Hosting-এর ডোমেইন (যেমন `PROJECT_ID.web.app`) ব্যবহার করলে সেটিও।

## ধাপ ৩ — Firestore Rules

`firestore.rules` ফাইলে আপনার দেওয়া owner-only UID rules রাখা হয়েছে। Firebase Console-এ আগে থেকেই একই rules প্রকাশিত থাকলে পুনরায় পরিবর্তনের দরকার নেই। এই নিয়মে শুধু নির্দিষ্ট UID ডেটা পড়তে/লিখতে পারে; অন্য Gmail দিয়ে লগইন করলে Firestore permission-denied হবে।

## ধাপ ৪ — চালানো / হোস্ট করা

সব ফাইল একই ফোল্ডারে রাখুন। `file://` দিয়ে খুলবেন না; HTTPS ওয়েবসাইটে চালান। GitHub Pages-এ আপলোড করতে ZIP-এর ভেতরের ফাইলগুলো repository root-এ রাখুন। Firebase Hosting ব্যবহার করতে Firebase CLI দিয়ে এই ফোল্ডারকে Hosting public directory হিসেবে deploy করা যায়; `firebase.json` ও `.firebaserc` প্রস্তুত আছে।

## প্রথমবারের ডেটা স্থানান্তর

যে ফোনে আগের Local Storage ডেটা আছে, সেখানে নতুন সংস্করণ HTTPS-এ খুলে Google লগইন করুন। ঐ Gmail-এর Firestore-এ ডেটা না থাকলে অ্যাপ জিজ্ঞেস করবে এই ফোনের বর্তমান ডেটা প্রথমবার ক্লাউডে পাঠাবেন কি না। সঠিক ডেটা আছে নিশ্চিত হয়ে সম্মতি দিন। এরপর অন্য ফোনে একই Gmail দিয়ে লগইন করলে ক্লাউড ডেটা আসবে।

## গুরুত্বপূর্ণ সীমাবদ্ধতা ও সতর্কতা

- এই প্রথম Firebase সংস্করণে বিদ্যমান অ্যাপের সম্পূর্ণ `db` অবজেক্ট `appSettings/{uid}`-এর একটি Firestore document-এ রাখা হয়। ডেটা খুব বড় হলে Firestore-এর ১ MiB document limit-এর কারণে আলাদা `members` ও `transactions` document-এ ভাগ করতে হবে।
- একাধিক ফোনে একই সময়ে একই রেকর্ড সম্পাদনা করলে সর্বশেষ Sync হওয়া সম্পূর্ণ অ্যাপ-ডেটা আগের পরিবর্তনকে প্রতিস্থাপন করতে পারে। গুরুত্বপূর্ণ হিসাব পরিবর্তনের আগে ব্যাকআপ রাখুন। পরবর্তী সংস্করণে সদস্য/লেনদেন আলাদা ডকুমেন্টে Sync করা উচিত।
- Google Authentication সক্রিয় করার জন্য Firebase Console-এ Web App Config ও Authorized domain ঠিকভাবে বসানো আবশ্যক। ZIP-এ আপনার গোপন/ব্যক্তিগত Firebase config অনুমান করে বসানো হয়নি।
- WhatsApp-এর মেসেজ পাঠানোর শেষ ধাপ WhatsApp অ্যাপেই ব্যবহারকারীকে Send চাপতে হবে; ওয়েবসাইট নিজে থেকে মেসেজ পাঠাতে পারে না।
- পুরোনো Local Storage ডেটা স্বয়ংক্রিয়ভাবে মুছে ফেলা হয় না। ক্লাউডে প্রথমবার আপলোডের আগে JSON backup ডাউনলোড করে রাখুন।

## ফাইল

- `index.html` — অ্যাপ
- `firebase-config.js` — Firebase Web App Config (আপনার প্রকৃত মান বসাতে হবে)
- `firebase-app.js` — Google Auth ও Firestore Sync
- `firestore.rules` — UID-ভিত্তিক নিরাপত্তা নিয়ম
- `firebase.json`, `.firebaserc` — Firebase Hosting/Project config
- `manifest.webmanifest`, `sw.js`, `assets/` — PWA ফাইল


## এই প্যাকেজে বাস্তবায়িত সংশোধন ও যাচাই-সীমা

- আপনার দেওয়া Firebase Web Config বসানো হয়েছে; Google Sign-in বাটন লগইন ও প্রথম সেটআপ—দুই জায়গাতেই দৃশ্যমান রাখা হয়েছে।
- একই Google UID-এর `appSettings/{uid}` ডকুমেন্টে পুরো অ্যাপ ডেটা Sync হয়। একই Gmail-ই ব্যবহার করতে হবে; Firestore Rules-এর UID অবশ্যই সেই Gmail-এর Firebase UID-এর সঙ্গে মিলতে হবে।
- রিপোর্টের তারিখ যাচাই, নির্বাচিত তারিখ অনুযায়ী CSV পুনর্গণনা এবং রিপোর্ট আলাদা উইন্ডোতে প্রিন্ট/PDF রাখা হয়েছে। রিপোর্ট প্যানেলটি “আরও সুবিধা” অংশের ভেতরে এক জায়গায় আছে।
- WhatsApp নোটিশে “আগামী ৭ দিনের মধ্যে” prompt বাদ দেওয়া হয়েছে; WhatsApp-এ খসড়া মেসেজ খুলবে, পাঠাতে WhatsApp-এ Send চাপতে হবে।
- ছোট স্ক্রিনে লেখা, বাটন, ইনপুট ও কার্ড compact করা হয়েছে; নতুন গ্রাহকের শাখা নির্বাচন, মোবাইল নম্বর দিয়ে সার্চ, গ্রাহক PIN, ক্যাশ এন্ট্রি edit/delete এবং recovery-তে থাকা ঋণকে ক্যাশ সারাংশে গণনা করা হয়েছে।
- কিস্তির জমা তারিখ ধরে প্রথম বকেয়া সপ্তাহে FIFO-ভাবে বরাদ্দ হয়; আংশিক জমা পৃথকভাবে দেখানো হয়। পুরোনো ডেটায় নির্দিষ্ট সপ্তাহের ID সংরক্ষিত না থাকায় এটি পুনর্গণিত FIFO allocation, মূল লেনদেনের ইতিহাস বদলায় না।

**সতর্কতা:** Firebase সংযোগ, Google OAuth, Firestore Rules, লাইভ multi-device sync এবং Android WhatsApp handoff এখানে বাস্তব Firebase/Android environment-এ end-to-end পরীক্ষা করা সম্ভব হয়নি। প্রথমবার ক্লাউডে ডেটা তোলার আগে JSON backup নিন। পুরো ডেটা একটি Firestore document-এ যায়; Firestore-এর 1 MiB document সীমা অতিক্রম করলে ডেটাকে পৃথক documents-এ ভাগ করতে হবে। একই সময়ে একাধিক ফোনে একই তথ্য বদলালে last-write-wins হতে পারে। অ্যাডমিন PIN ও পুরোনো localStorage ডেটার নিরাপত্তা/মাইগ্রেশন এই প্যাকেজে পূর্ণ server-side redesign করা হয়নি।
