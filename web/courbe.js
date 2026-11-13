/* Living Business — courbes temporelles (direction de design §4.22) avec uPlot 1.6.32, chargé à la demande.
   - Servi par la passerelle sous un chemin qui porte la version (/vendor/uplot@1.6.32.js et .css, liste blanche §7.2) :
     aucun CDN, aucune balise <style> (uPlot ne pose ses tailles que par CSSOM, compatible avec la CSP).
   - Couleurs lues dans les jetons (--bz-dv-1, --bz-dv-grille, --bz-dv-texte, --bz-texte-3), recalculées quand le
     thème change ; une donnée absente n'a pas de point (trou, jamais 0) ; seuils en pointillés avec leur libellé.
   - Le canvas est aria-hidden : le résumé en texte est au-dessus et « Voir le tableau » donne les mêmes données.
     Au clavier, la courbe a le focus et les flèches déplacent le réticule (Début et Fin : premier et dernier jour). */
import { annoncer } from './bz/dialogue.js';
import { typo } from './bz/typo.js';

const VERSION = '1.6.32';
let chargement = null;

/** Charge uPlot (script classique + feuille de style) une seule fois. */
export function chargerUplot() {
  if (globalThis.uPlot) return Promise.resolve(globalThis.uPlot);
  chargement ??= new Promise((ok, echec) => {
    if (!document.querySelector(`link[data-uplot]`)) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = `/vendor/uplot@${VERSION}.css`;
      css.dataset.uplot = '';
      document.head.append(css);
    }
    const s = document.createElement('script');
    s.src = `/vendor/uplot@${VERSION}.js`;
    s.async = true;
    s.onload = () => (globalThis.uPlot ? ok(globalThis.uPlot) : echec(new Error('uPlot absent')));
    s.onerror = () => { chargement = null; echec(new Error('La courbe n’a pas pu être chargée.')); };
    document.head.append(s);
  });
  return chargement;
}

const jeton = (nom) => getComputedStyle(document.documentElement).getPropertyValue(nom).trim();
/** Taille d'un jeton (rem ou px) en pixels CSS, pour le canvas. */
const pixels = (nom, defaut) => {
  const v = jeton(nom);
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return defaut;
  return v.endsWith('rem') ? n * parseFloat(getComputedStyle(document.documentElement).fontSize) : n;
};
const DATE_AXE = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const DATE_LONGUE = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

/**
 * Dessine une courbe dans `hote` (vidé). donnees : { x: secondes[], y: (nombre|null)[] }.
 * options : { unite: 'sur 100', min, max, seuils: [{ valeur, libelle }], lecture (élément où écrire la valeur pointée),
 * cadre (élément focalisable qui reçoit les flèches), nomSerie, graduations (axe vertical), dateAxe et dateLongue
 * (Intl.DateTimeFormat de l'axe et de la lecture : un point par mois pour la satisfaction) }. Renvoie { detruire }.
 */
export async function courbe(hote, donnees, options = {}) {
  const uPlot = await chargerUplot();
  const { min = 0, max = 100, seuils = [], lecture = null, unite = 'sur 100', nomSerie = 'Score', graduations = [0, 25, 50, 75, 100], dateAxe = DATE_AXE, dateLongue = DATE_LONGUE, vide = 'pas de relevé' } = options;
  let u = null;
  let detruit = false;
  const dire = (i, { annonce = false } = {}) => {
    if (i === null || i === undefined || !lecture) return;
    const v = donnees.y[i];
    const t = `${dateLongue.format(new Date(donnees.x[i] * 1000))} : ${v === null || v === undefined ? vide : `${String(v).replace('.', ',')} ${unite}`}`;
    lecture.textContent = typo(t.charAt(0).toUpperCase() + t.slice(1));
    if (annonce) annoncer(lecture.textContent);
  };
  const construire = () => {
    if (detruit || !hote.isConnected) return;
    u?.destroy();
    hote.replaceChildren();
    const police = `${pixels('--bz-t-micro', 12)}px ${jeton('--bz-police') || 'sans-serif'}`;
    const texte = jeton('--bz-dv-texte') || jeton('--bz-texte-2');
    const grille = jeton('--bz-dv-grille') || jeton('--bz-bordure-decor');
    const serie = jeton('--bz-dv-1');
    const seuil = jeton('--bz-texte-3');
    const fond = jeton('--bz-surface');
    const largeur = Math.max(240, hote.clientWidth || 320);
    const hauteur = hote.clientHeight > 80 ? hote.clientHeight : 200; // hauteur posée par le CSS (.bz-courbe__trace)
    u = new uPlot({
      width: largeur,
      height: hauteur,
      // les jours et les mois sont des dates UTC (minuit UTC) : uPlot place ses graduations en UTC, comme leurs libellés
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), 'Etc/UTC'),
      scales: { x: { time: true }, y: { range: [min, max] } },
      series: [
        { value: (_, v) => (v ? dateAxe.format(new Date(v * 1000)) : '') },
        // peu de relevés : chaque point est dessiné (un jour isolé entre deux trous reste visible)
        { label: nomSerie, stroke: serie, width: 2, spanGaps: false, points: { show: donnees.y.filter((v) => v !== null && v !== undefined).length <= 45, size: 5, fill: serie } },
      ],
      axes: [
        { stroke: texte, font: police, grid: { show: false }, ticks: { stroke: grille, width: 1 }, values: (_, ticks) => ticks.map((v) => dateAxe.format(new Date(v * 1000))) },
        { stroke: texte, font: police, size: 36, grid: { stroke: grille, width: 1 }, ticks: { show: false }, splits: () => graduations.filter((v) => v >= min && v <= max) },
      ],
      cursor: { y: false, drag: { x: false, y: false, setScale: false }, points: { size: 8, fill: serie } },
      legend: { show: false },
      hooks: {
        setCursor: [(p) => dire(p.cursor.idx)],
        draw: [(p) => {
          const c = p.ctx;
          c.save();
          // seuils : trait pointillé et libellé, à droite
          c.strokeStyle = seuil;
          c.fillStyle = seuil;
          c.lineWidth = devicePixelRatio;
          c.setLineDash([4 * devicePixelRatio, 3 * devicePixelRatio]);
          c.font = police.replace(/^[\d.]+px/, (m) => `${parseFloat(m) * devicePixelRatio}px`);
          c.textAlign = 'right';
          c.textBaseline = 'alphabetic';
          const lignes = seuils.map((s) => ({ s, y: p.valToPos(s.valeur, 'y', true) }));
          for (const { y } of lignes) {
            c.beginPath();
            c.moveTo(p.bbox.left, y);
            c.lineTo(p.bbox.left + p.bbox.width, y);
            c.stroke();
          }
          // libellés APRÈS tous les traits, posés au-dessus de leur ligne (en dessous s'il n'y a pas la place) sur un
          // fond de la couleur de la carte : ni la courbe ni un pointillé ne les traverse
          c.setLineDash([]);
          const d = devicePixelRatio;
          const x = p.bbox.left + p.bbox.width - 4 * d;
          for (const { s, y } of lignes) {
            const lib = typo(s.libelle);
            const m = c.measureText(lib);
            const haut = m.actualBoundingBoxAscent || parseFloat(c.font) * 0.75;
            const bas = m.actualBoundingBoxDescent || 0;
            let ligneBase = y - 5 * d - bas;
            if (ligneBase - haut - 2 * d < p.bbox.top) ligneBase = y + 5 * d + haut;
            if (fond) { c.fillStyle = fond; c.fillRect(x - m.width - 3 * d, ligneBase - haut - 2 * d, m.width + 6 * d, haut + bas + 4 * d); }
            c.fillStyle = seuil;
            c.fillText(lib, x, ligneBase);
          }
          // dernier point relevé : 3 px (comme la sparkline, §4.22)
          let i = donnees.y.length - 1;
          while (i >= 0 && (donnees.y[i] === null || donnees.y[i] === undefined)) i--;
          if (i >= 0) {
            c.setLineDash([]);
            c.fillStyle = serie;
            c.beginPath();
            c.arc(p.valToPos(donnees.x[i], 'x', true), p.valToPos(donnees.y[i], 'y', true), 3 * devicePixelRatio, 0, 2 * Math.PI);
            c.fill();
          }
          c.restore();
        }],
      },
    }, [donnees.x, donnees.y], hote);
    u.root.setAttribute('aria-hidden', 'true');
  };
  construire();
  // lecture au clavier : le cadre a le focus, les flèches déplacent le réticule d'un jour
  let idx = null;
  const allerA = (i) => {
    if (!u) return;
    idx = Math.max(0, Math.min(donnees.x.length - 1, i));
    const y = donnees.y[idx];
    u.setCursor({ left: u.valToPos(donnees.x[idx], 'x'), top: u.valToPos(y ?? (min + max) / 2, 'y') });
    dire(idx, { annonce: true });
  };
  const clavier = (e) => {
    const dernier = donnees.x.length - 1;
    const pas = { ArrowLeft: -1, ArrowRight: 1 }[e.key];
    if (pas) { e.preventDefault(); allerA((idx ?? dernier) + pas); return; }
    if (e.key === 'Home') { e.preventDefault(); allerA(0); }
    if (e.key === 'End') { e.preventDefault(); allerA(dernier); }
  };
  const cadre = options.cadre ?? hote;
  cadre.addEventListener('keydown', clavier);
  cadre.addEventListener('focus', () => { if (idx === null) allerA(donnees.x.length - 1); });
  const taille = new ResizeObserver(() => {
    if (!hote.isConnected) { arreter(); return; }
    if (u && Math.abs((hote.clientWidth || 0) - u.width) > 8) u.setSize({ width: Math.max(240, hote.clientWidth), height: u.height });
  });
  taille.observe(hote);
  const theme = new MutationObserver(() => { if (!hote.isConnected) { arreter(); return; } construire(); if (idx !== null) allerA(idx); });
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-contraste'] });
  function arreter() { detruit = true; taille.disconnect(); theme.disconnect(); u?.destroy(); u = null; }
  return { detruire: arreter };
}
