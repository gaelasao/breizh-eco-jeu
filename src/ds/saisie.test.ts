/**
 * Écran « Saisir » : la photo d'un justificatif en deux gestes, et la note tapée ou dictée.
 * Le module pur `web/saisie.js` (que dire, que refuser) et son écran dans `web/app.js`. Deux exigences tenues ici :
 * - les règles sont les MÊMES qu'au serveur (`src/passerelle/justificatifs.ts`, `src/core/saisie-terrain.ts`) :
 *   ce qui est refusé à l'écran est refusé là-bas, et un refus annoncé n'est jamais démenti ;
 * - aucune photo n'est jamais affichée dans une liste, et rien ne lit l'image : ni ici, ni au serveur.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ENTETES_COMPTABLES, exportComptable, poids, TAILLE_MAX, type VueJustificatif } from '../passerelle/justificatifs.ts';
import { titreDeNote } from '../core/saisie-terrain.ts';

const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const lire = (f: string) => readFileSync(RACINE + f, 'utf8');
const S = (await import(new URL('../../web/saisie.js', import.meta.url).href)) as {
  TYPES_PHOTO: readonly string[]; EXTENSIONS_PHOTO: readonly string[]; TAILLE_MAX: number; ENTETES_COMPTABLES: readonly string[];
  poids: (o: number) => string;
  problemePhoto: (f: unknown) => string | null;
  dicteeDisponible: (f?: unknown) => boolean;
  reconnaissance: (f?: unknown) => unknown;
  messageDictee: (code: string) => string;
  titreDeNote: (t: unknown) => string;
  champsProposes: (l: unknown[], o?: { concerne?: string | null; aujourdhui?: string }) => { montant: string; date: string; fournisseur: string };
  champsAvecProposition: (j: unknown, o?: { aujourdhui?: string }) => Record<string, unknown>;
  manque: (j: unknown) => string;
  resume: (j: unknown, o?: { date?: (x: string) => string }) => string;
  etatPlace: (p: unknown) => { ton: string; texte: string; conseil: string } | null;
  lignesComptables: (l: unknown[], o?: { debut?: string | null; fin?: string | null }) => { entetes: readonly string[]; lignes: string[][]; aCompleter: number; total: number };
};

const fichier = (nom: string, type: string, size: number) => ({ name: nom, type, size });

test('photo : ce qui est refusé à l’écran est refusé au serveur, et le refus dit quoi faire', () => {
  assert.equal(S.TAILLE_MAX, TAILLE_MAX, 'la même limite des deux côtés');
  assert.equal(S.problemePhoto(fichier('IMG_0421.jpg', 'image/jpeg', 2_400_000)), null, 'une photo de téléphone passe');
  assert.equal(S.problemePhoto(fichier('IMG_0421.HEIC', 'image/heic', 1_900_000)), null, 'une photo d’iPhone aussi');
  // certains Android n'annoncent aucun type : l'extension sert alors de repère, et le serveur relit les octets
  assert.equal(S.problemePhoto(fichier('photo.webp', '', 900_000)), null);
  assert.match(S.problemePhoto(fichier('facture.pdf', 'application/pdf', 300_000)) ?? '', /n’est pas une photo \(JPEG, PNG, WebP ou HEIC seulement\)/);
  assert.match(S.problemePhoto(fichier('facture.pdf', 'application/pdf', 300_000)) ?? '', /appareil du téléphone/, 'le refus dit quoi faire');
  assert.match(S.problemePhoto(fichier('devis.docx', '', 1000)) ?? '', /n’est pas une photo/);
  assert.match(S.problemePhoto(fichier('IMG.jpg', 'image/jpeg', 14_000_000)) ?? '', /^Photo trop lourde : 14,0 Mo, alors que le maximum est 12,0 Mo\./);
  assert.match(S.problemePhoto(fichier('IMG.jpg', 'image/jpeg', 14_000_000)) ?? '', /qualité normale/);
  assert.match(S.problemePhoto(fichier('IMG.jpg', 'image/jpeg', 0)) ?? '', /Photo vide/);
  assert.match(S.problemePhoto(null) ?? '', /Photographier/);
  assert.equal(S.poids(2_400_000), '2,4 Mo');
  assert.equal(S.poids(420_000), poids(420_000));
  assert.equal(S.poids(2_000_000_000), poids(2_000_000_000), 'le même poids dit des deux côtés');
  // le champ de fichier accepte exactement ces types-là
  assert.deepEqual([...S.TYPES_PHOTO], ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
});

test('dictée : absente du navigateur, le bouton n’existe pas et le champ de texte suffit', () => {
  assert.equal(S.dicteeDisponible({}), false, 'Firefox : aucune reconnaissance vocale');
  assert.equal(S.reconnaissance({}), null);
  const faux = function Reco() { /* constructeur simulé */ };
  assert.equal(S.dicteeDisponible({ SpeechRecognition: faux }), true);
  assert.equal(S.dicteeDisponible({ webkitSpeechRecognition: faux }), true, 'Chrome et Safari : préfixé');
  assert.equal(S.reconnaissance({ webkitSpeechRecognition: faux }), faux);
  // chaque arrêt de la dictée se dit en clair, et renvoie toujours vers le champ de texte
  for (const code of ['not-allowed', 'service-not-allowed', 'no-speech', 'audio-capture', 'network', 'inconnu']) {
    const m = S.messageDictee(code);
    assert.match(m, /\p{Lu}.*\.$/su, code);
    assert.doesNotMatch(m, /micro\b.*autoris.*navigateur.*API|SpeechRecognition|permission policy/i, `${code} : sans jargon`);
  }
  assert.match(S.messageDictee('no-speech'), /tapez la note/);
  assert.equal(S.messageDictee('aborted'), '', 'arrêtée par la personne : rien à dire');
  // l'écran : le bouton de dictée n'est dessiné que si le navigateur sait le faire
  const app = lire('web/app.js');
  assert.match(app, /const dicteeLa = SAISIE\.dicteeDisponible\(window\);/);
  assert.match(app, /dicteeLa \? h\('button', \{ type: 'button', class: 'bz-bouton bz-bouton--secondaire', cle: 'saisie-dictee'/);
  assert.match(app, /r\.lang = 'fr-FR';/);
  assert.match(app, /r\.interimResults = false;/, 'le texte arrive quand la phrase est finie');
  // le micro est ouvert à la page elle-même, et à elle seule ; la caméra reste fermée (c'est le téléphone qui photographie)
  assert.match(lire('src/passerelle/http.ts'), /'permissions-policy': 'camera=\(\), microphone=\(self\), geolocation=\(\), payment=\(\), usb=\(\)'/);
});

test('note : le même intitulé qu’au serveur, majuscule comprise', () => {
  for (const essai of ['  reprendre   les joints\nde la salle de bain ', 'éclairage à revoir', '', '   ', 'a‮b', 'x'.repeat(400)]) {
    assert.equal(S.titreDeNote(essai), titreDeNote(essai), JSON.stringify(essai.slice(0, 20)));
  }
  assert.equal(S.titreDeNote('poser les plinthes'), 'Poser les plinthes', 'la dictée ne met pas de majuscule, l’écran si');
});

test('trois champs : pré-remplis de ce qu’on sait SANS RIEN LIRE, et modifiables', () => {
  const j = (x: Record<string, unknown>) => ({ id: 'jt-1', le: '2026-11-10T08:00:00Z', concerne: null, montant: null, date: null, fournisseur: '', propose: null, ...x });
  const liste = [j({ id: 'a', concerne: 'ch-1', fournisseur: 'Point P', le: '2026-11-10T08:00:00Z' }), j({ id: 'b', concerne: 'ch-1', fournisseur: 'Chausson', le: '2026-11-14T08:00:00Z' })];
  const p = S.champsProposes(liste, { concerne: 'ch-1', aujourdhui: '2026-11-16' });
  assert.equal(p.date, '2026-11-16', 'la date du jour');
  assert.equal(p.fournisseur, 'Chausson', 'le dernier fournisseur de CE chantier');
  assert.equal(p.montant, '', 'le montant ne se devine pas : personne ne l’invente');
  assert.equal(S.champsProposes([], { aujourdhui: '2026-11-16' }).fournisseur, '');

  // proposition d'un agent de l'entreprise : elle remplit les champs vides, jamais une valeur enregistrée
  const avec = S.champsAvecProposition(j({ montant: 128.4, propose: { montant: 99, date: '2026-11-02', fournisseur: 'Station', par: 'votre agent' } }), { aujourdhui: '2026-11-16' });
  assert.equal(avec.montant, '128,40', 'ce qui est enregistré l’emporte, avec ses centimes');
  assert.equal(avec.montantDe, 'moi');
  assert.equal(avec.date, '2026-11-02');
  assert.equal(avec.dateDe, 'agent', 'l’écran dit d’où vient la valeur');
  assert.equal(avec.fournisseurDe, 'agent');
  const sans = S.champsAvecProposition(j({}), { aujourdhui: '2026-11-16' });
  assert.equal(sans.date, '2026-11-16');
  assert.equal(sans.dateDe, 'rien');
  // ce qui manque est nommé, en français
  assert.equal(S.manque(j({})), 'montant, date et fournisseur');
  assert.equal(S.manque(j({ date: '2026-11-16' })), 'montant et fournisseur');
  assert.equal(S.manque(j({ montant: 12, date: '2026-11-16' })), 'fournisseur');
  assert.equal(S.manque(j({ montant: 12, date: '2026-11-16', fournisseur: 'Point P' })), '');
  assert.match(S.resume(j({})), /^À compléter : montant, date et fournisseur$/);
  assert.match(S.resume(j({ montant: 128.4, date: '2026-11-16', fournisseur: 'Point P' })), /^128,40 € · Point P · 2026-11-16$/);
});

test('place prise par les photos : dite en mégaoctets, et annoncée AVANT d’être bloquante', () => {
  assert.equal(S.etatPlace(null), null);
  const petit = S.etatPlace({ nombre: 3, octets: 7_400_000, max: 2_000_000_000, presque: false });
  assert.equal(petit?.ton, 'info');
  assert.equal(petit?.texte, '3 photos · 7,4 Mo sur 2,0 Go');
  assert.equal(petit?.conseil, '', 'rien à dire tant qu’il y a de la place');
  const bientot = S.etatPlace({ nombre: 600, octets: 1_700_000_000, max: 2_000_000_000, presque: true });
  assert.equal(bientot?.ton, 'attention');
  assert.match(bientot?.conseil ?? '', /^Bientôt plein : exportez les justificatifs pour votre comptable, puis retirez les plus anciens\.$/);
  const plein = S.etatPlace({ nombre: 700, octets: 2_000_000_000, max: 2_000_000_000, presque: true });
  assert.equal(plein?.ton, 'critique');
  assert.match(plein?.conseil ?? '', /Aucune nouvelle photo ne sera enregistrée/);
  assert.equal(S.etatPlace({ nombre: 1, octets: 1000, max: 2_000_000_000, presque: false })?.texte, '1 photo · 1 ko sur 2,0 Go');
});

test('ce qui part au comptable : les mêmes lignes qu’au serveur, avec le nom du fichier photo', () => {
  const brut = (x: Partial<VueJustificatif>): VueJustificatif => ({
    id: 'jt-000000000000000001', le: '2026-11-16T08:00:00Z', mime: 'image/jpeg', ext: 'jpg', octets: 1000, concerne: null,
    montant: null, date: null, fournisseur: '', propose: null, par: 'p', concerneNom: null, complet: false, ...x,
  });
  const liste = [
    brut({ id: 'jt-00000000000000000a', montant: 128.4, date: '2026-11-16', fournisseur: 'Point P', concerneNom: 'Chantier Kerlann', complet: true }),
    brut({ id: 'jt-00000000000000000b', montant: 9.9, date: '2026-10-02', fournisseur: 'Station', complet: true }),
    brut({ id: 'jt-00000000000000000c', date: '2026-11-01' }),
  ];
  const ici = S.lignesComptables(liste);
  const serveur = exportComptable(liste);
  assert.deepEqual([...S.ENTETES_COMPTABLES], [...ENTETES_COMPTABLES], 'les mêmes colonnes');
  assert.deepEqual(ici.lignes, serveur.lignes, 'l’écran et le serveur écrivent la même chose');
  assert.equal(ici.aCompleter, 1);
  assert.equal(ici.total, 138.3);
  assert.deepEqual(ici.lignes[0], ['2026-10-02', 'Station', '9,90', '', 'jt-00000000000000000b.jpg', 'jt-00000000000000000b']);
  assert.deepEqual(S.lignesComptables(liste, { debut: '2026-11-01' }).lignes.map((l) => l[1]), ['Point P']);
  // le fichier téléchargé passe par le même CSV que les autres listes (séparateur « ; », rien d’exécutable)
  assert.match(lire('web/app.js'), /telecharger\('justificatifs\.csv', texteCsv\(\[r\.entetes, \.\.\.r\.lignes\]\)\)/);
});

test('écran « Saisir » : l’appareil photo du téléphone, deux gestes, et aucune photo dans une liste', () => {
  const app = lire('web/app.js');
  const ecran = app.slice(app.indexOf('async function rendreSaisie()'), app.indexOf('/** Envoie la photo,'));
  assert.ok(ecran.length > 1000, 'l’écran est bien là');
  // le bouton ouvre l'appareil photo arrière du téléphone, sans aucune dépendance
  assert.match(ecran, /h\('input', \{ type: 'file', accept: 'image\/\*', capture: 'environment'/);
  assert.match(ecran, /icone\(S\.envoi \? 'loader-circle' : 'camera'\)/);
  assert.match(ecran, /Photographier un justificatif/);
  // la promesse, dite à l'écran, sans jargon
  assert.match(ecran, /rangée sur cet ordinateur, rattachée à ce chantier, et reprise dans ce qui part au comptable/);
  assert.match(ecran, /Elle ne part nulle part ailleurs/);
  // la liste ne montre jamais la photo : plusieurs mégaoctets par ligne sur des données mobiles
  assert.doesNotMatch(ecran, /h\('img'/, 'aucune image dans la liste des justificatifs');
  assert.match(app, /h\('img', \{ class: 'bz-justificatif__photo', src: `\/api\/v1\/justificatifs\/\$\{j\.id\}\/photo`/, 'la photo n’est demandée que dans la fenêtre');
  assert.match(app, /etat\.photo\s*$/m);
  assert.match(app, /Revoir la photo \(\$\{SAISIE\.poids\(j\.octets\)\}\)/, 'son poids est dit avant de la télécharger');
  // rien ne lit l'image, ni ici ni au serveur : aucune reconnaissance embarquée, aucun envoi ailleurs
  assert.doesNotMatch(app, /tesseract|\bOCR\b|reconnaissance de caractères|vision\.googleapis|textract/, 'aucune lecture automatique de l’image');
  assert.doesNotMatch(lire('src/passerelle/justificatifs.ts'), /tesseract|\bOCR\b|vision\.googleapis|textract/, 'le serveur ne décode jamais une photo');
  // les trois champs, et le clavier qui va avec sur un téléphone
  assert.match(app, /id: 'jt-montant', class: 'bz-champ__saisie', type: 'text', inputmode: 'decimal'/);
  assert.match(app, /id: 'jt-date', class: 'bz-champ__saisie', type: 'date'/);
  assert.match(app, /id: 'jt-fournisseur', class: 'bz-champ__saisie', type: 'text'/);
  // la note devient une tâche par le même circuit que les autres (préparation, journal, approbation)
  assert.match(app, /capacite: 'tache\.creer', cible, parametres: \{ titre, echeance: null \}, executer: true/);
  // un rendez-vous : un clic, jamais quarante tâches d'un coup
  assert.match(app, /h\('button', \{ type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: \(\) => tacheDepuisRendezVous\(o\.id\) \}, icone\('list-checks'\), 'En faire une tâche'\)/);
  assert.match(lire('src/passerelle/application.ts'), /JAMAIS\n\s*\*\s*automatiquement pour tous les événements/);
  // la photo monte en octets bruts, jamais recopiée en base64 dans du JSON
  assert.match(app, /const octets = corps instanceof Blob;/);
  // l'écran est dans le menu, avec les justificatifs à compléter pour seul compteur (jamais un total)
  assert.match(lire('web/navigation.js'), /\{ id: 'saisir', vue: 'saisie', libelle: 'Saisir', icone: 'camera',\n\s*compte: aCompleter/);
  assert.match(app, /const justificatifsACompleter = \(\) => \(E\.saisie\?\.liste \?\? \[\]\)\.filter\(\(j\) => !j\.complet\)\.length;/);
  // la photo revue à l'écran ne déborde jamais d'un téléphone
  assert.match(lire('web/bz/composants.css'), /\.bz-justificatif__photo \{ display: block; inline-size: 100%; max-block-size: 40vh; object-fit: contain;/);
  // les icônes du geste sont dans le sprite (aucune image à télécharger)
  assert.match(lire('web/bz/icones.txt'), /^camera$/m);
  assert.match(lire('web/bz/icones.txt'), /^mic$/m);
  assert.ok(lire('web/bz/icones.svg').includes('id="i-camera"') && lire('web/bz/icones.svg').includes('id="i-mic"'));
});

test('écran « Saisir » : la photo d’abord, les champs ensuite, et ce qui manque est dit', () => {
  const app = lire('web/app.js');
  const envoi = app.slice(app.indexOf('async function envoyerPhoto(fichier)'), app.indexOf('\n * Le lecteur de justificatifs'));
  // refus local avant de dépenser le réseau du chantier, puis envoi, puis les trois champs tout de suite
  assert.match(envoi, /S\.erreurPhoto = SAISIE\.problemePhoto\(fichier\);/);
  // chaque refus se lit près de ce qu'il concerne (§4.16) : la photo sous son bouton, la note sous le sien
  assert.match(app, /messageEnLigne\(S\.erreurPhoto \? 'critique' : null, S\.erreurPhoto\),/);
  assert.match(app, /messageEnLigne\(S\.erreurNote \? 'critique' : null, S\.erreurNote\)\) : null,/);
  assert.match(envoi, /api\('POST', `\/justificatifs\$\{concerne \? `\?concerne=\$\{encodeURIComponent\(concerne\)\}` : ''\}`, fichier\)/);
  // la photo déjà en mémoire est passée à la fenêtre : montrée à côté des champs, et lue sur l'appareil
  assert.match(envoi, /ouvrirJustificatif\(j, \{ neuf: true, fichier \}\)/, 'les trois champs s’ouvrent sur la photo qui vient d’être prise');
  // rien n'est enregistré sans la personne : la proposition d'un agent est montrée, puis validée à la main
  assert.match(app, /Montant, date et fournisseur proposés par \$\{champs\.propose\.par\} après lecture de la photo/);
  assert.match(app, /rien n’est enregistré tant que vous n’avez pas appuyé sur « Enregistrer »/);
  // le second chemin, dit tel quel à l'écran : l'agent de l'entreprise, son abonnement, et rien chez l'éditeur
  assert.match(app, /Vous avez un agent branché sur Living Business \(Réglages › Clés d’API\) \? Vous pouvez lui demander de lire cette photo et de proposer les trois champs\. C’est votre agent et votre abonnement : rien ne part chez l’éditeur, et c’est vous qui enregistrez\./);
  // retirer est définitif, et c'est dit
  assert.match(app, /La photo sera effacée de cet ordinateur, et la ligne ne partira plus au comptable\. C’est définitif\./);
  // l'export dit ce qui reste à compléter au lieu de le taire
  assert.match(app, /Aucun justificatif complet à exporter : renseignez le montant, la date et le fournisseur\./);
});
