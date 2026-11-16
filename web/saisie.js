/* Living Business — saisie sur le terrain : la photo d'un justificatif, et la note (tapée ou dictée).
   Module PUR : aucun accès au DOM, au réseau ni au stockage ; app.js dessine, ce fichier décide quoi dire.
   Testé par src/ds/saisie.test.ts, qui vérifie aussi que les règles sont les mêmes qu'au serveur
   (src/passerelle/justificatifs.ts et src/core/saisie-terrain.ts) : un refus annoncé ici est un refus là-bas. */

/** Types de photo acceptés — les mêmes qu'au serveur, qui les reconnaît dans les octets. */
export const TYPES_PHOTO = Object.freeze(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
/** Extensions admises quand le téléphone n'annonce aucun type (certains Android sur un fichier de la galerie). */
export const EXTENSIONS_PHOTO = Object.freeze(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif']);
/** Photo acceptée au plus : la même valeur qu'au serveur (TAILLE_MAX de src/passerelle/justificatifs.ts). */
export const TAILLE_MAX = 12 * 1_000_000;

/**
 * Poids d'un fichier, dit comme on le dit : « 420 ko », « 2,4 Mo », « 1,7 Go ». La MÊME règle qu'au serveur
 * (`poids` de src/passerelle/justificatifs.ts).
 */
export function poids(octets) {
  const virgule = (x) => x.toFixed(1).replace('.', ',');
  if (octets >= 1_000_000_000) return `${virgule(octets / 1_000_000_000)} Go`;
  if (octets >= 1_000_000) return `${virgule(octets / 1_000_000)} Mo`;
  return `${Math.round(octets / 1000)} ko`;
}

/**
 * Ce qui empêche d'envoyer ce fichier, dit en clair, AVANT de dépenser le réseau du chantier. null = c'est bon.
 * Le serveur revérifie tout : ce contrôle-ci sert à ne pas faire monter 8 Mo pour rien.
 */
export function problemePhoto(fichier) {
  if (!fichier) return 'Aucune photo : appuyez sur « Photographier » et prenez le justificatif.';
  const type = String(fichier.type ?? '').toLowerCase();
  const ext = String(fichier.name ?? '').toLowerCase().split('.').pop();
  const connu = type ? TYPES_PHOTO.includes(type) : EXTENSIONS_PHOTO.includes(ext);
  if (!connu) return 'Ce fichier n’est pas une photo (JPEG, PNG, WebP ou HEIC seulement). Reprenez-la avec l’appareil du téléphone.';
  if (!fichier.size) return 'Photo vide : reprenez-la.';
  if (fichier.size > TAILLE_MAX) return `Photo trop lourde : ${poids(fichier.size)}, alors que le maximum est ${poids(TAILLE_MAX)}. Reprenez-la en qualité normale.`;
  return null;
}

/**
 * La dictée est-elle là ? Chrome, Edge et Safari ont la reconnaissance vocale du navigateur ; Firefox ne l'a pas.
 * Sans elle, le bouton de dictée ne s'affiche pas du tout : le champ de texte reste, et rien ne casse.
 */
export const dicteeDisponible = (fenetre = globalThis) => Boolean(fenetre?.SpeechRecognition || fenetre?.webkitSpeechRecognition);

/** Le constructeur de reconnaissance vocale, ou null. */
export const reconnaissance = (fenetre = globalThis) => fenetre?.SpeechRecognition ?? fenetre?.webkitSpeechRecognition ?? null;

/**
 * Pourquoi la dictée s'est arrêtée, dit à quelqu'un qui a les mains sales. Les codes viennent de l'événement
 * `error` de la reconnaissance vocale.
 */
export function messageDictee(code) {
  return {
    'not-allowed': 'Le micro n’est pas autorisé pour Living Business : autorisez-le dans votre navigateur, ou tapez la note.',
    'service-not-allowed': 'La dictée n’est pas disponible sur cet appareil : tapez la note.',
    'no-speech': 'Rien n’a été entendu : réessayez plus près du téléphone, ou tapez la note.',
    'audio-capture': 'Aucun micro trouvé : tapez la note.',
    network: 'La dictée a besoin du réseau, qui manque ici : tapez la note.',
    aborted: '',
  }[code] ?? 'La dictée s’est arrêtée : tapez la note.';
}

/**
 * Intitulé d'une note tapée ou dictée. MÊME RÈGLE qu'au serveur (`titreDeNote` de src/core/saisie-terrain.ts) :
 * une seule ligne, espaces resserrés, première lettre en majuscule (la dictée n'en met pas), 200 caractères.
 */
export function titreDeNote(texte) {
  const t = String(texte ?? '')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  return t ? t[0].toLocaleUpperCase('fr-FR') + t.slice(1) : '';
}

/**
 * Ce qu'on pré-remplit SANS RIEN LIRE DE LA PHOTO : la date du jour, et le dernier fournisseur saisi pour ce
 * chantier (sinon le dernier saisi tout court). Le montant reste vide : personne ne peut le deviner.
 * Les trois champs restent modifiables : c'est une aide, pas une affirmation.
 */
export function champsProposes(justificatifs, { concerne = null, aujourdhui } = {}) {
  const remplis = (justificatifs ?? []).filter((j) => j && j.fournisseur).slice().sort((a, b) => String(a.le).localeCompare(String(b.le)));
  const ici = concerne ? remplis.filter((j) => j.concerne === concerne) : [];
  const dernier = ici[ici.length - 1] ?? remplis[remplis.length - 1] ?? null;
  return { montant: '', date: aujourdhui ?? '', fournisseur: dernier ? dernier.fournisseur : '' };
}

/**
 * Les champs à montrer pour un justificatif, et D'OÙ VIENT chaque valeur. Dans l'ordre :
 * - « moi » : ce qu'une personne a enregistré. Rien ne le remplace jamais.
 * - « agent » : ce qu'un agent de l'entreprise a proposé par le serveur MCP, à sa demande explicite.
 * - « photo » : ce que la lecture faite SUR L'APPAREIL a trouvé sur la photo (`lu`, web/lecture-photo.js).
 * - « rien » : le champ reste à remplir.
 * L'écran marque toujours la provenance : aucune valeur lue ne doit passer pour une valeur vérifiée.
 */
export function champsAvecProposition(j, { aujourdhui, lu = null } = {}) {
  const p = j?.propose ?? null;
  const vide = (x) => x === null || x === undefined || x === '';
  const pris = (valeur, propose, photo) => (!vide(valeur) ? { valeur, de: 'moi' }
    : !vide(propose) ? { valeur: propose, de: 'agent' }
      : !vide(photo) ? { valeur: photo, de: 'photo' } : { valeur: '', de: 'rien' });
  const montant = pris(j?.montant, p?.montant, lu?.montant);
  const date = pris(j?.date, p?.date, lu?.date);
  const fournisseur = pris(j?.fournisseur, p?.fournisseur, lu?.fournisseur);
  // un montant s'écrit avec ses centimes : « 128,40 », jamais « 128,4 »
  const euros = (x) => (Number.isFinite(Number(x)) ? Number(x).toFixed(2) : String(x)).replace('.', ',');
  return {
    montant: montant.valeur === '' ? '' : euros(montant.valeur),
    montantDe: montant.de,
    // aucune date nulle part : celle du jour, qui est le cas de loin le plus fréquent sur un chantier
    date: date.valeur === '' ? aujourdhui ?? '' : date.valeur,
    dateDe: date.de,
    fournisseur: fournisseur.valeur,
    fournisseurDe: fournisseur.de,
    propose: p,
    lu: lu ?? null,
  };
}

/** Ce qu'on écrit à côté d'un champ pour dire d'où vient sa valeur. Vide pour ce qu'une personne a enregistré. */
export function origineChamp(de) {
  return { photo: 'lu sur la photo', agent: 'proposé par votre agent', moi: '', rien: '' }[de] ?? '';
}

/** Ce qui manque à un justificatif, nommé : « montant et fournisseur ». Vide quand il est complet. */
export function manque(j) {
  const noms = [j?.montant === null || j?.montant === undefined ? 'montant' : null, !j?.date ? 'date' : null, !j?.fournisseur ? 'fournisseur' : null].filter(Boolean);
  if (!noms.length) return '';
  return noms.length === 1 ? noms[0] : `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`;
}

/** Une ligne de liste : « 128,40 € · Point P · 16 nov. », ou ce qui manque. */
export function resume(j, { date = (x) => x } = {}) {
  if (!j) return '';
  const quoi = manque(j);
  if (quoi) return `À compléter : ${quoi}`;
  return `${String(j.montant.toFixed ? j.montant.toFixed(2) : j.montant).replace('.', ',')} € · ${j.fournisseur} · ${date(j.date)}`;
}

/**
 * Place occupée par les photos, dite en mégaoctets, et ce qu'il faut en penser. « presque » vient du serveur :
 * au-delà, une nouvelle photo sera refusée, et l'écran prévient AVANT d'y arriver.
 */
export function etatPlace(place) {
  if (!place) return null;
  const texte = `${place.nombre} photo${place.nombre > 1 ? 's' : ''} · ${poids(place.octets)} sur ${poids(place.max)}`;
  if (place.octets >= place.max) return { ton: 'critique', texte, conseil: 'Plus de place : exportez les justificatifs pour votre comptable, puis retirez les plus anciens. Aucune nouvelle photo ne sera enregistrée tant que la place n’est pas rendue.' };
  if (place.presque) return { ton: 'attention', texte, conseil: 'Bientôt plein : exportez les justificatifs pour votre comptable, puis retirez les plus anciens.' };
  return { ton: 'info', texte, conseil: '' };
}

/** En-têtes du fichier remis au comptable — le même ordre qu'`ENTETES_COMPTABLES` au serveur. */
export const ENTETES_COMPTABLES = Object.freeze(['Date', 'Fournisseur', 'Montant TTC', 'Rattaché à', 'Photo', 'Référence']);

/**
 * Ce qui part au comptable : une ligne par justificatif COMPLET, les plus anciens d'abord, la photo nommée (le
 * fichier à joindre, celui du dossier des données). Un justificatif encore à compléter n'y entre pas, et leur
 * nombre est renvoyé pour que l'écran le dise au lieu de le taire.
 */
export function lignesComptables(justificatifs, { debut = null, fin = null } = {}) {
  const liste = justificatifs ?? [];
  const dans = (j) => (!debut || String(j.date ?? '') >= debut) && (!fin || String(j.date ?? '') <= fin);
  const complets = liste.filter((j) => !manque(j) && dans(j)).slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.le).localeCompare(String(b.le)));
  return {
    entetes: ENTETES_COMPTABLES,
    lignes: complets.map((j) => [
      j.date,
      j.fournisseur,
      (j.montant.toFixed ? j.montant.toFixed(2) : String(j.montant)).replace('.', ','),
      j.concerneNom ?? '',
      `${j.id}.${j.ext}`,
      j.id,
    ]),
    aCompleter: liste.filter((j) => manque(j)).length,
    total: Math.round(complets.reduce((s, j) => s + (Number(j.montant) || 0), 0) * 100) / 100,
  };
}
