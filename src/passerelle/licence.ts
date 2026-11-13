/**
 * Licence de Living Business : logiciel libre sous GNU AGPL version 3 (décision de l'éditeur du 12 novembre 2026).
 * Deux fichiers à la racine, jamais recopiés ailleurs :
 *  - LICENSE : le texte officiel de la licence, en anglais, tel que publié par la Free Software Foundation (seul à
 *    faire foi ; jamais modifié, scripts/logiciel-libre.test.ts en garde l'empreinte) ;
 *  - NOTICE.md : la notice en français (résumé sans valeur juridique, absence de garantie, marques de l'éditeur,
 *    données, services liés, code source).
 * scripts/paquets.ts joint les deux à chaque paquet (à côté de LISEZMOI.txt, et dans app/ pour la passerelle) ; la
 * passerelle sert le texte officiel (/licences/agpl-3.0.txt) et tire de la notice la page /licence.html
 * (statiques.ts), liée depuis les écrans d'entrée, l'Aide, Réglages › À propos et « Licences et crédits ».
 * Utiliser le logiciel ne demande aucune acceptation (article 9 de la licence) : ces pages informent, rien de plus.
 *
 * Forme de NOTICE.md (Markdown simple, lisible tel quel) : premier bloc = « # Titre » puis la date ; blocs séparés par
 * une ligne vide ; un bloc qui commence par « ## N. Intitulé » ouvre un article ; « - » commence un élément de liste
 * (suite indentée de deux espaces) ; les autres lignes se suivent dans un paragraphe (texte coupé à la main pour
 * rester lisible dans un éditeur). Une adresse https:// devient un lien.
 */

/** Texte officiel de la licence (anglais). */
export const FICHIER_LICENCE = 'LICENSE';
/** Notice en français : ce n'est pas une licence, seul LICENSE fait foi. */
export const FICHIER_NOTICE = 'NOTICE.md';
/** Identifiant SPDX de la licence (package.json, nomenclature des paquets). */
export const IDENTIFIANT_LICENCE = 'AGPL-3.0-only';
/**
 * Où trouver le code source correspondant (article 13 de la licence : toute personne qui utilise le logiciel par un
 * réseau doit pouvoir l'obtenir). La même adresse est écrite dans web/app.js, web/licences.html, NOTICE.md et
 * package.json (scripts/logiciel-libre.test.ts vérifie qu'elles s'accordent). Qui diffuse ou met en ligne une version
 * modifiée y met l'adresse du code source de SA version.
 */
export const CODE_SOURCE = 'https://github.com/gaelasao/breizh-eco-jeu';
/** Adresse, dans le jeu, du texte officiel de la licence. */
export const CHEMIN_TEXTE_LICENCE = '/licences/agpl-3.0.txt';

const ECHAPPEMENTS: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const echapper = (t: string) => t.replace(/[&<>"']/g, (c) => ECHAPPEMENTS[c] as string);
/** Texte échappé, adresses https:// rendues cliquables (caractères sûrs seulement, ponctuation finale laissée dehors). */
const avecLiens = (t: string) => echapper(t).replace(/https:\/\/[A-Za-z0-9._~/#?=%+-]*[A-Za-z0-9_~/#=%+-]/g, (u) => `<a href="${u}" rel="noopener noreferrer">${u}</a>`);
const ARTICLE = /^(?:#{1,6}\s+)?(\d{1,2})\.\s+(\S.*)$/;

/** Paragraphes et listes d'un bloc de lignes (sans l'intitulé d'article). */
function corps(lignes: readonly string[]): string[] {
  const elements: Array<{ liste: boolean; textes: string[] }> = [];
  for (const brute of lignes) {
    const ligne = brute.trimEnd();
    const dernier = elements.at(-1);
    if (ligne.startsWith('- ')) {
      if (dernier?.liste) dernier.textes.push(ligne.slice(2).trim());
      else elements.push({ liste: true, textes: [ligne.slice(2).trim()] });
    } else if (dernier?.liste && /^\s{2}\S/.test(ligne)) {
      dernier.textes.push(`${dernier.textes.pop() ?? ''} ${ligne.trim()}`);
    } else if (dernier && !dernier.liste) {
      dernier.textes.push(ligne.trim());
    } else {
      elements.push({ liste: false, textes: [ligne.trim()] });
    }
  }
  return elements.map((e) => (e.liste ? `<ul>${e.textes.map((x) => `<li>${avecLiens(x)}</li>`).join('')}</ul>` : `<p>${avecLiens(e.textes.join(' '))}</p>`));
}

/** Page HTML (système de design Breizhcosystem, même gabarit que licences.html) tirée du texte de NOTICE.md. */
export function pageNotice(texte: string): string {
  const blocs = texte.replace(/\r\n?/g, '\n').trim().split(/\n[ \t]*\n+/).map((b) => b.split('\n'));
  const [tete = [], ...reste] = blocs;
  const [titre = 'Licence', ...date] = tete.map((l) => l.trim().replace(/^#{1,6}\s+/, ''));
  const intro: string[] = [];
  const articles: Array<{ id: string; titre: string; contenu: string[] }> = [];
  for (const bloc of reste) {
    const m = ARTICLE.exec(bloc[0]?.trim() ?? '');
    if (m) articles.push({ id: `article-${m[1]}`, titre: `${m[1]}. ${m[2]}`, contenu: corps(bloc.slice(1)) });
    else (articles.at(-1)?.contenu ?? intro).push(...corps(bloc));
  }
  const sections = articles.map((a) => `    <section aria-labelledby="${a.id}">\n      <h2 id="${a.id}" class="bz-t-titre-3">${echapper(a.titre)}</h2>\n      ${a.contenu.join('\n      ')}\n    </section>`);
  return `<!doctype html>
<html lang="fr" data-theme="clair">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="color-scheme" content="light dark">
  <meta name="theme-color" content="#f9f6f2" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#091115" media="(prefers-color-scheme: dark)">
  <title>Licence · Living Business</title>
  <script src="/bz/theme.js"></script>
  <link rel="stylesheet" href="/bz/bz.css">
  <link rel="icon" type="image/png" sizes="192x192" href="/icone-192.png">
</head>
<body>
  <a class="bz-evitement" href="#contenu">Aller au contenu</a>
  <main id="contenu" class="bz-page" tabindex="-1">
    <a class="bz-page__marque" href="/"><img src="/icone-192.png" alt="" width="28" height="28">Living Business</a>
    <header>
      <p class="bz-t-surtitre">Living Business par Breizhcosystem</p>
      <h1 class="bz-t-titre-1">${echapper(titre)}</h1>
      ${date.length ? `<p class="bz-texte-2">${echapper(date.join(' '))}</p>` : ''}
      ${intro.map((p) => p.replace(/^<p>/, '<p class="bz-t-chapeau bz-texte-2">')).join('\n      ')}
    </header>

${sections.join('\n\n')}

    <section aria-labelledby="t-autres">
      <h2 id="t-autres" class="bz-t-titre-3">Voir aussi</h2>
      <ul>
        <li><a href="${CHEMIN_TEXTE_LICENCE}">Texte de la licence GNU AGPL version 3</a> (en anglais, seul à faire foi)</li>
        <li><a href="${CODE_SOURCE}" rel="noopener noreferrer">Code source (AGPL v3)</a></li>
        <li><a href="/licences.html">Licences et crédits</a> : les composants libres embarqués et leurs licences</li>
      </ul>
    </section>
  </main>
</body>
</html>
`;
}
