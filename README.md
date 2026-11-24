# আস্থা সমিতি — Firebase + GitHub Pages

## ফাইল
- `index.html` — মূল অ্যাপ
- `firebase-app.js` — Google login, প্রতি Gmail-এর UID-ভিত্তিক Firestore sync
- `firebase-config.js` — Firebase Web App public client config
- `firebase.json`, `firestore.rules`, `.firebaserc` — Firebase Hosting/Firestore setup
- `manifest.webmanifest`, `sw.js`, `icon-192.png`, `icon-512.png` — PWA icon ও দ্রুত cache-সহ refresh/offline fallback
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
- `sw.js` navigation request-এ cache-first + background revalidation ব্যবহার করে; অন্য same-origin GET request-এ network-first এবং offline fallback ব্যবহার করে।
- Firebase Authentication/Firestore live account দিয়ে পরীক্ষা করা হয়নি; Firebase Console-এর সেটিংস ও বাস্তব লগইন ছাড়া সম্পূর্ণ live test নিশ্চিত করা যায় না।

\n## এই ZIP-এ করা সংশোধন
- মূল `index.html`-এর আগের সব ফিচার ও ডিজাইন রেখে startup/refresh flow ঠিক করা হয়েছে।
- একই ডিভাইসে trusted-device PIN login থাকলে refresh-এর পর আর login/loading screen দিয়ে অ্যাপ ঢেকে যাবে না।
- শেষ দেখা tab এবং customer detail refresh-এর পর ফিরিয়ে আনার ব্যবস্থা যোগ করা হয়েছে।
- Splash screen-এ মূল লোগো পূর্ণ দৃশ্যমান রাখা হয়েছে; Firebase ধীর হলে ৮ সেকেন্ড পর স্থানীয় login/setup দেখাবে।
- আগের ZIP-এ স্থানীয় login fallback দেখানোর কথা থাকলেও `login` section-এ শুধু Google বাটন ছিল; ফলে PIN login সম্ভব হচ্ছিল না। এখন মোবাইল + ৪ সংখ্যার PIN login UI ফিরিয়ে আনা হয়েছে এবং সফল PIN login-এর পর trusted-device session restore কাজ করবে।
- Service worker cache version `v6` করা হয়েছে, যাতে নতুন login screen পুরোনো cache থেকে আটকে না থাকে।
- Service worker cached page দ্রুত দেখায় এবং নতুন পেজ ব্যাকগ্রাউন্ডে cache করে।
- Backup page-এ mobile popup block হলে Google login redirect fallback যোগ করা হয়েছে।
- `.firebaserc` এবং অনুপস্থিত PWA icon ফাইল যোগ করা হয়েছে।
\n

## নিরাপত্তা ও Sync-সংক্রান্ত অতিরিক্ত সংশোধন
- PWA icon path root-level icon files-এর সঙ্গে মিলানো হয়েছে; `assets/` ফোল্ডারের ওপর আর নির্ভর করে না।
- `.firebaserc` যোগ করা হয়েছে এবং default Firebase project `astha-somiti-d441b` নির্দিষ্ট করা হয়েছে।
- Firebase Sync এখন Firestore transaction ও revision counter ব্যবহার করে। অন্য ডিভাইসের নতুন revision থাকলে স্থানীয় পরিবর্তন দিয়ে সেটি নীরবে overwrite করবে না।
- লাইভ Sync-এ cloud revision স্থানীয় revision-এর চেয়ে নতুন হলে এবং স্থানীয় পরিবর্তন pending থাকলে cloud listener স্থানীয় ডেটা মুছে দেবে না; conflict status দেখাবে।
- Firestore document payload 850 KiB ছাড়ালে Sync থামবে, কারণ Firestore document-এর সর্বোচ্চ সীমা 1 MiB।
- Backup restore-ও revision counter বাড়ায়, যাতে মূল অ্যাপের conflict guard পরিবর্তন শনাক্ত করতে পারে।

## গুরুত্বপূর্ণ সীমাবদ্ধতা ও প্রকাশের আগে করণীয়
- অ্যাপের বর্তমান data model এখনও একটিমাত্র `appSettings/{uid}` Firestore document-এ পুরো হিসাব রাখে। 850 KiB guard ডেটা হারানো/ব্যর্থ write এড়াতে সাহায্য করে, কিন্তু বড় ডেটার স্থায়ী সমাধান নয়। পরবর্তী ধাপে customer/transaction আলাদা documents এবং ছবি Firebase Storage-এ নেওয়ার জন্য পরিকল্পিত migration, export verification ও rollback দরকার।
- Revision guard simultaneous edit-এর ক্ষেত্রে silent overwrite কমায়; এটি দুই ডিভাইসের পরিবর্তন স্বয়ংক্রিয়ভাবে merge করে না। Conflict দেখা দিলে আগে দুই ডিভাইসের JSON backup নিতে হবে।
- Admin PIN এবং customer PIN-এর legacy plain-text data model এখনও পরিবর্তন করা হয়নি; hash-based PIN migration করতে হলে পুরোনো PIN যাচাই, account recovery এবং app login flow একসঙ্গে বদলাতে হবে।
- Firestore rules এখন UID-ভিত্তিক `appSettings` access সীমাবদ্ধ করে। Google Auth চালু, authorized domain, Firestore database এবং published rules Firebase Console-এ যাচাই করতে হবে।
- এই প্যাকেজে live Firebase credentials দিয়ে end-to-end test করা হয়নি। GitHub Pages-এ deploy করার আগে আলাদা test Gmail-এ login, create/edit, two-device conflict, JSON backup/restore এবং offline refresh পরীক্ষা করুন।


## Gmail/Password account release (2026-11-24)
- Admin sign-in now uses Gmail + Password. Registration collects name, mobile, Gmail and password, then sends a Firebase email-verification link. Unverified email/password accounts are signed out and cannot enter the app.
- Account settings replace the legacy admin phone/PIN and admin-management panels with Gmail and Password change actions. Gmail change uses Firebase verification; password change re-authenticates the current account.
- Customer login is ID-only; customer PIN prompts and PIN-management action are removed.
- Home navigation label is “হোম”; the supplied wallet/calculator artwork is used as the home brand mark. Existing association logo and “আস্থা সমিতি” heading are retained in customer statement print/PDF; the slogan is removed from that statement header.
- Customer photo processing attempts to keep the compressed JPEG data under approximately 100 KB, and customer-list thumbnails are larger.

## Firebase Console checklist before live use
1. Firebase Authentication → Sign-in method → enable **Email/Password** (Google provider can remain enabled for legacy accounts, but the new login screen uses Email/Password).
2. Authentication → Settings → Authorized domains: add the exact hosted domain.
3. Authentication → Templates → verify the email action URL and sender settings.
4. Publish the included Firestore rules. Keep the ZIP and a JSON export backup until a test registration, email verification, login, account update, data sync and receipt PDF have all been verified on the hosted site.
5. Firebase Email/Password accounts are separate from the old Google-provider accounts. If an existing user has data under a Google UID, do not register a new email account and expect automatic access to that data; first use the old account to export/backup and plan a verified migration.

## Test status
Static source checks only. This ZIP cannot enable Firebase Email/Password or authorize a domain in the Firebase Console, deliver a real verification email, or confirm hosted cross-device sync. Those steps require the project owner to enable the Firebase settings and test on the published HTTPS domain.


## Final screenshot corrections (2026-11-24)
- Kept the original Astha Somiti logo in the app header and PDF header.
- Replaced the Home navigation icon with the supplied wallet/calculator image (`home-logo.png`).
- Changed browser/PWA theme color to white. Browser chrome color remains partly controlled by the Android browser/host.
- Removed the slogan from the customer ledger PDF while retaining the organization name and official logo.
- Added a larger customer-photo area inside the “গ্রাহকের কিস্তি জমার হিসাব” heading band.
- Increased customer-list photo slots and ensured NID-card images are not substituted for customer profile photos.
- Removed a duplicate Home item from the bottom navigation.

## Verification note
Static HTML/JavaScript syntax checks are run for this package. Firebase email registration, Gmail verification, account changes, and Firestore sync still require live testing on the configured HTTPS domain and Firebase Console.


## কোড পর্যালোচনা ও নিরাপদ পরিষ্কার (2026-11-24)
- `index.html`-এ গ্রাহক আইডি ও পেমেন্ট হিস্ট্রি UI-র জন্য হুবহু পুনরাবৃত্ত একটি JavaScript wrapper block সরানো হয়েছে। আগের duplicate wrapper একই `renderCustomers` ফাংশনকে পরপর দুবার চালাতে পারত।
- Service worker cache version `v11` করা হয়েছে, যাতে এই আপডেটের পর পুরোনো `v10` cache মুছে নতুন app shell নেওয়া হয়।
- CSS-এর কিছু পুনরাবৃত্ত block cascade-এর পরে আবার একই style প্রয়োগ করছে; cascade order বদলে যেতে পারে বলে সেগুলো এই conservative cleanup-এ সরানো হয়নি।
- Firebase live login/sync, multi-device conflict, backup/restore এবং mobile layout বাস্তব Firebase/GitHub Pages পরিবেশে পরীক্ষা করা বাকি।

## Safe code audit cleanup (2026-11-24)
- Extracted the repeated 178 KB embedded Astha logo into `app-logo.png` and updated the three references. This preserves the same PNG artwork while reducing `index.html` from about 1.07 MB to about 0.56 MB.
- Removed one redundant dashboard customer-count tile click listener. The remaining handler retains mouse and keyboard activation.
- Bumped the service-worker cache name to `astha-somiti-v13` so installed clients can replace the previous cached app shell and fetch `app-logo.png`.
- Rechecked all inline JavaScript blocks and the Firebase ES modules with Node.js syntax checks; all passed. Checked HTML parsing and local `./` asset references; no missing local references were found.
- Some same-name schedule/penalty functions and layered customer-render wrappers remain as compatibility overrides. They were not aggressively removed because the active code reassigns these functions in sequence, and deleting them without a live browser/Firebase regression test could change repayment calculations or customer UI behavior.
- Firebase sign-in, verification email delivery, Firestore sync, multi-device conflict handling, data migration, and offline behavior still require testing on the actual hosted HTTPS app with the Firebase project enabled. Keep a JSON backup before deploying.


## Interface and backup refinements (2026-11-24)
- The association logo is embedded in the app HTML as a compact WebP data URI so it also renders in local Android file-manager previews and generated customer ledgers without relying on a relative image path.
- Home navigation tiles receive a subtle 3D treatment; customer rows are denser on mobile; customer ledger photo is reduced to a compact thumbnail; numeric text in the red ledger banner is white.
- Cloud backup sign-in supports the app Gmail + Password account as well as legacy Google sign-in. Email/password users must verify their email before accessing backup.
- Service worker cache is `astha-somiti-v13`. Firebase authentication and cloud sync still require a live test on the configured HTTPS deployment.
