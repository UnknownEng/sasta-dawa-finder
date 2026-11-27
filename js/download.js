/* /download page (no inline scripts, so the site's Content-Security-Policy allows it).
   /download              -> highlights and starts the customer app (Sasta Dawa Finder)
   /download?app=business -> highlights and starts the pharmacies app (Sasta Dawa for Pharmacies)
   Every visit is one download click in Vercel Analytics, so the APK starts after a short pause. */
(function () {
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  function run() {
    var app = /[?&]app=business(?:&|$)/.test(location.search) ? 'business' : 'customer';
    var link = document.getElementById(app === 'business' ? 'apk-business' : 'apk');
    if (!link) return;
    link.classList.add('current');
    var strong = link.querySelector('strong');
    var name = strong ? strong.textContent : 'the app';
    var title = document.getElementById('dl-title');
    var status = document.getElementById('dl-status');
    if (title) title.textContent = 'Your download is starting…';
    if (status) status.textContent = 'Downloading ' + name + '. If nothing happens, tap it below.';
    setTimeout(function () { location.href = link.href; }, 900);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
})();
