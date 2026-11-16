/**
 * Les trois échelles de la carte (direction de design §5.7) : la ville, la Bretagne, la France.
 * Modules purs de web/carte/ : echelles.js (bandes de distance, fondus, regroupements), geographie.js (décodage des
 * tracés, projection, résolution d'un point depuis une fiche) et les deux fichiers fabriqués contours.js et
 * communes.js. On vérifie aussi ce que la scène a le droit de faire avec, et le poids ajouté au paquet.
 */
import assert from 'node:assert/strict';
import { statSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fichiersStatiques } from '../passerelle/statiques.ts';

const RACINE = new URL('../../', import.meta.url);
const lire = (f: string) => readFileSync(new URL(f, RACINE), 'utf8');
const charger = async <T>(f: string) => (await import(new URL(f, RACINE).href)) as T;

type Anneau = { trou: boolean; lon: Float64Array; lat: Float64Array };
type Entite = { code: string; nom: string; anneaux: Anneau[] };
type Geographie = {
  UNITES_PAR_KM: number; KM_PAR_DEGRE: number;
  entiers: (s: string) => number[];
  decoderContours: (lignes: readonly string[], grille?: number) => Entite[];
  decoderCodesPostaux: (s: string, grille?: number) => Map<string, { lon: number; lat: number }>;
  projection: (o?: { lon0?: number; lat0?: number; unitesParKm?: number }) => { lon0: number; lat0: number; x: (l: number) => number; z: (l: number) => number; lon: (x: number) => number; lat: (z: number) => number };
  codePostalDe: (v: unknown) => string | null;
  departementDuCode: (cp: string | null) => string | null;
  pointDe: (champs: { code_postal?: unknown; adresse?: unknown }, table: Map<string, { lon: number; lat: number }>) => { cp: string; lon: number; lat: number } | null;
  dansEntite: (anneaux: readonly Anneau[], lon: number, lat: number) => boolean;
  boiteDe: (anneaux: readonly Anneau[]) => { lonMin: number; lonMax: number; latMin: number; latMax: number };
  ancreDe: (anneaux: readonly Anneau[]) => { lon: number; lat: number };
};
type Repere = { id: string; role: string; cp: string; departement: string; region: string; lon: number; lat: number; nom?: string | null };
type Groupe = { cle: string; niveau: string; nombre: number; roles: [string, number][]; ids: string[]; lon: number; lat: number; nom: string };
type Distances = { min: number; ville: number; carteDes: number; carteSeule: number; communesDes: number; communesJusqua: number; departementsDes: number; departementsJusqua: number; regionsDes: number; max: number };
type Echelles = {
  DISTANCES: Distances; TROU: { clair: number; plein: number }; POLAIRE: { ville: number; carte: number };
  lisse: (a: number, b: number, x: number) => number;
  echelle: (d: number) => string;
  nomEchelle: (nom: string, region?: string | null) => string;
  carte: (d: number) => { opacite: number; clair: number; plein: number };
  villeVisible: (d: number) => boolean;
  opaciteTraces: (d: number) => { departements: number; regions: number };
  polaireMax: (d: number) => number;
  etendueVue: (d: number) => number;
  bornes: (d: number, o: { plateau: { x0: number; x1: number; z0: number; z1: number }; emprise?: { x0: number; x1: number; z0: number; z1: number } | null; aspect?: number; retour?: boolean }) => { x0: number; x1: number; z0: number; z1: number };
  regrouper: (points: readonly Repere[], niveau: string, ancres?: Map<string, { lon: number; lat: number; nom?: string }>) => Groupe[];
  compte: (role: string, n: number, libelles?: Record<string, [string, string]>) => string;
  detailGroupe: (g: Groupe, libelles?: Record<string, [string, string]>, o?: { max?: number; reste?: boolean }) => string;
  phraseGroupe: (g: Groupe, libelles?: Record<string, [string, string]>) => string;
  manque: (o: { total?: number; places?: number; horsMetropole?: number }) => { texte: string; detail: string; absents: number; horsMetropole: number } | null;
  volVers: (niveau: string) => number;
};
type Contours = { GRILLE: number; REGIONS: readonly string[]; DEPARTEMENTS: readonly string[]; REGION_DU_DEPARTEMENT: Record<string, string> };
type Communes = { CODES_POSTAUX: string };

const LIBELLES = { client: ['client', 'clients'], fournisseur: ['fournisseur', 'fournisseurs'], chantier: ['chantier', 'chantiers'] } as Record<string, [string, string]>;

test('échelles : une seule course de caméra, des fondus sans marche et sans saut', async () => {
  const E = await charger<Echelles>('web/carte/echelles.js');
  const D = E.DISTANCES;
  // les bandes se suivent et se chevauchent : à aucun moment il n'y a de trou entre deux échelles
  // la carte du pays commence juste après l'ancien bout du monde : le cadrage d'ouverture reste une ville, pas une carte
  assert.ok(D.ville <= D.carteDes, 'la carte ne se dessine jamais dans la ville');
  assert.ok(D.carteDes - D.ville < 60, 'et elle apparaît tout de suite après : pas de palier mort entre les deux');
  assert.equal(E.echelle(D.ville), 'ville', 'au cadrage d’ouverture, on est dans sa ville');
  assert.ok(D.ville < D.carteSeule && D.carteSeule < D.departementsDes, 'la ville est recouverte avant qu’on groupe par département');
  assert.ok(D.communesDes < D.departementsDes && D.departementsDes < D.communesJusqua, 'communes et départements se chevauchent');
  assert.ok(D.regionsDes < D.departementsJusqua && D.departementsJusqua < D.max, 'départements et régions se chevauchent');
  // lisse : 0 avant, 1 après, et jamais de marche au milieu
  assert.equal(E.lisse(10, 20, 5), 0);
  assert.equal(E.lisse(10, 20, 25), 1);
  assert.equal(E.lisse(10, 20, 15), 0.5);
  assert.equal(E.lisse(10, 10, 10), 1, 'bornes égales : pas de division par zéro');
  for (let x = 10; x <= 20; x += 0.5) {
    const d = E.lisse(10, 20, x + 0.01) - E.lisse(10, 20, x);
    assert.ok(d >= 0 && d < 0.02, `fondu monotone et sans saut en ${x}`);
  }
  // l'échelle regardée suit la distance, sans trou ni recouvrement
  assert.equal(E.echelle(D.min), 'ville');
  assert.equal(E.echelle(D.carteDes - 1), 'ville');
  assert.equal(E.echelle(D.carteDes), 'communes');
  assert.equal(E.echelle(D.departementsDes), 'departements');
  assert.equal(E.echelle(D.max), 'regions');
  assert.match(E.nomEchelle('departements', 'Bretagne'), /Bretagne/);
  assert.equal(E.nomEchelle('regions'), 'La France');
  assert.equal(E.nomEchelle('ville'), 'Ma ville');
});

test('échelles : la carte se referme sur la ville par un anneau, jamais par un voile translucide', async () => {
  const E = await charger<Echelles>('web/carte/echelles.js');
  const D = E.DISTANCES;
  assert.equal(E.carte(D.carteDes - 1).opacite, 0, 'dans la ville, pas un pixel de carte');
  assert.equal(E.carte(D.carteDes + 200).opacite, 1, 'la carte est pleine bien avant d’avoir recouvert la ville');
  // le trou laissé à la ville couvre d'abord tout le plateau (demi-diagonale : 119 unités), puis se resserre à zéro
  assert.ok(E.carte(D.carteDes + 130).clair >= 119, 'au départ, le plateau entier est dans le clair du trou');
  assert.ok(E.carte(D.carteDes + 130).plein > E.carte(D.carteDes + 130).clair, 'un bord doux, pas une arête');
  let avant = Infinity;
  for (let d = D.carteDes + 130; d <= D.carteSeule; d += 20) {
    const t = E.carte(d);
    assert.ok(t.plein <= avant + 1e-9, `l’anneau ne fait que se resserrer (${d})`);
    avant = t.plein;
  }
  assert.ok(E.carte(D.carteSeule).plein < 0.001, 'à la fin, plus de trou : la carte recouvre tout');
  // et c'est seulement là que la ville cesse d'être calculée
  assert.equal(E.villeVisible(D.carteSeule - 1), true);
  assert.equal(E.villeVisible(D.carteSeule), false);
  // tracés : les départements d'abord, les régions ensuite, les deux se relaient sans trou
  assert.equal(E.opaciteTraces(D.min).departements, 0);
  assert.ok(E.opaciteTraces(D.communesDes).departements > 0.99);
  assert.ok(E.opaciteTraces(D.max).regions > 0.99);
  assert.ok(E.opaciteTraces(D.regionsDes).departements + E.opaciteTraces(D.regionsDes).regions > 0.9, 'jamais une carte sans aucun tracé');
});

test('échelles : on se redresse au-dessus de la carte, et la caméra se recentre sur ce qu’elle ne peut plus dépasser', async () => {
  const E = await charger<Echelles>('web/carte/echelles.js');
  const D = E.DISTANCES;
  assert.equal(E.polaireMax(D.min), E.POLAIRE.ville, 'dans la ville, on garde le point de vue d’avant');
  assert.equal(E.polaireMax(D.ville), E.POLAIRE.ville);
  assert.equal(E.polaireMax(D.max), E.POLAIRE.carte);
  assert.ok(E.polaireMax(700) < E.POLAIRE.ville && E.polaireMax(700) > E.POLAIRE.carte, 'et entre les deux, ça glisse');
  const plateau = { x0: -96, x1: 96, z0: -70, z1: 72 };
  const emprise = { x0: -1400, x1: 1400, z0: -1400, z1: 1400 };
  assert.deepEqual(E.bornes(D.ville, { plateau, emprise }), plateau, 'dans la ville, le plateau, comme avant');
  const large = E.bornes(1200, { plateau, emprise });
  assert.ok(large.x0 < plateau.x0 && large.x1 > plateau.x1, 'au dézoom, on peut se promener sur le pays');
  assert.ok(large.x0 > emprise.x0, 'mais pas au-delà de ce qu’on voit déjà : la vue reste pleine de carte');
  // tant qu'on voit sa ville, elle reste atteignable : dézoomer n'arrache jamais de chez soi
  const prochePlateau = { x0: 1200, x1: 1300, z0: 1200, z1: 1300 }; // une ville hors de ce que la boîte serrée garde
  const encoreLa = E.bornes(D.carteSeule - 1, { plateau: prochePlateau, emprise });
  assert.ok(encoreLa.x0 <= prochePlateau.x0 && encoreLa.x1 >= prochePlateau.x1, 'sa ville reste dans les bornes');
  // écran plus large que la France : il ne reste qu'un point, et la caméra se pose dessus — une carte de France
  // montre la France, pas le coin où l'on habite. On rentre chez soi en rezoomant, ou d'un clic sur sa commune.
  const tout = E.bornes(D.max, { plateau, emprise });
  assert.ok(tout.x1 - tout.x0 <= 1e-9 && tout.z1 - tout.z0 <= 1e-9, 'au dézoom complet, la caméra se recentre d’elle-même');
  assert.equal(tout.x0, (emprise.x0 + emprise.x1) / 2, 'et ce point est le centre du pays, pas sa ville');
  // et le chemin du retour reste ouvert : en rezoomant, les bornes rouvrent sur sa ville avant qu'elle reparaisse
  const retour = E.bornes(D.carteSeule, { plateau, emprise });
  assert.ok(retour.x0 <= plateau.x0 && retour.x1 >= plateau.x1, 'en rezoomant, on retrouve le chemin de chez soi');
  // en plein vol, le plateau reste dans les bornes à toute échelle : un retour vers sa ville part de la France entière
  // sans être rogné en route (les bornes rabotent la visée pendant le vol, pas seulement à l'arrivée)
  const enVol = E.bornes(D.max, { plateau, emprise, retour: true });
  assert.ok(enVol.x0 <= plateau.x0 && enVol.x1 >= plateau.x1, 'un vol de retour n’est jamais arraché de sa destination');
  assert.ok(enVol.z0 <= plateau.z0 && enVol.z1 >= plateau.z1);
  // un clic descend d'un cran, jamais de deux
  assert.ok(E.volVers('regions') > E.volVers('departements'));
  assert.ok(E.volVers('departements') > E.volVers('communes'));
  assert.equal(E.echelle(E.volVers('regions')), 'departements', 'une région mène à ses départements');
  assert.equal(E.echelle(E.volVers('departements')), 'communes', 'un département mène à ses communes');
  assert.equal(E.carte(E.volVers('communes')).opacite, 1, 'et une commune ne dépose jamais sur une carte encore absente');
});

test('échelles : on groupe plutôt que d’écrire trois cents étiquettes, et on dit « 12 clients dans le Morbihan »', async () => {
  const E = await charger<Echelles>('web/carte/echelles.js');
  const r = (id: string, role: string, cp: string, dep: string, region: string, nom?: string): Repere =>
    ({ id, role, cp, departement: dep, region, lon: -3 + Number(cp.slice(3)) / 100, lat: 47.8, ...(nom ? { nom } : {}) });
  const points = [
    r('a', 'client', '56100', '56', '53', 'Lorient'), r('b', 'client', '56100', '56', '53', 'Lorient'),
    r('c', 'client', '56000', '56', '53', 'Vannes'), r('d', 'fournisseur', '56000', '56', '53', 'Vannes'),
    r('e', 'client', '29200', '29', '53', 'Brest'), r('f', 'client', '75001', '75', '11', 'Paris'),
  ];
  const communes = E.regrouper(points, 'communes');
  assert.deepEqual(communes.map((g) => [g.cle, g.nombre]), [['56000', 2], ['56100', 2], ['29200', 1], ['75001', 1]], 'du plus gros au plus petit');
  assert.equal(communes[0]?.nom, 'Vannes', 'le nom vient de la fiche, jamais d’une table');
  const deps = E.regrouper(points, 'departements', new Map([['56', { lon: -2.8, lat: 47.85, nom: 'Morbihan' }]]));
  const morbihan = deps.find((g) => g.cle === '56');
  assert.equal(morbihan?.nombre, 4);
  assert.equal(morbihan?.nom, 'Morbihan', 'le nom officiel du département prime sur celui des fiches');
  assert.equal(morbihan?.lon, -2.8, 'le nom s’écrit au centre du département, pas sur la moyenne des clients');
  assert.deepEqual(morbihan?.roles, [['client', 3], ['fournisseur', 1]]);
  assert.equal(E.detailGroupe(morbihan as Groupe, LIBELLES), '3 clients, 1 fournisseur');
  assert.equal(E.phraseGroupe(morbihan as Groupe, LIBELLES), '3 clients, 1 fournisseur dans Morbihan');
  const regions = E.regrouper(points, 'regions', new Map([['53', { lon: -3, lat: 48.1, nom: 'Bretagne' }]]));
  assert.equal(regions.find((g) => g.cle === '53')?.nombre, 5);
  assert.equal(regions.length, 2, 'deux régions touchées');
  // sans ancre, le point du groupe est la moyenne de repères réels — jamais un point tiré au hasard
  const sansAncre = E.regrouper([points[0] as Repere, points[4] as Repere], 'regions');
  assert.equal(sansAncre[0]?.lon, (((points[0] as Repere).lon) + ((points[4] as Repere).lon)) / 2);
  // une clé absente ne fait pas de groupe fantôme
  assert.equal(E.regrouper([{ ...(points[0] as Repere), departement: '' }], 'departements').length, 0);
  assert.equal(E.compte('client', 1, LIBELLES), '1 client');
  assert.equal(E.compte('client', 12, LIBELLES), '12 clients');
  // au-delà de deux rôles, on résume plutôt que d'aligner la liste
  const melange = E.regrouper([r('g', 'client', '35000', '35', '53'), r('h', 'fournisseur', '35000', '35', '53'), r('i', 'chantier', '35000', '35', '53'), r('j', 'prospect', '35000', '35', '53')], 'communes');
  assert.equal(E.detailGroupe(melange[0] as Groupe, LIBELLES), '1 chantier, 1 client, et 2 autres');
  // sur un téléphone, un seul rôle : une étiquette plus large que l'écran serait simplement effacée (§5.6)
  assert.equal(E.detailGroupe(morbihan as Groupe, LIBELLES, { max: 1, reste: false }), '3 clients');
  assert.equal(E.detailGroupe(melange[0] as Groupe, LIBELLES, { max: 1, reste: false }), '1 chantier');
  // la phrase annoncée, elle, reste entière : elle est dite, pas placée dans une boîte
  assert.equal(E.phraseGroupe(melange[0] as Groupe, LIBELLES), '1 chantier, 1 client, 1 fournisseur, 1 prospect à 35000');
});

test('échelles : une carte vide n’est jamais muette, elle dit ce qui manque', async () => {
  const E = await charger<Echelles>('web/carte/echelles.js');
  assert.equal(E.manque({ total: 12, places: 12 }), null, 'tout est posé : rien à dire');
  assert.equal(E.manque({ total: 0, places: 0 }), null, 'rien à placer : rien à dire');
  const rien = E.manque({ total: 9, places: 0 });
  assert.ok(rien && /code postal/.test(rien.detail), 'rien de posé : on dit quoi ajouter');
  assert.equal(rien?.absents, 9);
  const partiel = E.manque({ total: 12, places: 9 });
  assert.match(partiel?.texte ?? '', /3 sans code postal/);
  assert.match(partiel?.detail ?? '', /code postal/);
  const outremer = E.manque({ total: 12, places: 10, horsMetropole: 2 });
  assert.match(outremer?.texte ?? '', /2 hors métropole/);
  assert.equal(outremer?.absents, 0);
});

test('géographie : les tracés se décodent, se projettent, et on ne pose rien sans code postal', async () => {
  const G = await charger<Geographie>('web/carte/geographie.js');
  const C = await charger<Contours>('web/carte/contours.js');
  const M = await charger<Communes>('web/carte/communes.js');
  // nombres : zigzag et base 64 à longueur variable, négatifs et grandes valeurs comprises
  assert.deepEqual(G.entiers('A'), [0]);
  const regions = G.decoderContours(C.REGIONS, C.GRILLE);
  const deps = G.decoderContours(C.DEPARTEMENTS, C.GRILLE);
  assert.equal(regions.length, 13, 'les 13 régions de métropole');
  assert.equal(deps.length, 96, 'les 96 départements de métropole');
  assert.equal(regions.find((r) => r.code === '53')?.nom, 'Bretagne');
  assert.ok(regions.some((r) => r.nom.includes('’') || r.nom.includes("'")), 'un nom à apostrophe survit au fichier fabriqué');
  for (const e of [...regions, ...deps]) {
    assert.ok(e.anneaux.length >= 1, `${e.code} a au moins un anneau`);
    assert.ok(e.anneaux.some((a) => !a.trou), `${e.code} a au moins un anneau plein`);
    for (const a of e.anneaux) assert.ok(a.lon.length >= 3 && a.lon.length === a.lat.length, `${e.code} : anneau fermé`);
  }
  // la Bretagne est au bon endroit et à la bonne taille (environ 250 km d'ouest en est)
  const bz = G.boiteDe(deps.filter((d) => ['22', '29', '35', '56'].includes(d.code)).flatMap((d) => d.anneaux));
  assert.ok(bz.lonMin < -5 && bz.lonMax > -1.1, 'de la pointe du Raz à la Vilaine');
  assert.ok(bz.latMin > 47 && bz.latMax < 49);
  const km = (a: number, b: number, lat: number) => (b - a) * Math.cos((lat * Math.PI) / 180) * G.KM_PAR_DEGRE;
  assert.ok(Math.abs(km(bz.lonMin, bz.lonMax, 48.1) - 275) < 40, 'la Bretagne mesure bien environ 275 km de large');
  // tout département appartient à une région connue, et la Bretagne a bien les quatre
  const bretons = Object.entries(C.REGION_DU_DEPARTEMENT).filter(([, r]) => r === '53').map(([d]) => d);
  assert.deepEqual(bretons.sort(), ['22', '29', '35', '56']);
  assert.equal(Object.keys(C.REGION_DU_DEPARTEMENT).length, 96);
  for (const d of deps) assert.ok(C.REGION_DU_DEPARTEMENT[d.code], `${d.code} a sa région`);
  // projection : aller-retour exact, nord vers les z négatifs comme le quartier nord de la ville
  const p = G.projection({ lon0: -3, lat0: 48.1 });
  assert.ok(Math.abs(p.lon(p.x(-4.1)) + 4.1) < 1e-9);
  assert.ok(Math.abs(p.lat(p.z(47.5)) - 47.5) < 1e-9);
  assert.ok(p.z(49) < 0 && p.z(47) > 0, 'le nord est vers les z négatifs');
  assert.equal(p.x(-3), 0);
  // codes postaux : un point par code, et le point tombe dans le bon département
  const cps = G.decoderCodesPostaux(M.CODES_POSTAUX, C.GRILLE);
  assert.ok(cps.size > 6000 && cps.size < 7000, `${cps.size} codes postaux`);
  const morbihan = deps.find((d) => d.code === '56') as Entite;
  const finistere = deps.find((d) => d.code === '29') as Entite;
  const lorient = cps.get('56100');
  assert.ok(lorient && G.dansEntite(morbihan.anneaux, lorient.lon, lorient.lat), 'Lorient est dans le Morbihan');
  assert.equal(G.dansEntite(finistere.anneaux, (lorient as { lon: number; lat: number }).lon, (lorient as { lon: number; lat: number }).lat), false);
  const quimper = cps.get('29000');
  assert.ok(quimper && G.dansEntite(finistere.anneaux, quimper.lon, quimper.lat), 'Quimper est dans le Finistère');
  // l'ancre d'un département tombe dedans : le nom ne s'écrit pas dans la mer
  for (const d of deps) {
    const a = G.ancreDe(d.anneaux);
    assert.ok(G.dansEntite(d.anneaux, a.lon, a.lat), `le nom du département ${d.code} (${d.nom}) s’écrit sur ses terres`);
  }
  // résolution d'une fiche : le code postal, sinon celui de l'adresse, sinon rien — jamais un point inventé
  assert.equal(G.codePostalDe('56100'), '56100');
  assert.equal(G.codePostalDe(' 29200 '), '29200');
  assert.equal(G.codePostalDe('12 rue du Port, 29000 Quimper'), '29000');
  assert.equal(G.codePostalDe('Adresse fictive'), null);
  assert.equal(G.codePostalDe('00000'), null);
  assert.equal(G.codePostalDe(null), null);
  assert.equal(G.departementDuCode('56100'), '56');
  assert.equal(G.departementDuCode('97400'), '974');
  assert.deepEqual(G.pointDe({ code_postal: '56100' }, cps), { cp: '56100', ...(lorient as { lon: number; lat: number }) });
  assert.deepEqual(G.pointDe({ adresse: '9 rue Thiers 56000 Vannes' }, cps), { cp: '56000', ...(cps.get('56000') as { lon: number; lat: number }) });
  assert.equal(G.pointDe({ adresse: 'Adresse fictive' }, cps), null, 'sans code postal, la fiche n’est pas posée');
  assert.equal(G.pointDe({ code_postal: '99999' }, cps), null, 'un code inconnu ne se devine pas');
  assert.equal(G.pointDe({}, cps), null);
  // la Réunion a bien un point, mais aucune région de cette carte : elle est comptée, pas posée au hasard
  assert.ok(cps.get('97400'), 'le code postal de Saint-Denis existe');
  assert.equal(C.REGION_DU_DEPARTEMENT['974'], undefined, 'les DROM ne sont pas sur cette carte');
});

test('échelles : fichiers servis, poids tenu, et ce que la scène en fait', () => {
  const s = fichiersStatiques();
  for (const c of ['/carte/echelles.js', '/carte/geographie.js', '/carte/contours.js', '/carte/communes.js']) {
    assert.ok(s.get(c), `${c} servi`);
    assert.equal(s.get(c)?.type, 'text/javascript; charset=utf-8');
  }
  // poids : le jeu se télécharge. Les tracés de toutes les communes de France pèseraient des dizaines de mégaoctets ;
  // ici, les deux fichiers fabriqués tiennent sous 100 kio, et la passerelle ne compresse pas (le poids sur disque
  // EST le poids téléchargé). Ce plafond est une décision, pas une mesure : il tient si personne ne l'augmente.
  const poids = (f: string) => statSync(new URL(f, RACINE)).size;
  const total = poids('web/carte/contours.js') + poids('web/carte/communes.js');
  assert.ok(total < 100 * 1024, `tracés et codes postaux : ${Math.round(total / 1024)} kio, moins de 100 kio`);
  // fichiers fabriqués : on dit comment les refaire, et d'où ils viennent
  for (const f of ['web/carte/contours.js', 'web/carte/communes.js']) {
    const t = lire(f);
    assert.match(t, /scripts\/carte-contours\.mjs/, `${f} dit comment se refabriquer`);
    assert.match(t, /Licence Ouverte/, `${f} dit sous quelle licence`);
  }
  const scene = lire('web/scene.js');
  // les niveaux de détail de la ville gardent le plafond de la ville, pas celui de la France
  assert.match(scene, /controles\.maxDistance = DISTANCES\.max/);
  assert.doesNotMatch(scene, /0\.6 \* controles\.maxDistance/, 'les accessoires se règlent sur le zoom de la ville');
  assert.doesNotMatch(scene, /maxDistance: controles\.maxDistance/, 'details() se règle sur le zoom de la ville');
  assert.match(scene, /maxDistance: DISTANCES\.ville/);
  assert.match(scene, /accessoires\.visible = PROFIL\.accessoires && d < 0\.6 \* DISTANCES\.ville/);
  // on arrive toujours dans sa ville, jamais sur la carte du pays
  assert.match(scene, /Math\.min\(DISTANCES\.ville, Math\.max\(170/);
  // la ville recouverte n'est plus calculée : la caméra éteint son calque, et l'occlusion ne tourne plus
  assert.match(scene, /if \(vv\) camera\.layers\.enable\(0\); else camera\.layers\.disable\(0\)/);
  assert.match(scene, /if \(composer && gtao && villeVue\)/);
  // la carte est plate et ordonnée à la main : rien du port ne peut la traverser
  assert.match(scene, /m\.depthTest = false/);
  // le nom de la région ne sort jamais d'un texte écrit à la main : il vient du découpage administratif
  assert.doesNotMatch(scene, /'Bretagne'/, 'aucune région écrite en dur dans la scène');
});
