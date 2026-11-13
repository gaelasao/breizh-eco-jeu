/* Breizhcosystem — thème et préférences d'apparence (direction de design §3.1).
   Script CLASSIQUE et synchrone, chargé dans <head> avant bz.css : data-theme est posé avant le premier rendu
   (pas de flash ; un module serait différé, un script en ligne serait bloqué par la CSP).
   Préférences de CET appareil seulement (localStorage, dans un try/catch : navigation privée = valeurs par défaut).
   API : window.bzTheme.lire(), .regler(cle, valeur), .pleinSoleil(actif?), événement « bz:preferences » sur <html>. */
(function () {
  'use strict';
  var CLE = 'bz-preferences';
  var racine = document.documentElement;
  // préférence → attribut posé sur <html> (absent = suit le système ou la valeur par défaut)
  var ATTRIBUTS = { contraste: 'data-contraste', transparence: 'data-transparence', texte: 'data-texte', mouvement: 'data-mouvement', densite: 'data-densite', police: 'data-police' };
  var VALEURS = {
    theme: ['systeme', 'clair', 'sombre'], contraste: ['eleve', 'normal'], transparence: ['vitree', 'teintee', 'opaque'],
    texte: ['grand', 'tres-grand'], mouvement: ['reduit', 'normal'], densite: ['compacte'], police: ['lisible'], raccourcis: [true, false],
  };
  var sombreSysteme = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function lire() {
    var p = {};
    try { p = JSON.parse(window.localStorage.getItem(CLE) || '{}') || {}; } catch (e) { p = {}; }
    var propres = {};
    for (var k in VALEURS) if (VALEURS[k].indexOf(p[k]) !== -1) propres[k] = p[k];
    if (!propres.theme) propres.theme = 'systeme';
    if (propres.raccourcis === undefined) propres.raccourcis = true;
    return propres;
  }
  function ecrire(p) {
    try { window.localStorage.setItem(CLE, JSON.stringify(p)); } catch (e) { /* stockage indisponible : réglage pour cette page seulement */ }
  }
  function themeEffectif(p) {
    if (p.theme === 'clair' || p.theme === 'sombre') return p.theme;
    return sombreSysteme && sombreSysteme.matches ? 'sombre' : 'clair';
  }
  // theme-color (§2.3) : les couleurs viennent des deux balises de la page (media light / dark), jamais d'ici
  function metasTheme(p) {
    var metas = document.querySelectorAll('meta[name="theme-color"]');
    var origine = { clair: '', sombre: '' };
    for (var i = 0; i < metas.length; i++) {
      var m = metas[i];
      if (!m.hasAttribute('data-bz-origine')) m.setAttribute('data-bz-origine', m.getAttribute('content') || '');
      var media = m.getAttribute('media') || '';
      if (media.indexOf('dark') !== -1) origine.sombre = m.getAttribute('data-bz-origine'); else origine.clair = m.getAttribute('data-bz-origine');
    }
    // thème forcé : les deux balises prennent la couleur du thème choisi ; « Système » : valeurs d'origine (media)
    for (var j = 0; j < metas.length; j++) {
      var force = p.theme === 'systeme' ? '' : origine[p.theme];
      metas[j].setAttribute('content', force || metas[j].getAttribute('data-bz-origine'));
    }
  }
  var courant = lire();
  function appliquer(p) {
    racine.setAttribute('data-theme', themeEffectif(p));
    for (var k in ATTRIBUTS) {
      if (p[k]) racine.setAttribute(ATTRIBUTS[k], p[k]); else racine.removeAttribute(ATTRIBUTS[k]);
    }
    if (p.raccourcis === false) racine.setAttribute('data-raccourcis', 'non'); else racine.removeAttribute('data-raccourcis');
    if (document.readyState !== 'loading') metasTheme(p);
  }
  function annoncer() {
    var ev;
    try { ev = new CustomEvent('bz:preferences', { detail: courant }); } catch (e) { return; }
    racine.dispatchEvent(ev);
  }
  appliquer(courant);
  document.addEventListener('DOMContentLoaded', function () { metasTheme(courant); });
  if (sombreSysteme) {
    var suivre = function () { if (courant.theme === 'systeme') { appliquer(courant); annoncer(); } };
    if (sombreSysteme.addEventListener) sombreSysteme.addEventListener('change', suivre); else if (sombreSysteme.addListener) sombreSysteme.addListener(suivre);
  }
  // Un autre onglet a changé une préférence : on suit
  window.addEventListener('storage', function (e) { if (e.key === CLE) { courant = lire(); appliquer(courant); annoncer(); } });

  // Clavier virtuel d'iOS (interactive-widget est ignoré) : hauteur cachée par le clavier dans --bz-clavier
  var vv = window.visualViewport;
  if (vv) {
    var clavier = function () {
      var cache = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      racine.style.setProperty('--bz-clavier', cache > 80 ? cache + 'px' : '0px');
      if (cache > 80) racine.setAttribute('data-clavier', 'ouvert'); else racine.removeAttribute('data-clavier');
    };
    vv.addEventListener('resize', clavier);
    vv.addEventListener('scroll', clavier);
  }

  window.bzTheme = {
    lire: function () { var c = {}; for (var k in courant) c[k] = courant[k]; c.themeEffectif = themeEffectif(courant); c.pleinSoleil = courant.contraste === 'eleve' && courant.transparence === 'opaque'; return c; },
    regler: function (cle, valeur) {
      if (!VALEURS[cle]) return;
      if (valeur === null || valeur === undefined || VALEURS[cle].indexOf(valeur) === -1) delete courant[cle]; else courant[cle] = valeur;
      if (!courant.theme) courant.theme = 'systeme';
      if (courant.raccourcis === undefined) courant.raccourcis = true;
      ecrire(courant); appliquer(courant); annoncer();
    },
    /** « Plein soleil » : contraste élevé + HUD opaque, posés et retirés ensemble. Sans argument : bascule. */
    pleinSoleil: function (actif) {
      var etait = courant.contraste === 'eleve' && courant.transparence === 'opaque';
      var oui = actif === undefined ? !etait : Boolean(actif);
      if (oui) { courant.contraste = 'eleve'; courant.transparence = 'opaque'; } else { delete courant.contraste; delete courant.transparence; }
      ecrire(courant); appliquer(courant); annoncer();
      return oui;
    },
  };
})();
