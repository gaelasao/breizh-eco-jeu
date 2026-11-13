// Générateur de la palette Breizhcosystem : OKLCH -> sRGB (hex), contraste WCAG, simulation CVD.
const rad = (d) => (d * Math.PI) / 180;
export function oklchToLin([L, C, h]) {
  const a = C * Math.cos(rad(h)), b = C * Math.sin(rad(h));
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const inGamut = (rgb) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
export function mapToSrgb([L, C, h]) {
  if (inGamut(oklchToLin([L, C, h]))) return [L, C, h];
  let lo = 0, hi = C;
  for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (inGamut(oklchToLin([L, mid, h]))) lo = mid; else hi = mid; }
  return [L, lo, h];
}
const enc = (v) => { v = Math.min(1, Math.max(0, v)); return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; };
export function hex(c) { const lin = oklchToLin(mapToSrgb(c)); return '#' + lin.map((v) => Math.round(enc(v) * 255).toString(16).padStart(2, '0')).join(''); }
const dec = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const hexLin = (h) => [1, 3, 5].map((i) => dec(parseInt(h.slice(i, i + 2), 16) / 255));
// Accepte une couleur OKLCH [L, C, h] ou une chaîne hexadécimale « #rrggbb » (couleurs de la scène 3D, mélanges)
const lin = (c) => (typeof c === 'string' ? hexLin(c) : oklchToLin(mapToSrgb(c)).map((v) => Math.min(1, Math.max(0, v))));
export function Y(c) { const [r, g, b] = lin(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
/** Composition d'un avant-plan à l'opacité a sur un fond, comme le navigateur (dans l'espace sRGB encodé). Retourne un hex. */
export function melange(avant, a, fond) {
  const A = typeof avant === 'string' ? avant : hex(avant), B = typeof fond === 'string' ? fond : hex(fond);
  return '#' + [1, 3, 5].map((i) => Math.round(parseInt(A.slice(i, i + 2), 16) * a + parseInt(B.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, '0')).join('');
}
/** rgb(r g b / a) depuis une couleur OKLCH ou hex (replis sans color-mix). */
export function rgba(c, a) { const h = typeof c === 'string' ? c : hex(c); return `rgb(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(' ')} / ${a})`; }
export function YP3raw(c) { const [r, g, b] = oklchToLin(c); return 0.2126 * r + 0.7152 * g + 0.0722 * b; } // luminance réelle, même hors sRGB
export const ratio = (a, b) => { const ya = Y(a), yb = Y(b); return (Math.max(ya, yb) + 0.05) / (Math.min(ya, yb) + 0.05); };
export const ratioP3 = (a, b) => { const ya = YP3raw(a), yb = YP3raw(b); return (Math.max(ya, yb) + 0.05) / (Math.min(ya, yb) + 0.05); };
// sRGB lin -> OKLab
function linToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
// Machado 2009, sévérité 1.0 (matrices en sRGB linéaire)
const CVD = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
export function dist(a, b, mode) {
  let A = oklchToLin(mapToSrgb(a)).map((v) => Math.min(1, Math.max(0, v))), B = oklchToLin(mapToSrgb(b)).map((v) => Math.min(1, Math.max(0, v)));
  if (mode) { const M = CVD[mode]; const ap = (x) => M.map((row) => Math.min(1, Math.max(0, row[0] * x[0] + row[1] * x[1] + row[2] * x[2]))); A = ap(A); B = ap(B); }
  const p = linToOklab(A), q = linToOklab(B);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}
export const fmt = ([L, C, h]) => `oklch(${+(L * 100).toFixed(1)}% ${+C.toFixed(3)} ${h})`;
