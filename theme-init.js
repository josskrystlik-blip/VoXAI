/**
 * VoxAI - Thème appliqué avant l'affichage (évite un flash) : auto = réglage du système, ou clair / sombre.
 * Fichier séparé (et non script en ligne) pour permettre une politique CSP stricte.
 */
(function () {
  var KEY = 'voxai_theme';
  var media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
  function pref() { try { return localStorage.getItem(KEY) || 'auto'; } catch (e) { return 'auto'; } }
  function apply() {
    var p = pref();
    var light = p === 'light' || (p === 'auto' && media && media.matches);
    document.documentElement.setAttribute('data-theme', light ? 'light' : 'dark');
    var meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.content = light ? 'light' : 'dark';
  }
  window.VoxTheme = {
    get: pref,
    set: function (p) { try { localStorage.setItem(KEY, p); } catch (e) {} apply(); document.dispatchEvent(new CustomEvent('voxai:theme', { detail: p })); },
    apply: apply
  };
  if (media && media.addEventListener) media.addEventListener('change', function () { if (pref() === 'auto') apply(); });
  apply();
})();
