/* Living Business — les trois échelles de la carte et le passage de l'une à l'autre (direction de design §5.7, §5.10).
   Module PUR : aucun accès au DOM ni à three.js ; testé par src/ds/carte-echelles.test.ts.

   On dézoome et le pays apparaît autour de la ville ; on zoome et on retombe dans sa ville. Ce ne sont pas trois
   écrans : c'est une seule course de caméra, de 6 à 4 800 unités, où ce qu'on voit change par fondus.

     6 → 360     la ville (ce qui existait avant : 1 unité = 1 mètre)
     380 → 900   la carte du pays se referme sur la ville, par un anneau qui se resserre
     470 → 1 250 les communes où l'entreprise a quelque chose, une par une
     1 100 → 2 600  les départements, les communes y sont regroupées
     2 400 → 4 800  les régions, les départements y sont regroupés

   Les bandes se chevauchent exprès : à aucun moment une étiquette ne disparaît sans qu'une autre ait pris sa place.
   Et rien ne bouge tout seul : à l'arrêt, la carte ne redemande pas une seule image (§5.10). */

/** Distances de caméra, en unités de scène. */
export const DISTANCES = Object.freeze({
  min: 6,
  /** Plafond de la ville : tout ce qui se règle « en fraction du zoom » dans la ville s'y réfère, pas au plafond réel. */
  ville: 360,
  /** La carte du pays commence à se dessiner autour du plateau — juste après l'ancien bout du monde, jamais avant. */
  carteDes: 380,
  /** Au-delà, la carte est partout : plus rien du décor de la ville ne se voit. */
  carteSeule: 900,
  communesDes: 470,
  communesJusqua: 1250,
  departementsDes: 1100,
  departementsJusqua: 2600,
  regionsDes: 2400,
  /** La France entière tient dans l'écran. */
  max: 4800,
});

/** Rayon du trou laissé à la ville dans la carte, au moment où la carte apparaît (le plateau tient dans 119 unités). */
export const TROU = Object.freeze({ clair: 128, plein: 190 });

/** Angle polaire : la ville se visite de biais (79°), une carte se lit d'au-dessus (36°). */
export const POLAIRE = Object.freeze({ ville: 1.38, carte: 0.62 });

/** Rapport entre la distance de caméra et la largeur de sol visible, mesuré sur le cadrage de la ville. */
export const LARGEUR_PAR_DISTANCE = 0.6;

/** Fondu doux entre deux bornes : 0 avant `a`, 1 après `b`, sans marche ni cassure. */
export function lisse(a, b, x) {
  if (!(b > a)) return x >= b ? 1 : 0;
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Échelle dominante à cette distance : ce que l'on est en train de regarder. */
export function echelle(distance) {
  const D = DISTANCES;
  if (distance < D.carteDes) return 'ville';
  if (distance < D.departementsDes) return 'communes';
  if (distance < D.regionsDes) return 'departements';
  return 'regions';
}

/** Nom de l'échelle, pour l'annoncer. `region` : nom de la région d'origine de l'entreprise, s'il est connu. */
export function nomEchelle(nom, region = null) {
  if (nom === 'ville') return 'Ma ville';
  if (nom === 'communes') return region ? `Mes communes (${region})` : 'Mes communes';
  if (nom === 'departements') return region ? `Les départements (${region})` : 'Les départements';
  return 'La France';
}

/**
 * Opacité de la carte du pays, et rayons du trou qu'elle laisse à la ville, à cette distance.
 * `opacite` : la carte se révèle d'abord tout entière, très doucement, autour du plateau.
 * `clair` et `plein` : à l'intérieur du rayon clair, la ville se voit telle quelle ; au-delà du rayon plein, la carte
 * est pleine. Les deux se resserrent jusqu'à zéro : l'anneau balaie la ville de l'extérieur vers le centre.
 */
export function carte(distance) {
  const D = DISTANCES;
  const opacite = lisse(D.carteDes, D.carteDes + 130, distance);
  const fermeture = lisse(D.carteDes + 130, D.carteSeule, distance);
  return { opacite, clair: TROU.clair * (1 - fermeture), plein: TROU.plein * (1 - fermeture) };
}

/** La ville vaut-elle encore la peine d'être calculée ? (au-delà, la carte la recouvre entièrement) */
export const villeVisible = (distance) => distance < DISTANCES.carteSeule;

/** Opacité des tracés des départements et des régions. */
export function opaciteTraces(distance) {
  const D = DISTANCES;
  return {
    departements: lisse(D.carteDes, D.communesDes, distance) * (1 - lisse(D.departementsJusqua, D.max, distance)),
    regions: lisse(D.departementsDes, D.regionsDes, distance),
  };
}

/** Angle polaire maximal : on se redresse au-dessus de la carte à mesure qu'on s'éloigne. */
export function polaireMax(distance) {
  const t = lisse(DISTANCES.ville, DISTANCES.departementsDes, distance);
  return POLAIRE.ville + (POLAIRE.carte - POLAIRE.ville) * t;
}

/**
 * Étendue de sol visible, en unités, à cette distance de caméra — mesurée sur le cadrage de la ville (le plateau de
 * 192 × 142 unités tient à 360). La vue est oblique : la profondeur et la largeur se valent à peu près, et la
 * largeur suit l'aspect de la fenêtre au-delà du format de référence.
 */
export const etendueVue = (distance) => distance * LARGEUR_PAR_DISTANCE;

/**
 * Jusqu'où la caméra peut se promener. Dans la ville, le plateau, comme avant. Au-delà, l'emprise de la carte,
 * rognée de la moitié de ce qu'on voit : quand l'écran est plus large que la France, il ne reste qu'un point, et la
 * caméra se recentre d'elle-même sur le pays — comme toute carte qui se respecte.
 * `plateau` et `emprise` : { x0, x1, z0, z1 } ; `aspect` : largeur / hauteur de la vue.
 * `retour` : un vol est en cours. Les bornes rognent la visée même en plein vol ; sans cela, un retour vers sa ville
 * serait arraché en route par une boîte encore serrée sur le centre du pays. Le temps du vol, le plateau reste donc
 * dans les bornes, quelle que soit l'échelle d'où l'on part.
 */
export function bornes(distance, { plateau, emprise, aspect = 1.6, retour = false }) {
  if (distance <= DISTANCES.ville || !emprise) return plateau;
  const h = etendueVue(distance) / 2;
  const serre = (a, b, marge) => (b - a > 2 * marge ? [a + marge, b - marge] : [(a + b) / 2, (a + b) / 2]);
  const [x0, x1] = serre(emprise.x0, emprise.x1, h * Math.max(1, aspect / 1.6));
  const [z0, z1] = serre(emprise.z0, emprise.z1, h);
  /* Passé ce point la carte est partout, et elle se recentre alors sur le pays : une carte de France montre la France,
     pas le coin où l'on habite. Le glissement est continu — la boîte ne pousse la caméra qu'à mesure qu'elle se
     referme, et à 4 800 elle n'est plus qu'un point. On rentre chez soi en rezoomant, ou d'un clic sur sa commune. */
  if (!villeVisible(distance) && !retour) return { x0, x1, z0, z1 };
  // tant qu'on voit encore sa ville, elle reste atteignable : dézoomer ne doit jamais arracher de chez soi
  return {
    x0: Math.min(x0, plateau.x0), x1: Math.max(x1, plateau.x1),
    z0: Math.min(z0, plateau.z0), z1: Math.max(z1, plateau.z1),
  };
}

/**
 * Brume et plan lointain. Dans la ville, exactement ce qu'ils étaient : l'horizon à 260 unités derrière la cible, le
 * plan lointain à 1 400 (c'est lui qui laisse le tampon de profondeur séparer un marquage de sa chaussée). Au-delà,
 * la brume s'écarte en carré de l'échelle — sinon, à l'échelle du pays, toute la France au-delà de deux cents unités
 * serait noyée dans le gris. `portee` : 1 par temps clair, moins sous les nuages.
 */
export function brume(distance, portee = 1) {
  const k = Math.max(1, distance / DISTANCES.ville);
  return { pres: distance + 40 * portee * k, loin: distance + 260 * portee * k * k };
}
export const planLointain = (distance) => (distance <= DISTANCES.ville ? 1400 : Math.max(1400, distance * 4));

/** Niveau de regroupement des repères à cette distance : par commune, par département ou par région. */
export const NIVEAUX = Object.freeze(['communes', 'departements', 'regions']);

/**
 * Regroupe des repères. `points` : [{ id, role, cp, departement, region, lon, lat, nom }].
 * `ancres` : Map(clé → { lon, lat }) — le point où écrire le nom d'un département ou d'une région (son centre
 * géographique). Sans ancre, on prend la moyenne des repères du groupe : une moyenne de points réels, jamais un
 * point tiré au hasard dans le département.
 * Retourne [{ cle, niveau, nombre, roles: [[role, n], …], ids, lon, lat, nom }], du plus gros groupe au plus petit.
 */
export function regrouper(points, niveau, ancres = new Map()) {
  const champ = niveau === 'communes' ? 'cp' : niveau === 'departements' ? 'departement' : 'region';
  const groupes = new Map();
  for (const p of points) {
    const cle = p[champ];
    if (cle === null || cle === undefined || cle === '') continue;
    if (!groupes.has(cle)) groupes.set(cle, { cle, niveau, nombre: 0, roles: new Map(), ids: [], noms: new Map(), points: [] });
    const g = groupes.get(cle);
    g.nombre++;
    g.roles.set(p.role, (g.roles.get(p.role) ?? 0) + 1);
    g.ids.push(p.id);
    g.points.push(p);
    if (p.nom) g.noms.set(p.nom, (g.noms.get(p.nom) ?? 0) + 1);
  }
  const res = [];
  for (const g of groupes.values()) {
    const ancre = ancres.get(g.cle);
    const lon = ancre ? ancre.lon : g.points.reduce((s, p) => s + p.lon, 0) / g.points.length;
    const lat = ancre ? ancre.lat : g.points.reduce((s, p) => s + p.lat, 0) / g.points.length;
    // nom du groupe : celui de l'ancre (nom officiel) sinon le nom le plus souvent écrit sur les fiches
    const frequent = [...g.noms.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))[0];
    res.push({
      cle: g.cle, niveau: g.niveau, nombre: g.nombre, ids: g.ids, lon, lat,
      roles: [...g.roles.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))),
      nom: ancre?.nom ?? frequent?.[0] ?? g.cle,
    });
  }
  return res.sort((a, b) => b.nombre - a.nombre || String(a.cle).localeCompare(String(b.cle)));
}

/** Pluriel d'un rôle : « 1 client », « 12 clients ». `libelles` : { client: ['client', 'clients'], … }. */
export function compte(role, n, libelles = {}) {
  const [un, plusieurs] = libelles[role] ?? [role, `${role}s`];
  return `${n} ${n > 1 ? plusieurs : un}`;
}

/**
 * Détail d'un groupe : « 7 clients, 2 fournisseurs » (les rôles les plus nombreux, puis « et 3 autres »).
 * `max` : combien de rôles sont nommés — un seul sur un téléphone, où une étiquette trop large ne tient pas dans
 * l'écran et serait simplement effacée par le placement (§5.6). `reste` : dire ou non ce qui n'est pas nommé.
 */
export function detailGroupe(groupe, libelles = {}, { max = 2, reste = true } = {}) {
  const parts = groupe.roles.slice(0, max).map(([r, n]) => compte(r, n, libelles));
  const autres = groupe.roles.slice(max).reduce((s, [, n]) => s + n, 0);
  if (autres && reste) parts.push(`et ${autres} ${autres > 1 ? 'autres' : 'autre'}`);
  return parts.join(', ');
}

/** Phrase annoncée quand on arrive sur un groupe : « 12 clients dans le Morbihan ». Toujours entière, elle est dite. */
export function phraseGroupe(groupe, libelles = {}) {
  const ou = groupe.niveau === 'communes' ? 'à' : 'dans';
  return `${detailGroupe(groupe, libelles, { max: 4 })} ${ou} ${groupe.nom}`;
}

/**
 * Ce qui manque pour qu'une fiche se pose sur la carte. `total` : fiches concernées ; `places` : celles qui ont un
 * code postal reconnu. Retourne null quand tout est posé, sinon de quoi écrire une étiquette sur la carte.
 * Une entreprise qui n'a encore rien renseigné ne doit pas voir une carte vide et muette.
 */
export function manque({ total = 0, places = 0, horsMetropole = 0 } = {}) {
  const absents = Math.max(0, total - places - horsMetropole);
  if (!absents && !horsMetropole) return null;
  if (!places && absents) {
    return {
      texte: 'Rien à poser sur la carte',
      detail: absents === total ? 'Ajoutez le code postal de vos clients et de vos lieux' : 'Ajoutez un code postal',
      absents, horsMetropole,
    };
  }
  const parts = [];
  if (absents) parts.push(`${absents} sans code postal`);
  if (horsMetropole) parts.push(`${horsMetropole} hors métropole`);
  return { texte: parts.join(', '), detail: absents ? 'Ajoutez leur code postal pour les voir ici' : 'Cette carte ne montre que la métropole', absents, horsMetropole };
}

/**
 * Distance de caméra à laquelle se poser quand on clique un groupe : on entre d'un cran dans son échelle. Une commune
 * ne descend pas jusqu'à la ville — la ville est ailleurs, on se contente de s'en approcher ; sauf si c'est la sienne,
 * et c'est alors la scène qui le sait.
 */
export function volVers(niveau) {
  const D = DISTANCES;
  if (niveau === 'regions') return D.departementsDes;
  if (niveau === 'departements') return D.communesDes + 180;
  return D.carteDes + 150; // la carte y est pleine : on n'atterrit jamais sur une carte encore absente
}
