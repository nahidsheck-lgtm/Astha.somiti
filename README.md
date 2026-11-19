# আস্থা সমিতি — Firebase + GitHub Pages

## ফাইল
- `index.html` — মূল অ্যাপ
- `firebase-app.js` — Google login, প্রতি Gmail-এর UID-ভিত্তিক Firestore sync
- `firebase-config.js` — Firebase Web App public client config
- `firebase.json`, `firestore.rules`, `.firebaserc` — Firebase Hosting/Firestore setup
- `manifest.webmanifest`, `sw.js`, `assets/` — PWA install icon ও network-first update/offline fallback
- `backup.html` — একই Gmail-এর JSON cloud backup/restore

## Gmail ডেটা আলাদা রাখার নিয়ম
- প্রতিটি Google account-এর Firestore document: `appSettings/{Firebase UID}`.
- Firestore rules অনুযায়ী একজন ব্যবহারকারী শুধু নিজের UID document পড়তে/লিখতে পারবেন।
- একই Gmail অন্য ডিভাইসে লগইন করলে সেই Gmail-এর cloud data লোড হবে।
- নতুন Gmail-এর cloud document না থাকলে আগের Gmail-এর স্থানীয় ডেটা নতুন Gmail-এ আপলোড হবে না; নতুন Gmail-এর জন্য খালি ডেটা তৈরি হবে।
- প্রথমবার কোনো ডিভাইসে পুরোনো স্থানীয় ডেটা থাকলে সেটি প্রথম Gmail-এ নেওয়ার আগে নিশ্চিতকরণ দেখাবে। Cancel করলে লগইন বাতিল হবে এবং পুরোনো স্থানীয় ডেটা অক্ষত থাকবে।

## GitHub Pages
1. ZIP extract করে সব ফাইল/ফোল্ডার repository-র root-এ রাখুন।
2. GitHub Pages branch/folder হিসেবে `main` + `/ (root)` নির্বাচন করুন।
3. URL হবে `https://nahidsheck-lgtm.github.io/Astha.somiti/`.
4. অ্যাপের `manifest.webmanifest`-এ এই repository path সেট করা আছে। অন্য repository হলে `start_url` এবং `scope` বদলাতে হবে।

## Firebase Console
1. Project: `astha-somiti-d441b`.
2. Authentication → Sign-in method → Google Enable করুন।
3. Authentication → Settings → Authorized domains-এ `nahidsheck-lgtm.github.io` যোগ করুন।
4. Firestore Database তৈরি করুন এবং `firestore.rules` publish করুন।
5. Firebase Hosting ব্যবহার করলে `firebase deploy` চালান; GitHub Pages ব্যবহার করলে Firebase Hosting deploy আবশ্যক নয়।

## গুরুত্বপূর্ণ
- `firebase-config.js`-এর Web API key public client config; এটি service-account private key নয়। Firestore rules কখনো public করবেন না।
- ডেপ্লয়ের আগে মূল অ্যাপ থেকে JSON backup ডাউনলোড করে রাখুন।
- `sw.js` network-first; অনলাইনে নতুন ফাইল পাওয়ার চেষ্টা করে এবং নেটওয়ার্ক না থাকলে cache ব্যবহার করে। নতুন সংস্করণে cache version বাড়ানো আছে।
- Firebase Authentication/Firestore live account দিয়ে পরীক্ষা করা হয়নি; Firebase Console-এর সেটিংস ও বাস্তব লগইন ছাড়া সম্পূর্ণ live test নিশ্চিত করা যায় না।
