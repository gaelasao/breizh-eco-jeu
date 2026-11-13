/**
 * Carte 3D (direction de design §5, §6.1 P3) : modules purs de web/carte/ (gestes, heure, étiquettes, catégories,
 * qualité), parité des jetons de la scène, liste blanche des fichiers servis et règles imposées à scene.js.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fichiersStatiques } from '../passerelle/statiques.ts';

const RACINE = new URL('../../', import.meta.url);
const lire = (f: string) => readFileSync(new URL(f, RACINE), 'utf8');
const charger = async <T>(f: string) => (await import(new URL(f, RACINE).href)) as T;

type Gestes = { GESTES: Record<'souris' | 'tactile' | 'clavier', readonly string[]>; libelleCanvas: (o?: { tactile?: boolean }) => string };
type Heure = {
  ROLES_SCENE: readonly string[]; etatHeure: (d: Date, o?: { reglage?: string; themeSombre?: boolean }) => { nom: string; nuit: number; soleilBas: number };
  lirePalette: (lire: (n: string) => string) => { jour: Record<string, string | null>; nuit: Record<string, string | null>; soleilBas: string | null; peinturePerimee: number };
  melanger: (a: string, b: string, t: number) => string; lumieres: (p: unknown, e: unknown) => { soleil: string; soleilIntensite: number; fenetresAllumees: boolean };
};
type Candidat = { id: string; x: number; y: number; l: number; h: number; priorite: number; rang?: number; quartier?: string | null; horsEcran?: boolean };
type Etiquettes = {
  PRIORITE: Record<string, number>; MAX_ETIQUETTES: { ordinateur: number; telephone: number }; HYSTERESIS_MS: number;
  placerEtiquettes: (c: Candidat[], o?: Record<string, unknown>) => { visibles: Set<string>; etat: Map<string, unknown> };
  boite: (c: Candidat, o?: { tactile?: boolean }) => { x0: number; x1: number; y0: number; y1: number }; chevauche: (a: unknown, b: unknown) => boolean;
  regrouperParQuartier: (c: Candidat[]) => { gardes: Candidat[]; groupes: { quartier: string; nombre: number }[] };
  ordreClavier: (l: Candidat[]) => Candidat[]; voisin: (o: Candidat[], id: string | null, s: number) => Candidat | null;
};
type Categories = { FORMES: Record<string, string>; categorieDe: (o: unknown) => { categorie: string; forme: string; icone: string }; peintureDe: (o: unknown) => string; quartierDe: (o: unknown) => string | null };
type Qualite = {
  qualiteInitiale: (o: Record<string, unknown>) => string; profil: (q: string, o?: { telephone?: boolean }) => { ombres: number; densiteMax: number; gtao: boolean; materiauPbr: boolean; accessoires: boolean };
  palierInferieur: (q: string) => string; surveillance: (o: { budgetMs: number; debut: number }) => { noter: (ms: number, t: number) => boolean }; reseauFaible: (c: unknown) => boolean;
  BUDGETS: Record<string, { appels: number; triangles: number; ombres: number; densite: number }>; CADENCE: { ambiance: number; ambianceApresMs: number; pauseApresMs: number };
  VIE: { pleine: number; immobile: number }; vieAmbiante: (d: number, o?: { pleine?: number; immobile?: number }) => number;
};
type Lots = {
  NOMS_COUCHES: readonly string[]; COUCHES_CUITES: readonly string[]; MASQUE: Record<string, number>; NB_MASQUES: number; masqueCalque: (n: string) => number;
  orientationMur: (nx: number, nz: number) => number; mursBaisses: (v: [number, number], ferme?: boolean) => number[]; echelleMur: (b: number, h: number) => number; ALLEGE: number;
  details: (o: { distance: number; maxDistance: number; economie?: boolean; employes?: boolean; entreprise?: boolean }) => { personnes: boolean; mobilier: boolean; accessoires: boolean };
  estMobilier: (p: { cx: number; cz: number; haut: number }, e: { l: number; p: number }) => boolean;
  ATLAS_ENSEIGNES: { largeur: number; hauteur: number; enseigneL: number; enseigneH: number; parPage: number };
  placeEnseigne: (n: number) => { page: number; x0: number; y0: number }; uvEnseigne: (u: number, v: number, p: { x0: number; y0: number }) => [number, number];
  rvb: (h: string) => number[];
};

test('carte : la constante GESTES sert à l’aria-label du canvas (souris, toucher, clavier)', async () => {
  const { GESTES, libelleCanvas } = await charger<Gestes>('web/carte/gestes.js');
  assert.ok(Object.isFrozen(GESTES) && Object.isFrozen(GESTES.clavier));
  assert.deepEqual(Object.keys(GESTES), ['souris', 'tactile', 'clavier']);
  assert.ok(GESTES.clavier.includes('Flèches : passer d’un lieu à l’autre'));
  assert.ok(GESTES.tactile.some((g) => g.startsWith('Toucher deux fois et glisser')));
  const l = libelleCanvas();
  for (const g of GESTES.clavier) assert.ok(l.includes(g), g);
  assert.match(l, /Liste des lieux/, 'le canvas renvoie à la liste équivalente');
  assert.ok(libelleCanvas({ tactile: true }).includes(GESTES.tactile[0] as string));
  for (const g of [...GESTES.souris, ...GESTES.tactile, ...GESTES.clavier]) assert.doesNotMatch(g, /\(s\)|'/, `typographie : ${g}`);
});

test('carte : heure réelle indépendante du thème, quatre états, interpolation jour → nuit', async () => {
  const { etatHeure, melanger } = await charger<Heure>('web/carte/heure.js');
  const a = (h: number, m = 0) => new Date(2026, 10, 10, h, m);
  assert.equal(etatHeure(a(10)).nom, 'jour');
  assert.equal(etatHeure(a(10)).nuit, 0);
  assert.equal(etatHeure(a(23)).nuit, 1);
  assert.equal(etatHeure(a(3)).nom, 'nuit');
  assert.equal(etatHeure(a(7)).nom, 'aube');
  assert.equal(etatHeure(a(19)).nom, 'crepuscule');
  assert.ok(etatHeure(a(7)).nuit > 0 && etatHeure(a(7)).nuit < 1);
  assert.ok(etatHeure(a(19)).soleilBas > 0.9, 'teinte chaude au milieu du crépuscule');
  assert.ok(etatHeure(a(6, 30)).nuit > etatHeure(a(7, 30)).nuit, 'l’aube éclaircit');
  // le thème sombre ne met plus la nuit à 10 h (§5.3)
  assert.equal(etatHeure(a(10), { reglage: 'reelle', themeSombre: true }).nuit, 0);
  assert.equal(etatHeure(a(23), { reglage: 'jour' }).nuit, 0);
  assert.equal(etatHeure(a(10), { reglage: 'theme', themeSombre: true }).nuit, 1);
  assert.equal(etatHeure(a(23), { reglage: 'theme', themeSombre: false }).nuit, 0);
  assert.equal(melanger('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(melanger('#7fb6d3', '#08131f', 0), '#7fb6d3');
  assert.equal(melanger('#7fb6d3', '#08131f', 1), '#08131f');
});

test('carte : chaque couleur de la scène est un jeton --bz-scene-jour-* et --bz-scene-nuit-* de tokens.css (parité)', async () => {
  const { ROLES_SCENE, lirePalette, lumieres, etatHeure } = await charger<Heure>('web/carte/heure.js');
  const jetons = lire('web/bz/tokens.css');
  assert.equal(jetons, lire('design/tokens.css'), 'tokens.css identique à design/');
  const valeur = (n: string) => new RegExp(`${n.replace(/-/g, '\\-')}:\\s*([^;]+);`).exec(jetons)?.[1]?.trim() ?? '';
  const p = lirePalette(valeur);
  for (const r of ROLES_SCENE) {
    assert.match(p.jour[r] ?? '', /^#[0-9a-f]{6}$/, `--bz-scene-jour-${r}`);
    assert.match(p.nuit[r] ?? '', /^#[0-9a-f]{6}$/, `--bz-scene-nuit-${r}`);
  }
  assert.match(p.soleilBas ?? '', /^#[0-9a-f]{6}$/);
  assert.equal(p.peinturePerimee, 0.4);
  // tous les jetons de scène de tokens.css sont lus (aucun oublié, aucun en trop)
  const declares = new Set([...jetons.matchAll(/--bz-scene-(jour|nuit)-([a-z-]+):/g)].map((m) => m[2]));
  assert.deepEqual([...declares].sort(), [...ROLES_SCENE].sort());
  const jour = lumieres(p, etatHeure(new Date(2026, 10, 10, 12)));
  const nuit = lumieres(p, etatHeure(new Date(2026, 10, 10, 23)));
  assert.equal(jour.soleil, p.jour.soleil);
  assert.equal(nuit.soleil, p.nuit.soleil);
  assert.ok(jour.soleilIntensite > nuit.soleilIntensite);
  assert.equal(nuit.fenetresAllumees, true);
  // scene.js lit les jetons (getComputedStyle) : aucune couleur de décor du §5.2 codée en dur
  const scene = lire('web/scene.js');
  for (const hex of ['0xdce6ee', '0x4f97b8', '0x9fbf7a', '0xb9a888', '0xc8352b']) assert.ok(!scene.includes(hex), `couleur de décor codée en dur : ${hex}`);
  assert.match(scene, /lirePalette\(lireJeton\)/);
});

test('carte : étiquettes placées par priorité, sans chevauchement, focus jamais masqué, 40 au plus (24 sur téléphone)', async () => {
  const { PRIORITE, MAX_ETIQUETTES, placerEtiquettes, boite, chevauche, HYSTERESIS_MS } = await charger<Etiquettes>('web/carte/etiquettes.js');
  assert.deepEqual(Object.entries(PRIORITE).sort((a, b) => a[1] - b[1]).map(([k]) => k), ['focus', 'critique', 'selection', 'alerte', 'principal', 'entite', 'secondaire']);
  assert.deepEqual(MAX_ETIQUETTES, { ordinateur: 40, telephone: 24 });
  const c = (id: string, x: number, y: number, priorite: number): Candidat => ({ id, x, y, l: 100, h: 28, priorite });
  // trois étiquettes au même endroit : seule la plus prioritaire reste ; le focus clavier passe devant l'alerte critique
  const memes = [c('entite', 200, 200, PRIORITE.entite as number), c('critique', 200, 200, PRIORITE.critique as number), c('focus', 205, 202, PRIORITE.focus as number)];
  assert.deepEqual([...placerEtiquettes(memes, { largeur: 800, hauteur: 600 }).visibles], ['focus']);
  // aucune paire de boîtes visibles ne se chevauche
  const nuage: Candidat[] = Array.from({ length: 120 }, (_, i) => c(`e${i}`, (i * 37) % 780, 30 + ((i * 53) % 560), i % 7));
  const { visibles } = placerEtiquettes(nuage, { largeur: 800, hauteur: 600 });
  const places = nuage.filter((x) => visibles.has(x.id)).map((x) => boite(x));
  for (let i = 0; i < places.length; i++) for (let j = i + 1; j < places.length; j++) assert.ok(!chevauche(places[i], places[j]), `chevauchement ${i} / ${j}`);
  assert.ok(visibles.size <= 40);
  const serre: Candidat[] = Array.from({ length: 200 }, (_, i) => ({ id: `t${i}`, x: 20 + (i % 20) * 60, y: 40 + Math.floor(i / 20) * 70, l: 40, h: 28, priorite: 5 }));
  assert.ok(placerEtiquettes(serre, { largeur: 1400, hauteur: 800, max: MAX_ETIQUETTES.telephone }).visibles.size <= 24);
  // au toucher, la collision se calcule sur la zone de toucher de 44 px
  const proches = [c('a', 100, 100, 5), { ...c('b', 100, 138, 5) }];
  assert.equal(placerEtiquettes(proches, { largeur: 800, hauteur: 600 }).visibles.size, 2, 'à la souris, 28 px de haut : elles tiennent');
  assert.equal(placerEtiquettes(proches, { largeur: 800, hauteur: 600, tactile: true }).visibles.size, 1, 'au toucher, 44 px : une seule');
  // hors de l'écran ou sous le HUD : jamais placée
  assert.equal(placerEtiquettes([{ ...c('x', 100, 100, 1), horsEcran: true }], { largeur: 800, hauteur: 600 }).visibles.size, 0);
  // hystérésis de 200 ms : une étiquette masquée ne revient qu'après 200 ms libre
  const t0 = placerEtiquettes([c('haut', 100, 100, 1), c('bas', 100, 100, 5)], { largeur: 800, hauteur: 600, maintenant: 0 });
  assert.ok(!t0.visibles.has('bas'));
  const t1 = placerEtiquettes([c('bas', 100, 100, 5)], { largeur: 800, hauteur: 600, maintenant: 50, etat: t0.etat });
  assert.ok(!t1.visibles.has('bas'), 'pas tout de suite : pas de clignotement');
  const t2 = placerEtiquettes([c('bas', 100, 100, 5)], { largeur: 800, hauteur: 600, maintenant: 50 + HYSTERESIS_MS, etat: t1.etat });
  assert.ok(t2.visibles.has('bas'), 'après 200 ms libre');
});

test('carte : vue large regroupée par quartier (« Clients +12 »), parcours au clavier par priorité', async () => {
  const { regrouperParQuartier, ordreClavier, voisin, PRIORITE } = await charger<Etiquettes>('web/carte/etiquettes.js');
  const l: Candidat[] = [
    ...Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, x: 0, y: 0, l: 10, h: 10, priorite: PRIORITE.entite as number, quartier: 'clients' })),
    { id: 'alerte', x: 0, y: 0, l: 10, h: 10, priorite: PRIORITE.alerte as number, quartier: 'clients' },
    { id: 'siege', x: 0, y: 0, l: 10, h: 10, priorite: PRIORITE.principal as number, quartier: null },
    { id: 'seul', x: 0, y: 0, l: 10, h: 10, priorite: PRIORITE.entite as number, quartier: 'prospects' },
  ];
  const { gardes, groupes } = regrouperParQuartier(l);
  assert.deepEqual(groupes.map((g) => [g.quartier, g.nombre]), [['clients', 12]]);
  assert.deepEqual(gardes.map((g) => g.id).sort(), ['alerte', 'seul', 'siege'], 'les alertes et les lieux restent seuls');
  const ordre = ordreClavier([{ id: 'b', x: 0, y: 0, l: 0, h: 0, priorite: 5 }, { id: 'a', x: 0, y: 0, l: 0, h: 0, priorite: 1 }, { id: 'a', x: 0, y: 0, l: 0, h: 0, priorite: 1 }]);
  assert.deepEqual(ordre.map((x) => x.id), ['a', 'b']);
  assert.equal(voisin(ordre, null, 1)?.id, 'a');
  assert.equal(voisin(ordre, 'a', 1)?.id, 'b');
  assert.equal(voisin(ordre, 'b', 1)?.id, 'a', 'en boucle');
  assert.equal(voisin(ordre, 'a', -1)?.id, 'b');
});

test('carte : catégories par la forme (§4.12), plâtre sans donnée réelle, périmé à plus de 7 jours (§4.29)', async () => {
  const { FORMES, categorieDe, peintureDe, quartierDe } = await charger<Categories>('web/carte/categories.js');
  assert.deepEqual(FORMES, { client: 'rond', fournisseur: 'carre', partenaire: 'losange', equipe: 'hexagone', prospect: 'rond-pointille', lieu: 'goutte', autre: 'carre-pointille' });
  const t = (roles: string[], type = 'entreprise') => ({ famille: 'tiers', type, roles: roles.map((id) => ({ id })) });
  assert.equal(categorieDe(t(['client'])).forme, 'rond');
  assert.equal(categorieDe(t(['fournisseur'])).forme, 'carre');
  assert.equal(categorieDe(t(['partenaire'])).forme, 'losange');
  assert.equal(categorieDe(t(['prospect'])).forme, 'rond-pointille');
  assert.equal(categorieDe({ famille: 'personne' }).forme, 'hexagone');
  assert.equal(categorieDe({ famille: 'lieu', icone: 'entrepot' }).icone, 'warehouse');
  assert.equal(categorieDe({ famille: 'tache', type: 'tache' }).icone, 'list-checks', 'une tâche a son icône, pas un point d’interrogation');
  assert.equal(categorieDe({ id: '__pavillon' }).forme, 'goutte');
  assert.equal(categorieDe({ famille: 'ressource', icone: 'vehicule' }).forme, 'carre-pointille');
  assert.equal(quartierDe(t(['client', 'fournisseur'])), 'nord');
  assert.equal(quartierDe(t(['fournisseur'])), 'fournisseurs');
  assert.equal(quartierDe(t(['prospect'])), 'prospects');
  assert.equal(peintureDe({ mode: 'demo', fraicheur: 'perimee' }), 'exemple', 'les données d’exemple sont peintes');
  assert.equal(peintureDe({ mode: 'reel', provenance: 'confirme', fraicheur: 'fraiche' }), 'peint');
  assert.equal(peintureDe({ mode: 'reel', provenance: 'declare', fraicheur: 'perimee' }), 'perime');
  assert.equal(peintureDe({ mode: 'reel', provenance: 'inconnu', fraicheur: 'fraiche' }), 'platre');
  assert.equal(peintureDe({ mode: 'reel', provenance: 'confirme', fraicheur: 'inconnue' }), 'platre', 'inconnu ne vaut jamais une donnée');
  // les formes sont dessinées par le système de design, sans couleur par catégorie
  const css = lire('web/bz/composants.css');
  for (const f of Object.values(FORMES)) assert.ok(f === 'rond' || css.includes(`.bz-cat--${f}`), `.bz-cat--${f}`);
  assert.doesNotMatch(css, /\.bz-cat--[a-z-]+ \{[^}]*--bz-dv-/, 'aucune couleur de données sur une catégorie');
});

test('carte : qualité automatique, budgets du §5.10, palier inférieur après 3 s à plus de 40 ms, réseau faible', async () => {
  const { qualiteInitiale, profil, palierInferieur, surveillance, reseauFaible, BUDGETS, CADENCE } = await charger<Qualite>('web/carte/qualite.js');
  assert.equal(qualiteInitiale({ telephone: true, memoire: 2 }), 'economie');
  assert.equal(qualiteInitiale({ telephone: true, memoire: 6 }), 'standard');
  assert.equal(qualiteInitiale({ telephone: false, memoire: 16, coeurs: 12 }), 'haute');
  assert.equal(qualiteInitiale({ telephone: false, coeurs: 2 }), 'economie');
  assert.equal(qualiteInitiale({ reglage: 'standard', telephone: false, memoire: 32, coeurs: 32 }), 'standard', 'Réglages › Carte l’emporte');
  assert.deepEqual([BUDGETS.ordinateur?.appels, BUDGETS.telephone?.appels, BUDGETS.economie?.appels], [150, 100, 60]);
  assert.deepEqual([BUDGETS.ordinateur?.triangles, BUDGETS.telephone?.triangles, BUDGETS.economie?.triangles], [300000, 120000, 60000]);
  assert.equal(profil('haute').gtao, true);
  assert.equal(profil('haute', { telephone: true }).gtao, false, 'GTAO jamais sur téléphone');
  assert.equal(profil('standard').gtao, false);
  assert.equal(profil('haute').ombres, 2048);
  assert.equal(profil('standard', { telephone: true }).ombres, 1024);
  assert.equal(profil('economie').ombres, 0);
  assert.deepEqual([profil('haute').densiteMax, profil('standard', { telephone: true }).densiteMax, profil('economie').densiteMax], [2, 1.5, 1]);
  assert.equal(profil('standard').materiauPbr, false, 'Lambert en Standard et Économie');
  assert.equal(profil('economie').accessoires, false);
  assert.deepEqual([palierInferieur('haute'), palierInferieur('standard'), palierInferieur('economie')], ['standard', 'economie', 'economie']);
  const v = surveillance({ budgetMs: 16, debut: 0 });
  let descendu = false;
  for (let t = 0; t <= 2000; t += 16) descendu = v.noter(8, t) || descendu;
  assert.equal(descendu, false, 'rapide au démarrage : on garde');
  for (let t = 2016; t < 4900; t += 50) descendu = v.noter(45, t) || descendu;
  assert.equal(descendu, false, 'moins de 3 s au-delà de 40 ms : on garde');
  for (let t = 4900; t < 5400; t += 50) descendu = v.noter(45, t) || descendu;
  assert.equal(descendu, true, '3 s au-delà de 40 ms : un palier plus bas');
  assert.equal(reseauFaible({ saveData: true }), true);
  assert.equal(reseauFaible({ effectiveType: '3g' }), true);
  assert.equal(reseauFaible({ effectiveType: '4g' }), false);
  assert.equal(reseauFaible(undefined), false, 'iOS n’a pas navigator.connection');
  assert.deepEqual(CADENCE, { ambiance: 20, ambianceApresMs: 30000, pauseApresMs: 120000 });
});

test('carte : la vie ambiante se calme avec l’éloignement, jusqu’à l’image fixe en vue d’ensemble (§5.8)', async () => {
  const { VIE, vieAmbiante } = await charger<Qualite>('web/carte/qualite.js');
  assert.ok(VIE.pleine < VIE.immobile);
  assert.equal(vieAmbiante(6), 1, 'de près : pleine vie');
  assert.equal(vieAmbiante(VIE.pleine), 1);
  assert.equal(vieAmbiante(VIE.immobile), 0, 'vue d’ensemble : carte immobile');
  assert.equal(vieAmbiante(360), 0, 'dézoom complet : plus rien ne bouge');
  assert.equal(vieAmbiante(Number.NaN), 1, 'distance inconnue : on n’éteint rien par accident');
  // décroissance continue et monotone : aucune marche, rien ne s'arrête d'un coup
  let avant = 1;
  for (let d = VIE.pleine; d <= VIE.immobile; d += 2) {
    const v = vieAmbiante(d);
    assert.ok(v >= 0 && v <= 1 && v <= avant + 1e-12, `vie décroissante à ${d}`);
    assert.ok(avant - v < 0.09, `pas de marche à ${d}`);
    avant = v;
  }
  assert.ok(vieAmbiante((VIE.pleine + VIE.immobile) / 2) > 0.3, 'à mi-chemin, la vie est encore perceptible');
  // la scène ralentit tout avec ce facteur et ne redemande plus d'image quand il est nul
  const scene = lire('web/scene.js');
  assert.match(scene, /vieAmbiante\(controles\.distance\)/);
  assert.match(scene, /if \(vie > 0\) animer\(dt, vie\)/);
  assert.match(scene, /else if \(ambiance && vie > 0\)/, 'vie éteinte : aucune image de plus n’est demandée');
});

test('carte : scene.js pilote camera-controls 3.1.2, rend à la demande, sans MapControls ni boucle permanente', () => {
  const scene = lire('web/scene.js');
  assert.match(scene, /import CameraControls from '\/vendor\/camera-controls@3\.1\.2\.js'/);
  assert.doesNotMatch(scene, /MapControls|RoomEnvironment|mapSize\.set\(mobile \? 2048 : 4096/, 'MapControls, environnement PBR et ombres 4 096 retirés');
  assert.doesNotMatch(scene, /function boucle\(\) \{\s*raf = requestAnimationFrame\(boucle\)/, 'plus de boucle de rendu permanente');
  assert.match(scene, /visibilitychange/);
  assert.match(scene, /IntersectionObserver/);
  assert.match(scene, /PROFIL\.gtao/, 'EffectComposer et GTAO en qualité Haute seulement');
  assert.match(scene, /import\('\/vendor\/addons\/postprocessing\/GTAOPass\.js'\)/, 'post-traitement chargé à la demande');
  assert.match(scene, /NeutralToneMapping/);
  assert.match(scene, /MeshToonMaterial/);
  assert.match(scene, /'image\/webp', 0\.7/, 'image instantanée en WebP 0,7');
  assert.doesNotMatch(scene, /puce-3d (lieu|tiers|quartier|alerte|nexus)/, 'plus les 12 styles d’étiquettes');
  assert.doesNotMatch(scene, /toUpperCase\(\)/, 'aucune capitale d’affichage');
  const pkg = JSON.parse(lire('package.json')) as { dependencies: Record<string, string> };
  assert.equal(pkg.dependencies['camera-controls'], '3.1.2', 'version exacte épinglée');
  const style = lire('web/style.css');
  assert.doesNotMatch(style, /\.puce-3d/, 'anciennes étiquettes retirées du CSS');
});

test('carte : modules de web/carte/ servis par la liste blanche (jamais un chemin construit depuis l’URL)', () => {
  const s = fichiersStatiques();
  for (const c of ['/carte/gestes.js', '/carte/heure.js', '/carte/etiquettes.js', '/carte/categories.js', '/carte/qualite.js', '/carte/lots.js', '/carte/atlas.js', '/vendor/camera-controls@3.1.2.js', '/scene.js']) {
    assert.ok(s.get(c), `${c} servi`);
    assert.equal(s.get(c)?.type, 'text/javascript; charset=utf-8');
  }
  for (const c of ['/carte/../package.json', '/carte/', '/carte/gestes.ts', '/carte/%2e%2e/scene.js', '/CARTE/gestes.js']) assert.equal(s.get(c), undefined, c);
  assert.ok(s.chemins().filter((c) => c.startsWith('/carte/')).every((c) => /^\/carte\/[a-z-]+\.js$/.test(c)));
});

test('carte : lots de rendu, masques des calques et niveaux de détail (§5.10)', async () => {
  const { NOMS_COUCHES, COUCHES_CUITES, MASQUE, NB_MASQUES, masqueCalque, details, estMobilier, rvb } = await charger<Lots>('web/carte/lots.js');
  // chaque calque a son masque (1 + rang), distinct des masques de détail, et tout tient dans l'uniforme
  const masques = [...NOMS_COUCHES.map(masqueCalque), ...Object.values(MASQUE)];
  assert.equal(new Set(masques).size, masques.length, 'aucun masque partagé');
  assert.ok(masques.every((m) => Number.isInteger(m) && m >= 0 && m < NB_MASQUES));
  assert.equal(MASQUE.toujours, 0, 'un sommet sans attribut (passe de normales de l’occlusion) reste visible');
  assert.ok(COUCHES_CUITES.every((c) => NOMS_COUCHES.includes(c)));
  for (const anime of ['alertes', 'trafic', 'flux']) assert.ok(!COUCHES_CUITES.includes(anime), `${anime} bouge : jamais cuit`);
  // de loin : ni silhouettes ni mobilier ; de près : oui, sauf calque masqué ; jamais en Économie
  assert.deepEqual(details({ distance: 255, maxDistance: 360 }), { personnes: false, mobilier: false, accessoires: false });
  assert.deepEqual(details({ distance: 60, maxDistance: 360 }), { personnes: true, mobilier: true, accessoires: true });
  assert.equal(details({ distance: 60, maxDistance: 360, employes: false }).personnes, false);
  assert.equal(details({ distance: 60, maxDistance: 360, entreprise: false }).mobilier, false);
  assert.deepEqual(details({ distance: 20, maxDistance: 360, economie: true }), { personnes: false, mobilier: false, accessoires: false }, 'coupe sans mobilier, pastilles');
  // mobilier : ce qui dépasse du sol dans l'emprise ; le sol, le quai devant le bâtiment restent
  const emprise = { l: 26, p: 16 };
  assert.equal(estMobilier({ cx: 2, cz: -3, haut: 1.1 }, emprise), true);
  assert.equal(estMobilier({ cx: 0, cz: 0, haut: 0.18 }, emprise), false, 'dalle et sol');
  assert.equal(estMobilier({ cx: 0, cz: 9.6, haut: 1.2 }, emprise), false, 'quai hors emprise');
  assert.deepEqual(rvb('#ff8000'), [1, 128 / 255, 0]);
});

test('carte : murs de la maison de poupée, abaissés par orientation face à la caméra', async () => {
  const { orientationMur, mursBaisses, echelleMur, ALLEGE } = await charger<Lots>('web/carte/lots.js');
  assert.deepEqual([orientationMur(1, 0), orientationMur(-1, 1e-16), orientationMur(0, 1), orientationMur(1e-16, -1)], [1, 2, 3, 4]);
  // caméra au sud-est (vers +x, +z) : murs x+ et z+ abaissés
  const d = Math.SQRT1_2;
  assert.deepEqual(mursBaisses([d, d]), [0, 1, 0, 1, 0]);
  assert.deepEqual(mursBaisses([d, d], true), [0, 0, 0, 0, 0], 'toits affichés ou vue de dessus : tout debout');
  assert.deepEqual(mursBaisses([0, -1]), [0, 0, 0, 0, 1]);
  assert.equal(echelleMur(0, 3.4), 1);
  assert.ok(Math.abs(echelleMur(1, 3.4) * 3.4 - ALLEGE) < 1e-9, 'abaissé à hauteur d’allège');
});

test('carte : atlas des enseignes, une page partagée (un seul appel de dessin)', async () => {
  const { ATLAS_ENSEIGNES: A, placeEnseigne, uvEnseigne } = await charger<Lots>('web/carte/lots.js');
  const places = Array.from({ length: A.parPage * 2 }, (_, n) => placeEnseigne(n));
  assert.deepEqual(places[0], { page: 0, x0: 0, y0: 0 });
  assert.deepEqual(places[1], { page: 0, x0: A.enseigneL, y0: 0 });
  assert.equal(places[A.parPage]?.page, 1, 'page suivante au-delà de la première');
  for (const p of places) {
    assert.ok(p.x0 + A.enseigneL <= A.largeur && p.y0 + A.enseigneH <= A.hauteur, 'dans la page');
    const [u0, v0] = uvEnseigne(0, 0, p);
    const [u1, v1] = uvEnseigne(1, 1, p);
    assert.ok(u0 >= 0 && u1 <= 1 && v0 >= 0 && v1 <= 1 && u1 > u0 && v1 > v0);
  }
  const deux = new Set(places.filter((p) => p.page === 0).map((p) => `${p.x0},${p.y0}`));
  assert.equal(deux.size, A.parPage, 'aucune enseigne sur une autre');
});

test('carte : scene.js cuit le décor et les calques en lots, sans corrompre les géométries partagées', () => {
  const scene = lire('web/scene.js');
  assert.match(scene, /from '\/carte\/lots\.js'/);
  assert.match(scene, /function cuireLots\(/);
  assert.match(scene, /CALQUE_ORIGINES/, 'maillages d’origine gardés pour le pointage, jamais dessinés');
  assert.match(scene, /raycaster\.layers\.enable\(CALQUE_ORIGINES\)/);
  assert.match(scene, /customDepthMaterial = matOmbreLot/, 'ombres : murs abaissés et calques masqués');
  assert.match(scene, /adapterNormalesGtao\(gtao\.normalMaterial\)/, 'occlusion : mêmes murs et masques');
  // régression : la fusion modifiait l'attribut partagé du cache (arbres, lampadaires et marquages hors de la carte)
  assert.match(scene, /copie\.setAttribute\(n, g\.attributes\[n\]\.clone\(\)\)/);
  assert.doesNotMatch(scene, /copie\.setAttribute\(n, g\.attributes\[n\]\);/);
  // un atlas KayKit par pack, une page d'enseignes : plus une texture par modèle ou par enseigne
  assert.match(scene, /partagerAtlas\(atlas, `\$\{pack\}\/\$\{image\}`, t\)/);
  assert.doesNotMatch(scene, /new THREE\.CanvasTexture\(c\);\s*t\.colorSpace = THREE\.SRGBColorSpace;\s*const me = new THREE\.Mesh\(new THREE\.PlaneGeometry\(largeur/);
});

test('carte : l’atlas partagé des modèles n’est jamais fermé (immeubles noirs en qualité Haute, puis après un changement de qualité)', async () => {
  type Atlas = {
    COTE_ATLAS_REDUIT: number;
    partagerAtlas: (a: Map<string, unknown>, cle: string, t: unknown) => { texture: unknown; premiere: boolean };
    reduireImage: (image: unknown, creer: () => unknown, cote?: number) => { width: number; height: number } | null;
  };
  const A = await charger<Atlas>('web/carte/atlas.js');
  // THREE.Cache rend la même image à tous les modèles d'un pack : chaque texture pointe sur elle
  let fermetures = 0;
  const image = { width: 1024, height: 1024, close: () => { fermetures++; } };
  const texture = () => ({ source: { data: image }, image, liberee: 0, dispose() { this.liberee++; } });
  const atlas = new Map<string, unknown>();
  const [t1, t2, t3] = [texture(), texture(), texture()];
  const a1 = A.partagerAtlas(atlas, 'ville/citybits_texture.png', t1);
  assert.deepEqual([a1.texture === t1, a1.premiere], [true, true], 'la première texture du pack devient la texture commune');
  const a2 = A.partagerAtlas(atlas, 'ville/citybits_texture.png', t2);
  const a3 = A.partagerAtlas(atlas, 'ville/citybits_texture.png', t3);
  assert.deepEqual([a2.texture === t1, a2.premiere, a3.texture === t1], [true, false, true], 'les suivantes reçoivent la texture commune');
  assert.deepEqual([t1.liberee, t2.liberee, t3.liberee], [0, 1, 1], 'seuls les doublons sont libérés');
  assert.equal(A.partagerAtlas(atlas, 'ville/citybits_texture.png', t1).texture, t1);
  assert.equal(t1.liberee, 0, 'la texture commune n’est jamais libérée par son propre modèle');
  // un autre pack a son propre atlas
  const m1 = texture();
  assert.equal(A.partagerAtlas(atlas, 'mobilier/furniturebits_texture.png', m1).premiere, true);
  assert.equal(atlas.size, 2);
  // réduction hors qualité Haute : une copie de 512 px, l'image d'origine reste lisible pour la scène suivante
  const dessins: unknown[][] = [];
  const canevas = () => ({ width: 0, height: 0, getContext: () => ({ drawImage: (...a: unknown[]) => { dessins.push(a); } }) });
  const reduit = A.reduireImage(image, canevas);
  assert.deepEqual([reduit?.width, reduit?.height], [A.COTE_ATLAS_REDUIT, 512]);
  assert.deepEqual(dessins[0], [image, 0, 0, 512, 512]);
  assert.deepEqual([A.reduireImage({ width: 2048, height: 1024 }, canevas)?.height, A.reduireImage({ width: 512, height: 512 }, canevas), A.reduireImage(null, canevas)], [256, null, null]);
  assert.equal(fermetures, 0, 'l’image partagée (ImageBitmap gardé par THREE.Cache) n’est jamais fermée');
  // scene.js passe par ce module et ne ferme plus aucune image de texture
  const scene = lire('web/scene.js');
  assert.match(scene, /import \{ partagerAtlas, reduireImage \} from '\/carte\/atlas\.js'/);
  assert.match(scene, /THREE\.Cache\.enabled = true/);
  assert.doesNotMatch(scene, /\.close\?\.\(\)|\.close\(\)/, 'aucune image fermée dans scene.js');
});
