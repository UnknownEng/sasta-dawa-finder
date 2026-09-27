/**
 * Sasta Dawa Finder - Internationalization & Plain Language Module
 * Provides natural English & Urdu localization simplified for non-technical users.
 */

(function (root, factory) {
  const lib = factory();
  if (typeof window !== 'undefined') {
    window.SastaI18n = lib;
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = lib;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  let currentLang = 'en';

  const TRANSLATIONS = {
    en: {
      site_title: 'Sasta Dawa Finder',
      site_title_urdu: 'سستی دوا تلاش کار',
      site_tagline: 'Find cheaper, high-quality alternatives for expensive medicines in Pakistan.',
      badge_country: '🇵🇰 Pakistan Medicine Price Guide',
      disclaimer_label: 'Important Notice:',
      disclaimer_text: 'Prices and information are approximate and for general awareness only. Always confirm with a licensed pharmacist or doctor before switching medicines.',
      search_placeholder: 'Type medicine name (e.g. Panadol, Risek, Augmentin, Rivotril)...',
      search_button: 'Search',
      clear_button: 'Clear',
      popular_searches: 'Quick Examples:',
      categories_title: 'Browse by Health Need:',
      cat_all: 'All Medicines',
      cat_pain: 'Pain & Fever',
      cat_stomach: 'Stomach & Heartburn',
      cat_antibiotics: 'Antibiotics',
      cat_cardiac: 'Blood Pressure & Heart',
      cat_diabetes: 'Sugar & Diabetes',
      cat_allergy: 'Allergy, Cough & Cold',
      cat_neuro: 'Brain & Mental Health',
      cat_skin: 'Skin & Ointments',
      cat_pediatric: 'Kids & Syrups',
      results_est_price: 'Approximate Price',
      results_formula: 'Contains (Main Ingredient):',
      results_dosage: 'Type',
      results_manufacturer: 'Company',
      results_category: 'Used For',
      results_pack_of: 'for full pack of',
      unit_tablet: 'tablet',
      unit_capsule: 'capsule',
      unit_puff: 'puff',
      unit_bottle: 'bottle',
      unit_sachet: 'sachet',
      unit_cream: 'tube',
      unit_syrup: 'bottle',
      unit_drop: 'bottle',
      unit_generic: 'piece',
      share_whatsapp: 'Share on WhatsApp',
      share_whatsapp_title: 'Share cheaper alternative on WhatsApp',
      share_msg_header: '💡 *Sasta Dawa Finder (Pakistan)*\nFound a cheaper generic alternative medicine:\n\n',
      share_msg_original: 'Instead of: *{brand}* ({mfg})\nApprox Price: {price} / {unit}\n\n',
      share_msg_alt: 'You can ask for: *{altBrand}* ({altMfg})\nApprox Price: {altPrice} / {unit}\n💰 *Save up to {percent}%* ({diff} less per {unit})\n🔬 Same active formula: *{formula}*\n\n',
      share_msg_disclaimer: '⚠️ *Important*: Always confirm with your doctor or licensed pharmacist before switching medicines.',
      alt_header_title: 'Cheaper Alternatives with the Same Active Ingredient',
      sort_label: 'Show:',
      sort_cheapest: 'Cheapest First (Recommended)',
      sort_savings: 'Highest Savings %',
      sort_price_desc: 'Highest Price First',
      sort_name: 'Brand Name (A to Z)',
      badge_best_value: 'BEST VALUE',
      badge_cheaper: 'CHEAPER',
      badge_same: 'SAME PRICE',
      badge_more_expensive: 'HIGHER PRICE',
      save_percent: 'CHEAPER: Save {percent}% ({amount} less per {unit})',
      more_expensive: 'HIGHER: +{amount} more per {unit}',
      same_price: 'SAME PRICE: {amount} per {unit}',
      same_salt_formula: '✓ Same active ingredient:',
      spotlight_title: 'Save up to {percent}% by switching!',
      spotlight_desc: 'Switch from <strong>{from}</strong> to <strong>{to}</strong> ({mfg}) and save <strong>{savings} on every single {unit}</strong> with the exact same active medicine.',
      spotlight_cheapest_label: 'Lowest Price:',
      zero_alt_title: 'No Cheaper Generic Alternatives Found',
      zero_alt_desc: 'We could not find other brands with the exact same ingredient (<strong>{formula}</strong>) in our database. This medicine may only be made by <strong>{mfg}</strong>. Please ask your doctor or pharmacist if another similar medicine might be suitable.',
      zero_alt_btn: '← Search Another Medicine',
      no_results_title: 'No Medicine Found',
      no_results_desc: 'We could not find any medicine matching "{query}". Please check the spelling or search by the generic ingredient (e.g. Paracetamol, Omeprazole, Clonazepam).',
      no_results_btn: 'View Common Medicines',
      explore_title: 'Common Everyday Medicines in Pakistan',
      explore_subtitle: 'Tap any common medicine below to see its main ingredient and find cheaper alternatives:',
      tips_title: '3 Simple Ways to Save on Medicines in Pakistan',
      tip_salt_title: '1. Same Ingredient = Same Effect',
      tip_salt_desc: 'Medicine brands approved in Pakistan with the same active ingredient work the exact same way. You are often paying extra only for the brand name.',
      tip_unit_title: '2. Compare Price per Pill',
      tip_unit_desc: 'Always check price per tablet or capsule, not the box price. Different boxes have 10, 20, 30, or 100 pills.',
      tip_pharmacist_title: '3. Ask Your Pharmacist',
      tip_pharmacist_desc: 'Simply ask your pharmacist: "Is there a reputable, cheaper local brand with this exact same formula?"',
      footer_disclaimer_title: 'Medical Disclaimer',
      footer_disclaimer: 'Prices and information are approximate and for general awareness only. Always confirm with a licensed pharmacist or doctor before switching medicines.',
      footer_branding: 'Made by Aeromaverick Technologies',
      footer_mission: 'Empowering everyday people in Pakistan to find affordable healthcare choices.',
      footer_copyright: 'All rights reserved.',
      approx_estimate: 'Approx. Estimate',
      unverified_warning: 'Unverified / Estimate',
      find_nearby_stores_btn: '📍 Find Nearby Medical Stores',
      nearby_stores_title: 'Nearby Medical Stores & Pharmacies',
      nearby_stores_subtitle: 'Pharmacies near you where this medicine may be available:',
      nearby_stores_disclaimer: 'Store listings are based on Google Maps data and may not confirm real-time stock of this specific medicine. Please call ahead to confirm availability.',
      store_distance_km: '{distance} km away',
      store_call_btn: 'Call Store',
      store_directions_btn: 'Directions',
      location_prompt_text: 'Allow location access to find medical stores near you in Pakistan.',
      location_denied_msg: 'Location access was denied or unavailable. Enter your city or area below to find stores:',
      manual_area_placeholder: 'Enter city or area (e.g. Clifton, Gulberg, F-7, Saddar)...',
      manual_area_btn: 'Search Stores',
      stores_loading: 'Locating nearby medical stores...',
      no_stores_found: 'No medical stores found in this area. Try searching for a major city.',
      home_nearby_title: 'Looking for a Medical Store near you?',
      home_nearby_subtitle: 'Find 24/7 pharmacies across Pakistan with phone numbers and map directions.',
      live_gmaps_badge: '⚡ Live Google Maps Integration',
      live_gmaps_title: 'View All Nearby Medical Stores on Google Maps',
      live_gmaps_desc: 'Open Google Maps to view 100+ local chemists, 24/7 pharmacies, and medical stores near you with real-time hours, reviews, and route navigation.',
      live_gmaps_btn: 'Open Live Google Maps',
      quick_cities_label: 'Popular Cities:',
      showing_stores_count: 'Showing {count} verified pharmacies near {location}:',
    },
    ur: {
      site_title: 'سستی دوا تلاش کار',
      site_title_urdu: 'پاکستان',
      site_tagline: 'پاکستان میں مہنگی ادویات کے سستے، معیاری اور یکساں متبادل تلاش کریں۔',
      badge_country: '🇵🇰 پاکستان میڈیسن پرائس گائیڈ',
      disclaimer_label: 'اہم طبی انتباہ:',
      disclaimer_text: 'قیمتیں اور معلومات اندازاً اور عمومی آگاہی کے لیے ہیں۔ دوا تبدیل کرنے سے پہلے ہمیشہ مستند ڈاکٹر یا فارماسسٹ سے ضرور مشورہ کریں۔',
      search_placeholder: 'دوا کا نام لکھیں (مثلاً پیناڈول، رائزک، آگمینٹن، ریووٹرل)...',
      search_button: 'تلاش کریں',
      clear_button: 'صاف کریں',
      popular_searches: 'عام مثالیں:',
      categories_title: 'بیماری یا ضرورت کے لحاظ سے دیکھیں:',
      cat_all: 'تمام ادویات',
      cat_pain: 'درد اور بخار',
      cat_stomach: 'معدہ اور تیزابیت',
      cat_antibiotics: 'اینٹی بائیوٹکس',
      cat_cardiac: 'بلڈ پریشر اور دل',
      cat_diabetes: 'شوگر / ذیابیطس',
      cat_allergy: 'الرجی، نزلہ اور زکام',
      cat_neuro: 'دماغ اور اعصابی صحت',
      cat_skin: 'جلد اور مرہم',
      cat_pediatric: 'بچوں کے شربت',
      results_est_price: 'اندازاً قیمت',
      results_formula: 'بنیادی جزو (سالٹ):',
      results_dosage: 'شکل',
      results_manufacturer: 'کمپنی',
      results_category: 'استعمال',
      results_pack_of: 'مکمل پیکٹ',
      unit_tablet: 'گولی',
      unit_capsule: 'کیپسول',
      unit_puff: 'پف',
      unit_bottle: 'بوتل',
      unit_sachet: 'ساشے',
      unit_cream: 'ٹیوب',
      unit_syrup: 'بوتل',
      unit_drop: 'بوتل',
      unit_generic: 'عدد',
      share_whatsapp: 'واٹس ایپ پر شیئر کریں',
      share_whatsapp_title: 'بچت کی تفصیل واٹس ایپ پر بھیجیں',
      share_msg_header: '💡 *سستی دوا تلاش کار (پاکستان)*\nمہنگی دوا کا سستا اور معیاری یکساں متبادل:\n\n',
      share_msg_original: 'اصل دوا: *{brand}* ({mfg})\nاندازاً قیمت: {price} فی {unit}\n\n',
      share_msg_alt: 'سستا متبادل: *{altBrand}* ({altMfg})\nاندازاً قیمت: {altPrice} فی {unit}\n💰 *بچت: {percent}%* ({diff} فی {unit} کم)\n🔬 دونوں میں ایک ہی فعال سالٹ ہے: *{formula}*\n\n',
      share_msg_disclaimer: '⚠️ *اہم انتباہ*: دوا تبدیل کرنے سے پہلے ہمیشہ مستند ڈاکٹر یا فارماسسٹ سے ضرور مشورہ کریں۔',
      alt_header_title: 'یکساں اثر رکھنے والی سستی متبادل ادویات',
      sort_label: 'دیکھیں:',
      sort_cheapest: 'سب سے سستی پہلے (تجویز کردہ)',
      sort_savings: 'سب سے زیادہ بچت %',
      sort_price_desc: 'زیادہ قیمت پہلے',
      sort_name: 'نام کے مطابق (الف تا ے)',
      badge_best_value: 'بہترین قیمت',
      badge_cheaper: 'سستی',
      badge_same: 'یکساں قیمت',
      badge_more_expensive: 'مہنگی',
      save_percent: 'سستی: {percent}% بچت ({amount} فی {unit} کم)',
      more_expensive: 'مہنگی: +{amount} فی {unit} زیادہ',
      same_price: 'یکساں قیمت: {amount} فی {unit}',
      same_salt_formula: '✓ یکساں دوا کا فارمولا:',
      spotlight_title: 'دوا تبدیل کر کے {percent}% تک بچت کریں!',
      spotlight_desc: '<strong>{from}</strong> کی بجائے <strong>{to}</strong> ({mfg}) استعمال کرنے سے آپ کو ہر {unit} پر <strong>{savings} کی بچت</strong> ہوگی جبکہ دوا کا اثر بالکل وہی رہے گا۔',
      spotlight_cheapest_label: 'سب سے کم قیمت:',
      zero_alt_title: 'کوئی سستا متبادل برانڈ نہیں ملا',
      zero_alt_desc: 'ہمارے پاس اس دوا (<strong>{formula}</strong>) کا کوئی دوسرا برانڈ درج نہیں ہے۔ ہو سکتا ہے یہ صرف <strong>{mfg}</strong> ہی بناتی ہو۔ اپنے معالج یا فارماسسٹ سے مشورہ فرمائیں۔',
      zero_alt_btn: '← کوئی دوسری دوا تلاش کریں',
      no_results_title: 'کوئی دوا نہیں ملی',
      no_results_desc: 'آپ کی تلاش "{query}" سے مطابقت رکھنے والی دوا نہیں ملی۔ برائے مہربانی املا چیک کریں یا دوا کا فارمولا لکھیں۔',
      no_results_btn: 'عام ادویات دیکھیں',
      explore_title: 'پاکستان میں عام استعمال ہونے والی ادویات',
      explore_subtitle: 'کسی بھی دوا کو چھوئیں تاکہ اس کا متبادل اور سستے برانڈز دیکھ سکیں:',
      tips_title: 'پاکستان میں ادویات پر پیسے بچانے کے 3 آسان طریقے',
      tip_salt_title: '1. ایک سالٹ = ایک ہی اثر',
      tip_salt_desc: 'پاکستان میں منظور شدہ یکساں فارمولے کی ادویات ایک جیسا اثر رکھتی ہیں۔ زیادہ تر قیمت صرف مشہور برانڈ نام کی ہوتی ہے۔',
      tip_unit_title: '2. ایک گولی کی قیمت دیکھیں',
      tip_unit_desc: 'پورے ڈبے کی بجائے ہمیشہ ایک گولی یا کیپسول کی قیمت کا موازنہ کریں کیونکہ ڈبوں میں تعداد مختلف ہوتی ہے۔',
      tip_pharmacist_title: '3. فارماسسٹ سے پوچھیں',
      tip_pharmacist_desc: 'اپنے فارماسسٹ سے پوچھیں: "کیا اس سالٹ میں کوئی اچھی اور سستی کمپنی کی دوا موجود ہے؟"',
      footer_disclaimer_title: 'طبی انتباہ',
      footer_disclaimer: 'قیمتیں اور معلومات اندازاً اور عمومی آگاہی کے لیے ہیں۔ دوا تبدیل کرنے سے پہلے ہمیشہ مستند ڈاکٹر یا فارماسسٹ سے ضرور مشورہ کریں۔',
      footer_branding: 'Made by Aeromaverick Technologies',
      footer_mission: 'پاکستان کے عوام کے لیے سستی اور شفاف صحت کی فراہمی۔',
      footer_copyright: 'جملہ حقوق محفوظ ہیں۔',
      approx_estimate: 'اندازاً قیمت',
      unverified_warning: 'غیر تصدیق شدہ / اندازاً',
      find_nearby_stores_btn: '📍 قریبی میڈیکل سٹورز تلاش کریں',
      nearby_stores_title: 'قریبی میڈیکل سٹورز اور فارمیسی',
      nearby_stores_subtitle: 'آپ کے قریبی میڈیکل سٹورز جہاں یہ دوا مل سکتی ہے:',
      nearby_stores_disclaimer: 'سٹورز کی معلومات نقشے کے ڈیٹا پر مبنی ہیں اور ہو سکتا ہے کہ اس مخصوص دوا کی فوری موجودگی کی تصدیق نہ کریں۔ براہ کرم جانے سے پہلے فون کر کے تصدیق کریں۔',
      store_distance_km: '{distance} کلومیٹر دور',
      store_call_btn: 'فون کریں',
      store_directions_btn: 'راستہ دیکھیں',
      location_prompt_text: 'اپنے قریبی میڈیکل سٹورز تلاش کرنے کے لیے لوکیشن کی اجازت دیں۔',
      location_denied_msg: 'لوکیشن کی اجازت نہیں ملی۔ قریبی سٹورز تلاش کرنے کے لیے اپنا شہر یا علاقہ درج کریں:',
      manual_area_placeholder: 'شہر یا علاقہ لکھیں (مثلاً کلفٹن، گلبرگ، ایف-7، صدر)...',
      manual_area_btn: 'سٹورز تلاش کریں',
      stores_loading: 'قریبی میڈیکل سٹورز تلاش کیے جا رہے ہیں...',
      no_stores_found: 'اس علاقے میں کوئی میڈیکل سٹور نہیں ملا۔ کسی بڑے شہر کا نام لکھ کر تلاش کریں۔',
      home_nearby_title: 'کیا آپ قریبی میڈیکل سٹور تلاش کر رہے ہیں؟',
      home_nearby_subtitle: 'پاکستان بھر میں اپنے قریبی میڈیکل سٹورز اور 24 گھنٹے کھلی فارمیسیز تلاش کریں۔',
      live_gmaps_badge: '⚡ گوگل میپس لائیو تلاش',
      live_gmaps_title: 'گوگل میپس پر تمام قریبی میڈیکل سٹورز دیکھیں',
      live_gmaps_desc: 'اپنے اردگرد تمام میڈیکل سٹورز، 24 گھنٹے کھلی فارمیسیز اور ادویات کی دکانیں گوگل میپس پر دیکھیں، جہاں لائیو اوقات اور ریٹنگز بھی دستیاب ہیں۔',
      live_gmaps_btn: 'گوگل میپس کھولیں',
      quick_cities_label: 'اہم شہر:',
      showing_stores_count: '{location} کے قریب {count} تصدیق شدہ فارمیسیز:',
    },
  };

  function getLanguage() {
    return currentLang;
  }

  function setLanguage(lang) {
    if (lang === 'ur' || lang === 'en') {
      currentLang = lang;
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem('sasta_dawa_lang', lang);
        } catch (e) {}
      }
    }
    return currentLang;
  }

  function t(key, params = {}) {
    const dict = TRANSLATIONS[currentLang] || TRANSLATIONS.en;
    let text = dict[key] || TRANSLATIONS.en[key] || key;

    Object.keys(params).forEach((p) => {
      text = text.replace(new RegExp(`\\{${p}\\}`, 'g'), params[p]);
    });

    return text;
  }

  function initLanguage() {
    if (typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem('sasta_dawa_lang');
        if (saved === 'ur' || saved === 'en') {
          currentLang = saved;
        }
      } catch (e) {}
    }
    return currentLang;
  }

  return {
    getLanguage,
    setLanguage,
    initLanguage,
    t,
    TRANSLATIONS,
  };
});
