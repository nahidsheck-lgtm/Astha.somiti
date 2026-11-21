# আস্থা সমিতি — Final Cloud-Safe Release

এই সংস্করণটি আপনার চলমান Astha Somiti অ্যাপের ওপর ভিত্তি করে তৈরি। অ্যাপটি নতুন করে বানানো হয়নি; আগের গ্রাহক, কিস্তি, Recovery, ক্যাশ, রিপোর্ট, OCR, WhatsApp, চুক্তিপত্র ও UI যতটা সম্ভব রেখে সংশোধন করা হয়েছে।

## এই সংস্করণে গুরুত্বপূর্ণ পরিবর্তন

1. **Google Admin Login:** Firebase Google Authentication দিয়ে অ্যাডমিন প্রবেশ। মোবাইল/PWA standalone mode-এ Popup-এর বদলে Redirect Login ব্যবহার হয়; প্রয়োজন হলে Popup থেকে Redirect fallback হয়।
2. **একই Gmail-এর আলাদা ডেটা:** Firestore path `appSettings/{UID}`। অন্য Gmail-এর স্থানীয় ডেটা বর্তমান Gmail-এ মিশে যায় না।
3. **Replace/overwrite সুরক্ষা:** Firestore revision number এবং transaction check যোগ হয়েছে। অন্য ডিভাইসে নতুন তথ্য থাকলে পুরোনো কপি নীরবে তার জায়গা নেয় না। দ্বন্দ্ব হলে ব্যবহারকারীকে ডিভাইসের কপি অথবা ক্লাউড কপি বেছে নিতে বলা হয়।
4. **Overwrite-এর আগে Backup:** স্থানীয় কপি দিয়ে ক্লাউড প্রতিস্থাপন বা Cloud Restore-এর আগে বর্তমান ক্লাউড ডেটা Firebase Storage-এর `backups/{UID}/`-এ JSON snapshot হিসেবে রাখা হয়।
5. **চুক্তিপত্র Cloud Storage:** নতুন PDF/ছবি Firebase Storage-এর `contracts/{UID}/{customerId}/`-এ রাখা হয়। Firestore-এ কেবল ফাইলের নাম, তারিখ, সাইজ, MIME type এবং Storage path থাকে। আগের base64 চুক্তিপত্র Google লগইনের পর স্বয়ংক্রিয়ভাবে Storage-এ সরানোর চেষ্টা হয়।
6. **চুক্তিপত্রের নিরাপত্তা:** শুধু একই Google UID-এর মালিক চুক্তিপত্র পড়তে/লিখতে/মুছতে পারেন। কোনো public download URL ডেটাবেজে রাখা হয় না; authenticated download ব্যবহৃত হয়।
7. **Customer Login:** আপনার আগের নির্দেশ অনুযায়ী গ্রাহক লগইন ID-ভিত্তিক; গ্রাহকের আলাদা PIN/পাসওয়ার্ড বাধ্যতামূলক নয়। মনে রাখবেন, ID গোপন পাসওয়ার্ড নয়।
8. **গ্রাহক যাচাই:** নতুন গ্রাহকের নাম, মোবাইল ও শূন্যের বেশি লোনের পরিমাণ ছাড়া Save হবে না।
9. **স্থানীয় ডেটা:** মূল Local Storage key অপরিবর্তিত, তাই একই ব্রাউজারের পুরোনো ডেটা মুছে নতুন করে শুরু করার কথা নয়।
10. **PWA Update:** Cache version v5; নতুন ফাইল অনলাইনে থাকলে Service Worker নতুন সংস্করণ আনবে।
11. **Manifest:** GitHub Pages-এর subfolder path-এও ইনস্টল করার জন্য relative start URL/scope ব্যবহার করা হয়েছে।

## প্রকাশের আগে একবার Firebase সেটআপ করতে হবে

আপনার বিদ্যমান Firebase Project `astha-somiti-d441b`-ই ব্যবহার করুন। নতুন Firebase Project তৈরি করার দরকার নেই।

### 1. Google Authentication

Firebase Console → Authentication → Sign-in method → Google চালু রাখুন।

Authentication → Settings → Authorized domains-এ আপনার GitHub Pages domain থাকতে হবে:

`nahidsheck-lgtm.github.io`

### 2. Firebase Storage চালু করুন — চুক্তিপত্রের জন্য জরুরি

Firebase Console → Build → Storage → Get started / Create bucket। আপনার `firebase-config.js`-এ আগের Storage bucket reference দেওয়া আছে। Console-এ সেই একই bucket সক্রিয় আছে কি না নিশ্চিত করুন।

তারপর Firebase CLI দিয়ে এই ZIP-এর root directory থেকে চালান:

```bash
firebase deploy --only firestore:rules,storage
```

অথবা Firebase Console-এর Storage → Rules-এ `storage.rules`-এর নিয়ম Publish করুন এবং Firestore → Rules-এ `firestore.rules` Publish করুন।

Browser থেকে নিরাপদে PDF/ছবি পড়তে Storage bucket-এ CORS একবার সেট করুন। Google Cloud CLI/gsutil দিয়ে চালান:

```bash
gcloud storage buckets update gs://astha-somiti-d441b.firebasestorage.app --cors-file=storage-cors.json
```

আপনার Firebase Console-এ দেখানো Storage bucket নাম ভিন্ন হলে কমান্ডে সেই সঠিক bucket নাম ব্যবহার করুন।

**Storage চালু না করলে নতুন চুক্তিপত্র ক্লাউডে সংরক্ষণ হবে না।** অ্যাপ এ অবস্থায় ভুল করে সফল হয়েছে বলবে না; ত্রুটি দেখাবে।

## GitHub Pages-এ নতুন সংস্করণ আপলোড

1. পুরোনো চলমান অ্যাপ খুলে Settings → JSON ডাউনলোড থেকে একটি স্থানীয় Backup নিন। Cloud Backup থেকেও একই Gmail-এর JSON ডাউনলোড করে রাখুন।
2. ZIP Extract করুন।
3. Extract করা ফোল্ডারের ভেতরের `index.html`, `firebase-app.js`, `firebase-config.js`, `backup.html`, `firebase.json`, `firestore.rules`, `storage.rules`, `storage-cors.json`, `manifest.webmanifest`, `sw.js`, `assets/`—সবগুলো আপনার GitHub repository-র root-এ দিন।
4. GitHub-এ একই নামের ফাইল Replace/Commit করুন। `assets/` ফোল্ডারটি সম্পূর্ণ আপলোড করুন। কোনো ফাইলকে আলাদা nested folder-এর মধ্যে রাখবেন না।
5. Firebase project এবং `firebase-config.js` পরিবর্তন করবেন না।
6. Pages deployment শেষ হলে একই URL খুলুন:
   `https://nahidsheck-lgtm.github.io/Astha.somiti/`
7. আগের যে Gmail দিয়ে হিসাব চালাতেন, ঠিক সেই Gmail দিয়ে Google Sign in করুন। প্রথমবার দুই কপির ডেটা আলাদা পাওয়া গেলে স্ক্রিনে পছন্দের কপি বেছে নিন।

## Android-এ অ্যাপের মতো Install ও সবসময় Update

এই ওয়েব অ্যাপটি PWA। Android Chrome-এ আপনার GitHub Pages URL খুলুন → Chrome-এর `⋮` মেনু → **Install app** অথবা **Add to Home screen** → Install। এরপর হোম স্ক্রিনের আইকন থেকে অ্যাপ খুলতে পারবেন। অনলাইনে নতুন সংস্করণ প্রকাশ হলে PWA Service Worker নতুন ফাইল নিয়ে আপডেট করবে; প্রতিবার APK বদলাতে হবে না।

এই ZIP-এ signed Android APK binary নেই। এখানে Android SDK/Gradle build environment ও আপনার নিজস্ব signing key নেই, তাই পরীক্ষাহীন/ভুয়া APK দেওয়া হয়নি। PWA install-ই এই Firebase Google Login-ভিত্তিক অ্যাপের জন্য এখন সবচেয়ে সহজে আপডেটযোগ্য পদ্ধতি।

## ডেটা ও নিরাপত্তার সীমা

- Firestore-এর মূল app document ১ MiB-এর মধ্যে রাখতে হয়; Sync-এর আগে ৮৫০ KB safety limit আছে। চুক্তিপত্র Storage-এ সরানো হয়েছে, তবে NID/প্রোফাইল/আঙুলের ছাপের base64 ছবি এখনো মূল ডেটার আকার বাড়াতে পারে।
- Customer ID দিয়ে customer view খোলা যায়, কারণ আপনার নির্দেশ অনুযায়ী customer password রাখা হয়নি। ID-কে শক্তিশালী নিরাপত্তা হিসেবে ধরবেন না। সংবেদনশীল গ্রাহক তথ্যের জন্য ভবিষ্যতে SMS OTP/Phone Auth প্রয়োজন হবে।
- অ্যাডমিনের Google পরিচয় Firebase Authentication দ্বারা যাচাই হয়। Google account-এ শক্তিশালী পাসওয়ার্ড ও 2-Step Verification ব্যবহার করুন।
- Firebase Rules কেবল Authenticated UID-কে তার নিজের ডেটা ও Storage folder-এ প্রবেশ করতে দেয়। Rules Console-এ Publish না করলে কোডে থাকা নিয়ম কার্যকর হবে না।
- NID/চুক্তিপত্র সংবেদনশীল। অনুমতি ছাড়া অন্যের সঙ্গে শেয়ার করবেন না।

## পরীক্ষার অবস্থা

এই প্যাকেজে JavaScript module syntax, inline script syntax, JSON config/manifest, HTML structure, duplicate ID, ZIP integrity ও file presence পরীক্ষা করা হয়েছে। তবে বাস্তব Firebase credentials/console permissions, Storage bucket activation, একাধিক Android ফোন, Google Redirect Login, camera/OCR, real contract upload/download এবং live multi-device conflict flow আপনার অ্যাকাউন্টে পরীক্ষা করা হয়নি। প্রথমবার deploy-এর পর অল্প test data দিয়ে পরীক্ষা করে তারপর দৈনন্দিন হিসাব চালু করুন।
