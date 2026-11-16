/**
 * Le moteur qui lit la photo d'un justificatif : ce qui est servi, d'où, et quand.
 *
 * Quatre promesses tenues ici, et vérifiables sans lancer de navigateur :
 * - **la photo ne quitte pas l'appareil** : la lecture est dans le navigateur, et aucune adresse de tiers n'apparaît
 *   nulle part — les trois chemins (fil de travail, cœur WebAssembly, modèle français) sont imposés et servis par
 *   Living Business ;
 * - **chargé à la demande** : rien du moteur n'est dans le premier chargement ; web/app.js ne le demande qu'à la
 *   première photo, par un import différé ;
 * - **hors ligne** : le service worker garde ce qui a été téléchargé, sous un chemin qui porte sa version ;
 * - **si ça ne se charge pas, rien ne casse** : l'écran revient à trois champs à remplir à la main.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CACHE_IMMUABLE, fichiersStatiques, LECTURE_BASE, LECTURE_FICHIERS, LECTURE_MODELE, LECTURE_VERSION, LECTURE_VERSIONS } from '../passerelle/statiques.ts';

const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const lire = (f: string) => readFileSync(RACINE + f, 'utf8');
const M = (await import(new URL('../../web/lecture-moteur.js', import.meta.url).href)) as {
  BASE: string; LANGUE: string; COTE_MAX: number; COTE_MIN: number;
  COEURS: { vectoriel: string; simple: string };
  ECHEC_MOTEUR: string; ECHEC_IMAGE: string;
  ETAPES: { moteur: string; modele: string; lecture: string };
  moteurPossible: (f?: unknown) => boolean;
  coeurPour: (f?: unknown) => string;
  tailleDeLecture: (l: number, h: number, o?: { coteMax?: number; coteMin?: number }) => { largeur: number; hauteur: number; echelle: number };
  seuillerSurPlace: (d: Uint8ClampedArray, l: number, h: number, o?: { part?: number }) => Uint8ClampedArray;
  grisSurPlace: (d: Uint8ClampedArray) => Uint8ClampedArray;
  lignesDuResultat: (d: unknown) => { lignes: Array<{ texte: string; confiance: number }> };
  lirePhoto: (f: unknown, o?: Record<string, unknown>) => Promise<{ echec?: string; lu?: unknown }>;
};

test('servi par Living Business, et par personne d’autre : moteur, cœur et modèle, à une version précise', () => {
  const s = fichiersStatiques();
  assert.equal(LECTURE_BASE, `/lecture/${LECTURE_VERSION}/`);
  for (const f of LECTURE_FICHIERS) {
    const servi = s.get(`${LECTURE_BASE}${f.nom}`);
    assert.ok(servi, `${f.nom} servi`);
    assert.equal(servi.type, f.type, `${f.nom} : type annoncé`);
    assert.equal(servi.cache, CACHE_IMMUABLE, 'version dans le chemin : cache immuable');
  }
  const modele = s.get(`${LECTURE_BASE}${LECTURE_MODELE}`);
  assert.ok(modele, 'modèle français servi');
  assert.equal(modele.type, 'application/gzip');
  assert.ok(modele.contenu.length > 400_000 && modele.contenu.length < 900_000, `modèle d’un poids plausible (${modele.contenu.length})`);
  assert.deepEqual([modele.contenu[0], modele.contenu[1]], [0x1f, 0x8b], 'le modèle est bien compressé (le moteur le décompresse)');
  // les deux cœurs sont là, mais UN SEUL sera téléchargé : celui que le processeur de l'appareil sait lire
  for (const nom of Object.values(M.COEURS)) assert.ok(LECTURE_FICHIERS.some((f) => f.nom === nom), `${nom} servi`);
  for (const nom of Object.values(M.COEURS)) assert.ok(s.get(`${LECTURE_BASE}${nom.replace(/\.js$/, '.wasm')}`), `${nom} : son WebAssembly à côté, dans le même dossier`);
  // rien d'autre sous /lecture/ : aucun chemin construit depuis l'URL
  for (const c of [`${LECTURE_BASE}../package.json`, '/lecture/', '/lecture/7.0.0/', '/lecture/9.9.9/worker.min.js', '/lecture/fra.traineddata.gz']) {
    assert.equal(s.get(c), undefined, `${c} refusé`);
  }
});

test('le moteur va chercher ses fichiers au même endroit que la passerelle les sert', () => {
  assert.equal(M.BASE, LECTURE_BASE, 'la même adresse des deux côtés');
  assert.equal(M.LANGUE, 'fra', 'le français seul : on ne charge pas d’autre modèle');
  const code = lire('web/lecture-moteur.js');
  // aucune adresse vers l'extérieur : ni réseau de diffusion, ni service de lecture, ni mesure d'audience
  assert.doesNotMatch(code, /https?:\/\//, 'aucune adresse de tiers dans le chargeur');
  // les trois chemins sont imposés : laissés libres, tesseract.js irait les chercher sur un réseau de diffusion tiers
  for (const option of ['workerPath:', 'corePath:', 'langPath:']) assert.ok(code.includes(option), `${option} imposé`);
  assert.match(code, /workerBlobURL: false/, 'adresse en clair : le cache du navigateur et le service worker savent la retenir');
  assert.match(code, /cachePath: base/, 'le modèle gardé par le navigateur porte la version : un modèle remplacé est bien rechargé');
  // le modèle demandé est bien celui qui est servi
  assert.ok(lire('src/passerelle/statiques.ts').includes(`'${LECTURE_MODELE}'`));
});

test('chargé à la demande : rien du moteur dans le premier chargement', () => {
  const app = lire('web/app.js');
  // web/app.js n'importe le lecteur que par un import différé, dans la fonction qui ouvre les trois champs
  assert.doesNotMatch(app, /^import .*lecture-moteur\.js/m, 'jamais un import en tête de fichier');
  assert.match(app, /LECTEUR \?\?= import\('\/lecture-moteur\.js'\)\.catch\(\(\) => null\)/, 'import différé, et un échec ne casse rien');
  assert.match(app, /if \(fichier\) lireLaPhotoPrise\(\);/, 'la lecture part quand une photo vient d’être prise');
  // l'accueil précharge ses modules à lui, jamais ceux de la lecture
  const accueil = lire('web/index.html');
  const preleves = [...accueil.matchAll(/<link[^>]*rel="(?:modulepreload|preload|prefetch)"[^>]*>/g)].map((m) => m[0] as string);
  assert.ok(preleves.length >= 10, 'l’accueil précharge bien ses propres modules');
  for (const balise of preleves) assert.doesNotMatch(balise, /lecture|tesseract/, `préchargé à tort : ${balise}`);
  assert.doesNotMatch(accueil, /lecture-moteur|lecture-photo|tesseract|\/lecture\//, 'rien de la lecture dans la page d’accueil');
  // le service worker ne va rien chercher d'avance non plus : il garde ce qui a été demandé, et rien de plus
  assert.doesNotMatch(lire('web/sw.js'), /addAll\([^)]*lecture/, 'le service worker ne télécharge pas le moteur d’avance');
  // le moteur lui-même n'arrive qu'à la première lecture, pas au chargement du module
  const moteur = lire('web/lecture-moteur.js');
  assert.match(moteur, /const T = await import\(`\$\{base\}tesseract\.esm\.min\.js`\)/, 'le moteur est demandé dans chargerMoteur, pas avant');
});

test('hors ligne : le service worker garde le moteur et le modèle, sous un chemin qui porte sa version', () => {
  const sw = lire('web/sw.js');
  assert.match(sw, /\^\\\/lecture\\\/\\d\+\\\.\\d\+\\\.\\d\+\\\//, 'les chemins versionnés de la lecture sont reconnus');
  assert.match(sw, /CACHE_LECTURE/, 'un cache à eux');
  assert.match(sw, /GARDES = new Set\(\[CACHE, CACHE_CARTE, CACHE_LECTURE/, 'jamais effacé au changement de version du service worker');
  // les deux modules qui pilotent la lecture sont gardés eux aussi : sans eux, le moteur téléchargé ne servirait à rien
  assert.match(sw, /url\.pathname === '\/lecture-moteur\.js' \|\| url\.pathname === '\/lecture-photo\.js'/, 'les modules de la lecture survivent à la coupure');
  // et toujours rien de l'API ni des données de l'entreprise
  assert.match(sw, /url\.pathname\.startsWith\('\/api\/'\)/);
});

test('la politique de sécurité autorise le WebAssembly du moteur, et rien de plus', () => {
  const http = lire('src/passerelle/http.ts');
  const csp = /'content-security-policy':\s*\n?\s*"([^"]+)"/.exec(http)?.[1] ?? '';
  assert.ok(csp, 'politique trouvée');
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/, 'le moteur compile du WebAssembly servi par la passerelle');
  assert.doesNotMatch(csp, /'unsafe-eval'[^-]/, 'jamais eval() tout court');
  assert.doesNotMatch(csp, /'unsafe-inline'/, 'jamais de script ni de style en ligne');
  assert.match(csp, /img-src 'self' data: blob:/, 'la photo qu’on vient de prendre est montrée depuis la mémoire');
  assert.match(csp, /connect-src 'self'/, 'rien ne peut partir vers un tiers');
  assert.match(csp, /default-src 'self'/, 'le fil de travail de la lecture vient d’ici');
});

test('préparer l’image : mise à la taille de lecture, et seuil calculé localement', () => {
  // un ticket photographié de près fait trois fois la taille utile ; une capture minuscule est agrandie
  assert.equal(M.tailleDeLecture(3024, 4032).hauteur, M.COTE_MAX);
  assert.equal(M.tailleDeLecture(3024, 4032).largeur, Math.round(3024 * (M.COTE_MAX / 4032)), 'le rapport est gardé');
  assert.equal(M.tailleDeLecture(1400, 900).echelle, 1, 'une taille déjà bonne n’est pas touchée');
  assert.ok(M.tailleDeLecture(400, 300).echelle > 1, 'une image minuscule est agrandie');
  assert.equal(M.tailleDeLecture(300, 200).echelle, 2, 'mais jamais plus que le double');
  assert.deepEqual(M.tailleDeLecture(0, 0), { largeur: 0, hauteur: 0, echelle: 1 }, 'une image vide ne jette pas');

  // un coin sombre et un coin clair : un seuil unique perdrait la moitié du texte, un seuil local garde les deux
  const [l, h] = [60, 20];
  const d = new Uint8ClampedArray(l * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < l; x++) {
      const fond = 240 - Math.round((x / l) * 200); // dégradé franc, du blanc au gris foncé
      const lettre = x % 7 === 3 ? 60 : 0; // des traits d'encre, toujours plus sombres que leur fond
      const p = (y * l + x) * 4;
      d[p] = d[p + 1] = d[p + 2] = Math.max(0, fond - lettre);
      d[p + 3] = 255;
    }
  }
  M.seuillerSurPlace(d, l, h);
  const noirs = [];
  for (let x = 0; x < l; x++) if (d[(10 * l + x) * 4] === 0) noirs.push(x);
  assert.ok(noirs.length >= 6, `les traits sont retrouvés des deux côtés du dégradé (${noirs.length})`);
  assert.ok(noirs.some((x) => x < l / 3) && noirs.some((x) => x > (2 * l) / 3), 'y compris dans le coin sombre');
  for (let p = 0; p < d.length; p += 4) assert.ok(d[p] === 0 || d[p] === 255, 'tout est noir ou blanc');
});

test('les lignes lues gardent la confiance de chacune : c’est elle qui permet de laisser un champ vide', () => {
  const lues = M.lignesDuResultat({ blocks: [{ paragraphs: [{ lines: [{ text: 'BRICO KERLANN ', confidence: 93 }, { text: '  ', confidence: 4 }, { text: 'TOTAL TTC 26,35', confidence: 88 }] }] }] });
  assert.deepEqual(lues.lignes, [{ texte: 'BRICO KERLANN', confiance: 93 }, { texte: 'TOTAL TTC 26,35', confiance: 88 }]);
  // un moteur qui ne détaille pas : le texte entier, avec la confiance d'ensemble
  const repli = M.lignesDuResultat({ text: 'a\nb', confidence: 71 });
  assert.deepEqual(repli.lignes, [{ texte: 'a', confiance: 71 }, { texte: 'b', confiance: 71 }]);
  assert.deepEqual(M.lignesDuResultat(null).lignes, [{ texte: '', confiance: 100 }], 'rien reçu : rien à lire, et aucune exception');
});

test('si le moteur ne peut pas tourner, l’écran revient à trois champs à la main — et le dit sans jargon', async () => {
  // navigateur trop ancien (pas de WebAssembly, pas de fil de travail) : refusé tout de suite, sans rien télécharger
  assert.equal(M.moteurPossible({}), false);
  assert.equal(M.moteurPossible({ WebAssembly: {}, Worker: () => undefined }), false, 'il faut aussi décoder l’image hors écran');
  assert.equal(M.moteurPossible(null), false);
  const r = await M.lirePhoto({}, { fenetre: {} });
  assert.equal(r.echec, M.ECHEC_MOTEUR);
  for (const t of [M.ECHEC_MOTEUR, M.ECHEC_IMAGE, ...Object.values(M.ETAPES)]) {
    assert.doesNotMatch(t, /OCR|tesseract|WASM|WebAssembly|worker|cache/i, `sans jargon : ${t}`);
  }
  assert.match(M.ECHEC_MOTEUR, /saisissez les trois champs à la main/);
  assert.match(M.ETAPES.moteur, /une seule fois/, 'le long chargement est annoncé comme n’arrivant qu’une fois');
  // le cœur choisi existe bien dans ce qui est servi, quel que soit le processeur
  assert.equal(M.coeurPour({ WebAssembly: { validate: () => true } }), M.COEURS.vectoriel);
  assert.equal(M.coeurPour({ WebAssembly: { validate: () => false } }), M.COEURS.simple);
  assert.equal(M.coeurPour({}), M.COEURS.simple, 'navigateur sans WebAssembly : le filet de sécurité');
});

test('les versions servies sont celles qui sont installées, et épinglées exactement', () => {
  const pkg = JSON.parse(lire('package.json')) as { dependencies: Record<string, string> };
  assert.equal(pkg.dependencies['tesseract.js'], LECTURE_VERSIONS['tesseract.js'], 'même version dans package.json et dans ce qui est servi');
  for (const [paquet, version] of Object.entries(LECTURE_VERSIONS)) {
    const installe = (JSON.parse(lire(`node_modules/${paquet}/package.json`)) as { version: string }).version;
    assert.equal(installe, version, `${paquet} : la version installée est celle qu’on sert`);
  }
  assert.ok(LECTURE_VERSION === LECTURE_VERSIONS['tesseract.js'], 'le chemin porte la version du moteur');
});
