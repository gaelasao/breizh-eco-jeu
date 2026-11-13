/**
 * Corrections du contrôle qualité (novembre 2026) : textes à la française côté serveur, trous de planning cohérents,
 * erreurs de réglage en 422, libellés français des connecteurs, cache (ETag, 304, sprite versionné), liste filtrable,
 * débordements à 320 px, Échap couche par couche, un seul bouton principal, surfaces élevées en sombre.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { casseDePhrase, mesure, nombreFr, pluriel } from '../core/texte.ts';
import { evaluerEcheance, evaluerSeuil } from '../core/situation.ts';
import { majQuetes } from '../core/quetes.ts';
import type { Univers } from '../core/univers.ts';
import { Application } from '../passerelle/application.ts';
import { creerServeur } from '../passerelle/http.ts';
import { fichiersStatiques } from '../passerelle/statiques.ts';
import { lireJetons } from '../../scripts/jetons.ts';

const RACINE = new URL('../../', import.meta.url);
const lire = (f: string) => readFileSync(new URL(f, RACINE), 'utf8');
/** Les sorties d'Intl peuvent changer d'espace selon la version d'ICU : on les normalise avant de comparer (§8.3). */
const espaces = (t: string) => t.replace(/[  ]/g, ' ');

test('textes serveur : nombres à la française, 0 et 1 au singulier, unités insécables', () => {
  assert.equal(espaces(nombreFr(6800)), '6 800');
  assert.equal(espaces(nombreFr(12.5)), '12,5');
  assert.equal(pluriel(0, 'jour', 'jours'), '0 jour', '0 prend le singulier en français');
  assert.equal(pluriel(1, 'jour', 'jours'), '1 jour');
  assert.equal(pluriel(42, 'jour', 'jours'), '42 jours');
  assert.equal(espaces(mesure(6800, '€')), '6 800 €');
  assert.ok(mesure(6800, '€').includes(' €'), 'insécable avant le symbole');
  assert.equal(mesure(1, 'jours'), '1 jour', 'unité accordée');
  assert.equal(mesure(12, '%'), '12 %');
  assert.equal(mesure(3, '/10'), '3/10');
  assert.equal(mesure(6, null), '6');
  assert.equal(casseDePhrase('à traiter'), 'À traiter');
  assert.equal(casseDePhrase(''), '');
});

test('situations : « Retard de paiement : 42 jours » (sans « maximum 0 jours »), milliers, échéances accordées', () => {
  const ctx = { maintenant: new Date('2026-11-10T10:00:00Z'), ageMaxMs: 7 * 86_400_000 };
  const v = (valeur: number) => ({ valeur, source: { id: 'x', libelle: 'Test', derniereSynchro: null }, observeLe: '2026-11-10T09:00:00Z', provenance: 'confirme' as const });
  const retard = { id: 'retard_paiement', libelle: 'Retard de paiement', sens: 'max' as const, seuilCritique: 30, unite: 'jours' };
  assert.equal(evaluerSeuil('f', v(42), 0, retard, null, ctx)?.description, 'Retard de paiement : 42 jours');
  assert.equal(evaluerSeuil('f', v(1), 0, retard, null, ctx)?.description, 'Retard de paiement : 1 jour');
  const encours = { id: 'encours_client', libelle: 'Encours', sens: 'max' as const, unite: '€' };
  assert.equal(espaces(evaluerSeuil('c', v(6800), 5000, encours, null, ctx)?.description ?? ''), 'Encours : 6 800 € (maximum 5 000 €)');
  const stock = { id: 'stock_minimum', libelle: 'Stock', sens: 'min' as const, seuilCritique: 0 };
  assert.equal(evaluerSeuil('a', v(6), 20, stock, null, ctx)?.description, 'Stock : 6 (minimum 20)');

  const u = { echeances: [{ id: 'document_expire', libelle: 'Document', type: 'document', champ: 'valide_jusqu_au', critiqueApresJours: 0, avantJours: 30 }] } as unknown as Univers;
  const doc = (d: string) => ({ id: 'd', type: 'document', champs: { valide_jusqu_au: d }, majLe: '2026-11-10T09:00:00Z', source: { id: 'x', libelle: 'Test' }, provenance: 'confirme' }) as never;
  assert.equal(evaluerEcheance(u, doc('2026-11-04'), null, ctx)[0]?.description, 'Document : échéance dépassée de 6 jours', 'accord sur « échéance », jamais « Document : dépassée »');
  assert.equal(evaluerEcheance(u, doc('2026-11-11'), null, ctx)[0]?.description, 'Document : échéance demain');
  assert.equal(evaluerEcheance(u, doc('2026-11-10'), null, ctx)[0]?.description, 'Document : échéance aujourd’hui');
  assert.equal(evaluerEcheance(u, doc('2026-11-20'), null, ctx)[0]?.description, 'Document : échéance dans 10 jours');
});

test('quêtes : objectif à la française (« ≤ 5 000 € »), un retard maximum de 0 devient « ramené à zéro »', () => {
  const generique = JSON.parse(lire('univers/generique.json')) as Univers;
  const situations = [
    { objetId: 'c1', regle: 'encours_client', description: '', gravite: 'attention' as const, statut: 'ouverte' as const, responsable: null, preuve: { valeur: 6800, seuil: 5000, source: { id: 'x', libelle: 'T' }, observeLe: null, provenance: 'confirme' as const, fraicheur: 'fraiche' as const } },
    { objetId: 'f1', regle: 'retard_paiement', description: '', gravite: 'critique' as const, statut: 'ouverte' as const, responsable: null, preuve: { valeur: 42, seuil: 0, source: { id: 'x', libelle: 'T' }, observeLe: null, provenance: 'confirme' as const, fraicheur: 'fraiche' as const } },
  ];
  const base = { famille: 'tiers', majLe: '2026-11-10T09:00:00Z', source: { id: 'x', libelle: 'T' }, provenance: 'confirme', mode: 'reel' };
  const objets = new Map([
    ['c1', { ...base, id: 'c1', nom: 'Kerlann', type: 'entreprise', roles: ['client'], champs: { encours: 6800, limite_encours: 5000 } }],
    ['f1', { ...base, id: 'f1', nom: 'F-041', famille: 'commande', type: 'facture', roles: [], champs: { retard_jours: 42 } }],
  ]) as never;
  const q = majQuetes(generique, new Map(), situations as never, objets, { maintenant: new Date('2026-11-10T10:00:00Z'), ageMaxMs: 7 * 86_400_000 });
  const objectifs = [...q.values()].map((x) => espaces(x.objectif));
  assert.ok(objectifs.includes('Objectif : ≤ 5 000 €, prouvé par une donnée à jour.'), objectifs.join(' | '));
  assert.ok(objectifs.includes('Objectif : retard de paiement ramené à zéro, prouvé par une donnée à jour.'), objectifs.join(' | '));
});

test('planning et Optimiser : le même nombre de trous sur les 6 prochains jours ouvrés (P3)', async () => {
  const app = await Application.creer({ exemple: 'eti' });
  const p = app.monde.profil('dirigeante');
  assert.ok(p);
  const prochains = app.monde.trousPlanningReel('prochains');
  assert.ok(prochains >= app.monde.trousPlanningReel(), 'aujourd’hui est compris dans les 6 jours');
  const piste = app.automatisations.optimisations(p).opportunites.find((o) => o.id === 'planning');
  if (prochains > 0) assert.match(espaces(piste?.constat ?? ''), new RegExp(`^${prochains} trous? dans le planning des 6 prochains jours ouvrés, aujourd’hui compris`));
  else assert.equal(piste, undefined);
});

test('connecteurs : réglage manquant → 422 nommant le champ (jamais 502), choix techniques traduits en français', async () => {
  const app = await Application.creer({ exemple: 'pme', fetch: (async () => { throw new Error('aucun appel réseau attendu'); }) as typeof fetch });
  const p = app.monde.profil('dirigeante');
  assert.ok(p);
  await assert.rejects(app.synchro.apercu(p, { source: 'pennylane', config: { jeton: 'x'.repeat(30) }, typeObjet: 'entreprise' }),
    (e: { statut?: number; code?: string; message?: string }) => e.statut === 422 && e.code === 'reglage_invalide:objet' && /clients ou fournisseurs/.test(e.message ?? ''));
  await assert.rejects(app.synchro.apercu(p, { source: 'hubspot', config: { jeton: 'pat-x' }, typeObjet: 'entreprise' }), (e: { statut?: number }) => e.statut === 422);
  const cat = await app.synchro.catalogue();
  const objet = (id: string) => (cat.find((x) => x.id === id)?.champs.find((c) => c.id === 'objet') as { options?: { valeur: string; libelle: string }[] } | undefined)?.options;
  assert.deepEqual(objet('hubspot'), [{ valeur: 'companies', libelle: 'Entreprises' }, { valeur: 'contacts', libelle: 'Contacts' }, { valeur: 'deals', libelle: 'Affaires' }]);
  assert.deepEqual(objet('pennylane')?.map((o) => o.libelle), ['Clients', 'Fournisseurs']);
  for (const s of cat) {
    for (const c of s.champs) {
      assert.doesNotMatch(`${c.libelle} ${c.aide}`, /\b(companies|deals|customers|vendors|accounts|organizations|persons|invoices|orders|products)\b/, `${s.id} › ${c.id} : pas de valeur technique anglaise dans le libellé ou l’aide`);
      for (const o of (c as { options?: { libelle: string }[] }).options ?? []) assert.match(o.libelle, /^\p{Lu}/u, `${s.id} › ${c.id} : option en casse de phrase`);
    }
  }
  assert.equal(cat.find((x) => x.id === 'hubspot')?.champs.find((c) => c.id === 'proprietes')?.avance, true, 'noms internes : réglage replié pour l’informaticien');
  assert.equal(cat.find((x) => x.id === 'hubspot')?.oauthPossible, true, '« Se connecter avec… » annoncé même sans relais');
});

test('fichiers servis : ETag et 304, sprite d’icônes demandé avec sa version et servi immuable', async () => {
  const s = fichiersStatiques();
  const sprite = s.get('/bz/icones.svg');
  assert.ok(sprite);
  assert.match(sprite.etag, /^"[A-Za-z0-9_-]{27}"$/);
  assert.equal(sprite.version, sprite.etag.slice(1, 11));
  assert.match(s.get('/bz/icone.js')?.contenu.toString('utf8') ?? '', new RegExp(`export const SPRITE = '/bz/icones\\.svg\\?v=${sprite.version}';`), 'icone.js porte la version du sprite');
  assert.match(lire('web/bz/icone.js'), /export const SPRITE = '\/bz\/icones\.svg';/, 'la source garde l’adresse simple (réécrite au service)');

  const serveur = creerServeur(await Application.creer());
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  try {
    const r = await fetch(`${base}/bz/icones.svg`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-cache');
    const etag = r.headers.get('etag');
    assert.equal(etag, sprite.etag);
    const r304 = await fetch(`${base}/bz/icones.svg`, { headers: { 'if-none-match': etag as string } });
    assert.equal(r304.status, 304, 'inchangé : rien n’est retéléchargé');
    assert.equal((await r304.arrayBuffer()).byteLength, 0);
    assert.equal((await fetch(`${base}/bz/icones.svg?v=${sprite.version}`)).headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal((await fetch(`${base}/bz/icones.svg?v=autre`)).headers.get('cache-control'), 'no-cache', 'une autre version n’est jamais figée');
    assert.equal((await fetch(`${base}/bz/combobox.js`)).status, 200, 'nouveaux modules servis (liste blanche)');
    assert.equal((await fetch(`${base}/bz/onglets.js`)).status, 200);
    assert.equal((await fetch(`${base}/bz/../package.json`)).status, 404);
  } finally {
    await new Promise<void>((ok) => serveur.close(() => ok()));
  }
  assert.match(lire('web/scene.js'), /THREE\.Cache\.enabled = true;/, 'textures KayKit lues une seule fois par session');
});

test('liste filtrable (au-delà de 15 choix, §4.6) : sans accents ni casse, chaque mot cherché', async () => {
  const { filtrerOptions, pourRecherche } = await import(new URL('web/bz/combobox.js', RACINE).href) as { filtrerOptions: (o: { libelle: string; detail?: string }[], q: string) => { libelle: string }[]; pourRecherche: (t: string) => string };
  const options = [{ libelle: 'Employés', detail: 'équipe' }, { libelle: 'Équipements', detail: 'stock et matériel' }, { libelle: 'Clients', detail: 'entreprises, particuliers' }];
  assert.equal(pourRecherche('  Équipe '), 'equipe');
  assert.deepEqual(filtrerOptions(options, 'equi').map((o) => o.libelle), ['Employés', 'Équipements']);
  assert.deepEqual(filtrerOptions(options, 'stock mat').map((o) => o.libelle), ['Équipements']);
  assert.equal(filtrerOptions(options, '').length, 3);
  assert.equal(filtrerOptions(options, 'bois').length, 0);
  const app = lire('web/app.js');
  assert.match(app, /if \(cibles\.length <= 15\) return champListe\(/, 'au-delà de 15 cibles : comboFiltrable');
  assert.match(lire('web/bz/combobox.js'), /role: 'combobox'/);
});

test('assistant de connecteur : champs obligatoires vérifiés avant tout appel, résumé focalisé, erreurs sous les champs', () => {
  const app = lire('web/app.js');
  assert.match(app, /C\.erreurs = erreursOutil\(C, true\);\n {2}if \(C\.erreurs\) \{ A\.focusErreur = true; majOutil\(C\); return; \}/, 'aucun appel au serveur tant qu’un champ obligatoire est vide');
  assert.match(app, /resumeErreurs\(erreursChamps, \{ idDe: \(k\) => `outil-\$\{k\}`, id: 'assistant-resume-erreurs' \}\)/);
  assert.match(app, /'aria-invalid': invalide/);
  assert.match(app, /id: `\$\{id\}-erreur`/);
  assert.match(app, /cle: 'assistant-principal'/, 'le bouton garde le focus pendant « Connexion… »');
  assert.match(lire('web/connecter.js'), /saisie = true/, 'pas de « Abandonner ? » quand rien n’a été saisi');
});

test('Échap ne ferme que la couche du dessus ; palette : première option vraiment active', () => {
  const app = lire('web/app.js');
  assert.match(app, /!document\.querySelector\('dialog\[open\]'\) && !popoverOuvert\(\)\) \{ e\.preventDefault\(\); fermerFiche\(\); \}/);
  assert.match(app, /aucunDialogue\(\) && !popoverOuvert\(\)/, 'le raccourci Échap global respecte aussi le popover');
  assert.match(lire('web/bz/popover.js'), /export function popoverOuvert\(\)/);
  assert.match(lire('web/bz/palette.js'), /firstOptionSelectionMode: 'selected'/);
});

test('débordements et cibles : onglets positionnés, texte caché hors des onglets, 44 px au toucher', () => {
  const css = lire('web/bz/composants.css');
  assert.match(css, /\.bz-onglets \{ position: relative;/, 'le texte masqué d’un onglet reste dans la barre');
  assert.match(css, /\.bz-onglets-cadre\[data-debord-fin\] > \.bz-onglets \{ mask-image/, 'fondu quand des onglets sont cachés');
  assert.match(css, /@media \(pointer: coarse\) \{ \.bz-segments > button \{ min-block-size: var\(--bz-cible-min\); \} \}/);
  assert.match(css, /\.bz-tableau__cible \{[^}]*min-block-size: var\(--bz-cible\)/);
  assert.match(css, /\.bz-departement \{ flex: 1; min-inline-size: 0; \}/);
  assert.match(css, /\.bz-planning__semaine \{[^}]*min-inline-size: 0;/);
  assert.match(css, /\.bz-anneau__sur \{[^}]*font-size: var\(--bz-t-micro\)/, '« sur 100 » à 13 px au toucher');
  const app = lire('web/app.js');
  assert.match(app, /cadreOnglets\(h\('div', \{ class: 'bz-onglets', role: 'tablist'/);
  assert.doesNotMatch(app.slice(app.indexOf('const blocDomaines'), app.indexOf('const blocChiffres')), /bz-visuellement-cache', texte: r\.score/, 'plus de texte masqué en position absolue dans les onglets');
});

test('sombre : sur une surface élevée, un composant garde sa forme (jamais la couleur de la surface)', () => {
  const j = lireJetons(lire('web/bz/tokens.css'));
  assert.equal(j.sombre.get('--bz-surface-elevee'), 'var(--bz-granit-3)', 'constat du contrôle qualité : la surface élevée vaut --bz-composant');
  const css = lire('web/bz/composants.css');
  const regle = /:root\[data-theme="sombre"\] :is\(([^)]+)\) \{\s*--bz-composant: var\(--bz-granit-5\);/.exec(css);
  assert.ok(regle, 'paliers relevés sur les surfaces élevées');
  for (const s of ['.bz-fiche', '.bz-dialogue', '.bz-popover', '.bz-menu', '.bz-palette', '.bz-feuille']) assert.ok(regle[1]?.includes(s), s);
  assert.ok(j.sombre.get('--bz-granit-5') && j.sombre.get('--bz-granit-5') !== j.sombre.get('--bz-granit-3'));
});

test('une vue, un bouton principal : carte avec la carte héros, Mettre en ligne étape 2, avis réseau faible', () => {
  const app = lire('web/app.js');
  assert.match(app, /class: `bz-bouton \$\{herosPrincipal \? 'bz-bouton--secondaire' : 'bz-bouton--principal'\}`, cle: 'hud-connecter'/);
  assert.match(app, /rendre, \{ principal: false \}\)\);/, 'export de Mettre en ligne en secondaire');
  assert.match(app, /class: 'bz-bouton bz-bouton--secondaire', cle: 'charger-3d'/);
});

test('fiche courrier, textes et dates : état réel, « Objet », valeurs en casse de phrase, dates « 7 nov. »', () => {
  const app = lire('web/app.js');
  assert.match(app, /if \(o\.type === 'courrier'\) \{/);
  assert.match(app, /'Urgent · à traiter'/);
  assert.match(app, /libelle: o\.type === 'courrier' \? 'Objet' : 'Nom'/);
  assert.match(app, /if \(c\.type === 'choix' && typeof c\.valeur === 'string'\) return casseDePhrase\(c\.valeur\);/);
  assert.match(app, /'Personne n’est prévu\.'/);
  assert.doesNotMatch(app, /Personne de prévu|Des pistes automatisables/);
  assert.doesNotMatch(app, /toLocaleString\('fr-FR', \{ dateStyle: 'short', timeStyle: 'short' \}\)/, 'plus de « 10/11/2026 23:47 » dans le texte');
  assert.match(lire('univers/generique.json'), /"Nº de département"/);
  assert.match(app, /else if \(ATTRIBUTS_TYPO\.has\(k\) && !brutAttributs\)/, 'placeholder d’une zone de texte typographié');
});

test('écrans d’entrée : titre de l’onglet avec l’endossement, ouverture en haut de page', () => {
  const app = lire('web/app.js');
  assert.match(app, /document\.title = typo\(`\$\{titre\} · \$\{MARQUE\.endossement\(MARQUE\.jeu\)\}`\);/);
  assert.match(app, /champ\.focus\(\{ preventScroll: true \}\)/);
  assert.doesNotMatch(lire('web/bz/composants.css'), /\.bz-entree__marque \{ position: sticky;/, 'le fond du panneau suit toute la hauteur');
});

/** Code sans ses commentaires : les blocs deviennent des blancs, les lignes de commentaire disparaissent (« https:// » reste). */
const sansCommentaires = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, (b) => b.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

test('vocabulaire : l’interface dit « Living Business », jamais « le jeu » (G14)', () => {
  // Hors des textes lus par l’entreprise : chemins de modules, adresses, identifiants, et « en jeu » (ce qui est en cause).
  const technique = /installer-jeu\.sh|breizh-eco-jeu|\/jeu\.js|alertes-adresse-jeu|demo:jeu|MARQUE\.jeu|jeu\.(mondomaine|monentreprise|menuiserie|kerlann)/;
  const interdit = /\b(le|Le|du|Du|au|Au|un|Un|ce|Ce|votre|Votre|notre|Notre) jeu\b/;
  const fichiers = [
    'web/app.js', 'web/suivi.js', 'web/reglages.js', 'web/aujourdhui.js', 'web/connecter.js', 'web/simplicite.js',
    'web/navigation.js', 'web/reseau.js', 'web/courrier.js', 'web/jeu.js',
    'src/passerelle/http.ts', 'src/passerelle/alertes.ts', 'src/passerelle/monde.ts', 'src/passerelle/sources.ts',
    'src/passerelle/miroir.ts', 'src/passerelle/lien-nexus.ts', 'src/passerelle/sources-microsoft.ts',
    'src/passerelle/automatisations.ts', 'src/core/sante.ts', 'src/core/optimisations.ts',
  ];
  const restes: string[] = [];
  for (const f of fichiers) {
    sansCommentaires(lire(f)).split('\n').forEach((ligne, i) => {
      const chaines = ligne.match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g) ?? [];
      for (const s of chaines) if (interdit.test(s) && !technique.test(s)) restes.push(`${f}:${i + 1} ${s.slice(0, 90)}`);
    });
  }
  assert.deepEqual(restes, [], 'une entreprise qui tient sa comptabilité ici ne lit pas « le jeu »');
  // et les textes refaits disent bien le nom du produit
  const app = lire('web/app.js');
  assert.match(app, /lecture: 'De l’outil vers Living Business', deux: 'Dans les deux sens', ecriture: 'De Living Business vers l’outil'/);
  assert.match(app, /'À quoi ça correspond dans Living Business \?'/);
  assert.match(lire('src/passerelle/monde.ts'), /libelle: 'Créée dans Living Business'/);
});
