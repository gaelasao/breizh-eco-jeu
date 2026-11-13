import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Application } from './application.ts';
import { ANONYMAT_MIN, BAROMETRE_DELAI_JOURS, COMMENTAIRES_MIN, Enquetes } from './enquetes.ts';
import { creerServeur } from './http.ts';

let serveur: Server;
let base: string;
let app: Application;
let cookie: string;
before(async () => {
  app = await Application.creer({ exemple: 'pme' });
  serveur = creerServeur(app);
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  const r = await fetch(`${base}/api/v1/session`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lb-requete': '1' }, body: JSON.stringify({ profilId: 'dirigeante' }) });
  cookie = (r.headers.get('set-cookie') ?? '').split(';')[0] as string;
});
after(() => new Promise<void>((ok) => serveur.close(() => ok())));

const appel = async (methode: string, chemin: string, corps?: unknown) => {
  const r = await fetch(`${base}/api/v1${chemin}`, { method: methode, headers: { cookie, ...(methode !== 'GET' ? { 'content-type': 'application/json', 'x-lb-requete': '1' } : {}) }, body: corps === undefined ? null : JSON.stringify(corps) });
  return { statut: r.status, json: await r.json().catch(() => null) as any, texte: '' };
};
const formulaire = async (jeton: string) => (await fetch(`${base}/api/public/formulaire/${jeton}`)).json() as Promise<any>;
const repondre = async (jeton: string, d: unknown) => {
  const r = await fetch(`${base}/api/public/formulaire/${jeton}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) });
  return { statut: r.status, json: await r.json().catch(() => null) as any };
};
const SECRET = 'Je suis à bout, mon chef me harcèle';
/** Type des fiches « personne » de l'exemple (celui de Nolwenn). */
let TYPE_PERSONNE = '';

test('baromètre : une réponse seule ne se relie jamais à la personne (monde, journal, lien, synthèse)', async () => {
  const lot = await appel('POST', '/enquetes/lot', { genre: 'collaborateur' });
  assert.equal(lot.statut, 200);
  const liens = lot.json.liens as { cible: string; nom: string; lien: string }[];
  assert.ok(liens.length >= ANONYMAT_MIN + 1, 'assez de collaborateurs dans la démonstration');
  const jeton = (c: string) => (liens.find((l) => l.cible === c)?.lien ?? '').split('/f/')[1] as string;
  const nolwenn = jeton('e-nolwenn');
  const autres = liens.filter((l) => l.cible !== 'e-nolwenn').map((l) => l.lien.split('/f/')[1] as string);

  // l'invitation ne garde pas la personne
  assert.equal(JSON.stringify(app.enquetes.instantane().invitations.filter((i) => i.genre === 'collaborateur')).includes('e-nolwenn'), false);

  assert.equal((await repondre(nolwenn, { note: 2, charge: 1, commentaire: SECRET })).statut, 200);

  // 1) rien dans le monde, les objets, le journal : pas d'objet individuel, pas d'heure
  const monde = await appel('GET', '/monde');
  assert.equal(JSON.stringify(monde.json).includes('harcèle'), false, 'commentaire absent de /monde');
  assert.equal(monde.json.objets.some((o: any) => o.type === 'barometre' && o.source?.id === 'formulaire'), false, 'aucun objet « réponse » créé');
  const journal = await appel('GET', '/journal');
  assert.equal(journal.statut, 200);
  assert.equal(JSON.stringify(journal.json).includes('barometre Baromètre'), false, 'aucune trace datée de la réponse au journal');

  // 2) le lien ne dit pas s'il a servi : même page pour Nolwenn (a répondu) et pour un autre (n'a pas répondu)
  const fn = await formulaire(nolwenn);
  const fa = await formulaire(autres[0] as string);
  assert.equal(fn.dejaRepondu, false);
  assert.deepEqual(fn, fa, 'pages identiques');
  // 3) une seconde réponse par le même lien : même réponse, rien de plus d'enregistré
  const encore = await repondre(nolwenn, { note: 9, commentaire: 'test de la direction' });
  assert.equal(encore.statut, 200);
  assert.deepEqual(encore.json, { ok: true });
  assert.equal(app.enquetes.instantane().barometre?.length, 1, 'la seconde réponse est ignorée');
  // une note invalide est refusée de la même façon, que le lien ait servi ou non
  assert.equal((await repondre(nolwenn, { note: 42 })).statut, (await repondre(autres[0] as string, { note: 42 })).statut);

  // 4) la synthèse ne montre rien sous 5 réponses publiées : ni moyenne, ni commentaire, ni compte, ni participation
  const s1 = (await appel('GET', '/satisfaction')).json.barometre;
  assert.equal(JSON.stringify(s1).includes('harcèle'), false);
  const publieesAvant = s1.reponses;

  // 5) quatre autres réponses : le lot de 5 est publié d'un coup, commentaire daté au mois, sans département
  for (const j of autres.slice(0, ANONYMAT_MIN - 1)) assert.equal((await repondre(j, { note: 7, charge: 6 })).statut, 200);
  const s2 = (await appel('GET', '/satisfaction')).json.barometre;
  assert.equal(s2.reponses - publieesAvant, ANONYMAT_MIN, 'publiées ensemble, jamais une à une');
  // un commentaire se reconnaît plus vite qu'une moyenne : rien sous 10 réponses publiées (revue-jeu-1-1)
  assert.equal(s2.commentaires.some((x: any) => x.texte === SECRET), false, 'lot de 5 publié : moyenne oui, ses commentaires non');
  for (const d of s2.departements) assert.ok(d.reponses >= ANONYMAT_MIN, 'un département n’apparaît qu’à partir de 5 réponses');
  // seule la synthèse (lot publié) le reprend ; aucun objet ni journal
  const apres = (await appel('GET', '/monde')).json;
  assert.equal(JSON.stringify(apres.objets).includes('harcèle'), false, 'toujours aucun objet individuel');
  assert.equal(JSON.stringify((await appel('GET', '/journal')).json).includes('harcèle'), false);

  // 6) magasin : ni nom, ni heure, ni lien avec l'invitation
  const brut = JSON.stringify(app.enquetes.instantane().barometre);
  assert.equal(/e-nolwenn|Nolwenn|T\d{2}:\d{2}|inv-/.test(brut), false);
});

test('baromètre : anciennes réponses individuelles retirées du monde et rendues anonymes', async () => {
  const a = await Application.creer({ exemple: 'pme' });
  try {
    for (let i = 0; i < 2; i++) a.monde.creerObjetSysteme('formulaire', 'barometre', 'Baromètre — 2026-11-02', { note: 3, commentaire: `ancien ${i}`, recu_le: '2026-11-02' }, { id: 'formulaire', libelle: 'Baromètre collaborateurs (anonyme)' });
    assert.equal(a.monde.objetsReels().filter((o) => o.type === 'barometre' && o.source.id === 'formulaire').length, 2);
    const e = new Enquetes(a.monde, { etat: { invitations: [{ id: 'inv-x', empreinte: 'e', genre: 'collaborateur', cible: 'e-nolwenn', departement: null, creeLe: new Date().toISOString(), expire: new Date().toISOString(), envoyeePar: 'dirigeante', repondueLe: '2026-11-02T10:11:12.000Z' }] } });
    assert.equal(a.monde.objetsReels().filter((o) => o.type === 'barometre' && o.source.id === 'formulaire').length, 0, 'plus aucun objet individuel');
    const etat = e.instantane();
    assert.equal(etat.barometre?.length, 2);
    assert.equal(etat.invitations[0]?.cible, '', 'la personne n’est plus gardée');
    assert.equal(etat.invitations[0]?.repondueLe, '2026-11', 'le mois seulement');
    const p = a.monde.profil('dirigeante');
    assert.ok(p);
    assert.equal(e.resume(p).barometre?.commentaires.some((c) => c.texte.startsWith('ancien')), false, 'sous le seuil : rien de publié');
  } finally {
    a.arreter();
  }
});

test('revue-jeu-1-1 : un seul lien de baromètre par fiche et par 30 jours, aucun pour une fiche créée depuis moins de 30 jours', async () => {
  const a = await Application.creer({ exemple: 'pme' });
  try {
    const p = a.monde.profil('dirigeante');
    assert.ok(p);
    const origine = 'https://jeu.test';
    // la direction se crée un lien pour Nolwenn, puis en veut d'autres pour répondre plusieurs fois : refus
    TYPE_PERSONNE = a.monde.objetReel('e-nolwenn')!.type;
    assert.ok(a.enquetes.inviter(p, 'e-nolwenn', origine).lien);
    assert.throws(() => a.enquetes.inviter(p, 'e-nolwenn', origine), (e: any) => e.statut === 409 && e.code === 'barometre_deja_envoye');
    // l'envoi groupé écarte les personnes déjà servies au lieu de leur donner un second lien
    const lot = a.enquetes.inviterLot(p, { genre: 'collaborateur' }, origine);
    assert.equal(lot.liens.some((l) => l.cible === 'e-nolwenn'), false);
    assert.equal(lot.ecartes, 1);
    const encore = a.enquetes.inviterLot(p, { genre: 'collaborateur' }, origine);
    assert.deepEqual([encore.liens.length, encore.ecartes], [0, lot.liens.length + 1], 'un second envoi groupé ne donne aucun lien de plus');
    // une fiche créée pour l'occasion ne donne pas un lien de plus
    const faux = a.monde.creerObjet(p, 's', { type: TYPE_PERSONNE, nom: 'Salarié Fantôme', champs: {} }) as { id: string };
    assert.throws(() => a.enquetes.inviter(p, faux.id, origine), (e: any) => e.statut === 409 && e.code === 'barometre_fiche_recente');
    // commentaires des formulaires : rien à 9 réponses publiées, visibles à 10, datés au mois, sans département
    const mois = new Date().toISOString().slice(0, 7);
    const publiees = (n: number) => Array.from({ length: n }, (_, i) => ({ recu: mois, departement: 'd-atelier', note: 5, charge: null, commentaire: i === 0 ? SECRET : null, global: mois, service: null }));
    const vus = (n: number) => new Enquetes(a.monde, { etat: { invitations: [], barometre: publiees(n) } }).resume(p).barometre!.commentaires;
    assert.equal(vus(COMMENTAIRES_MIN - 1).some((c) => c.texte === SECRET), false, 'un commentaire se reconnaît plus vite qu’une moyenne');
    const c = vus(COMMENTAIRES_MIN).find((x) => x.texte === SECRET);
    assert.ok(c, 'commentaire visible à partir de 10 réponses publiées');
    assert.deepEqual(Object.keys(c).sort(), ['le', 'texte'], 'ni département ni autre champ');
    assert.match(c.le, /^\d{4}-\d{2}$/, 'mois seulement');
    // le registre ne garde que la fiche et le jour : rien du lien, et il est à part des invitations
    const etat = a.enquetes.instantane();
    assert.ok(etat.envoisBarometre?.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.le) && Object.keys(e).sort().join() === 'fiche,le'));
    assert.equal(JSON.stringify(etat.invitations.filter((i) => i.genre === 'collaborateur')).includes('e-nolwenn'), false, 'l’invitation ne nomme toujours pas la personne');
    // la période passée, un nouveau lien est possible ; une fiche effacée quitte le registre
    const plusTard = new Enquetes(a.monde, { etat: { ...etat, envoisBarometre: etat.envoisBarometre!.map((e) => ({ ...e, le: new Date(Date.now() - (BAROMETRE_DELAI_JOURS + 2) * 86_400_000).toISOString().slice(0, 10) })) } });
    assert.ok(plusTard.inviter(p, 'e-nolwenn', origine).lien);
    plusTard.oublierObjet('e-nolwenn');
    assert.equal(plusTard.instantane().envoisBarometre?.some((e) => e.fiche === 'e-nolwenn'), false);
  } finally {
    a.arreter();
  }
});
