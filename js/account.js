/**
 * Sasta Dawa Finder - account portal (account.html).
 * Vanilla JS single-page app with hash routes, built against lib/platform.js:
 *   /api/account?a=...   (Bearer token in localStorage "sd_user_token", user JSON in "sd_user")
 * Every value from the server or the user goes through esc() before it reaches innerHTML.
 */
(function () {
  'use strict';

  if (typeof document === 'undefined' || !document.getElementById('app')) return;

  // QR codes come from js/qr.js (shared with the admin panel); CSV and upload checks from js/csvkit.js.
  const qrSvg = (text) => {
    if (!window.SDQR) throw new Error('QR encoder (js/qr.js) is not loaded');
    return window.SDQR.qrSvg(text);
  };

  // ===========================================================================
  // Basics
  // ===========================================================================
  const SITE = 'https://sasta-dawa-finder.vercel.app';
  const API = location.protocol.startsWith('http') && !/^(capacitor:|https:\/\/localhost$)/.test(location.origin) ? '' : SITE;
  const WA_NUMBER = '923393202419';
  const WA_TEXT = '+92 339 3202419';
  const TOKEN_KEY = 'sd_user_token';
  const USER_KEY = 'sd_user';
  // Inside the Capacitor app. Google blocks its sign-in inside app webviews, so the Google button is hidden there.
  const IN_APP = /^capacitor:/.test(location.origin) || location.origin === 'https://localhost';
  const GSI_SRC = 'https://accounts.google.com/gsi/client';
  const LAST_METHOD_KEY = 'sd_last_method'; // 'password' | 'google': shown as a hint on the next sign-in
  const HANDOFF_KEY = 'sd_app_handoff'; // 'customer' | 'business': this browser tab was opened by an app to sign in
  const APP_SCHEMES = { customer: 'sastadawa', business: 'sastadawabiz' };
  const METHOD_LABEL = { password: 'email and password', google: 'Google', app: 'the app' };

  const app = document.getElementById('app');
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  const rs = (n) => 'Rs ' + Math.round(Number(n) || 0).toLocaleString('en-PK');
  const rs2 = (n) => 'Rs ' + (Math.round((Number(n) || 0) * 100) / 100).toLocaleString('en-PK', { maximumFractionDigits: 2 });
  const fmtDate = (s) => {
    const d = new Date(s);
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const fmtTime = (s) => {
    const d = new Date(s);
    return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  const fmtDateTime = (s) => {
    const d = new Date(s);
    return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const today = () => new Date().toISOString().slice(0, 10);
  /** "Google · 26 Nov 2026, 14:05 on Chrome on Android" (plain text; escape before use in HTML). */
  function loginText(l) {
    if (!l || typeof l !== 'object') return '';
    const how = tr(METHOD_LABEL[l.method] || 'password');
    const when = fmtDateTime(l.at);
    const dev = String(l.device || l.ua || '').slice(0, 80);
    return how + (when ? ' · ' + when : '') + (dev ? tr(' on ') + dev : '');
  }
  const waLink = (phone, text) => {
    let p = String(phone || '').replace(/[^\d]/g, '');
    if (p.startsWith('0')) p = '92' + p.slice(1);
    return 'https://wa.me/' + p + (text ? '?text=' + encodeURIComponent(text) : '');
  };
  function lsGet(k) {
    try {
      return localStorage.getItem(k);
    } catch (e) {
      return null;
    }
  }
  function lsSet(k, v) {
    try {
      if (v == null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch (e) {
      /* private mode: stay signed in for this page only */
    }
  }

  // ===========================================================================
  // Language (English / Urdu). Same localStorage key as the main site (js/i18n.js: "sd_lang").
  // Everything a patient sees is translated; business dashboards stay in English (but work in RTL).
  // ===========================================================================
  const LANG_KEY = 'sd_lang';
  let LANG = lsGet(LANG_KEY) === 'ur' ? 'ur' : 'en';
  const UR = {
    // page chrome
    'Skip to content': 'مواد پر جائیں',
    Account: 'اکاؤنٹ',
    'Search medicines': 'دوائیں تلاش کریں',
    'For business': 'کاروبار کے لیے',
    'Loading…': 'لوڈ ہو رہا ہے…',
    Help: 'مدد',
    More: 'مزید',
    Legal: 'قانونی',
    'Plans for business': 'کاروبار کے پلان',
    'Developer API': 'ڈیولپر API',
    'Privacy policy': 'پرائیویسی پالیسی',
    'Terms of Service': 'شرائط و ضوابط',
    'Refund & cancellation': 'رقم کی واپسی اور منسوخی',
    'Medical disclaimer': 'طبی دستبرداری',
    'Pharmacy listing terms': 'فارمیسی لسٹنگ کی شرائط',
    'Delete your account': 'اپنا اکاؤنٹ ختم کریں',
    'Official DRAP medicine prices and cheaper same-formula brands.': 'ڈریپ کی سرکاری قیمتیں، اور اسی فارمولے کے سستے برانڈ۔',
    'Sasta Dawa Finder home': 'سستا دوا فائنڈر ہوم',
    Language: 'زبان',
    // sign in / create account
    'Sign in': 'سائن اِن',
    'Create account': 'اکاؤنٹ بنائیں',
    'Create your account': 'اپنا اکاؤنٹ بنائیں',
    'Sign in to Sasta Dawa': 'سستا دوا میں سائن اِن کریں',
    'One account for the website and the app.': 'ویب سائٹ اور ایپ دونوں کے لیے ایک ہی اکاؤنٹ۔',
    'Business accounts (pharmacy, clinic, NGO, company, developer) get 30 days of their paid plan free. No card needed.': 'کاروباری اکاؤنٹس (فارمیسی، کلینک، این جی او، کمپنی، ڈیولپر) کو 30 دن پلان مفت ملتا ہے۔ کارڈ کی ضرورت نہیں۔',
    'Personal accounts are free. Save your medicines and use them on any phone.': 'ذاتی اکاؤنٹ مفت ہے۔ اپنی دوائیں محفوظ کریں اور کسی بھی فون پر دیکھیں۔',
    'Sign in or create account': 'سائن اِن یا نیا اکاؤنٹ',
    'Account type': 'اکاؤنٹ کی قسم',
    'I agree to the {terms} and {privacy}': 'میں {terms} اور {privacy} سے متفق ہوں',
    'Privacy Policy': 'پرائیویسی پالیسی',
    'Needed for both ways of signing up below. We never sell your data.': 'نیچے دونوں طریقوں سے اکاؤنٹ بنانے کے لیے ضروری ہے۔ ہم آپ کا ڈیٹا کبھی نہیں بیچتے۔',
    or: 'یا',
    'Name (or business name)': 'نام (یا کاروبار کا نام)',
    Name: 'نام',
    Email: 'ای میل',
    Phone: 'فون',
    '(optional)': '(اختیاری)',
    Password: 'پاس ورڈ',
    '(at least 8 characters)': '(کم از کم 8 حروف)',
    'Forgot your password? Message us on {wa} from your account\'s phone number.': 'پاس ورڈ بھول گئے؟ اپنے اکاؤنٹ والے فون نمبر سے ہمیں {wa} پر پیغام بھیجیں۔',
    'Last time you used {how}.': 'پچھلی بار آپ نے {how} استعمال کیا۔',
    'your email and password': 'ای میل اور پاس ورڈ',
    Google: 'گوگل',
    'Sign in here and we will take you back to the {app} app.': 'یہاں سائن اِن کریں، پھر ہم آپ کو {app} ایپ پر واپس لے جائیں گے۔',
    'Own a pharmacy? {link}': 'آپ کی فارمیسی ہے؟ {link}',
    'Get the Sasta Dawa for Pharmacies app': 'سستا دوا فار فارمیسیز ایپ حاصل کریں',
    'Continue with Google (opens browser)': 'گوگل کے ساتھ جاری رکھیں (براؤزر کھلے گا)',
    'Enter your email and password.': 'اپنا ای میل اور پاس ورڈ لکھیں۔',
    'Please enter your name (or your business name).': 'براہ کرم اپنا نام (یا کاروبار کا نام) لکھیں۔',
    'Please enter a valid email address.': 'براہ کرم درست ای میل لکھیں۔',
    'Password must be at least 8 characters.': 'پاس ورڈ کم از کم 8 حروف کا ہونا چاہیے۔',
    'Please tick “I agree to the Terms of Service and Privacy Policy” to create an account.': 'اکاؤنٹ بنانے کے لیے “میں شرائط و ضوابط اور پرائیویسی پالیسی سے متفق ہوں” پر نشان لگائیں۔',
    'Please tick “I agree to the Terms of Service and Privacy Policy” first.': 'پہلے “میں شرائط و ضوابط اور پرائیویسی پالیسی سے متفق ہوں” پر نشان لگائیں۔',
    'Please tick “I agree to the Terms of Service and Privacy Policy” first, then press the Google button again.': 'پہلے “میں شرائط و ضوابط اور پرائیویسی پالیسی سے متفق ہوں” پر نشان لگائیں، پھر گوگل کا بٹن دوبارہ دبائیں۔',
    'Opening your browser… finish signing in there and you will come back here.': 'براؤزر کھل رہا ہے… وہاں سائن اِن مکمل کریں، پھر آپ یہاں واپس آ جائیں گے۔',
    'Could not open the browser. Please try again, or use your email below.': 'براؤزر نہیں کھل سکا۔ دوبارہ کوشش کریں، یا نیچے ای میل استعمال کریں۔',
    'Sign-in in the browser did not finish. Please try again.': 'براؤزر میں سائن اِن مکمل نہیں ہوا۔ دوبارہ کوشش کریں۔',
    'Google sign-in was cancelled. Please try again, or use your email below.': 'گوگل سائن اِن منسوخ ہو گیا۔ دوبارہ کوشش کریں، یا نیچے ای میل استعمال کریں۔',
    'Google sign-in failed. Please try again, or use your email below.': 'گوگل سائن اِن نہیں ہو سکا۔ دوبارہ کوشش کریں، یا نیچے ای میل استعمال کریں۔',
    'Signing you in…': 'سائن اِن ہو رہا ہے…',
    'You don\'t have an account yet. {link}, tick “I agree to the Terms”, then use Google again.': 'آپ کا ابھی کوئی اکاؤنٹ نہیں۔ {link}، “میں شرائط سے متفق ہوں” پر نشان لگائیں، پھر دوبارہ گوگل استعمال کریں۔',
    'Create an account': 'اکاؤنٹ بنائیں',
    'Could not reach the server. Check your internet connection and try again.': 'سرور سے رابطہ نہیں ہو سکا۔ انٹرنیٹ چیک کر کے دوبارہ کوشش کریں۔',
    'Something went wrong.': 'کچھ غلط ہو گیا۔',
    'Please sign in again.': 'براہ کرم دوبارہ سائن اِن کریں۔',
    'Welcome, {name}!': 'خوش آمدید، {name}!',
    'Could not sign you in. Please try again.': 'سائن اِن نہیں ہو سکا۔ دوبارہ کوشش کریں۔',
    // roles
    Personal: 'ذاتی',
    'Save your medicines across devices': 'اپنی دوائیں ہر فون پر محفوظ رکھیں',
    Pharmacy: 'فارمیسی',
    'List your pharmacy, stock and prices': 'اپنی فارمیسی، اسٹاک اور قیمتیں لگائیں',
    'Clinic / Hospital': 'کلینک / ہسپتال',
    'Price widget for your website': 'اپنی ویب سائٹ کے لیے قیمتوں کا ویجٹ',
    'NGO / Welfare trust': 'این جی او / فلاحی ٹرسٹ',
    'Stretch your medicine budget': 'دواؤں کا بجٹ زیادہ دور تک چلائیں',
    'Company / Insurer': 'کمپنی / انشورنس',
    'Medicine savings for your staff': 'اپنے عملے کے لیے دواؤں پر بچت',
    Developer: 'ڈیولپر',
    'Medicine price API keys': 'دواؤں کی قیمتوں کی API کیز',
    // handoff
    'Return to the app': 'ایپ پر واپس جائیں',
    'Taking you back to the {app} app…': 'آپ کو {app} ایپ پر واپس لے جا رہے ہیں…',
    'Signed in as {name}': 'سائن اِن: {name}',
    'Not you? Use a different account': 'آپ نہیں؟ دوسرا اکاؤنٹ استعمال کریں',
    'Stay on the website': 'ویب سائٹ پر رہیں',
    'If the app did not open by itself, press the button above. The sign-in link works once and expires in 5 minutes.': 'اگر ایپ خود نہ کھلے تو اوپر والا بٹن دبائیں۔ یہ لنک ایک بار چلتا ہے اور 5 منٹ میں ختم ہو جاتا ہے۔',
    'Try again': 'دوبارہ کوشش کریں',
    // dashboard
    'Hi, {name}': 'السلام علیکم، {name}',
    'Free plan': 'مفت پلان',
    'free trial': 'مفت آزمائش',
    'Staff of {name}': '{name} کا عملہ',
    'Last signed in with {how}': 'پچھلی بار سائن اِن: {how}',
    'Not you?': 'آپ نہیں تھے؟',
    'This is the first sign-in we have recorded for this account.': 'اس اکاؤنٹ کا یہ پہلا سائن اِن ہے جو ہمارے پاس درج ہے۔',
    'email and password': 'ای میل اور پاس ورڈ',
    'the app': 'ایپ',
    ' on ': ' — ',
    'Account sections': 'اکاؤنٹ کے حصے',
    'My Medicines': 'میری دوائیں',
    'Plan & billing': 'پلان اور ادائیگی',
    Profile: 'پروفائل',
    'You are on the free plan. Paid features are paused. {link}.': 'آپ مفت پلان پر ہیں۔ ادائیگی والی سہولیات رکی ہوئی ہیں۔ {link}۔',
    'Choose a plan': 'پلان منتخب کریں',
    // profile
    'Your details': 'آپ کی تفصیلات',
    'You sign in with Google.': 'آپ گوگل سے سائن اِن کرتے ہیں۔',
    'Google connected': 'گوگل منسلک ہے',
    Save: 'محفوظ کریں',
    'Saved.': 'محفوظ ہو گیا۔',
    'Set a password': 'پاس ورڈ بنائیں',
    'Change password': 'پاس ورڈ تبدیل کریں',
    'Optional. With a password you can also sign in with your email.': 'اختیاری۔ پاس ورڈ ہو تو آپ ای میل سے بھی سائن اِن کر سکتے ہیں۔',
    'Current password': 'موجودہ پاس ورڈ',
    'New password': 'نیا پاس ورڈ',
    '(8+ characters)': '(8 یا زیادہ حروف)',
    'Set password': 'پاس ورڈ بنائیں',
    'Changing your password signs you out on your other devices.': 'پاس ورڈ بدلنے سے آپ دوسرے فونز/کمپیوٹرز سے سائن آؤٹ ہو جائیں گے۔',
    'Password changed.': 'پاس ورڈ تبدیل ہو گیا۔',
    'Password set. You can now also sign in with your email.': 'پاس ورڈ بن گیا۔ اب آپ ای میل سے بھی سائن اِن کر سکتے ہیں۔',
    'Sign-in activity': 'سائن اِن کی تفصیل',
    'This time': 'اس بار',
    'Last time': 'پچھلی بار',
    'No earlier sign-in recorded.': 'اس سے پہلے کا کوئی سائن اِن درج نہیں۔',
    '“This time” is the sign-in you are using now. “Last time” is the one before it. If you don\'t recognise “Last time”, change your password and press “Sign out everywhere” below.': '“اس بار” وہ سائن اِن ہے جو آپ ابھی استعمال کر رہے ہیں۔ “پچھلی بار” اس سے پہلے والا ہے۔ اگر “پچھلی بار” آپ نہیں تھے تو پاس ورڈ بدلیں اور نیچے “ہر جگہ سے سائن آؤٹ” دبائیں۔',
    'We will show here how and when you last signed in, so you can spot a sign-in that was not you.': 'یہاں ہم دکھائیں گے کہ آپ نے پچھلی بار کب اور کیسے سائن اِن کیا، تاکہ کوئی اور سائن اِن کرے تو آپ کو پتا چل جائے۔',
    'Your data': 'آپ کا ڈیٹا',
    'Download a copy of everything we keep about your account (profile, pharmacies, reservations, refill customers, payments and statistics) as a JSON file.': 'ہمارے پاس آپ کے اکاؤنٹ کی جو بھی معلومات ہیں (پروفائل، فارمیسیز، ریزرویشنز، ادائیگیاں اور اعداد و شمار) ان کی کاپی JSON فائل میں حاصل کریں۔',
    'Download my data': 'میرا ڈیٹا ڈاؤن لوڈ کریں',
    'Save or share my data': 'میرا ڈیٹا محفوظ یا شیئر کریں',
    'Preparing your file…': 'آپ کی فائل تیار ہو رہی ہے…',
    'Downloaded. Keep the file somewhere safe: it contains your personal details.': 'ڈاؤن لوڈ ہو گیا۔ فائل محفوظ جگہ رکھیں: اس میں آپ کی ذاتی معلومات ہیں۔',
    'File ready. Choose where to keep it (Files, Drive or WhatsApp). Keep it somewhere safe: it contains your personal details.': 'فائل تیار ہے۔ چنیں کہاں رکھنی ہے (فائلز، ڈرائیو یا واٹس ایپ)۔ اسے محفوظ رکھیں: اس میں آپ کی ذاتی معلومات ہیں۔',
    'Could not save the file. Please try again.': 'فائل محفوظ نہیں ہو سکی۔ دوبارہ کوشش کریں۔',
    'Read our {privacy} and {terms}.': 'ہماری {privacy} اور {terms} پڑھیں۔',
    'Sign out': 'سائن آؤٹ',
    'Sign out everywhere': 'ہر جگہ سے سائن آؤٹ',
    'Signed out.': 'سائن آؤٹ ہو گیا۔',
    'Signed out on all devices.': 'تمام ڈیوائسز سے سائن آؤٹ ہو گیا۔',
    'Delete account': 'اکاؤنٹ ختم کریں',
    'This permanently deletes your account and saved data. It cannot be undone. You may want to download your data first.': 'اس سے آپ کا اکاؤنٹ اور محفوظ ڈیٹا ہمیشہ کے لیے ختم ہو جائے گا۔ یہ واپس نہیں ہو سکتا۔ بہتر ہے پہلے اپنا ڈیٹا ڈاؤن لوڈ کر لیں۔',
    'What is deleted and when': 'کیا ختم ہوتا ہے اور کب',
    'Type DELETE to confirm': 'تصدیق کے لیے DELETE لکھیں',
    'Your password': 'آپ کا پاس ورڈ',
    'I understand this cannot be undone': 'میں سمجھتا/سمجھتی ہوں کہ یہ واپس نہیں ہو سکتا',
    'Delete my account': 'میرا اکاؤنٹ ختم کریں',
    'Type DELETE in the box to confirm.': 'تصدیق کے لیے خانے میں DELETE لکھیں۔',
    'Tick the box to confirm.': 'تصدیق کے لیے خانے پر نشان لگائیں۔',
    'Your account has been deleted.': 'آپ کا اکاؤنٹ ختم کر دیا گیا ہے۔',
    // plan & billing
    'Your plan': 'آپ کا پلان',
    'Free trial': 'مفت آزمائش',
    'Trial ends': 'آزمائش ختم ہو گی',
    'Paid until': 'ادائیگی اس تاریخ تک',
    'No paid plan is active.': 'کوئی ادا شدہ پلان فعال نہیں۔',
    'Personal accounts are free. You can still join your employer\'s benefit below.': 'ذاتی اکاؤنٹ مفت ہے۔ آپ نیچے اپنی کمپنی کی سہولت میں شامل ہو سکتے ہیں۔',
    'Join company benefit': 'کمپنی کی سہولت میں شامل ہوں',
    'You are part of {name} (code {code}).': 'آپ {name} کا حصہ ہیں (کوڈ {code})۔',
    'If your employer or insurer gave you a Sasta Dawa company code, enter it here.': 'اگر آپ کی کمپنی یا انشورنس نے آپ کو سستا دوا کا کمپنی کوڈ دیا ہے تو یہاں لکھیں۔',
    'Company code': 'کمپنی کوڈ',
    'Join company': 'کمپنی میں شامل ہوں',
    'Enter the code exactly as your company gave it.': 'کوڈ بالکل ویسا لکھیں جیسا کمپنی نے دیا ہے۔',
    'You joined {name}.': 'آپ {name} میں شامل ہو گئے۔',
    // my medicines
    'This list syncs from {mm} on the main site and app while you are signed in, so it is safe if you change phones.': 'سائن اِن ہونے پر یہ فہرست ویب سائٹ اور ایپ کی {mm} سے جڑی رہتی ہے، اس لیے فون بدلنے پر بھی محفوظ رہتی ہے۔',
    'No medicines saved yet.': 'ابھی کوئی دوا محفوظ نہیں۔',
    'a month at {n}/day': 'ماہانہ، روزانہ {n}',
    'Open My Medicines': 'میری دوائیں کھولیں',
    // files / share
    Share: 'شیئر کریں',
    'File ready. Choose where to keep it: Files, Drive or WhatsApp.': 'فائل تیار ہے۔ چنیں کہاں رکھنی ہے: فائلز، ڈرائیو یا واٹس ایپ۔',
    'Could not open the share options. Please try again.': 'شیئر کے آپشن نہیں کھل سکے۔ دوبارہ کوشش کریں۔',
  };
  UR['New password must be at least 8 characters.'] = 'نیا پاس ورڈ کم از کم 8 حروف کا ہونا چاہیے۔';
  const SIGNIN_NOTE = '“This time” is the sign-in you are using now. “Last time” is the one before it. If you don\'t recognise “Last time”, change your password and press “Sign out everywhere” below.';
  /** Translate an English UI string (falls back to English); {x} placeholders are filled from p. */
  function tr(s, p) {
    let o = (LANG === 'ur' && UR[s]) || s;
    if (p) Object.keys(p).forEach((k) => (o = o.split('{' + k + '}').join(p[k])));
    return o;
  }
  /** Sets lang/dir on <html>, translates the static page chrome (data-t) and the EN | اردو toggle. */
  function applyLang() {
    const root = document.documentElement;
    root.lang = LANG;
    root.dir = LANG === 'ur' ? 'rtl' : 'ltr';
    Array.from(document.querySelectorAll('[data-t]')).forEach((el) => (el.textContent = tr(el.getAttribute('data-t'))));
    Array.from(document.querySelectorAll('[data-t-label]')).forEach((el) => el.setAttribute('aria-label', tr(el.getAttribute('data-t-label'))));
    Array.from(document.querySelectorAll('[data-acc-lang]')).forEach((b) => b.setAttribute('aria-pressed', b.getAttribute('data-acc-lang') === LANG ? 'true' : 'false'));
  }
  function setLang(l) {
    LANG = l === 'ur' ? 'ur' : 'en';
    lsSet(LANG_KEY, LANG);
    applyLang();
  }

  let toastTimer = null;
  function toast(msg) {
    const t = $('#toast');
    if (!t) return;
    t.textContent = tr(msg);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
  }

  const ROLE_LABEL = { patient: 'Personal', pharmacy: 'Pharmacy', clinic: 'Clinic / Hospital', ngo: 'NGO / Welfare trust', company: 'Company / Insurer', developer: 'Developer' };
  const ROLE_HINT = {
    patient: 'Save your medicines across devices',
    pharmacy: 'List your pharmacy, stock and prices',
    clinic: 'Price widget for your website',
    ngo: 'Stretch your medicine budget',
    company: 'Medicine savings for your staff',
    developer: 'Medicine price API keys',
  };

  // ===========================================================================
  // Session + API
  // ===========================================================================
  const S = {
    token: lsGet(TOKEN_KEY) || '',
    user: null,
    plans: null,
    pharmacies: null,
    engine: null,
    enginePromise: null,
    gsiPromise: null, // Google Identity Services script, loaded once
    gsiClient: '', // client id passed to google.accounts.id.initialize
    payment: '', // JazzCash result from #/plan?payment=..., shown on the Plan tab
  };
  try {
    S.user = JSON.parse(lsGet(USER_KEY) || 'null');
  } catch (e) {
    S.user = null;
  }

  function setSession(token, user) {
    if (token !== undefined) {
      S.token = token || '';
      lsSet(TOKEN_KEY, token || null);
    }
    if (user !== undefined) {
      S.user = user || null;
      lsSet(USER_KEY, user ? JSON.stringify(user) : null);
    }
  }
  // ---- Navigation and the Back button ----
  // Every screen change used to add a history entry, so leaving Account took 4-9 Back presses in the apps.
  // Now: switching between screens on the same level (dashboard tabs, branch sections, sign in <-> create
  // account) replaces the current entry; only a real drill-down (a branch, a patient, a refill customer)
  // adds one. Going "up" to the screen we drilled down from pops that entry instead of adding another.
  /** 0 = a dashboard tab or sign-in screen, 1 = a branch / patient, 2 = something inside a branch section. */
  function navLevel(hash) {
    const raw = String(hash || '').replace(/^#\/?/, '');
    const parts = raw.split('?')[0].split('/').filter(Boolean);
    if (!parts.length || parts[0] === 'partners') return 0; // the partners city filter is not a drill-down
    if (parts[0] === 'branch') return parts.length > 3 ? 2 : 1;
    return parts.length > 1 ? 1 : 0;
  }
  const normHash = (h) => (!h || h === '#' ? '#/' : h);
  let lastRouted = null; // location.hash of the last route(): popstate + hashchange both fire on Back
  function go(hash) {
    const target = normHash(hash);
    if (normHash(location.hash) === target) return route();
    const st = (history.state && typeof history.state === 'object' && history.state) || {};
    const cur = normHash(location.hash);
    const curLevel = typeof st.sdl === 'number' ? st.sdl : navLevel(cur);
    const level = navLevel(target);
    try {
      if (level > curLevel) {
        history.pushState({ sdl: level, parent: cur }, '', target);
      } else if (st.parent && st.parent === target) {
        history.back(); // back up to the screen we came from: popstate routes it
        return;
      } else {
        history.replaceState({ sdl: level, parent: level ? st.parent || null : null }, '', target);
      }
    } catch (e) {
      location.hash = target; // very old webviews: plain hash change
      return;
    }
    route();
  }
  // In-page links (#/...) go through go() so they follow the rules above.
  document.addEventListener('click', (ev) => {
    if (ev.defaultPrevented || ev.button || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const a = ev.target && ev.target.closest ? ev.target.closest('a[href^="#/"]') : null;
    if (!a || (a.target && a.target !== '_self')) return;
    ev.preventDefault();
    go(a.getAttribute('href'));
  });
  function signOutLocal() {
    setSession('', null);
    S.pharmacies = null;
  }

  async function api(action, opts) {
    const o = opts || {};
    const qs = o.params ? '&' + new URLSearchParams(o.params).toString() : '';
    const headers = {};
    if (S.token) headers.Authorization = 'Bearer ' + S.token;
    if (o.body) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(API + '/api/account?a=' + encodeURIComponent(action) + qs, {
        method: o.body ? 'POST' : 'GET',
        headers,
        body: o.body ? JSON.stringify(o.body) : undefined,
        cache: 'no-store',
      });
    } catch (e) {
      throw Object.assign(new Error(tr('Could not reach the server. Check your internet connection and try again.')), { status: 0 });
    }
    let data = {};
    try {
      data = await res.json();
    } catch (e) {
      data = {};
    }
    if (res.status === 401 && !['login', 'signup', 'plans', 'google'].includes(action)) {
      signOutLocal();
      toast(tr('Please sign in again.'));
      go('#/signin');
      throw Object.assign(new Error(data.error || 'Please sign in.'), { status: 401, handled: true });
    }
    // data travels with the error so callers can show row errors from CSV imports ({ errors: [{row, error}] })
    if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong (' + res.status + '). Please try again.'), { status: res.status, data });
    if (data.user && !o.raw) setSession(undefined, data.user);
    return data;
  }

  async function getPlans() {
    if (!S.plans) S.plans = await api('plans');
    return S.plans;
  }

  /** The medicine search engine (same data + engine as the main site, loaded on first use). */
  function loadEngine() {
    if (S.engine) return Promise.resolve(S.engine);
    if (!S.enginePromise) {
      S.enginePromise = window.SDData.load('data/medicines.json')
        .then((ds) => {
          S.engine = window.SDSearch.createEngine(ds);
          return S.engine;
        })
        .catch((e) => {
          S.enginePromise = null;
          throw e;
        });
    }
    return S.enginePromise;
  }
  const medLabel = (m) => (m ? `${m.name} ${m.strength || ''}`.trim() : '');
  const medMeta = (m) => (m ? [m.generic, m.form, m.pack, m.manufacturer].filter(Boolean).join(' · ') : '');

  // ===========================================================================
  // Small render helpers
  // ===========================================================================
  // An object so the text follows the current language wherever it is used as a string.
  const loadingHtml = { toString: () => `<div class="loading"><div class="spinner" aria-hidden="true"></div><span>${esc(tr('Loading…'))}</span></div>` };
  const icInfo = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';

  function errorHtml(e) {
    if (e && e.status === 402) {
      return `<div class="upgrade"><p>${esc(e.message)}</p><div class="actions"><a class="btn btn-primary" href="#/plan">Upgrade your plan</a><a class="btn btn-ghost" href="business">Compare plans</a></div></div>`;
    }
    return `<div class="notice bad">${icInfo}<p>${esc((e && e.message) || tr('Something went wrong.'))}</p></div>`;
  }
  /** Run an async loader into an element, showing a spinner and a friendly error. */
  async function into(el, fn) {
    if (!el) return;
    el.innerHTML = loadingHtml;
    try {
      await fn(el);
    } catch (e) {
      if (e && e.handled) return;
      el.innerHTML = errorHtml(e);
    }
  }
  function msg(el, text, good) {
    if (!el) return;
    el.textContent = text ? tr(text) : '';
    el.className = 'form-msg ' + (text ? (good ? 'good' : 'bad') : '');
  }
  /** Wire a <form>: disables the submit button while running, shows errors in .form-msg. */
  function onSubmit(form, fn) {
    if (!form) return;
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const btn = $('button[type="submit"]', form);
      const out = $(':scope > .form-msg', form) || $('.form-msg', form);
      msg(out, '');
      if (btn) btn.disabled = true;
      try {
        await fn(new FormData(form), out);
      } catch (e) {
        if (!e || !e.handled) {
          if (e && e.status === 402) {
            msg(out, e.message + ' Open the Plan & billing tab to upgrade.');
          } else msg(out, (e && e.message) || tr('Something went wrong.'));
        }
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }
  const val = (fd, k) => String(fd.get(k) || '').trim();

  function setTitle(t) {
    document.title = t + ' | Sasta Dawa Finder';
  }

  // ===========================================================================
  // Router
  // ===========================================================================
  const params = new URLSearchParams(location.search);

  // Opened by the customer / business app (?app=customer|business) to sign in with Google in the real browser.
  // Kept for this tab only, because signing in removes ?app= from the address.
  function ssGet(k) {
    try {
      return sessionStorage.getItem(k);
    } catch (e) {
      return S['ss_' + k] || null;
    }
  }
  function ssSet(k, v) {
    try {
      if (v == null) sessionStorage.removeItem(k);
      else sessionStorage.setItem(k, v);
    } catch (e) {
      S['ss_' + k] = v;
    }
  }
  if (!IN_APP && APP_SCHEMES[params.get('app')]) ssSet(HANDOFF_KEY, params.get('app'));
  // The Capacitor apps (js/native.js) expose window.SastaNative (null / absent on the website).
  const native = () => window.SastaNative || window.SDNative || null;
  const nativeApp = () => {
    const n = native();
    return n && (n.app === 'business' || n.app === 'customer') ? n.app : '';
  };
  const nativeAuth = () => {
    const n = native();
    return n && n.auth && typeof n.auth.startBrowserLogin === 'function' ? n.auth : null;
  };
  // Browser login finished: the app stored sd_user_token / sd_user and tells us here.
  window.addEventListener('sd-native-login', (e) => {
    const r = (e && e.detail) || {};
    if (r.ok) {
      let stored = null;
      try {
        stored = JSON.parse(lsGet(USER_KEY) || 'null');
      } catch (err) {
        stored = null;
      }
      setSession(lsGet(TOKEN_KEY) || S.token, r.user || stored);
      if (!S.token || !S.user) return;
      lsSet(LAST_METHOD_KEY, 'google');
      S.pharmacies = null;
      toast(tr('Welcome, {name}!', { name: S.user.name }));
      go('#/');
    } else {
      const out = $('#google-msg');
      if (out) msg(out, r.error || 'Sign-in in the browser did not finish. Please try again.');
      else toast(r.error || 'Sign-in in the browser did not finish. Please try again.');
    }
  });
  const handoffApp = () =>(IN_APP ? '' : APP_SCHEMES[ssGet(HANDOFF_KEY)] ? ssGet(HANDOFF_KEY) : '');
  /** Link to the main search page (index.html in the app, / on the website). */
  const mainLink = (h) => '/' + (h || '');
  /** The apps' file bridge (js/native.js): files.save(name, mime, data, {base64}) opens the share sheet. */
  const nFiles = () => {
    const n = native();
    return n && n.files && typeof n.files.save === 'function' ? n.files : null;
  };
  /** 'customer' | 'business' | '' : the app this page serves (inside it, or opened by it in the browser). */
  const appContext = () => nativeApp() || handoffApp() || (APP_SCHEMES[params.get('app')] ? params.get('app') : '');

  function tabsFor(role) {
    const t = {
      patient: [['medicines', 'My Medicines']],
      pharmacy: [['branches', 'My pharmacy']],
      clinic: [['clinic', 'Clinic widget']],
      ngo: [['optimiser', 'Budget optimiser'], ['patients', 'Patients']],
      company: [['company', 'Company benefit'], ['claims', 'Claims analysis'], ['partners', 'Partner pharmacies']],
      developer: [['keys', 'API keys']],
    }[role] || [];
    return t.concat([['plan', 'Plan & billing'], ['profile', 'Profile']]);
  }

  const PAYMENT_STATES = ['success', 'failed', 'error', 'unknown'];

  function route() {
    lastRouted = location.hash;
    const raw = location.hash.replace(/^#\/?/, '') || '';
    const qi = raw.indexOf('?');
    const hq = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : '');
    const parts = (qi >= 0 ? raw.slice(0, qi) : raw).split('/').map(decodeURIComponent);
    window.scrollTo(0, 0);
    // Back from JazzCash: /account#/plan?payment=success|failed|error|unknown
    const pay = hq.get('payment');
    if (pay) {
      S.payment = PAYMENT_STATES.includes(pay) ? pay : 'unknown';
      try {
        history.replaceState(null, '', location.pathname + location.search + '#/plan');
      } catch (e) {
        /* ignore: the banner still shows */
      }
      if (S.token && S.user && S.payment === 'success') {
        // Refresh the account first so the new plan date is shown.
        app.innerHTML = loadingHtml;
        return api('me')
          .catch(() => {})
          .then(() => {
            if (S.token && S.user) renderDashboard('plan', []);
            else route();
          });
      }
      if (S.token && S.user) return renderDashboard('plan', []);
    }
    if (!S.token || !S.user) {
      const mode = parts[0] === 'signup' || (parts[0] !== 'signin' && params.get('mode') === 'signup') ? 'signup' : 'signin';
      return renderAuth(mode);
    }
    if (handoffApp() && S.user.id) return renderHandoff();
    const tabs = tabsFor(S.user.role);
    let tab = parts[0] || '';
    if (tab === 'signin' || tab === 'signup') tab = '';
    if (tab === 'branch') return renderDashboard('branches', parts.slice(1));
    if (!tabs.some((x) => x[0] === tab)) tab = tabs[0][0];
    renderDashboard(tab, parts.slice(1));
  }
  const onHistoryNav = () => {
    if (location.hash !== lastRouted) route();
  };
  window.addEventListener('hashchange', onHistoryNav);
  window.addEventListener('popstate', onHistoryNav);

  // ===========================================================================
  // Sign in / Create account
  // ===========================================================================
  function renderAuth(mode) {
    setTitle(mode === 'signup' ? tr('Create account') : tr('Sign in'));
    // Which app this sign-up is for: the customer app signs up personal accounts, the business app only
    // business types. Inside the app it is window.SastaNative.app; in the system browser opened by the
    // app's Google button it is ?app=customer|business (kept in sessionStorage for this tab).
    const nApp = appContext();
    const roles = Object.keys(ROLE_LABEL).filter((r) => (nApp === 'business' ? r !== 'patient' : nApp === 'customer' ? r === 'patient' : true));
    let pre = ROLE_LABEL[params.get('type')] ? params.get('type') : roles[0];
    if (!roles.includes(pre)) pre = roles.includes('pharmacy') ? 'pharmacy' : roles[0];
    const bizLink = nApp === 'customer' && mode === 'signup'
      ? `<p class="small biz-app-link" id="biz-app-link">${tr('Own a pharmacy? {link}', { link: `<a href="https://sasta-dawa-finder.vercel.app/download?app=business" target="_blank" rel="noopener">${esc(tr('Get the Sasta Dawa for Pharmacies app'))}</a>` })}</p>`
      : '';
    const typeOpts = roles
      .map((r) => `<label class="type-opt"><input type="radio" name="role" value="${r}"${r === pre ? ' checked' : ''}><span>${esc(tr(ROLE_LABEL[r]))}<small>${esc(tr(ROLE_HINT[r]))}</small></span></label>`)
      .join('');
    // Filled in by mountGoogle() only when Google sign-in is configured (hidden until then).
    const googleBox = `
          <div class="google-box" id="google-box" hidden>
            <div class="google-btn" id="google-btn"></div>
            <p class="form-msg" id="google-msg" role="alert"></p>
            <div class="or-divider" role="separator"><span>${esc(tr('or'))}</span></div>
          </div>`;
    const last = lsGet(LAST_METHOD_KEY);
    const lastHint = METHOD_LABEL[last] && last !== 'app'
      ? `<p class="last-hint notice info" id="last-hint">${icInfo}<span>${tr('Last time you used {how}.', { how: `<b>${esc(last === 'google' ? tr('Google') : tr('your email and password'))}</b>` })}</span></p>`
      : '';
    const appNote = handoffApp()
      ? `<div class="notice info handoff-note">${icInfo}<p>${tr('Sign in here and we will take you back to the {app} app.', { app: `<b>${handoffApp() === 'business' ? 'Sasta Dawa for Pharmacies' : 'Sasta Dawa'}</b>` })}</p></div>`
      : '';
    const terms = `<a href="terms.html" target="_blank" rel="noopener">${esc(tr('Terms of Service'))}</a>`;
    const privacy = `<a href="privacy.html" target="_blank" rel="noopener">${esc(tr('Privacy Policy'))}</a>`;
    const opt = `<small class="muted">${esc(tr('(optional)'))}</small>`;
    const signupSub = nApp === 'customer' ? 'Personal accounts are free. Save your medicines and use them on any phone.' : 'Business accounts (pharmacy, clinic, NGO, company, developer) get 30 days of their paid plan free. No card needed.';
    app.innerHTML = `
      <section class="auth view">
        <h1 class="view-title">${esc(mode === 'signup' ? tr('Create your account') : tr('Sign in to Sasta Dawa'))}</h1>
        <p class="view-sub" style="margin-block-end:14px">${esc(mode === 'signup' ? tr(signupSub) : tr('One account for the website and the app.'))}</p>
        <nav class="auth-switch" aria-label="${esc(tr('Sign in or create account'))}">
          <a href="#/signin"${mode === 'signin' ? ' aria-current="page"' : ''}>${esc(tr('Sign in'))}</a>
          <a href="#/signup"${mode === 'signup' ? ' aria-current="page"' : ''}>${esc(tr('Create account'))}</a>
        </nav>
        ${appNote}
        <div class="card">
        ${mode === 'signup' ? `
          <form class="form" id="signup-form" novalidate>
            <fieldset class="types"><legend>${esc(tr('Account type'))}</legend>${typeOpts}</fieldset>
            ${bizLink}
            <div class="terms-box">
              <label class="check terms-check"><input type="checkbox" name="terms" id="accept-terms" value="1" required> <span>${LANG === 'ur' ? tr('I agree to the {terms} and {privacy}', { terms, privacy }) : 'I agree to the <a href="terms.html" target="_blank" rel="noopener">Terms of Service</a> and <a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a>'}</span></label>
              <p class="small muted">${esc(tr('Needed for both ways of signing up below. We never sell your data.'))}</p>
            </div>
            ${googleBox}
            <label class="field">${esc(tr('Name (or business name)'))}<input class="input" name="name" autocomplete="name" required maxlength="80"></label>
            <div class="form-row">
              <label class="field">${esc(tr('Email'))}<input class="input" type="email" name="email" autocomplete="email" required maxlength="200" dir="ltr"></label>
              <label class="field">${esc(tr('Phone'))} ${opt}<input class="input" type="tel" name="phone" autocomplete="tel" maxlength="30" placeholder="03xx xxxxxxx" dir="ltr"></label>
            </div>
            <label class="field">${esc(tr('Password'))} <small class="muted">${esc(tr('(at least 8 characters)'))}</small><input class="input" type="password" name="password" autocomplete="new-password" required minlength="8" maxlength="200" dir="ltr"></label>
            <label class="hp" aria-hidden="true">Website<input type="text" name="website" tabindex="-1" autocomplete="off"></label>
            <div class="actions"><button type="submit" class="btn btn-primary">${esc(tr('Create account'))}</button></div>
            <p class="form-msg" role="alert"></p>
          </form>` : `
          ${lastHint}
          ${googleBox}
          <form class="form" id="signin-form" novalidate>
            <label class="field">${esc(tr('Email'))}<input class="input" type="email" name="email" autocomplete="email" required maxlength="200" dir="ltr"></label>
            <label class="field">${esc(tr('Password'))}<input class="input" type="password" name="password" autocomplete="current-password" required maxlength="200" dir="ltr"></label>
            <div class="actions"><button type="submit" class="btn btn-primary">${esc(tr('Sign in'))}</button></div>
            <p class="form-msg" role="alert"></p>
            <p class="small muted" style="margin:0">${tr('Forgot your password? Message us on {wa} from your account\'s phone number.', { wa: `<a href="https://wa.me/${WA_NUMBER}" rel="noopener">WhatsApp <span dir="ltr">${WA_TEXT}</span></a>` })}</p>
          </form>`}
        </div>
      </section>`;

    onSubmit($('#signin-form'), async (fd, out) => {
      if (!val(fd, 'email') || !val(fd, 'password')) return msg(out, tr('Enter your email and password.'));
      const r = await api('login', { body: { email: val(fd, 'email'), password: String(fd.get('password') || '') } });
      afterAuth(r, 'password');
    });
    onSubmit($('#signup-form'), async (fd, out) => {
      const body = {
        role: val(fd, 'role') || 'patient',
        name: val(fd, 'name'),
        email: val(fd, 'email'),
        phone: val(fd, 'phone'),
        password: String(fd.get('password') || ''),
        website: val(fd, 'website'),
      };
      if (body.name.length < 2) return msg(out, 'Please enter your name (or your business name).');
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(body.email)) return msg(out, 'Please enter a valid email address.');
      if (body.password.length < 8) return msg(out, 'Password must be at least 8 characters.');
      if (!fd.get('terms')) return msg(out, 'Please tick “I agree to the Terms of Service and Privacy Policy” to create an account.');
      body.acceptTerms = true;
      const r = await api('signup', { body });
      afterAuth(r, 'password');
    });
    mountGoogle(mode);
  }

  // ---- Sign in with Google (Google Identity Services) ----
  /** Loads https://accounts.google.com/gsi/client once. Resolves with window.google.accounts.id. */
  function loadGsi() {
    const ready = () => window.google && window.google.accounts && window.google.accounts.id;
    if (ready()) return Promise.resolve(ready());
    if (!S.gsiPromise) {
      S.gsiPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = GSI_SRC;
        s.async = true;
        s.defer = true;
        s.onload = () => (ready() ? resolve(ready()) : reject(new Error('Google sign-in did not load.')));
        s.onerror = () => reject(new Error('Google sign-in did not load.'));
        document.head.appendChild(s);
      }).catch((e) => {
        S.gsiPromise = null;
        throw e;
      });
    }
    return S.gsiPromise;
  }

  /** Shows the Google button on the Sign in / Create account screen when the server has a client id. */
  async function mountGoogle(mode) {
    const n = nativeAuth();
    if (n) {
      // Inside the apps Google blocks its button in the webview: sign in in the real browser, come back by deep link.
      const box = $('#google-box');
      const holder = $('#google-btn');
      if (!box || !holder) return;
      holder.innerHTML = `<button type="button" class="btn btn-ghost native-google-btn" id="native-google">${esc(tr('Continue with Google (opens browser)'))}</button>`;
      box.hidden = false;
      $('#native-google').addEventListener('click', async (ev) => {
        const out = $('#google-msg');
        msg(out, '');
        if (mode === 'signup') {
          const terms = $('#accept-terms');
          if (terms && !terms.checked) {
            terms.focus();
            return msg(out, 'Please tick “I agree to the Terms of Service and Privacy Policy” first.');
          }
        }
        ev.currentTarget.disabled = true;
        const btn = ev.currentTarget;
        msg(out, 'Opening your browser… finish signing in there and you will come back here.', true);
        try {
          await n.startBrowserLogin();
        } catch (e) {
          msg(out, (e && e.message) || 'Could not open the browser. Please try again, or use your email below.');
        } finally {
          btn.disabled = false;
        }
      });
      return;
    }
    if (IN_APP) return;
    let clientId = '';
    try {
      clientId = (await getPlans()).googleClientId || '';
    } catch (e) {
      return; // no server: only the email form shows
    }
    if (!clientId) return;
    const box = $('#google-box');
    const holder = $('#google-btn');
    if (!box || !holder) return; // user moved to another screen meanwhile
    let gid;
    try {
      gid = await loadGsi();
    } catch (e) {
      return; // blocked by an extension or offline: keep the email form only
    }
    if (!document.body.contains(holder)) return;
    if (S.gsiClient !== clientId) {
      gid.initialize({ client_id: clientId, callback: onGoogleCredential, ux_mode: 'popup', auto_select: false, cancel_on_tap_outside: true });
      S.gsiClient = clientId;
    }
    box.hidden = false;
    holder.setAttribute('data-client-id', clientId);
    const width = Math.max(200, Math.min(400, Math.floor(holder.clientWidth || box.clientWidth || 320)));
    gid.renderButton(holder, { type: 'standard', theme: 'outline', size: 'large', shape: 'rectangular', logo_alignment: 'center', text: mode === 'signup' ? 'signup_with' : 'signin_with', width });
  }

  async function onGoogleCredential(resp) {
    const out = $('#google-msg');
    msg(out, '');
    const credential = resp && resp.credential;
    if (!credential) return msg(out, 'Google sign-in was cancelled. Please try again, or use your email below.');
    const signup = $('#signup-form');
    const picked = $('#signup-form input[name="role"]:checked');
    const body = { credential };
    if (picked) body.role = picked.value;
    // Opened from the pharmacies app (no type picked, e.g. on Sign in): a new account is a pharmacy, not Personal
    else if (appContext() === 'business') body.role = 'pharmacy';
    if (signup) {
      const terms = $('#accept-terms');
      if (!terms || !terms.checked) {
        if (terms) terms.focus();
        return msg(out, 'Please tick “I agree to the Terms of Service and Privacy Policy” first, then press the Google button again.');
      }
      body.acceptTerms = true;
    }
    msg(out, 'Signing you in…', true);
    try {
      const r = await api('google', { body });
      afterAuth(r, 'google');
    } catch (e) {
      const m = (e && e.message) || 'Google sign-in failed. Please try again, or use your email below.';
      // New Google account from the Sign in screen: the server needs the terms checkbox, which is on Create account.
      if (!signup && e && e.status === 400 && /terms/i.test(m)) {
        const box = $('#google-msg');
        msg(box, '');
        if (box) box.innerHTML = tr('You don\'t have an account yet. {link}, tick “I agree to the Terms”, then use Google again.', { link: `<a href="#/signup">${esc(tr('Create an account'))}</a>` });
        if (box) box.className = 'form-msg bad';
        return;
      }
      msg($('#google-msg'), m);
    }
  }

  function afterAuth(r, method) {
    if (!r || !r.token || !r.user) throw new Error(tr('Could not sign you in. Please try again.'));
    setSession(r.token, r.user);
    if (method) lsSet(LAST_METHOD_KEY, method);
    S.pharmacies = null;
    toast(tr('Welcome, {name}!', { name: r.user.name }));
    // Replace (not add) the history entry: Back after signing in should leave Account, not show the form again.
    try {
      history.replaceState(null, '', location.pathname + '#/');
    } catch (e) {
      location.hash = '#/';
      return;
    }
    route();
  }

  // ---- Back to the app (Google sign-in for the Android apps happens here, in the real browser) ----
  async function renderHandoff() {
    const which = handoffApp();
    const scheme = APP_SCHEMES[which];
    const appName = which === 'business' ? 'Sasta Dawa for Pharmacies' : 'Sasta Dawa';
    setTitle(tr('Return to the app'));
    app.innerHTML = `
      <section class="auth view handoff">
        <div class="card handoff-card">
          <h1 class="view-title">${esc(tr('Taking you back to the {app} app…', { app: appName }))}</h1>
          <p>${tr('Signed in as {name}', { name: `<b>${esc(S.user.name)}</b>` })}${S.user.email ? ' (<span dir="ltr">' + esc(S.user.email) + '</span>)' : ''}.</p>
          <div id="handoff-body">${loadingHtml}</div>
          <div class="actions handoff-alt">
            <button type="button" class="btn btn-ghost" id="handoff-switch">${esc(tr('Not you? Use a different account'))}</button>
            <button type="button" class="btn btn-ghost" id="handoff-stay">${esc(tr('Stay on the website'))}</button>
          </div>
        </div>
      </section>`;
    $('#handoff-switch').addEventListener('click', () => {
      signOutLocal();
      go('#/signin');
    });
    $('#handoff-stay').addEventListener('click', () => {
      ssSet(HANDOFF_KEY, null);
      go('#/');
    });
    const body = $('#handoff-body');
    try {
      const r = await api('app-code', { body: { app: which } });
      const code = String((r && r.code) || '');
      if (!/^[A-Za-z0-9_-]{16,128}$/.test(code)) throw new Error('Could not create a sign-in code for the app. Please try again.');
      const link = scheme + '://auth?code=' + encodeURIComponent(code);
      ssSet(HANDOFF_KEY, null); // the code works once; reloading this page should not loop back to the app
      if (!document.body.contains(body)) return;
      body.innerHTML = `
        <a class="btn btn-primary handoff-btn" id="handoff-open" href="${esc(link)}">${esc(tr('Return to the app'))}</a>
        <p class="small muted">${esc(tr('If the app did not open by itself, press the button above. The sign-in link works once and expires in 5 minutes.'))}</p>`;
      openUrl(link);
    } catch (e) {
      if (e && e.handled) return;
      body.innerHTML = errorHtml(e) + `<div class="actions"><button type="button" class="btn btn-primary" id="handoff-retry">${esc(tr('Try again'))}</button></div>`;
      $('#handoff-retry').addEventListener('click', () => renderHandoff());
    }
  }
  /** Leaves the page for the app's deep link (kept separate so tests can watch it). */
  function openUrl(link) {
    if (typeof window.__sdOpenUrl === 'function') return window.__sdOpenUrl(link);
    try {
      window.location.href = link;
    } catch (e) {
      /* blocked: the "Return to the app" button is there */
    }
  }

  // ===========================================================================
  // Dashboard shell
  // ===========================================================================
  function planBadges(u) {
    const b = [`<span class="badge brand">${esc(tr(ROLE_LABEL[u.role] || u.role))}</span>`];
    if (u.plan !== 'free') b.push(`<span class="badge good">${esc(u.planName)}${u.trial ? ' · ' + esc(tr('free trial')) : ''}</span>`);
    else b.push(`<span class="badge">${esc(tr('Free plan'))}</span>`);
    if (u.joinedCompany) b.push(`<span class="badge">${esc(tr('Staff of {name}', { name: u.joinedCompany.name }))}</span>`);
    return b.join('');
  }

  /** Header line: the sign-in BEFORE this one ("this one" is always now, so it tells you nothing). */
  function lastLoginHtml(u) {
    if (u.prevLogin && u.prevLogin.at) {
      return `<p class="last-login" id="last-login">${esc(tr('Last signed in with {how}', { how: loginText(u.prevLogin) }))} <a href="#/profile" class="small">${esc(tr('Not you?'))}</a></p>`;
    }
    if (u.lastLogin && u.lastLogin.at) return `<p class="last-login" id="last-login">${esc(tr('This is the first sign-in we have recorded for this account.'))}</p>`;
    return '';
  }

  function renderDashboard(tab, rest) {
    const u = S.user;
    const tabs = tabsFor(u.role);
    const label = tr((tabs.find((t) => t[0] === tab) || ['', 'Account'])[1]);
    setTitle(label);
    if (tab !== 'plan') S.payment = ''; // the JazzCash result banner only stays on the Plan tab
    let banner = '';
    if (u.plan !== 'free' && u.trial && u.planUntil) {
      banner = `<div class="notice info no-print">${icInfo}<p>Your free trial of <b>${esc(u.planName)}</b> runs until <b>${esc(fmtDate(u.planUntil))}</b>. <a href="#/plan">Pay to keep it</a>.</p></div>`;
    } else if (u.plan === 'free' && u.paidPlan) {
      banner = `<div class="notice no-print">${icInfo}<p>${tr('You are on the free plan. Paid features are paused. {link}.', { link: `<a href="#/plan">${esc(tr('Choose a plan'))}</a>` })}</p></div>`;
    }
    app.innerHTML = `
      <div class="dash-head no-print">
        <div><h1>${esc(tr('Hi, {name}', { name: u.name }))}</h1><div class="badges">${planBadges(u)}</div>${lastLoginHtml(u)}</div>
      </div>
      ${banner}
      <nav class="tabs no-print" aria-label="${esc(tr('Account sections'))}" style="margin-block-start:14px">
        ${tabs.map((t) => `<a href="#/${t[0]}"${t[0] === tab ? ' aria-current="page"' : ''}>${esc(tr(t[1]))}</a>`).join('')}
      </nav>
      <section id="tab" class="view" aria-label="${esc(label)}"></section>`;
    const el = $('#tab');
    const views = {
      medicines: viewMedicines,
      branches: viewPharmacy,
      clinic: viewClinic,
      optimiser: viewOptimiser,
      patients: viewPatients,
      company: viewCompany,
      claims: viewClaims,
      partners: viewPartners,
      keys: viewKeys,
      plan: viewPlan,
      profile: viewProfile,
    };
    (views[tab] || viewProfile)(el, rest || []);
  }

  // ===========================================================================
  // Profile
  // ===========================================================================
  function viewProfile(el) {
    const u = S.user;
    const noPassword = u.hasPassword === false; // Google-only account (older cached users have no flag: assume a password)
    const gIcon = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4 10-10"/></svg>';
    el.innerHTML = `
      <div class="grid-2">
        <div class="card">
          <h2>${esc(tr('Your details'))}</h2>
          ${u.google || noPassword ? `<div class="signin-with">
            ${noPassword ? `<p class="signin-line"><b>${esc(tr('You sign in with Google.'))}</b></p>` : ''}
            ${u.google ? `<p class="badge good google-connected">${gIcon}${esc(tr('Google connected'))}</p>` : ''}
          </div>` : ''}
          <form class="form" id="profile-form">
            <label class="field">${esc(tr('Email'))}<input class="input" value="${esc(u.email)}" disabled dir="ltr"></label>
            <label class="field">${esc(tr('Name'))}<input class="input" name="name" value="${esc(u.name)}" maxlength="80" required></label>
            <label class="field">${esc(tr('Phone'))}<input class="input" type="tel" name="phone" value="${esc(u.phone || '')}" maxlength="30" dir="ltr"></label>
            <div class="actions"><button type="submit" class="btn btn-primary">${esc(tr('Save'))}</button></div>
            <p class="form-msg" role="status"></p>
          </form>
        </div>
        <div class="card">
          <h2>${esc(tr(noPassword ? 'Set a password' : 'Change password'))}</h2>
          <form class="form" id="password-form">
            ${noPassword ? `<p class="muted" style="margin:0">${esc(tr('Optional. With a password you can also sign in with your email.'))}</p>` : `<label class="field">${esc(tr('Current password'))}<input class="input" type="password" name="current" autocomplete="current-password" required dir="ltr"></label>`}
            <label class="field">${esc(tr(noPassword ? 'Password' : 'New password'))} <small class="muted">${esc(tr('(8+ characters)'))}</small><input class="input" type="password" name="password" autocomplete="new-password" minlength="8" required dir="ltr"></label>
            <div class="actions"><button type="submit" class="btn btn-primary">${esc(tr(noPassword ? 'Set password' : 'Change password'))}</button></div>
            <p class="form-msg" role="status"></p>
            ${noPassword ? '' : `<p class="small muted" style="margin:0">${esc(tr('Changing your password signs you out on your other devices.'))}</p>`}
          </form>
        </div>
      </div>
      <div class="card" id="signin-activity">
        <h2>${esc(tr('Sign-in activity'))}</h2>
        ${u.lastLogin || u.prevLogin ? `<dl class="kv">
          ${u.lastLogin ? `<dt>${esc(tr('This time'))}</dt><dd id="login-now">${esc(loginText(u.lastLogin))}</dd>` : ''}
          <dt>${esc(tr('Last time'))}</dt><dd id="login-prev">${u.prevLogin ? esc(loginText(u.prevLogin)) : esc(tr('No earlier sign-in recorded.'))}</dd>
        </dl>
        <p class="small muted">${esc(tr(SIGNIN_NOTE))}</p>`
        : `<p class="muted">${esc(tr('We will show here how and when you last signed in, so you can spot a sign-in that was not you.'))}</p>`}
      </div>
      <div class="card" id="your-data">
        <h2>${esc(tr('Your data'))}</h2>
        <p class="muted">${esc(tr('Download a copy of everything we keep about your account (profile, pharmacies, reservations, refill customers, payments and statistics) as a JSON file.'))}</p>
        <div class="actions"><button type="button" class="btn btn-ghost" id="export-data">${esc(tr(nFiles() ? 'Save or share my data' : 'Download my data'))}</button></div>
        <p class="form-msg" id="export-msg" role="status"></p>
        <p class="small muted">${tr('Read our {privacy} and {terms}.', { privacy: `<a href="privacy.html">${esc(tr('Privacy Policy'))}</a>`, terms: `<a href="terms.html">${esc(tr('Terms of Service'))}</a>` })}</p>
      </div>
      <div class="card">
        <h2>${esc(tr('Sign out'))}</h2>
        <div class="actions">
          <button type="button" class="btn btn-ghost" id="signout">${esc(tr('Sign out'))}</button>
          <button type="button" class="btn btn-ghost" id="signout-all">${esc(tr('Sign out everywhere'))}</button>
        </div>
        <p class="form-msg" id="signout-msg" role="status"></p>
      </div>
      <div class="card">
        <h2>${esc(tr('Delete account'))}</h2>
        <p class="muted">${LANG === 'ur' ? esc(tr('This permanently deletes your account and saved data. It cannot be undone. You may want to download your data first.')) : `This permanently deletes your account${u.role === 'pharmacy' ? ', your pharmacy listings' : ''}${u.role === 'developer' ? ', your API keys' : ''} and saved data. It cannot be undone. You may want to download your data first.`} <a href="delete-account.html">${esc(tr('What is deleted and when'))}</a>.</p>
        <form class="form" id="delete-form">
          ${noPassword
            ? `<label class="field">${esc(tr('Type DELETE to confirm'))}<input class="input" name="confirm" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="10" required dir="ltr"></label>`
            : `<label class="field">${esc(tr('Your password'))}<input class="input" type="password" name="password" autocomplete="current-password" required dir="ltr"></label>`}
          <label class="check"><input type="checkbox" name="sure" value="1"> <span>${esc(tr('I understand this cannot be undone'))}</span></label>
          <div class="actions"><button type="submit" class="btn btn-danger">${esc(tr('Delete my account'))}</button></div>
          <p class="form-msg" role="alert"></p>
        </form>
      </div>`;

    onSubmit($('#profile-form', el), async (fd, out) => {
      await api('update-profile', { body: { name: val(fd, 'name'), phone: val(fd, 'phone') } });
      msg(out, 'Saved.', true);
      $('.dash-head h1').textContent = tr('Hi, {name}', { name: S.user.name });
    });
    onSubmit($('#password-form', el), async (fd, out) => {
      const pw = String(fd.get('password') || '');
      if (pw.length < 8) return msg(out, noPassword ? 'Password must be at least 8 characters.' : 'New password must be at least 8 characters.');
      const body = { password: pw };
      if (!noPassword) body.current = String(fd.get('current') || '');
      const r = await api('change-password', { body });
      if (r.token) setSession(r.token);
      if (noPassword) {
        setSession(undefined, Object.assign({}, S.user, { hasPassword: true }));
        toast('Password set. You can now also sign in with your email.');
        viewProfile(el); // the form becomes "Change password" and delete asks for the password
        return;
      }
      $('#password-form', el).reset();
      msg(out, 'Password changed.', true);
    });
    $('#export-data', el).addEventListener('click', async (ev) => {
      const out = $('#export-msg', el);
      const btn = ev.currentTarget;
      btn.disabled = true;
      msg(out, 'Preparing your file…', true);
      try {
        const data = await api('export', { raw: true });
        const r = await downloadFile('sasta-dawa-my-data-' + today() + '.json', JSON.stringify(data, null, 2), 'application/json');
        // Only claim success when the file really went somewhere (the app's save/share can fail or be refused).
        if (!r.ok) msg(out, r.error || 'Could not save the file. Please try again.');
        else msg(out, r.native ? 'File ready. Choose where to keep it (Files, Drive or WhatsApp). Keep it somewhere safe: it contains your personal details.' : 'Downloaded. Keep the file somewhere safe: it contains your personal details.', true);
      } catch (e) {
        if (!e.handled) msg(out, e.message);
      } finally {
        btn.disabled = false;
      }
    });
    $('#signout', el).addEventListener('click', () => {
      signOutLocal();
      toast('Signed out.');
      go('#/signin');
    });
    $('#signout-all', el).addEventListener('click', async () => {
      try {
        await api('logout-all', { body: {} });
        signOutLocal();
        toast('Signed out on all devices.');
        go('#/signin');
      } catch (e) {
        if (!e.handled) msg($('#signout-msg', el), e.message);
      }
    });
    onSubmit($('#delete-form', el), async (fd, out) => {
      if (noPassword && val(fd, 'confirm').toUpperCase() !== 'DELETE') return msg(out, 'Type DELETE in the box to confirm.');
      if (!fd.get('sure')) return msg(out, 'Tick the box to confirm.');
      await api('delete-account', { body: noPassword ? { confirm: 'DELETE' } : { password: String(fd.get('password') || '') } });
      signOutLocal();
      toast('Your account has been deleted.');
      go('#/signup');
    });
  }

  // ===========================================================================
  // Plan & billing (+ join company)
  // ===========================================================================
  /** Banner for the result of an online JazzCash payment (set by route() from #/plan?payment=...). */
  function paymentBanner(u) {
    const s = S.payment;
    if (!s) return '';
    const okIc = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l4 4 10-10"/></svg>';
    if (s === 'success') {
      const until = u && u.planUntil && !u.trial ? fmtDate(u.planUntil) : '';
      return `<div class="pay-result good" role="status" tabindex="-1" id="pay-result">${okIc}<div><p class="pay-result-h">Payment received — ${until ? `your plan is active until ${esc(until)}.` : 'thank you. Your plan is now active.'}</p></div></div>`;
    }
    const wa = `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent('Assalam o Alaikum, my online JazzCash payment for Sasta Dawa did not go through. My account email: ' + ((u && u.email) || ''))}`;
    if (s === 'failed') {
      return `<div class="pay-result bad" role="alert" tabindex="-1" id="pay-result">${icInfo}<div><p class="pay-result-h">Payment did not go through. You were not charged.</p><p>Please try again, or pay by transfer and enter the transaction ID below.</p></div></div>`;
    }
    return `<div class="pay-result bad" role="alert" tabindex="-1" id="pay-result">${icInfo}<div><p class="pay-result-h">Payment did not go through.</p><p>Please try again, or pay by transfer and enter the transaction ID below. If money left your JazzCash account, <a href="${esc(wa)}" rel="noopener">message us on WhatsApp</a> and we will sort it out.</p></div></div>`;
  }

  /** Posts the browser to the payment page: a hidden form with one hidden input per field from the server. */
  function submitGatewayForm(form) {
    if (!form || !/^https:\/\//i.test(String(form.action || '')) || !form.fields || typeof form.fields !== 'object') {
      throw new Error('Could not open JazzCash. Please try again, or pay by transfer below.');
    }
    const f = document.createElement('form');
    f.method = 'POST';
    f.action = form.action;
    f.style.display = 'none';
    f.setAttribute('aria-hidden', 'true');
    Object.keys(form.fields).forEach((k) => {
      const i = document.createElement('input');
      i.type = 'hidden';
      i.name = k;
      i.value = form.fields[k] == null ? '' : String(form.fields[k]);
      f.appendChild(i);
    });
    document.body.appendChild(f);
    f.submit();
    return f;
  }

  function viewPlan(el) {
    into(el, async () => {
      const [pl, pays] = await Promise.all([getPlans(), api('payments')]);
      const u = S.user;
      const mine = Object.entries(pl.plans).filter(([k, p]) => k !== 'free' && p.roles.includes(u.role));
      const pay = pl.payTo || {};
      const hasPay = pay.jazzcash || pay.easypaisa || pay.bank;
      const online = !!(pl.online && pl.online.jazzcash);
      const per = (p) => (p.period === 'year' ? 'year' : 'month');
      const statusBadge = (s) => `<span class="badge ${s === 'approved' ? 'good' : s === 'rejected' ? 'bad' : 'warn'}">${esc(s === 'pending' ? 'Waiting for approval' : s)}</span>`;
      const METHOD = { jazzcash: 'JazzCash', easypaisa: 'Easypaisa', bank: 'Bank transfer', jazzcash_online: 'JazzCash online' };

      el.innerHTML = `
        ${paymentBanner(u)}
        <div class="grid-2">
          <div class="card">
            <h2>${esc(tr('Your plan'))}</h2>
            <p><b>${esc(u.plan === 'free' ? tr('Free plan') : u.planName)}</b>${u.trial ? ` <span class="badge warn">${esc(tr('Free trial'))}</span>` : ''}</p>
            ${u.planUntil ? `<p class="muted">${esc(tr(u.trial ? 'Trial ends' : 'Paid until'))} <b>${esc(fmtDate(u.planUntil))}</b>.</p>` : `<p class="muted">${esc(tr('No paid plan is active.'))}</p>`}
            ${mine.length ? `<h3>Plans for your account</h3><ul class="items" style="list-style:none;padding:0;margin:0">${mine.map(([, p]) => `<li class="item"><div class="item-top"><span class="item-title">${esc(p.name)}</span><b>${esc(rs(p.price))} / ${per(p)}</b></div></li>`).join('')}</ul>
            <p class="small muted" style="margin-block-start:10px">What each plan includes: <a href="business">see all plans</a>.</p>` : `<p class="muted">${esc(tr('Personal accounts are free. You can still join your employer\'s benefit below.'))}</p>`}
          </div>
          ${mine.length ? `<div class="card">
            <h2>Pay for your plan</h2>
            <div class="form pay-choice">
              <div class="form-row">
                <label class="field">Plan<select class="input select" name="plan" id="pay-plan">${mine.map(([k, p]) => `<option value="${esc(k)}"${k === u.paidPlan ? ' selected' : ''}>${esc(p.name)} (${esc(rs(p.price))}/${per(p)})</option>`).join('')}</select></label>
                <label class="field">Pay for<select class="input select" name="periods" id="pay-periods">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1} period${i ? 's' : ''}</option>`).join('')}</select></label>
              </div>
              <p class="pay-total">Amount: <b id="pay-amount"></b></p>
            </div>
            ${online ? `<div class="pay-online">
              <button type="button" class="btn btn-primary btn-lg pay-online-btn" id="pay-online">Pay online with JazzCash</button>
              <p class="small muted" style="margin:0">You pay on the JazzCash page, then come back here. Your plan starts as soon as the payment goes through.</p>
              <p class="form-msg" id="pay-online-msg" role="alert"></p>
            </div>
            <h3 class="pay-or">Or pay by transfer and enter the transaction ID</h3>` : ''}
            ${hasPay ? `<div class="pay-box">
                ${pay.title ? `<div>Account title: <b>${esc(pay.title)}</b></div>` : ''}
                ${pay.jazzcash ? `<div>JazzCash: <b>${esc(pay.jazzcash)}</b></div>` : ''}
                ${pay.easypaisa ? `<div>Easypaisa: <b>${esc(pay.easypaisa)}</b></div>` : ''}
                ${pay.bank ? `<div>Bank transfer: <b>${esc(pay.bank)}</b></div>` : ''}
              </div>
              <p class="small muted" style="margin-block-start:8px">Send the amount, then enter the transaction ID below. We activate your plan after checking the payment (usually within a day).</p>`
              : `<p>To pay, contact us on <a href="https://wa.me/${WA_NUMBER}?text=${encodeURIComponent('Assalam o Alaikum, I want to pay for my Sasta Dawa plan. My account email: ' + u.email)}" rel="noopener">WhatsApp ${WA_TEXT}</a> and we will send payment details. Then enter the transaction ID here.</p>`}
            <form class="form" id="pay-form" style="margin-block-start:14px">
              <div class="form-row">
                <label class="field">Paid with<select class="input select" name="method"><option value="jazzcash">JazzCash</option><option value="easypaisa">Easypaisa</option><option value="bank">Bank transfer</option></select></label>
                <label class="field">Transaction ID<input class="input" name="txnId" maxlength="60" required></label>
              </div>
              <label class="field">Phone you paid from<input class="input" type="tel" name="payerPhone" maxlength="30" value="${esc(u.phone || '')}"></label>
              <div class="actions"><button type="submit" class="btn btn-primary">Submit payment</button></div>
              <p class="form-msg" role="status"></p>
            </form>
          </div>` : ''}
        </div>
        ${mine.length ? `<div class="card">
          <h2>My payments</h2>
          ${pays.payments.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Plan</th><th class="n">Amount</th><th>Method</th><th>Transaction</th><th>Status</th></tr></thead><tbody>
            ${pays.payments.map((p) => `<tr><td>${esc(fmtDate(p.at))}</td><td>${esc((pl.plans[p.plan] || {}).name || p.plan)} × ${esc(p.periods)}</td><td class="n">${esc(rs(p.amount))}</td><td>${esc(METHOD[p.method] || p.method)}</td><td>${esc(p.txnId)}</td><td>${statusBadge(p.status)}</td></tr>`).join('')}
          </tbody></table></div>` : '<p class="empty-note">No payments yet.</p>'}
        </div>` : ''}
        <div class="card">
          <h2>${esc(tr('Join company benefit'))}</h2>
          ${u.joinedCompany ? `<p>${tr('You are part of {name} (code {code}).', { name: `<b>${esc(u.joinedCompany.name)}</b>`, code: `<span dir="ltr">${esc(u.joinedCompany.code)}</span>` })}</p>` : `<p class="muted">${esc(tr('If your employer or insurer gave you a Sasta Dawa company code, enter it here.'))}</p>`}
          <form class="form" id="join-form">
            <label class="field">${esc(tr('Company code'))}<input class="input" name="code" maxlength="20" autocomplete="off" style="text-transform:uppercase" dir="ltr"></label>
            <div class="actions"><button type="submit" class="btn btn-ghost">${esc(tr('Join company'))}</button></div>
            <p class="form-msg" role="status"></p>
          </form>
        </div>`;

      const pr = $('#pay-result', el);
      if (pr && pr.focus) pr.focus();
      const pf = $('#pay-form', el);
      if (pf) {
        const planSel = $('#pay-plan', el);
        const perSel = $('#pay-periods', el);
        const upd = () => {
          const p = pl.plans[planSel.value];
          const n = Number(perSel.value);
          $('#pay-amount', el).textContent = p ? `${rs(p.price * n)} (${n} ${per(p)}${n > 1 ? 's' : ''})` : '';
        };
        planSel.addEventListener('change', upd);
        perSel.addEventListener('change', upd);
        upd();
        const ob = $('#pay-online', el);
        if (ob) {
          ob.addEventListener('click', async () => {
            const out = $('#pay-online-msg', el);
            ob.disabled = true;
            msg(out, 'Opening JazzCash…', true);
            try {
              const r = await api('pay-online', { body: { plan: planSel.value, periods: Number(perSel.value) } });
              submitGatewayForm(r && r.form);
            } catch (e) {
              ob.disabled = false;
              if (!e || !e.handled) msg(out, (e && e.message) || 'Could not open JazzCash. Please try again, or pay by transfer below.');
            }
          });
        }
        onSubmit(pf, async (fd, out) => {
          if (val(fd, 'txnId').length < 4) return msg(out, 'Enter the transaction ID from your payment SMS.');
          await api('pay', { body: { plan: planSel.value, periods: Number(perSel.value), method: val(fd, 'method'), txnId: val(fd, 'txnId'), payerPhone: val(fd, 'payerPhone') } });
          toast('Payment submitted. We will activate your plan after checking it.');
          viewPlan(el);
        });
      }
      onSubmit($('#join-form', el), async (fd, out) => {
        const code = val(fd, 'code').toUpperCase();
        if (!/^[A-Z0-9]{4,12}$/.test(code)) return msg(out, 'Enter the code exactly as your company gave it.');
        await api('join-company', { body: { code } });
        toast(tr('You joined {name}.', { name: S.user.joinedCompany.name }));
        renderDashboard('plan');
      });
    });
  }

  // ===========================================================================
  // Patient: My Medicines
  // ===========================================================================
  function viewMedicines(el) {
    into(el, async () => {
      const r = await api('me');
      const cab = r.user.cabinet || [];
      let engine = null;
      if (cab.length) {
        try {
          engine = await loadEngine();
        } catch (e) {
          engine = null;
        }
      }
      el.innerHTML = `
        <div class="card">
          <h2>${esc(tr('My Medicines'))}</h2>
          <p class="muted">${tr('This list syncs from {mm} on the main site and app while you are signed in, so it is safe if you change phones.', { mm: `<b>${esc(tr('My Medicines'))}</b>` })}</p>
          ${cab.length ? `<div class="items">${cab.map((c) => {
            const m = engine && engine.byId(c.id);
            const cost = m ? m.unitPrice * (c.perDay || 1) * 30 : 0;
            return `<div class="item"><div class="item-top"><div><div class="item-title">${esc(m ? medLabel(m) : c.id)}</div><div class="item-meta">${esc(m ? medMeta(m) : '')}</div></div>
              <div class="n" style="text-align:end">${m ? `<b>${esc(rs(cost))}</b><div class="item-meta">${esc(tr('a month at {n}/day', { n: c.perDay || 1 }))}</div>` : ''}</div></div></div>`;
          }).join('')}</div>` : `<p class="empty-note">${esc(tr('No medicines saved yet.'))}</p>`}
          <div class="actions" style="margin-block-start:14px"><a class="btn btn-primary" href="${esc(mainLink('#/my-medicines'))}">${esc(tr('Open My Medicines'))}</a><a class="btn btn-ghost" href="${esc(mainLink(''))}">${esc(tr('Search medicines'))}</a></div>
        </div>`;
    });
  }

  // ===========================================================================
  // Medicine picker (search with the site's engine)
  // ===========================================================================
  /** Renders a search box into `host`; calls onPick(med) when the user adds a result. */
  function medPicker(host, onPick, opts) {
    const o = opts || {};
    const id = 'pk' + Math.random().toString(36).slice(2, 8);
    host.innerHTML = `<div class="picker">
      <label class="field" for="${id}">${esc(o.label || 'Search a medicine')}</label>
      <input class="input" id="${id}" type="search" autocomplete="off" placeholder="e.g. Panadol, Augmentin, Omeprazole" style="margin-block-start:6px">
      <ul class="picker-results" aria-live="polite"></ul></div>`;
    const input = $('input', host);
    const list = $('ul', host);
    let found = [];
    let timer = null;
    const run = async () => {
      const q = input.value.trim();
      if (q.length < 2) {
        list.innerHTML = '';
        return;
      }
      let engine;
      try {
        engine = await loadEngine();
      } catch (e) {
        list.innerHTML = '<li>Could not load the medicine list. Check your connection.</li>';
        return;
      }
      // Same typo / Urdu / Roman Urdu tolerance as the main search ("brufin" → Brufen)
      let note = '';
      let hits = engine.search(q, { limit: 12 });
      if (!hits.length && typeof engine.resolve === 'function') {
        const res = engine.resolve(q, { limit: 12 });
        hits = res.results || [];
        if (hits.length && res.query && res.query !== q) note = `<li class="muted">Showing results for <b>${esc(res.query)}</b></li>`;
      }
      found = hits.map((r) => r.med).filter(Boolean);
      list.innerHTML = found.length
        ? note + found.map((m, i) => `<li><div class="pr-main"><div class="pr-name">${esc(medLabel(m))}</div><div class="pr-meta">${esc(medMeta(m))} · ${esc(rs2(m.price))}</div></div><button type="button" class="btn btn-soft sm" data-i="${i}" style="min-height:44px">${esc(o.button || 'Add')}</button></li>`).join('')
        : '<li class="muted">No medicine found. Try the brand or formula name.</li>';
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(run, 150);
    });
    input.addEventListener('focus', () => loadEngine().catch(() => {}));
    list.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-i]');
      if (!b) return;
      const m = found[Number(b.dataset.i)];
      if (m) onPick(m);
      if (o.clear !== false) {
        input.value = '';
        list.innerHTML = '';
        input.focus();
      }
    });
  }

  // ===========================================================================
  // Pharmacy
  // ===========================================================================
  async function myPharmacies(fresh) {
    if (!S.pharmacies || fresh) S.pharmacies = (await api('my-pharmacies')).pharmacies;
    return S.pharmacies;
  }
  const verifiedBadge = (p) => (p.verified ? '<span class="badge good">✓ Verified</span>' : '<span class="badge warn">Pending verification by Sasta Dawa team</span>');

  function viewPharmacy(el, rest) {
    const pid = rest[0];
    if (!pid) return pharmacyList(el);
    if (pid === 'new') return pharmacyForm(el, null);
    into(el, async () => {
      const list = await myPharmacies();
      const p = list.find((x) => x.id === pid);
      if (!p) throw new Error('Pharmacy not found.');
      const sub = rest[1] || 'dashboard';
      const subs = [
        ['dashboard', 'Dashboard'],
        ['stock', 'Stock & prices'],
        ['bulk', 'Bulk upload'],
        ['alerts', 'Request alerts'],
        ['reservations', 'Reservations'],
        ['refills', 'Refill customers'],
        ['report', 'Monthly report'],
        ['competitors', 'Competitor prices'],
        ['offer', 'Staff discount'],
        ['qr', 'QR sticker'],
        ['edit', 'Edit details'],
      ];
      el.innerHTML = `
        <div class="no-print" style="margin-block-end:10px">
          <a class="back-link" href="#/branches">← All branches</a>
          <div class="item-top"><h2 style="margin:4px 0;font-size:20px;overflow-wrap:anywhere">${esc(p.name)}</h2><div class="badges">${verifiedBadge(p)}</div></div>
          <p class="item-meta" style="margin:0">${esc([p.address, p.area, p.city].filter(Boolean).join(', '))}</p>
        </div>
        <nav class="tabs sub no-print" aria-label="Branch sections">${subs.map((s) => `<a href="#/branch/${esc(p.id)}/${s[0]}"${s[0] === sub ? ' aria-current="page"' : ''}>${esc(s[1])}</a>`).join('')}</nav>
        <div id="branch-view"></div>`;
      const bv = $('#branch-view', el);
      const fns = { dashboard: branchStats, stock: branchStock, bulk: branchBulk, alerts: branchAlerts, reservations: branchReservations, refills: branchRefills, report: branchReport, competitors: branchCompetitors, offer: branchOffer, qr: branchQr, edit: (v, x) => pharmacyForm(v, x) };
      (fns[sub] || branchStats)(bv, p, rest.slice(2));
    });
  }

  function pharmacyList(el) {
    into(el, async () => {
      const list = await myPharmacies(true);
      const premium = S.user.plan === 'pharmacy_premium';
      el.innerHTML = `
        <div class="card">
          <div class="item-top"><h2>Your branches</h2>${!list.length || premium ? '<a class="btn btn-primary" href="#/branch/new">Add branch</a>' : ''}</div>
          ${list.length ? `<div class="items">${list.map((p) => `
            <div class="item">
              <div class="item-top"><div><div class="item-title">${esc(p.name)}</div><div class="item-meta">${esc([p.address, p.area, p.city].filter(Boolean).join(', '))}</div></div><div class="badges">${verifiedBadge(p)}${p.featured ? '<span class="badge brand">Featured</span>' : ''}${p.delivery ? '<span class="badge brand">Delivery</span>' : ''}</div></div>
              <div class="item-meta">${esc(Object.keys(p.stock || {}).length)} medicines listed${p.hours ? ' · ' + esc(p.hours) : ''}</div>
              <div class="actions"><a class="btn btn-primary sm" style="min-height:44px" href="#/branch/${esc(p.id)}/dashboard">Open</a><a class="btn btn-ghost sm" style="min-height:44px" href="#/branch/${esc(p.id)}/stock">Stock & prices</a><a class="btn btn-ghost sm" style="min-height:44px" href="#/branch/${esc(p.id)}/edit">Edit</a></div>
            </div>`).join('')}</div>` : '<p class="empty-note">Add your pharmacy so people nearby can find you, see what is in stock and contact you on WhatsApp.</p>'}
          ${list.length && !premium ? '<p class="small muted" style="margin-block-start:12px">More than one branch needs <a href="#/plan">Pharmacy Premium</a>.</p>' : ''}
        </div>
        <div class="notice info">${icInfo}<p>New listings appear on the site after a quick check by the Sasta Dawa team (we may call the number you give).</p></div>`;
    });
  }

  function pharmacyForm(el, p) {
    const u = S.user;
    const paid = u.plan === 'pharmacy_pro' || u.plan === 'pharmacy_premium';
    const premium = u.plan === 'pharmacy_premium';
    const x = p || {};
    el.innerHTML = `
      <div class="card">
        ${p ? '' : '<a class="back-link" href="#/branches">← All branches</a>'}
        <h2>${p ? 'Edit branch details' : 'Add a branch'}</h2>
        <form class="form" id="ph-form">
          <label class="field">Pharmacy name<input class="input" name="name" value="${esc(x.name || '')}" maxlength="100" required></label>
          <label class="field">Address<input class="input" name="address" value="${esc(x.address || '')}" maxlength="200" required></label>
          <div class="form-row">
            <label class="field">Area / sector<input class="input" name="area" value="${esc(x.area || '')}" maxlength="60"></label>
            <label class="field">City<input class="input" name="city" value="${esc(x.city || '')}" maxlength="40" required></label>
          </div>
          <div class="form-row">
            <label class="field">Phone<input class="input" type="tel" name="phone" value="${esc(x.phone || '')}" maxlength="30"></label>
            <label class="field">WhatsApp<input class="input" type="tel" name="whatsapp" value="${esc(x.whatsapp || '')}" maxlength="30"></label>
          </div>
          <label class="field">Opening hours<input class="input" name="hours" value="${esc(x.hours || '')}" maxlength="80" placeholder="e.g. 9am – 11pm, open 7 days"></label>
          <div class="form-row">
            <label class="field">Latitude<input class="input" name="lat" inputmode="decimal" value="${esc(x.lat == null ? '' : x.lat)}"></label>
            <label class="field">Longitude<input class="input" name="lng" inputmode="decimal" value="${esc(x.lng == null ? '' : x.lng)}"></label>
          </div>
          <div class="actions"><button type="button" class="btn btn-ghost" id="geo-btn">Use my current location</button><span class="small muted" id="geo-msg">Stand inside the pharmacy for the best result.</span></div>
          <label class="check"><input type="checkbox" name="featured" value="1"${x.featured ? ' checked' : ''}${paid ? '' : ' disabled'}> Show as featured in search results <small>(Pharmacy Pro)</small></label>
          <label class="check"><input type="checkbox" name="delivery" value="1"${x.delivery ? ' checked' : ''}${premium ? '' : ' disabled'}> We offer home delivery <small>(Pharmacy Premium)</small></label>
          <div class="actions"><button type="submit" class="btn btn-primary">${p ? 'Save changes' : 'Add pharmacy'}</button>${p ? '<button type="button" class="btn btn-ghost" id="ph-delete">Delete branch</button>' : ''}</div>
          <p class="form-msg" role="status"></p>
        </form>
      </div>`;
    const f = $('#ph-form', el);
    $('#geo-btn', el).addEventListener('click', () => {
      const gm = $('#geo-msg', el);
      if (!navigator.geolocation) {
        gm.textContent = 'Location is not available on this device. Enter it from Google Maps instead.';
        return;
      }
      gm.textContent = 'Finding your location…';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          f.elements.lat.value = pos.coords.latitude.toFixed(6);
          f.elements.lng.value = pos.coords.longitude.toFixed(6);
          gm.textContent = 'Location added (accuracy about ' + Math.round(pos.coords.accuracy) + ' m).';
        },
        (err) => {
          gm.textContent = err && err.code === 1 ? 'Location permission was denied. You can type the latitude and longitude from Google Maps.' : 'Could not get your location. Try again or type it in.';
        },
        { enableHighAccuracy: true, timeout: 15000 }
      );
    });
    onSubmit(f, async (fd, out) => {
      const body = { name: val(fd, 'name'), address: val(fd, 'address'), area: val(fd, 'area'), city: val(fd, 'city'), phone: val(fd, 'phone'), whatsapp: val(fd, 'whatsapp'), hours: val(fd, 'hours'), lat: val(fd, 'lat'), lng: val(fd, 'lng'), featured: !!fd.get('featured'), delivery: !!fd.get('delivery') };
      if (p) body.id = p.id;
      if (body.name.length < 2 || !body.address || !body.city) return msg(out, 'Name, address and city are required.');
      if (!body.phone && !body.whatsapp) return msg(out, 'Add a phone or WhatsApp number so customers can reach you.');
      if ((body.lat || body.lng) && !(Number(body.lat) >= 23 && Number(body.lat) <= 38 && Number(body.lng) >= 60 && Number(body.lng) <= 78)) return msg(out, 'The location does not look like it is in Pakistan. Check latitude and longitude.');
      const r = await api('save-pharmacy', { body });
      await myPharmacies(true);
      toast(p ? 'Saved.' : 'Pharmacy added. We will verify it soon.');
      go('#/branch/' + r.pharmacy.id + '/dashboard');
    });
    const del = $('#ph-delete', el);
    if (del) {
      del.addEventListener('click', async () => {
        if (!window.confirm('Delete "' + p.name + '"? Its stock list will be removed. This cannot be undone.')) return;
        try {
          await api('delete-pharmacy', { body: { id: p.id } });
          await myPharmacies(true);
          toast('Branch deleted.');
          go('#/branches');
        } catch (e) {
          if (!e.handled) msg($('.form-msg', f), e.message);
        }
      });
    }
  }

  function barChart(days, field) {
    const max = Math.max(1, ...days.map((d) => d[field] || 0));
    return `<div class="chart" role="img" aria-label="Daily ${esc(field)} for the last ${days.length} days">${days
      .map((d) => {
        const v = d[field] || 0;
        return `<div class="bar${v ? '' : ' zero'}" style="block-size:${v ? Math.max(4, Math.round((v / max) * 100)) : 2}%" title="${esc(d.day)}: ${v}"></div>`;
      })
      .join('')}</div><div class="chart-axis"><span>${esc(fmtDate(days[0] && days[0].day))}</span><span>Max ${max}/day</span><span>${esc(fmtDate(days[days.length - 1] && days[days.length - 1].day))}</span></div>`;
  }

  function branchStats(el, p) {
    into(el, async () => {
      const s = await api('stats', { params: { id: p.id } });
      const t = s.totals || {};
      const card = (label, n) => `<div class="stat"><small>${esc(label)}</small><b class="num">${esc(n || 0)}</b></div>`;
      el.innerHTML = `
        <h3 style="margin:0 0 10px">Last 30 days</h3>
        <div class="stat-grid stat-auto">${card('Profile views', t.view)}${card('WhatsApp taps', t.wa)}${card('Calls', t.call)}${card('Directions', t.dir)}${card('Reservations', t.reserve)}${card('Delivery orders', t.delivery)}</div>
        <div class="card"><h3>Daily views</h3>${barChart(s.days || [], 'view')}</div>`;
    });
  }

  // -- Stock & prices
  function branchStock(el, p) {
    const draft = {}; // id -> {s, price, remove}
    el.innerHTML = `
      <div class="card"><div id="stock-picker"></div><p class="small muted" style="margin-block-start:8px">Customers see “in stock” on the medicine page. Your own price shows with Pharmacy Pro.</p></div>
      <div class="card">
        <div class="item-top"><h3>Your stock list</h3><div class="actions"><button type="button" class="btn btn-primary" id="stock-save" disabled>Save changes</button></div></div>
        <p class="form-msg" id="stock-msg" role="status"></p>
        <div id="stock-list">${loadingHtml}</div>
      </div>`;
    const listEl = $('#stock-list', el);
    const saveBtn = $('#stock-save', el);
    let engine = null;
    const current = () => {
      const st = Object.assign({}, p.stock || {});
      Object.entries(draft).forEach(([id, d]) => {
        if (d.remove) delete st[id];
        else st[id] = { s: d.s, price: d.price };
      });
      return st;
    };
    const draw = () => {
      const st = current();
      const ids = Object.keys(st);
      saveBtn.disabled = !Object.keys(draft).length;
      saveBtn.textContent = Object.keys(draft).length ? `Save ${Object.keys(draft).length} change${Object.keys(draft).length > 1 ? 's' : ''}` : 'Save changes';
      if (!ids.length) {
        listEl.innerHTML = '<p class="empty-note">No medicines yet. Search above to add what you keep in stock.</p>';
        return;
      }
      ids.sort((a, b) => medLabel(engine && engine.byId(a)).localeCompare(medLabel(engine && engine.byId(b))));
      listEl.innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Medicine</th><th>Stock</th><th class="n">Your price (Rs)</th><th class="n">DRAP price</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody>${ids
        .map((id) => {
          const m = engine && engine.byId(id);
          const x = st[id];
          const out = x.s === 'out';
          return `<tr data-id="${esc(id)}"><td><b>${esc(m ? medLabel(m) : id)}</b><span class="sub">${esc(m ? m.pack || '' : '')}</span></td>
            <td><div class="seg-toggle" role="group" aria-label="Stock status"><button type="button" class="in" data-s="in" aria-pressed="${!out}">In</button><button type="button" class="out" data-s="out" aria-pressed="${out}">Out</button></div></td>
            <td class="n"><input class="input" type="number" min="0" step="0.01" inputmode="decimal" aria-label="Your price" value="${esc(x.price || '')}" data-price></td>
            <td class="n">${esc(m ? rs2(m.price) : '')}</td>
            <td><button type="button" class="icon-btn" data-remove aria-label="Remove ${esc(m ? medLabel(m) : id)}">✕</button></td></tr>`;
        })
        .join('')}</tbody></table></div>`;
    };
    const touch = (id, change) => {
      const base = draft[id] || (p.stock && p.stock[id] ? { s: p.stock[id].s, price: p.stock[id].price } : { s: 'in' });
      draft[id] = Object.assign({}, base, change);
    };
    listEl.addEventListener('click', (ev) => {
      const tr = ev.target.closest('tr[data-id]');
      if (!tr) return;
      const id = tr.dataset.id;
      const sb = ev.target.closest('button[data-s]');
      if (sb) {
        touch(id, { s: sb.dataset.s });
        draw();
      } else if (ev.target.closest('button[data-remove]')) {
        if (p.stock && p.stock[id]) draft[id] = { remove: true };
        else delete draft[id];
        draw();
      }
    });
    listEl.addEventListener('change', (ev) => {
      if (!ev.target.matches('input[data-price]')) return;
      const id = ev.target.closest('tr').dataset.id;
      const v = Number(ev.target.value);
      touch(id, { price: v > 0 ? v : undefined });
      draw();
    });
    saveBtn.addEventListener('click', async () => {
      const items = Object.entries(draft).map(([id, d]) => (d.remove ? { id, remove: true } : { id, s: d.s, price: d.price }));
      if (!items.length) return;
      saveBtn.disabled = true;
      msg($('#stock-msg', el), '');
      try {
        const r = await api('set-stock', { body: { id: p.id, items } });
        p.stock = r.stock;
        Object.keys(draft).forEach((k) => delete draft[k]);
        msg($('#stock-msg', el), `Saved ${r.changed} change${r.changed === 1 ? '' : 's'}.`, true);
        draw();
      } catch (e) {
        if (e.handled) return;
        if (e.status === 402) {
          $('#stock-msg', el).innerHTML = errorHtml(e);
          $('#stock-msg', el).className = 'form-msg';
        } else msg($('#stock-msg', el), e.message);
        saveBtn.disabled = false;
      }
    });
    loadEngine()
      .then((e) => {
        engine = e;
        medPicker($('#stock-picker', el), (m) => {
          touch(m.id, { s: 'in' });
          draw();
          toast(medLabel(m) + ' added. Remember to save.');
        }, { label: 'Add a medicine you stock' });
        draw();
      })
      .catch(() => {
        listEl.innerHTML = errorHtml(new Error('Could not load the medicine list. Check your connection and reload.'));
      });
  }

  // -- CSV imports (strict templates, checked here first, then all-or-nothing on the server)
  /** Downloads the template from the server (a=csv-template), or the built-in copy when offline. */
  async function downloadTemplate(type) {
    let text = '';
    try {
      const headers = {};
      if (S.token) headers.Authorization = 'Bearer ' + S.token;
      const res = await fetch(API + '/api/account?a=csv-template&type=' + encodeURIComponent(type), { headers, cache: 'no-store' });
      if (res && res.ok) {
        const ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
        if (/csv|text\/plain/i.test(ct) && typeof res.text === 'function') text = await res.text();
        else {
          const j = await res.json();
          text = (j && typeof j.csv === 'string' && j.csv) || '';
        }
      }
    } catch (e) {
      text = '';
    }
    if (!text) text = window.SDCsv.templateCsv(type);
    fileToast(await downloadFile('sasta-dawa-' + type + '-template.csv', text));
  }

  const resultCount = (r) => {
    for (const k of ['imported', 'count', 'created', 'changed', 'added', 'updated']) if (r && typeof r[k] === 'number') return r[k];
    return null;
  };
  function rowErrorsHtml(errors, title) {
    const list = (Array.isArray(errors) ? errors : []).filter((x) => x && typeof x === 'object');
    if (!list.length) return '';
    return `<div class="row-errors"><p class="row-errors-h">${esc(title)} (${esc(list.length)})</p><ul>${list
      .slice(0, 200)
      .map((x) => `<li><b>Row ${esc(x.row)}</b>: ${esc(x.error)}</li>`)
      .join('')}</ul>${list.length > 200 ? `<p class="small muted">Showing the first 200 of ${esc(list.length)}.</p>` : ''}</div>`;
  }

  /**
   * A strict CSV import box. opts: { type, title, intro, send(csv, partial) -> Promise<result>, onDone(result, box) }
   * Steps: download template -> choose file -> checked preview (first 10 rows, every problem listed) -> import.
   * All-or-nothing by default; "import only the valid rows" sends partial:true.
   */
  function csvImport(host, opts) {
    const t = window.SDCsv && window.SDCsv.TEMPLATES[opts.type];
    if (!host) return;
    if (!t) {
      host.innerHTML = errorHtml(new Error('CSV import is not available (js/csvkit.js is not loaded).'));
      return;
    }
    host.innerHTML = `
      <div class="card import-card" data-import="${esc(opts.type)}">
        <h3>${esc(opts.title || 'Import from a spreadsheet (CSV)')}</h3>
        ${opts.intro ? `<p class="muted">${opts.intro}</p>` : ''}
        <p class="small">The first row must be exactly: <code>${esc(t.headers.join(','))}</code></p>
        <div class="actions"><button type="button" class="btn btn-ghost" data-tpl>Download template</button></div>
        <ol class="small muted import-steps">
          <li>Download the template and fill it in (Excel or Google Sheets).</li>
          <li>Save it as <b>CSV</b> (File → Save as / Download → CSV). Up to 2 MB and ${esc(window.SDCsv.MAX_ROWS)} rows.</li>
          <li>Choose the file below, check the preview, then import.</li>
        </ol>
        <label class="field">CSV file<input class="input" type="file" name="file" accept=".csv,text/csv" data-file></label>
        <p class="form-msg" data-msg role="status"></p>
        <div data-preview></div>
      </div>`;
    const card = $('.import-card', host);
    const out = $('[data-msg]', card);
    const prev = $('[data-preview]', card);
    $('[data-tpl]', card).addEventListener('click', () => downloadTemplate(opts.type));
    $('[data-file]', card).addEventListener('change', async (ev) => {
      const file = ev.target.files && ev.target.files[0];
      prev.innerHTML = '';
      msg(out, '');
      if (!file) return;
      let text;
      try {
        text = await window.SDCsv.readCsvFile(file);
      } catch (e) {
        return msg(out, e.message);
      }
      showPreview(text);
    });
    // exposed for tests and for pasting: card.sdLoad(text)
    card.sdLoad = (text) => showPreview(String(text || ''));

    function showPreview(text) {
      const c = window.SDCsv.check(opts.type, text);
      if (c.headerError) {
        prev.innerHTML = `<div class="notice bad">${icInfo}<p>${esc(c.headerError)}</p></div>`;
        return;
      }
      const bad = c.errors.length;
      const good = c.total - bad;
      prev.innerHTML = `
        <div class="import-preview">
          <h4>${esc(c.total)} row${c.total === 1 ? '' : 's'} found · ${bad ? `<span class="bad-txt">${esc(bad)} with problems</span>` : '<span class="save-txt">all look fine</span>'}</h4>
          <p class="small muted">First ${esc(c.preview.length)} rows (row numbers are the rows in your spreadsheet; the header is row 1):</p>
          <div class="table-wrap"><table class="tbl"><thead><tr><th>Row</th>${c.headers.map((h) => `<th>${esc(h)}</th>`).join('')}<th>Check</th></tr></thead><tbody>${c.preview
            .map((r) => `<tr${r.error ? ' class="row-bad"' : ''}><td>${esc(r.row)}</td>${c.headers.map((h, i) => `<td>${esc(r.cells[i] == null ? '' : r.cells[i])}</td>`).join('')}<td>${r.error ? `<span class="badge bad">Problem</span>` : '<span class="badge good">OK</span>'}</td></tr>`)
            .join('')}</tbody></table></div>
          ${rowErrorsHtml(c.errors, 'Rows with problems')}
          ${bad ? `<p class="small">Fix these rows in your spreadsheet and choose the file again, or import only the rows without problems.</p>
          <label class="check"><input type="checkbox" data-partial> Import only the valid rows (skip ${esc(bad)} row${bad === 1 ? '' : 's'} with problems)</label>` : ''}
          <div class="actions"><button type="button" class="btn btn-primary" data-go${bad ? ' disabled' : ''}>Import ${esc(bad ? good : c.total)} row${(bad ? good : c.total) === 1 ? '' : 's'}</button></div>
          <p class="form-msg" data-go-msg role="status"></p>
          <div data-result></div>
        </div>`;
      const goBtn = $('[data-go]', prev);
      const partialBox = $('[data-partial]', prev);
      if (partialBox) partialBox.addEventListener('change', () => (goBtn.disabled = !partialBox.checked || good === 0));
      goBtn.addEventListener('click', async () => {
        const gm = $('[data-go-msg]', prev);
        const resBox = $('[data-result]', prev);
        const partial = !!(partialBox && partialBox.checked);
        goBtn.disabled = true;
        msg(gm, 'Importing…', true);
        resBox.innerHTML = '';
        try {
          const r = await opts.send(text, partial);
          const n = resultCount(r);
          msg(gm, n == null ? 'Import finished.' : `Imported ${n} row${n === 1 ? '' : 's'}.`, true);
          resBox.innerHTML = rowErrorsHtml(r && r.errors, 'Rows skipped');
          if (opts.onDone) opts.onDone(r || {}, resBox);
        } catch (e) {
          if (e.handled) return;
          goBtn.disabled = false;
          if (e.status === 402) {
            gm.innerHTML = errorHtml(e);
            gm.className = 'form-msg';
          } else msg(gm, e.message + (e.data && Array.isArray(e.data.errors) && e.data.errors.length ? ' Nothing was imported.' : ''));
          resBox.innerHTML = rowErrorsHtml(e.data && e.data.errors, 'Rows with problems');
        }
      });
    }
  }

  function branchBulk(el, p) {
    const premium = S.user.plan === 'pharmacy_premium';
    el.innerHTML = `
      ${premium ? '' : '<div class="upgrade" style="margin-block-end:12px"><p>Uploading more than 50 medicines at once needs Pharmacy Premium.</p><div class="actions"><a class="btn btn-primary" href="#/plan">Upgrade</a></div></div>'}
      <div id="bulk-import"></div>`;
    csvImport($('#bulk-import', el), {
      type: 'stock',
      title: 'Bulk upload your stock list',
      intro: 'One row per medicine: <b>medicine</b> (brand and strength, e.g. Panadol 500mg, or the medicine id), <b>status</b> (<code>in</code> or <code>out</code>) and <b>price</b> (your price in Rs, optional).',
      send: (csv, partial) => api('import-stock', { body: { pid: p.id, id: p.id, csv, partial } }),
      onDone: (r) => {
        if (r.stock) p.stock = r.stock;
        S.pharmacies = null;
        toast('Stock list updated.');
      },
    });
  }

  function branchAlerts(el, p) {
    into(el, async () => {
      const r = await api('alerts', { params: { id: p.id } });
      el.innerHTML = `
        <div class="card">
          <h3>What people near ${esc(r.city)} searched for (last 7 days)</h3>
          <p class="small muted">Counts of medicine searches by people looking for pharmacies in your city. No personal data is collected.</p>
          ${r.demand.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Medicine</th><th class="n">Searches</th><th>Your stock</th></tr></thead><tbody>${r.demand
            .map((d) => `<tr><td><b>${esc(d.name)}</b><span class="sub">${esc(d.generic)}</span></td><td class="n">${esc(d.searches)}</td><td>${d.inStock ? '<span class="badge good">In stock</span>' : `<a href="#/branch/${esc(p.id)}/stock">Not listed: add it</a>`}</td></tr>`)
            .join('')}</tbody></table></div>` : '<p class="empty-note">No searches recorded for your city yet. They appear as people use the pharmacy finder.</p>'}
        </div>`;
    });
  }

  function branchReservations(el, p) {
    into(el, async () => {
      const r = await api('reservations', { params: { id: p.id } });
      const pickupLabels = { new: 'New', ready: 'Ready for pickup', collected: 'Collected', cancelled: 'Cancelled' };
      const deliveryLabels = { new: 'New', out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Cancelled' };
      const allLabels = Object.assign({}, pickupLabels, deliveryLabels);
      const waText = (x) => x.type === 'delivery'
        ? `Assalam o Alaikum ${x.name}, this is ${p.name}. We received your delivery order for ${x.medName}${x.qty ? ' × ' + x.qty : ''}. We will bring it to: ${x.address || 'your address'}.`
        : `Assalam o Alaikum ${x.name}, this is ${p.name}. Your ${x.medName} is ready for pickup.`;
      const list = r.reservations;
      el.innerHTML = `
        <div class="card">
          <h3>Reservations and delivery orders</h3>
          ${list.length ? `<div class="items">${list
            .map((x, i) => {
              const labels = x.type === 'delivery' ? deliveryLabels : pickupLabels;
              return `
            <div class="item">
              <div class="item-top"><div><div class="item-title">${esc(x.medName)}${x.qty ? ' × ' + esc(x.qty) : ''}</div><div class="item-meta">${esc(x.name)} · ${esc(x.phone)} · ${esc(fmtTime(x.at))}</div></div>
                <div class="badges" style="margin:0">${x.type === 'delivery' ? '<span class="badge brand">Delivery</span>' : '<span class="badge">Pickup</span>'}<span class="badge ${x.status === 'new' ? 'warn' : x.status === 'cancelled' ? 'bad' : 'good'}">${esc(allLabels[x.status] || x.status)}</span></div></div>
              ${x.type === 'delivery' ? `<div class="item-meta"><b>Deliver to:</b> ${esc(x.address || '(no address given)')}</div>` : ''}
              ${x.note ? `<div class="item-meta">Note: ${esc(x.note)}</div>` : ''}
              <div class="actions">
                <label class="sr-only" for="rs${i}">Status</label>
                <select class="input select" id="rs${i}" data-key="${esc(x.key)}" style="inline-size:auto">${Object.keys(labels).map((k) => `<option value="${k}"${k === x.status ? ' selected' : ''}>${labels[k]}</option>`).join('')}${labels[x.status] ? '' : `<option value="${esc(x.status)}" selected>${esc(allLabels[x.status] || x.status)}</option>`}</select>
                <a class="btn btn-soft" href="${esc(waLink(x.phone, waText(x)))}" target="_blank" rel="noopener">WhatsApp customer</a>
                <a class="btn btn-ghost" href="tel:${esc(String(x.phone || '').replace(/[^\d+]/g, ''))}">Call</a>
                <button type="button" class="btn btn-ghost" data-refill="${i}">Add to refill list</button>
              </div>
            </div>`;
            })
            .join('')}</div>` : '<p class="empty-note">No reservations yet. With Pharmacy Pro, customers can reserve a medicine from your listing. With Pharmacy Premium and home delivery switched on, they can also order for delivery.</p>'}
        </div>`;
      el.onclick = (ev) => {
        const b = ev.target.closest('button[data-refill]');
        if (!b) return;
        const x = list[Number(b.dataset.refill)];
        if (!x) return;
        refillPrefill = { pid: p.id, name: x.name || '', phone: x.phone || '', med: x.med || '', medName: x.medName || '', qty: x.qty || '' };
        go('#/branch/' + p.id + '/refills/new');
      };
      el.onchange = async (ev) => {
        const s = ev.target.closest('select[data-key]');
        if (!s) return;
        try {
          await api('reservation-update', { body: { key: s.dataset.key, status: s.value } });
          toast('Status updated.');
          branchReservations(el, p);
        } catch (e) {
          if (!e.handled) toast(e.message);
        }
      };
    });
  }

  function branchReport(el, p) {
    into(el, async () => {
      const r = await api('report', { params: { id: p.id } });
      const t = r.totals || {};
      const own = String(r.pharmacy.whatsapp || r.pharmacy.phone || p.whatsapp || p.phone || '').replace(/[^\d]/g, '');
      const text = reportText(r);
      el.innerHTML = `
        <div class="card report">
          <div class="item-top"><h2>Monthly report: ${esc(r.pharmacy.name)}</h2>
            <div class="actions no-print">
              <button type="button" class="btn btn-primary" id="print-btn">${esc(printLabel('Print / save as PDF', 'Share report'))}</button>
              ${own ? `<a class="btn btn-soft" id="report-wa" href="${esc(waLink(own, text))}" target="_blank" rel="noopener">Send to my WhatsApp</a>` : ''}
              <button type="button" class="btn btn-ghost" id="report-copy">Copy report</button>
            </div></div>
          <p class="muted">${esc([r.pharmacy.address, r.pharmacy.city].filter(Boolean).join(', '))} · last ${esc(r.period)} · generated ${esc(fmtDate(new Date()))}</p>
          <div class="table-wrap"><table class="tbl"><tbody>
            <tr><td>Profile views</td><td class="n">${esc(t.view || 0)}</td></tr>
            <tr><td>WhatsApp taps</td><td class="n">${esc(t.wa || 0)}</td></tr>
            <tr><td>Calls</td><td class="n">${esc(t.call || 0)}</td></tr>
            <tr><td>Directions</td><td class="n">${esc(t.dir || 0)}</td></tr>
            <tr><td>Pickup reservations</td><td class="n">${esc(t.reserve || 0)}</td></tr>
            <tr><td>Delivery orders</td><td class="n">${esc(t.delivery || 0)}</td></tr>
          </tbody></table></div>
          ${own ? '' : '<p class="small muted no-print">Add a WhatsApp or phone number in Edit details to send this report to yourself on WhatsApp.</p>'}
          <h3 style="margin-block-start:16px">Most searched medicines in ${esc(r.pharmacy.city)}</h3>
          ${r.topDemand.length ? `<ol>${r.topDemand.map((d) => `<li>${esc(d.name)} <span class="muted">(${esc(d.searches)} searches)</span></li>`).join('')}</ol>` : '<p class="muted">No searches recorded yet.</p>'}
          <p class="small muted print-only">Sasta Dawa Finder · sasta-dawa-finder.vercel.app</p>
        </div>`;
      $('#print-btn', el).addEventListener('click', () => printOrShare($('.report', el), 'Monthly report: ' + r.pharmacy.name, 'sasta-dawa-report-' + fileSlug(r.pharmacy.name) + '-' + today() + '.html'));
      $('#report-copy', el).addEventListener('click', () => copyText(text));
    });
  }

  /** Plain-text 30-day summary for WhatsApp / clipboard. */
  function reportText(r) {
    const t = r.totals || {};
    const top = (r.topDemand || []).slice(0, 5);
    return [
      `Sasta Dawa report: ${r.pharmacy.name}`,
      `Last ${r.period} (to ${fmtDate(new Date())})`,
      '',
      `Profile views: ${t.view || 0}`,
      `WhatsApp taps: ${t.wa || 0}`,
      `Calls: ${t.call || 0}`,
      `Directions: ${t.dir || 0}`,
      `Pickup reservations: ${t.reserve || 0}`,
      `Delivery orders: ${t.delivery || 0}`,
      '',
      top.length ? `Most requested medicines in ${r.pharmacy.city}:` : `No medicine searches recorded in ${r.pharmacy.city} yet.`,
      ...top.map((d, i) => `${i + 1}. ${d.name} (${d.searches} searches)`),
    ].join('\n');
  }

  // -- Refill customers (regular customers and when their medicine runs out)
  let refillPrefill = null; // set by "Add to refill list" on a reservation

  function refillReminder(c, p) {
    const meds = (c.meds || []).map((m) => m.name + (m.qty ? ' (' + m.qty + ')' : '')).join(', ') || 'your regular medicines';
    return `Assalam o Alaikum ${c.name}, this is ${p.name}. Aap ki dawai (${meds}) khatam hone wali hai. Kya hum aap ke liye tayyar rakh dein?\n\nYour medicines (${meds}) are due for a refill. Reply here and we will keep them ready for you. Shukriya!`;
  }

  function branchRefills(el, p, rest) {
    const sub = (rest && rest[0]) || '';
    if (sub === 'import') return refillImport(el, p);
    if (sub) return refillForm(el, p, sub);
    into(el, async () => {
      const r = await api('refills', { params: { id: p.id } });
      const cs = r.customers || [];
      const due = cs.filter((c) => c.due || c.overdue);
      const later = cs.filter((c) => !c.due && !c.overdue);
      const row = (c) => `
        <div class="item">
          <div class="item-top"><div><div class="item-title">${esc(c.name)}</div><div class="item-meta">${esc(c.phone)} · every ${esc(c.every)} days</div></div>
            <div class="badges" style="margin:0">${c.overdue ? '<span class="badge bad">Overdue</span>' : c.due ? '<span class="badge warn">Due soon</span>' : ''}<span class="badge">Next: ${esc(fmtDate(c.nextDue))}</span></div></div>
          <div class="item-meta">${(c.meds || []).map((m) => esc(m.name) + (m.qty ? ' × ' + esc(m.qty) : '')).join(', ') || 'No medicines added'}</div>
          ${c.note ? `<div class="item-meta">Note: ${esc(c.note)}</div>` : ''}
          <div class="item-meta">Last refilled ${esc(fmtDate(c.lastAt || c.at))}</div>
          <div class="actions">
            <a class="btn btn-soft" href="${esc(waLink(c.phone, refillReminder(c, p)))}" target="_blank" rel="noopener">Remind on WhatsApp</a>
            <button type="button" class="btn btn-primary" data-refilled="${esc(c.id)}">Mark refilled</button>
            <a class="btn btn-ghost" href="#/branch/${esc(p.id)}/refills/${esc(c.id)}">Edit</a>
          </div>
        </div>`;
      el.innerHTML = `
        <div class="card">
          <div class="item-top"><h3>Refill customers (${esc(cs.length)})</h3><div class="actions"><a class="btn btn-ghost" href="#/branch/${esc(p.id)}/refills/import">Import from CSV</a><a class="btn btn-primary" href="#/branch/${esc(p.id)}/refills/new">Add customer</a></div></div>
          <p class="small muted">Keep a list of regular customers and how often they need their medicines. Customers due in the next 3 days are shown first. Only your account can see this list. Pharmacy Pro: up to 200 customers; Premium: more.</p>
          <p class="form-msg" id="refill-msg" role="status"></p>
          ${cs.length ? `
            ${due.length ? `<h3 style="margin-block-start:8px">Due now (${esc(due.length)})</h3><div class="items">${due.map(row).join('')}</div>` : '<p class="small muted">Nobody is due in the next 3 days.</p>'}
            ${later.length ? `<h3 style="margin-block-start:16px">Later</h3><div class="items">${later.map(row).join('')}</div>` : ''}`
            : '<p class="empty-note">No refill customers yet. Add regular customers (for example blood-pressure or diabetes patients) to remind them on WhatsApp before their medicine runs out.</p>'}
        </div>`;
      el.onclick = async (ev) => {
        const b = ev.target.closest('button[data-refilled]');
        if (!b) return;
        b.disabled = true;
        try {
          await api('mark-refilled', { body: { pid: p.id, id: b.dataset.refilled } });
          toast('Marked as refilled.');
          branchRefills(el, p, []);
        } catch (e) {
          if (e.handled) return;
          b.disabled = false;
          const m = $('#refill-msg', el);
          if (e.status === 402) {
            m.innerHTML = errorHtml(e);
            m.className = 'form-msg';
          } else msg(m, e.message);
        }
      };
    });
  }

  function refillImport(el, p) {
    el.onclick = null;
    el.innerHTML = `<p class="no-print"><a class="back-link" href="#/branch/${esc(p.id)}/refills">← Refill customers</a></p><div id="refill-import"></div>`;
    csvImport($('#refill-import', el), {
      type: 'refills',
      title: 'Import refill customers',
      intro: 'One row per customer: <b>name</b>, <b>phone</b>, <b>medicines</b> (separate several with <code>;</code>), <b>every_days</b> (how often they need a refill) and <b>last_refill_date</b> (like 2026-11-01, optional).',
      send: (csv, partial) => api('import-refills', { body: { pid: p.id, id: p.id, csv, partial } }),
      onDone: (r, box) => {
        toast('Refill customers imported.');
        box.insertAdjacentHTML('beforeend', `<div class="actions"><a class="btn btn-primary" href="#/branch/${esc(p.id)}/refills">See refill customers</a></div>`);
      },
    });
  }

  function refillForm(el, p, cid) {
    el.onclick = null;
    into(el, async () => {
      let c = null;
      if (cid !== 'new') {
        const r = await api('refills', { params: { id: p.id } });
        c = (r.customers || []).find((x) => x.id === cid) || null;
        if (!c) throw new Error('Customer not found.');
      }
      const pre = !c && refillPrefill && refillPrefill.pid === p.id ? refillPrefill : null;
      refillPrefill = null;
      const meds = c ? c.meds.map((m) => ({ id: m.id, name: m.name, qty: m.qty || '' })) : [];
      let engine = null;
      try {
        engine = await loadEngine();
      } catch (e) {
        engine = null;
      }
      if (pre && pre.med && engine && engine.byId(pre.med)) meds.push({ id: pre.med, name: medLabel(engine.byId(pre.med)), qty: pre.qty || '' });
      const x = c || { name: pre ? pre.name : '', phone: pre ? pre.phone : '', every: 30, note: pre && !pre.med && pre.medName ? 'Reserved: ' + pre.medName : '' };
      el.innerHTML = `
        <div class="card">
          <a class="back-link" href="#/branch/${esc(p.id)}/refills">← All refill customers</a>
          <h3>${c ? 'Edit refill customer' : 'Add refill customer'}</h3>
          <form class="form" id="refill-form">
            <div class="form-row">
              <label class="field">Customer name<input class="input" name="name" maxlength="80" value="${esc(x.name)}" required></label>
              <label class="field">Phone / WhatsApp<input class="input" type="tel" name="phone" maxlength="30" value="${esc(x.phone)}" placeholder="03xx xxxxxxx" required></label>
            </div>
            <div id="refill-picker"></div>
            <div id="refill-meds"></div>
            <div class="form-row">
              <label class="field">Refill every (days)<input class="input" type="number" name="every" min="1" max="365" value="${esc(x.every || 30)}" required></label>
              <label class="field">Note <small class="muted">(optional)</small><input class="input" name="note" maxlength="200" value="${esc(x.note || '')}"></label>
            </div>
            <div class="actions"><button type="submit" class="btn btn-primary">${c ? 'Save changes' : 'Add customer'}</button>${c ? '<button type="button" class="btn btn-ghost" id="refill-del">Remove customer</button>' : ''}</div>
            <p class="form-msg" role="status"></p>
          </form>
        </div>`;
      const medsEl = $('#refill-meds', el);
      const draw = () => {
        medsEl.innerHTML = meds.length
          ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Medicine</th><th>Quantity</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody>${meds
              .map((m, i) => `<tr><td>${esc(m.name)}</td><td><input class="input" maxlength="30" value="${esc(m.qty)}" data-qty="${i}" aria-label="Quantity for ${esc(m.name)}" placeholder="e.g. 2 strips"></td><td><button type="button" class="icon-btn" data-rm="${i}" aria-label="Remove ${esc(m.name)}">✕</button></td></tr>`)
              .join('')}</tbody></table></div>`
          : '<p class="small muted">No medicines added yet. Search above to add them.</p>';
      };
      medsEl.addEventListener('input', (ev) => {
        const i = ev.target.dataset.qty;
        if (i != null) meds[Number(i)].qty = ev.target.value;
      });
      medsEl.addEventListener('click', (ev) => {
        const b = ev.target.closest('button[data-rm]');
        if (b) {
          meds.splice(Number(b.dataset.rm), 1);
          draw();
        }
      });
      if (engine) {
        medPicker($('#refill-picker', el), (m) => {
          if (meds.length >= 20) return toast('Up to 20 medicines per customer.');
          if (!meds.some((y) => y.id === m.id)) meds.push({ id: m.id, name: medLabel(m), qty: '' });
          draw();
        }, { label: 'Add a medicine this customer buys' });
      } else $('#refill-picker', el).innerHTML = '<p class="small muted">Could not load the medicine list. Check your connection and reload to add medicines.</p>';
      draw();
      const f = $('#refill-form', el);
      onSubmit(f, async (fd, out) => {
        const body = { pid: p.id, name: val(fd, 'name'), phone: val(fd, 'phone'), meds: meds.map((m) => ({ id: m.id, qty: String(m.qty || '').trim() })), every: Number(val(fd, 'every')) || 30, note: val(fd, 'note') };
        if (c) {
          body.id = c.id;
          body.lastAt = c.lastAt;
        }
        if (!body.name) return msg(out, 'Enter the customer name.');
        if (String(body.phone).replace(/[^\d]/g, '').length < 7) return msg(out, 'Enter a phone number we can send WhatsApp reminders to.');
        if (!(body.every >= 1 && body.every <= 365)) return msg(out, 'Refill every must be between 1 and 365 days.');
        await api('save-refill', { body });
        toast(c ? 'Customer saved.' : 'Customer added to the refill list.');
        go('#/branch/' + p.id + '/refills');
      });
      const del = $('#refill-del', el);
      if (del) {
        del.addEventListener('click', async () => {
          if (!window.confirm('Remove ' + c.name + ' from your refill list?')) return;
          try {
            await api('save-refill', { body: { pid: p.id, id: c.id, remove: true } });
            toast('Customer removed.');
            go('#/branch/' + p.id + '/refills');
          } catch (e) {
            if (!e.handled) msg($('.form-msg', f), e.message);
          }
        });
      }
    });
  }

  // -- Staff discount offer (shown to staff of companies using Sasta Dawa)
  function branchOffer(el, p) {
    const o = p.offer || null;
    el.innerHTML = `
      <div class="card">
        <h3>Staff discount</h3>
        <p class="muted">Offer a discount to staff of companies that use Sasta Dawa for their employees. Your pharmacy then appears in their <b>Partner pharmacies</b> list with your discount, and staff show their company staff card at your counter. Needs Pharmacy Pro and a verified listing.</p>
        ${o && o.percent ? `<p><span class="badge good">Current offer: ${esc(o.percent)}% off</span>${o.note ? ' <span class="muted">' + esc(o.note) + '</span>' : ''}</p>` : '<p class="small muted">No discount offered right now.</p>'}
        <form class="form" id="offer-form">
          <div class="form-row">
            <label class="field">Discount (%) <small class="muted">0 to 50; 0 removes the offer</small><input class="input" type="number" name="percent" min="0" max="50" step="1" value="${esc(o && o.percent ? o.percent : 0)}" required></label>
            <label class="field">Conditions <small class="muted">(optional)</small><input class="input" name="note" maxlength="120" value="${esc((o && o.note) || '')}" placeholder="e.g. On medicines, not on baby milk"></label>
          </div>
          <p class="small muted" style="margin:0">Customers are told: “Show your company staff card”. You decide at the counter whether the card is valid.</p>
          <div class="actions"><button type="submit" class="btn btn-primary">Save discount</button></div>
          <p class="form-msg" role="status"></p>
        </form>
      </div>`;
    onSubmit($('#offer-form', el), async (fd, out) => {
      const percent = Number(val(fd, 'percent'));
      if (!(percent >= 0 && percent <= 50)) return msg(out, 'The discount must be between 0 and 50%.');
      const r = await api('save-offer', { body: { id: p.id, percent: Math.round(percent), note: val(fd, 'note') } });
      p.offer = r.offer;
      S.pharmacies = null;
      toast(r.offer ? 'Discount saved.' : 'Discount removed.');
      branchOffer(el, p);
    });
  }

  function branchCompetitors(el, p) {
    into(el, async () => {
      const r = await api('competitors', { params: { id: p.id } });
      el.innerHTML = `
        <div class="card">
          <h3>Prices at other pharmacies in ${esc(r.city)}</h3>
          <p class="small muted">For medicines on your list that other listed pharmacies also price. Names of other pharmacies are not shown.</p>
          ${r.rows.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Medicine</th><th class="n">Yours</th><th class="n">Average</th><th class="n">Lowest</th><th class="n">Pharmacies</th><th class="n">DRAP price</th></tr></thead><tbody>${r.rows
            .map((x) => `<tr><td>${esc(x.name)}</td><td class="n">${x.yours ? esc(rs2(x.yours)) : '–'}</td><td class="n">${esc(rs2(x.avg))}</td><td class="n">${esc(rs2(x.min))}</td><td class="n">${esc(x.pharmacies)}</td><td class="n">${x.mrp ? esc(rs2(x.mrp)) : ''}</td></tr>`)
            .join('')}</tbody></table></div>` : '<p class="empty-note">No overlapping prices yet. This fills in as more pharmacies in your city add prices.</p>'}
        </div>`;
    });
  }

  function branchQr(el, p) {
    const url = SITE + '/?pharmacy=' + encodeURIComponent(p.id);
    let svg = '';
    try {
      svg = qrSvg(url);
    } catch (e) {
      svg = '';
    }
    el.innerHTML = `
      <div class="actions no-print" style="margin-block-end:12px"><button type="button" class="btn btn-primary" id="qr-print">${esc(printLabel('Print sticker', 'Share sticker'))}</button><span class="small muted">${esc(printLabel('Stick it on your counter so customers can save your pharmacy.', 'Send the picture to a print shop or to your WhatsApp, then stick it on your counter.'))}</span></div>
      <div class="sticker">
        <h2>${esc(p.name)}</h2>
        <p><b>Find us on Sasta Dawa Finder</b></p>
        ${svg}
        <p>Scan to see our stock, prices and WhatsApp</p>
        <p class="url">${esc(url)}</p>
      </div>`;
    $('#qr-print', el).addEventListener('click', async (ev) => {
      if (!canShareFiles()) return window.print();
      const btn = ev.currentTarget;
      btn.disabled = true;
      try {
        const f = nFiles();
        const name = 'sasta-dawa-qr-' + fileSlug(p.name) + '.png';
        const b64 = stickerPng(p, url);
        const r = typeof f.shareImage === 'function' ? await f.shareImage(name, b64) : await f.save(name, 'image/png', b64, { base64: true });
        if (!r || r.ok === false) throw new Error((r && r.error) || '');
        toast('Sticker picture ready. Send it to a print shop, Drive or WhatsApp.');
      } catch (e) {
        toast(tr('Could not open the share options. Please try again.'));
      } finally {
        btn.disabled = false;
      }
    });
  }

  // ===========================================================================
  // Clinic
  // ===========================================================================
  function viewClinic(el) {
    const u = S.user;
    const c = u.clinic || { name: u.name, color: '#0f5c54', note: '', phone: u.phone || '' };
    const widgetUrl = SITE + '/widget?c=' + encodeURIComponent(u.id);
    const embed = `<iframe src="${widgetUrl}" width="100%" height="520" style="border:0"></iframe>`;
    el.innerHTML = `
      <div class="grid-2">
        <div class="card">
          <h2>Widget settings</h2>
          <form class="form" id="clinic-form">
            <label class="field">Name shown on the widget<input class="input" name="name" value="${esc(c.name || '')}" maxlength="80"></label>
            <label class="field">Brand colour<input class="input" type="color" name="color" value="${esc(/^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : '#0f5c54')}"></label>
            <label class="field">Note for patients <small class="muted">(optional)</small><textarea class="input" name="note" maxlength="200" rows="3">${esc(c.note || '')}</textarea></label>
            <div class="form-row">
              <label class="field">Clinic phone<input class="input" type="tel" name="phone" value="${esc(c.phone || '')}" maxlength="30"></label>
              <label class="field">City<input class="input" name="city" value="${esc(c.city || '')}" maxlength="40" placeholder="e.g. Rawalpindi"></label>
            </div>
            <label class="check"><input type="checkbox" name="partners" value="1"${c.partners === false ? '' : ' checked'}> Show partner pharmacies in my widget</label>
            <p class="small muted" style="margin:0">Shows up to 6 verified Sasta Dawa pharmacies in your city under the price checker, so patients know where to buy. Needs the city above.</p>
            <div class="actions"><button type="submit" class="btn btn-primary">Save</button><a class="btn btn-ghost" href="${esc(API ? widgetUrl : 'widget?c=' + encodeURIComponent(u.id))}" target="_blank" rel="noopener">Preview widget</a></div>
            <p class="form-msg" role="status"></p>
          </form>
        </div>
        <div class="card">
          <h2>Add it to your website</h2>
          <p class="muted">Paste this code where you want the price checker to appear.</p>
          <label class="field" for="embed-code">Embed code</label>
          <textarea class="input keybox" id="embed-code" rows="4" readonly style="margin-block-start:6px">${esc(embed)}</textarea>
          <div class="actions" style="margin-block-start:10px"><button type="button" class="btn btn-ghost" id="copy-embed">Copy code</button></div>
          ${u.plan === 'free' ? '<div class="upgrade" style="margin-block-start:12px"><p>The widget shows “not active” until the Clinic plan is paid.</p><div class="actions"><a class="btn btn-primary" href="#/plan">Pay for the Clinic plan</a></div></div>' : ''}
        </div>
      </div>
      <div class="card"><h2>Widget use (last 30 days)</h2><div id="clinic-stats"></div></div>`;
    $('#copy-embed', el).addEventListener('click', () => copyText($('#embed-code', el).value));
    onSubmit($('#clinic-form', el), async (fd, out) => {
      await api('save-clinic', { body: { name: val(fd, 'name'), color: val(fd, 'color'), note: val(fd, 'note'), phone: val(fd, 'phone'), city: val(fd, 'city'), partners: !!fd.get('partners') } });
      msg(out, 'Saved. The widget updates within a minute.', true);
    });
    into($('#clinic-stats', el), async (box) => {
      const s = await api('stats');
      const t = s.totals || {};
      box.innerHTML = `
        <div class="stat-grid stat-auto">
          <div class="stat"><small>Searches</small><b class="num">${esc(t.widget || 0)}</b></div>
          <div class="stat"><small>Cheaper options shown</small><b class="num">${esc(t.savedCount || 0)}</b></div>
          <div class="stat good"><small>Possible savings shown to patients (Rs)</small><b class="num">${esc(Math.round(t.saved || 0).toLocaleString('en-PK'))}</b></div>
        </div>
        <p class="small muted">“Cheaper options shown” counts the times a patient searching on your website was shown a cheaper brand with the same formula. “Possible savings” adds up the price difference at DRAP maximum retail prices. These are possible savings, not confirmed purchases: we cannot see what patients actually buy.</p>
        <h3>Daily searches</h3>${barChart(s.days || [], 'widget')}`;
    });
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied.');
    } catch (e) {
      toast('Select the text and copy it.');
    }
  }

  // ===========================================================================
  // NGO
  // ===========================================================================
  const ngoDraft = { id: null, name: '', items: [] }; // items: [{id, qty}]
  let ngoResult = null;
  let ngoQuoteResult = null; // { listId, data } from compare-quotes
  let ngoImportOpen = false; // keep the CSV import box open after an import

  /** Printable supplier comparison (part of the donor report when shown). */
  function quoteResultHtml(r, l, engine) {
    const diff = (n) => (n > 0 ? `<span class="save-txt">${esc(rs(n))} less</span>` : n < 0 ? `<span class="bad-txt">${esc(rs(-n))} more</span>` : 'Same');
    const quotes = r.quotes || [];
    const nameOf = (id) => {
      const row = (r.rows || []).find((x) => x.medicine.id === id);
      return row ? `${row.medicine.brand} ${row.medicine.strength || ''}`.trim() : (engine && engine.byId(id) ? medLabel(engine.byId(id)) : id);
    };
    return `
      <div class="card report" id="quote-result">
        <div class="item-top"><h2>Supplier quote comparison: ${esc(l.name)}</h2><button type="button" class="btn btn-primary no-print" id="quote-print">${esc(printLabel('Print donor report', 'Share comparison'))}</button></div>
        <p class="print-only">${esc(S.user.name)} · ${esc(fmtDate(new Date()))}</p>
        <div class="stat-grid stat-auto">
          <div class="stat"><small>At DRAP prices (these brands)</small><b class="num">${esc(rs(r.total_now))}</b></div>
          <div class="stat"><small>Cheapest same formula at DRAP prices</small><b class="num">${esc(rs(r.total_best))}</b></div>
          <div class="stat good"><small>Best complete quote</small><b class="num">${r.best_supplier ? esc(r.best_supplier) : 'None yet'}</b></div>
        </div>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Supplier</th><th class="n">Total</th><th class="n">Missing items</th><th class="n">vs DRAP price</th><th class="n">vs cheapest same formula (DRAP price)</th></tr></thead><tbody>${quotes
          .slice()
          .sort((a, b) => a.missing - b.missing || a.total - b.total)
          .map((q) => `<tr${q.supplier === r.best_supplier ? ' class="best"' : ''}><td><b>${esc(q.supplier)}</b>${q.supplier === r.best_supplier ? ' <span class="badge good">Best</span>' : ''}</td><td class="n">${esc(rs(q.total))}${q.missing ? '<span class="sub">partial</span>' : ''}</td><td class="n">${q.missing ? `<span class="badge warn">${esc(q.missing)}</span>` : '0'}</td><td class="n">${q.missing ? '<span class="muted">–</span>' : diff(q.vs_mrp)}</td><td class="n">${q.missing ? '<span class="muted">–</span>' : diff(q.vs_cheapest_mrp)}</td></tr>`)
          .join('')}</tbody></table></div>
        <h3 style="margin-block-start:16px">Unit prices by medicine</h3>
        <div class="table-wrap"><table class="tbl"><thead><tr><th>Medicine</th><th class="n">Qty</th><th class="n">DRAP cost</th><th class="n">Cheapest same formula</th>${quotes.map((q) => `<th class="n">${esc(q.supplier)}</th>`).join('')}</tr></thead><tbody>${(r.rows || [])
          .map((row, i) => `<tr><td><b>${esc(nameOf(row.medicine.id))}</b><span class="sub">${esc(row.medicine.formula || '')}</span></td><td class="n">${esc(row.qty)}</td><td class="n">${esc(rs(row.cost_now))}</td><td class="n">${esc(rs(row.cost_best))}${row.cheapest.id !== row.medicine.id ? `<span class="sub">${esc(row.cheapest.brand)}</span>` : ''}</td>${quotes
            .map((q) => {
              const ln = (q.lines || [])[i];
              return `<td class="n">${ln && ln.price != null ? esc(rs(ln.total)) + `<span class="sub">${esc(rs2(ln.price))}/unit</span>` : '<span class="muted">not quoted</span>'}</td>`;
            })
            .join('')}</tr>`)
          .join('')}</tbody></table></div>
        <p class="small muted" style="margin-block-start:10px">“Less” means the supplier's total is lower than the DRAP maximum retail price total; “more” means higher. Suppliers with missing items are not ranked because their total is partial. DRAP prices are maximum retail prices; doctors should confirm any brand switch.</p>
      </div>`;
  }

  function viewOptimiser(el) {
    const u = S.user;
    el.innerHTML = `
      <div class="card no-print">
        <h2>Budget optimiser</h2>
        <p class="muted">Add the medicines and quantities you buy (tablets, capsules or ml). We find the cheapest DRAP-registered brand with the same formula, strength and form.</p>
        <div id="ngo-picker"></div>
      </div>
      <div class="card no-print">
        <h3>Your list${ngoDraft.name ? ': ' + esc(ngoDraft.name) : ''}</h3>
        <div id="ngo-items"></div>
        <div class="actions" style="margin-block-start:12px"><button type="button" class="btn btn-primary" id="ngo-calc">Find cheapest options</button><button type="button" class="btn btn-ghost" id="ngo-clear">Clear list</button></div>
        <p class="form-msg" id="ngo-msg" role="status"></p>
      </div>
      <details class="card no-print import-details" id="ngo-import-wrap"${ngoImportOpen ? ' open' : ''}><summary>Import a list from a spreadsheet (CSV)</summary><div id="ngo-import"></div></details>
      <div id="ngo-result"></div>
      <div id="ngo-quotes"></div>
      <div class="card no-print">
        <h3>Saved lists</h3>
        ${(u.lists || []).length ? `<div class="items">${u.lists
          .map((l) => `<div class="item"><div class="item-top"><div><div class="item-title">${esc(l.name)}</div><div class="item-meta">${esc(l.items.length)} medicines · saved ${esc(fmtDate(l.at))}</div></div>
            <div class="actions"><button type="button" class="btn btn-ghost sm" style="min-height:44px" data-load="${esc(l.id)}">Open</button><button type="button" class="btn btn-ghost sm" style="min-height:44px" data-del="${esc(l.id)}">Delete</button></div></div></div>`)
          .join('')}</div>` : '<p class="empty-note">No saved lists yet.</p>'}
      </div>`;
    const itemsEl = $('#ngo-items', el);
    const resEl = $('#ngo-result', el);
    let engine = null;
    $('#ngo-import-wrap', el).addEventListener('toggle', (ev) => (ngoImportOpen = ev.target.open));
    csvImport($('#ngo-import', el), {
      type: 'list',
      title: 'Import a medicine list',
      intro: 'One row per medicine: <b>medicine</b> (brand and strength, or the medicine id) and <b>quantity</b> (tablets, capsules or ml). The medicines are added to your list above.',
      send: (csv, partial) => api('import-list', { body: { csv, partial, name: ngoDraft.name || undefined } }),
      onDone: (r) => {
        const items = Array.isArray(r.items) ? r.items : r.list && Array.isArray(r.list.items) ? r.list.items : null;
        if (items) {
          items.filter((x) => x && x.id).forEach((x) => {
            const qty = Math.max(1, Math.round(Number(x.qty || x.quantity) || 1));
            const ex = ngoDraft.items.find((y) => y.id === x.id);
            if (ex) ex.qty += qty;
            else ngoDraft.items.push({ id: String(x.id), qty });
          });
          if (r.list && r.list.id) Object.assign(ngoDraft, { id: r.list.id, name: r.list.name || ngoDraft.name });
          ngoResult = null;
          toast('Medicines added to your list.');
          viewOptimiser(el);
        } else toast('List imported.');
      },
    });
    const drawItems = () => {
      if (!ngoDraft.items.length) {
        itemsEl.innerHTML = '<p class="empty-note">Search above and add medicines.</p>';
        return;
      }
      itemsEl.innerHTML = `<div class="table-wrap"><table class="tbl"><thead><tr><th>Medicine</th><th class="n">Quantity</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody>${ngoDraft.items
        .map((it, i) => {
          const m = engine && engine.byId(it.id);
          return `<tr><td><b>${esc(m ? medLabel(m) : it.id)}</b><span class="sub">${esc(m ? medMeta(m) : '')}</span></td><td class="n"><input class="input" type="number" min="1" max="1000000" value="${esc(it.qty)}" data-qty="${i}" aria-label="Quantity"></td><td><button type="button" class="icon-btn" data-rm="${i}" aria-label="Remove">✕</button></td></tr>`;
        })
        .join('')}</tbody></table></div>`;
    };
    const drawResult = () => {
      if (!ngoResult) {
        resEl.innerHTML = '';
        return;
      }
      const r = ngoResult;
      const patients = (S.user.patients || []).length;
      resEl.innerHTML = `
        <div class="card report">
          <div class="print-only"><h2>Medicine savings report: ${esc(S.user.name)}</h2><p>${esc(fmtDate(new Date()))}${ngoDraft.name ? ' · ' + esc(ngoDraft.name) : ''}</p></div>
          <div class="stat-grid" style="grid-template-columns:repeat(auto-fit,minmax(140px,1fr))">
            <div class="stat"><small>Cost now</small><b class="num">${esc(rs(r.total_now))}</b></div>
            <div class="stat"><small>With cheapest brands</small><b class="num">${esc(rs(r.total_best))}</b></div>
            <div class="stat good"><small>You save</small><b class="num">${esc(rs(r.saving))}</b><div class="sub">${esc(r.percent)}% of this list</div></div>
            ${patients ? `<div class="stat"><small>Patients supported</small><b class="num">${esc(patients)}</b></div>` : ''}
          </div>
          <div class="table-wrap"><table class="tbl"><thead><tr><th>Medicine</th><th class="n">Qty</th><th>Cheapest same formula</th><th class="n">Cost now</th><th class="n">Cost best</th><th class="n">Saving</th></tr></thead><tbody>${r.rows
            .map((x) => `<tr><td><b>${esc(x.medicine.brand)} ${esc(x.medicine.strength || '')}</b><span class="sub">${esc(x.medicine.formula)}</span></td><td class="n">${esc(x.qty)}</td><td>${x.cheapest.id === x.medicine.id ? '<span class="muted">Already cheapest</span>' : `<b>${esc(x.cheapest.brand)}</b><span class="sub">${esc(x.cheapest.manufacturer)} · ${esc(rs2(x.cheapest.unit_price_rs))}/unit</span>`}</td><td class="n">${esc(rs(x.cost_now))}</td><td class="n">${esc(rs(x.cost_best))}</td><td class="n save-txt">${x.saving ? esc(rs(x.saving)) : ''}</td></tr>`)
            .join('')}</tbody><tfoot><tr><td colspan="3">Total</td><td class="n">${esc(rs(r.total_now))}</td><td class="n">${esc(rs(r.total_best))}</td><td class="n save-txt">${esc(rs(r.saving))}</td></tr></tfoot></table></div>
          <p class="small muted" style="margin-block-start:10px">Prices are DRAP maximum retail prices. Brands with the same formula, strength and form are listed; doctors should confirm any switch.</p>
          <form class="form no-print" id="save-list-form" style="margin-block-start:12px">
            <div class="form-row"><label class="field">List name<input class="input" name="name" maxlength="80" value="${esc(ngoDraft.name || '')}" placeholder="e.g. Monthly diabetes camp"></label></div>
            <div class="actions"><button type="submit" class="btn btn-ghost">${ngoDraft.id ? 'Update saved list' : 'Save as list'}</button><button type="button" class="btn btn-primary" id="donor-print">${esc(printLabel('Print donor report', 'Share donor report'))}</button></div>
            <p class="form-msg" role="status"></p>
          </form>
        </div>`;
      $('#donor-print', resEl).addEventListener('click', () => printOrShare($('.report', resEl), 'Medicine savings report: ' + S.user.name, 'sasta-dawa-donor-report-' + today() + '.html'));
      onSubmit($('#save-list-form', resEl), async (fd, out) => {
        const name = val(fd, 'name') || 'Medicine list';
        const r2 = await api('save-list', { body: { id: ngoDraft.id || undefined, name, items: ngoDraft.items } });
        ngoDraft.name = name;
        ngoDraft.id = (r2.user.lists.find((l) => l.name === name) || {}).id || ngoDraft.id;
        toast('List saved.');
        viewOptimiser(el);
      });
    };
    itemsEl.addEventListener('change', (ev) => {
      const i = ev.target.dataset.qty;
      if (i == null) return;
      ngoDraft.items[Number(i)].qty = Math.max(1, Math.round(Number(ev.target.value) || 1));
    });
    itemsEl.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-rm]');
      if (!b) return;
      ngoDraft.items.splice(Number(b.dataset.rm), 1);
      drawItems();
    });
    $('#ngo-clear', el).addEventListener('click', () => {
      Object.assign(ngoDraft, { id: null, name: '', items: [] });
      ngoResult = null;
      viewOptimiser(el);
    });
    $('#ngo-calc', el).addEventListener('click', async (ev) => {
      const out = $('#ngo-msg', el);
      if (!ngoDraft.items.length) return msg(out, 'Add at least one medicine.');
      ev.target.disabled = true;
      msg(out, '');
      try {
        ngoResult = await api('optimise', { body: { items: ngoDraft.items } });
        drawResult();
        resEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (e) {
        if (!e.handled) msg(out, e.message);
      } finally {
        ev.target.disabled = false;
      }
    });
    el.onclick = async (ev) => {
      const ld = ev.target.closest('button[data-load]');
      const dl = ev.target.closest('button[data-del]');
      if (ld) {
        const l = (S.user.lists || []).find((x) => x.id === ld.dataset.load);
        if (!l) return;
        Object.assign(ngoDraft, { id: l.id, name: l.name, items: l.items.map((x) => ({ id: x.id, qty: x.qty })) });
        ngoResult = null;
        viewOptimiser(el);
        window.scrollTo(0, 0);
      } else if (dl) {
        if (!window.confirm('Delete this saved list?')) return;
        try {
          await api('save-list', { body: { id: dl.dataset.del, remove: true } });
          if (ngoDraft.id === dl.dataset.del) ngoDraft.id = null;
          toast('List deleted.');
          viewOptimiser(el);
        } catch (e) {
          if (!e.handled) toast(e.message);
        }
      }
    };
    const quotesEl = $('#ngo-quotes', el);
    let quoteEdit = null; // supplier name being edited
    const savedList = () => (S.user.lists || []).find((l) => l.id === ngoDraft.id) || null;
    const drawQuotes = () => {
      const l = savedList();
      if (!l) {
        quotesEl.innerHTML = '';
        return;
      }
      const quotes = l.quotes || [];
      const editing = quoteEdit ? quotes.find((q) => q.supplier === quoteEdit) : null;
      const prices = (editing && editing.prices) || {};
      const cmp = ngoQuoteResult && ngoQuoteResult.listId === l.id ? ngoQuoteResult.data : null;
      quotesEl.innerHTML = `
        <div class="card no-print">
          <h3>Supplier quotes: ${esc(l.name)}</h3>
          <p class="small muted">Enter the unit price (per tablet, capsule or ml) each supplier quoted for the medicines on this saved list, then compare them with DRAP prices. Uses the quantities saved with the list. Up to 10 suppliers.</p>
          ${quotes.length ? `<div class="items" style="margin-block-end:12px">${quotes
            .map((q) => `<div class="item"><div class="item-top"><div><div class="item-title">${esc(q.supplier)}</div><div class="item-meta">${esc(Object.keys(q.prices || {}).length)} of ${esc(l.items.length)} medicines priced · ${esc(fmtDate(q.at))}</div></div>
              <div class="actions"><button type="button" class="btn btn-ghost sm" style="min-height:44px" data-qedit="${esc(q.supplier)}">Edit</button><button type="button" class="btn btn-ghost sm" style="min-height:44px" data-qdel="${esc(q.supplier)}">Remove</button></div></div></div>`)
            .join('')}</div>` : '<p class="empty-note">No supplier quotes yet.</p>'}
          <form class="form" id="quote-form">
            <h3 style="margin:0">${editing ? 'Edit quote' : 'Add a supplier quote'}</h3>
            <label class="field">Supplier name<input class="input" name="supplier" maxlength="80" value="${esc(editing ? editing.supplier : '')}" required></label>
            <div class="table-wrap"><table class="tbl"><thead><tr><th>Medicine</th><th class="n">Qty</th><th class="n">DRAP unit price</th><th class="n">Quoted unit price (Rs)</th></tr></thead><tbody>${l.items
              .map((it) => {
                const m = engine && engine.byId(it.id);
                return `<tr><td><b>${esc(m ? medLabel(m) : it.id)}</b><span class="sub">${esc(m ? m.generic || '' : '')}</span></td><td class="n">${esc(it.qty)}</td><td class="n">${m ? esc(rs2(m.unitPrice)) : ''}</td><td class="n"><input class="input" type="number" min="0" step="0.01" inputmode="decimal" name="p:${esc(it.id)}" value="${esc(prices[it.id] || '')}" aria-label="Quoted unit price for ${esc(m ? medLabel(m) : it.id)}"></td></tr>`;
              })
              .join('')}</tbody></table></div>
            <p class="small muted" style="margin:0">Leave a price empty if the supplier did not quote that medicine.</p>
            <div class="actions"><button type="submit" class="btn btn-ghost">${editing ? 'Save quote' : 'Add quote'}</button>${editing ? '<button type="button" class="btn btn-ghost" id="quote-cancel">Cancel</button>' : ''}<button type="button" class="btn btn-primary" id="quote-compare"${quotes.length ? '' : ' disabled'}>Compare quotes</button></div>
            <p class="form-msg" role="status"></p>
          </form>
        </div>
        ${cmp ? quoteResultHtml(cmp, l, engine) : ''}`;
      onSubmit($('#quote-form', quotesEl), async (fd, out) => {
        const supplier = val(fd, 'supplier');
        if (!supplier) return msg(out, 'Enter the supplier name.');
        const pr = {};
        l.items.forEach((it) => {
          const v = Number(val(fd, 'p:' + it.id));
          if (v > 0) pr[it.id] = v;
        });
        if (!Object.keys(pr).length) return msg(out, 'Enter at least one quoted price.');
        if (!editing && quotes.length >= 10 && !quotes.some((q) => q.supplier === supplier)) return msg(out, 'Up to 10 suppliers per list. Remove one first.');
        if (editing && editing.supplier !== supplier) await api('save-quote', { body: { listId: l.id, supplier: editing.supplier, remove: true } });
        await api('save-quote', { body: { listId: l.id, supplier, prices: pr } });
        quoteEdit = null;
        ngoQuoteResult = null;
        toast('Quote saved.');
        drawQuotes();
      });
      const cancel = $('#quote-cancel', quotesEl);
      if (cancel) cancel.addEventListener('click', () => {
        quoteEdit = null;
        drawQuotes();
      });
      $('#quote-compare', quotesEl).addEventListener('click', async (ev) => {
        const out = $('#quote-form .form-msg', quotesEl);
        ev.target.disabled = true;
        msg(out, '');
        try {
          const lst = savedList();
          const data = await api('compare-quotes', { body: { items: lst.items, quotes: lst.quotes || [] } });
          ngoQuoteResult = { listId: lst.id, data };
          drawQuotes();
          const res = $('#quote-result', quotesEl);
          if (res && res.scrollIntoView) res.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (e) {
          if (!e.handled) msg(out, e.message);
          ev.target.disabled = false;
        }
      });
      const qp = $('#quote-print', quotesEl);
      if (qp) qp.addEventListener('click', () => printOrShare($('#quote-result', quotesEl), 'Supplier quote comparison: ' + l.name, 'sasta-dawa-quotes-' + fileSlug(l.name) + '-' + today() + '.html'));
    };
    quotesEl.addEventListener('click', async (ev) => {
      const ed = ev.target.closest('button[data-qedit]');
      const dq = ev.target.closest('button[data-qdel]');
      if (ed) {
        quoteEdit = ed.dataset.qedit;
        drawQuotes();
        const f = $('#quote-form', quotesEl);
        if (f && f.scrollIntoView) f.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (dq) {
        if (!window.confirm('Remove the quote from ' + dq.dataset.qdel + '?')) return;
        try {
          await api('save-quote', { body: { listId: ngoDraft.id, supplier: dq.dataset.qdel, remove: true } });
          if (quoteEdit === dq.dataset.qdel) quoteEdit = null;
          ngoQuoteResult = null;
          toast('Quote removed.');
          drawQuotes();
        } catch (e) {
          if (!e.handled) toast(e.message);
        }
      }
    });
    loadEngine()
      .then((e) => {
        engine = e;
        medPicker($('#ngo-picker', el), (m) => {
          const ex = ngoDraft.items.find((x) => x.id === m.id);
          if (ex) ex.qty += 30;
          else ngoDraft.items.push({ id: m.id, qty: 30 });
          drawItems();
        });
        drawItems();
        drawResult();
        drawQuotes();
      })
      .catch(() => {
        itemsEl.innerHTML = errorHtml(new Error('Could not load the medicine list. Check your connection and reload.'));
      });
  }

  function viewPatients(el, rest) {
    const u = S.user;
    const editId = rest[0];
    if (editId) return patientForm(el, editId === 'new' ? null : (u.patients || []).find((x) => x.id === editId) || null);
    into(el, async () => {
      let engine = null;
      try {
        engine = await loadEngine();
      } catch (e) {
        engine = null;
      }
      const pts = S.user.patients || [];
      el.innerHTML = `
        <div class="card">
          <div class="item-top"><h2>Patients (${esc(pts.length)})</h2><a class="btn btn-primary" href="#/patients/new">Add patient</a></div>
          <p class="small muted">Keep a private record of who receives which medicines. Only your account can see it.</p>
          ${pts.length ? `<div class="items">${pts
            .map((pt) => `<div class="item"><div class="item-top"><div><div class="item-title">${esc(pt.name || 'Unnamed')}${pt.ref ? ` <span class="badge">${esc(pt.ref)}</span>` : ''}</div>
              <div class="item-meta">${pt.meds.map((m) => esc(engine && engine.byId(m.id) ? medLabel(engine.byId(m.id)) : m.id) + ' × ' + esc(m.qty)).join(', ') || 'No medicines'}</div>
              ${pt.note ? `<div class="item-meta">${esc(pt.note)}</div>` : ''}</div>
              <a class="btn btn-ghost sm" style="min-height:44px" href="#/patients/${esc(pt.id)}">Edit</a></div></div>`)
            .join('')}</div>` : '<p class="empty-note">No patients yet.</p>'}
        </div>`;
    });
  }

  function patientForm(el, pt) {
    const meds = pt ? pt.meds.map((m) => ({ id: m.id, qty: m.qty })) : [];
    el.innerHTML = `
      <div class="card">
        <a class="back-link" href="#/patients">← All patients</a>
        <h2>${pt ? 'Edit patient' : 'Add patient'}</h2>
        <form class="form" id="pt-form">
          <div class="form-row">
            <label class="field">Name<input class="input" name="name" maxlength="80" value="${esc(pt ? pt.name : '')}" required></label>
            <label class="field">Reference / file no. <small class="muted">(optional)</small><input class="input" name="ref" maxlength="40" value="${esc(pt ? pt.ref : '')}"></label>
          </div>
          <label class="field">Note <small class="muted">(optional)</small><textarea class="input" name="note" maxlength="300" rows="2">${esc(pt ? pt.note : '')}</textarea></label>
          <div id="pt-picker"></div>
          <div id="pt-meds"></div>
          <div class="actions"><button type="submit" class="btn btn-primary">Save patient</button>${pt ? '<button type="button" class="btn btn-ghost" id="pt-del">Remove patient</button>' : ''}</div>
          <p class="form-msg" role="status"></p>
        </form>
      </div>`;
    const medsEl = $('#pt-meds', el);
    let engine = null;
    const draw = () => {
      medsEl.innerHTML = meds.length
        ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Medicine</th><th class="n">Qty / month</th><th><span class="sr-only">Remove</span></th></tr></thead><tbody>${meds
            .map((m, i) => {
              const x = engine && engine.byId(m.id);
              return `<tr><td>${esc(x ? medLabel(x) : m.id)}</td><td class="n"><input class="input" type="number" min="1" value="${esc(m.qty)}" data-qty="${i}" aria-label="Quantity"></td><td><button type="button" class="icon-btn" data-rm="${i}" aria-label="Remove">✕</button></td></tr>`;
            })
            .join('')}</tbody></table></div>`
        : '<p class="small muted">No medicines added.</p>';
    };
    medsEl.addEventListener('change', (ev) => {
      const i = ev.target.dataset.qty;
      if (i != null) meds[Number(i)].qty = Math.max(1, Math.round(Number(ev.target.value) || 1));
    });
    medsEl.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-rm]');
      if (b) {
        meds.splice(Number(b.dataset.rm), 1);
        draw();
      }
    });
    loadEngine()
      .then((e) => {
        engine = e;
        medPicker($('#pt-picker', el), (m) => {
          if (!meds.some((x) => x.id === m.id)) meds.push({ id: m.id, qty: 30 });
          draw();
        }, { label: 'Add a medicine for this patient' });
        draw();
      })
      .catch(() => draw());
    const f = $('#pt-form', el);
    onSubmit(f, async (fd, out) => {
      if (!val(fd, 'name')) return msg(out, 'Enter the patient name.');
      await api('save-patient', { body: { id: pt ? pt.id : undefined, name: val(fd, 'name'), ref: val(fd, 'ref'), note: val(fd, 'note'), meds } });
      toast('Patient saved.');
      go('#/patients');
    });
    const del = $('#pt-del', el);
    if (del) {
      del.addEventListener('click', async () => {
        if (!window.confirm('Remove this patient record?')) return;
        try {
          await api('save-patient', { body: { id: pt.id, remove: true } });
          toast('Patient removed.');
          go('#/patients');
        } catch (e) {
          if (!e.handled) msg($('.form-msg', f), e.message);
        }
      });
    }
  }

  // ===========================================================================
  // Company
  // ===========================================================================
  function viewCompany(el) {
    into(el, async () => {
      const r = await api('company');
      const c = r.company;
      if (!c) {
        el.innerHTML = `
          <div class="card">
            <h2>Create your company code</h2>
            <p class="muted">Your staff enter this code in their Sasta Dawa account. You see how much your team could save on medicines (totals only, never individual medicines).</p>
            <form class="form" id="co-form">
              <label class="field">Company name<input class="input" name="name" maxlength="80" value="${esc(S.user.name)}"></label>
              <div class="actions"><button type="submit" class="btn btn-primary">Create code</button></div>
              <p class="form-msg" role="status"></p>
            </form>
          </div>`;
        onSubmit($('#co-form', el), async (fd) => {
          await api('create-company', { body: { name: val(fd, 'name') } });
          toast('Company code created.');
          viewCompany(el);
        });
        return;
      }
      el.innerHTML = `
        <div class="grid-2">
          <div class="card">
            <h2>${esc(c.name)}</h2>
            <p class="muted" style="margin:0">Your company code</p>
            <p class="code-big">${esc(c.code)}</p>
            <div class="actions"><button type="button" class="btn btn-ghost" id="co-copy">Copy code</button>${c.active ? '<span class="badge good">Active</span>' : '<span class="badge bad">Not active: plan has ended</span>'}</div>
            <h3 style="margin-block-start:16px">Share with your staff</h3>
            <p>Staff open <b>sastadawafinder</b> → <b>Account</b> → <b>Join company</b> and enter the code.</p>
            <textarea class="input keybox" id="co-msg" rows="4" readonly aria-label="Message for staff">Our company gives you Sasta Dawa Finder to find cheaper medicines with the same formula. Open ${SITE}/account, create a free account, go to Plan & billing → Join company and enter code ${c.code}.</textarea>
            <div class="actions" style="margin-block-start:8px"><button type="button" class="btn btn-ghost" id="co-copy-msg">Copy message</button></div>
          </div>
          <div class="card">
            <h2>Team savings</h2>
            <div class="stat-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">
              <div class="stat"><small>Staff joined</small><b class="num">${esc(c.members)}</b></div>
              <div class="stat"><small>Monthly medicine cost now</small><b class="num">${esc(rs(c.monthly_now))}</b></div>
              <div class="stat"><small>With cheapest brands</small><b class="num">${esc(rs(c.monthly_best))}</b></div>
              <div class="stat good"><small>Possible monthly saving</small><b class="num">${esc(rs(c.monthly_saving))}</b></div>
            </div>
            <p class="small muted">Based on the medicines staff keep in My Medicines, 30 days at their daily dose.</p>
            ${c.active ? '' : '<div class="upgrade"><p>Staff cannot join while the plan is inactive.</p><div class="actions"><a class="btn btn-primary" href="#/plan">Renew plan</a></div></div>'}
          </div>
        </div>`;
      $('#co-copy', el).addEventListener('click', () => copyText(c.code));
      $('#co-copy-msg', el).addEventListener('click', () => copyText($('#co-msg', el).value));
    });
  }

  // -- Claims analysis: what staff paid vs the cheapest same-formula brand
  let claimsResult = null;

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? '"' + (/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""') + '"' : s;
  }
  /**
   * Saves a text file. Website: a normal browser download. Android apps: the WebView ignores
   * <a download> on blob: links, so the file goes through SastaNative.files.save, which writes it to the
   * phone and opens the share sheet (Files, Drive, WhatsApp...).
   * Resolves to { ok, native, error? }; callers only say "Downloaded" / "Saved" when ok is true.
   */
  async function downloadFile(name, text, type) {
    const mime = type || 'text/csv;charset=utf-8';
    const f = nFiles();
    if (f) {
      try {
        const r = await f.save(name, mime.split(';')[0].trim(), String(text), { base64: false });
        return r && r.ok ? { ok: true, native: true, uri: r.uri } : { ok: false, native: true, error: (r && r.error) || '' };
      } catch (e) {
        return { ok: false, native: true, error: (e && e.message) || '' };
      }
    }
    try {
      const blob = new Blob([text], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return { ok: true, native: false };
    } catch (e) {
      return { ok: false, native: false, error: (e && e.message) || '' };
    }
  }
  /** Toast for a file saved by downloadFile(). */
  function fileToast(r) {
    if (!r.ok) toast('Could not save the file. Please try again.');
    else if (r.native) toast('File ready. Choose where to keep it: Files, Drive or WhatsApp.');
  }

  // ---- Print (website) / Share (apps) ----
  // Android WebViews ignore window.print(). In the apps every "Print" button becomes "Share": reports are
  // saved as a small stand-alone HTML file (open it in Chrome / Drive to print or save as PDF), the QR
  // sticker as a PNG image.
  const canShareFiles = () => !!nFiles();
  /** Button text: "Print …" on the website, "Share …" in the apps. */
  const printLabel = (web, app) => (canShareFiles() ? app : web);
  const REPORT_CSS = 'body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#121614;background:#fff;margin:0;padding:20px;line-height:1.45;font-size:15px}' +
    'h1,h2,h3{margin:0 0 8px;line-height:1.25}h2{font-size:20px}h3{font-size:17px;margin-top:16px}p{margin:0 0 8px}' +
    'table{border-collapse:collapse;width:100%;margin:8px 0 12px;font-size:14px}th,td{border:1px solid #c9ccc6;padding:6px 8px;text-align:start;vertical-align:top}th{background:#f1f2ee}' +
    'td.n,th.n{text-align:end;white-space:nowrap}.sub{display:block;font-size:12px;color:#5a605c}.muted,.small{color:#5a605c;font-size:13px}' +
    '.stat-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:8px 0 12px}.stat{border:1px solid #c9ccc6;border-radius:4px;padding:8px 10px}.stat small{display:block;color:#5a605c}.stat b{font-size:18px}' +
    '.badge{display:inline-block;border:1px solid #c9ccc6;border-radius:4px;padding:0 6px;font-size:12px}.save-txt{color:#0A6B3C;font-weight:600}.bad-txt{color:#B42318;font-weight:600}' +
    'tr.best td{background:#E4F1E8}.print-only{display:block}.foot{margin-top:18px;color:#5a605c;font-size:12px}a{color:inherit}@media print{body{padding:0}}';
  /** A clean stand-alone HTML copy of a report card (buttons, forms and screen-only parts removed). */
  function reportDoc(node, title) {
    const c = node.cloneNode(true);
    $$('.no-print, button, form, input, select, textarea, script, .actions', c).forEach((x) => x.remove());
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${REPORT_CSS}</style></head><body>${c.outerHTML}<p class="foot">Sasta Dawa Finder · sasta-dawa-finder.vercel.app · ${esc(fmtDate(new Date()))}</p></body></html>`;
  }
  const fileSlug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'report';
  /** Print on the website; in the apps save the report as an HTML file and open the share sheet. */
  async function printOrShare(node, title, filename) {
    if (!canShareFiles()) {
      window.print();
      return { ok: true, printed: true };
    }
    if (!node) return { ok: false };
    const r = await downloadFile(filename, reportDoc(node, title), 'text/html');
    if (r.ok) toast('Report ready. Choose where to send it (WhatsApp, Drive, Files). Open it there to print or save as PDF.');
    else toast(tr('Could not open the share options. Please try again.'));
    return r;
  }
  /** Draws the QR sticker (pharmacy name, QR code, text, link) on a canvas: PNG base64 without the prefix. */
  function stickerPng(p, url) {
    if (!window.SDQR || typeof window.SDQR.qrMatrix !== 'function') throw new Error('QR encoder (js/qr.js) is not loaded');
    const m = window.SDQR.qrMatrix(url);
    const W = 800;
    const H = 1080;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    if (!ctx) throw new Error('Could not draw the sticker on this phone.');
    const green = '#0A6B3C';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = green;
    ctx.lineWidth = 8;
    ctx.strokeRect(14, 14, W - 28, H - 28);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    // Pharmacy name: up to two lines, shrunk to fit.
    const fitLines = (text, font, maxW, maxLines) => {
      ctx.font = font;
      const words = String(text).split(/\s+/).filter(Boolean);
      const lines = [];
      let line = '';
      words.forEach((w) => {
        const t = line ? line + ' ' + w : w;
        if (ctx.measureText(t).width <= maxW || !line) line = t;
        else {
          lines.push(line);
          line = w;
        }
      });
      if (line) lines.push(line);
      if (lines.length > maxLines) {
        const keep = lines.slice(0, maxLines);
        keep[maxLines - 1] = keep[maxLines - 1].replace(/.{0,2}$/, '') + '…';
        return keep;
      }
      return lines;
    };
    ctx.fillStyle = green;
    let y = 110;
    fitLines(p.name, 'bold 52px sans-serif', W - 100, 2).forEach((ln) => {
      ctx.fillText(ln, W / 2, y);
      y += 62;
    });
    ctx.fillStyle = '#121614';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('Find us on Sasta Dawa Finder', W / 2, y + 10);
    // QR code with a 4-module quiet zone.
    const n = m.length;
    const size = 600;
    const cell = Math.floor(size / (n + 8));
    const qrW = cell * (n + 8);
    const x0 = Math.round((W - qrW) / 2);
    const y0 = y + 40;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x0, y0, qrW, qrW);
    ctx.fillStyle = '#000000';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (m[r][c]) ctx.fillRect(x0 + (c + 4) * cell, y0 + (r + 4) * cell, cell, cell);
    ctx.fillStyle = '#121614';
    ctx.font = '30px sans-serif';
    ctx.fillText('Scan to see our stock, prices and WhatsApp', W / 2, y0 + qrW + 50);
    ctx.fillStyle = '#3B413D';
    ctx.font = '22px monospace';
    fitLines(url, '22px monospace', W - 80, 2).forEach((ln, i) => ctx.fillText(ln, W / 2, y0 + qrW + 95 + i * 30));
    const data = cv.toDataURL('image/png');
    const b64 = String(data).split(',')[1] || '';
    if (!b64) throw new Error('Could not draw the sticker on this phone.');
    return b64;
  }

  function viewClaims(el) {
    el.innerHTML = `
      <div class="card no-print">
        <h2>Claims analysis</h2>
        <p class="muted">Upload the medicine claims or purchases your staff made. For each line we find the cheapest DRAP-registered brand with the same formula, strength and form, and show the possible saving.</p>
      </div>
      <div id="claims-import" class="no-print"></div>
      <div id="claims-result"></div>`;
    const resEl = $('#claims-result', el);
    const draw = () => {
      const r = claimsResult;
      if (!r) {
        resEl.innerHTML = '';
        return;
      }
      resEl.innerHTML = `
        <div class="card report">
          <div class="item-top"><h2>Claims analysis</h2><div class="actions no-print"><button type="button" class="btn btn-primary" id="claims-print">${esc(printLabel('Print / save as PDF', 'Share report'))}</button><button type="button" class="btn btn-ghost" id="claims-csv">Download CSV</button></div></div>
          <p class="print-only">${esc(S.user.name)} · ${esc(fmtDate(new Date()))}</p>
          <div class="stat-grid stat-auto">
            <div class="stat"><small>Total paid</small><b class="num">${esc(rs(r.total_paid))}</b></div>
            <div class="stat"><small>With cheapest same-formula brand</small><b class="num">${esc(rs(r.total_cheapest))}</b></div>
            <div class="stat good"><small>Possible saving</small><b class="num">${esc(rs(r.possible_saving))}</b><div class="sub">${esc(r.percent)}% of the amount paid</div></div>
            <div class="stat"><small>Lines matched</small><b class="num">${esc(r.rows.length)}</b>${r.unmatched.length ? `<div class="sub">${esc(r.unmatched.length)} not matched</div>` : ''}</div>
          </div>
          ${r.rows.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Your line</th><th>Matched medicine</th><th class="n">Qty</th><th class="n">Paid</th><th>Cheapest option</th><th class="n">Cheapest cost</th><th class="n">Possible saving</th></tr></thead><tbody>${r.rows
            .slice(0, 300)
            .map((x) => `<tr><td>${esc(x.input)}</td><td><b>${esc(x.medicine)}</b></td><td class="n">${esc(x.qty)}</td><td class="n">${esc(rs(x.paid))}</td><td>${x.cheapest === x.medicine ? '<span class="muted">Already cheapest</span>' : esc(x.cheapest)}</td><td class="n">${esc(rs(x.cheapest_cost))}</td><td class="n save-txt">${x.possible_saving ? esc(rs(x.possible_saving)) : ''}</td></tr>`)
            .join('')}</tbody></table></div>${r.rows.length > 300 ? `<p class="small muted">Showing the 300 lines with the biggest possible saving out of ${esc(r.rows.length)}. Download the CSV for all lines.</p>` : ''}` : '<p class="empty-note">No lines could be matched to a medicine.</p>'}
          ${r.unmatched.length ? `<h3 style="margin-block-start:14px">Not matched (${esc(r.unmatched.length)})</h3><p class="small">${r.unmatched.map((x) => esc(x)).join('<br>')}</p><p class="small muted">Use the exact brand and strength, or the medicine id from the site.</p>` : ''}
          <p class="small muted" style="margin-block-start:10px">These are possible savings if the cheapest brand with the same formula, strength and form had been bought at its DRAP maximum retail price. Medicine names are matched automatically, so check the matches. Doctors should confirm any brand switch.</p>
        </div>`;
      $('#claims-print', resEl).addEventListener('click', () => printOrShare($('.report', resEl), 'Claims analysis: ' + S.user.name, 'sasta-dawa-claims-analysis-' + today() + '.html'));
      $('#claims-csv', resEl).addEventListener('click', () => {
        const head = ['Your line', 'Matched medicine', 'Quantity', 'Paid (Rs)', 'DRAP price (Rs)', 'Cheapest option', 'Cheapest cost (Rs)', 'Possible saving (Rs)'];
        const lines = [head.join(',')].concat(r.rows.map((x) => [x.input, x.medicine, x.qty, x.paid, x.mrp, x.cheapest, x.cheapest_cost, x.possible_saving].map(csvCell).join(',')));
        r.unmatched.forEach((x) => lines.push([x, 'NOT MATCHED', '', '', '', '', '', ''].map(csvCell).join(',')));
        lines.push(['TOTAL', '', '', r.total_paid, r.total_mrp, '', r.total_cheapest, r.possible_saving].map(csvCell).join(','));
        downloadFile('sasta-dawa-claims-analysis.csv', '﻿' + lines.join('\r\n')).then(fileToast);
      });
    };
    csvImport($('#claims-import', el), {
      type: 'claims',
      title: 'Upload claims (CSV)',
      intro: 'One row per claim or purchase: <b>medicine</b> (name or id), <b>quantity</b> (tablets, capsules or ml) and <b>amount_paid</b> in Rs (leave empty to use the DRAP price). The file is used only to match medicines and is not stored. Remove staff names first: only these three columns are needed.',
      send: (csv, partial) => api('claims-report', { body: { csv, partial } }),
      onDone: (r) => {
        claimsResult = Object.assign({ rows: [], unmatched: [] }, r);
        draw();
        if (resEl.scrollIntoView) resEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    });
    draw();
  }

  // -- Partner pharmacies: verified pharmacies offering a staff discount
  function viewPartners(el, rest) {
    const city = (rest && rest[0]) || '';
    into(el, async () => {
      const r = await api('partners', { params: city ? { city } : undefined });
      const list = r.partners || [];
      const code = S.user.companyCode;
      const share = `Staff discount at pharmacies: show your company staff card at these Sasta Dawa partner pharmacies${city ? ' in ' + city : ''}:\n` +
        list.slice(0, 15).map((p) => `- ${p.name} (${[p.area, p.city].filter(Boolean).join(', ')}): ${p.offer.percent}% off${p.offer.note ? ' (' + p.offer.note + ')' : ''}${p.whatsapp || p.phone ? ', ' + (p.whatsapp || p.phone) : ''}`).join('\n') +
        `\n\nFull list and cheaper medicine brands: ${SITE}/account${code ? ' (company code ' + code + ')' : ''}`;
      el.innerHTML = `
        <div class="card">
          <h2>Partner pharmacies</h2>
          <p class="muted">Verified pharmacies on Sasta Dawa that give a discount to staff of companies using Sasta Dawa. Staff show their company staff card at the counter. Each pharmacy sets its own discount and conditions; the pharmacy decides at the counter.</p>
          <form class="form" id="partners-form">
            <div class="form-row"><label class="field">City<input class="input" name="city" maxlength="40" value="${esc(city)}" placeholder="All cities"></label></div>
            <div class="actions"><button type="submit" class="btn btn-ghost">Filter</button>${city ? '<a class="btn btn-ghost" href="#/partners">Show all cities</a>' : ''}</div>
          </form>
        </div>
        <div class="card">
          <h3>${esc(list.length)} partner pharmac${list.length === 1 ? 'y' : 'ies'}${city ? ' in ' + esc(city) : ''}</h3>
          ${list.length ? `<div class="items">${list
            .map((p) => `<div class="item">
              <div class="item-top"><div><div class="item-title">${esc(p.name)}</div><div class="item-meta">${esc([p.address, p.area, p.city].filter(Boolean).join(', '))}</div></div><div class="badges" style="margin:0"><span class="badge good">${esc(p.offer.percent)}% staff discount</span>${p.delivery ? '<span class="badge brand">Delivery</span>' : ''}</div></div>
              ${p.offer.note ? `<div class="item-meta">Conditions: ${esc(p.offer.note)}</div>` : ''}
              ${p.hours ? `<div class="item-meta">${esc(p.hours)}</div>` : ''}
              <div class="actions">
                ${p.whatsapp ? `<a class="btn btn-soft" href="${esc(waLink(p.whatsapp))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}
                ${p.phone ? `<a class="btn btn-ghost" href="tel:${esc(String(p.phone).replace(/[^\d+]/g, ''))}">Call</a>` : ''}
                ${p.lat != null && p.lng != null ? `<a class="btn btn-ghost" href="https://www.google.com/maps/dir/?api=1&destination=${esc(p.lat + ',' + p.lng)}" target="_blank" rel="noopener">Directions</a>` : ''}
              </div>
            </div>`)
            .join('')}</div>` : `<p class="empty-note">No partner pharmacies${city ? ' in ' + esc(city) : ''} yet. The list grows as pharmacies add a staff discount.</p>`}
        </div>
        ${list.length ? `<div class="card">
          <h3>Share with your staff</h3>
          <textarea class="input keybox" id="partners-msg" rows="6" readonly aria-label="Message for staff">${esc(share)}</textarea>
          <div class="actions" style="margin-block-start:8px"><button type="button" class="btn btn-ghost" id="partners-copy">Copy message</button><a class="btn btn-soft" href="${esc('https://wa.me/?text=' + encodeURIComponent(share))}" target="_blank" rel="noopener">Share on WhatsApp</a></div>
        </div>` : ''}`;
      onSubmit($('#partners-form', el), async (fd) => {
        const c = val(fd, 'city');
        go(c ? '#/partners/' + encodeURIComponent(c) : '#/partners');
      });
      const cp = $('#partners-copy', el);
      if (cp) cp.addEventListener('click', () => copyText($('#partners-msg', el).value));
    });
  }

  // ===========================================================================
  // Developer
  // ===========================================================================
  function viewKeys(el) {
    into(el, async () => {
      const usage = await api('usage');
      const u = S.user;
      const days = Object.entries(usage.month || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1));
      el.innerHTML = `
        <div class="card">
          <div class="item-top"><h2>API keys</h2><button type="button" class="btn btn-primary" id="key-new">Create key</button></div>
          <div id="key-shown"></div>
          ${u.apiKeys.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Key</th><th>Created</th><th><span class="sr-only">Revoke</span></th></tr></thead><tbody>${u.apiKeys
            .map((k) => `<tr><td><code>${esc(k.prefix)}…</code></td><td>${esc(fmtDate(k.createdAt))}</td><td><button type="button" class="btn btn-ghost sm" style="min-height:44px" data-revoke="${esc(k.id)}">Revoke</button></td></tr>`)
            .join('')}</tbody></table></div>` : '<p class="empty-note">No keys yet.</p>'}
          <p class="form-msg" id="key-msg" role="status"></p>
          <p class="small muted">Up to 5 keys. Read the <a href="developers">API documentation</a>.</p>
        </div>
        <div class="card">
          <h2>Usage</h2>
          <div class="stat-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">
            <div class="stat"><small>Calls today</small><b class="num">${esc(usage.today)}</b></div>
            <div class="stat"><small>Daily limit</small><b class="num">${esc(Number(usage.limit).toLocaleString('en-PK'))}</b></div>
          </div>
          ${days.length ? `<div class="table-wrap"><table class="tbl"><thead><tr><th>Day</th><th class="n">Calls</th></tr></thead><tbody>${days.map(([d, x]) => `<tr><td>${esc(d)}</td><td class="n">${esc((x && x.n) || 0)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty-note">No calls this month.</p>'}
        </div>`;
      $('#key-new', el).addEventListener('click', async (ev) => {
        ev.target.disabled = true;
        try {
          const r = await api('create-key', { body: {} });
          viewKeysAfterCreate(el, r.key);
        } catch (e) {
          if (!e.handled) msg($('#key-msg', el), e.message);
          ev.target.disabled = false;
        }
      });
      el.onclick = async (ev) => {
        const b = ev.target.closest('button[data-revoke]');
        if (!b) return;
        if (!window.confirm('Revoke this key? Apps using it stop working immediately.')) return;
        try {
          await api('revoke-key', { body: { id: b.dataset.revoke } });
          toast('Key revoked.');
          viewKeys(el);
        } catch (e) {
          if (!e.handled) msg($('#key-msg', el), e.message);
        }
      };
    });
  }
  async function viewKeysAfterCreate(el, key) {
    await new Promise((r) => {
      viewKeys(el);
      const wait = () => ($('#key-shown', el) ? r() : setTimeout(wait, 50));
      wait();
    });
    $('#key-shown', el).innerHTML = `<div class="notice info" style="margin-block-end:12px;display:block"><p><b>Your new key</b> (copy it now: it is shown only once)</p><code class="keybox" style="margin-block:8px">${esc(key)}</code><button type="button" class="btn btn-ghost" id="key-copy">Copy key</button></div>`;
    $('#key-copy', el).addEventListener('click', () => copyText(key));
  }

  // ===========================================================================
  // Start
  // ===========================================================================
  const yr = $('#copyright-year');
  if (yr) yr.textContent = new Date().getFullYear();
  // Language toggle (EN | اردو) in the header: same setting as the main site.
  $$('[data-acc-lang]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.getAttribute('data-acc-lang') === LANG) return;
      setLang(b.getAttribute('data-acc-lang'));
      route();
    })
  );
  applyLang();
  if (S.token && !S.user) S.user = { id: '', name: '', role: 'patient', plan: 'free' }; // filled by 'me' below
  const userKey = (x) => (x ? x.id + '|' + x.role + '|' + x.plan + '|' + x.planUntil + '|' + x.hasPassword + '|' + x.google : '');
  const before = userKey(S.user);
  route();
  if (S.token) {
    // Refresh the stored user (plan, role or sign-in method may differ from what this device cached).
    api('me')
      .then(() => {
        if (!S.user) return;
        if ($('.handoff')) return; // on the "Return to the app" screen: don't replace it
        if (userKey(S.user) !== before) return route();
        const h = $('.dash-head .badges');
        if (h) h.innerHTML = planBadges(S.user);
      })
      .catch(() => {});
  }
})();
