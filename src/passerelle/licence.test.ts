/**
 * Licence de Living Business (logiciel libre, GNU AGPL version 3) côté jeu : NOTICE.md, la notice en français, mise
 * en page à /licence.html ; LICENSE, le texte officiel, servi tel quel ; aucune acceptation demandée à l'installation
 * (article 9 de la licence) ; liens depuis les écrans d'entrée, l'Aide, Réglages › À propos, la palette et « Licences
 * et crédits ». Texte officiel, identifiant, lien vers le code source et paquets : scripts/logiciel-libre.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Application } from './application.ts';
import { creerServeur } from './http.ts';
import { CHEMIN_TEXTE_LICENCE, CODE_SOURCE, FICHIER_LICENCE, FICHIER_NOTICE, IDENTIFIANT_LICENCE, pageNotice } from './licence.ts';
import { fichiersStatiques } from './statiques.ts';

const lire = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const { typo } = (await import(new URL('../../web/bz/typo.js', import.meta.url).href)) as { typo: (t: string) => string };
/** Espaces de toute sorte (fines et insécables comprises) réduites à une espace simple. */
const plat = (t: string) => t.replace(/\s+/g, ' ').trim();
const ENTITES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
/** Texte lu d'une page : balises remplacées par une espace, entités décodées. */
const texteHtml = (html: string) => plat(html.replace(/<[^>]+>/g, ' ').replace(/&(?:amp|lt|gt|quot|#39);/g, (e) => ENTITES[e] as string));
/** Texte de la notice sans ses marques de mise en forme (« # », « ## », « - »). */
const sansMarques = (texte: string) => plat(texte.split('\n').map((l) => l.replace(/^#{1,6} /, '').replace(/^- /, '')).join(' '));

test('notice : résumé en français sans valeur juridique, aucune restriction ajoutée, rien d’inventé', () => {
  assert.equal(FICHIER_LICENCE, 'LICENSE');
  assert.equal(FICHIER_NOTICE, 'NOTICE.md');
  assert.equal(IDENTIFIANT_LICENCE, 'AGPL-3.0-only');
  const texte = lire(FICHIER_NOTICE);
  const lignes = texte.split('\n');
  assert.equal(lignes[0], '# Living Business est un logiciel libre');
  assert.match(lignes[1] ?? '', /^Notice du \d{1,2} [a-zéû]+ \d{4}$/, 'date de la notice');
  // articles numérotés à la suite
  const articles = lignes.filter((l) => /^## \d{1,2}\. \S/.test(l)).map((l) => Number(l.slice(3).split('.')[0]));
  assert.ok(articles.length >= 6);
  assert.deepEqual(articles, articles.map((_, i) => i + 1));
  const t = plat(texte);
  for (const clause of [
    /logiciel libre, distribué sous la licence publique générale GNU Affero, version 3 seulement \(GNU AGPL v3, identifiant « AGPL-3\.0-only »\)/,
    /n’a pas de valeur juridique : seul le texte anglais de la licence, dans le fichier LICENSE, fait foi/,
    /Copyright \(C\) \d{4} Breizhcosystem\./,
    /page « Mentions légales » de Breizhcosystem/, // identité de l'éditeur : renvoi, jamais inventée
    // ce que la licence permet et demande
    /utiliser Living Business pour tout usage/, /étudier son fonctionnement et le modifier/, /redistribuer des copies, modifiées ou non, gratuitement ou non/,
    /ne demande aucune acceptation \(article 9 de la licence\)/,
    /vous le faites sous la même licence/, /Vous n’ajoutez aucune restriction\./,
    /vous leur proposez le code source de votre version, gratuitement \(article 13\)/,
    // absence de garantie, dans les limites de la loi : rien de plus que la licence
    /fourni « en l’état », sans aucune garantie, dans les limites permises par la loi \(articles 15 à 17 de la licence\)/,
    /sauf lorsque la loi l’impose ou qu’ils s’y sont engagés par écrit/,
    /garanties et les responsabilités que la loi impose sans permettre de les écarter restent applicables/,
    /ni des conseils comptables, fiscaux, juridiques ou financiers, ni des décisions/,
    // terme additionnel (article 7, point e) : marques de l'éditeur
    /noms « Breizhcosystem » et « Living Business » et le symbole « Moucheture » restent des marques de l’éditeur/,
    /terme additionnel, permis par son article 7, point e\)/,
    /additional term under section 7\(e\) of the GNU Affero General Public License version 3: this License does not grant any rights under trademark law/,
    /LICENCES-TIERS\.md/, // composants tiers sous leur propre licence
    /enregistre vos données chez vous/, /ne lui envoie ni vos données, ni mesure de votre utilisation/,
    /sont des services distincts : la licence de Living Business ne les couvre pas\. Chacun a ses propres conditions/,
    /https:\/\/www\.gnu\.org\/licenses\/agpl-3\.0\.html/,
  ]) assert.match(t, clause);
  assert.ok(t.includes(CODE_SOURCE), 'où trouver le code source');
  // plus rien de la licence d'utilisation d'avant : ni restriction d'usage, de copie, de modification ou de
  // redistribution, ni acceptation, ni garantie promise au-delà de la licence, ni clause de droit applicable
  assert.doesNotMatch(t, /ne pouvez pas|non cessible|non exclusif|accord écrit de l’éditeur|Vous acceptez|n’utilisez pas le logiciel|pour les besoins de votre entreprise|seule source|mise en demeure|droit français|L’éditeur garantit|L’éditeur répond/i);
  assert.doesNotMatch(t, /interdit|réservé à|usage (interne|professionnel|non commercial)/i);
  // aucune information légale inventée ni champ à remplir : ni SIREN, ni adresse, ni e-mail, ni crochet
  assert.doesNotMatch(texte, /\[|\]|@|\b\d{9}\b|\b\d{3} \d{3} \d{3}\b|\b\d{5}\b|SIRE[NT]|à fournir|à compléter/i);
  // typographie française déjà appliquée (espaces fines et insécables, apostrophes), lignes lisibles dans un éditeur
  for (const l of lignes) {
    assert.equal(typo(l), l, `typographie : « ${l.slice(0, 50)} »`);
    assert.ok(l.length <= 120, `ligne de ${l.length} caractères`);
  }
});

test('page /licence.html : tirée de NOTICE.md (même texte), échappée, gabarit Breizhcosystem', () => {
  const f = fichiersStatiques().get('/licence.html');
  assert.ok(f, '/licence.html servie');
  assert.equal(f.type, 'text/html; charset=utf-8');
  assert.equal(f.cache, 'no-cache');
  const html = f.contenu.toString('utf8');
  const texte = lire(FICHIER_NOTICE);
  // même texte, mot pour mot : la page ne peut pas diverger du fichier joint aux paquets
  const page = texteHtml(html.slice(html.indexOf('<h1'), html.indexOf('<section aria-labelledby="t-autres"')));
  assert.equal(page, sansMarques(texte));
  for (const l of texte.split('\n').filter((x) => /^## \d{1,2}\. \S/.test(x))) {
    const intitule = l.slice(3);
    const n = intitule.split('.')[0];
    assert.ok(html.includes(`<section aria-labelledby="article-${n}">\n      <h2 id="article-${n}" class="bz-t-titre-3">${intitule}</h2>`), `article ${n} en titre de niveau 2`);
  }
  assert.match(html, /<h1 class="bz-t-titre-1">Living Business est un logiciel libre<\/h1>\s*<p class="bz-texte-2">Notice du /, 'titre sans « # », puis la date');
  assert.match(html, /<ul><li>utiliser Living Business pour tout usage/, 'listes rendues en listes');
  assert.ok(html.includes(`<a href="${CODE_SOURCE}" rel="noopener noreferrer">${CODE_SOURCE}</a>`), 'adresse du code source cliquable dans le texte');
  assert.match(html, /<html lang="fr" data-theme="clair">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/, 'lisible sur téléphone');
  assert.match(html, /<title>Licence · Living Business<\/title>/);
  assert.match(html, /<script src="\/bz\/theme\.js"><\/script>\s*<link rel="stylesheet" href="\/bz\/bz\.css">/);
  assert.match(html, /<a class="bz-evitement" href="#contenu">Aller au contenu<\/a>/);
  assert.equal((html.match(/<script/g) ?? []).length, 1, 'aucun script en ligne (CSP)');
  assert.doesNotMatch(html, / style=/, 'aucun style en ligne (CSP)');
  // « Voir aussi » : texte officiel, code source, composants tiers
  const voirAussi = html.slice(html.indexOf('<section aria-labelledby="t-autres"'));
  assert.ok(voirAussi.includes(`<a href="${CHEMIN_TEXTE_LICENCE}">Texte de la licence GNU AGPL version 3</a> (en anglais, seul à faire foi)`));
  assert.ok(voirAussi.includes(`<a href="${CODE_SOURCE}" rel="noopener noreferrer">Code source (AGPL v3)</a>`));
  assert.match(voirAussi, /<a href="\/licences\.html">Licences et crédits<\/a>/);
});

test('page de la notice : texte échappé, listes et paragraphes, fins de ligne Windows, adresses https en liens', () => {
  const html = pageNotice('# Titre <b>\r\nNotice du 1 mai 2027\r\n\r\nIntro & suite\r\nsur deux lignes.\r\n\r\n## 1. Premier « article »\r\n\r\nAvant :\r\n\r\n- un <script>alert(1)</script>\r\n  qui continue ;\r\n- deux.\r\n\r\nAprès la liste.\r\n\r\nSuite du même article : https://exemple.test/a-b_c/d.html. Puis https://exemple.test/x"onmouseover="y et javascript:alert(1).\r\n\r\n2. Second, sans « ## »\r\nFin.\r\n');
  assert.ok(html.includes('<h1 class="bz-t-titre-1">Titre &lt;b&gt;</h1>'));
  assert.ok(html.includes('<p class="bz-texte-2">Notice du 1 mai 2027</p>'));
  assert.ok(html.includes('<p class="bz-t-chapeau bz-texte-2">Intro &amp; suite sur deux lignes.</p>'));
  assert.ok(html.includes('<h2 id="article-1" class="bz-t-titre-3">1. Premier « article »</h2>'));
  assert.ok(html.includes('<p>Avant :</p>\n      <ul><li>un &lt;script&gt;alert(1)&lt;/script&gt; qui continue ;</li><li>deux.</li></ul>\n      <p>Après la liste.</p>'));
  // adresses : seulement https, caractères sûrs, point final et guillemet laissés dehors ; rien d'autre ne devient un lien
  assert.ok(html.includes('Suite du même article : <a href="https://exemple.test/a-b_c/d.html" rel="noopener noreferrer">https://exemple.test/a-b_c/d.html</a>. Puis '));
  assert.ok(html.includes('<a href="https://exemple.test/x" rel="noopener noreferrer">https://exemple.test/x</a>&quot;onmouseover=&quot;y et javascript:alert(1).'));
  assert.doesNotMatch(html, /href="javascript:|onmouseover="/);
  assert.ok(html.includes('<h2 id="article-2" class="bz-t-titre-3">2. Second, sans « ## »</h2>\n      <p>Fin.</p>'));
  assert.doesNotMatch(html, /<script>alert/, 'aucune balise venue du texte');
  assert.doesNotMatch(html, /\r/);
});

test('aucune acceptation demandée : l’installation informe ; écrans d’entrée, Aide, À propos, palette et « Licences et crédits » mènent à la licence et au code source', () => {
  const app = lire('web/app.js');
  // même adresse du code source côté navigateur et côté serveur, même libellé partout
  assert.ok(app.includes(`const CODE_SOURCE = '${CODE_SOURCE}';`), 'adresse du code source dans web/app.js');
  assert.ok(app.includes("const LIBELLE_CODE_SOURCE = 'Code source (AGPL v3)';"));
  // écran d'installation : une information avant « Créer mon entreprise », plus aucune acceptation (article 9)
  const securite = app.slice(app.indexOf('const formulaireSecurite = () =>'), app.indexOf('const rendre = () =>', app.indexOf('const formulaireSecurite = () =>')));
  const mention = securite.indexOf("id: 'mention-licence' }, 'Living Business est un '");
  assert.ok(mention > 0, 'mention d’information sur l’étape finale de l’installation');
  assert.ok(securite.indexOf("h('a', { href: '/licence.html', target: '_blank', rel: 'noopener' }, 'logiciel libre'", mention) > mention, 'lien vers la notice dans la mention');
  assert.ok(securite.indexOf("' (licence GNU AGPL version 3), gratuit et fourni sans garantie.'", mention) > mention);
  assert.ok(mention < securite.indexOf("boutonEntree('Créer mon entreprise'"), 'la mention précède le bouton « Créer mon entreprise »');
  assert.doesNotMatch(app, /vous acceptez|licence d’utilisation|Licence d’utilisation/i, 'plus d’acceptation ni de « licence d’utilisation » dans l’interface');
  // et le serveur n'enregistre ni n'exige rien à ce sujet : une installation existante n'a rien à refaire
  for (const f of ['application.ts', 'comptes.ts', 'http.ts', 'monde.ts', 'en-ligne.ts']) assert.doesNotMatch(lire(`src/passerelle/${f}`), /licen[cs]e/i, `${f} : aucune étape de licence`);
  // pied des écrans d'entrée (avant toute connexion) : licence, code source, crédits
  assert.match(app, /logiciel libre et gratuit, installé chez vous · `,\s*h\('a', \{ href: '\/licence\.html', target: '_blank', rel: 'noopener', texte: 'Licence' \}\), ' · ',\s*h\('a', \{ href: CODE_SOURCE, target: '_blank', rel: 'noopener noreferrer', texte: LIBELLE_CODE_SOURCE \}\), ' · ',\s*h\('a', \{ href: '\/licences\.html'/, 'pied des écrans d’entrée');
  // Aide : toujours au même endroit, pour tous les profils
  const aide = app.slice(app.indexOf('function ouvrirAide() {'), app.indexOf('function rendreBanniere() {'));
  assert.ok(aide.includes("['code-xml', LIBELLE_CODE_SOURCE, ouvrirCodeSource],"), 'Aide › Code source (AGPL v3)');
  assert.ok(app.includes("const ouvrirCodeSource = () => window.open(CODE_SOURCE, '_blank', 'noopener,noreferrer');"));
  // Réglages › À propos : mention de la licence, puis licence, code source, crédits
  assert.ok(app.includes("texte: 'Logiciel libre sous licence GNU AGPL version 3, fourni sans garantie.'"), 'À propos : mention de la licence');
  assert.match(app, /lienExterne\('\/licence\.html', 'Licence de Living Business'\),\s*lienExterne\(CODE_SOURCE, LIBELLE_CODE_SOURCE\),\s*lienExterne\('\/licences\.html', 'Licences et crédits'\)/, 'Réglages › À propos');
  // palette de commandes
  assert.match(app, /\{ id: 'aide:licence', titre: 'Licence de Living Business'[^}]*window\.open\('\/licence\.html'/, 'palette : licence');
  assert.match(app, /\{ id: 'aide:code-source', titre: LIBELLE_CODE_SOURCE, icone: 'code-xml'[^}]*faire: ouvrirCodeSource \}/, 'palette : code source');
  const credits = lire('web/licences.html');
  assert.match(credits, /<h2 id="t-licence" class="bz-t-titre-3">Licence de Living Business<\/h2>[\s\S]*?<a href="\/licence\.html">La licence en bref<\/a>/);
  assert.match(credits, /<strong>Node\.js<\/strong>[^<]*Licence MIT[^<]*OpenSSL, ICU et V8[^<]*app\/LICENCE-NODE\.txt/, 'Node.js crédité, texte de sa licence nommé');
  assert.match(lire('LICENCES-TIERS.md'), /\*\*Node\.js\*\*[\s\S]*?Licence MIT[\s\S]*?OpenSSL, ICU et V8[\s\S]*?`app\/LICENCE-NODE\.txt`/);
});

test('passerelle : notice et texte officiel servis sans session, avec les en-têtes de sécurité', async () => {
  const app = await Application.creer({});
  const serveur: Server = creerServeur(app);
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  try {
    const r = await fetch(`${base}/licence.html`);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.match(r.headers.get('content-security-policy') ?? '', /script-src 'self'/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.match(await r.text(), /<h1 class="bz-t-titre-1">Living Business est un logiciel libre<\/h1>/);
    // le texte officiel : tel quel, en texte brut
    const t = await fetch(`${base}${CHEMIN_TEXTE_LICENCE}`);
    assert.equal(t.status, 200);
    assert.equal(t.headers.get('content-type'), 'text/plain; charset=utf-8');
    assert.equal(t.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(await t.text(), lire(FICHIER_LICENCE), 'octet pour octet le fichier LICENSE');
    // les fichiers de la racine eux-mêmes ne sont pas servis : seules ces deux adresses
    for (const chemin of ['/LICENSE', '/NOTICE.md', '/LICENCE.txt']) assert.equal((await fetch(`${base}${chemin}`)).status, 404, chemin);
  } finally {
    await new Promise<void>((ok) => serveur.close(() => ok()));
  }
});
