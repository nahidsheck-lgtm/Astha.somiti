# আস্থা সমিতি — চূড়ান্ত ওয়েব অ্যাপ ও ব্যাকআপ

এই ZIP-এ `index.html`-এ সর্বশেষ অ্যাপ, Firebase Google Authentication/Firestore Sync মডিউল, Firebase Hosting ফাইল এবং আগের সংস্করণের একটি ব্যাকআপ কপি আছে।

## এই সংস্করণে
- মোবাইল স্ক্রিনেও ড্যাশবোর্ডের চারটি হিসাবের বক্স এক সারিতে, নির্দিষ্ট ক্রমে দেখায়।
- অ্যাডমিন লগইন স্ক্রিনে Google/Gmail লগইন বাটন আছে।
- Google লগইন হলে একই UID-র Firestore ডকুমেন্টে অ্যাপের ডেটা Sync হয়; একই Gmail দিয়ে অন্য ডিভাইসে লগইন করলে ডেটা পাওয়া যায়।
- সেটিংস → আরও সুবিধা অংশে Firebase Sync এবং JSON ব্যাকআপ ডাউনলোড/ইমপোর্ট রাখা হয়েছে।
- গ্রাহক তালিকায় ইংরেজি `ID:` লেবেল, নাম → মোবাইল → লোনের পরিমাণের ক্রম এবং টাকার বান্ডিলের আইকন রয়েছে। নতুন গ্রাহক ফর্মেও লোনের পরিমাণের পাশে আইকন আছে। ঐচ্ছিক ছবি, থাম্ব-ছবি এবং ID কার্ড প্রিন্টের সুবিধা রাখা হয়েছে।
- জমার স্লিপে গ্রাহকের নামের ঠিক নিচে স্লিপের শিরোনাম, প্রশস্ত লেআউট, সম্পূর্ণ তারিখ এবং স্পষ্ট জমার পরিমাণ দেখায়; ছোট স্ক্রিনে রেসপনসিভ বিন্যাস ব্যবহার করা হয়েছে।
- স্থানীয় JSON ব্যাকআপ/রিকভারি রাখা হয়েছে; স্বয়ংক্রিয় ব্যাকআপ চালু করা হয়নি।

## ওয়েবসাইটে চালানোর আগে একবারের সেটআপ
1. ZIP Extract করে সব ফাইল একই ফোল্ডারে রাখুন।
2. Firebase Console-এ `astha-somiti-d441b` প্রজেক্টে Authentication → Sign-in method থেকে Google চালু করুন।
3. Authentication → Settings → Authorized domains-এ আপনার ওয়েবসাইটের ডোমেইন যোগ করুন।
4. Firestore Database তৈরি/চালু করুন এবং এই ZIP-এর `firestore.rules`-এর UID-ভিত্তিক নিয়মগুলো পর্যালোচনা করে Firebase Console → Firestore → Rules-এ Publish করুন।
5. HTTPS-এ হোস্ট করুন (Firebase Hosting বা সমমানের HTTPS hosting)। `file://` থেকে খুললে Google Auth/Firestore নির্ভরযোগ্যভাবে কাজ করবে না।
6. প্রথমবার Google দিয়ে লগইন করলে স্থানীয় ডেটা থাকলে Firebase-এ প্রথমবার পাঠানোর অনুমতি চাইবে। ডেটা সঠিক আছে নিশ্চিত হয়ে সম্মতি দিন।

## গুরুত্বপূর্ণ সীমাবদ্ধতা ও নিরাপত্তা
- `firebase-config.js`-এ Web App config আগে থেকেই যুক্ত আছে। এটি Service Account key নয়; কোনো private key বা পাসওয়ার্ড এখানে যোগ করবেন না।
- এই পরিবেশে আপনার Firebase Console-এর Authentication, Authorized domains, Firestore Rules বা বাস্তব দুই-ডিভাইস Sync-এ প্রবেশ করে লাইভ পরীক্ষা করা সম্ভব হয়নি। তাই ZIP-এর কোড/ফাইল যাচাই করা হয়েছে, কিন্তু অনলাইন লগইন ও ক্লাউড Sync চালু আছে বলে নিশ্চয়তা দেওয়া হচ্ছে না—উপরের সেটআপ সম্পন্ন করে HTTPS সাইটে পরীক্ষা করতে হবে।
- Firestore-এর একটি ডকুমেন্টে পুরো অ্যাপের ডেটা রাখা হয়; ডেটা ১ MiB ছাড়ালে ডেটা মডেল ভাগ করতে হবে।
- গুরুত্বপূর্ণ হিসাবের জন্য নিয়মিত `ব্যাকআপ ডাউনলোড` থেকে JSON কপি আলাদা নিরাপদ স্থানে রাখুন।

## এই সংশোধনে যাচাই
- মূল HTML-এর ১০টি inline JavaScript ব্লক এবং Firebase-এর ২টি JavaScript module/config syntax-check করা হয়েছে।
- HTML কাঠামো, duplicate ID এবং ১৩টি CSS ব্লক পরীক্ষা করা হয়েছে; static parse-এ ত্রুটি পাওয়া যায়নি।
- Firebase Authentication/Firestore লাইভ লগইন, Firestore Rules deployment এবং একাধিক ডিভাইসে Sync এই পরিবেশে পরীক্ষা করা যায়নি। HTTPS hosting-এ বাস্তব পরীক্ষা প্রয়োজন।
- মোবাইল ব্রাউজারে দৃশ্যমান UI screenshot পরীক্ষা এই execution environment-এ browser launch restriction-এর কারণে সম্পন্ন করা যায়নি।

## ZIP-এর গুরুত্বপূর্ণ ফাইল
- `index.html` — চালানোর মূল অ্যাপ
- `Astha-Somiti-Demo.html` — একই সংশোধিত অ্যাপের আলাদা HTML কপি; Firebase module চালাতে একই ফোল্ডারের সহায়ক ফাইল প্রয়োজন
- `firebase-app.js` — Google Auth ও Firestore Sync
- `firebase-config.js` — Firebase Web App config
- `firestore.rules` — UID-ভিত্তিক Firestore Security Rules
- `firebase.json`, `.firebaserc` — Firebase Hosting সেটিংস
- `manifest.webmanifest`, `sw.js`, `assets/` — PWA ফাইল
- `backup-before-final.html` — আগের HTML সংস্করণের ব্যাকআপ

- `QA-REPORT.txt` — কী পরীক্ষা হয়েছে এবং কোন লাইভ পরীক্ষা বাকি আছে তার প্রতিবেদন
