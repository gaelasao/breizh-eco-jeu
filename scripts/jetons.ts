/**
 * Lecture des jetons de design/tokens.css et calcul de contraste WCAG 2.x, sans dépendance (outil de test).
 * Recalcul INDÉPENDANT du générateur design/outils/generer-jetons.mjs : on part du texte servi (tokens.css), on résout les
 * var() pour chaque thème, on convertit OKLCH → sRGB (formules d'OKLab, Björn Ottosson) et on mesure les paires.
 */

export type Theme = 'clair' | 'sombre';
export type RGB = [number, number, number]; // sRGB encodé, 0 à 1

/** Déclarations « --bz-… » des règles :root (clair) et :root[data-theme="sombre"] au premier niveau du fichier
 *  (hors @media et @supports, qui sont des variantes : P3, toucher, préférences). */
export function lireJetons(css: string): Record<Theme, Map<string, string>> {
  const sansCommentaires = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const clair = new Map<string, string>();
  const sombre = new Map<string, string>();
  let i = 0;
  let profondeur = 0;
  const pile: string[] = [];
  let selecteur = '';
  while (i < sansCommentaires.length) {
    const c = sansCommentaires[i] as string;
    if (c === '{') {
      pile.push(selecteur.trim());
      profondeur++;
      selecteur = '';
      i++;
      continue;
    }
    if (c === '}') {
      pile.pop();
      profondeur--;
      selecteur = '';
      i++;
      continue;
    }
    if (c === ';') {
      const decl = selecteur.trim();
      const regle = pile.at(-1) ?? '';
      const parents = pile.slice(0, -1);
      const premierNiveau = parents.every((p) => p.startsWith('@layer'));
      const m = /^(--bz-[a-z0-9-]+)\s*:\s*([\s\S]+)$/.exec(decl);
      if (m && premierNiveau) {
        if (regle === ':root') clair.set(m[1] as string, (m[2] as string).trim());
        else if (regle === ':root[data-theme="sombre"]') sombre.set(m[1] as string, (m[2] as string).trim());
      }
      selecteur = '';
      i++;
      continue;
    }
    selecteur += c;
    i++;
  }
  void profondeur;
  // Le thème sombre hérite de toutes les valeurs claires qu'il ne redéfinit pas
  const s = new Map(clair);
  for (const [k, v] of sombre) s.set(k, v);
  return { clair, sombre: s };
}

/** Valeur finale d'un jeton (var() résolus, y compris en chaîne). */
export function resoudre(jetons: Map<string, string>, nom: string, profondeur = 0): string {
  if (profondeur > 20) throw new Error(`Boucle de var() sur ${nom}`);
  const v = jetons.get(nom);
  if (v === undefined) throw new Error(`Jeton absent : ${nom}`);
  return v.replace(/var\((--bz-[a-z0-9-]+)(?:\s*,[^)]*)?\)/g, (_, n: string) => resoudre(jetons, n, profondeur + 1));
}

const rad = (d: number) => (d * Math.PI) / 180;
function oklchVersLineaire(L: number, C: number, h: number): RGB {
  const a = C * Math.cos(rad(h));
  const b = C * Math.sin(rad(h));
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}
const dansGamut = (c: RGB) => c.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
const encoder = (v: number) => { const x = Math.min(1, Math.max(0, v)); return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055; };

/** Couleur CSS (oklch(), #rgb, #rrggbb, rgb(r g b / a)) → [sRGB 0-1, alpha]. Hors gamut : chroma réduite (comme le navigateur à peu près). */
export function couleur(valeur: string): { rgb: RGB; alpha: number } {
  const v = valeur.trim().toLowerCase();
  let m = /^oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?))?\)$/.exec(v);
  if (m) {
    const L = Number(m[1]) / 100;
    let C = Number(m[2]);
    const h = Number(m[3]);
    if (!dansGamut(oklchVersLineaire(L, C, h))) {
      let bas = 0;
      let haut = C;
      for (let i = 0; i < 30; i++) { const mi = (bas + haut) / 2; if (dansGamut(oklchVersLineaire(L, mi, h))) bas = mi; else haut = mi; }
      C = bas;
    }
    const lin = oklchVersLineaire(L, C, h);
    return { rgb: lin.map(encoder) as RGB, alpha: m[4] ? alpha(m[4]) : 1 };
  }
  m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(v);
  if (m) {
    const hex = (m[1] as string).length === 3 ? [...(m[1] as string)].map((x) => x + x).join('') : (m[1] as string);
    return { rgb: [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB, alpha: 1 };
  }
  m = /^rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?))?\)$/.exec(v);
  if (m) return { rgb: [m[1], m[2], m[3]].map((x) => Number(x) / 255) as RGB, alpha: m[4] ? alpha(m[4]) : 1 };
  throw new Error(`Couleur non lue : ${valeur}`);
}
const alpha = (a: string) => (a.endsWith('%') ? Number(a.slice(0, -1)) / 100 : Number(a));

const decoder = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const luminance = ([r, g, b]: RGB) => 0.2126 * decoder(r) + 0.7152 * decoder(g) + 0.0722 * decoder(b);
/** Rapport de contraste WCAG 2.x entre deux couleurs opaques. */
export function contraste(a: RGB, b: RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Composition d'une couleur translucide sur un fond, dans l'espace sRGB encodé (comme le navigateur). */
export const composer = (avant: { rgb: RGB; alpha: number }, fond: RGB): RGB => avant.rgb.map((v, i) => v * avant.alpha + (fond[i] as number) * (1 - avant.alpha)) as RGB;

/** Contraste d'un jeton d'avant-plan sur un jeton de fond, pour un thème. */
export function contrasteJetons(j: Record<Theme, Map<string, string>>, theme: Theme, avant: string, fond: string): number {
  const f = couleur(resoudre(j[theme], fond));
  const a = couleur(resoudre(j[theme], avant));
  return contraste(composer(a, f.rgb), f.rgb);
}
