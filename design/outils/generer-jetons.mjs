import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync, brotliCompressSync, constants as Z } from 'node:zlib';
import { hex, fmt, ratioP3, mapToSrgb, rgba } from './couleurs.mjs';
import { clair, sombre, controles, controlesScene, cvd, fails, scene, fondsScene, materiaux, distQuartiers, sequentiel, monotonie } from './palette.mjs';

// Usage : node design/outils/generer-jetons.mjs
// Écrit design/tokens.css, design/dist/tokens.min.css, design/dist/MANIFESTE.json, design/outils/rapport-contrastes.md,
// et, si un document de design est donné en 4e argument, y remplace le bloc du §3.2 et le tableau du §3.4 (entre leurs
// marqueurs).
const VERSION = '1.1.0';
const ici = (p) => fileURLToPath(new URL(p, import.meta.url));
const sortie = process.argv[2] ?? ici('../tokens.css');
const rapportOut = process.argv[3] ?? ici('./rapport-contrastes.md');
const distDir = process.argv[4] ?? ici('../dist/');
const docPath = process.argv[5];

// ---- Primitives : liste ordonnée des variables ----
function primitives(P) {
  const v = [];
  for (const [k, c] of Object.entries(P.granit)) v.push([`granit-${k}`, c]);
  for (const [k, c] of Object.entries(P.iroise)) v.push([`iroise-${k}`, c]);
  for (const [k, c] of Object.entries(P.ajonc)) v.push([`ajonc-${k}`, c]);
  for (const t of ['ok', 'attention', 'critique', 'info']) for (const r of ['fond', 'bord', 'plein', 'texte', 'trait']) { const c = P[t][r] ?? (r === 'trait' ? P[t].plein : undefined); if (c) v.push([`${t}-${r}`, c]); }
  for (const [k, c] of Object.entries(P.inverse)) v.push([`inverse-${k}`, c]);
  for (const [k, c] of Object.entries(P.dv)) v.push([`dv-${k}`, c]);
  return v;
}
const ind = (n) => '  '.repeat(n);
const bloc = (vars, n) => vars.map(([nom, c]) => `${ind(n)}--bz-${nom}: ${fmt(mapToSrgb(c))};`).join('\n');
// P3 : chroma +18 % sur marque, accent, statuts pleins/traits et données (le texte reste en sRGB pour garder les contrastes vérifiés)
function p3(P) {
  const v = [];
  const boost = (c, f = 1.18) => [c[0], c[1] * f, c[2]];
  v.push(['iroise-9', boost(P.iroise[9])], ['iroise-10', boost(P.iroise[10])], ['ajonc-9', boost(P.ajonc[9], 1.12)]);
  for (const t of ['ok', 'attention', 'critique', 'info']) { v.push([`${t}-plein`, boost(P[t].plein)]); v.push([`${t}-trait`, boost(P[t].trait ?? P[t].plein)]); }
  for (const k of [1, 2, 3, 4, 5, 6]) v.push([`dv-${k}`, boost(P.dv[k], 1.15)]);
  return v;
}
const p3Bloc = (vars, n) => vars.map(([nom, c]) => `${ind(n)}--bz-${nom}: ${fmt(c)};`).join('\n');
const p3fails = [];
for (const [th, P] of [['clair', clair], ['sombre', sombre]]) {
  const sur = th === 'clair' ? [1, 0, 0] : P.granit[1];
  for (const [nom, c] of p3(P)) {
    if (nom.startsWith('iroise')) { const r = ratioP3(sur, c); if (r < 4.5) p3fails.push(`${th} ${nom} ${r.toFixed(2)}`); }
    if (nom.endsWith('-trait') || nom.startsWith('dv-')) { const r = ratioP3(c, P.granit[4]); if (r < 3) p3fails.push(`${th} ${nom}/granit-4 ${r.toFixed(2)}`); }
  }
}

// ---- Ressorts en linear() ----
function ressort(zeta, n = 40) {
  const w = 6.9 / zeta, wd = w * Math.sqrt(1 - zeta * zeta);
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = i / n; const x = 1 - Math.exp(-zeta * w * t) * (Math.cos(wd * t) + ((zeta * w) / wd) * Math.sin(wd * t)); pts.push(i === n ? 1 : +x.toFixed(3)); }
  return `linear(${pts.join(', ')})`;
}
// ---- Échelle fluide 360 px -> 1280 px ----
function fluide(min, max) {
  const vmin = 360, vmax = 1280; const pente = (max - min) / (vmax - vmin); const base = min - pente * vmin;
  return `clamp(${+(min / 16).toFixed(4)}rem, ${+(base / 16).toFixed(4)}rem + ${+(pente * 100).toFixed(4)}vw, ${+(max / 16).toFixed(4)}rem)`;
}
const sceneBloc = (m) => Object.entries(scene[m]).map(([k, v]) => `  --bz-scene-${m}-${k}: ${v};`).join('\n');
const VC = primitives(clair), VS = primitives(sombre);
const verreSombre = rgba(sombre.granit[0], 0.82), etiquetteSombre = rgba(sombre.granit[0], 0.88);
const bordClair = rgba(clair.granit[12], 0.1), bordSombre = rgba(sombre.granit[12], 0.12);

const css = `/*!
 * Breizhcosystem — jetons de design (tokens.css) v${VERSION}
 * Source de vérité commune à Living Business et aux autres interfaces Breizhcosystem.
 * Généré par design/outils/generer-jetons.mjs à partir des valeurs OKLCH ; NE PAS éditer à la main.
 * Couleurs d'origine Breizhcosystem (aucune palette tierce recopiée). Contrastes vérifiés WCAG 2.2 AA (design/outils/rapport-contrastes.md).
 *
 * Navigateurs : Safari et iOS 15.4, Chrome 111, Firefox 113 au minimum (oklch() et @layer). Les fonctions plus récentes
 * (color-mix 16.2, linear() 17.2) ont un repli dans ce fichier.
 * Thème : <html data-theme="clair|sombre">, TOUJOURS posé par /bz/theme.js (script classique synchrone dans <head>),
 *         qui résout « Système » avec prefers-color-scheme et suit ses changements. Sans attribut : thème clair.
 * Préférences : data-contraste="eleve|normal", data-transparence="opaque|teintee|vitree", data-texte="grand|tres-grand",
 *               data-mouvement="reduit", data-densite="compacte" (souris seulement), data-police="lisible".
 * Ordre des blocs : 1 primitives OKLCH · 2 gamut P3 · 3 sémantique · 4 typographie · 5 espace, formes, profondeur
 *                   · 6 mouvement · 7 couches et mise en page · 8 scène 3D · 9 préférences.
 */

@layer bz.jetons {

/* ==========================================================================
   1. PRIMITIVES — OKLCH (valeurs d'auteur, toutes dans le gamut sRGB)
   Échelle à 12 paliers à rôle fixe : 0-2 fonds · 3-5 composants (repos, survol, pressé)
   6-7 bordures décoratives · 8 bordure interactive (≥ 3:1) · 9 bordure interactive survolée · 10 texte méta
   11 texte secondaire · 12 texte principal. « Ardoise sur chaux » : paliers 0-7 chauds (chaux) en clair, bleu nuit en sombre,
   paliers 8-12 en ardoise. La luminosité de chaque échelle est monotone (vérifié par le générateur).
   ========================================================================== */
:root {
${bloc(VC, 1)}
}
:root[data-theme="sombre"] {
${bloc(VS, 1)}
}

/* ==========================================================================
   2. ÉCRANS P3 — aplats plus vifs (marque, accent, statuts, données).
   Les couleurs de texte ne changent pas : les contrastes vérifiés restent valables.
   ========================================================================== */
@media (color-gamut: p3) {
  :root {
${p3Bloc(p3(clair), 2)}
  }
  :root[data-theme="sombre"] {
${p3Bloc(p3(sombre), 2)}
  }
}

/* ==========================================================================
   3. SÉMANTIQUE — c'est la seule couche que les composants utilisent.
   Les primitives changent de valeur selon le thème ; le rôle, lui, ne change pas.
   ========================================================================== */
:root {
  color-scheme: light;

  /* Fonds et surfaces */
  --bz-fond: var(--bz-granit-1);              /* fond de l'application */
  --bz-fond-2: var(--bz-granit-2);            /* rail, zones secondaires, pied de feuille */
  --bz-surface: var(--bz-granit-0);           /* cartes, tableaux, champs */
  --bz-surface-elevee: var(--bz-granit-0);    /* menus, popovers, dialogues (sombre : plus clair, cf. bloc thème) */
  --bz-surface-inverse: var(--bz-granit-12);  /* toasts, infobulles, bandeau Simulation */
  --bz-sur-inverse: var(--bz-granit-1);
  --bz-lien-inverse: var(--bz-inverse-lien);  /* lien ou bouton « Annuler » sur surface inverse */
  --bz-focus-inverse: var(--bz-inverse-focus);

  /* Composants neutres (boutons secondaires, puces, segments) */
  --bz-composant: var(--bz-granit-3);
  --bz-composant-survol: var(--bz-granit-4);
  --bz-composant-presse: var(--bz-granit-5);

  /* Bordures */
  --bz-bordure-decor: var(--bz-granit-6);     /* séparateurs : décoratif, jamais seul repère */
  --bz-bordure: var(--bz-granit-7);           /* contour d'un composant non interactif, carte au toucher */
  --bz-bordure-champ: var(--bz-granit-8);     /* champs, cases, interrupteurs, segment pressé : ≥ 3:1 (WCAG 1.4.11) */
  --bz-bordure-champ-survol: var(--bz-granit-9);
  --bz-carte-bord: transparent;               /* visible au toucher et sur écran compact (bloc 7) ; transparent ≠ absent en forced-colors */
  --bz-proposition-bord: var(--bz-bordure-champ); /* proposition d'un agent, en pointillés : « pas encore réel » */

  /* Texte et icônes */
  --bz-texte: var(--bz-granit-12);            /* ≥ 7:1 sur toutes les surfaces */
  --bz-texte-2: var(--bz-granit-11);          /* secondaire, ≥ 4,5:1 */
  --bz-texte-3: var(--bz-granit-10);          /* méta, aide : ≥ 4,5:1 ; jamais sur le verre */
  --bz-texte-desactive: var(--bz-granit-8);   /* exempté de contraste, toujours doublé d'un état explicite ; jamais sur le verre */
  --bz-icone: var(--bz-granit-11);

  /* Marque « Iroise » : action principale, liens, sélection, focus */
  --bz-marque: var(--bz-iroise-9);
  --bz-marque-survol: var(--bz-iroise-10);
  --bz-marque-texte: var(--bz-iroise-11);     /* liens et texte de marque, ≥ 4,5:1 */
  --bz-marque-doux: var(--bz-iroise-3);       /* remplissage de l'élément courant ou sélectionné (jamais seul repère) */
  --bz-marque-doux-survol: var(--bz-iroise-4);
  --bz-marque-bord: var(--bz-iroise-7);       /* décoratif */
  --bz-sur-marque: #fff;
  --bz-selection: var(--bz-iroise-3);
  --bz-etat-indicateur: var(--bz-marque);     /* bordure 2 px de l'élément courant, sélectionné, actif : ≥ 3:1 sur le fond voisin */

  /* Accent « Ajonc » : moments de marque uniquement (XP, phare, badge ACTIVE, célébration). Jamais un bouton, jamais un statut. */
  --bz-accent: var(--bz-ajonc-9);
  --bz-accent-survol: var(--bz-ajonc-10);
  --bz-accent-doux: var(--bz-ajonc-3);
  --bz-accent-bord: var(--bz-ajonc-7);
  --bz-accent-texte: var(--bz-ajonc-11);
  --bz-sur-accent: var(--bz-granit-12);
  --bz-xp-piste: var(--bz-granit-11);         /* or sur ardoise : lisible en plein soleil */
  --bz-xp-piste-bord: var(--bz-granit-11);
  --bz-xp-remplissage: var(--bz-accent);

  /* Statuts : uniquement pour des états. Toujours icône + libellé en plus de la couleur. */
  --bz-sur-ok: #fff;
  --bz-sur-attention: var(--bz-granit-12);
  --bz-sur-critique: #fff;
  --bz-sur-info: #fff;

  /* Visualisation de données : 6 catégories + « autres » (ordre fixe, toujours étiquetées) — graphiques uniquement */
  --bz-dv-grille: var(--bz-granit-6);
  --bz-dv-axe: var(--bz-granit-8);
  --bz-dv-texte: var(--bz-texte-2);
  --bz-dv-seq-1: var(--bz-iroise-3);          /* rampe séquentielle : chaque case affiche aussi sa valeur (seq-1 à 3 < 3:1) */
  --bz-dv-seq-2: var(--bz-iroise-5);
  --bz-dv-seq-3: var(--bz-iroise-7);
  --bz-dv-seq-4: var(--bz-iroise-8);
  --bz-dv-seq-5: var(--bz-iroise-10);
  --bz-dv-negatif: var(--bz-critique-trait);
  --bz-dv-neutre: var(--bz-granit-8);
  --bz-dv-positif: var(--bz-ok-trait);
  --bz-tirets-estime: 4 3;                    /* stroke-dasharray d'un segment estimé */

  /* Catégories d'entités : la FORME et l'icône disent la catégorie (rond client, carré fournisseur, losange partenaire,
     hexagone équipe, rond pointillé prospect, goutte lieu), sur un fond neutre. Aucune couleur de catégorie. */
  --bz-cat-fond: var(--bz-composant);
  --bz-cat-icone: var(--bz-texte-2);
  --bz-cat-bord: var(--bz-bordure-champ);

  /* Voile des dialogues et feuilles */
  --bz-voile: rgb(10 16 22 / 0.48);

  /* Matériau « verre » : réservé aux contrôles posés sur la carte 3D. Replis rgb() pour iOS 15.4-16.1 (sans color-mix). */
  --bz-verre-opacite: 86%;
  --bz-verre-fond: rgb(255 255 255 / 0.86);
  --bz-verre-flou: 14px;
  --bz-verre-saturation: 1.5;
  --bz-verre-bord: ${bordClair};
  --bz-verre-reflet: inset 0 1px 0 rgb(255 255 255 / 0.55);
  --bz-etiquette-fond: rgb(255 255 255 / 0.9);  /* étiquettes 3D */

  /* Focus : contour (outline) seulement, il survit à forced-colors. Sur la carte et le verre : halo --bz-focus-halo autour. */
  --bz-focus-couleur: var(--bz-marque);
  --bz-focus-largeur: 2px;
  --bz-focus-ecart: 2px;
  --bz-focus-halo: var(--bz-surface);

  /* Ombres (clair) — trois couches max., teinte ardoise, jamais noir pur */
  --bz-ombre-0: none;
  --bz-ombre-1: 0 1px 2px rgb(16 24 32 / 0.06), 0 1px 1px rgb(16 24 32 / 0.04);
  --bz-ombre-2: 0 6px 16px -4px rgb(16 24 32 / 0.12), 0 2px 4px -2px rgb(16 24 32 / 0.06);
  --bz-ombre-3: 0 16px 40px -10px rgb(16 24 32 / 0.20), 0 4px 10px -4px rgb(16 24 32 / 0.08);
  --bz-ombre-4: 0 28px 64px -16px rgb(16 24 32 / 0.30), 0 10px 20px -10px rgb(16 24 32 / 0.12);
}
:root[data-theme="sombre"] {
  color-scheme: dark;
  --bz-surface-elevee: var(--bz-granit-3);
  --bz-sur-marque: var(--bz-granit-1);
  --bz-sur-accent: var(--bz-granit-1);
  --bz-sur-ok: var(--bz-granit-1);
  --bz-sur-attention: var(--bz-granit-1);
  --bz-sur-critique: var(--bz-granit-1);
  --bz-sur-info: var(--bz-granit-1);
  --bz-xp-piste: var(--bz-granit-4);
  --bz-xp-piste-bord: var(--bz-granit-8);
  --bz-voile: rgb(0 0 0 / 0.62);
  --bz-verre-fond: ${verreSombre};
  --bz-verre-bord: ${bordSombre};
  --bz-verre-reflet: inset 0 1px 0 rgb(255 255 255 / 0.07);
  --bz-etiquette-fond: ${etiquetteSombre};
  --bz-ombre-1: 0 1px 2px rgb(0 0 0 / 0.40), inset 0 1px 0 rgb(255 255 255 / 0.04);
  --bz-ombre-2: 0 8px 20px -6px rgb(0 0 0 / 0.55), inset 0 1px 0 rgb(255 255 255 / 0.05);
  --bz-ombre-3: 0 18px 44px -10px rgb(0 0 0 / 0.65), inset 0 1px 0 rgb(255 255 255 / 0.06);
  --bz-ombre-4: 0 30px 70px -16px rgb(0 0 0 / 0.75), inset 0 1px 0 rgb(255 255 255 / 0.07);
}
@supports (color: color-mix(in oklch, red 50%, blue)) {
  :root {
    --bz-verre-fond: color-mix(in oklch, var(--bz-surface) var(--bz-verre-opacite), transparent);
    --bz-verre-bord: color-mix(in oklch, var(--bz-texte) 10%, transparent);
    --bz-etiquette-fond: color-mix(in oklch, var(--bz-surface) 90%, transparent);
  }
  :root[data-theme="sombre"] {
    --bz-verre-fond: color-mix(in oklch, var(--bz-surface) var(--bz-verre-opacite), transparent);
    --bz-verre-bord: color-mix(in oklch, var(--bz-texte) 12%, transparent);
    --bz-etiquette-fond: color-mix(in oklch, var(--bz-surface) 88%, transparent);
  }
}

/* ==========================================================================
   4. TYPOGRAPHIE — Inter 4.1 pour l'interface ; Fraunces pour la voix de titre (affiche, titre 1, salutation,
   noms de quartier, trophées, pages publiques). Jamais Fraunces dans un bouton, un tableau ou un libellé.
   ========================================================================== */
:root {
  --bz-police: "Inter", "Inter repli", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --bz-police-titre: "Fraunces", "Fraunces repli", "Inter", Georgia, serif; /* Inter fournit U+202F si Fraunces ne l'a pas */
  --bz-police-lisible: "Atkinson Hyperlegible Next", "Inter", "Inter repli", system-ui, sans-serif; /* option, chargée à la demande */
  --bz-police-mono: ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, monospace; /* polices système */
  --bz-police-reglages: "cv05" 1, "cv08" 1;  /* l à queue et I à empattements : distingue I, l et 1 (codes, SIRET) */

  /* Échelle (plancher 12 px à la souris, 13 px au toucher ; fluide de 360 à 1 280 px de large ; en rem pour suivre le zoom) */
  --bz-t-micro: 0.75rem;                       /* 12 px : micro-étiquettes, compteurs */
  --bz-t-petit: 0.875rem;                      /* 14 px : texte secondaire, tableaux denses */
  --bz-t-bouton: 0.875rem;                     /* 14 px à la souris, 16 px au toucher : libellé des boutons */
  --bz-t-base: 1rem;                           /* 16 px : texte courant, champs (évite le zoom iOS) */
  --bz-t-moyen: 1.125rem;                      /* 18 px : chapeaux, texte de carte héros */
  --bz-t-titre-4: 1.25rem;                     /* 20 px : titre de carte, de section */
  --bz-t-titre-3: ${fluide(22, 24)};   /* 22 → 24 px : titre de panneau, de feuille */
  --bz-t-titre-2: ${fluide(26, 32)};   /* 26 → 32 px : titre de page */
  --bz-t-titre-1: ${fluide(32, 40)};   /* 32 → 40 px : écran d'entrée, grand chiffre */
  --bz-t-affiche: ${fluide(40, 56)};   /* 40 → 56 px : score héros, page publique */

  /* Interlignes */
  --bz-i-serre: 1.1;      /* affiche, grands chiffres */
  --bz-i-titre: 1.2;
  --bz-i-label: 1.25;     /* une ligne : boutons, onglets, étiquettes alignées sur une icône */
  --bz-i-texte: 1.5;
  --bz-i-long: 1.6;       /* paragraphes d'aide, documents */

  /* Graisses (axe variable : n'utiliser que celles-ci) */
  --bz-g-normal: 400;
  --bz-g-moyen: 500;
  --bz-g-fort: 600;
  --bz-g-display: 650;    /* affiche et titre 1 (Inter et Fraunces) */
  --bz-g-tres-fort: 700;

  /* Approche */
  --bz-l-affiche: -0.022em;
  --bz-l-titre: -0.014em;
  --bz-l-texte: -0.006em;
  --bz-l-micro: 0.01em;
  --bz-l-capitales: 0.06em;  /* micro-étiquettes en capitales via text-transform uniquement */

  --bz-mesure: 66ch;         /* longueur de ligne du texte courant */
}
@media (pointer: coarse) {
  :root { --bz-t-micro: 0.8125rem; --bz-t-bouton: 1rem; }
}

/* ==========================================================================
   5. ESPACE, FORMES, PROFONDEUR
   ========================================================================== */
:root {
  /* Espacement, base 4 px */
  --bz-e-0: 0;
  --bz-e-px: 1px;
  --bz-e-0-5: 0.125rem;  /*  2 px */
  --bz-e-1: 0.25rem;     /*  4 px */
  --bz-e-2: 0.5rem;      /*  8 px */
  --bz-e-3: 0.75rem;     /* 12 px */
  --bz-e-4: 1rem;        /* 16 px */
  --bz-e-5: 1.25rem;     /* 20 px */
  --bz-e-6: 1.5rem;      /* 24 px */
  --bz-e-8: 2rem;        /* 32 px */
  --bz-e-10: 2.5rem;     /* 40 px */
  --bz-e-12: 3rem;       /* 48 px */
  --bz-e-16: 4rem;       /* 64 px */
  --bz-e-20: 5rem;       /* 80 px */
  --bz-e-24: 6rem;       /* 96 px */
  /* Espacement par relation (un seul propriétaire par écart) */
  --bz-e-intra: var(--bz-e-2);     /* dans un groupe (libellé ↔ champ, icône ↔ texte) */
  --bz-e-groupe: var(--bz-e-6);    /* entre groupes d'une même section */
  --bz-e-section: var(--bz-e-10);  /* entre sections */
  --bz-e-entre-cibles: var(--bz-e-1); /* écart minimal entre deux cibles voisines (8 px au toucher) */
  --bz-goutiere: clamp(1rem, 0.6rem + 1.8vw, 2rem); /* 16 px sur téléphone → 32 px */

  /* Rayons : 3 niveaux + pilule. Règle de concentricité : rayon intérieur = rayon extérieur − marge. */
  --bz-r-1: 6px;      /* puces, cases, petits boutons, infobulles, catégorie « fournisseur » */
  --bz-r-2: 10px;     /* boutons, champs, menus, tuiles */
  --bz-r-3: 16px;     /* cartes, panneaux du HUD, dialogues, feuilles */
  --bz-r-pilule: 999px;
  --bz-r-rond: 50%;

  /* Bordures */
  --bz-bord-1: 1px;
  --bz-bord-1-5: 1.5px; /* proposition d'agent (pointillés), case de prospect */
  --bz-bord-2: 2px;   /* indicateur d'état, onglet actif souligné, contour en contraste élevé */

  /* Élévations : surface + ombre + rayon vont ensemble */
  --bz-elev-plat: var(--bz-ombre-0);       /* contenu posé sur le fond */
  --bz-elev-carte: var(--bz-ombre-1);      /* cartes, tuiles */
  --bz-elev-flottant: var(--bz-ombre-2);   /* menus, popovers, HUD, barre d'action */
  --bz-elev-dialogue: var(--bz-ombre-3);   /* dialogues, feuilles, palette ⌘K */
  --bz-elev-toast: var(--bz-ombre-4);      /* toasts, glisser-déposer */

  /* Tailles de contrôles et cibles (souris ; voir le bloc toucher juste après) */
  --bz-cible: 44px;          /* cible visée */
  --bz-cible-min: 24px;      /* plancher WCAG 2.5.8 (souris uniquement) */
  --bz-h-controle-sm: 32px;
  --bz-h-controle: 40px;
  --bz-h-controle-lg: 48px;
  --bz-icone-sm: 16px;
  --bz-icone-md: 20px;
  --bz-icone-lg: 24px;
  --bz-trait-icone: 1.75;
}
/* Toucher : aucune cible sous 44 px, 48 px visés, 8 px entre deux cibles. La densité compacte ne s'applique jamais ici. */
@media (pointer: coarse) {
  :root { --bz-h-controle-sm: 44px; --bz-h-controle: 48px; --bz-h-controle-lg: 56px; --bz-cible: 48px; --bz-cible-min: 44px; --bz-e-entre-cibles: var(--bz-e-2); }
}
/* Densité compacte (listes, tableaux, console) : souris seulement */
@media (pointer: fine) {
  :root[data-densite="compacte"] { --bz-h-controle-sm: 28px; --bz-h-controle: 34px; --bz-h-controle-lg: 40px; }
}

/* ==========================================================================
   6. MOUVEMENT — immobile par défaut ; on anime un changement d'état, jamais pour décorer.
   ========================================================================== */
:root {
  --bz-d-1: 100ms;   /* pression, case, interrupteur */
  --bz-d-2: 160ms;   /* survol, couleur, opacité */
  --bz-d-3: 240ms;   /* menus, popovers, onglets, toasts */
  --bz-d-4: 360ms;   /* feuilles, dialogues, transitions de vue, toit qui s'efface */
  --bz-d-camera: 500ms;        /* vol de caméra 3D, interrompu par tout contact */
  --bz-d-celebration: 1200ms;  /* fin de quête sur la carte */
  --bz-d-ouverture: 1600ms;    /* ouverture du matin (une fois par jour, interrompue par toute action) */
  --bz-d-peinture: 1200ms;     /* « la maquette se peint » : durée totale */
  --bz-d-peinture-ecart: 40ms; /* écart entre deux bâtiments qui se peignent */
  --bz-d-envoi: 10s;           /* délai d'annulation d'un message à un tiers */
  --bz-c-standard: cubic-bezier(0.2, 0, 0, 1);  /* déplacement dans l'écran */
  --bz-c-entree: cubic-bezier(0, 0, 0, 1);      /* apparition (décélère) */
  --bz-c-sortie: cubic-bezier(0.3, 0, 1, 1);    /* disparition (accélère) */
  --bz-c-effet: cubic-bezier(0.25, 0.1, 0.25, 1); /* opacité, couleur : jamais de rebond */
  /* Ressorts physiques (famille « spatiale » : position, échelle). Durée conseillée : --bz-d-4. */
  --bz-ressort-vif: ${ressort(0.65)};   /* dépassement ≈ 7 % */
  --bz-ressort-doux: ${ressort(0.85)};  /* dépassement < 1 % */
  --bz-deplacement: 1;   /* multiplicateur des distances animées : calc(var(--bz-deplacement) * 8px) */
}
/* Sans linear() (Safari < 17.2), une transition qui l'utilise serait invalide : pas d'animation, pas de transitionend */
@supports not (transition-timing-function: linear(0, 1)) {
  :root { --bz-ressort-vif: var(--bz-c-standard); --bz-ressort-doux: var(--bz-c-entree); }
}
@media (prefers-reduced-motion: reduce) {
  :root:not([data-mouvement="normal"]) { --bz-d-3: 120ms; --bz-d-4: 120ms; --bz-d-camera: 0ms; --bz-d-celebration: 0ms; --bz-d-ouverture: 0ms; --bz-d-peinture: 0ms; --bz-d-peinture-ecart: 0ms; --bz-ressort-vif: var(--bz-c-effet); --bz-ressort-doux: var(--bz-c-effet); --bz-deplacement: 0; }
}
:root[data-mouvement="reduit"] { --bz-d-3: 120ms; --bz-d-4: 120ms; --bz-d-camera: 0ms; --bz-d-celebration: 0ms; --bz-d-ouverture: 0ms; --bz-d-peinture: 0ms; --bz-d-peinture-ecart: 0ms; --bz-ressort-vif: var(--bz-c-effet); --bz-ressort-doux: var(--bz-c-effet); --bz-deplacement: 0; }

/* ==========================================================================
   7. COUCHES ET MISE EN PAGE
   Points de rupture (mobile d'abord, en em dans les @media pour suivre le zoom) :
     compact < 37.5em (600 px) · moyen ≥ 37.5em · large ≥ 60em (960 px) · tres-large ≥ 80em (1 280 px) · ultra ≥ 100em (1 600 px)
   Les variables --bz-bp-* ne servent qu'au JS (matchMedia) : CSS ne lit pas de variable dans @media.
   ========================================================================== */
:root {
  --bz-bp-moyen: 37.5em;
  --bz-bp-large: 60em;
  --bz-bp-tres-large: 80em;
  --bz-bp-ultra: 100em;

  --bz-z-base: 0;
  --bz-z-etiquettes: 10;   /* étiquettes DOM de la carte 3D */
  --bz-z-hud: 20;          /* contrôles posés sur la carte */
  --bz-z-collant: 30;      /* en-têtes collants, en-tête d'application */
  --bz-z-navigation: 40;   /* barre d'onglets mobile, rail */
  --bz-z-fiche: 50;        /* panneau latéral non modal */
  --bz-z-barre-action: 55; /* barre d'action contextuelle */
  --bz-z-popover: 60;      /* repli quand [popover] n'existe pas (iOS < 17) */
  --bz-z-dialogue: 70;
  --bz-z-toast: 80;
  --bz-z-infobulle: 90;

  --bz-h-entete: 56px;
  --bz-h-onglets: 64px;
  --bz-l-rail: 248px;
  --bz-l-rail-replie: 72px;
  --bz-l-fiche: 420px;
  --bz-l-hud-aujourdhui: 360px; /* panneau « Aujourd'hui » posé sur la carte (ordinateur) */
  --bz-l-formulaire: 40rem;  /* 640 px */
  --bz-l-contenu: 75rem;     /* 1 200 px */
  --bz-l-dialogue: 35rem;    /* 560 px */
  --bz-l-palette: 40rem;

  --bz-sa-haut: env(safe-area-inset-top, 0px);
  --bz-sa-bas: env(safe-area-inset-bottom, 0px);
  --bz-sa-gauche: env(safe-area-inset-left, 0px);
  --bz-sa-droite: env(safe-area-inset-right, 0px);
  --bz-clavier: 0px;         /* hauteur du clavier virtuel, écrite par theme.js (visualViewport) sur iOS */
  --bz-pied-bas: max(var(--bz-sa-bas), var(--bz-clavier)); /* bas des pieds collants et du champ de la palette */
}
/* Toucher ou écran compact : les cartes ont toujours une bordure visible (plein soleil) */
@media (max-width: 37.49em), (pointer: coarse) {
  :root { --bz-carte-bord: var(--bz-bordure); }
}
/* Téléphone en paysage (support de tableau de bord) */
@media (orientation: landscape) and (max-height: 31.25em) {
  :root { --bz-h-entete: 44px; --bz-h-onglets: 56px; }
}

/* ==========================================================================
   8. SCÈNE 3D — lues par scene.js via getComputedStyle (three.js Color ne lit que hex/rgb : pas d'oklch ici).
   Indépendantes du thème : l'heure de la carte (Réelle par défaut) choisit entre jour et nuit ; aube et crépuscule
   sont interpolés en JS. Sols des quartiers : ${Object.entries(materiaux).map(([k, v]) => `${k} = ${v}`).join(' ; ')}.
   ========================================================================== */
:root {
${sceneBloc('jour')}
  --bz-scene-soleil-bas: #ffd9a8;      /* teinte de la lumière principale à l'aube et au crépuscule */
${sceneBloc('nuit')}
  --bz-scene-peinture-perimee: 0.4;    /* saturation gardée par une donnée de plus de 7 jours */
}

/* ==========================================================================
   9. PRÉFÉRENCES D'ACCESSIBILITÉ ET D'APPARENCE
   ========================================================================== */
/* Verre au toucher : quasi opaque et sans flou par défaut (lisible en plein soleil, moins coûteux sur la carte) */
@media (pointer: coarse) {
  :root:not([data-transparence]) { --bz-verre-opacite: 96%; --bz-verre-flou: 0px; }
}
/* Transparence : Teintée par défaut (86 %), Vitrée (80 %), Opaque (surface pleine, sans flou) */
:root[data-transparence="vitree"] { --bz-verre-opacite: 80%; --bz-verre-flou: 18px; }
:root[data-transparence="opaque"] { --bz-verre-opacite: 100%; --bz-verre-flou: 0px; --bz-verre-fond: var(--bz-surface); --bz-etiquette-fond: var(--bz-surface); }
@media (prefers-reduced-transparency: reduce) {
  :root:not([data-transparence="vitree"]) { --bz-verre-opacite: 100%; --bz-verre-flou: 0px; --bz-verre-fond: var(--bz-surface); --bz-etiquette-fond: var(--bz-surface); }
}
/* Contraste élevé : demandé par le système, ou forcé (Réglages > Apparence, ou « Plein soleil ») */
@media (prefers-contrast: more) {
  :root:not([data-contraste="normal"]) {
    --bz-texte-2: var(--bz-texte);
    --bz-texte-3: var(--bz-granit-11);
    --bz-bordure-decor: var(--bz-bordure-champ);
    --bz-bordure: var(--bz-bordure-champ);
    --bz-carte-bord: var(--bz-bordure-champ);
    --bz-focus-largeur: 3px;
    --bz-verre-opacite: 100%;
    --bz-verre-flou: 0px;
    --bz-verre-fond: var(--bz-surface);
    --bz-etiquette-fond: var(--bz-surface);
  }
}
:root[data-contraste="eleve"] {
  --bz-texte-2: var(--bz-texte);
  --bz-texte-3: var(--bz-granit-11);
  --bz-bordure-decor: var(--bz-bordure-champ);
  --bz-bordure: var(--bz-bordure-champ);
  --bz-carte-bord: var(--bz-bordure-champ);
  --bz-focus-largeur: 3px;
  --bz-verre-opacite: 100%;
  --bz-verre-flou: 0px;
  --bz-verre-fond: var(--bz-surface);
  --bz-etiquette-fond: var(--bz-surface);
}
/* Texte plus grand : tout est en rem, il suffit de changer la taille racine (testé à 150 % sur 360 px) */
:root[data-texte="grand"] { font-size: 125%; }
:root[data-texte="tres-grand"] { font-size: 150%; }
/* Police haute lisibilité */
:root[data-police="lisible"] { --bz-police: var(--bz-police-lisible); }

} /* fin @layer bz.jetons */
`;

writeFileSync(sortie, css);

// ---- Version minifiée (servie) + manifeste ----
const min = css
  .replace(/\/\*![\s\S]*?\*\//, `/*! Breizhcosystem tokens.css v${VERSION} */`)
  .replace(/\/\*(?!!)[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')
  .replace(/\s*([{};,>])\s*/g, '$1')
  .replace(/:\s+/g, ':')
  .replace(/;}/g, '}')
  .replace(/\*\/\s*/, '*/\n')
  .trim() + '\n';
if (!existsSync(distDir)) mkdirSync(distDir, { recursive: true });
writeFileSync(distDir + 'tokens.min.css', min);
const poids = (s) => { const b = Buffer.from(s); return { octets: b.length, gzip: gzipSync(b, { level: 9 }).length, brotli: brotliCompressSync(b, { params: { [Z.BROTLI_PARAM_QUALITY]: 11 } }).length, sha256: createHash('sha256').update(b).digest('hex') }; };
const manifeste = { version: VERSION, genere: 'design/outils/generer-jetons.mjs', fichiers: { 'tokens.css': poids(css), 'tokens.min.css': poids(min) } };
writeFileSync(distDir + 'MANIFESTE.json', JSON.stringify(manifeste, null, 2) + '\n');

// ---- Rapport de contraste (Markdown) ----
const v = (n) => n.toFixed(2).replace('.', ',');
const f1 = (n) => n.toFixed(1).replace('.', ',');
const seuil = (s) => String(s).replace('.', ',');
const lignes = [];
const cle = (c) => `${c[1]}|${c[2]}`;
const idxS = new Map(controles.sombre.map((c) => [cle(c), c]));
// On publie une sélection lisible : les paires principales de chaque groupe (le générateur vérifie toutes les autres).
const principales = [
  'texte|surface', 'texte|fond', 'texte-2|surface', 'texte-2|composant-survol', 'texte-2|composant-presse', 'texte-3|surface', 'texte-3|fond', 'texte-3|composant-survol', 'texte-3|composant-presse',
  'bordure-champ|surface', 'bordure-champ|fond', 'bordure-champ|composant', 'bordure-champ-survol|surface', 'etat-indicateur (marque)|fond-2', 'etat-indicateur (marque)|marque-doux', 'etat-indicateur (marque)|composant', 'focus|surface', 'focus|fond', 'xp-remplissage (ajonc-9)|xp-piste', 'xp-piste-bord|surface',
  'marque-texte (lien)|surface', 'marque-texte (lien)|fond-2', 'marque-texte (lien)|selection (iroise-3)', 'texte|selection (iroise-3)', 'sur-marque|marque', 'sur-marque|marque-survol',
  'ok-texte|ok-fond', 'attention-texte|attention-fond', 'critique-texte|critique-fond', 'info-texte|info-fond', 'ok-texte|surface', 'attention-texte|surface', 'critique-texte|surface', 'info-texte|surface',
  'sur-ok (badge à nombre)|ok-plein', 'sur-attention (badge à nombre)|attention-plein', 'sur-critique (badge à nombre)|critique-plein', 'sur-info (badge à nombre)|info-plein',
  'ok-trait|surface', 'attention-trait|surface', 'critique-trait|surface', 'info-trait|surface',
  'sur-inverse|surface-inverse', 'inverse-lien|surface-inverse', 'inverse-focus|surface-inverse',
  'sur-accent|ajonc-9', 'accent-texte (ajonc-11)|surface',
  'dv-1|surface', 'dv-2|surface', 'dv-3|surface', 'dv-4|surface', 'dv-5|surface', 'dv-6|surface', 'dv-autre|surface', 'dv-6|composant-survol', 'dv-neutre (granit-8)|surface',
];
const idxC = new Map(controles.clair.map((c) => [cle(c), c]));
lignes.push('| Groupe | Paire (avant-plan / fond) | Seuil | Clair | Sombre |', '|---|---|---|---|---|');
for (const k of principales) {
  const c = idxC.get(k), s = idxS.get(k);
  if (!c) throw new Error('paire inconnue ' + k);
  lignes.push(`| ${c[0]} | ${c[1]} / ${c[2]} | ${seuil(c[3])}:1 | ${v(c[4])} | ${s ? v(s[4]) : '—'} |`);
}
for (const c of controles.clair.filter((c) => c[0] === 'Scène 3D')) {
  const s = controles.sombre.find((x) => x[0] === 'Scène 3D' && x[1] === c[1]);
  lignes.push(`| Scène 3D | ${c[1]} / pire cas (clair : ${c[2].replace('pire cas : ', '')} ; sombre : ${s[2].replace('pire cas : ', '')}) | ${seuil(c[3])}:1 | ${v(c[4])} | ${v(s[4])} |`);
}
const totalC = controles.clair.length + controles.sombre.length + controlesScene.length;
lignes.push('', `**${totalC} paires vérifiées** par le générateur (toutes les combinaisons texte × fond, bordure × fond, statut × fond, donnée × fond, sur les fonds \`fond\`, \`fond-2\`, \`surface\`, \`surface-elevee\`, \`composant\` et \`composant-survol\`), **0 échec**. Le tableau en publie une sélection.`);
lignes.push('', '**Scène 3D** (sans thème : encre des noms de quartier écrits au sol, sur chaque sol et sur leur halo de 3 px)', '', '| Paire | Seuil | Rapport |', '|---|---|---|');
for (const [a, b, s, r] of controlesScene) lignes.push(`| ${a} / ${b} | ${seuil(s)}:1 | ${v(r)} |`);
lignes.push('', `Verre et étiquettes : pire cas calculé sans flou, sur les ${Object.keys(fondsScene).length} couleurs de la scène qui peuvent se trouver derrière (jour et nuit, quel que soit le thème de l'interface). \`--bz-texte-3\` et le texte désactivé sont interdits sur le verre : ils y descendent sous 4,5:1.`);
lignes.push('', `Rampe séquentielle \`--bz-dv-seq-1…5\` sur \`--bz-surface\` : clair ${sequentiel.clair.map(v).join(' · ')} ; sombre ${sequentiel.sombre.map(v).join(' · ')}. Les trois premiers paliers sont sous 3:1 : une case colorée affiche toujours sa valeur (ou la vue Tableau), la couleur n'est jamais seule porteuse de l'information (1.4.1, 1.4.11).`);
lignes.push('', `Distance minimale entre les 6 couleurs de données (ΔE OKLab, ×100) — vision normale : clair ${f1(cvd.clair.normal.min7 * 100)}, sombre ${f1(cvd.sombre.normal.min7 * 100)} ; protanopie : ${f1(cvd.clair.protan.min7 * 100)} / ${f1(cvd.sombre.protan.min7 * 100)} ; deutéranopie : ${f1(cvd.clair.deutan.min7 * 100)} / ${f1(cvd.sombre.deutan.min7 * 100)} ; tritanopie : ${f1(cvd.clair.tritan.min7 * 100)} / ${f1(cvd.sombre.tritan.min7 * 100)} (simulation Machado 2009, sévérité 100 %).`);
lignes.push('', `Sols des quartiers (ΔE OKLab ×100, paire la plus proche) : jour ${f1(distQuartiers.jour.min * 100)} (${distQuartiers.jour.pair}), nuit ${f1(distQuartiers.nuit.min * 100)} (${distQuartiers.nuit.pair}) ; seuil 4,0, deux fois l'écart juste perceptible. En deutéranopie l'écart tombe à ${f1(distQuartiers.jour.deutan * 100)} / ${f1(distQuartiers.nuit.deutan * 100)} : c'est le motif du matériau qui distingue alors les quartiers.`);
lignes.push('', `Monotonie de la luminosité : ${monotonie.every((m) => m[2]) ? 'granit, iroise et ajonc vont dans un seul sens dans les deux thèmes' : 'ÉCHEC ' + monotonie.filter((m) => !m[2]).map((m) => m.slice(0, 2).join(' ')).join(', ')} (palier 0 exclu ; ajonc-9 et 10 exclus en clair).`);
lignes.push('', 'P3 : ' + (p3fails.length ? 'ÉCHECS ' + p3fails.join(', ') : 'tous les aplats renforcés gardent leurs seuils.'));
lignes.push('', `Poids de \`tokens.css\` : ${f1(manifeste.fichiers['tokens.css'].octets / 1024)} Ko brut ; version servie \`dist/tokens.min.css\` : ${f1(manifeste.fichiers['tokens.min.css'].octets / 1024)} Ko brut, ${f1(manifeste.fichiers['tokens.min.css'].gzip / 1024)} Ko en gzip, ${f1(manifeste.fichiers['tokens.min.css'].brotli / 1024)} Ko en brotli.`);
lignes.push('', '| Primitive | Clair (OKLCH → sRGB) | Sombre (OKLCH → sRGB) |', '|---|---|---|');
const mc = Object.fromEntries(VC), ms = Object.fromEntries(VS);
for (const [nom] of VC) lignes.push(`| \`--bz-${nom}\` | \`${fmt(mapToSrgb(mc[nom]))}\` ${hex(mc[nom])} | ${ms[nom] ? `\`${fmt(mapToSrgb(ms[nom]))}\` ${hex(ms[nom])}` : '—'} |`);
const rapport = lignes.join('\n') + '\n';
writeFileSync(rapportOut, rapport);

// ---- Injection dans le document de design (le §3.2 et le §3.4 restent identiques aux fichiers générés) ----
if (docPath && existsSync(docPath)) {
  let doc = readFileSync(docPath, 'utf8');
  const remplacer = (nom, contenu) => {
    const re = new RegExp(`(<!-- debut:${nom} -->\\n)[\\s\\S]*?(\\n<!-- fin:${nom} -->)`);
    if (!re.test(doc)) { console.warn(`marqueur ${nom} absent du document`); return; }
    doc = doc.replace(re, (_, a, b) => a + contenu + b);
  };
  remplacer('tokens.css', '```css\n' + css.trimEnd() + '\n```');
  remplacer('rapport-contrastes', rapport.trimEnd());
  writeFileSync(docPath, doc);
}

if (fails.length || p3fails.length) { console.error('Contrastes insuffisants :\n' + [...fails, ...p3fails].join('\n')); process.exit(1); }
console.log('ok', css.length, 'octets ;', totalC, 'paires vérifiées, toutes passent ; min', manifeste.fichiers['tokens.min.css']);
