/* Apply the saved light/dark choice before the page paints (no white flash).
   Loaded as a normal (blocking) script in <head>: the Content-Security-Policy allows no inline scripts. */
(function () {
  var t = 'system';
  try { var v = localStorage.getItem('sd_theme'); if (v) t = JSON.parse(v); } catch (e) {}
  var dark = t === 'dark' || (t !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
