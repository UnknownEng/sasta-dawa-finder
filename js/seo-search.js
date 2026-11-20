/* Search box with suggestions on the Google-facing pages (/dawa, /formula, /browse).
 * Loads a small brand/formula list the first time the box is used; typing "pana" offers Panadol.
 * Picking a suggestion opens that medicine's page; Enter without picking searches in the app. */
(function () {
  'use strict';
  var form = document.getElementById('seo-search');
  if (!form) return;
  var input = form.querySelector('input');
  var box = document.getElementById('seo-suggest');
  var list = null;
  var loading = null;
  var active = -1;
  var shown = [];

  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function load() {
    if (list) return Promise.resolve(list);
    if (!loading) {
      loading = fetch('/data/search-index.json').then(function (r) { return r.json(); }).then(function (d) {
        list = d.b.map(function (x) { return { n: x[0], u: '/dawa/' + x[1], g: x[2], k: norm(x[0]), w: x[3] || 0 }; })
          .concat(d.f.map(function (x) { return { n: x[0], u: '/formula/' + x[1], g: 'Formula (salt)', k: norm(x[0]), w: -1 }; }));
        return list;
      }).catch(function () { loading = null; return []; });
    }
    return loading;
  }

  function match(q) {
    var k = norm(q);
    if (!k) return [];
    var starts = [], words = [], inside = [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (it.k.indexOf(k) === 0) starts.push(it);
      else if (it.k.indexOf(' ' + k) > 0) words.push(it);
      else if (k.length > 2 && it.k.indexOf(k) > 0) inside.push(it);
    }
    // Well-known brands first, then other brands, then formulas; shorter (base) names before variants.
    var byPop = function (a, b) { return b.w - a.w || a.n.length - b.n.length || a.n.localeCompare(b.n); };
    starts.sort(byPop); words.sort(byPop); inside.sort(byPop);
    return starts.concat(words, inside).slice(0, 8);
  }

  function render() {
    if (!shown.length) { box.hidden = true; input.setAttribute('aria-expanded', 'false'); return; }
    var k = norm(input.value);
    box.innerHTML = shown.map(function (it, i) {
      var name = esc(it.n);
      var at = it.k.indexOf(k);
      if (at === 0) name = '<b>' + esc(it.n.slice(0, k.length)) + '</b>' + esc(it.n.slice(k.length));
      return '<li role="option" id="sg-' + i + '"' + (i === active ? ' aria-selected="true" class="on"' : '') +
        '><a href="' + it.u + '"><span class="n">' + name + '</span> <span class="g">' + esc(it.g) + '</span></a></li>';
    }).join('');
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-activedescendant', active >= 0 ? 'sg-' + active : '');
  }

  function update() {
    var q = input.value;
    load().then(function () {
      if (q !== input.value) return;
      shown = match(q);
      active = -1;
      render();
    });
  }

  input.addEventListener('focus', load);
  input.addEventListener('input', update);
  input.addEventListener('keydown', function (e) {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { active = Math.min(active + 1, shown.length - 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(active - 1, -1); render(); e.preventDefault(); }
    else if (e.key === 'Escape') { shown = []; render(); }
  });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (active >= 0 && shown[active]) { location.href = shown[active].u; return; }
    var q = input.value.trim();
    location.href = q ? '/#/search/' + encodeURIComponent(q) : '/';
  });
  document.addEventListener('click', function (e) { if (!form.contains(e.target)) { shown = []; render(); } });
})();
