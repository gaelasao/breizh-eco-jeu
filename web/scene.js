/* Living Business — maquette 3D d'un port breton (Three.js + modèles libres KayKit CC0), direction de design §5.
   Échelle réelle : 1 unité = 1 mètre. Le siège et ses lieux au centre, sur le quai ; les CLIENTS en ville à l'ouest ;
   les FOURNISSEURS dans la zone d'activité à l'est ; clients et fournisseurs à la fois, et partenaires, au nord ;
   les PROSPECTS au marché, sur la plage ; le PHARE Breizhcosystem sur la jetée.
   La scène n'invente rien : elle met en forme les données. Positions = mise en page, pas géographie.
   Employés : lieu de rattachement (ou planning du jour), jamais une présence constatée. Circulation : illustrative.
   Couleurs : jetons --bz-scene-jour-* et --bz-scene-nuit-* (tokens.css), interpolés selon l'heure de la carte (§5.3).
   Rendu à la demande (§5.10) : aucune image calculée quand rien ne bouge, que la carte est masquée ou en pause. */
import * as THREE from '/vendor/three.module.js';
import CameraControls from '/vendor/camera-controls@3.1.2.js';
import { GLTFLoader } from '/vendor/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from '/vendor/addons/utils/BufferGeometryUtils.js';
import { icone } from '/bz/icone.js';
import { typo, pluriel } from '/bz/typo.js';
import { libelleCanvas } from '/carte/gestes.js';
import { partagerAtlas, reduireImage } from '/carte/atlas.js';
import { couleurRole, etatHeure, lirePalette, lumieres } from '/carte/heure.js';
import { MAX_ETIQUETTES, PRIORITE, ordreClavier, placerEtiquettes, regrouperParQuartier, voisin } from '/carte/etiquettes.js';
import { categorieDe, peintureDe } from '/carte/categories.js';
import { FAMILLES_PERSONNALISABLES, estPersonnalisee, ordonner } from '/carte/personnalisation.js';
import { CADENCE, palierInferieur, profil, qualiteInitiale, surveillance, vieAmbiante } from '/carte/qualite.js';
import { ALLEGE, ATLAS_ENSEIGNES, COUCHES_CUITES, MASQUE, NB_MASQUES, NOMS_COUCHES, details, echelleMur, estMobilier, masqueCalque, mursBaisses, orientationMur, placeEnseigne, rvb, uvEnseigne } from '/carte/lots.js';

CameraControls.install({ THREE });
// Les modèles KayKit partagent deux textures (citybits, furniturebits) : sans ce cache, chaque modèle les redemandait
// au serveur (une vingtaine de requêtes par chargement, §8.2). Ici, chaque fichier n'est lu qu'une fois par session.
THREE.Cache.enabled = true;

/* Couleurs : une chaîne est un rôle de la palette de la scène (suivi jour → nuit) ; un nombre est une couleur de
   donnée ou de détail (pneus, écrans, alertes), qui ne change pas avec l'heure. */
const P = {
  terre: 'granit', herbe: 'lande', herbe2: 'lande', pave: 'granit', pave2: 'granit', route: 0x5d636a, trottoir: 'granit', ligne: 0xf2efe6,
  sable: 'sable', fondMer: 'mer-profonde', mer: 'mer', mur: 'chaux', murSombre: 'chaux', ardoise: 'ardoise', toitClair: 'ardoise', beton: 'granit',
  verre: 0x9cc4d6, cadre: 'ardoise', bois: 'bois', carton: 0xc79d66, metal: 0x9aa3ad, bleuRayon: 0x4b5763, orangeRayon: 0x9a7652,
  sombre: 0x2b2f35, pneu: 0x1f2226, ecran: 0x1b2a3a, fenetre: 0x3c4a56,
  // tiers : aucune couleur par catégorie dans le décor (§5.1, §4.12), la catégorie se lit sur la pastille
  client: 'ardoise', fournisseur: 'ardoise', partenaire: 'ardoise', prospect: 'bois', mixte: 'ardoise', autre: 'granit',
  critique: 0xd23b2f, attention: 0xe5a321, info: 0x3d7fc0, simu: 0x8e5bd6,
  feuillage: [0x6b8f58, 0x77975e, 0x5f8150, 0x80a066], tronc: 0x6f5236,
};
const EQUIPES = [0x2f6fb0, 0xd07a2b, 0x3f8a52, 0x8e5bd6, 0xc0392b, 0x16a085, 0xb7950b, 0x5d6d7e];
const PEAUX = [0xf1d0b5, 0xe2b48f, 0xc68e66, 0x9a6744, 0x6e4a32];
const CHEVEUX = [0x2b2018, 0x5a3b22, 0x8a6a45, 0xc9a26a, 0x3a3a3a, 0xa0522d, 0xd8d0c0];
const mouvementReduit = () => document.documentElement.getAttribute('data-mouvement') === 'reduit'
  || (document.documentElement.getAttribute('data-mouvement') !== 'normal' && matchMedia('(prefers-reduced-motion: reduce)').matches);
const telephone = () => matchMedia('(max-width: 37.49em)').matches;
const tactile = () => matchMedia('(pointer: coarse)').matches;

export function webglDisponible() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- palette, heure et matériaux (§5.2 à §5.4)
let PROFIL = profil('standard');
let PAL = null;
let ETAT = { nom: 'jour', nuit: 0, soleilBas: 0, elevation: 1, azimut: 0.7 };
const suivis = []; // matériaux dont la couleur suit l'heure : { m, role }
const couleurDe = (role) => new THREE.Color(PAL ? couleurRole(PAL, role, ETAT) : getComputedStyle(document.documentElement).getPropertyValue('--bz-scene-jour-platre').trim());
/** Multiplicateur nocturne des matériaux texturés (atlas KayKit, textures procédurales) : rapport nuit / jour de la chaux. */
function facteurTexture() {
  if (!PAL) return new THREE.Color(1, 1, 1);
  const j = new THREE.Color(PAL.jour.chaux);
  const n = new THREE.Color(PAL.nuit.chaux);
  const f = new THREE.Color(n.r / j.r, n.g / j.g, n.b / j.b);
  return new THREE.Color(1, 1, 1).lerp(f, ETAT.nuit);
}
function suivre(m, role) {
  suivis.push({ m, role });
  m.color.copy(role === 'texture' ? facteurTexture() : couleurDe(role));
  return m;
}
/** Matériau du décor : Lambert en qualité Standard et Économie, PBR (rugosité 0,85, sans métal) en Haute. */
function nouveau(o = {}) {
  const { roughness, metalness, envMapIntensity, ...reste } = o;
  if (PROFIL.materiauPbr) return new THREE.MeshStandardMaterial({ roughness: roughness ?? 0.85, metalness: 0, ...reste });
  return new THREE.MeshLambertMaterial(reste);
}
const mats = new Map();
function mat(c, o = {}) {
  const k = `${c}|${JSON.stringify(o)}`;
  if (!mats.has(k)) {
    const m = nouveau(o);
    if (typeof c === 'string') suivre(m, c); else m.color.set(c);
    mats.set(k, m);
  }
  return mats.get(k);
}
/**
 * Marquage au sol (axes de chaussée, passages piétons, allées d'entrepôt) : une peinture, pas une dalle posée sur
 * l'enrobé. Le décalage de profondeur la place devant la surface qui la porte quelle que soit la distance ; sans lui,
 * une plaque à 2 cm tient de près mais se met à clignoter en vue éloignée, où le tampon de profondeur ne distingue
 * plus qu'un centimètre et demi.
 */
const matMarquage = (c) => mat(c, { polygonOffset: true, polygonOffsetFactor: DECALQUE, polygonOffsetUnits: DECALQUE });
// Bâtiments de l'entreprise : MeshToonMaterial à 3 paliers (0,55 ; 0,8 ; 1,0) et contour permanent (§5.4)
let rampeToon = null;
function rampe() {
  if (rampeToon) return rampeToon;
  const d = new Uint8Array([140, 140, 140, 255, 204, 204, 204, 255, 255, 255, 255, 255]);
  rampeToon = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
  rampeToon.minFilter = THREE.NearestFilter;
  rampeToon.magFilter = THREE.NearestFilter;
  rampeToon.generateMipmaps = false;
  rampeToon.needsUpdate = true;
  return rampeToon;
}
const toons = new Map();
function toon(m) {
  if (!m || m.isMeshToonMaterial || m.transparent || m.isShaderMaterial || m.isMeshBasicMaterial) return m;
  if (!toons.has(m.uuid)) {
    const t = new THREE.MeshToonMaterial({ color: m.color.clone(), map: m.map ?? null, gradientMap: rampe(), emissive: m.emissive?.clone() ?? new THREE.Color(0) });
    const s = suivis.find((x) => x.m === m);
    if (s) suivre(t, s.role);
    toons.set(m.uuid, t);
  }
  return toons.get(m.uuid);
}
/** Variantes d'un matériau : 'platre' (aucune donnée réelle), 'perime' (40 % de la saturation), 'survol' (émissif +8 %). */
const variantes = new Map();
function variante(m, type) {
  if (!m || m.isShaderMaterial || m.isMeshBasicMaterial || m.transparent) return m;
  if (type === 'platre') return mat('platre', { flatShading: false });
  const k = `${m.uuid}|${type}`;
  if (!variantes.has(k)) {
    const v = m.clone();
    if (type === 'perime') {
      const garde = (PAL?.peinturePerimee ?? 0.4).toFixed(3);
      v.onBeforeCompile = (sh) => {
        sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  { float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)); diffuseColor.rgb = mix(vec3(l), diffuseColor.rgb, ${garde}); }`);
      };
      v.customProgramCacheKey = () => `perime-${garde}`;
    }
    if (type === 'survol' && v.emissive) v.emissive.addScalar(0.08);
    const s = suivis.find((x) => x.m === m);
    if (s) suivre(v, s.role);
    basesVariantes.set(v, basesVariantes.get(m) ?? m);
    variantes.set(k, v);
  }
  return variantes.get(k);
}
const basesVariantes = new WeakMap(); // variante → matériau d'origine (les lots relisent la couleur d'origine)

// ---------------------------------------------------------------- lots de rendu (§5.10)
/* Les maillages statiques sont cuits en lots : un maillage par sorte de matériau (type, texture, face), quel que soit
   le calque. Tout ce qui distinguait les pièces passe dans leurs sommets : teinte de jour et de nuit, émissif,
   rugosité, calque (masqué par un uniforme), mur (abaissé par le vertex shader, maison de poupée), ombre portée (lue
   par le matériau d'ombre). L'heure est un uniforme ; l'état de chaque objet (plâtre, donnée périmée, survol) est lu
   dans une petite texture. Quelques dizaines d'appels de dessin au lieu de plusieurs centaines, sans rien perdre : les
   maillages d'origine restent dans la scène, sur un calque que la caméra ne dessine pas, pour le pointage, la sélection
   et les volumes. */
const CALQUE_ORIGINES = 1;
/** Épaisseur du contour permanent des bâtiments de l'entreprise (§5.4), en mètres : un trait d'encre régulier. */
const EPAISSEUR_CONTOUR = 0.03;
/** Marquages au sol (lignes, passages piétons, allées d'entrepôt) : décalque, jamais une surface posée sur une autre. */
const DECALQUE = -4;
const LARGEUR_ETATS = 256;
const HAUTEUR_ETATS = 16; // 4 096 objets
const uLot = {
  uNuit: { value: 0 }, uEtats: { value: null }, uPlatreJ: { value: new THREE.Vector3(1, 1, 1) }, uPlatreN: { value: new THREE.Vector3(1, 1, 1) },
  uGarde: { value: 0.4 }, uMasque: { value: new Array(NB_MASQUES).fill(1) }, uBaisse: { value: [0, 0, 0, 0, 0] },
  uFenetres: { value: 0 }, uCouleurFenetres: { value: new THREE.Color() },
};
// commun aux lots, à leur ombre et à la passe de normales de l'occlusion (GTAO) : calque masqué, mur abaissé
const GLSL_LOT_TETE = `attribute vec4 aInfo; // objet, motif de sol, masque, orientation du mur (0 : aucun)
attribute vec4 aDim; // pied et hauteur du mur, rugosité, métal
uniform float uMasque[${NB_MASQUES}];
uniform float uBaisse[5];`;
const GLSL_LOT_MUR = `#include <begin_vertex>
  if (aInfo.w > 0.5 && uBaisse[int(aInfo.w + 0.5)] > 0.5) transformed.y = aDim.x + (transformed.y - aDim.x) * (${ALLEGE.toFixed(3)} / max(aDim.y, 0.1));`;
const GLSL_LOT_MASQUE = `#include <project_vertex>
  if (uMasque[int(aInfo.z + 0.5)] < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`;
const GLSL_LOT_V = `${GLSL_LOT_TETE}
attribute vec3 aJour;
attribute vec3 aNuit;
attribute vec3 aEmis;
attribute vec2 aDrap; // ombre portée, fenêtre qui s'allume la nuit
uniform float uNuit;
uniform sampler2D uEtats;
uniform vec3 uPlatreJ;
uniform vec3 uPlatreN;
varying float vPeint;
varying float vPerime;
varying float vSurvol;
varying float vSol;
varying float vAllume;
varying vec2 vRugo;
varying vec3 vEmis;
varying vec3 vPosLot;
vec3 bzLineaire(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(vec3(0.04045), c)); }`;
const GLSL_LOT_COULEUR = `#include <color_vertex>
  {
    int iLot = int(aInfo.x + 0.5);
    vec4 eLot = texelFetch(uEtats, ivec2(iLot % ${LARGEUR_ETATS}, iLot / ${LARGEUR_ETATS}), 0);
    vPeint = step(0.5, eLot.r); vPerime = eLot.g; vSurvol = eLot.b; vEmis = aEmis; vSol = aInfo.y; vAllume = aDrap.y; vRugo = aDim.zw;
    vColor.rgb = mix(bzLineaire(mix(uPlatreJ, uPlatreN, uNuit)), vColor.rgb * bzLineaire(mix(aJour, aNuit, uNuit)), vPeint);
  }`;
const GLSL_LOT_F = `uniform float uGarde;
uniform float uFenetres;
uniform vec3 uCouleurFenetres;
varying float vPeint;
varying float vPerime;
varying float vSurvol;
varying float vSol;
varying float vAllume;
varying vec2 vRugo;
varying vec3 vEmis;
varying vec3 vPosLot;`;
const DESATURATION_KAYKIT = '{ float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)); diffuseColor.rgb = mix(vec3(l), diffuseColor.rgb, 0.72); }';
const avecMursEtMasque = (sh, tete = GLSL_LOT_TETE) => {
  sh.uniforms.uMasque = uLot.uMasque;
  sh.uniforms.uBaisse = uLot.uBaisse;
  sh.vertexShader = `${tete}\n${sh.vertexShader}`.replace('#include <begin_vertex>', GLSL_LOT_MUR).replace('#include <project_vertex>', GLSL_LOT_MASQUE);
};
/** Ombre des lots : murs abaissés, calques masqués, pièces sans ombre portée retirées de la carte d'ombre. */
const matOmbreLot = new THREE.MeshDepthMaterial();
matOmbreLot.onBeforeCompile = (sh) => {
  avecMursEtMasque(sh, `${GLSL_LOT_TETE}\nattribute vec2 aDrap;`);
  sh.vertexShader = sh.vertexShader.replace(GLSL_LOT_MASQUE, `${GLSL_LOT_MASQUE}\n  if (aDrap.x < 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`);
};
matOmbreLot.customProgramCacheKey = () => 'ombre-lot';
/** Passe de normales de l'occlusion ambiante (GTAO) : les mêmes murs abaissés et calques masqués que l'image. */
function adapterNormalesGtao(m) {
  m.onBeforeCompile = (sh) => avecMursEtMasque(sh);
  m.customProgramCacheKey = () => 'normales-lot';
  m.needsUpdate = true;
}
const matsLots = new Map();
/** Matériau d'un lot : mêmes réglages que l'original, couleur blanche (elle vient des sommets). */
function matLot(s) {
  const k = `${s.type}|${s.carte?.uuid ?? '-'}|${s.cote}|${s.plat}|${s.alpha}|${s.kaykit}|${s.contour ? 'c' : ''}|${s.decalque}`;
  if (!matsLots.has(k)) {
    const o = { vertexColors: true, side: s.cote, map: s.carte, alphaTest: s.alpha };
    // décalque (marquages au sol) : tiré vers la caméra dans le tampon de profondeur, il ne peut pas se battre
    if (s.decalque) Object.assign(o, { polygonOffset: true, polygonOffsetFactor: s.decalque, polygonOffsetUnits: s.decalque });
    const m = s.type === 'toon' ? new THREE.MeshToonMaterial({ ...o, gradientMap: rampe() })
      : s.type === 'basic' ? new THREE.MeshBasicMaterial(o)
        : s.type === 'standard' ? new THREE.MeshStandardMaterial({ ...o, flatShading: s.plat })
          : s.type === 'verre' ? new THREE.MeshLambertMaterial({ ...o, transparent: true, opacity: 0.32, depthWrite: false })
            : new THREE.MeshLambertMaterial({ ...o, flatShading: s.plat });
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, uLot);
      avecMursEtMasque(sh, GLSL_LOT_V);
      sh.vertexShader = sh.vertexShader
        .replace('#include <color_vertex>', GLSL_LOT_COULEUR)
        // contour permanent : coque écartée de la même épaisseur partout, le long des normales (jamais une mise à
        // l'échelle, qui laisse les faces minces collées à l'objet et les fait scintiller en vue éloignée)
        .replace(GLSL_LOT_MUR, `${GLSL_LOT_MUR}${s.contour ? `\n  transformed += normalize(normal) * ${EPAISSEUR_CONTOUR.toFixed(3)};` : ''}\n  vPosLot = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
      sh.fragmentShader = `${GLSL_LOT_F}\n${MOTIFS}\n${sh.fragmentShader}`
        .replace('#include <map_fragment>', `#ifdef USE_MAP
  diffuseColor *= mix(vec4(1.0), texture2D(map, vMapUv), vPeint);
  ${s.kaykit ? DESATURATION_KAYKIT : ''}
#endif`)
        .replace('#include <color_fragment>', `#include <color_fragment>
  if (vSol > 0.5 && vPeint > 0.5) diffuseColor.rgb = min(diffuseColor.rgb * motifSol(int(vSol + 0.5), vPosLot.xz), vec3(1.0));
  if (vPerime > 0.5) { float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)); diffuseColor.rgb = mix(vec3(l), diffuseColor.rgb, uGarde); }
  float allumeLot = vAllume * uFenetres;
  if (allumeLot > 0.5) diffuseColor = vec4(0.0, 0.0, 0.0, 0.85);`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRugo.x;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRugo.y;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vEmis + vec3(0.08 * vSurvol) + allumeLot * uCouleurFenetres;');
    };
    m.customProgramCacheKey = () => `lot|${s.type}|${s.kaykit ? 'k' : ''}${s.contour ? 'c' : ''}`;
    matsLots.set(k, m);
  }
  return matsLots.get(k);
}
/** Texture d'un lot : une par image (les répétitions sont cuites dans les coordonnées de texture). */
const cartesLots = new Map();
function carteLot(t) {
  const k = `${t.source.uuid}|${t.wrapS}|${t.wrapT}|${t.flipY}`;
  if (!cartesLots.has(k)) {
    const c = t.clone();
    c.repeat.set(1, 1);
    c.offset.set(0, 0);
    c.rotation = 0;
    c.center.set(0, 0);
    c.updateMatrix();
    c.needsUpdate = true;
    cartesLots.set(k, c);
  }
  return cartesLots.get(k);
}
/** Sorte et teintes d'un maillage pour la cuisson ; null s'il ne peut pas être cuit (il reste tel quel). */
function decrireLot(mesh, roles) {
  const m0 = mesh.material;
  if (!mesh.isMesh || mesh.isInstancedMesh || !m0 || Array.isArray(m0)) return null;
  const m = basesVariantes.get(m0) ?? m0;
  const g = mesh.geometry;
  if (!g?.attributes?.position || !g.attributes.normal) return null;
  const verre = m === matVerre || m === matVerreAllume;
  if (!verre && (m.transparent || m.depthWrite === false)) return null;
  if (m.isShaderMaterial || m.depthTest === false || m.toneMapped === false || m.fog === false || m.wireframe) return null;
  const type = verre ? 'verre' : m.isMeshToonMaterial ? 'toon' : m.isMeshBasicMaterial ? 'basic' : m.isMeshStandardMaterial ? 'standard' : m.isMeshLambertMaterial ? 'lambert' : null;
  if (!type) return null;
  const cle = m.customProgramCacheKey?.() ?? '';
  const kaykit = cle === 'kaykit';
  const contour = cle === 'contour';
  const sol = cle.startsWith('sol-') ? Number.parseInt(cle.slice(4), 10) : 0;
  if (Object.hasOwn(m, 'onBeforeCompile') && !kaykit && !sol && !contour) return null; // shader propre (mer, fanions) : laissé tel quel
  if (m.map && !g.attributes.uv) return null;
  const role = verre ? 'ciel-horizon' : roles.get(m);
  let jour;
  let nuit;
  if (role === 'texture') {
    jour = [1, 1, 1];
    const j = new THREE.Color(PAL.jour.chaux);
    const n = new THREE.Color(PAL.nuit.chaux);
    nuit = new THREE.Color(n.r / j.r, n.g / j.g, n.b / j.b).convertLinearToSRGB().toArray();
  } else if (role && PAL.jour[role]) {
    jour = rvb(PAL.jour[role]);
    nuit = rvb(PAL.nuit[role]);
  } else {
    jour = m.color.clone().convertLinearToSRGB().toArray();
    nuit = jour;
  }
  const emis = m.emissive ? m.emissive.clone().multiplyScalar(m.emissiveIntensity ?? 1).toArray() : [0, 0, 0];
  return {
    sorte: { type, carte: m.map ? carteLot(m.map) : null, cote: m.side, plat: Boolean(m.flatShading), alpha: m.alphaTest ?? 0, kaykit, contour, decalque: m.polygonOffset ? (m.polygonOffsetFactor ?? -1) : 0 },
    ombre: mesh.castShadow && !verre, jour, nuit, emis, sol, rugo: m.roughness ?? 0.85, metal: m.metalness ?? 0,
    carteSource: m.map ?? null, couleursSommets: m.vertexColors && g.attributes.color ? g.attributes.color : null,
  };
}
/**
 * Cuit des maillages en lots dans l'espace local de `parent` : un maillage par sorte de matériau.
 * sources : [{ mesh, d (decrireLot), ent (numéro d'objet, 0 = décor), masque, mur: { orientation, pied, hauteur } | null,
 * allume }]. Retourne les maillages créés.
 */
function cuireLots(sources, parent, ombres) {
  parent.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  const paquets = new Map();
  for (const s of sources) {
    // les niveaux de détail (silhouettes, mobilier) ont leurs propres lots : masqués de loin, ils ne coûtent rien
    const detail = s.masque === MASQUE.personnes ? 'personnes' : s.masque === MASQUE.mobilier ? 'mobilier' : null;
    const cle = `${matLot(s.d.sorte).uuid}|${detail}`;
    if (!paquets.has(cle)) paquets.set(cle, { sorte: s.d.sorte, ombre: false, liste: [], nv: 0, ni: 0, detail });
    const p = paquets.get(cle);
    const g = s.mesh.geometry;
    p.liste.push(s);
    p.ombre ||= s.d.ombre;
    p.nv += g.attributes.position.count;
    p.ni += g.index ? g.index.count : g.attributes.position.count;
  }
  const crees = [];
  const v = new THREE.Vector3();
  const mat4 = new THREE.Matrix4();
  const nm = new THREE.Matrix3();
  for (const p of paquets.values()) {
    const pos = new Float32Array(p.nv * 3);
    const nor = new Float32Array(p.nv * 3);
    const uv = p.sorte.carte ? new Float32Array(p.nv * 2) : null;
    const col = new Float32Array(p.nv * 3);
    const jour = new Uint8Array(p.nv * 3);
    const nuit = new Uint8Array(p.nv * 3);
    const emis = new Uint8Array(p.nv * 3);
    const info = new Float32Array(p.nv * 4);
    const dim = new Float32Array(p.nv * 4);
    const drap = new Uint8Array(p.nv * 2);
    const idx = p.nv > 65535 ? new Uint32Array(p.ni) : new Uint16Array(p.ni);
    let o = 0;
    let oi = 0;
    for (const { mesh, d, ent, masque = 0, mur = null, allume = false } of p.liste) {
      const g = mesh.geometry;
      const a = g.attributes;
      mat4.multiplyMatrices(inverse, mesh.matrixWorld);
      nm.getNormalMatrix(mat4);
      const inverseFaces = mat4.determinant() < 0;
      let e2 = null;
      if (uv && d.carteSource) { if (d.carteSource.matrixAutoUpdate) d.carteSource.updateMatrix(); e2 = d.carteSource.matrix.elements; }
      const c = d.couleursSommets;
      const j8 = d.jour.map((x) => Math.round(x * 255));
      const n8 = d.nuit.map((x) => Math.round(x * 255));
      const e8 = d.emis.map((x) => Math.round(Math.min(1, x) * 255));
      const n = a.position.count;
      for (let i = 0; i < n; i++) {
        const k = (o + i) * 3;
        const k4 = (o + i) * 4;
        v.fromBufferAttribute(a.position, i).applyMatrix4(mat4);
        pos[k] = v.x; pos[k + 1] = v.y; pos[k + 2] = v.z;
        v.fromBufferAttribute(a.normal, i).applyMatrix3(nm).normalize();
        nor[k] = v.x; nor[k + 1] = v.y; nor[k + 2] = v.z;
        if (uv) {
          const u0 = a.uv.getX(i);
          const v0 = a.uv.getY(i);
          uv[(o + i) * 2] = e2 ? e2[0] * u0 + e2[3] * v0 + e2[6] : u0;
          uv[(o + i) * 2 + 1] = e2 ? e2[1] * u0 + e2[4] * v0 + e2[7] : v0;
        }
        col[k] = c ? c.getX(i) : 1; col[k + 1] = c ? c.getY(i) : 1; col[k + 2] = c ? c.getZ(i) : 1;
        jour[k] = j8[0]; jour[k + 1] = j8[1]; jour[k + 2] = j8[2];
        nuit[k] = n8[0]; nuit[k + 1] = n8[1]; nuit[k + 2] = n8[2];
        emis[k] = e8[0]; emis[k + 1] = e8[1]; emis[k + 2] = e8[2];
        info[k4] = ent; info[k4 + 1] = d.sol; info[k4 + 2] = masque; info[k4 + 3] = mur?.orientation ?? 0;
        dim[k4] = mur?.pied ?? 0; dim[k4 + 1] = mur?.hauteur ?? 0; dim[k4 + 2] = d.rugo; dim[k4 + 3] = d.metal;
        drap[(o + i) * 2] = d.ombre ? 1 : 0;
        drap[(o + i) * 2 + 1] = allume ? 1 : 0;
      }
      const ni = g.index ? g.index.count : n;
      for (let t = 0; t < ni; t += 3) {
        const i0 = g.index ? g.index.getX(t) : t;
        const i1 = g.index ? g.index.getX(t + 1) : t + 1;
        const i2 = g.index ? g.index.getX(t + 2) : t + 2;
        idx[oi + t] = o + i0;
        idx[oi + t + 1] = o + (inverseFaces ? i2 : i1);
        idx[oi + t + 2] = o + (inverseFaces ? i1 : i2);
      }
      o += n;
      oi += ni;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (uv) geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geom.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geom.setAttribute('aJour', new THREE.BufferAttribute(jour, 3, true));
    geom.setAttribute('aNuit', new THREE.BufferAttribute(nuit, 3, true));
    geom.setAttribute('aEmis', new THREE.BufferAttribute(emis, 3, true));
    geom.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
    geom.setAttribute('aDim', new THREE.BufferAttribute(dim, 4));
    geom.setAttribute('aDrap', new THREE.BufferAttribute(drap, 2));
    geom.setIndex(new THREE.BufferAttribute(idx, 1));
    geom.computeBoundingSphere();
    const me = new THREE.Mesh(geom, matLot(p.sorte));
    me.castShadow = p.ombre && ombres;
    me.receiveShadow = ombres && p.sorte.type !== 'verre';
    if (me.castShadow) me.customDepthMaterial = matOmbreLot;
    me.userData.jetable = 'geometrie';
    me.userData.lot = true;
    me.userData.coque = p.sorte.cote === THREE.BackSide; // contours permanents : hors de l'occlusion ambiante
    me.userData.detail = p.detail;
    me.raycast = () => {}; // le pointage se fait sur les maillages d'origine
    parent.add(me);
    crees.push(me);
  }
  return crees;
}
/** Maillages transparents d'un même matériau fusionnés en un seul, dans l'espace local de `parent`. */
function fusionnerTransparents(liste, parent) {
  if (!liste.length) return [];
  parent.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(parent.matrixWorld).invert();
  const parMat = new Map();
  for (const m of liste) {
    const g = m.geometry;
    const noms = Object.keys(g.attributes).filter((n) => ['position', 'normal', 'uv'].includes(n)).sort().join(',');
    const cle = `${m.material.uuid}|${noms}`;
    if (!parMat.has(cle)) parMat.set(cle, { m: m.material, liste: [] });
    const copie = new THREE.BufferGeometry();
    for (const n of noms.split(',')) copie.setAttribute(n, g.attributes[n].clone()); // copie : la géométrie d’origine est souvent partagée (cache)
    copie.setIndex(g.index ? g.index.clone() : [...Array(g.attributes.position.count).keys()]);
    copie.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, m.matrixWorld));
    parMat.get(cle).liste.push(copie);
  }
  const crees = [];
  for (const { m, liste: l } of parMat.values()) {
    const fusion = l.length === 1 ? l[0] : mergeGeometries(l, false);
    if (l.length > 1) for (const x of l) x.dispose();
    if (!fusion) continue;
    const me = new THREE.Mesh(fusion, m);
    me.userData.jetable = 'geometrie';
    me.userData.lot = true;
    me.raycast = () => {};
    parent.add(me);
    crees.push(me);
  }
  return crees;
}
const geos = new Map();
const geo = (k, f) => (geos.has(k) ? geos.get(k) : (geos.set(k, f()), geos.get(k)));
const B = (l, h, p) => geo(`B${l}|${h}|${p}`, () => new THREE.BoxGeometry(l, h, p).translate(0, h / 2, 0));
const CY = (rh, rb, h, s = 14) => geo(`C${rh}|${rb}|${h}|${s}`, () => new THREE.CylinderGeometry(rh, rb, h, s).translate(0, h / 2, 0));
const SP = (r, s = 12) => geo(`S${r}|${s}`, () => new THREE.SphereGeometry(r, s, Math.max(6, Math.round(s * 0.7))));
/** Plaque horizontale (marquage au sol) : un seul plan, sans épaisseur ni tranches à faire scintiller. */
const PL = (l, p) => geo(`P${l}|${p}`, () => new THREE.PlaneGeometry(l, p).rotateX(-Math.PI / 2));
function piece(g, m, x = 0, y = 0, z = 0, ombre = true) {
  const me = new THREE.Mesh(g, m);
  me.position.set(x, y, z);
  me.castShadow = ombre && PROFIL.ombres > 0;
  me.receiveShadow = PROFIL.ombres > 0;
  return me;
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function alea(graine) {
  let x = (graine % 2147483646) + 1;
  return () => (x = (x * 16807) % 2147483647) / 2147483647;
}
const val = (o, id) => o.champs?.find((c) => c.id === id)?.valeur ?? null;
const lien = (o, id) => o.champs?.find((c) => c.id === id)?.lien?.id ?? null;
let matVerre = null;
let matVerreAllume = null;
let matFantome = null;

// ---------------------------------------------------------------- textures procédurales (sols, routes, façades)
const textures = new Map();
function toile(n, dessin) {
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  dessin(c.getContext('2d'), n);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
/* Textures dessinées : couleurs prises dans la palette de la scène (jetons --bz-scene-jour-*), jamais écrites en dur ;
   le grain et les joints sont des voiles de la chaux (clair) ou de l'encre (sombre) posés avec une opacité. */
/** Couleur « #rrggbb » + opacité, en « #rrggbbaa » (la couleur vient toujours d'un jeton). */
const avecOpacite = (hex, a) => `${hex}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')}`;
const teinteScene = (role) => PAL?.jour[role] ?? getComputedStyle(document.documentElement).getPropertyValue(`--bz-scene-jour-${role}`).trim();
function voile(ctx, clair, opacite) {
  ctx.globalAlpha = Math.max(0, Math.min(1, opacite));
  ctx.fillStyle = teinteScene(clair ? 'chaux' : 'encre');
  ctx.strokeStyle = ctx.fillStyle;
}
function bruit(ctx, n, role, amplitude, taille = 2, graine = 1, assombrir = 0) {
  ctx.globalAlpha = 1;
  ctx.fillStyle = teinteScene(role);
  ctx.fillRect(0, 0, n, n);
  if (assombrir) { voile(ctx, assombrir < 0, Math.abs(assombrir)); ctx.fillRect(0, 0, n, n); }
  const rnd = alea(graine);
  for (let i = 0; i < (n * n) / (taille * taille * 3); i++) {
    const v = Math.floor((rnd() - 0.5) * amplitude);
    voile(ctx, v > 0, Math.abs(v) / 255);
    ctx.fillRect(rnd() * n, rnd() * n, taille, taille);
  }
  ctx.globalAlpha = 1;
}
const FABRIQUES = {
  parquet: (ctx, n) => {
    const rnd = alea(7);
    const rangs = 8;
    for (let r = 0; r < rangs; r++) {
      let x = -rnd() * 120;
      while (x < n) {
        const l = 90 + rnd() * 90;
        ctx.globalAlpha = 1;
        ctx.fillStyle = teinteScene('bois');
        ctx.fillRect(x, (r * n) / rangs, l, n / rangs);
        voile(ctx, rnd() > 0.5, 0.04 + rnd() * 0.1); // lames plus claires ou plus foncées
        ctx.fillRect(x, (r * n) / rangs, l, n / rangs);
        voile(ctx, false, 0.35);
        ctx.strokeRect(x, (r * n) / rangs, l, n / rangs);
        x += l;
      }
    }
  },
  moquette: (ctx, n) => {
    bruit(ctx, n, 'granit', 40, 2, 3, -0.18);
    voile(ctx, false, 0.12);
    for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo((i * n) / 4, 0); ctx.lineTo((i * n) / 4, n); ctx.moveTo(0, (i * n) / 4); ctx.lineTo(n, (i * n) / 4); ctx.stroke(); }
  },
  beton: (ctx, n) => {
    bruit(ctx, n, 'granit', 26, 3, 5, 0.18);
    voile(ctx, false, 0.14);
    ctx.strokeRect(0, 0, n, n);
  },
  carrelage: (ctx, n) => {
    bruit(ctx, n, 'platre', 16, 2, 9);
    voile(ctx, false, 0.12);
    for (let i = 0; i <= 4; i++) { ctx.beginPath(); ctx.moveTo((i * n) / 4, 0); ctx.lineTo((i * n) / 4, n); ctx.moveTo(0, (i * n) / 4); ctx.lineTo(n, (i * n) / 4); ctx.stroke(); }
  },
  asphalte: (ctx, n) => bruit(ctx, n, 'ardoise', 30, 2, 11, 0.08),
  pave: (ctx, n) => {
    bruit(ctx, n, 'sable', 18, 2, 13, -0.05);
    voile(ctx, false, 0.1);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) ctx.strokeRect(x * (n / 4) + (y % 2 ? n / 8 : 0), y * (n / 8), n / 4, n / 8);
  },
  herbe: (ctx, n) => {
    bruit(ctx, n, 'lande', 34, 2, 17);
    const rnd = alea(19);
    ctx.fillStyle = teinteScene('lande');
    for (let i = 0; i < 400; i++) { voile(ctx, false, rnd() * 0.25); ctx.fillRect(rnd() * n, rnd() * n, 1, 4); }
    ctx.globalAlpha = 1;
  },
  tole: (ctx, n) => {
    ctx.globalAlpha = 1;
    ctx.fillStyle = teinteScene('platre');
    ctx.fillRect(0, 0, n, n);
    for (let x = 0; x < n; x += 8) { voile(ctx, false, 0.1); ctx.fillRect(x, 0, 3, n); voile(ctx, true, 0.35); ctx.fillRect(x + 4, 0, 2, n); }
    ctx.globalAlpha = 1;
  },
  facade: (ctx, n) => bruit(ctx, n, 'chaux', 12, 3, 23),
  ardoise: (ctx, n) => {
    ctx.globalAlpha = 1;
    ctx.fillStyle = teinteScene('ardoise');
    ctx.fillRect(0, 0, n, n);
    const rnd = alea(29);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) { voile(ctx, true, rnd() * 0.06); ctx.fillRect(x * (n / 8) + (y % 2 ? n / 16 : 0) + 1, y * (n / 16) + 1, n / 8 - 2, n / 16 - 2); }
  },
};
function tex(nom, rx = 1, ry = 1) {
  const k = `${nom}|${rx}|${ry}`;
  if (!textures.has(k)) {
    if (!textures.has(nom)) textures.set(nom, toile(256, FABRIQUES[nom]));
    const t = textures.get(nom).clone();
    t.repeat.set(rx, ry);
    t.needsUpdate = true;
    textures.set(k, t);
  }
  return textures.get(k);
}
function matTex(nom, rx, ry, o = {}) {
  const k = `T${nom}|${rx}|${ry}|${JSON.stringify(o)}`;
  if (!mats.has(k)) mats.set(k, suivre(nouveau({ map: tex(nom, rx, ry), roughness: 0.9, ...o }), 'texture'));
  return mats.get(k);
}

// ---------------------------------------------------------------- modèles glTF (KayKit, CC0)
const MODELES = {
  mobilier: ['table_medium_long', 'table_medium', 'table_small', 'table_low', 'chair_A', 'chair_B', 'chair_C', 'cabinet_medium', 'cabinet_medium_decorated', 'cabinet_small_decorated', 'shelf_A_big', 'shelf_B_large_decorated', 'couch', 'couch_pillows', 'armchair', 'lamp_standing', 'lamp_table', 'cactus_medium_A', 'cactus_small_A', 'rug_rectangle_stripes_A', 'rug_rectangle_A', 'book_set', 'pictureframe_large_A', 'pictureframe_medium'],
  ville: ['building_A', 'building_B', 'building_C', 'building_D', 'building_E', 'building_F', 'building_G', 'building_H', 'car_sedan', 'car_hatchback', 'car_stationwagon', 'bench', 'bush', 'streetlight', 'trafficlight_A', 'dumpster', 'trash_A', 'firehydrant'],
};
const gabarits = new Map();
async function chargerModeles() {
  const loader = new GLTFLoader();
  // un atlas par pack (furniturebits, citybits) : une seule texture pour tous ses modèles (§5.10). Avec THREE.Cache, ils
  // reçoivent tous la même image : elle n'est jamais fermée ici (voir /carte/atlas.js), sinon les modèles sortent noirs.
  const atlas = new Map();
  await Promise.all(Object.entries(MODELES).flatMap(([pack, noms]) => noms.map((nom) =>
    loader.loadAsync(`/modeles/${pack}/${nom}.gltf`).then((g) => {
      const image = g.parser?.json?.images?.[0]?.uri ?? '';
      g.scene.traverse((m) => {
        if (!m.isMesh) return;
        m.castShadow = PROFIL.ombres > 0;
        m.receiveShadow = PROFIL.ombres > 0;
        const t = m.material?.map;
        if (t && image) {
          const a = partagerAtlas(atlas, `${pack}/${image}`, t);
          if (a.premiere) reduireAtlas(t); else m.material.map = a.texture;
        }
        m.material = materiauModele(m.material);
      });
      gabarits.set(nom, g.scene);
    }).catch(() => { /* modèle absent : forme procédurale */ }),
  )));
}
/** Hors qualité Haute, l'atlas KayKit (aplats de couleur) passe de 1 024 à 512 px : 4 fois moins de mémoire vidéo (§5.10).
    L'image d'origine reste ouverte : elle est dans THREE.Cache et resservira à la prochaine scène. */
function reduireAtlas(t) {
  if (PROFIL.qualite === 'haute') return;
  try {
    const c = reduireImage(t.image, () => document.createElement('canvas'));
    if (c) { t.image = c; t.needsUpdate = true; }
  } catch { /* atlas gardé tel quel */ }
}
/** Les modèles KayKit gardent leur atlas ; Lambert en Standard et Économie, PBR (rugosité 0,85, sans métal) en Haute (§5.2). */
const materiauxModeles = new Map();
function materiauModele(m) {
  if (!m) return m;
  const k = `${m.map?.uuid ?? m.color.getHex()}|${m.transparent}|${m.opacity}`; // un matériau par atlas
  if (!materiauxModeles.has(k)) {
    const n = nouveau({ map: m.map ?? null, transparent: m.transparent, opacity: m.opacity });
    n.name = m.name;
    n.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  { float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)); diffuseColor.rgb = mix(vec3(l), diffuseColor.rgb, 0.72); }`);
    };
    n.customProgramCacheKey = () => 'kaykit';
    if (m.map) suivre(n, 'texture'); else n.color.copy(m.color);
    materiauxModeles.set(k, n);
  }
  return materiauxModeles.get(k);
}
/** Instance d'un modèle, à l'échelle demandée (nombre ou [x, y, z]). Null si le modèle manque. */
function modele(nom, echelle = 1, ombre = true) {
  const g = gabarits.get(nom);
  if (!g) return null;
  const c = g.clone(true);
  if (Array.isArray(echelle)) c.scale.set(...echelle);
  else c.scale.setScalar(echelle);
  if (!ombre) c.traverse((m) => { if (m.isMesh) m.castShadow = false; });
  return c;
}
const placer = (o, x, y, z, rot = 0) => { if (o) { o.position.set(x, y, z); o.rotation.y = rot; } return o; };

// ---------------------------------------------------------------- personnes (échelle réelle, assises ou debout)
/* Personnes : anatomie à l'échelle (1,60 à 1,85 m), visage (yeux, iris, sourcils, nez, bouche, oreilles),
   coiffures variées, lunettes, barbes ; tenue à la couleur de l'équipe. Toutes les parties sont fusionnées
   en UN maillage à couleurs de sommets : un seul appel de dessin par personne, géométrie mise en cache. */
let matPersonne = null; // créé à la première personne, selon la qualité (Lambert ou PBR)
const cachePersonnes = new Map();
const PANTALONS = [0x2b3a55, 0x22262c, 0x4a4f57, 0x8a7a63, 0x3c4f3a, 0x5b4636];
const IRIS = [0x4a3324, 0x2f5d8a, 0x3f6b3f, 0x2a2a2a];
const LEVRES = [0xb06a64, 0x9c5a54, 0xa86f68];
const COIFFURES = ['court', 'court', 'long', 'chignon', 'queue', 'boucles', 'carre', 'chauve'];
function construirePersonne(id, couleur, assis, casque) {
  const rnd = alea(hash(id));
  const parties = [];
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const ajouter = (geo, c, x, y, z, { rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1 } = {}) => {
    const g = geo.clone();
    q.setFromEuler(e.set(rx, ry, rz));
    m4.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
    g.applyMatrix4(m4);
    const col = new THREE.Color(c);
    const n = g.attributes.position.count;
    const t = new Float32Array(n * 3);
    for (let k = 0; k < n; k++) { t[k * 3] = col.r; t[k * 3 + 1] = col.g; t[k * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(t, 3));
    parties.push(g);
  };
  // finesse selon la qualité (§5.10) : pleine en Haute, environ trois fois moins de triangles ailleurs
  const fin = (n, min) => Math.max(min, Math.round(n * (PROFIL.qualite === 'haute' ? 1 : 0.55)));
  const SPH = (r, w = 14, h = 10) => new THREE.SphereGeometry(r, fin(w, 6), fin(h, 4));
  const CAP = (r, l, s = 10) => new THREE.CapsuleGeometry(r, l, PROFIL.qualite === 'haute' ? 4 : 2, fin(s, 6));
  const CYL = (rh, rb, hh, s = 14) => new THREE.CylinderGeometry(rh, rb, hh, fin(s, 6));
  const BOX = (a, b, c) => new THREE.BoxGeometry(a, b, c);
  const fonce = (c, k) => new THREE.Color(c).multiplyScalar(k).getHex();

  const peau = PEAUX[Math.floor(rnd() * PEAUX.length)];
  const cheveux = CHEVEUX[Math.floor(rnd() * CHEVEUX.length)];
  const pantalon = PANTALONS[Math.floor(rnd() * PANTALONS.length)];
  const chaussures = rnd() > 0.5 ? 0x1d1f22 : 0x4a3426;
  const coiffure = COIFFURES[Math.floor(rnd() * COIFFURES.length)];
  const taille = 0.93 + rnd() * 0.1; // 1,63 m à 1,81 m
  const veste = rnd() > 0.62; // veste ouverte sur la chemise
  const lunettes = rnd() > 0.74;
  const barbe = (coiffure === 'court' || coiffure === 'chauve') && rnd() > 0.55;
  const haut = veste ? fonce(couleur, 0.55) : couleur;
  const yh = assis ? 0.47 : 0.9; // hauteur des hanches
  const d = yh - 0.9; // décalage du haut du corps

  // jambes et pieds
  if (assis) {
    for (const x of [-0.09, 0.09]) {
      ajouter(CAP(0.07, 0.36), pantalon, x, yh + 0.02, 0.2, { rx: Math.PI / 2 });
      ajouter(CAP(0.058, 0.34), pantalon, x, 0.25, 0.42);
      ajouter(BOX(0.1, 0.07, 0.25), chaussures, x, 0.035, 0.47);
    }
  } else {
    for (const x of [-0.09, 0.09]) {
      ajouter(CAP(0.068, 0.7), pantalon, x, 0.49, 0);
      ajouter(BOX(0.1, 0.07, 0.25), chaussures, x, 0.035, 0.035);
    }
  }
  // bassin, ceinture, buste
  ajouter(CYL(0.155, 0.15, 0.16), pantalon, 0, 0.94 + d, 0, { sz: 0.8 });
  ajouter(CYL(0.159, 0.159, 0.035), 0x3b2b20, 0, 1.0 + d, 0, { sz: 0.8 });
  ajouter(CAP(0.15, 0.3, 14), couleur, 0, 1.28 + d, 0, { sx: 1.12, sz: 0.7 });
  if (veste) {
    // pans de veste (la chemise reste visible au milieu)
    for (const s of [-1, 1]) ajouter(BOX(0.12, 0.5, 0.22), haut, s * 0.105, 1.27 + d, -0.005, { rz: s * 0.04 });
    ajouter(BOX(0.33, 0.5, 0.1), haut, 0, 1.27 + d, -0.06);
  }
  ajouter(CYL(0.062, 0.07, 0.045), veste ? 0xf4f4f0 : fonce(couleur, 0.85), 0, 1.535 + d, 0.005);
  for (const s of [-1, 1]) ajouter(SPH(0.064), haut, s * 0.185, 1.485 + d, 0, { sy: 0.85 });
  // bras et mains
  for (const s of [-1, 1]) {
    if (assis) {
      ajouter(CAP(0.047, 0.22), haut, s * 0.205, 1.31 + d, 0.06, { rx: -0.55, rz: s * 0.06 });
      ajouter(CAP(0.042, 0.2), haut, s * 0.18, 1.17 + d, 0.24, { rx: Math.PI / 2 - 0.15 });
      ajouter(SPH(0.043), peau, s * 0.17, 1.15 + d, 0.39, { sx: 0.85, sy: 0.6, sz: 1.15 });
    } else {
      ajouter(CAP(0.047, 0.22), haut, s * 0.205, 1.3, 0, { rz: s * 0.07 });
      ajouter(CAP(0.042, 0.2), haut, s * 0.222, 1.04, 0.02, { rz: s * 0.03, rx: -0.08 });
      ajouter(SPH(0.043), peau, s * 0.227, 0.88, 0.035, { sx: 0.75, sy: 1.15, sz: 0.6 });
    }
  }
  // cou, tête, visage
  const yt = 1.705 + d;
  ajouter(CYL(0.047, 0.05, 0.1), peau, 0, 1.58 + d, 0);
  ajouter(SPH(0.105, 18, 14), peau, 0, yt, 0, { sx: 0.93, sy: 1.1, sz: 1.0 });
  ajouter(SPH(0.06, 12, 8), peau, 0, yt - 0.06, 0.03, { sx: 1.25, sy: 0.85, sz: 1.1 }); // mâchoire
  for (const s of [-1, 1]) {
    ajouter(SPH(0.024, 8, 6), fonce(peau, 0.94), s * 0.097, yt - 0.005, -0.004, { sx: 0.5, sz: 0.8 });
    ajouter(SPH(0.0175, 10, 8), 0xf7f7f2, s * 0.037, yt + 0.014, 0.084);
    ajouter(SPH(0.0105, 8, 6), IRIS[Math.floor(rnd() * IRIS.length)], s * 0.037, yt + 0.014, 0.097);
    ajouter(BOX(0.038, 0.009, 0.012), fonce(cheveux, 0.8), s * 0.039, yt + 0.043, 0.094, { rz: s * -0.12 });
  }
  ajouter(BOX(0.017, 0.038, 0.024), fonce(peau, 0.9), 0, yt - 0.015, 0.104);
  ajouter(BOX(0.04, 0.008, 0.01), LEVRES[Math.floor(rnd() * LEVRES.length)], 0, yt - 0.052, 0.1);
  if (barbe) ajouter(SPH(0.068, 12, 8), cheveux, 0, yt - 0.068, 0.045, { sx: 1.28, sy: 0.82, sz: 0.72 });
  if (lunettes) {
    for (const s of [-1, 1]) ajouter(new THREE.TorusGeometry(0.023, 0.0045, 6, 14), 0x1b1b1b, s * 0.038, yt + 0.014, 0.106);
    ajouter(BOX(0.03, 0.005, 0.005), 0x1b1b1b, 0, yt + 0.02, 0.108);
  }
  // cheveux
  const calotte = new THREE.SphereGeometry(0.113, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.52);
  if (!casque && coiffure !== 'chauve') {
    ajouter(calotte, cheveux, 0, yt + 0.004, -0.004, { sx: 0.95, sy: 1.12, sz: 1.04 });
    ajouter(SPH(0.106, 14, 10), cheveux, 0, yt - 0.005, -0.022, { sx: 0.97, sy: 1.02, sz: 0.95 });
    if (coiffure === 'long') {
      ajouter(BOX(0.21, 0.3, 0.06), cheveux, 0, yt - 0.2, -0.07);
      for (const s of [-1, 1]) ajouter(BOX(0.04, 0.22, 0.07), cheveux, s * 0.098, yt - 0.13, -0.01);
    } else if (coiffure === 'carre') {
      for (const s of [-1, 1]) ajouter(BOX(0.04, 0.12, 0.09), cheveux, s * 0.1, yt - 0.06, -0.005);
      ajouter(BOX(0.2, 0.13, 0.05), cheveux, 0, yt - 0.07, -0.08);
    } else if (coiffure === 'chignon') {
      ajouter(SPH(0.048, 12, 8), cheveux, 0, yt + 0.07, -0.085);
    } else if (coiffure === 'queue') {
      ajouter(CAP(0.028, 0.15, 8), cheveux, 0, yt - 0.06, -0.125, { rx: 0.35 });
    } else if (coiffure === 'boucles') {
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        ajouter(SPH(0.04, 8, 6), cheveux, Math.cos(a) * 0.075, yt + 0.06 + Math.sin(k * 1.7) * 0.012, Math.sin(a) * 0.07 - 0.015);
      }
    }
  } else if (!casque) {
    ajouter(new THREE.SphereGeometry(0.108, 14, 8, 0, Math.PI * 2, Math.PI * 0.42, Math.PI * 0.2), cheveux, 0, yt, -0.01, { sx: 0.97, sy: 1.1, sz: 1.0 });
  }
  if (casque) {
    ajouter(new THREE.SphereGeometry(0.128, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), 0xf2c230, 0, yt + 0.02, 0, { sy: 0.95, sz: 1.06 });
    ajouter(CYL(0.15, 0.15, 0.012, 18), 0xe0b020, 0, yt + 0.02, 0.012, { sz: 1.1 });
    ajouter(BOX(0.36, 0.06, 0.02), 0xd9e6ee, 0, 1.36 + d, 0.11); // bande réfléchissante
  }
  const fusion = mergeGeometries(parties, false);
  for (const g of parties) g.dispose();
  fusion.computeBoundingSphere();
  return fusion;
}

function personne(id, couleur, { assis = false, casque = false } = {}) {
  const cle = `${id}|${couleur}|${assis}|${casque}|${PROFIL.qualite === 'haute'}`;
  let geo = cachePersonnes.get(cle);
  if (!geo) {
    geo = construirePersonne(id, couleur, assis, casque);
    cachePersonnes.set(cle, geo);
  }
  const g = new THREE.Group();
  matPersonne ??= suivre(nouveau({ vertexColors: true, roughness: 0.68 }), 'texture');
  const m = new THREE.Mesh(geo, matPersonne);
  m.castShadow = true;
  m.receiveShadow = true;
  g.add(m);
  return g;
}

// ---------------------------------------------------------------- mobilier procédural complémentaire
function ecran() {
  const g = new THREE.Group();
  g.add(piece(B(0.18, 0.02, 0.14), mat(P.sombre), 0, 0, 0, false));
  g.add(piece(B(0.04, 0.22, 0.04), mat(P.sombre), 0, 0.02, 0, false));
  g.add(piece(B(0.6, 0.36, 0.03), mat(P.sombre), 0, 0.2, 0, false));
  g.add(piece(B(0.56, 0.32, 0.005), mat(P.ecran, { emissive: 0x3a6ea5, emissiveIntensity: 0.35, roughness: 0.3 }), 0, 0.22, 0.017, false));
  return g;
}
function poste(couleurPanneau) {
  // bureau individuel : plateau 1,6 × 0,8, écran, clavier, panneau acoustique ; renvoie le siège
  const g = new THREE.Group();
  const t = modele('table_medium_long', [0.53, 0.74, 0.4]);
  if (t) g.add(placer(t, 0, 0, 0));
  else {
    g.add(piece(B(1.6, 0.04, 0.8), mat(0xefe9df), 0, 0.72, 0));
    for (const [x, z] of [[-0.75, -0.35], [0.75, -0.35], [-0.75, 0.35], [0.75, 0.35]]) g.add(piece(B(0.05, 0.72, 0.05), mat(P.metal), x, 0, z, false));
  }
  g.add(placer(ecran(), 0.1, 0.74, -0.2));
  g.add(piece(B(0.44, 0.02, 0.14), mat(0x2b2f35), 0, 0.74, 0.08, false));
  g.add(piece(B(0.07, 0.02, 0.1), mat(0x2b2f35), 0.34, 0.74, 0.1, false));
  g.add(piece(B(1.6, 0.42, 0.04), mat(couleurPanneau, { roughness: 0.95 }), 0, 0.74, -0.42, false));
  const ch = modele('chair_C', 0.72);
  if (ch) g.add(placer(ch, 0, 0, 0.62, Math.PI));
  return g;
}
function rack(nbCartons, enAlerte, perime, long = 2.7) {
  const g = new THREE.Group();
  const montant = mat(P.bleuRayon, { roughness: 0.55, metalness: 0.2 });
  for (const x of [-long / 2, long / 2]) for (const z of [-0.5, 0.5]) g.add(piece(B(0.08, 4.2, 0.08), montant, x, 0, z));
  const lisse = mat(P.orangeRayon, { roughness: 0.6, metalness: 0.2 });
  const niveaux = [0.12, 1.45, 2.8];
  for (const y of niveaux) for (const z of [-0.5, 0.5]) g.add(piece(B(long, 0.1, 0.06), lisse, 0, y, z, false));
  const carton = mat(perime ? 0xb7b2a8 : P.carton, { roughness: 0.95 });
  const palette = mat(0xb08a5a);
  const n = Math.max(0, Math.min(9, nbCartons));
  for (let i = 0; i < n; i++) {
    const niv = Math.floor(i / 3);
    const x = -long / 3 + (i % 3) * (long / 3);
    g.add(piece(B(0.8, 0.12, 0.9), palette, x, niveaux[niv] + 0.1, 0, false));
    g.add(piece(B(0.76, 0.85, 0.86), carton, x, niveaux[niv] + 0.22, 0));
  }
  if (enAlerte) g.add(piece(B(0.7, 0.28, 0.02), mat(P.critique, { emissive: P.critique, emissiveIntensity: 0.5 }), 0, 3.95, 0.52, false));
  return g;
}
function chariotElevateur() {
  const g = new THREE.Group();
  const jaune = mat(0xe8b22a, { roughness: 0.45, metalness: 0.1 });
  g.add(piece(B(1.9, 1.0, 1.1), jaune, 0, 0.3, 0));
  g.add(piece(B(0.9, 0.06, 1.0), mat(P.sombre), -0.3, 2.1, 0));
  for (const [x, z] of [[-0.7, 0.48], [-0.7, -0.48], [0.1, 0.48], [0.1, -0.48]]) g.add(piece(B(0.05, 1.8, 0.05), mat(P.sombre), x, 1.3, z, false));
  for (const z of [-0.45, 0.45]) g.add(piece(B(0.1, 2.6, 0.1), mat(P.sombre), 1.0, 0.2, z, false));
  for (const z of [-0.25, 0.25]) g.add(piece(B(1.1, 0.05, 0.12), mat(P.metal, { metalness: 0.6 }), 1.55, 0.2, z, false));
  for (const [x, z] of [[-0.6, 0.55], [0.6, 0.55], [-0.6, -0.55], [0.6, -0.55]]) g.add(piece(geo('roueC', () => new THREE.CylinderGeometry(0.28, 0.28, 0.22, 14).rotateX(Math.PI / 2)), mat(P.pneu), x, 0.28, z, false));
  return g;
}
function machine() {
  const g = new THREE.Group();
  g.add(piece(B(2.2, 1.6, 1.4), mat(0xdfe3e6, { roughness: 0.4, metalness: 0.3 }), 0, 0, 0));
  g.add(piece(B(1.2, 0.8, 0.02), mat(0x8fb7cc, { transparent: true, opacity: 0.5, roughness: 0.1 }), -0.2, 0.6, 0.71, false));
  g.add(piece(B(0.35, 0.5, 0.06), mat(P.sombre), 0.85, 0.9, 0.72, false));
  g.add(piece(B(0.28, 0.2, 0.01), mat(0x1e3a2e, { emissive: 0x2fae6a, emissiveIntensity: 0.6 }), 0.85, 1.05, 0.755, false));
  g.add(piece(B(2.2, 0.1, 1.4), mat(0x2f6fb0), 0, 1.6, 0, false));
  return g;
}
function etabli() {
  const g = new THREE.Group();
  g.add(piece(B(2, 0.06, 0.8), mat(P.bois), 0, 0.88, 0));
  for (const x of [-0.9, 0.9]) g.add(piece(B(0.08, 0.88, 0.7), mat(P.metal), x, 0, 0, false));
  g.add(piece(B(2, 1.0, 0.04), mat(0x8c96a0, { metalness: 0.3 }), 0, 0.94, -0.38, false));
  g.add(piece(B(0.3, 0.2, 0.2), mat(0xc0392b), -0.5, 0.94, 0, false));
  g.add(piece(B(0.4, 0.12, 0.25), mat(0x2f6fb0), 0.4, 0.94, 0.1, false));
  return g;
}
function camionnette(couleurBande = 0x2f6fb0) {
  const g = new THREE.Group();
  const blanc = mat(0xf5f5f2, { roughness: 0.35, metalness: 0.1 });
  g.add(piece(B(3.9, 1.95, 1.9), blanc, -0.45, 0.4, 0));
  g.add(piece(B(1.2, 1.35, 1.88), blanc, 2.0, 0.4, 0));
  g.add(piece(B(0.05, 0.7, 1.6), mat(0x23303c, { roughness: 0.1 }), 2.62, 1.05, 0, false));
  g.add(piece(B(3.92, 0.22, 1.92), mat(couleurBande), -0.45, 1.25, 0, false));
  for (const [x, z] of [[-1.6, 0.92], [1.8, 0.92], [-1.6, -0.92], [1.8, -0.92]]) g.add(piece(geo('roueV', () => new THREE.CylinderGeometry(0.36, 0.36, 0.26, 16).rotateX(Math.PI / 2)), mat(P.pneu), x, 0.36, z, false));
  return g;
}
function camion(couleur) {
  const g = new THREE.Group();
  g.add(piece(B(6.2, 2.7, 2.4), mat(0xf2f2ee, { roughness: 0.5 }), -1.3, 0.55, 0));
  g.add(piece(B(6.22, 0.3, 2.42), mat(couleur), -1.3, 2.1, 0, false));
  g.add(piece(B(2.0, 2.3, 2.35), mat(couleur, { roughness: 0.4, metalness: 0.1 }), 2.9, 0.55, 0));
  g.add(piece(B(0.05, 0.9, 2.0), mat(0x23303c, { roughness: 0.1 }), 3.91, 1.8, 0, false));
  for (const [x, z] of [[-3.4, 1.05], [-2.3, 1.05], [2.9, 1.05], [-3.4, -1.05], [-2.3, -1.05], [2.9, -1.05]]) g.add(piece(geo('roueT', () => new THREE.CylinderGeometry(0.46, 0.46, 0.3, 16).rotateX(Math.PI / 2)), mat(P.pneu), x, 0.46, z, false));
  return g;
}
function voiture(rnd = Math.random) {
  const noms = ['car_sedan', 'car_hatchback', 'car_stationwagon'];
  const m = modele(noms[Math.floor(rnd() * noms.length)], 4.6);
  if (m) {
    const g = new THREE.Group();
    m.position.y = 0.3;
    m.rotation.y = Math.PI / 2;
    g.add(m);
    return g;
  }
  const g = new THREE.Group();
  g.add(piece(B(4.2, 0.8, 1.8), mat(0x8a9199, { roughness: 0.35, metalness: 0.2 }), 0, 0.3, 0));
  g.add(piece(B(2.2, 0.6, 1.6), mat(0x23303c, { roughness: 0.1 }), -0.2, 1.1, 0));
  return g;
}
function arbre(x, z, rnd, echelle = 1) {
  const g = new THREE.Group();
  const h = (2.2 + rnd() * 1.6) * echelle;
  const eco = PROFIL.qualite === 'economie'; // Économie : arbres plus simples (budget de triangles, §5.10)
  g.add(piece(CY(0.14 * echelle, 0.22 * echelle, h, eco ? 5 : 7), mat(P.tronc), 0, 0, 0));
  const c = P.feuillage[Math.floor(rnd() * P.feuillage.length)];
  const feuillage = geo(`feuille${Math.floor(rnd() * 3)}|${eco}`, () => {
    const gg = new THREE.IcosahedronGeometry(1.6, eco ? 0 : 1);
    const pos = gg.attributes.position;
    const r = alea(hash(String(pos.count + Math.random())));
    for (let i = 0; i < pos.count; i++) pos.setXYZ(i, pos.getX(i) * (0.85 + r() * 0.3), pos.getY(i) * (0.8 + r() * 0.3), pos.getZ(i) * (0.85 + r() * 0.3));
    gg.computeVertexNormals();
    return gg;
  });
  const f = piece(feuillage, mat(c, { flatShading: true, roughness: 0.9 }), 0, h + 0.9 * echelle, 0);
  f.scale.setScalar(echelle);
  g.add(f);
  g.position.set(x, 0, z);
  return g;
}

// ---------------------------------------------------------------- enseignes et étiquettes peintes
/* Les enseignes partagent un atlas (pages de 2 × 5 enseignes de 512 × 96 px) et un seul matériau : elles rejoignent
   les lots de rendu au lieu de coûter un appel de dessin chacune (§5.10). Remis à zéro à chaque reconstruction. */
const atlasEnseignes = { pages: [], suivant: 0 };
function pageEnseignes(i) {
  if (!atlasEnseignes.pages[i]) {
    const c = document.createElement('canvas');
    c.width = ATLAS_ENSEIGNES.largeur;
    c.height = ATLAS_ENSEIGNES.hauteur;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    atlasEnseignes.pages[i] = { ctx: c.getContext('2d'), t, m: suivre(nouveau({ map: t, roughness: 0.6 }), 'texture') };
  }
  return atlasEnseignes.pages[i];
}
function enseigne(texte, couleur, largeur = 4) {
  const place = placeEnseigne(atlasEnseignes.suivant++);
  const { x0, y0 } = place;
  const page = pageEnseignes(place.page);
  const ctx = page.ctx;
  ctx.globalAlpha = 1;
  ctx.fillStyle = teinteScene('ardoise'); // enseigne neutre : la catégorie se lit sur la pastille, pas par une couleur
  ctx.fillRect(x0, y0, 512, 96);
  ctx.fillStyle = teinteScene('chaux');
  ctx.font = `650 ${Math.round(96 * 0.52)}px Inter, "Inter repli", system-ui, sans-serif`; // Inter 4.1 (bz.css), à la hauteur de la texture
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(texte.slice(0, 26), x0 + 256, y0 + 50, 490);
  page.t.needsUpdate = true;
  const g = new THREE.PlaneGeometry(largeur, largeur * 0.1875);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, ...uvEnseigne(uv.getX(i), uv.getY(i), place));
  const me = new THREE.Mesh(g, page.m);
  me.userData.jetable = 'geometrie';
  return me;
}
const nomCourt = (nom) => nom.replace(/\s*\((fictive?s?|démo)\)/gi, '').replace(/^(Restaurant|Boulangerie|Hôtel|Camping|Mairie de|Famille)\s+/i, '').trim();

// ---------------------------------------------------------------- bâtiments ouverts (maison de poupée), échelle réelle
/**
 * Coque ouverte : dalle, sol texturé, 4 murs (fenêtres vitrées en bandeau pour les bureaux, bardage pour l'entrepôt),
 * toit masqué par défaut. Les murs tournés vers la caméra s'abaissent à hauteur d'allège.
 */
function coque(l, p, h, { sol = 'parquet', murs = 'bureau', accent = P.cadre } = {}) {
  const g = new THREE.Group();
  const listeMurs = [];
  g.add(piece(B(l + 1.2, 0.15, p + 1.2), matTex('pave', (l + 1.2) / 3, (p + 1.2) / 3), 0, 0, 0));
  g.add(piece(B(l, 0.03, p), matTex(sol, l / 3, p / 3), 0, 0.15, 0, false));
  const e = 0.25;
  for (const [x, z, n] of [[0, p / 2, 'z+'], [0, -p / 2, 'z-'], [l / 2, 0, 'x+'], [-l / 2, 0, 'x-']]) {
    const horiz = n[0] === 'z';
    const long = horiz ? l + e : p;
    const mur = new THREE.Group();
    mur.position.set(x, 0.18, z);
    const B2 = (a, hh, b) => (horiz ? B(a, hh, b) : B(b, hh, a));
    const at = (t, y, d = 0) => (horiz ? [t, y, d] : [d, y, t]);
    const s = n.endsWith('+') ? 1 : -1;
    if (murs === 'entrepot') {
      mur.add(piece(B2(long, h, e), matTex('tole', long / 2, h / 2)));
      if (n === 'z+') for (const t of [-l / 3, 0, l / 3]) mur.add(piece(B2(3.2, 3.6, 0.08), mat(0x8c96a0, { metalness: 0.4, roughness: 0.4 }), ...at(t, 0, s * 0.14), false));
    } else {
      const allege = 0.9;
      const linteau = 2.55;
      mur.add(piece(B2(long, allege, e), mat(P.mur)));
      mur.add(piece(B2(long, h - linteau, e), mat(P.mur), ...at(0, linteau), false));
      mur.add(piece(B2(long, 0.08, e + 0.04), mat(accent), ...at(0, h - 0.08), false));
      const nb = Math.max(2, Math.round(long / 1.6));
      for (let i = 0; i <= nb; i++) mur.add(piece(B2(0.06, linteau - allege, 0.12), mat(P.cadre), ...at(-long / 2 + (i * long) / nb, allege), false));
      const vitre = piece(B2(long, linteau - allege, 0.02), matVerre, ...at(0, allege), false);
      vitre.castShadow = false;
      mur.add(vitre);
      if (n === 'z+') mur.add(piece(B2(1.8, linteau - 0.05, e + 0.06), mat(0x2a3440, { roughness: 0.2 }), ...at(l / 4, 0.02), false));
    }
    mur.userData.normale = new THREE.Vector3(n === 'x+' ? 1 : n === 'x-' ? -1 : 0, 0, n === 'z+' ? 1 : n === 'z-' ? -1 : 0);
    mur.userData.hauteur = h;
    listeMurs.push(mur);
    g.add(mur);
  }
  const toit = new THREE.Group();
  toit.add(piece(B(l + 0.6, 0.3, p + 0.6), mat(P.toitClair), 0, h + 0.18, 0));
  toit.add(piece(B(1.6, 0.9, 1.2), mat(0xb9bec4, { metalness: 0.3 }), l / 4, h + 0.48, -p / 5));
  toit.visible = false;
  g.add(toit);
  return { g, murs: listeMurs, toit, l, p };
}

/** Aménagement d'un plateau de bureaux : îlots de 4 postes, salle de réunion vitrée, coin détente, rangements. */
function amenagerBureaux(res, l, p, nbPostes, accent) {
  const postes = [];
  const g = res.g;
  // salle de réunion vitrée au fond à gauche
  const rl = Math.min(5.5, l * 0.32);
  const rp = Math.min(4.4, p * 0.38);
  const rx = -l / 2 + rl / 2 + 0.3;
  const rz = -p / 2 + rp / 2 + 0.3;
  for (const [x, z, ll, pp] of [[rx + rl / 2, rz, 0.05, rp], [rx, rz + rp / 2, rl, 0.05]]) {
    g.add(piece(B(ll || 0.05, 2.4, pp || 0.05), matVerre, x, 0.18, z, false));
    g.add(piece(B(ll || 0.06, 0.06, pp || 0.06), mat(P.cadre), x, 2.55, z, false));
  }
  const table = modele('table_medium_long', [0.7, 0.74, 0.65]);
  if (table) g.add(placer(table, rx, 0.18, rz));
  for (let i = 0; i < 6; i++) {
    const c = modele('chair_B', 0.72);
    const cote = i < 3 ? -1 : 1;
    if (c) g.add(placer(c, rx - 0.75 + (i % 3) * 0.75, 0.18, rz + cote * 0.95, cote < 0 ? 0 : Math.PI));
  }
  g.add(piece(B(1.6, 0.9, 0.05), mat(P.ecran, { emissive: 0x3a6ea5, emissiveIntensity: 0.3 }), rx, 1.2, -p / 2 + 0.35, false));
  // coin détente devant à gauche
  const dx = -l / 2 + 2.4;
  const dz = p / 2 - 2.0;
  const tapis = modele('rug_rectangle_stripes_A', 0.9, false);
  if (tapis) g.add(placer(tapis, dx, 0.18, dz));
  const canape = modele('couch_pillows', 0.7);
  if (canape) g.add(placer(canape, dx, 0.18, dz - 0.7));
  const tb = modele('table_low', 0.6);
  if (tb) g.add(placer(tb, dx, 0.18, dz + 0.3));
  const lampe = modele('lamp_standing', 0.7);
  if (lampe) g.add(placer(lampe, dx + 1.6, 0.18, dz - 0.8));
  // rangements le long du mur du fond
  for (let i = 0; i < 3; i++) {
    const ar = modele(i % 2 ? 'cabinet_medium_decorated' : 'shelf_B_large_decorated', i % 2 ? 0.8 : [1, 2.2, 1]);
    if (ar) g.add(placer(ar, rx + rl / 2 + 1.6 + i * 2, 0.18, -p / 2 + 0.45));
  }
  for (const [x, z] of [[l / 2 - 0.7, -p / 2 + 0.7], [l / 2 - 0.7, p / 2 - 0.7], [-l / 2 + 0.7, 0]]) {
    const pl = modele('cactus_medium_A', 0.9);
    if (pl) g.add(placer(pl, x, 0.18, z));
  }
  // îlots de 4 postes (2 face à 2), à droite de la salle de réunion
  const x0 = -l / 2 + rl + 1.6;
  const x1 = l / 2 - 1.0;
  const z0 = -p / 2 + 1.6;
  const z1 = p / 2 - 1.2;
  const pasX = 3.6;
  const pasZ = 3.2;
  const parRang = Math.max(1, Math.floor((x1 - x0 - 0.8) / pasX) + 1) * 4;
  const rangs = Math.max(1, Math.min(Math.ceil(nbPostes / parRang), Math.floor((z1 - z0 - 1.6) / pasZ) + 1));
  const libre = z1 - z0 - 1.6 - (rangs - 1) * pasZ;
  const zDebut = z0 + Math.max(0, Math.min(libre / 2, 3));
  for (let z = zDebut; z + 1.6 <= z1 && postes.length < nbPostes; z += pasZ) {
    for (let x = x0 + 0.8; x + 0.8 <= x1 && postes.length < nbPostes; x += pasX) {
      for (const [dxp, sens] of [[0, 1], [0, -1]]) {
        for (const decal of [-0.82, 0.82]) {
          if (postes.length >= nbPostes) break;
          const pz = z + (sens > 0 ? 0.45 : -0.45);
          const px = x + decal + dxp;
          const ps = poste(accent);
          ps.position.set(px, 0.18, pz);
          ps.rotation.y = sens > 0 ? 0 : Math.PI;
          g.add(ps);
          postes.push({ pos: new THREE.Vector3(px, 0.18, pz + sens * 0.62), rot: sens > 0 ? Math.PI : 0, assis: true });
        }
      }
    }
  }
  return postes;
}

/** Bâtiment de MON entreprise selon son type : bureaux, entrepôt, atelier, boutique. */
function batimentPropre(lieu, nbPersonnes = 6, accent = P.cadre) {
  const icone = lieu.icone ?? lieu.type;
  const rayons = [];
  const parkings = [];
  const machines = [];
  let res;
  let postes = [];
  if (icone === 'entrepot') {
    res = coque(26, 16, 7.5, { sol: 'beton', murs: 'entrepot', accent });
    for (let i = 0; i < 8; i++) rayons.push(new THREE.Vector3(-9 + (i % 4) * 4.4, 0.18, i < 4 ? -4.8 : -0.6));
    for (const x of [-11, 11]) res.g.add(piece(PL(0.12, 15), matMarquage(0xe8c12a), x, 0.18, 0, false));
    res.g.add(piece(PL(24, 0.12), matMarquage(0xe8c12a), 0, 0.18, 1.8, false));
    const table = new THREE.Group();
    table.add(piece(B(3, 0.9, 1), mat(P.bois), 0, 0, 0));
    for (let i = 0; i < 4; i++) table.add(piece(B(0.5, 0.4, 0.5), mat(P.carton), -1.1 + i * 0.7, 0.9, 0));
    res.g.add(placer(table, 6, 0.18, 4.5));
    res.courrier = new THREE.Vector3(10.5, 0.18, 6);
    for (let i = 0; i < Math.max(4, nbPersonnes); i++) postes.push({ pos: new THREE.Vector3(-8 + (i % 6) * 2.8, 0.18, 4.2 + Math.floor(i / 6) * 1.6), rot: Math.PI, assis: false });
    res.g.add(piece(B(26, 1.2, 3.2), mat(P.beton), 0, 0, 9.6));
    machines.push(new THREE.Vector3(-4, 0.18, 2.6), new THREE.Vector3(0, 0.18, 2.6));
    parkings.push(new THREE.Vector3(-8.5, 0, 14), new THREE.Vector3(0, 0, 14), new THREE.Vector3(8.5, 0, 14), new THREE.Vector3(-4, 0, 18));
  } else if (icone === 'atelier') {
    res = coque(22, 15, 6, { sol: 'beton', murs: 'entrepot', accent });
    for (const x of [-7, -3.4, 0.2]) {
      res.g.add(placer(etabli(), x, 0.18, -5.6));
      postes.push({ pos: new THREE.Vector3(x, 0.18, -4.7), rot: Math.PI, assis: false });
    }
    for (const x of [5.5, 8.5]) machines.push(new THREE.Vector3(x, 0.18, -4.5));
    for (let i = 0; i < 4; i++) rayons.push(new THREE.Vector3(-7 + i * 4.4, 0.18, 1.5));
    for (let i = 0; i < Math.max(0, nbPersonnes - 3); i++) postes.push({ pos: new THREE.Vector3(-6 + i * 1.9, 0.18, 4.8), rot: Math.PI, assis: false });
    res.g.add(piece(PL(20, 0.12), matMarquage(0xe8c12a), 0, 0.18, -1.8, false));
    res.courrier = new THREE.Vector3(9, 0.18, 5.6);
    parkings.push(new THREE.Vector3(-6, 0, 11.5), new THREE.Vector3(2, 0, 11.5), new THREE.Vector3(9, 0, 11.5));
  } else if (icone === 'magasin') {
    res = coque(16, 11, 3.8, { sol: 'carrelage', accent });
    for (let i = 0; i < 3; i++) {
      const et = modele('shelf_A_big', [1.2, 1.4, 1.2]);
      if (et) res.g.add(placer(et, -4 + i * 3.6, 0.18, -1.5));
      rayons.push(new THREE.Vector3(-4 + i * 3.6, 0.18, -3.8));
    }
    res.g.add(piece(B(3.4, 1.05, 0.8), mat(P.bois), 4.5, 0.18, 3));
    postes = [{ pos: new THREE.Vector3(4.5, 0.18, 2.2), rot: 0, assis: false }, { pos: new THREE.Vector3(-3, 0.18, 2), rot: 0, assis: false }];
    res.courrier = new THREE.Vector3(6.6, 0.18, 3.6);
    parkings.push(new THREE.Vector3(-4, 0, 9), new THREE.Vector3(4, 0, 9));
  } else {
    const siege = icone === 'siege';
    const [l, p] = siege ? [26, 17] : [18, 13];
    res = coque(l, p, 3.4, { sol: siege ? 'parquet' : 'moquette', accent });
    postes = amenagerBureaux(res, l, p, Math.max(4, Math.min(siege ? 20 : 12, nbPersonnes)), siege ? 0x5b7fa6 : 0x7a8f6a);
    const accueil = new THREE.Group();
    accueil.add(piece(B(2.6, 1.1, 0.7), mat(0xefe9df), 0, 0, 0));
    accueil.add(piece(B(2.7, 0.05, 0.8), mat(P.bois), 0, 1.1, 0, false));
    res.g.add(placer(accueil, l / 4, 0.18, p / 2 - 1.8));
    res.courrier = new THREE.Vector3(l / 4 + 2.4, 0.18, p / 2 - 1.8);
    parkings.push(new THREE.Vector3(-l / 4, 0, p / 2 + 3.5), new THREE.Vector3(0, 0, p / 2 + 3.5), new THREE.Vector3(l / 4, 0, p / 2 + 3.5), new THREE.Vector3(-l / 2 + 2, 0, p / 2 + 3.5));
  }
  return { ...res, postes, rayons, parkings, machines };
}

// ---------------------------------------------------------------- bâtiments des tiers (monde extérieur, fermés)
function maison() {
  const g = new THREE.Group();
  g.add(piece(B(8, 2.9, 6.5), matTex('facade', 3, 1), 0, 0, 0));
  const toit = geo('toitMaison', () => {
    const f = new THREE.Shape();
    f.moveTo(-4.5, 0); f.lineTo(4.5, 0); f.lineTo(0, 3.2); f.closePath();
    return new THREE.ExtrudeGeometry(f, { depth: 7.2, bevelEnabled: false }).translate(0, 0, -3.6);
  });
  g.add(piece(toit, matTex('ardoise', 2, 2), 0, 2.9, 0));
  g.add(piece(B(0.8, 1.8, 0.8), matTex('facade', 1, 1), 2.2, 4, -1));
  g.add(piece(B(1, 2.1, 0.06), mat(0x7a4b2f), 0, 0, 3.27, false));
  for (const x of [-2.6, 2.6]) g.add(piece(B(1.2, 1.2, 0.06), mat(0x23303c, { roughness: 0.1 }), x, 1.1, 3.27, false));
  for (let i = 0; i < 12; i++) g.add(piece(B(0.08, 0.8, 0.08), mat(0xf4f1ea), -5.5 + i, 0, 5.2, false));
  g.add(piece(B(11.5, 0.06, 0.06), mat(0xf4f1ea), 0, 0.7, 5.2, false));
  return g;
}
function mairie(couleur) {
  const g = new THREE.Group();
  g.add(piece(B(13, 0.5, 9.5), mat(P.pave2), 0, 0, 0));
  g.add(piece(B(12, 6, 8), matTex('facade', 4, 2), 0, 0.5, -0.3));
  for (let i = 0; i < 6; i++) g.add(piece(CY(0.32, 0.36, 4.8, 14), mat(0xf6f3ec), -4.5 + i * 1.8, 0.5, 4));
  g.add(piece(B(12.6, 0.8, 1.4), mat(0xebe5d8), 0, 5.3, 4));
  for (let et = 0; et < 2; et++) for (let i = 0; i < 5; i++) g.add(piece(B(1.1, 1.5, 0.06), mat(0x23303c, { roughness: 0.1 }), -4.4 + i * 2.2, 1.5 + et * 2.4, 3.72, false));
  g.add(piece(CY(0.05, 0.05, 6, 6), mat(P.sombre), 5, 6.5, -3, false));
  g.add(piece(B(1.8, 1.1, 0.03), mat(couleur), 5.95, 11.2, -3, false));
  return g;
}
function entrepotTiers(o, couleur) {
  const g = new THREE.Group();
  const act = `${val(o, 'activite') ?? ''} ${o.nom}`.toLowerCase();
  g.add(piece(B(13, 0.15, 11), mat(P.beton), 0, 0, 0));
  g.add(piece(B(12, 6.5, 8.5), matTex('tole', 6, 3), 0, 0.15, -0.8));
  const t = geo('toitEntrepot', () => {
    const f = new THREE.Shape();
    f.moveTo(-6.3, 0); f.lineTo(6.3, 0); f.lineTo(0, 1.6); f.closePath();
    return new THREE.ExtrudeGeometry(f, { depth: 9, bevelEnabled: false }).translate(0, 0, -4.5);
  });
  g.add(piece(t, mat(0xaab1b8, { metalness: 0.4, roughness: 0.4 }), 0, 6.65, -0.8));
  for (const x of [-3.6, 0, 3.6]) g.add(piece(B(3, 3.8, 0.1), mat(0x8c96a0, { metalness: 0.4, roughness: 0.4 }), x, 0.15, 3.48, false));
  g.add(piece(B(12, 1.1, 1.6), mat(P.beton), 0, 0.15, 4.3));
  const e = enseigne(nomCourt(o.nom), couleur, 7);
  e.position.set(0, 5.4, 3.48);
  g.add(e);
  if (/imprimerie|usine|industr|emballage/.test(act)) g.add(piece(CY(0.6, 0.8, 9, 14), mat(0xb24a3a), 4.2, 0.15, -4));
  if (/transport|logisti|négoce|negoce|grossiste/.test(act)) g.add(placer(camion(couleur), -8.4, 0.15, 1.5, Math.PI / 2));
  for (let i = 0; i < 3; i++) {
    g.add(piece(B(1.2, 0.14, 1.2), mat(0xb08a5a), 4 + i * 1.4, 0.15, 6.4, false));
    g.add(piece(B(1.1, 0.9, 1.1), mat(P.carton), 4 + i * 1.4, 0.29, 6.4));
  }
  return g;
}
function batimentTiers(o, couleur) {
  const roles = o.roles.map((r) => r.id);
  const act = `${val(o, 'activite') ?? ''} ${o.nom}`.toLowerCase();
  if (o.type === 'particulier') return maison();
  if (o.type === 'organisme_public') return mairie(couleur);
  const fournisseurSeul = roles.includes('fournisseur') && !roles.includes('client');
  if (fournisseurSeul || /transport|négoce|negoce|grossiste|usine|imprimerie|industr|logisti|coopérative|emballage|énergie/.test(act)) return entrepotTiers(o, couleur);
  const g = new THREE.Group();
  const noms = /hôtel|hotel/.test(act) ? ['building_G', 'building_H'] : roles.includes('partenaire') ? ['building_E', 'building_F'] : ['building_A', 'building_B', 'building_C', 'building_D'];
  const nom = noms[hash(o.id) % noms.length];
  const b = modele(nom, 4.8);
  if (b) {
    g.add(b);
  } else {
    g.add(piece(B(9.6, 7, 9.6), matTex('facade', 4, 3), 0, 0, 0));
  }
  const e = enseigne(nomCourt(o.nom), couleur, 5.5);
  e.position.set(0, 3.3, 4.95);
  g.add(e);
  if (/restaurant|brasserie|crêperie|creperie|café|cafe|bar\b/.test(act)) {
    for (const x of [-2.8, 0, 2.8]) {
      g.add(piece(CY(0.45, 0.45, 0.05, 14), mat(0xf4f1ea), x, 0.75, 6.6));
      g.add(piece(CY(0.04, 0.04, 0.75, 6), mat(P.metal), x, 0, 6.6, false));
      g.add(piece(CY(0.03, 0.03, 2.3, 6), mat(P.metal), x, 0.75, 6.6, false));
      g.add(piece(geo('parasol', () => new THREE.ConeGeometry(1.2, 0.5, 10).translate(0, 0.25, 0)), mat(couleur), x, 2.95, 6.6));
    }
  }
  if (/camping/.test(act)) {
    for (const [x, z, c] of [[-4, 6, couleur], [4, 6.5, 0xe08a2e]]) {
      const tente = piece(geo('tente', () => new THREE.ConeGeometry(1.4, 1.8, 4).translate(0, 0.9, 0)), mat(c), x, 0, z);
      tente.rotation.y = Math.PI / 4;
      g.add(tente);
    }
  }
  return g;
}

// ---------------------------------------------------------------- départements
const COULEURS_DEP = { bleu: 0x2f6fb0, orange: 0xd07a2b, vert: 0x3f8a52, violet: 0x7a48c9, rouge: 0xc0392b, turquoise: 0x16a085, jaune: 0xd9a520, ardoise: 0x4b5563 };
const ORDRE_COULEURS = ['bleu', 'orange', 'vert', 'violet', 'turquoise', 'jaune', 'rouge', 'ardoise'];
const STATUTS_TACHE = [['à faire', 0xf2c230], ['en cours', 0x5b9bf0], ['bloquée', 0xd23b2f], ['terminée', 0x5aa86b]];
function teinte(c, t = 0.78) {
  return new THREE.Color(c).lerp(new THREE.Color(0xffffff), t).getHex();
}
export function couleurDepartement(dep, index = 0) {
  const nom = dep.champs?.find((c) => c.id === 'couleur')?.valeur;
  return COULEURS_DEP[nom] ?? COULEURS_DEP[ORDRE_COULEURS[index % ORDRE_COULEURS.length]];
}
function totem(nom, couleur) {
  const g = new THREE.Group();
  g.add(piece(B(0.18, 2.4, 0.18), mat(P.sombre), 0, 0, 0));
  g.add(piece(B(3.4, 0.7, 0.14), mat(couleur), 0, 2.3, 0));
  const e = enseigne(nom, couleur, 3.3);
  e.position.set(0, 2.65, 0.08);
  g.add(e);
  return g;
}
function tableauTaches(compte) {
  const g = new THREE.Group();
  for (const x of [-1.9, 1.9]) g.add(piece(B(0.06, 1.0, 0.06), mat(P.metal), x, 0, 0, false));
  g.add(piece(B(4.2, 1.3, 0.05), mat(0xfbfbf8), 0, 1.0, 0));
  STATUTS_TACHE.forEach(([statut, c], col) => {
    const x = -1.55 + col * 1.03;
    for (const f of [0.035, -0.035]) g.add(piece(B(0.95, 0.1, 0.012), mat(c), x, 2.18, f, false));
    const n = Math.min(6, compte[statut] ?? 0);
    for (let i = 0; i < n; i++) for (const f of [0.035, -0.035]) g.add(piece(B(0.3, 0.25, 0.012), mat(c, { roughness: 0.95 }), x - 0.18 + (i % 2) * 0.36, 1.9 - Math.floor(i / 2) * 0.3, f, false));
  });
  return g;
}
function pileDossiers(n) {
  const g = new THREE.Group();
  const t = modele('table_small', 0.7);
  if (t) g.add(t); else g.add(piece(B(0.8, 0.72, 0.8), mat(P.bois), 0, 0, 0));
  const h = Math.min(0.9, 0.04 * n);
  if (n > 0) g.add(piece(B(0.42, h, 0.32), mat(0xf6f3ea), 0, 0.72, 0));
  if (n > 6) g.add(piece(B(0.42, 0.02, 0.32), mat(P.critique), 0, 0.72 + h, 0, false));
  return g;
}
/** Bac à courrier sur un meuble bas : une enveloppe par courrier à traiter, drapeau rouge si urgent. */
function bacCourrier(n, urgents) {
  const g = new THREE.Group();
  const meuble = modele('table_small', 0.7);
  if (meuble) g.add(meuble); else g.add(piece(B(0.8, 0.72, 0.8), mat(P.bois), 0, 0, 0));
  const fil = mat(0x6b7280, { metalness: 0.6, roughness: 0.35 });
  for (const [x, z, w, d] of [[0, -0.2, 0.5, 0.02], [0, 0.2, 0.5, 0.02], [-0.25, 0, 0.02, 0.4], [0.25, 0, 0.02, 0.4]]) g.add(piece(B(w, 0.12, d), fil, x, 0.72, z, false));
  const rnd = alea(n * 31 + urgents);
  const papiers = [0xffffff, 0xf3ead7, 0xe9eef5];
  for (let i = 0; i < Math.min(12, n); i++) {
    const env = piece(B(0.44, 0.018, 0.3), mat(papiers[i % 3], { roughness: 0.95 }), (rnd() - 0.5) * 0.04, 0.73 + i * 0.022, (rnd() - 0.5) * 0.04, false);
    env.rotation.y = (rnd() - 0.5) * 0.25;
    g.add(env);
  }
  if (urgents) {
    g.add(piece(B(0.012, 0.42, 0.012), mat(P.metal), 0.22, 0.72, -0.16, false));
    g.add(piece(B(0.16, 0.1, 0.008), mat(P.critique, { emissive: P.critique, emissiveIntensity: 0.3 }), 0.3, 1.04, -0.16, false));
  }
  return g;
}
function casque() {
  return piece(geo('casque', () => new THREE.SphereGeometry(0.135, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5)), mat(0xf2c230, { roughness: 0.45 }), 0, 0, 0, false);
}

/** Plateau d'un service DANS le siège : moquette à sa couleur, îlots de postes, salle de réunion,
 *  tableau des tâches, dossiers, bac à courrier, zone de stock si besoin. Pas de murs : on voit tout. */
function plateauDepartement(nom, couleur, compo, l, p) {
  const g = new THREE.Group();
  const pStock = compo.articles > 0 ? Math.min(7.5, p * 0.32) : 0;
  const pBureaux = p - pStock;
  g.add(piece(B(l - 0.3, 0.012, p - 0.3), mat(teinte(couleur, 0.62), { roughness: 0.97 }), 0, 0.182, 0, false));
  const oz = -p / 2 + pBureaux / 2;
  const zone = new THREE.Group();
  zone.position.z = oz;
  g.add(zone);
  zone.add(piece(B(l - 5.4, 0.012, pBureaux - 1.4), mat(teinte(couleur, 0.4), { roughness: 0.97 }), 2.4, 0.19, 0.2, false));
  const postes = amenagerBureaux({ g: zone }, l, pBureaux, Math.max(1, compo.employes), teinte(couleur, 0.2)).map((ps) => ({ ...ps, pos: ps.pos.clone().setZ(ps.pos.z + oz) }));
  const tableau = tableauTaches(compo.taches);
  tableau.position.set(-l / 2 + 0.4, 0.18, oz + 1.2);
  tableau.rotation.y = Math.PI / 2;
  g.add(tableau);
  g.add(placer(pileDossiers(compo.documents), l / 2 - 1.1, 0.18, oz + pBureaux / 2 - 1.3));
  // enseigne suspendue du service, lisible depuis l'allée
  const e = enseigne(nom, couleur, Math.min(6, l * 0.42));
  e.position.set(1.5, 2.85, -p / 2 + 0.22);
  g.add(e);
  for (const x of [-1, 1]) g.add(piece(B(0.02, 0.6, 0.02), mat(P.metal), 1.5 + x * Math.min(6, l * 0.42) * 0.4, 3.2, -p / 2 + 0.22, false));
  const rayons = [];
  const machines = [];
  if (pStock) {
    g.add(piece(B(l - 1, 0.012, 0.12), mat(0xe8c12a), 0, 0.2, p / 2 - pStock, false));
    const n = Math.max(2, Math.floor((l - 3) / 3.7));
    for (let i = 0; i < n; i++) rayons.push(new THREE.Vector3(-l / 2 + 2.2 + i * 3.7, 0.18, p / 2 - pStock / 2 - 0.4));
    machines.push(new THREE.Vector3(-l / 2 + 1.6, 0.18, p / 2 - 1.2), new THREE.Vector3(l / 2 - 1.6, 0.18, p / 2 - 1.2));
  } else {
    machines.push(new THREE.Vector3(-l / 2 + 1.4, 0.18, p / 2 - 1.4), new THREE.Vector3(l / 2 - 1.4, 0.18, p / 2 - 1.4));
    if (p >= 14) {
      // espace de travail collectif côté allée : grande table, chaises, rangements, plantes
      const tx = l / 4;
      const tz = p / 2 - 2.8;
      const table = modele('table_medium_long', [0.9, 0.74, 0.8]);
      if (table) g.add(placer(table, tx, 0.18, tz));
      for (let i = 0; i < 6; i++) {
        const c = modele('chair_A', 0.72);
        const cote = i < 3 ? -1 : 1;
        if (c) g.add(placer(c, tx - 0.9 + (i % 3) * 0.9, 0.18, tz + cote * 1.05, cote < 0 ? 0 : Math.PI));
      }
      for (let i = 0; i < 2; i++) {
        const ar = modele('cabinet_medium_decorated', 0.8);
        if (ar) g.add(placer(ar, l / 2 - 0.5, 0.18, tz - 1.2 + i * 1.3, -Math.PI / 2));
      }
      const pl = modele('cactus_medium_A', 1);
      if (pl) g.add(placer(pl, -l / 2 + 0.8, 0.18, p / 2 - 0.8));
      const lampe = modele('lamp_standing', 0.7);
      if (lampe) g.add(placer(lampe, tx + 2.4, 0.18, tz - 1.4));
    }
  }
  const courrier = new THREE.Vector3(l / 2 - 1.1, 0.18, oz + pBureaux / 2 - 3.1);
  return { g, murs: [], toit: null, postes, rayons, parkings: [], machines, courrier, l, p };
}

/** Le siège : TOUS les services dans un même bâtiment (plateaux vitrés le long d'allées), hall d'accueil
 *  avec banque, enseigne et courrier général. Ce qui est dehors est extérieur à l'entreprise. */
function siegeDepartements(nomOrg, compos) {
  const n = compos.length;
  const besoin = (c) => Math.max(11, 6.4 + Math.ceil(Math.max(1, c.employes) / 12) * 3.2) + (c.articles > 0 ? 7.5 : 0);
  const cols = n <= 2 ? Math.max(1, n) : n <= 4 ? 2 : n <= 6 ? 3 : 4;
  const rangs = Math.max(1, Math.ceil(n / cols));
  const L = n <= 2 ? 44 : n <= 4 ? 56 : 74;
  const hall = 6.5;
  const allee = 3;
  const sep = 1.2;
  const zoneL = (L - 1 - (cols - 1) * sep) / cols;
  const zoneP = Math.min(24, (52 - hall - 1 - (rangs - 1) * allee) / rangs, Math.max(11, ...compos.map(besoin)));
  const prof = hall + rangs * zoneP + (rangs - 1) * allee + 1;
  const res = coque(L, prof, 3.8, { sol: 'carrelage', accent: P.cadre });
  const g = res.g;
  const zones = [];
  for (let i = 0; i < n; i++) {
    const c = i % cols;
    const r = Math.floor(i / cols);
    zones.push({ x: -L / 2 + 0.5 + zoneL / 2 + c * (zoneL + sep), z: -prof / 2 + 0.5 + zoneP / 2 + r * (zoneP + allee), l: zoneL, p: zoneP, c, r });
  }
  // cloisons vitrées entre services (avec passage côté allée) et allées
  for (let r = 0; r < rangs; r++) {
    const z = -prof / 2 + 0.5 + zoneP / 2 + r * (zoneP + allee);
    for (let c = 1; c < cols; c++) {
      const x = -L / 2 + 0.5 + c * (zoneL + sep) - sep / 2;
      g.add(piece(B(0.05, 2.4, zoneP - 2.4), matVerre, x, 0.18, z - 1.2, false));
      g.add(piece(B(0.08, 0.06, zoneP - 2.4), mat(P.cadre), x, 2.58, z - 1.2, false));
      g.add(piece(B(0.1, 0.012, zoneP), mat(0xc9ced4), x, 0.19, z, false));
    }
    if (r < rangs - 1) g.add(piece(B(L - 1, 0.012, allee - 0.4), mat(0xdfe3e7, { roughness: 0.9 }), 0, 0.19, z + zoneP / 2 + allee / 2, false));
  }
  // hall d'accueil
  const zHall = prof / 2 - hall / 2 - 0.3;
  g.add(piece(B(L - 1, 0.012, hall - 0.6), mat(0xe9e4da, { roughness: 0.85 }), 0, 0.19, zHall, false));
  const banque = new THREE.Group();
  banque.add(piece(B(4.2, 1.1, 0.8), mat(0xf2efe8), 0, 0, 0));
  banque.add(piece(B(4.4, 0.06, 1.0), mat(P.bois), 0, 1.1, 0, false));
  banque.add(piece(B(4.2, 0.2, 0.05), mat(0x1d63d6), 0, 0.75, 0.42, false));
  g.add(placer(banque, 0, 0.18, zHall - 0.6));
  const logo = enseigne(nomOrg, 0x141c26, 7);
  logo.position.set(0, 2.6, zHall - 2.4);
  g.add(logo);
  g.add(piece(B(7.6, 1.6, 0.12), mat(0x22303d), 0, 1.85, zHall - 2.5, false));
  for (const x of [-L / 2 + 3, L / 2 - 3]) {
    const pl = modele('cactus_medium_A', 1.1);
    if (pl) g.add(placer(pl, x, 0.18, zHall));
    const can = modele('couch_pillows', 0.75);
    if (can) g.add(placer(can, x + (x < 0 ? 3 : -3), 0.18, zHall + 1.2, Math.PI));
  }
  const postes = [{ pos: new THREE.Vector3(-0.9, 0.18, zHall - 1.3), rot: 0, assis: false }, { pos: new THREE.Vector3(0.9, 0.18, zHall - 1.3), rot: 0, assis: false }];
  for (let i = 0; i < 10; i++) postes.push({ pos: new THREE.Vector3(-6 + (i % 5) * 3, 0.18, zHall + 1.4 + Math.floor(i / 5) * 1.1), rot: Math.PI, assis: false });
  const parkings = [];
  for (let i = 0; i < 14; i++) parkings.push(new THREE.Vector3(-L / 2 + 4 + i * ((L - 8) / 13), 0, prof / 2 + 3.6));
  const courrier = new THREE.Vector3(2.8, 0.18, zHall - 0.6);
  return { ...res, postes, rayons: [], parkings, machines: [], courrier, zones, l: L, p: prof };
}

// ---------------------------------------------------------------- phare Breizhcosystem (§5.5, §5.8)
/** Phare sur la jetée : éteint sans Breizhcosystem, allumé et tournant (une rotation en 8 s) quand l'entreprise est reliée. */
function phare(apparence) {
  const g = new THREE.Group();
  const actif = apparence === 'actif';
  const allume = actif || apparence === 'gratuit' || apparence === 'en_attente';
  g.add(piece(geo('rocher', () => new THREE.DodecahedronGeometry(5, 0).scale(1, 0.45, 1)), mat('granit', { flatShading: true }), 0, -0.8, 0));
  g.add(piece(CY(1.9, 2.5, 15, 24), mat('chaux'), 0, 0.8, 0));
  for (const y of [5, 10]) g.add(piece(CY(2.2 - y * 0.03, 2.25 - y * 0.03, 1.6, 24), mat('ardoise'), 0, y, 0, false));
  g.add(piece(CY(2.5, 2.5, 0.3, 24), mat(P.sombre), 0, 15.8, 0));
  const lanterne = new THREE.MeshBasicMaterial({ color: allume ? couleurDe('phare') : couleurDe('granit') });
  if (allume) suivre(lanterne, 'phare');
  const lampe = piece(CY(1.3, 1.3, 2.2, 18), lanterne, 0, 16.1, 0, false);
  lampe.userData.jetable = 'materiau';
  g.add(lampe);
  g.add(piece(geo('chapeau', () => new THREE.ConeGeometry(1.7, 1.6, 18).translate(0, 0.8, 0)), mat('ardoise'), 0, 18.3, 0));
  g.add(placer(maison(), -6.2, 0.5, 2.4, 0.3));
  let faisceau = null;
  if (allume) {
    // faisceau additif (§5.2) : il éclaire sans masquer ce qu'il traverse
    const m = new THREE.MeshBasicMaterial({ color: couleurDe('phare'), transparent: true, opacity: actif ? 0.22 : 0.08, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
    suivre(m, 'phare');
    faisceau = new THREE.Mesh(geo('faisceau', () => new THREE.ConeGeometry(2.6, 40, 20, 1, true).rotateZ(Math.PI / 2).translate(20, 0, 0)), m);
    faisceau.position.y = 17;
    faisceau.userData.jetable = 'materiau';
    g.add(faisceau);
  }
  g.scale.setScalar(0.9);
  return { g, faisceau, lanterne };
}

// ---------------------------------------------------------------- niveaux du port (§4.25, §5.9)
/**
 * Élément du décor débloqué par un niveau : 1 Cale · 2 Quai · 3 Grue · 4 Port de pêche · 5 Marché couvert ·
 * 6 Chantier naval · 7 Criée · 8 Phare restauré · 9 Ferry · 10 Port de commerce. Mêmes emplacements pour tout le monde,
 * sur l'eau ou au bord, loin des entités ; jamais une fonction. Couleurs : les rôles de la palette de la scène.
 */
function elementNiveau(n) {
  const { zCote } = PLATEAU;
  const g = new THREE.Group();
  g.userData.niveau = n;
  const poser = (geom, m, x, y, z, ombre = true) => { const p = piece(geom, m, x, y, z, ombre); g.add(p); return p; };
  const coque = (x, z, l, r = 0) => {
    const b = new THREE.Group();
    b.add(piece(geo('coque', () => new THREE.CylinderGeometry(1.2, 0.8, 6, 10, 1).rotateZ(Math.PI / 2).scale(1, 0.6, 1)), mat('bois'), 0, 0.4, 0));
    b.add(piece(B(1.8, 1.1, 1.4), mat(P.mur), -0.6, 0.9, 0));
    b.add(piece(CY(0.06, 0.06, 5, 6), mat(P.sombre), 1, 0.9, 0, false));
    b.position.set(x, -0.7, z);
    b.rotation.y = r;
    b.scale.setScalar(l);
    g.add(b);
  };
  const ponton = (x, z, l, p) => poser(B(l, 0.6, p), mat('granit'), x, -0.7, z);
  if (n === 1) { const r = poser(B(5, 0.4, 10), mat('granit'), -28, -0.9, zCote + 3); r.rotation.x = 0.12; }
  if (n === 2) {
    poser(B(16, 1.2, 5), mat('granit'), 34, -0.8, zCote + 2.5);
    for (const x of [28, 34, 40]) poser(CY(0.25, 0.3, 0.7, 8), mat(P.sombre), x, 0.4, zCote + 4.4, false);
  }
  if (n === 3) {
    poser(CY(0.5, 0.7, 9, 8), mat('ardoise'), 12, 0, zCote + 2.5);
    poser(B(9, 0.5, 0.5), mat('ardoise'), 15.5, 8.6, zCote + 2.5);
    poser(B(1.6, 1.4, 1.6), mat('chaux'), 12, 7.6, zCote + 2.5);
    poser(CY(0.05, 0.05, 4, 4), mat(P.sombre), 19.5, 4.6, zCote + 2.5, false);
  }
  if (n === 4) { coque(-8, zCote + 12, 0.8, 0.3); coque(9, zCote + 13, 0.8, -0.4); }
  if (n === 5) {
    ponton(-42, zCote + 8, 14, 8);
    for (const [x, z] of [[-48, zCote + 5], [-36, zCote + 5], [-48, zCote + 11], [-36, zCote + 11]]) poser(CY(0.3, 0.3, 4, 8), mat('ardoise'), x, -0.1, z, false);
    poser(B(14.6, 0.5, 8.6), mat('ardoise'), -42, 3.9, zCote + 8);
    for (const x of [-46, -42, -38]) poser(B(2.6, 0.9, 1.4), mat('bois'), x, -0.1, zCote + 8);
  }
  if (n === 6) {
    ponton(44, zCote + 9, 12, 8);
    for (const x of [41, 47]) poser(B(0.6, 1.4, 3), mat('bois'), x, -0.1, zCote + 9);
    coque(44, zCote + 9, 1.1, 0);
    g.children.at(-1).position.y = 1.4;
    for (const x of [39, 49]) poser(CY(0.12, 0.12, 6, 6), mat('bois'), x, -0.1, zCote + 6, false);
    poser(B(10.4, 0.2, 0.2), mat('bois'), 44, 5.8, zCote + 6, false);
  }
  if (n === 7) {
    ponton(-70, zCote + 7, 16, 8);
    poser(B(14, 3, 6), matTex('facade', 4, 1), -70, -0.1, zCote + 7);
    poser(B(14.6, 0.6, 6.6), mat('ardoise'), -70, 2.9, zCote + 7);
  }
  if (n === 8) {
    // phare restauré : une bande repeinte à la couleur de sa lumière (le phare est mis à l'échelle 0,9)
    poser(CY(2.04, 2.08, 1.2, 24), mat('phare'), 0, 6.2, zCote + 17, false);
    poser(CY(1.86, 1.9, 0.9, 24), mat('phare'), 0, 11.4, zCote + 17, false);
  }
  if (n === 9) {
    poser(B(18, 2.2, 5), mat('chaux'), -30, -0.9, zCote + 20);
    poser(B(12, 1.6, 4), mat('chaux'), -31, 1.3, zCote + 20);
    poser(B(4, 1.2, 3), mat('ardoise'), -27, 2.9, zCote + 20);
    poser(CY(0.6, 0.7, 2.2, 10), mat('ardoise'), -34, 2.9, zCote + 20);
  }
  if (n === 10) {
    ponton(74, zCote + 8, 18, 9);
    const teintes = ['bois', 'ardoise', 'chaux'];
    for (let i = 0; i < 6; i++) poser(B(4, 1.4, 1.8), mat(teintes[i % 3]), 68 + (i % 3) * 4.4, -0.1 + Math.floor(i / 3) * 1.45, zCote + 6.5 + (i % 2) * 2.2);
    poser(B(16, 2.6, 4.6), mat('ardoise'), 80, -0.9, zCote + 19);
    poser(B(3, 3, 4), mat('chaux'), 86, 1.7, zCote + 19);
  }
  return g;
}

// ---------------------------------------------------------------- plan
const PLATEAU = { x0: -96, x1: 96, z0: -70, zCote: 48, z1: 72 };
const ROUTES = [
  { a: [-96, -40], b: [96, -40], l: 7 },
  { a: [-96, 0], b: [96, 0], l: 8 },
  { a: [-96, 37], b: [96, 37], l: 7 },
  { a: [-46, -70], b: [-46, 37], l: 7 },
  { a: [46, -70], b: [46, 37], l: 7 },
  { a: [0, -70], b: [0, 45], l: 8 },
];
/** Cœur de « Mon entreprise » : la voirie qui le traverse s'efface quand tous les services sont dans le siège. */
const CENTRE = { x0: -42.5, x1: 42.5, z0: -36.5, z1: 33.5 };
const CARREFOURS = [[-46, 0], [46, 0], [0, 0], [-46, -40], [46, -40], [0, -40], [-46, 37], [46, 37], [0, 37]];
const ZONES = {
  clients: { x0: -93, x1: -51, z0: -35, z1: 32, face: 'x+' },
  fournisseurs: { x0: 51, x1: 93, z0: -35, z1: 32, face: 'x-' },
  nord: { x0: -93, x1: 93, z0: -68, z1: -45, face: 'z+' },
  prospects: { x0: -93, x1: -51, z0: 41, z1: 47, face: 'z-' },
  autres: { x0: 51, x1: 93, z0: 41, z1: 47, face: 'z-' },
};
const EMPLACEMENTS_PROPRES = [[-21, 18.5, Math.PI], [21, 18.5, Math.PI], [-21, -20, 0], [21, -20, 0]];
const EMPLACEMENTS_DEP = [[-33, -20], [-11.5, -20], [11.5, -20], [33, -20], [-33, 18.5], [-11.5, 18.5], [11.5, 18.5], [33, 18.5]];
const ROTATION_FACE = { 'x+': Math.PI / 2, 'x-': -Math.PI / 2, 'z+': 0, 'z-': Math.PI };

function lots(zone, n) {
  const w = zone.x1 - zone.x0;
  const h = zone.z1 - zone.z0;
  let taille = 17;
  let cols = 1;
  let rangs = 1;
  while (taille >= 8) {
    cols = Math.max(1, Math.floor(w / taille));
    rangs = Math.max(1, Math.floor(h / taille));
    if (cols * rangs >= n) break;
    taille -= 1;
  }
  const res = [];
  for (let i = 0; i < Math.min(n, cols * rangs); i++) {
    res.push({
      x: zone.x0 + (w - cols * taille) / 2 + ((i % cols) + 0.5) * taille,
      z: zone.z0 + (h - rangs * taille) / 2 + (Math.floor(i / cols) + 0.5) * taille,
      echelle: Math.min(1, taille / 17),
    });
  }
  return res;
}
function secteur(o) {
  const r = o.roles.map((x) => x.id);
  if (r.includes('client') && r.includes('fournisseur')) return 'nord';
  if (r.includes('fournisseur')) return 'fournisseurs';
  if (r.includes('client')) return 'clients';
  if (r.includes('partenaire') || r.includes('sous_traitant')) return 'nord';
  if (r.includes('prospect')) return 'prospects';
  return 'autres';
}
function couleurTiers(o) {
  const r = o.roles.map((x) => x.id);
  if (r.includes('client') && r.includes('fournisseur')) return P.mixte;
  if (r.includes('fournisseur')) return P.fournisseur;
  if (r.includes('client')) return P.client;
  if (r.includes('partenaire')) return P.partenaire;
  if (r.includes('prospect')) return P.prospect;
  return P.autre;
}
const RANG = { critique: 0, attention: 1, info: 2 };
const trierNiveau = (l) => [...l].sort((a, b) => (RANG[a.statut === 'a_verifier' ? 'info' : a.gravite] ?? 3) - (RANG[b.statut === 'a_verifier' ? 'info' : b.gravite] ?? 3));
function anneauPointille(r1, r2, n) {
  const pos = [];
  const idx = [];
  const pas = (Math.PI * 2) / n;
  for (let i = 0; i < n; i++) {
    const g = new THREE.RingGeometry(r1, r2, 4, 1, i * pas, pas * 0.55);
    const base = pos.length / 3;
    pos.push(...g.attributes.position.array);
    for (const k of g.index.array) idx.push(base + k);
    g.dispose();
  }
  const res = new THREE.BufferGeometry();
  res.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  res.setIndex(idx);
  res.computeVertexNormals();
  res.rotateX(-Math.PI / 2);
  return res;
}

// ---------------------------------------------------------------- sols des quartiers (§5.5) : motif dessiné dans le shader
const MOTIFS = `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec3 motifSol(int n, vec2 p) {
  if (n == 1) { // pavés de granit rose, damier à deux tons
    vec2 c = floor(p / 1.1); vec2 f = fract(p / 1.1);
    float joint = step(0.9, max(f.x, f.y));
    float v = mix(1.0, 0.9, mod(c.x + c.y, 2.0)) * (0.96 + 0.08 * h21(c));
    return vec3(v * (1.0 - 0.22 * joint));
  }
  if (n == 2) { // enrobé, marquages blancs
    float g = 0.93 + 0.1 * h21(floor(p * 2.5));
    float ligne = step(0.975, fract(p.x / 5.5)) * step(0.35, fract(p.y / 9.0));
    return mix(vec3(g), vec3(1.5), ligne);
  }
  if (n == 3) { // pelouse tondue en bandes
    float b = step(0.5, fract((p.x + p.y * 0.3) / 7.0));
    return vec3(mix(0.95, 1.05, b) * (0.95 + 0.08 * h21(floor(p * 1.5))));
  }
  if (n == 4) { // planches de quai
    float l = floor(p.y / 0.4); float f = fract(p.y / 0.4);
    float decal = h21(vec2(l, 3.0)) * 4.0;
    float bout = step(0.97, fract((p.x + decal) / 4.0));
    float v = 0.9 + 0.14 * h21(vec2(l, floor((p.x + decal) / 4.0)));
    return vec3(v * (1.0 - 0.3 * max(step(0.88, f), bout)));
  }
  float r = 0.97 + 0.05 * sin(p.x * 1.3 + sin(p.y * 0.5) * 2.0); // sable du marché
  return vec3(r * (0.96 + 0.06 * h21(floor(p * 3.0))));
}`;
const SOLS = Object.freeze({ clients: 1, fournisseurs: 2, equipe: 3, stock: 4, prospects: 5 });
function matSol(quartier) {
  const k = `sol|${quartier}`;
  if (!mats.has(k)) {
    const m = suivre(nouveau({ roughness: 0.95 }), `quartier-${quartier}`);
    const n = SOLS[quartier];
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = `varying vec3 vPosSol;\n${sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vPosSol = (modelMatrix * vec4(position, 1.0)).xyz;')}`;
      sh.fragmentShader = `varying vec3 vPosSol;\n${MOTIFS}\n${sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\n  diffuseColor.rgb = min(diffuseColor.rgb * motifSol(${n}, vPosSol.xz), vec3(1.0));`)}`;
    };
    m.customProgramCacheKey = () => `sol-${n}`;
    mats.set(k, m);
  }
  return mats.get(k);
}

/** Fusionne les maillages d'un groupe par matériau (appels de dessin, §5.10). garder(mesh) → true : laissé à part. */
function fusionner(groupe, garder = () => false) {
  groupe.updateMatrixWorld(true);
  const inverse = new THREE.Matrix4().copy(groupe.matrixWorld).invert();
  const paquets = new Map();
  const retires = [];
  groupe.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o === groupe || o.userData.jetable || o.userData.coque || garder(o)) return;
    for (let p = o.parent; p && p !== groupe; p = p.parent) if (p.userData.garder || !p.visible) return;
    if (Array.isArray(o.material) || !o.geometry?.attributes?.position) return;
    const g = o.geometry;
    const noms = Object.keys(g.attributes).filter((n) => ['position', 'normal', 'uv', 'color'].includes(n)).sort();
    if (!noms.includes('normal')) return;
    const cle = `${o.material.uuid}|${noms.join(',')}|${g.index ? 'i' : 'n'}|${o.castShadow ? 'o' : ''}`;
    if (!paquets.has(cle)) paquets.set(cle, { m: o.material, ombre: o.castShadow, liste: [] });
    const copie = new THREE.BufferGeometry();
    for (const n of noms) copie.setAttribute(n, g.attributes[n].clone()); // copie : la géométrie d’origine est souvent partagée (cache)
    if (g.index) copie.setIndex(g.index);
    copie.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, o.matrixWorld));
    paquets.get(cle).liste.push(copie);
    retires.push(o);
  });
  for (const o of retires) o.parent?.remove(o);
  for (const { m, ombre, liste } of paquets.values()) {
    const fusion = liste.length === 1 ? liste[0] : mergeGeometries(liste, false);
    if (!fusion) continue;
    if (liste.length > 1) for (const l of liste) l.dispose();
    const me = new THREE.Mesh(fusion, m);
    me.castShadow = ombre;
    me.receiveShadow = PROFIL.ombres > 0;
    me.userData.jetable = 'geometrie';
    groupe.add(me);
  }
}

/** Nom de quartier écrit au sol (niveau 1, §5.6) : Fraunces 600, encre à 100 % et halo de 3 px, jamais d'opacité. */
/** Taille, en pixels de texture, des noms de quartier écrits au sol (pas une taille d'interface). */
const TAILLE_NOM_SOL = 96;
function toileTexte(texte, encre, halo) {
  const px = TAILLE_NOM_SOL;
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const police = `600 ${px}px Fraunces, "Fraunces repli", Georgia, serif`;
  ctx.font = police;
  c.width = Math.ceil(ctx.measureText(texte).width + px * 0.6);
  c.height = Math.ceil(px * 1.5);
  ctx.font = police;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = px * 0.25; // 3 px de halo pour 24 px de texte, de chaque côté du tracé
  ctx.strokeStyle = halo;
  ctx.strokeText(texte, c.width / 2, c.height / 2);
  ctx.fillStyle = encre;
  ctx.fillText(texte, c.width / 2, c.height / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return { t, ratio: c.width / c.height };
}

// ---------------------------------------------------------------- scène
/**
 * Crée la carte dans `conteneur`. Options : surSelection(id|null), surSurvol(infos|null), annoncer(texte),
 * surCamera({ azimut, distance, cadre }) (boussole, mini-carte), surPremiereImage(), qualite ('auto' | 'haute' |
 * 'standard' | 'economie'), heure ('reelle' | 'jour' | 'theme'), animations (false : aucune vie ambiante),
 * ouverture (true : moment « Ouverture du matin », §4.27).
 */
export async function creerScene(conteneur, options) {
  const { surSelection, surSurvol, annoncer = () => {}, surCamera = () => {}, surPremiereImage = () => {}, zoneLibre = () => ({ gauche: 0, bas: 0 }) } = options;
  if (!webglDisponible()) throw new Error('WebGL indisponible');
  const racineDoc = document.documentElement;
  const lireJeton = (n) => getComputedStyle(racineDoc).getPropertyValue(n);
  PAL = lirePalette(lireJeton);
  let reglageHeure = options.heure ?? 'reelle';
  const themeSombre = () => racineDoc.getAttribute('data-theme') === 'sombre';
  ETAT = etatHeure(new Date(), { reglage: reglageHeure, themeSombre: themeSombre() });
  const estTelephone = telephone();
  let qualite = qualiteInitiale({ reglage: options.qualite ?? 'auto', telephone: estTelephone, memoire: navigator.deviceMemory, coeurs: navigator.hardwareConcurrency });
  PROFIL = profil(qualite, { telephone: estTelephone });
  // nouvelle scène : matériaux recréés selon la qualité (Lambert ou PBR)
  mats.clear(); toons.clear(); variantes.clear(); materiauxModeles.clear(); suivis.length = 0; matPersonne = null; gabarits.clear();
  for (const p of atlasEnseignes.pages) { p.t.dispose(); p.m.dispose(); }
  atlasEnseignes.pages = [];
  atlasEnseignes.suivant = 0;
  // lots de rendu : l'état de chaque objet (plâtre, périmé, survol) est une texture lue par le vertex shader
  const donneesEtats = new Uint8Array(LARGEUR_ETATS * HAUTEUR_ETATS * 4);
  const texEtats = new THREE.DataTexture(donneesEtats, LARGEUR_ETATS, HAUTEUR_ETATS, THREE.RGBAFormat, THREE.UnsignedByteType);
  texEtats.minFilter = THREE.NearestFilter;
  texEtats.magFilter = THREE.NearestFilter;
  texEtats.generateMipmaps = false;
  uLot.uEtats.value = texEtats;
  uLot.uPlatreJ.value.fromArray(rvb(PAL.jour.platre));
  uLot.uPlatreN.value.fromArray(rvb(PAL.nuit.platre));
  uLot.uGarde.value = PAL.peinturePerimee ?? 0.4;
  let numeros = new Map(); // id d'objet → numéro dans la texture d'état (0 : décor, toujours peint)
  const ecrireEtat = (id, champ, valeur) => {
    const n = numeros.get(id);
    if (!n) return;
    donneesEtats[n * 4 + champ] = valeur;
    texEtats.needsUpdate = true;
  };
  const rolesSuivis = () => new Map(suivis.map((s) => [s.m, s.role]));
  /** Parcourt un groupe sans entrer dans ce qui est gardé à part (murs, toits, centre-ville, lots déjà cuits) ni masqué. */
  const parcourir = (racine, f) => {
    const pile = [...racine.children];
    while (pile.length) {
      const o = pile.pop();
      if (!o.visible || o.userData.garder || o.userData.lot) continue;
      f(o);
      pile.push(...o.children);
    }
  };
  /**
   * Décor et objets animés d'un bloc (voitures, bateaux) : cuits en lots dans `groupe`, maillages d'origine retirés.
   * parties : [[groupe source, masque]] (le centre-ville et les petits accessoires ont leur masque).
   */
  const cuireDecor = (groupe, parties = [[groupe, 0]]) => {
    const roles = rolesSuivis();
    const sources = [];
    for (const [g] of parties) g.updateMatrixWorld(true); // pièces ajoutées après le dernier calcul des matrices
    for (const [g, masque] of parties) parcourir(g, (o) => { const d = o.isMesh && !(o.userData.jetable && o.userData.jetable !== 'geometrie') ? decrireLot(o, roles) : null; if (d) sources.push({ mesh: o, d, ent: 0, masque }); });
    if (sources.length < 2) return; // un seul maillage : rien à gagner
    cuireLots(sources, groupe, PROFIL.ombres > 0);
    for (const { mesh } of sources) { mesh.parent?.remove(mesh); if (mesh.userData.jetable === 'geometrie') mesh.geometry.dispose(); }
  };
  matVerre = suivre(new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.32, depthWrite: false }), 'ciel-horizon');
  matVerreAllume = suivre(new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthWrite: false }), 'fenetres');
  matFantome = mat('platre');
  try { await document.fonts?.load(`600 ${TAILLE_NOM_SOL}px Fraunces`); } catch { /* police de repli */ }
  await chargerModeles();

  const renderer = new THREE.WebGLRenderer({ antialias: !estTelephone || PROFIL.qualite !== 'economie', powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, PROFIL.densiteMax));
  renderer.shadowMap.enabled = PROFIL.ombres > 0;
  renderer.shadowMap.type = THREE.PCFShadowMap; // r186 : PCFSoftShadowMap est retiré, PCF filtré le remplace
  renderer.shadowMap.autoUpdate = false;        // recalculée seulement quand la caméra ou les données bougent
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.info.autoReset = false; // une image = toutes ses passes (ombres, rendu, occlusion) : budget du §5.10
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.classList.add('bz-scene');
  canvas.setAttribute('role', 'application');
  canvas.setAttribute('aria-roledescription', 'carte');
  canvas.setAttribute('aria-label', typo(libelleCanvas({ tactile: tactile() })));
  conteneur.classList.add('bz-scene-cadre');
  conteneur.append(canvas);
  const couchePuces = document.createElement('div');
  couchePuces.className = 'puces-3d';
  couchePuces.setAttribute('aria-hidden', 'true'); // la même information est au clavier (flèches) et dans « Tableau »
  conteneur.append(couchePuces);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xffffff, 200, 400);
  /* Plan proche à 1 m (la caméra ne s'approche jamais à moins de 6 m de sa cible) : le tampon de profondeur distingue
     alors 1,2 cm à l'autre bout du plateau, au lieu de 2,4 cm. C'est ce qui sépare un marquage de sa chaussée. */
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 1400);
  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1.0);
  scene.add(hemi);
  const soleil = new THREE.DirectionalLight(0xffffff, 1.6);
  soleil.castShadow = PROFIL.ombres > 0;
  if (PROFIL.ombres) {
    soleil.shadow.mapSize.set(PROFIL.ombres, PROFIL.ombres);
    soleil.shadow.bias = -0.0004;
    soleil.shadow.normalBias = 0.04;
    soleil.shadow.radius = 2;
  }
  scene.add(soleil, soleil.target);

  // ciel en dôme : dégradé zénith → horizon, sans texture (§5.2)
  const ciel = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), new THREE.ShaderMaterial({
    uniforms: { uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() } },
    side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vDir;\nvoid main() {\n  vDir = normalize(position);\n  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n  gl_Position = p.xyww;\n}',
    fragmentShader: 'uniform vec3 uZenith;\nuniform vec3 uHorizon;\nvarying vec3 vDir;\nvoid main() {\n  gl_FragColor = vec4(mix(uHorizon, uZenith, smoothstep(0.0, 0.55, vDir.y)), 1.0);\n  #include <tonemapping_fragment>\n  #include <colorspace_fragment>\n}',
  }));
  ciel.renderOrder = -1;
  ciel.frustumCulled = false;
  scene.add(ciel);

  // occlusion ambiante GTAO : qualité Haute sur ordinateur seulement, à demi-résolution (§5.3), chargée à la demande
  let composer = null;
  let gtao = null;
  if (PROFIL.gtao) {
    try {
      const [{ EffectComposer }, { RenderPass }, { GTAOPass }, { OutputPass }] = await Promise.all([
        import('/vendor/addons/postprocessing/EffectComposer.js'), import('/vendor/addons/postprocessing/RenderPass.js'),
        import('/vendor/addons/postprocessing/GTAOPass.js'), import('/vendor/addons/postprocessing/OutputPass.js')]);
      composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));
      gtao = new GTAOPass(scene, camera, 1, 1);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.blendIntensity = 0.85;
      gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.4, scale: 1.2, samples: 8 });
      adapterNormalesGtao(gtao.normalMaterial); // murs abaissés et calques masqués aussi dans l'occlusion
      // les coques (contours, sélection) ne comptent pas dans l'occlusion : collées aux surfaces, elles la bruiteraient
      const masquerPourOcclusion = gtao._overrideVisibility?.bind(gtao);
      if (masquerPourOcclusion && Array.isArray(gtao._visibilityCache)) {
        gtao._overrideVisibility = () => {
          masquerPourOcclusion();
          // ni les transparents (vitres, noms au sol, ombres de contact), ni les petites pièces animées (mouettes, colis)
          scene.traverse((o) => {
            if (o.visible && (o.userData.coque || o.userData.horsOcclusion || (o.isMesh && o.material?.transparent))) { o.visible = false; gtao._visibilityCache.push(o); }
          });
        };
      }
      composer.addPass(gtao);
      composer.addPass(new OutputPass());
    } catch {
      composer = null;
      gtao = null;
    }
  }

  // ---- socle statique (fusionné par matériau après construction)
  const statique = new THREE.Group();
  scene.add(statique);
  const accessoires = new THREE.Group(); // petits accessoires : masqués en vue large et en qualité Économie (§5.10)
  accessoires.userData.garder = true;
  scene.add(accessoires);
  const { x0, x1, z0, zCote, z1 } = PLATEAU;
  const larg = x1 - x0;
  statique.add(piece(B(larg, 6, zCote - z0), mat(P.terre), 0, -6, (z0 + zCote) / 2));
  statique.add(piece(B(larg, 0.3, zCote - z0), mat(P.herbe), 0, -0.3, (z0 + zCote) / 2, false));
  statique.add(piece(B(larg, 4.4, z1 - zCote), mat(P.fondMer), 0, -6, (zCote + z1) / 2));
  // mer : plan à vagues dans le vertex shader, écume en anneau autour des quais
  const uTemps = { value: 0 };
  const matMer = suivre(nouveau({ roughness: 0.3 }), 'mer');
  matMer.onBeforeCompile = (sh) => {
    sh.uniforms.uTemps = uTemps;
    // la houle s'éteint en approchant du rivage : au ras du quai l'eau est plate, elle ne monte plus par-dessus
    // l'écume ni ne découvre le fond, et la ligne de côte reste nette
    sh.vertexShader = `uniform float uTemps;\n${sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  float bordMer = smoothstep(-12.0, -2.0, position.z);\n  transformed.y += (sin(position.x * 0.18 + uTemps * 0.9) * 0.1 + cos(position.z * 0.23 + uTemps * 0.7) * 0.08) * bordMer;')}`;
  };
  matMer.customProgramCacheKey = () => 'mer';
  const mer = new THREE.Mesh(new THREE.PlaneGeometry(larg, z1 - zCote, 48, 12).rotateX(-Math.PI / 2), matMer);
  mer.position.set(0, -0.35, (zCote + z1) / 2);
  mer.receiveShadow = PROFIL.ombres > 0;
  mer.userData.garder = true;
  scene.add(mer);
  // écume : juste au-dessus de la crête des vagues (−0,35 + 0,18), sinon la houle la recouvrait et la faisait clignoter
  const ecume = mat('ecume');
  const Y_ECUME = -0.2;
  statique.add(piece(B(larg, 0.05, 1.1), ecume, 0, Y_ECUME, zCote + 0.4, false));
  for (const [x, z, l, p] of [[0, zCote + 5.2, 35, 0.8], [-17.4, zCote + 2, 0.8, 6.6], [17.4, zCote + 2, 0.8, 6.6], [0, zCote + 16, 4, 0.8]]) statique.add(piece(B(l, 0.05, p), ecume, x, Y_ECUME, z, false));
  // la plage repose sur la pelouse, elle ne la double pas : à hauteur égale, les deux se disputaient 192 m de rivage
  statique.add(piece(B(larg, 0.34, 4), mat(P.sable), 0, -0.3, zCote - 2, false));
  statique.add(piece(B(34, 0.8, 6), mat(P.beton), 0, -0.5, zCote + 2));
  statique.add(piece(B(3, 0.3, 11), matTex('parquet', 1, 4), 0, -0.25, zCote + 10));
  // sols des quartiers (§5.5) : équipe en pelouse au centre, quais en planches, clients en pavés, fournisseurs en enrobé
  statique.add(piece(B(84, 0.1, 30), matSol('equipe'), 0, 0, 18.5, false));
  statique.add(piece(B(84, 0.1, 30), matSol('equipe'), 0, 0, -20, false));
  statique.add(piece(B(84, 0.08, 6), matSol('stock'), 0, 0, 44, false));
  for (const [q, z] of [['clients', ZONES.clients], ['fournisseurs', ZONES.fournisseurs], ['prospects', ZONES.prospects]]) {
    statique.add(piece(B(z.x1 - z.x0 + 2, 0.06, z.z1 - z.z0 + 2), matSol(q), (z.x0 + z.x1) / 2, 0, (z.z0 + z.z1) / 2, false));
  }
  const centreVille = new THREE.Group();
  statique.add(centreVille);
  const auCentre = (x, z) => x > CENTRE.x0 && x < CENTRE.x1 && z > CENTRE.z0 && z < CENTRE.z1;
  /* Voirie : quatre niveaux distincts, jamais deux surfaces au même, sinon elles se disputent le pixel et grésillent
     dès qu'on s'éloigne (le tampon de profondeur ne sépare plus qu'un centimètre et demi à 360 m). De bas en haut à
     un carrefour : trottoir nord-sud, trottoir est-ouest, enrobé est-ouest, enrobé nord-sud. Les marquages, eux, sont
     des décalques : ils se posent sur la chaussée sans jamais la concurrencer. */
  const Y_TROTTOIR = { eo: 0.14, ns: 0.10 };
  const Y_ENROBE = { eo: 0.16, ns: 0.18 };
  const Y_MARQUAGE = 0.18;
  const marquage = matMarquage(P.ligne);
  const largeurRoute = (horiz, v) => ROUTES.find((r) => (horiz ? r.a[1] === v && r.b[1] === v : r.a[0] === v && r.b[0] === v))?.l ?? 7;
  const dansCarrefour = (x, z) => CARREFOURS.some(([cx, cz]) => Math.abs(x - cx) < 7 && Math.abs(z - cz) < 7);
  const troncon = (cible, ax, az, bx, bz, l) => {
    const horiz = az === bz;
    const long = horiz ? Math.abs(bx - ax) : Math.abs(bz - az);
    if (long < 0.5) return;
    const cx = (ax + bx) / 2;
    const cz = (az + bz) / 2;
    const trottoir = horiz ? Y_TROTTOIR.eo : Y_TROTTOIR.ns;
    const enrobe = horiz ? Y_ENROBE.eo : Y_ENROBE.ns;
    cible.add(piece(horiz ? B(long, trottoir, l + 4.4) : B(l + 4.4, trottoir, long), matTex('pave', horiz ? long / 3 : 2, horiz ? 2 : long / 3), cx, 0, cz, false));
    cible.add(piece(horiz ? B(long, 0.12, l) : B(l, 0.12, long), matTex('asphalte', horiz ? long / 6 : l / 6, horiz ? l / 6 : long / 6, { roughness: 0.95 }), cx, enrobe - 0.12, cz, false));
    // axe de la chaussée : jamais au milieu d'un carrefour, où il n'y a pas de ligne médiane
    for (let t = -long / 2 + 3; t < long / 2 - 2; t += 6) {
      const x = horiz ? cx + t : cx;
      const z = horiz ? cz : cz + t;
      if (dansCarrefour(x, z)) continue;
      cible.add(piece(horiz ? PL(3, 0.15) : PL(0.15, 3), marquage, x, Y_MARQUAGE, z, false));
    }
  };
  for (const r of ROUTES) {
    const [ax, az] = r.a;
    const [bx, bz] = r.b;
    if (az === bz && az > CENTRE.z0 && az < CENTRE.z1) {
      troncon(statique, ax, az, CENTRE.x0, az, r.l);
      troncon(centreVille, CENTRE.x0, az, CENTRE.x1, az, r.l);
      troncon(statique, CENTRE.x1, az, bx, az, r.l);
    } else if (ax === bx && ax > CENTRE.x0 && ax < CENTRE.x1) {
      troncon(statique, ax, az, ax, CENTRE.z0, r.l);
      troncon(centreVille, ax, CENTRE.z0, ax, CENTRE.z1, r.l);
      troncon(statique, ax, CENTRE.z1, ax, bz, r.l);
    } else troncon(statique, ax, az, bx, bz, r.l);
  }
  /* Passages piétons : une peinture sur la chaussée, en décalque, juste après le coin du trottoir, et dans la largeur
     de la route qu'ils traversent — pas une bande qui déborde sur le trottoir. */
  for (const [cx, cz] of CARREFOURS) {
    const lEO = largeurRoute(true, cz);
    const lNS = largeurRoute(false, cx);
    for (const nordSud of [false, true]) {
      const route = nordSud ? lNS : lEO; // route traversée : le passage tient dans sa largeur
      const recul = (nordSud ? lEO : lNS) / 2 + 2.8; // après le coin du trottoir de la route croisée
      const nb = Math.max(3, Math.round((route - 1) / 1.1));
      for (const sens of [1, -1]) {
        const cible = auCentre(cx + (nordSud ? 0 : sens * recul), cz + (nordSud ? sens * recul : 0)) ? centreVille : statique;
        for (let k = 0; k < nb; k++) {
          const ecart = (k - (nb - 1) / 2) * 1.1;
          cible.add(piece(nordSud ? PL(0.55, 2.8) : PL(2.8, 0.55), marquage,
            cx + (nordSud ? ecart : sens * recul), Y_MARQUAGE, cz + (nordSud ? sens * recul : ecart), false));
        }
      }
    }
  }
  const rnd = alea(42);
  const ou = (x, z) => (auCentre(x, z) ? centreVille : statique);
  const mobilierUrbain = (nom, echelle, x, z, rot, petit = false) => {
    if ((petit || nom.endsWith('light') || nom.startsWith('trafficlight')) && !PROFIL.accessoires) return; // Économie : ni lampadaires ni feux
    const m = modele(nom, echelle, !petit);
    if (m) (petit && !auCentre(x, z) ? accessoires : ou(x, z)).add(placer(m, x, 0.16, z, rot));
  };
  for (let x = -90; x <= 90; x += 12) {
    if (Math.abs(x) < 6 || Math.abs(Math.abs(x) - 46) < 6) continue;
    mobilierUrbain('streetlight', 5, x, -5.3, 0);
    mobilierUrbain('streetlight', 5, x + 6, 5.3, Math.PI);
    ou(x + 3, 6.6).add(arbre(x + 3, 6.6, rnd, 0.9));
    statique.add(arbre(x + 9, -45.5, rnd, 0.9));
    if (rnd() > 0.6) mobilierUrbain('bench', 4.5, x + 1.5, -5.6, 0, true);
    if (rnd() > 0.7) mobilierUrbain('trash_A', 4.5, x - 2, 5.6, 0, true);
  }
  for (let z = -64; z <= 30; z += 10) {
    if (Math.abs(z) < 6 || Math.abs(z + 40) < 6) continue;
    statique.add(arbre(-51, z, rnd, 0.85));
    statique.add(arbre(51, z, rnd, 0.85));
    mobilierUrbain('streetlight', 5, -40.7, z + 5, Math.PI / 2);
    mobilierUrbain('streetlight', 5, 40.7, z + 5, -Math.PI / 2);
  }
  for (const [cx, cz] of [[0, 0], [-46, 0], [46, 0]]) {
    mobilierUrbain('trafficlight_A', 5, cx + 5.8, cz + 5.8, 0);
    mobilierUrbain('trafficlight_A', 5, cx - 5.8, cz - 5.8, Math.PI);
  }
  for (let i = 0; i < 34; i++) statique.add(arbre(x0 + 3 + rnd() * (larg - 6), z0 + 1.5 + rnd() * 2.5, rnd, 0.8 + rnd() * 0.4));
  const bateaux = [];
  const flotte = new THREE.Group(); // bateaux qui se balancent (0,5 Hz) : animés, donc hors fusion
  scene.add(flotte);
  for (const [x, z, c] of [[-56, 60, 'ardoise'], [62, 64, 'bois'], [28, 58, 'chaux']]) {
    const b = new THREE.Group();
    b.add(piece(geo('coque', () => new THREE.CylinderGeometry(1.2, 0.8, 6, 10, 1).rotateZ(Math.PI / 2).scale(1, 0.6, 1)), mat(c), 0, 0.4, 0));
    b.add(piece(B(1.8, 1.1, 1.4), mat(P.mur), -0.6, 0.9, 0));
    b.add(piece(CY(0.06, 0.06, 5, 6), mat(P.sombre), 1, 0.9, 0, false));
    b.position.set(x, -0.7, z);
    b.rotation.y = c === 'chaux' ? 0.4 : -0.3;
    flotte.add(b);
    bateaux.push({ b, y: -0.7, phase: x });
  }


  // fanions sur le quai, animés par le vertex shader (onde de 1 Hz, rien à calculer côté JS, §5.8)
  const matFanion = suivre(new THREE.MeshLambertMaterial({ side: THREE.DoubleSide }), 'phare');
  matFanion.onBeforeCompile = (sh) => {
    sh.uniforms.uTemps = uTemps;
    sh.vertexShader = `uniform float uTemps;\nattribute float aFanion;\n${sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed.z += sin(aFanion * 2.4 - uTemps * 6.2832) * 0.14 * (aFanion + 0.8);')}`;
  };
  matFanion.customProgramCacheKey = () => 'fanion';
  // les quatre fanions en un seul maillage : aFanion garde l'abscisse le long de chaque fanion (l'onde en dépend)
  const fanionsGeo = [];
  for (const x of [-15, -8, 8, 15]) {
    statique.add(piece(CY(0.06, 0.06, 5.5, 6), mat(P.sombre), x, 0, zCote + 0.4, false)); // mât : avec le décor
    const f = new THREE.PlaneGeometry(1.6, 0.9, 8, 1).translate(0.8, 0, 0);
    f.setAttribute('aFanion', new THREE.BufferAttribute(Float32Array.from({ length: f.attributes.position.count }, (_, i) => f.attributes.position.getX(i)), 1));
    fanionsGeo.push(f.translate(x + 0.06, 5.0, zCote + 0.4));
  }
  const fanions = new THREE.Mesh(mergeGeometries(fanionsGeo, false), matFanion);
  for (const f of fanionsGeo) f.dispose();
  fanions.userData.horsOcclusion = true;
  scene.add(fanions);
  // niveaux du port : un groupe fusionné par niveau atteint (quelques appels de dessin chacun)
  const decorNiveaux = new THREE.Group();
  decorNiveaux.userData.garder = true;
  scene.add(decorNiveaux);
  let niveauPortActuel = 0;
  function poserNiveaux(n) {
    const cible = Math.max(0, Math.min(10, Math.floor(Number(n) || 0)));
    if (cible === niveauPortActuel) return;
    for (const g of [...decorNiveaux.children]) if (g.userData.niveau > cible) { decorNiveaux.remove(g); g.traverse((o) => { if (o.isMesh && o.userData.fusion) o.geometry.dispose(); }); }
    for (let k = niveauPortActuel + 1; k <= cible; k++) { const g = elementNiveau(k); fusionner(g); decorNiveaux.add(g); }
    niveauPortActuel = cible;
    renderer.shadowMap.needsUpdate = true;
  }
  poserNiveaux(options.niveau ?? 1);
  // mouettes posées sur les bittes d'amarrage et un pignon ; elles s'envolent quand la caméra passe tout près (§5.8)
  // une mouette = un maillage (corps et ailes en couleurs de sommets) ; les ailes battent dans le vertex shader
  const mouettes = [];
  const geoMouette = (() => {
    const colorer = (g, hex, aile) => {
      const c = new THREE.Color(hex);
      const n = g.attributes.position.count;
      g.setAttribute('color', new THREE.BufferAttribute(Float32Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]), 3));
      g.setAttribute('aAile', new THREE.BufferAttribute(new Float32Array(n).fill(aile), 1));
      return g;
    };
    const parties = [colorer(new THREE.SphereGeometry(0.22, 8, 6).scale(1.6, 0.8, 0.8), PAL.jour.chaux, 0)];
    for (const s of [1, -1]) {
      const aile = new THREE.BoxGeometry(0.7, 0.03, 0.22).translate(0.35, 0, 0).scale(s, 1, 1).translate(0, 0.05, 0);
      if (s < 0) { const ix = aile.index; for (let i = 0; i < ix.count; i += 3) { const b = ix.getX(i + 1); ix.setX(i + 1, ix.getX(i + 2)); ix.setX(i + 2, b); } } // miroir : faces retournées
      parties.push(colorer(aile, PAL.jour.granit, s));
    }
    const g = mergeGeometries(parties, false);
    for (const x of parties) x.dispose();
    return g;
  })();
  for (const [x, y, z] of [[-14, 0.9, zCote + 4.8], [12, 0.9, zCote + 4.8], [-6.2, 7.2, zCote + 18.9]]) {
    const battement = { value: 0 };
    const m = suivre(nouveau({ vertexColors: true }), 'texture');
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uBattement = battement;
      sh.vertexShader = `uniform float uBattement;\nattribute float aAile;\n${sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  if (abs(aAile) > 0.5) { float aB = uBattement * aAile; vec2 pB = transformed.xy - vec2(0.0, 0.05); transformed.xy = vec2(pB.x * cos(aB) - pB.y * sin(aB), pB.x * sin(aB) + pB.y * cos(aB)) + vec2(0.0, 0.05); }`)}`;
    };
    m.customProgramCacheKey = () => 'mouette';
    const g = new THREE.Mesh(geoMouette, m);
    g.position.set(x, y, z);
    g.userData.garder = true;
    g.userData.horsOcclusion = true;
    scene.add(g);
    if (Math.abs(x) > 10) statique.add(piece(CY(0.25, 0.3, 0.6, 10), mat(P.sombre), x, -0.1, z, false));
    mouettes.push({ g, battement, depart: new THREE.Vector3(x, y, z), vol: 0 });
  }

  // décor cuit en lots : une dizaine d'appels de dessin au lieu de plusieurs milliers (§5.10)
  centreVille.userData.garder = true;
  cuireDecor(statique, [[statique, 0], [centreVille, MASQUE.centreVille], [accessoires, MASQUE.accessoires]]);
  for (const { b } of bateaux) cuireDecor(b);
  accessoires.visible = PROFIL.accessoires;
  uLot.uMasque.value.fill(1);
  uLot.uMasque.value[MASQUE.accessoires] = accessoires.visible ? 1 : 0;

  // ---- calques dynamiques
  const dynamique = new THREE.Group();
  scene.add(dynamique);
  const couches = {};
  for (const k of NOMS_COUCHES) {
    couches[k] = new THREE.Group();
    dynamique.add(couches[k]);
  }
  const groupeLots = new THREE.Group(); // lots des calques (masque = 1 + rang du calque), refaits à chaque mise à jour
  groupeLots.userData.lot = true;
  scene.add(groupeLots);
  const etatCalques = { entreprise: true, clients: true, fournisseurs: true, partenaires: true, employes: true, presence: true, prenoms: true, stock: true, vehicules: true, alertes: true, noms: true, trafic: !mouvementReduit(), flux: true, toits: false };
  let animations = options.animations !== false;
  let enPause = false;
  let racines = new Map();
  let murs = [];
  let toits = [];
  let anneauxAlerte = [];
  let trafic = [];
  let flux = [];
  let faisceau = null;
  let lanterne = null;
  let fenetres = [];
  let textesSol = [];
  let objetsParId = new Map();

  // ---------------------------------------------------------------- étiquettes (§5.6) : 3 niveaux, sans chevauchement
  let puces = [];
  const parObjet = new Map(); // id de l'objet → étiquette principale (celle qui porte le badge d'alerte)
  const groupesQuartier = new Map(); // pastilles « Clients +12 » de la vue large
  let etatPlacement = new Map();
  let etiquettesASituer = true;
  let focusVirtuel = null;
  const NIVEAUX_BADGE = { critique: 'octagon-alert', attention: 'triangle-alert', info: 'circle-help' };
  const TON_BADGE = { critique: 'critique', attention: 'attention', info: 'info' };
  function creerPastille({ texte, detail = null, categorie, id = null, plaque = null }) {
    const el = document.createElement(id ? 'button' : 'div');
    el.className = 'bz-etiquette';
    el.dataset.cache = '';
    if (id) {
      el.type = 'button';
      el.tabIndex = -1; // pas d'arrêt de tabulation un par un : les flèches parcourent les lieux depuis le canvas
      el.dataset.objet = id; // repère de l'action d'« Aujourd'hui » correspondante (surligner)
      el.addEventListener('click', (e) => { e.stopPropagation(); reveiller(); surSelection(id); });
      el.addEventListener('dblclick', (e) => { e.stopPropagation(); entrer(id); });
    }
    const forme = document.createElement('span');
    forme.className = `bz-cat bz-cat--${categorie.forme} bz-cat--carte`;
    forme.append(icone(categorie.icone, { taille: 'sm' }));
    const nom = document.createElement('span');
    nom.className = 'bz-etiquette__nom';
    nom.textContent = typo(texte);
    el.append(forme, nom);
    if (plaque) { const p = document.createElement('span'); p.className = 'bz-etiquette__plaque'; p.textContent = plaque; el.append(p); }
    if (detail) { const d = document.createElement('span'); d.className = 'bz-etiquette__detail'; d.textContent = typo(detail); el.append(d); }
    return el;
  }
  /** Badge d'état (niveau 3) collé à la pastille : icône seule, ou nombre sur fond plein. */
  function poserBadge(p, niveau, nombre, description) {
    p.badge = niveau;
    p.alerte = description;
    p.el.querySelector('.bz-etiquette__alerte')?.remove();
    const b = document.createElement('span');
    b.className = `bz-etiquette__alerte bz-etiquette__alerte--${TON_BADGE[niveau] ?? 'info'}`;
    if (nombre > 1) { b.dataset.nombre = ''; b.textContent = String(nombre); } else b.append(icone(NIVEAUX_BADGE[niveau] ?? 'info', { taille: 'sm' }));
    p.el.append(b);
    p.el.title = typo(description);
  }
  /**
   * Étiquette d'un lieu ou d'une entité (niveau 2). sorte : 'principal' (lieux, départements, phare), 'entite'
   * (clients, fournisseurs, véhicules, projets) ou 'secondaire' (prénoms, stocks, courrier). lod : distance de caméra
   * au-delà de laquelle elle se cache (une alerte reste visible même au dézoom).
   */
  function puce({ texte, monde, hauteur = 0, categorie = 'noms', id = null, lod = Infinity, sorte = 'entite', objet = null, detail = null, plaque = null, quartier = null, badge = null, nombre = 1, description = '' }) {
    const o = objet ?? (id ? objetsParId.get(id) : null);
    const el = creerPastille({ texte, detail, categorie: categorieDe(o ?? { famille: 'autre' }), id, plaque });
    couchePuces.append(el);
    const p = { el, id, monde: monde.clone().setY(monde.y + hauteur), categorie, lod, sorte, quartier, texte, detail, badge: null, alerte: '', l: 0, h: 0 };
    puces.push(p);
    if (id && !parObjet.has(id)) parObjet.set(id, p);
    if (badge) poserBadge(p, badge, nombre, description);
    etiquettesASituer = true;
    return p;
  }
  function priorite(p) {
    if (p.id && p.id === focusVirtuel) return PRIORITE.focus;
    if (p.badge === 'critique') return PRIORITE.critique;
    if (p.id && p.id === selection) return PRIORITE.selection;
    if (p.badge) return PRIORITE.alerte;
    return p.sorte === 'principal' ? PRIORITE.principal : p.sorte === 'secondaire' ? PRIORITE.secondaire : PRIORITE.entite;
  }
  function mesurer() {
    for (const p of puces) { p.l = p.el.offsetWidth; p.h = p.el.offsetHeight; }
    for (const g of groupesQuartier.values()) { g.l = g.el.offsetWidth; g.h = g.el.offsetHeight; }
  }
  const proj = new THREE.Vector3();
  let zoneCache = null;
  const LARGE = 150; // au-delà, vue large : noms au sol, entités regroupées par quartier
  /** Projette, trie et place les étiquettes : seulement quand la caméra bouge ou que les données changent (≤ 2 ms). */
  function situer() {
    etiquettesASituer = false;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const distance = camera.position.distanceTo(cible);
    if (!zoneCache || performance.now() - zoneCache.t > 300) zoneCache = { ...(zoneLibre() ?? {}), t: performance.now() };
    const { obstacles = [] } = zoneCache; // sous le HUD (panneau, feuille, contrôles), une étiquette ne compte pas
    const sousHud = (x, y, l, hh) => obstacles.some((o) => x + l / 2 > o.x0 && x - l / 2 < o.x1 && y > o.y0 && y - hh < o.y1);
    // Noms de quartier au sol (niveau 1, §5.6) : dessinés au-dessus des bâtiments (jamais masqués par un toit) ; un nom
    // qui passerait sous le HUD (boussole, panneau) est caché, et les pastilles secondaires lui laissent sa place.
    const az = controles.azimuthAngle;
    const solVisible = distance > LARGE * 0.8 && etatCalques.noms !== false;
    const zonesSol = [];
    for (const t of textesSol) {
      t.mesh.rotation.y = az;
      let vu = solVisible;
      if (vu) {
        const r = boiteSol(t, az, w, h);
        // entier à l'écran (un nom coupé par le bord ne se lit pas) et hors du HUD
        vu = Boolean(r) && r.x0 >= 0 && r.x1 <= w && r.y0 >= 0 && r.y1 <= h && !obstacles.some((o) => r.x0 < o.x1 && o.x0 < r.x1 && r.y0 < o.y1 && o.y0 < r.y1);
        if (vu) zonesSol.push(r);
      }
      t.mesh.visible = vu;
    }
    const surNomSol = (x, y, l, hh) => zonesSol.some((r) => x + l / 2 > r.x0 && x - l / 2 < r.x1 && y > r.y0 && y - hh < r.y1);
    const candidats = [];
    for (const p of puces) {
      const calque = p.categorie === 'alertes' ? etatCalques.alertes : p.categorie === 'noms' ? etatCalques.noms : etatCalques[p.categorie] !== false;
      const prio = priorite(p);
      if (!calque || (distance > p.lod && prio > PRIORITE.alerte)) { p.horsCalque = true; continue; }
      p.horsCalque = false;
      proj.copy(p.monde).project(camera);
      p.x = ((proj.x + 1) / 2) * w;
      p.y = ((1 - proj.y) / 2) * h;
      candidats.push({ id: p, x: p.x, y: p.y, l: p.l, h: p.h, priorite: prio, rang: proj.z, horsEcran: proj.z > 1 || sousHud(p.x, p.y, p.l, p.h) || (prio > PRIORITE.alerte && surNomSol(p.x, p.y, p.l, p.h)), quartier: distance > LARGE && p.quartier && p.quartier !== 'entreprise' ? p.quartier : null });
    }
    const { gardes, groupes } = regrouperParQuartier(candidats);
    const actifs = new Set();
    for (const gq of groupes) {
      const g = groupesQuartier.get(gq.quartier);
      if (!g) { gardes.push(...candidats.filter((c) => gq.ids.includes(c.id))); continue; }
      actifs.add(g);
      g.el.querySelector('.bz-etiquette__nom').textContent = typo(`${g.texte} +${gq.nombre}`);
      proj.copy(g.monde).project(camera);
      g.x = ((proj.x + 1) / 2) * w;
      g.y = ((1 - proj.y) / 2) * h;
      gardes.push({ id: g, x: g.x, y: g.y, l: g.l || 120, h: g.h || 28, priorite: PRIORITE.principal, rang: proj.z, horsEcran: proj.z > 1 || sousHud(g.x, g.y, g.l || 120, g.h || 28) || surNomSol(g.x, g.y, g.l || 120, g.h || 28) });
    }
    const { visibles, etat } = placerEtiquettes(gardes, { largeur: w, hauteur: h, max: estTelephone ? MAX_ETIQUETTES.telephone : MAX_ETIQUETTES.ordinateur, tactile: tactile(), maintenant: performance.now(), etat: etatPlacement });
    etatPlacement = etat;
    for (const p of [...puces, ...groupesQuartier.values()]) {
      const vu = visibles.has(p);
      if (vu) p.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
      p.el.toggleAttribute('data-cache', !vu);
      p.el.toggleAttribute('data-focus', Boolean(p.id) && p.id === focusVirtuel);
      p.el.toggleAttribute('data-selection', Boolean(p.id) && p.id === selection);
    }
    for (const g of groupesQuartier.values()) if (!actifs.has(g)) g.el.setAttribute('data-cache', '');
    if (etiquettesEnAttente()) planifier(HYSTERESIS_RAPPEL);
  }
  const HYSTERESIS_RAPPEL = 220;
  const etiquettesEnAttente = () => [...etatPlacement.values()].some((e) => !e.visible && e.libreDepuis !== null);

  // ---------------------------------------------------------------- caméra : camera-controls 3.1.2 (§5.7)
  const controles = new CameraControls(camera, canvas);
  const A = CameraControls.ACTION;
  controles.mouseButtons.left = A.SCREEN_PAN;   // glisser : déplacer sur le sol
  controles.mouseButtons.right = A.ROTATE;      // clic droit : pivoter
  controles.mouseButtons.middle = A.DOLLY;
  controles.mouseButtons.wheel = A.DOLLY;       // molette : zoomer vers le pointeur
  controles.touches.one = A.TOUCH_SCREEN_PAN;   // un doigt : déplacer
  controles.touches.two = A.TOUCH_DOLLY_ROTATE; // deux doigts : zoomer et pivoter
  controles.touches.three = A.TOUCH_SCREEN_PAN;
  controles.dollyToCursor = true;
  controles.minDistance = 6;     // intérieurs à l'échelle réelle
  controles.maxDistance = 360;   // le port entier (plateau de 192 × 142 m)
  controles.minPolarAngle = 0.02;
  controles.maxPolarAngle = 1.38;
  controles.dollySpeed = 0.8;
  controles.truckSpeed = 1.6;
  controles.azimuthRotateSpeed = 0.6;
  controles.polarRotateSpeed = 0.6;
  const dureeVol = () => (mouvementReduit() ? 0 : Number.parseFloat(lireJeton('--bz-d-camera')) || 500);
  const reglerLissage = () => { const d = dureeVol(); controles.smoothTime = d ? d / 4000 : 0.0001; controles.draggingSmoothTime = d ? 0.06 : 0.0001; };
  reglerLissage();
  controles.setBoundary(new THREE.Box3(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x1, 8, z1)));
  controles.boundaryFriction = 0.2;
  // Maj + glisser : pivoter (comme le clic droit) ; camera-controls lit les boutons au début du geste
  canvas.addEventListener('pointerdown', (e) => { controles.mouseButtons.left = e.shiftKey ? A.ROTATE : A.SCREEN_PAN; }, { capture: true });
  const VUE = { cible: new THREE.Vector3(-4, 0, 2), polaire: 0.96, azimut: Math.PI / 4 }; // angle polaire 55°, azimut 45°
  const distanceInitiale = () => {
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight) || 1.6;
    return Math.min(controles.maxDistance, Math.max(170, 255 * Math.max(1, 1.45 / aspect)));
  };
  const cible = new THREE.Vector3();
  const versPosition = (c, d, pol, az) => new THREE.Vector3(c.x + d * Math.sin(pol) * Math.sin(az), c.y + d * Math.cos(pol), c.z + d * Math.sin(pol) * Math.cos(az));
  function volerVers(c, distance, polaire = 0.95, azimut = null) {
    const az = azimut ?? controles.azimuthAngle;
    const p = versPosition(c, distance, polaire, az);
    controles.setLookAt(p.x, p.y, p.z, c.x, c.y, c.z, dureeVol() > 0);
    reveiller();
  }
  const recentrer = () => { dedans = null; volerVers(VUE.cible, distanceInitiale(), VUE.polaire, VUE.azimut); };
  { const p = versPosition(VUE.cible, distanceInitiale(), VUE.polaire, VUE.azimut); controles.setLookAt(p.x, p.y, p.z, VUE.cible.x, VUE.cible.y, VUE.cible.z, false); }
  const zoomer = (f) => { controles.dollyTo(Math.max(controles.minDistance, Math.min(controles.maxDistance, controles.distance * f)), dureeVol() > 0); reveiller(); };
  const tourner45 = (sens) => { controles.rotate((sens * Math.PI) / 4, 0, dureeVol() > 0); reveiller(); };
  // toute touche interrompt un vol : la caméra s'arrête où elle est (§5.7)
  const arreterVol = () => { if (cameraEnMouvement) controles.stop?.(); };
  document.addEventListener('keydown', arreterVol, true);
  let dedans = null;
  function entrer(id) {
    const g = racines.get(id);
    if (!g) return;
    const p = new THREE.Vector3();
    g.getWorldPosition(p);
    const taille = new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
    const batiment = ['lieu', 'departement', 'tiers', 'organisation'].includes(g.userData.famille) || id === '__pavillon';
    surSelection(id); // la fiche s'ouvre dès le début du vol, pas à la fin
    if (batiment) {
      dedans = id;
      volerVers(new THREE.Vector3(p.x, 0.5, p.z + 1), Math.max(18, Math.max(taille.x, taille.z) * 1.0), 0.95);
      const o = objetsParId.get(id);
      if (o) annoncer(`${o.nom.replace(/\s*\((fictive?s?|démo)\)/gi, '')} : vous êtes à l’intérieur. Échap pour sortir.`);
    } else {
      volerVers(new THREE.Vector3(p.x, 0.5, p.z), 32, 0.9);
    }
  }
  function sortir() {
    if (!dedans) return false;
    dedans = null;
    recentrer();
    annoncer('Vous êtes sorti du bâtiment.');
    return true;
  }

  // ---- toucher deux fois et glisser : zoomer d'une main (§5.7) ; sans glisser, sur un bâtiment : entrer
  let dernierToucher = null;
  let zoomUneMain = null;
  conteneur.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || e.target !== canvas) return;
    const t = performance.now();
    if (dernierToucher && t - dernierToucher.t < 300 && Math.hypot(e.clientX - dernierToucher.x, e.clientY - dernierToucher.y) < 24) {
      e.stopImmediatePropagation();
      zoomUneMain = { y: e.clientY, x: e.clientX, d: controles.distance, bouge: false, id: e.pointerId };
      try { canvas.setPointerCapture(e.pointerId); } catch { /* rien */ }
      dernierToucher = null;
      return;
    }
    dernierToucher = { t, x: e.clientX, y: e.clientY };
  }, { capture: true });
  conteneur.addEventListener('pointermove', (e) => {
    if (!zoomUneMain || e.pointerId !== zoomUneMain.id) return;
    e.stopImmediatePropagation();
    const dy = e.clientY - zoomUneMain.y;
    if (Math.abs(dy) > 6) zoomUneMain.bouge = true;
    if (zoomUneMain.bouge) { controles.dollyTo(Math.max(controles.minDistance, Math.min(controles.maxDistance, zoomUneMain.d * Math.exp(-dy / 160))), false); reveiller(); }
  }, { capture: true });
  const finZoom = (e) => {
    if (!zoomUneMain || e.pointerId !== zoomUneMain.id) return;
    e.stopImmediatePropagation();
    const { bouge, x, y } = zoomUneMain;
    zoomUneMain = null;
    if (bouge) return;
    const d = choisir(x, y);
    if (d && racines.get(d.id) && ['lieu', 'departement', 'tiers', 'organisation'].includes(racines.get(d.id).userData.famille)) entrer(d.id);
    else zoomer(0.7);
  };
  conteneur.addEventListener('pointerup', finZoom, { capture: true });
  conteneur.addEventListener('pointercancel', finZoom, { capture: true });

  // ---- sélection, survol, double-clic
  const raycaster = new THREE.Raycaster();
  raycaster.layers.enable(CALQUE_ORIGINES); // on pointe les maillages d'origine, les lots ne font que dessiner
  const souris = new THREE.Vector2();
  function choisir(cx, cy) {
    const r = canvas.getBoundingClientRect();
    souris.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(souris, camera);
    for (const h of raycaster.intersectObjects(dynamique.children, true)) {
      let visible = true;
      for (let x = h.object; x; x = x.parent) if (!x.visible) visible = false;
      if (!visible || h.object.userData.coque) continue;
      let o = h.object;
      while (o && !o.userData.id) o = o.parent;
      if (o) return o.userData;
    }
    return null;
  }
  let appui = null;
  canvas.addEventListener('pointerdown', (e) => { appui = { x: e.clientX, y: e.clientY, b: e.button }; reveiller(); });
  canvas.addEventListener('pointerup', (e) => {
    if (appui && appui.b === 0 && Math.hypot(e.clientX - appui.x, e.clientY - appui.y) < 5) {
      const d = choisir(e.clientX, e.clientY);
      surSelection(d ? d.id : null);
    }
    appui = null;
  });
  canvas.addEventListener('dblclick', (e) => {
    const d = choisir(e.clientX, e.clientY);
    if (d) entrer(d.id);
  });
  let survolEnAttente = null;
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons || e.pointerType === 'touch') return;
    survolEnAttente = e;
    demander();
  });
  canvas.addEventListener('pointerleave', () => { survolEnAttente = null; survolerRacine(null); surSurvol(null); });
  // survol : émissif +8 % sur le bâtiment, curseur pointer (§5.4)
  let survole = null;
  function survolerRacine(id) {
    if (survole === id) return;
    if (survole) {
      racines.get(survole)?.traverse((m) => { if (m.isMesh && m.userData.matAvantSurvol) { m.material = m.userData.matAvantSurvol; delete m.userData.matAvantSurvol; } });
      ecrireEtat(survole, 2, 0);
    }
    survole = id;
    if (id) {
      racines.get(id)?.traverse((m) => { if (m.isMesh && !m.userData.coque && m.material && !m.userData.matAvantSurvol) { m.userData.matAvantSurvol = m.material; m.material = variante(m.material, 'survol'); } });
      ecrireEtat(id, 2, 255); // les lots lisent le survol dans la texture d'état
    }
    demander();
  }

  // ---- clavier sur le canvas (§5.6) : flèches = lieux par priorité, Maj + flèches = déplacer, Entrée, Échap…
  const nomLisible = (p) => {
    const o = p.id ? objetsParId.get(p.id) : null;
    const base = p.id === '__pavillon' ? 'Phare Breizhcosystem' : (o?.nom ?? p.texte).replace(/\s*\((fictive?s?|démo)\)/gi, '');
    return [base, p.detail, p.alerte].filter(Boolean).join(', ');
  };
  const lieuxClavier = () => ordreClavier(puces.filter((p) => p.id && !p.horsCalque && parObjet.get(p.id) === p).map((p) => ({ id: p.id, priorite: priorite({ ...p, id: p.id === focusVirtuel ? null : p.id }), rang: 0, p })));
  function focaliser(id) {
    focusVirtuel = id;
    const p = parObjet.get(id);
    if (!p) return;
    annoncer(nomLisible(p));
    proj.copy(p.monde).project(camera);
    if (Math.abs(proj.x) > 0.8 || Math.abs(proj.y) > 0.8 || proj.z > 1) volerVers(p.monde.clone().setY(0), Math.min(controles.distance, 90), controles.polarAngle);
    etiquettesASituer = true;
    demander();
  }
  canvas.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    let fait = true;
    if (k.startsWith('Arrow')) {
      if (e.shiftKey) {
        const pas = Math.max(4, controles.distance * 0.08);
        if (k === 'ArrowLeft') controles.truck(-pas, 0, true); else if (k === 'ArrowRight') controles.truck(pas, 0, true);
        else if (k === 'ArrowUp') controles.forward(pas, true); else controles.forward(-pas, true);
        reveiller();
      } else {
        const v = voisin(lieuxClavier(), focusVirtuel, k === 'ArrowRight' || k === 'ArrowDown' ? 1 : -1);
        if (v) focaliser(v.id);
      }
    } else if (k === 'Enter') {
      if (!focusVirtuel) { const v = voisin(lieuxClavier(), null, 1); if (v) focaliser(v.id); }
      else if (selection === focusVirtuel) entrer(focusVirtuel);
      else surSelection(focusVirtuel);
    } else if (k === 'Escape') {
      fait = sortir();
    } else if (k === '+' || k === '=') zoomer(0.8);
    else if (k === '-' || k === '_') zoomer(1.25);
    else if (k === 'q' || k === 'Q') tourner45(1);
    else if (k === 'e' || k === 'E') tourner45(-1);
    else if (k === '0') recentrer();
    else fait = false;
    if (fait) { e.preventDefault(); e.stopPropagation(); }
  });
  canvas.addEventListener('focus', () => { if (canvas.matches(':focus-visible')) conteneur.setAttribute('data-focus-clavier', ''); });
  canvas.addEventListener('blur', () => { conteneur.removeAttribute('data-focus-clavier'); if (focusVirtuel) { focusVirtuel = null; etiquettesASituer = true; demander(); } });

  // ---- construction depuis les données
  function vider() {
    const jetes = new Set();
    for (const k of Object.keys(couches)) {
      for (const enfant of [...couches[k].children]) {
        enfant.traverse((x) => {
          if (x.userData.jetable === 'tout') { x.geometry?.dispose(); x.material?.map?.dispose(); x.material?.dispose(); jetes.add(x.material); }
          if (x.userData.jetable === 'materiau') { x.material?.dispose(); jetes.add(x.material); }
          if (x.userData.jetable === 'ligne') { x.geometry?.dispose(); x.material?.dispose(); jetes.add(x.material); }
          if (x.userData.jetable === 'geometrie') x.geometry?.dispose();
        });
        couches[k].remove(enfant);
      }
    }
    for (const t of textesSol) { t.mesh.geometry.dispose(); t.mesh.material.dispose(); t.jour.t.dispose(); t.nuit?.t.dispose(); scene.remove(t.mesh); }
    for (let i = suivis.length - 1; i >= 0; i--) if (jetes.has(suivis[i].m)) suivis.splice(i, 1);
    for (const p of puces) p.el.remove();
    for (const g of groupesQuartier.values()) g.el.remove();
    groupesQuartier.clear();
    parObjet.clear();
    puces = [];
    racines = new Map();
    murs = [];
    for (const c of [...groupeLots.children]) { c.geometry?.dispose(); groupeLots.remove(c); }
    atlasEnseignes.suivant = 0;
    toits = [];
    anneauxAlerte = [];
    trafic = [];
    flux = [];
    faisceau = null;
    lanterne = null;
    fenetres = [];
    textesSol = [];
    survole = null;
    coqueSelection = null;
  }
  function enregistrer(g, o, couche) {
    g.userData = { id: o.id, nom: o.nom, libelle: o.libelleType, famille: o.famille };
    racines.set(o.id, g);
    couches[couche].add(g);
  }
  /** Boîte d'écran (px du canvas) d'un nom au sol tourné de `az` : ses 4 coins projetés ; null s'il est derrière. */
  const coin = new THREE.Vector3();
  function boiteSol(t, az, w, h) {
    const { largeur, hauteur } = t.mesh.userData;
    const ux = Math.cos(az), uz = -Math.sin(az); // sens du texte
    const vx = Math.sin(az), vz = Math.cos(az);  // sens de la hauteur des lettres
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      coin.set(t.mesh.position.x + ux * a * largeur / 2 + vx * b * hauteur / 2, t.mesh.position.y, t.mesh.position.z + uz * a * largeur / 2 + vz * b * hauteur / 2).project(camera);
      if (coin.z > 1) return null;
      const sx = ((coin.x + 1) / 2) * w, sy = ((1 - coin.y) / 2) * h;
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    return { x0, x1, y0, y1 };
  }
  /** Nom de quartier au sol (niveau 1). */
  function quartierAuSol(texte, x, z) {
    const jour = toileTexte(texte, PAL.jour.encre, PAL.jour.halo);
    const hauteur = 9;
    // depthTest coupé : le nom se lit par-dessus les bâtiments du quartier (il n'est visible qu'en vue large)
    const m = new THREE.MeshBasicMaterial({ map: jour.t, transparent: true, depthWrite: false, depthTest: false, toneMapped: false, fog: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(hauteur * jour.ratio, hauteur).rotateX(-Math.PI / 2), m);
    mesh.position.set(x, 0.3, z);
    mesh.renderOrder = 20;
    mesh.userData = { largeur: hauteur * jour.ratio, hauteur };
    scene.add(mesh);
    textesSol.push({ mesh, texte, jour, nuit: null });
  }
  /** Pastille « Clients +12 » d'un quartier en vue large : un clic y emmène la caméra. */
  function groupeQuartier(quartier, texte, x, z) {
    const el = creerPastille({ texte, categorie: categorieDe(quartier === 'prospects' ? { famille: 'tiers', roles: ['prospect'] } : quartier === 'fournisseurs' ? { famille: 'tiers', roles: ['fournisseur'] } : quartier === 'clients' ? { famille: 'tiers', roles: ['client'] } : { famille: 'tiers', roles: ['partenaire'] }) });
    el.dataset.quartier = quartier;
    el.addEventListener('click', () => volerVers(new THREE.Vector3(x, 0, z), 95, 0.9));
    couchePuces.append(el);
    groupesQuartier.set(quartier, { el, texte, monde: new THREE.Vector3(x, 2, z), l: 0, h: 0 });
  }
  /** Peinture d'une racine (§5.4, §4.29) : plâtre sans donnée réelle, 40 % de saturation si périmée. */
  function peindre(g, o) {
    const p = peintureDe(o);
    if (p === 'platre' || p === 'perime') g.traverse((m) => { if (m.isMesh && !m.userData.coque && m.material) m.material = variante(m.material, p); });
    g.userData.peinture = p; // relu par les lots (texture d'état)
    return p;
  }
  /**
   * Cuisson des calques (§5.10) : tous les calques et les murs en un seul jeu de lots (un par sorte de matériau). Le
   * calque de chaque pièce est un masque, l'orientation de chaque mur dit quand il s'abaisse. Les maillages d'origine
   * passent sur CALQUE_ORIGINES : pointés, jamais dessinés.
   */
  function cuireCalques() {
    for (let i = 0; i < LARGEUR_ETATS * HAUTEUR_ETATS; i++) donneesEtats.set([255, 0, 0, 255], i * 4);
    numeros = new Map();
    const numeroDe = new Map();
    let n = 1;
    for (const [id, g] of racines) {
      if (n >= LARGEUR_ETATS * HAUTEUR_ETATS) break;
      numeros.set(id, n);
      numeroDe.set(g, n);
      if (g.userData.peinture === 'perime') donneesEtats[n * 4 + 1] = 255;
      n++;
    }
    texEtats.needsUpdate = true;
    const entDe = (o) => { for (let p = o; p; p = p.parent) { const k = numeroDe.get(p); if (k) return k; } return 0; };
    const roles = rolesSuivis();
    const allumables = new Set(fenetres);
    const sources = [];
    dynamique.updateMatrixWorld(true); // pièces fusionnées après le dernier calcul des matrices (intérieurs, véhicules)
    const eco = PROFIL.qualite === 'economie';
    const ajouter = (o, d, masque, mur = null) => {
      o.layers.set(CALQUE_ORIGINES);
      if (eco && (masque === MASQUE.personnes || masque === MASQUE.mobilier)) return; // Économie : coupe sans mobilier, pastilles
      sources.push({ mesh: o, d, ent: d.sorte.type === 'verre' ? 0 : entDe(o), masque, mur, allume: allumables.has(o) });
    };
    // murs : abaissés par le vertex shader selon leur orientation, à hauteur d'allège (maison de poupée)
    const pied = new THREE.Vector3();
    for (const m of murs) {
      m.getWorldPosition(pied);
      const nm = m.userData.normaleMonde;
      const mur = { orientation: orientationMur(nm.x, nm.z), pied: pied.y, hauteur: m.userData.hauteur ?? 3.4 };
      m.traverse((o) => { const d = o.isMesh ? decrireLot(o, roles) : null; if (d) ajouter(o, d, masqueCalque('entreprise'), mur); });
    }
    // intérieurs des lieux : ce qui dépasse du sol dans l'emprise du bâtiment (mobilier, postes, accueil)
    const boite = new THREE.Box3();
    const local = new THREE.Matrix4();
    const lieuDe = (o) => { for (let p = o.parent; p; p = p.parent) if (numeroDe.has(p)) return ['lieu', 'organisation', 'departement'].includes(p.userData.famille) && p.userData.emprise ? p : null; return null; };
    const masqueDe = (o, i) => {
      if (NOMS_COUCHES[i] === 'employes') return MASQUE.personnes;
      const l = NOMS_COUCHES[i] === 'entreprise' ? lieuDe(o) : null;
      if (!l) return 1 + i;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      local.copy(l.matrixWorld).invert().multiply(o.matrixWorld);
      boite.copy(o.geometry.boundingBox).applyMatrix4(local);
      return estMobilier({ cx: (boite.min.x + boite.max.x) / 2, cz: (boite.min.z + boite.max.z) / 2, haut: boite.max.y }, l.userData.emprise) ? MASQUE.mobilier : 1 + i;
    };
    const autres = new Map(); // transparents particuliers (rares) : fusionnés par matériau dans leur calque
    const vitreSimple = (o) => o.material?.transparent && !o.material.isShaderMaterial && !Object.hasOwn(o.material, 'onBeforeCompile') && o.material.blending === THREE.NormalBlending;
    NOMS_COUCHES.forEach((k, i) => {
      if (!COUCHES_CUITES.includes(k)) return;
      parcourir(couches[k], (o) => {
        if (!o.isMesh || (o.userData.jetable && o.userData.jetable !== 'geometrie')) return; // matériaux propres (phare, anneaux) : à part
        const d = decrireLot(o, roles);
        if (d) ajouter(o, d, masqueDe(o, i));
        else if (vitreSimple(o)) { if (!autres.has(k)) autres.set(k, []); autres.get(k).push(o); }
      });
    });
    cuireLots(sources, groupeLots, PROFIL.ombres > 0);
    for (const [k, l] of autres) { fusionnerTransparents(l, couches[k]); for (const o of l) o.layers.set(CALQUE_ORIGINES); }
  }
  let peintsAvant = null; // objets peints au rendu précédent : « la maquette se peint » à l'arrivée de vraies données
  function maj(monde, options = {}) {
    vider();
    /* Personnalisation (§5) : le nom et la couleur choisis remplacent ceux des données, pour l'affichage seulement.
       On réécrit une copie des objets ici, une fois : tout le reste de la scène (étiquettes, enseignes, totems,
       couleurs des départements) lit alors la version personnalisée sans rien savoir du réglage. */
    const perso = estPersonnalisee(options.perso) ? options.perso : null;
    const objets = perso ? monde.objets.map((o) => {
      const p = FAMILLES_PERSONNALISABLES.includes(o.famille) ? perso[o.id] : null;
      if (!p || (!p.nom && !p.couleur)) return o;
      const champs = p.couleur ? [...(o.champs ?? []).filter((c) => c.id !== 'couleur'), { id: 'couleur', libelle: 'Couleur', type: 'choix', valeur: p.couleur }] : o.champs;
      return { ...o, nom: p.nom ?? o.nom, champs };
    }) : monde.objets;
    const parId = new Map(objets.map((o) => [o.id, o]));
    objetsParId = parId;
    const role = (id) => monde.univers.roles.find((r) => r.id === id);
    const departements = objets.filter((o) => o.famille === 'departement');
    const modeDep = options.vue === 'departements' && departements.length > 0;
    const conteneurDe = (o) => (modeDep ? (typeof val(o, 'departement') === 'string' ? val(o, 'departement') : null) : o.lieu);
    const situationsPar = new Map();
    for (const s of monde.situations) { if (!situationsPar.has(s.objetId)) situationsPar.set(s.objetId, []); situationsPar.get(s.objetId).push(s); }
    const infos = new Map();
    const axeY = new THREE.Vector3(0, 1, 0);
    const versMonde = (info, v) => v.clone().applyAxisAngle(axeY, info.rot).add(new THREE.Vector3(info.x, 0, info.z));
    const installer = (b, o, x, z, rot) => {
      b.g.position.set(x, 0, z);
      b.g.rotation.y = rot;
      enregistrer(b.g, o, 'entreprise');
      b.g.userData.emprise = b.l ? { l: b.l, p: b.p } : null; // intérieur : masqué de loin (niveau de détail)
      habiller(b, o);
      for (const m of b.murs) { m.userData.normaleMonde = m.userData.normale.clone().applyAxisAngle(axeY, rot); murs.push(m); }
      if (b.toit) toits.push(b.toit);
      infos.set(o.id, { b, x, z, rot, posteLibre: 0, rayonLibre: 0, parkingLibre: 0, machineLibre: 0 });
    };
    const contacts = []; // ombres de contact : [x, z, rayon]
    const effectifDe = (id) => objets.filter((o) => o.famille === 'personne' && conteneurDe(o) === id).length;

    if (modeDep) {
      const FINAUX = ['livrée', 'facturée', 'reçue', 'refusé'];
      const deps = ordonner(departements, perso).slice(0, 12); // chacun à la place qu'on lui a donnée
      const org = objets.find((o) => o.famille === 'organisation') ?? { id: '__siege', nom: 'Siège', famille: 'organisation', libelleType: 'Mon entreprise', champs: [] };
      const compos = deps.map((d) => {
        const membres = objets.filter((o) => conteneurDe(o) === d.id);
        return { employes: membres.filter((o) => o.famille === 'personne').length, articles: membres.filter((o) => o.famille === 'ressource' && !['vehicule', 'outil', 'engin'].includes(o.icone ?? o.type)).length };
      });
      const siege = siegeDepartements(org.nom.replace(/\s*\((fictive?s?|démo)\)/gi, ''), compos);
      const zSiege = 22 - siege.p / 2;
      couches.entreprise.add(piece(B(siege.l + 8, 0.12, 70), matTex('pave', (siege.l + 8) / 3, 70 / 3), 0, 0, -1.5, false));
      installer(siege, org, 0, zSiege, 0);
      deps.forEach((d, i) => {
        const z0 = siege.zones[i];
        const membres = objets.filter((o) => conteneurDe(o) === d.id);
        const employes = membres.filter((o) => o.famille === 'personne');
        const taches = {};
        for (const t of membres.filter((o) => o.famille === 'tache')) { const st = String(val(t, 'statut') ?? 'à faire'); taches[st] = (taches[st] ?? 0) + 1; }
        const documents = membres.filter((o) => o.famille === 'commande' && val(o, 'payee') !== true && !FINAUX.includes(String(val(o, 'statut')))).length;
        const articles = membres.filter((o) => o.famille === 'ressource' && !['vehicule', 'outil', 'engin'].includes(o.icone ?? o.type)).length;
        const couleur = couleurDepartement(d, i);
        const pl = plateauDepartement(d.nom, couleur, { employes: employes.length, articles, taches, documents }, z0.l, z0.p);
        pl.parkings = siege.parkings.slice((i * 2) % siege.parkings.length, (i * 2) % siege.parkings.length + 2);
        const x = z0.x;
        const z = zSiege + z0.z;
        pl.g.position.set(x, 0, z);
        enregistrer(pl.g, d, 'entreprise');
        pl.g.userData.emprise = { l: z0.l, p: z0.p }; // plateau : son mobilier est masqué de loin
        peindre(pl.g, d);
        fusionner(pl.g);
        infos.set(d.id, { b: pl, x, z, rot: 0, posteLibre: 0, rayonLibre: 0, parkingLibre: 0, machineLibre: 0 });
        const dispo = employes.filter((e) => { const v = val(e, 'disponibilite'); return v === null || v === 'disponible'; }).length;
        const sitsDep = trierNiveau(membres.flatMap((o) => situationsPar.get(o.id) ?? []));
        const pire = sitsDep[0] ? (sitsDep[0].statut === 'a_verifier' ? 'info' : sitsDep[0].gravite) : 'ok';
        puce({ texte: d.nom, detail: `${dispo} sur ${pluriel(employes.length, 'personne', 'personnes')}`, sorte: 'principal', monde: new THREE.Vector3(x, 0, z), hauteur: 4.6, id: d.id,
          badge: pire !== 'ok' ? pire : null, nombre: sitsDep.length, description: sitsDep.length ? pluriel(sitsDep.length, 'alerte', 'alertes') : '' });
      });
      puce({ texte: org.nom, sorte: 'principal', objet: org, monde: new THREE.Vector3(0, 0, zSiege + siege.p / 2), hauteur: 5.5, id: org.id });
    } else {
      const lieux = objets.filter((o) => o.famille === 'lieu');
      lieux.sort((a, b) => Number((b.icone ?? b.type) === 'siege') - Number((a.icone ?? a.type) === 'siege'));
      ordonner(lieux, perso).slice(0, EMPLACEMENTS_PROPRES.length).forEach((l, i) => {
        const [x, z, rot] = EMPLACEMENTS_PROPRES[i];
        // couleur choisie : le bandeau du bâtiment et ses menuiseries la portent (§5.4)
        installer(batimentPropre(l, effectifDe(l.id), COULEURS_DEP[val(l, 'couleur')] ?? P.cadre), l, x, z, rot);
        puce({ texte: l.nom, sorte: 'principal', monde: new THREE.Vector3(x, 0, z), hauteur: 8, id: l.id });
      });
      if (lieux.length === 0) {
        couches.entreprise.add(piece(B(24, 4, 16), matFantome, -21, 0, 18.5, false));
        puce({ texte: 'Votre entreprise ici : ajoutez vos lieux', sorte: 'principal', objet: { famille: 'lieu' }, monde: new THREE.Vector3(-21, 0, 18.5), hauteur: 6 });
      }
    }
    const premierConteneur = [...infos.keys()][0] ?? null;
    const infoDe = (id) => infos.get(id) ?? (modeDep ? infos.get(premierConteneur) : undefined);

    // employés : assis à leur poste ou debout à leur poste de travail ; anneau de présence au sol
    const equipes = new Map();
    const surChantier = new Map();
    for (const e of objets.filter((o) => o.famille === 'personne')) {
      const jour = e.jour ?? null;
      // planning du jour : un lieu d'affectation différent du rattachement déplace la personne (vue entreprise)
      const cont = !modeDep && jour?.type === 'lieu' && infos.has(jour.cible) ? jour.cible : conteneurDe(e);
      const info = infoDe(cont);
      if (!info) continue;
      const equipe = String(val(e, 'equipe') ?? '');
      if (!equipes.has(equipe)) equipes.set(equipe, EQUIPES[equipes.size % EQUIPES.length]);
      const dispo = val(e, 'disponibilite');
      const horsSite = jour && ['absence', 'mission', 'vide'].includes(jour.type);
      const present = jour ? !horsSite : dispo === null || dispo === 'disponible';
      const k = info.posteLibre++;
      const poste = info.b.postes[k] ?? { pos: new THREE.Vector3(-4 + ((k - info.b.postes.length) % 6) * 1.4, 0.18, (info.b.p ?? 12) / 2 - 1.5), rot: 0, assis: false };
      const prenom = e.nom.replace(/\s*\(démo\)/, '');
      const couleur = modeDep ? couleurDepartement(parId.get(conteneurDe(e)) ?? {}, 0) : equipes.get(equipe);
      if (jour?.type === 'projet' && jour.cible) {
        // sur chantier aujourd'hui : poste vide, la personne est dessinée chez le client
        if (!surChantier.has(jour.cible)) surChantier.set(jour.cible, []);
        surChantier.get(jour.cible).push({ e, prenom, couleur });
        continue;
      }
      if (!present) {
        // poste inoccupé : pas de silhouette, seulement l'information
        const motif = jour ? (jour.type === 'vide' ? 'non affecté' : jour.libelle.toLowerCase()) : dispo;
        puce({ texte: prenom, detail: motif, sorte: 'secondaire', monde: versMonde(info, poste.pos), hauteur: 1.6, id: e.id, categorie: 'employes', lod: jour?.type === 'vide' ? Infinity : 90,
          badge: jour?.type === 'vide' ? 'attention' : null, description: 'Pas affecté au planning aujourd’hui' });
        continue;
      }
      info.presents = (info.presents ?? 0) + 1;
      const fig = personne(e.id, couleur, { assis: poste.assis });
      fig.position.copy(versMonde(info, poste.pos));
      fig.rotation.y = info.rot + poste.rot;
      fig.traverse((x) => { x.castShadow = false; });
      contacts.push([fig.position.x, fig.position.z, 0.45]);
      enregistrer(fig, e, 'employes');
      if (dispo !== null) {
        const plein = e.provenance === 'confirme';
        couches.presence.add(piece(plein ? geo('pp', () => new THREE.RingGeometry(0.42, 0.56, 28).rotateX(-Math.PI / 2)) : geo('pd', () => anneauPointille(0.42, 0.56, 10)),
          mat(plein ? 0x2c7a45 : 0x2f6db3, { emissive: plein ? 0x2c7a45 : 0x2f6db3, emissiveIntensity: 0.4 }), fig.position.x, 0.21, fig.position.z, false));
      }
      puce({ texte: prenom, detail: dispo === null ? 'présence non renseignée' : null, sorte: 'secondaire', monde: fig.position, hauteur: poste.assis ? 1.55 : 2.05, id: e.id, categorie: 'prenoms', lod: 70 });
    }

    // stock en rayons, machines dedans, véhicules au parking avec leur état
    for (const r of objets.filter((o) => o.famille === 'ressource')) {
      const info = infoDe(conteneurDe(r));
      if (!info) continue;
      const perime = r.fraicheur !== 'fraiche';
      const icone = r.icone ?? r.type;
      if (icone === 'vehicule' || icone === 'outil' || icone === 'engin') {
        const indispo = val(r, 'disponible') === false;
        const nomV = r.nom.toLowerCase();
        const rndV = alea(hash(r.id));
        const g = icone === 'vehicule' ? (/camion/.test(nomV) ? camion(0x2f6fb0) : /voiture/.test(nomV) ? voiture(rndV) : camionnette())
          : /chariot/.test(nomV) ? chariotElevateur() : machine();
        const interieur = icone !== 'vehicule' && info.b.machines?.[info.machineLibre];
        const place = interieur ? info.b.machines[info.machineLibre++] : (info.b.parkings[info.parkingLibre++] ?? new THREE.Vector3(0, 0, 14 + info.parkingLibre * 5));
        g.position.copy(versMonde(info, place));
        g.rotation.y = info.rot + (interieur ? 0 : Math.PI / 2);
        const sits = trierNiveau(situationsPar.get(r.id) ?? []);
        const pire = sits[0];
        const niveau = indispo ? 'critique' : pire ? (pire.statut === 'a_verifier' ? 'info' : pire.gravite) : null;
        if (niveau === 'critique') g.add(piece(geo('anneauEtat', () => new THREE.RingGeometry(3, 3.4, 40).rotateX(-Math.PI / 2)), mat(P[niveau], { emissive: P[niveau], emissiveIntensity: 0.5 }), 0, 0.22, 0, false));
        fusionner(g);
        g.traverse((x) => { x.castShadow = false; });
        contacts.push([g.position.x, g.position.z, icone === 'vehicule' ? 2.6 : 1.4]);
        enregistrer(g, r, 'vehicules');
        if (icone === 'vehicule') {
          const etat = indispo ? 'Indisponible' : pire ? pire.description.replace(/\s*\(.*$/, '') : r.nom;
          puce({ texte: r.nom.replace(/\s*\((fictive?s?|démo)\)/gi, ''), detail: etat !== r.nom ? etat : null, plaque: val(r, 'immatriculation'), monde: g.position, hauteur: 3.4, id: r.id, categorie: 'vehicules', lod: niveau ? Infinity : 140,
            badge: niveau, description: etat });
        }
        continue;
      }
      const q = val(r, 'quantite');
      const s = val(r, 'seuil_alerte');
      const n = typeof q !== 'number' ? 2 : typeof s === 'number' && s > 0 ? Math.round((q / s) * 4.5) : Math.round(q / 15);
      const g = rack(n, typeof q === 'number' && typeof s === 'number' && q < s, perime);
      const place = info.b.rayons[info.rayonLibre++] ?? new THREE.Vector3(-4 + (info.rayonLibre % 3) * 4, 0.18, 3);
      g.position.copy(versMonde(info, place));
      g.rotation.y = info.rot;
      fusionner(g);
      g.traverse((x) => { x.castShadow = false; });
      enregistrer(g, r, 'stock');
      puce({ texte: r.nom, detail: typeof q === 'number' ? `${q}${val(r, 'unite') ? ` ${val(r, 'unite')}` : ''}` : 'quantité inconnue', sorte: 'secondaire', monde: g.position, hauteur: 4.6, id: r.id, categorie: 'prenoms', lod: 70 });
    }

    // tiers par quartier
    const parSecteur = new Map();
    for (const t of objets.filter((o) => o.famille === 'tiers')) {
      const s = secteur(t);
      if (!parSecteur.has(s)) parSecteur.set(s, []);
      parSecteur.get(s).push(t);
    }
    const facades = new Map();
    const coucheDe = (t) => { const r = t.roles.map((x) => x.id); return r.includes('fournisseur') ? 'fournisseurs' : r.includes('client') ? 'clients' : 'partenaires'; };
    for (const [s, liste] of parSecteur) {
      const zone = ZONES[s];
      liste.sort((a, b) => a.nom.localeCompare(b.nom));
      lots(zone, liste.length).forEach((lot, i) => {
        const t = liste[i];
        const couleur = couleurTiers(t);
        const rndT = alea(hash(t.id));
        const g = new THREE.Group();
        g.add(piece(B(15.5 * lot.echelle, 0.16, 15.5 * lot.echelle), ['clients', 'fournisseurs', 'prospects'].includes(s) ? matSol(s) : mat(P.herbe), 0, 0, 0, false));
        let bat;
        if (s === 'prospects') {
          // étal du marché, sur la plage : table, montants et auvent rayé chaux et ardoise (§5.5)
          bat = new THREE.Group();
          bat.add(piece(B(5, 0.9, 2.4), mat(P.bois), 0, 0, 0));
          for (const [x, z] of [[-2.4, -1.1], [2.4, -1.1], [-2.4, 1.1], [2.4, 1.1]]) bat.add(piece(B(0.1, 2.6, 0.1), mat(P.bois), x, 0, z, false));
          for (let i = 0; i < 6; i++) bat.add(piece(B(5.4 / 6, 0.08, 2.8), mat(i % 2 ? 'ardoise' : 'chaux'), -2.7 + (i + 0.5) * (5.4 / 6), 2.6, 0));
          for (let i = 0; i < 4; i++) bat.add(piece(B(0.8, 0.5, 0.6), mat(P.carton), -1.8 + i * 1.2, 0.9, 0, false));
        } else {
          bat = batimentTiers(t, couleur);
          bat.scale.multiplyScalar(lot.echelle);
          g.add(arbre(-6 * lot.echelle, -6 * lot.echelle, rndT, 0.8));
          const bu = modele('bush', 5);
          if (bu) g.add(placer(bu, 6 * lot.echelle, 0.16, -6 * lot.echelle));
          if (rndT() > 0.35) g.add(placer(voiture(rndT), 5.4 * lot.echelle, 0.16, 6.2 * lot.echelle, 0));
        }
        bat.position.y = 0.16;
        g.add(bat);
        g.updateMatrixWorld(true);
        const emprise = new THREE.Box3().setFromObject(bat);
        facades.set(t.id, { avant: emprise.max.z, centre: (emprise.min.x + emprise.max.x) / 2, bord: 7.75 * lot.echelle });
        g.position.set(lot.x, 0, lot.z);
        g.rotation.y = ROTATION_FACE[zone.face];
        enregistrer(g, t, s === 'prospects' ? 'partenaires' : coucheDe(t));
        peindre(g, t);
        fusionner(g);
        const pt = puce({ texte: t.nom.replace(/\s*\((fictive?s?|démo)\)/gi, ''), quartier: s, monde: new THREE.Vector3(lot.x, 0, lot.z), hauteur: s === 'prospects' ? 4 : 12, id: t.id, categorie: 'noms', lod: 230 });
        // satisfaction datée (formulaires) : visible sur le bâtiment du client
        const sat = monde.satisfaction?.clients?.[t.id];
        if (sat && s !== 'prospects') {
          // la satisfaction rejoint la pastille du client (un seul repère par bâtiment) ; mécontent : badge d'attention
          const st = sat.note === null ? 'inconnue' : sat.statut;
          const avis = sat.note === null ? (sat.envoyeLe ? 'avis demandé' : 'avis non renseigné') : `avis ${sat.note} sur 10${sat.tendance ? (sat.tendance > 0 ? ', en hausse' : ', en baisse') : ''}`;
          ajouterDetail(pt, avis);
          if (st === 'mauvaise') poserBadge(pt, 'attention', 1, `Client mécontent : ${avis}`);
        }
      });
    }

    // étiquettes de quartier
    const pl = (id) => role(id)?.pluriel;
    const compte = (s) => parSecteur.get(s)?.length ?? 0;
    for (const [texte, s, x, z] of [
      [pl('client') ?? 'Clients', 'clients', -72, -34.5],
      [pl('fournisseur') ?? 'Fournisseurs', 'fournisseurs', 72, -34.5],
      [pl('partenaire') ?? 'Partenaires', 'nord', 0, -57],
      [pl('prospect') ?? 'Prospects', 'prospects', -72, 44],
    ]) {
      if (!compte(s)) continue;
      quartierAuSol(texte, x, s === 'prospects' ? z : z + 4);
      groupeQuartier(s, texte, x, s === 'nord' ? -57 : s === 'prospects' ? 44 : 0);
    }
    if (!modeDep) quartierAuSol('Mon entreprise', 0, 1);
    if (objets.some((o) => o.famille === 'ressource')) quartierAuSol('Quais', 30, 44);

    // projets : échafaudage chez le client
    for (const p of objets.filter((o) => o.famille === 'projet')) {
      const facade = facades.get(lien(p, 'client'));
      const ancre = racines.get(lien(p, 'client')) ?? (p.lieu ? racines.get(p.lieu) : null);
      if (!ancre) continue;
      const av = val(p, 'avancement');
      const g = new THREE.Group();
      const orange = mat(P.orangeRayon, { roughness: 0.5, metalness: 0.3 });
      for (const [x, z] of [[-2.4, -0.7], [2.4, -0.7], [-2.4, 0.7], [2.4, 0.7]]) g.add(piece(B(0.08, 7, 0.08), orange, x, 0, z));
      for (const y of [1.8, 3.6, 5.4]) g.add(piece(B(5, 0.08, 1.5), mat(P.bois), 0, y, 0, false));
      for (const y of [2.8, 4.6, 6.4]) g.add(piece(B(5, 0.05, 0.05), orange, 0, y, 0.75, false));
      ancre.updateMatrixWorld(true);
      // échafaudage contre la façade avant du client, zone de chantier balisée devant
      const zAvant = facade ? Math.min(facade.avant + 0.9, facade.bord - 1.2) : 0;
      g.position.copy(ancre.localToWorld(facade ? new THREE.Vector3(facade.centre - 1.6, 0.16, zAvant) : new THREE.Vector3(6.4, 0.16, 0)));
      g.rotation.y = ancre.rotation.y;
      if (facade) {
        const rouge = mat(0xd23b2f, { roughness: 0.6 });
        const blanc = mat(0xf4f4f0, { roughness: 0.6 });
        for (let i = 0; i < 6; i++) {
          const x = -3.6 + i * 1.44;
          g.add(piece(B(0.06, 0.9, 0.06), mat(P.metal), x, 0, 3.3, false));
          g.add(piece(B(1.44, 0.12, 0.03), i % 2 ? rouge : blanc, x + 0.72 > 3.6 ? x : x + 0.72, 0.8, 3.3, false));
        }
        g.add(piece(B(1.2, 0.9, 0.9), mat(P.carton), 3.2, 0, 1.6));
        g.add(piece(B(0.7, 0.5, 0.5), mat(0x8a8f96), 2.6, 0, 2.5));
      }
      fusionner(g);
      enregistrer(g, p, 'entreprise');
      g.updateMatrixWorld(true);
      const equipe = surChantier.get(p.id) ?? [];
      const besoin = val(p, 'besoin_effectif');
      equipe.forEach(({ e, prenom, couleur }, i) => {
        const fig = personne(e.id, couleur, { casque: true });
        const local = new THREE.Vector3(-2.2 + (i % 4) * 1.3, 0, 1.6 + Math.floor(i / 4) * 0.9);
        fig.position.copy(g.localToWorld(local.clone()));
        fig.position.y = 0.16;
        fig.rotation.y = g.rotation.y + Math.PI + (i % 2 ? 0.4 : -0.3);
        fig.traverse((x) => { x.castShadow = false; });
      contacts.push([fig.position.x, fig.position.z, 0.45]);
      enregistrer(fig, e, 'employes');
        puce({ texte: prenom, classe: 'employe prenom chantier', monde: fig.position, hauteur: 2.1, id: e.id, categorie: 'prenoms', lod: 70 });
      });
      const pp = puce({ texte: p.nom.split('—')[0].trim(), detail: typeof av === 'number' ? `${av} %` : 'avancement inconnu', monde: g.position, hauteur: 7.5, id: p.id, categorie: 'noms', lod: 200 });
      if (typeof besoin === 'number') {
        const manque = besoin - equipe.length;
        ajouterDetail(pp, `équipe ${equipe.length} sur ${besoin}`);
        if (manque > 0) { poserBadge(pp, equipe.length === 0 ? 'critique' : 'attention', manque, `Il manque ${pluriel(manque, 'personne', 'personnes')} sur le chantier`); pp.lod = Infinity; }
      }
    }

    // courrier à traiter : un bac par bâtiment (destinataire ou département), drapeau si urgent
    const siegeId = objets.find((o) => o.famille === 'lieu' && (o.icone ?? o.type) === 'siege')?.id ?? null;
    const bacs = new Map();
    for (const c of objets.filter((o) => o.type === 'courrier' && val(o, 'statut') !== 'traité')) {
      const dest = parId.get(val(c, 'destinataire'));
      const cont = modeDep ? (val(c, 'departement') ?? (dest ? val(dest, 'departement') : null)) : (dest?.lieu ?? siegeId);
      const cle = infos.has(cont) ? cont : siegeId && infos.has(siegeId) ? siegeId : premierConteneur;
      if (!cle) continue;
      if (!bacs.has(cle)) bacs.set(cle, []);
      bacs.get(cle).push(c);
    }
    for (const [cont, mails] of bacs) {
      const info = infos.get(cont);
      const place = info?.b.courrier;
      if (!place) continue;
      const urgents = mails.filter((c) => val(c, 'urgence') === 'haute');
      const g = bacCourrier(mails.length, urgents.length);
      g.position.copy(versMonde(info, place));
      g.rotation.y = info.rot;
      const tete = urgents[0] ?? mails[0];
      g.userData = { id: tete.id, nom: `Courrier · ${mails.length} à traiter`, libelle: 'Courrier' };
      fusionner(g);
      couches.entreprise.add(g);
      puce({ texte: 'Courrier', detail: `${mails.length} à traiter`, sorte: 'secondaire', monde: g.position, hauteur: 1.7, id: tete.id, categorie: 'prenoms', lod: urgents.length ? 120 : 80,
        badge: urgents.length ? 'attention' : null, nombre: urgents.length, description: urgents.length ? pluriel(urgents.length, 'courrier urgent', 'courriers urgents') : '' });
    }

    // flux de commandes en cours
    const FINAUX_FLUX = ['livrée', 'facturée', 'reçue', 'refusé', 'accepté'];
    const lieuType = (t) => objets.find((o) => o.famille === 'lieu' && (o.icone ?? o.type) === t)?.id;
    for (const c of objets.filter((o) => ['commande_client', 'commande_fournisseur', 'devis'].includes(o.type) && !FINAUX_FLUX.includes(String(val(o, 'statut')))).slice(0, 24)) {
      const achat = c.type === 'commande_fournisseur';
      const tiersG = racines.get(lien(c, achat ? 'fournisseur' : 'client'));
      const nous = racines.get(modeDep ? val(c, 'departement') : null) ?? racines.get(achat ? lieuType('entrepot') : lieuType('siege')) ?? racines.get(premierConteneur);
      if (!tiersG || !nous) continue;
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      (achat ? tiersG : nous).getWorldPosition(a);
      (achat ? nous : tiersG).getWorldPosition(b);
      a.y = 6;
      b.y = 6;
      const milieu = a.clone().lerp(b, 0.5);
      milieu.y = 16 + a.distanceTo(b) * 0.12;
      const courbe = new THREE.QuadraticBezierCurve3(a, milieu, b);
      const couleur = couleurDe(achat ? 'bois' : c.type === 'devis' ? 'ardoise' : 'surbrillance');
      const ligne = new THREE.Line(new THREE.BufferGeometry().setFromPoints(courbe.getPoints(56)), new THREE.LineDashedMaterial({ color: couleur, dashSize: 1.8, gapSize: 1.2, transparent: true, opacity: 0.8 }));
      ligne.computeLineDistances();
      ligne.userData.jetable = 'ligne';
      couches.flux.add(ligne);
      const colis = piece(B(1.2, 1.2, 1.2), mat(c.type === 'devis' ? 0xf4f1e8 : P.carton), 0, 0, 0, false);
      colis.userData = { id: c.id, nom: c.nom, libelle: c.libelleType };
      colis.userData.horsOcclusion = true;
      couches.flux.add(colis);
      flux.push({ courbe, colis, t: (hash(c.id) % 100) / 100, v: 0.05 + (hash(c.id) % 7) * 0.006 });
    }

    // situations : anneau pulsé + pastille (critiques toujours, autres en zoomant)
    const parAncre = new Map();
    for (const s of monde.situations) {
      const o = parId.get(s.objetId);
      let ancreId = racines.has(s.objetId) ? s.objetId : null;
      if (!ancreId && o) ancreId = o.champs.find((c) => c.lien && racines.has(c.lien.id))?.lien.id ?? null;
      if (!ancreId) ancreId = premierConteneur;
      if (!ancreId) continue;
      const niveau = s.statut === 'a_verifier' || s.gravite === 'info' ? 'info' : s.gravite;
      if (!parAncre.has(ancreId)) parAncre.set(ancreId, []);
      parAncre.get(ancreId).push({ s, niveau });
    }
    for (const [ancreId, liste] of parAncre) {
      liste.sort((a, b) => RANG[a.niveau] - RANG[b.niveau]);
      const { s, niveau } = liste[0];
      const pos = new THREE.Vector3();
      racines.get(ancreId).getWorldPosition(pos);
      const grand = ['lieu', 'departement', 'tiers'].includes(parId.get(ancreId)?.famille);
      // un problème critique seulement : anneau au sol, une pulsation de 1,2 s toutes les 4 s (§5.4)
      if (grand && niveau === 'critique' && parId.get(ancreId)?.famille !== 'departement') {
        const a = piece(geo('anneauAlerte', () => new THREE.RingGeometry(8.2, 9.2, 64).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ color: P[niveau], transparent: true, opacity: 0.75, depthWrite: false }), pos.x, 0.3, pos.z, false);
        a.userData.jetable = 'materiau';
        couches.alertes.add(a);
        anneauxAlerte.push({ a, phase: pos.x });
      }
      if (parId.get(ancreId)?.famille === 'departement') continue;
      // niveau 3 : badge d'état collé à la pastille de l'objet (jamais de couleur sur le bâtiment lui-même)
      const court = s.description.replace(/\s*[—(].*$/, '').replace(/\.$/, '');
      const desc = liste.length > 1 ? `${court}, et ${pluriel(liste.length - 1, 'autre alerte', 'autres alertes')}` : court;
      const porteur = parObjet.get(ancreId) ?? parObjet.get(s.objetId);
      if (porteur) { if (!porteur.badge || RANG[niveau] <= RANG[porteur.badge]) poserBadge(porteur, niveau, liste.length, desc); porteur.lod = Infinity; }
      else puce({ texte: parId.get(ancreId)?.nom ?? court, monde: pos, hauteur: grand ? 14 : 4.5, id: ancreId, categorie: 'alertes', badge: niveau, nombre: liste.length, description: desc });
    }

    // phare Breizhcosystem
    const ph = phare(monde.pavillon.apparence);
    ph.g.position.set(0, 0, zCote + 17);
    ph.g.userData = { id: '__pavillon', nom: 'Phare Breizhcosystem', libelle: monde.pavillon.message };
    fusionner(ph.g);
    couches.entreprise.add(ph.g);
    racines.set('__pavillon', ph.g);
    centreVille.visible = !modeDep;
    uLot.uMasque.value[MASQUE.centreVille] = modeDep ? 0 : 1;
    faisceau = ph.faisceau;
    lanterne = ph.lanterne;
    const etatNexus = { endormi: 'éteint, découverte', gratuit: 'allumé, gratuit', actif: 'allumé, relié', en_attente: 'paiement en attente', hors_ligne: 'hors ligne' }[monde.pavillon.apparence] ?? '';
    puce({ texte: 'Phare Breizhcosystem', detail: etatNexus, sorte: 'principal', objet: { id: '__pavillon' }, monde: ph.g.position, hauteur: 19, id: '__pavillon', categorie: 'noms' });

    // circulation illustrative (voitures réelles sur les voies de droite)
    const boucles = [[[-88, -2], [88, -2]], [[88, 2], [-88, 2]], [[-44, -66], [-44, 34]], [[48, 34], [48, -66]], [[-2, -66], [-2, 34]], [[2, 34], [2, -66]], [[80, -38.3], [-80, -38.3]], [[-80, 38.6], [80, 38.6]]];
    const rndC = alea(7);
    boucles.forEach(([a, b], i) => {
      if (PROFIL.qualite === 'economie' && i % 2) return; // Économie : moitié moins de voitures (illustratives)
      if (modeDep && (Math.abs(a[0]) < 5 && Math.abs(b[0]) < 5 || Math.abs(a[1]) < 5 && Math.abs(b[1]) < 5)) return;
      const v = voiture(rndC);
      v.traverse((x) => { x.castShadow = false; });
      cuireDecor(v); // une voiture = un ou deux appels de dessin
      couches.trafic.add(v);
      trafic.push({ v, a: new THREE.Vector3(a[0], 0.12, a[1]), b: new THREE.Vector3(b[0], 0.12, b[1]), t: (i * 0.19) % 1, vitesse: 0.012 + (i % 3) * 0.004 });
    });

    for (const o of objets.filter((x) => x.simule)) {
      const g = racines.get(o.id);
      if (g) g.add(piece(geo('anneauSimu', () => new THREE.RingGeometry(3.2, 3.7, 40).rotateX(-Math.PI / 2)), mat(P.simu, { emissive: P.simu, emissiveIntensity: 0.6 }), 0, 0.45, 0, false));
    }
    poserOmbresContact(contacts);
    // fenêtres allumées la nuit dans les bâtiments où l'équipe est présente (§5.2)
    for (const info of infos.values()) if (info.presents) for (const m of info.b.murs ?? []) m.traverse((x) => { if (x.isMesh && x.material === matVerre) fenetres.push(x); });
    cuireCalques();
    // « La maquette se peint » (§4.27) : les bâtiments passés du plâtre à une vraie donnée prennent leurs couleurs un par un
    const peints = new Set(objets.filter((o) => racines.has(o.id) && peintureDe(o) !== 'platre').map((o) => o.id));
    if (peintsAvant) {
      const nouveaux = [...peints].filter((id) => !peintsAvant.has(id));
      if (nouveaux.length) peindreProgressivement(nouveaux);
    }
    peintsAvant = peints;
    appliquerCalques();
    selectionner(selection, false);
    appliquerHeure();
    renderer.shadowMap.needsUpdate = true;
    requestAnimationFrame(() => { mesurer(); etiquettesASituer = true; demander(); });
  }

  function ajouterDetail(p, texte) {
    if (!p || !texte) return;
    p.detail = p.detail ? `${p.detail}, ${texte}` : texte;
    let d = p.el.querySelector('.bz-etiquette__detail');
    if (!d) { d = document.createElement('span'); d.className = 'bz-etiquette__detail'; p.el.querySelector('.bz-etiquette__alerte') ? p.el.insertBefore(d, p.el.querySelector('.bz-etiquette__alerte')) : p.el.append(d); }
    d.textContent = typo(p.detail);
  }
  let disqueContact = null;
  const texContact = (() => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(32, 32, 2, 32, 32, 32);
    // ombre de contact : l'encre de la scène, de 42 % au centre à 0 au bord
    g.addColorStop(0, avecOpacite(teinteScene('encre'), 0.42));
    g.addColorStop(1, avecOpacite(teinteScene('encre'), 0));
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  })();
  const matContact = new THREE.MeshBasicMaterial({ map: texContact, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 });
  function poserOmbresContact(liste) {
    if (disqueContact) { scene.remove(disqueContact); disqueContact.dispose(); disqueContact = null; }
    if (!liste.length) return;
    disqueContact = new THREE.InstancedMesh(geo('contact', () => new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2)), matContact, liste.length);
    const m = new THREE.Matrix4();
    liste.forEach(([x, z, r], i) => disqueContact.setMatrixAt(i, m.compose(new THREE.Vector3(x, 0.2, z), new THREE.Quaternion(), new THREE.Vector3(r, 1, r))));
    disqueContact.instanceMatrix.needsUpdate = true;
    disqueContact.renderOrder = 1;
    scene.add(disqueContact);
  }
  /* Contour permanent (§5.4) : coque inversée écartée de 3 cm le long des normales. Une mise à l'échelle laisserait
     les faces minces (murs, vitrages, casquettes) collées à l'objet : elles se disputaient le pixel avec lui et
     grésillaient le long de chaque arête dès qu'on s'éloignait. */
  const matContour = suivre(new THREE.MeshBasicMaterial({ side: THREE.BackSide }), 'contour');
  matContour.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n  transformed += normalize(normal) * ${EPAISSEUR_CONTOUR.toFixed(3)};`); };
  matContour.customProgramCacheKey = () => 'contour';
  const matSurbrillance = suivre(new THREE.MeshBasicMaterial({ side: THREE.BackSide }), 'surbrillance');
  // contour de sélection : la coque est gonflée le long des normales (8 cm), quelle que soit la taille de la pièce
  matSurbrillance.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed += normalize(normal) * 0.08;'); };
  matSurbrillance.customProgramCacheKey = () => 'surbrillance';
  /** Bâtiment de l'entreprise : toon à 3 paliers, contour permanent (coque inversée de 1,5 %), mobilier fusionné. */
  function habiller(b, o) {
    for (const m of b.murs ?? []) { m.userData.garder = true; m.traverse((x) => { if (x.isMesh) x.material = toon(x.material); }); fusionner(m); }
    if (b.toit) { b.toit.userData.garder = true; fusionner(b.toit); }
    b.g.traverse((x) => { if (x.isMesh && !x.userData.coque) x.material = toon(x.material); });
    for (const m of b.murs ?? []) {
      for (const x of [...m.children]) {
        if (!x.isMesh || x.material.transparent || x.material === matVerre) continue;
        const c = new THREE.Mesh(x.geometry, matContour);
        c.userData.coque = true;
        c.castShadow = false;
        x.add(c);
      }
    }
    peindre(b.g, o);
    fusionner(b.g, (x) => x.userData.coque);
  }
  /** Moment « la maquette se peint » : du siège vers l'extérieur, 40 ms d'écart, 1,2 s en tout (§4.27). */
  function peindreProgressivement(ids) {
    const ecart = mouvementReduit() ? 0 : Number.parseFloat(lireJeton('--bz-d-peinture-ecart')) || 40;
    const total = mouvementReduit() ? 0 : Number.parseFloat(lireJeton('--bz-d-peinture')) || 1200;
    const ordre = ids.map((id) => ({ id, g: racines.get(id) })).filter((x) => x.g).sort((a, b) => a.g.position.length() - b.g.position.length());
    const pas = ordre.length > 1 ? Math.min(ecart, total / ordre.length) : 0;
    ordre.forEach(({ id, g }, i) => {
      const avant = [];
      g.traverse((m) => { if (m.isMesh && !m.userData.coque && m.material) { avant.push([m, m.material]); m.material = variante(m.material, 'platre'); } });
      ecrireEtat(id, 0, 0); // lots : plâtre, puis la couleur
      setTimeout(() => { for (const [m, mt] of avant) m.material = mt; ecrireEtat(id, 0, 255); demander(); }, i * pas);
    });
    demander();
  }

  const vecCam = new THREE.Vector3();
  const haut = new THREE.Vector3(0, 1, 0);
  function majMurs() {
    controles.getTarget(cible);
    vecCam.copy(camera.position).sub(cible).setY(0).normalize();
    const polaire = camera.position.clone().sub(cible).angleTo(haut);
    const ferme = etatCalques.toits === true || polaire < 0.12;
    // lots : un drapeau par orientation, lu par le vertex shader ; maillages d'origine (pointage) : à la même échelle
    uLot.uBaisse.value = mursBaisses([vecCam.x, vecCam.z], ferme);
    for (const m of murs) m.scale.y = echelleMur(uLot.uBaisse.value[orientationMur(m.userData.normaleMonde.x, m.userData.normaleMonde.z)], m.userData.hauteur);
    for (const t of toits) t.visible = etatCalques.toits === true;
  }
  /** Niveaux de détail des lots (§5.10) : silhouettes et mobilier de près seulement, jamais en qualité Économie. */
  function majDetails(force = false) {
    controles.getTarget(cible);
    const dt = details({ distance: camera.position.distanceTo(cible), maxDistance: controles.maxDistance, economie: PROFIL.qualite === 'economie', employes: etatCalques.employes !== false, entreprise: etatCalques.entreprise !== false });
    const m = uLot.uMasque.value;
    const personnes = dt.personnes ? 1 : 0;
    const mobilier = dt.mobilier ? 1 : 0;
    if (force || m[MASQUE.personnes] !== personnes || m[MASQUE.mobilier] !== mobilier) {
      m[MASQUE.personnes] = personnes;
      m[MASQUE.mobilier] = mobilier;
      for (const l of groupeLots.children) if (l.userData.detail) l.visible = Boolean(m[l.userData.detail === 'personnes' ? MASQUE.personnes : MASQUE.mobilier]);
      renderer.shadowMap.needsUpdate = true;
    }
  }
  function appliquerCalques() {
    NOMS_COUCHES.forEach((k, i) => { couches[k].visible = etatCalques[k] !== false; uLot.uMasque.value[1 + i] = couches[k].visible ? 1 : 0; });
    majDetails(true);
    majMurs();
    etiquettesASituer = true;
    renderer.shadowMap.needsUpdate = true;
    demander();
  }
  let selection = null;
  let coqueSelection = null;
  /** Sélection : contour en coque inversée gonflée de 8 cm (--bz-scene-*-surbrillance) ; l'étiquette passe au premier plan. */
  function selectionner(id, centrer = true) {
    selection = id;
    if (coqueSelection) { for (const c of coqueSelection) { c.parent?.remove(c); if (c.userData.jetable === 'geometrie') c.geometry.dispose(); } coqueSelection = null; }
    const g = id ? racines.get(id) : null;
    if (g) {
      // un seul maillage : les coques de toutes les pièces, cuites dans l'espace de l'objet ; les murs gardent la leur
      // (enfant du mur, elle s'abaisse avec lui)
      coqueSelection = [];
      const surMur = new Set();
      for (const m of murs) m.traverse((x) => surMur.add(x));
      const pieces = [];
      g.traverseVisible((m) => { if (m.isMesh && !m.userData.coque && !m.userData.lot && !m.material?.transparent) pieces.push(m); }); // pas le toit masqué
      g.updateMatrixWorld(true);
      const inverse = new THREE.Matrix4().copy(g.matrixWorld).invert();
      const copies = [];
      const surMurs = [];
      for (const m of pieces) {
        if (!m.geometry.attributes.normal) continue;
        if (surMur.has(m)) {
          const c = new THREE.Mesh(m.geometry, matSurbrillance);
          c.userData.coque = true;
          surMurs.push([m, c]);
          coqueSelection.push(c);
          continue;
        }
        const copie = new THREE.BufferGeometry().setAttribute('position', m.geometry.attributes.position.clone()).setAttribute('normal', m.geometry.attributes.normal.clone());
        copie.setIndex(m.geometry.index ? m.geometry.index.clone() : [...Array(copie.attributes.position.count).keys()]);
        copie.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, m.matrixWorld));
        copies.push(copie);
      }
      for (const [m, c] of surMurs) m.add(c); // ajoutées après le parcours
      const fusion = copies.length > 1 ? mergeGeometries(copies, false) : copies[0];
      if (copies.length > 1) for (const c of copies) c.dispose();
      if (fusion) {
        const c = new THREE.Mesh(fusion, matSurbrillance);
        c.userData.coque = true;
        c.userData.jetable = 'geometrie';
        c.raycast = () => {};
        g.add(c);
        coqueSelection.push(c);
      }
      const p = new THREE.Vector3();
      g.getWorldPosition(p);
      const petit = !['lieu', 'departement'].includes(g.userData?.famille);
      if (centrer && !dedans) volerVers(new THREE.Vector3(p.x, 0, p.z), Math.min(controles.distance, petit ? 70 : 110), Math.min(1.05, controles.polarAngle));
    }
    etiquettesASituer = true;
    demander();
  }

  // ---------------------------------------------------------------- lumière à l'heure réelle (§5.3)
  const dirSoleil = new THREE.Vector3();
  function appliquerHeure(etat = etatHeure(new Date(), { reglage: reglageHeure, themeSombre: themeSombre() })) {
    const avant = ETAT.nuit;
    ETAT = etat;
    const l = lumieres(PAL, ETAT);
    hemi.color.set(l.hemiCiel);
    hemi.groundColor.set(l.hemiSol);
    // intensités du §5.3 en unités « héritées » : three.js ≥ r155 compte en unités physiques (facteur π)
    hemi.intensity = l.hemiIntensite * Math.PI;
    soleil.color.set(l.soleil);
    soleil.intensity = l.soleilIntensite * Math.PI;
    dirSoleil.set(-Math.sin(ETAT.azimut) * Math.cos(ETAT.elevation), Math.sin(ETAT.elevation), Math.cos(ETAT.azimut) * Math.cos(ETAT.elevation)).normalize();
    ciel.material.uniforms.uZenith.value.set(l.zenith);
    ciel.material.uniforms.uHorizon.value.set(l.horizon);
    scene.fog.color.set(l.brume);
    for (const { m, role } of suivis) m.color.copy(role === 'texture' ? facteurTexture() : couleurDe(role));
    for (const f of fenetres) f.material = l.fenetresAllumees ? matVerreAllume : matVerre;
    uLot.uNuit.value = ETAT.nuit; // lots : teinte de jour → nuit dans les sommets
    uLot.uFenetres.value = l.fenetresAllumees ? 1 : 0;
    uLot.uCouleurFenetres.value.copy(couleurDe('fenetres'));
    // noms au sol : encre et halo du jour ou de la nuit (deux textures, sans opacité)
    const nuit = ETAT.nuit >= 0.5;
    for (const t of textesSol) {
      if (nuit && !t.nuit) t.nuit = toileTexte(t.texte, PAL.nuit.encre, PAL.nuit.halo);
      const v = nuit ? t.nuit : t.jour;
      if (t.mesh.material.map !== v.t) { t.mesh.material.map = v.t; t.mesh.material.needsUpdate = true; }
    }
    if (Math.abs(avant - ETAT.nuit) > 0.001) renderer.shadowMap.needsUpdate = true;
    majOmbre();
    demander();
  }
  /** Le frustum de la caméra d'ombre suit la zone visible (§5.3). */
  function majOmbre() {
    if (!PROFIL.ombres) return;
    controles.getTarget(cible);
    const s = Math.max(28, Math.min(120, controles.distance * 0.62));
    const c = soleil.shadow.camera;
    c.left = -s; c.right = s; c.top = s; c.bottom = -s; c.near = 10; c.far = 420;
    c.updateProjectionMatrix();
    soleil.target.position.copy(cible);
    soleil.position.copy(cible).addScaledVector(dirSoleil, 180);
    soleil.target.updateMatrixWorld();
    renderer.shadowMap.needsUpdate = true;
  }
  const minuteur = setInterval(() => appliquerHeure(), 60000);

  // ---------------------------------------------------------------- rendu à la demande (§5.8, §5.10)
  let raf = 0;
  let fete = null; // fin de quête en cours (§4.27) : { debut, duree, base }
  let rappel = 0;
  let derniereImage = 0;
  let derniereInteraction = performance.now();
  let tempsAmbiance = 0;
  let premiere = true;
  const taille = () => {
    zoneCache = null;
    const { clientWidth: w, clientHeight: h } = conteneur;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    if (composer) {
      composer.setSize(w, h);
      gtao?.setSize?.(Math.round(w / 2), Math.round(h / 2)); // occlusion à demi-résolution
    }
    camera.aspect = w / h;
    // le centre de la vue est celui de la zone que le HUD laisse libre (panneau « Aujourd'hui » à gauche, feuille en bas)
    const { gauche = 0, bas = 0 } = zoneLibre() ?? {};
    const g = Math.max(0, Math.min(w * 0.5, gauche));
    const b = Math.max(0, Math.min(h * 0.6, bas));
    camera.aspect = (w + g) / (h + b); // proportions de l'image virtuelle entière : aucune déformation
    if (g || b) camera.setViewOffset(w + g, h + b, 0, b, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    etiquettesASituer = true;
    demander();
  };
  const obs = new ResizeObserver(taille);
  obs.observe(conteneur);
  let visible = true;
  const io = new IntersectionObserver((e) => { visible = e.some((x) => x.isIntersecting); if (visible) demander(); else couperBoucle(); });
  io.observe(conteneur);
  const surVisibilite = () => { if (document.hidden) couperBoucle(); else { reveiller(); } };
  document.addEventListener('visibilitychange', surVisibilite);
  taille();

  const horloge = new THREE.Timer();
  horloge.connect?.(document);
  let veille = surveillance({ budgetMs: PROFIL.budget.msParImage, debut: performance.now() });
  let mesure = { images: 0, depuis: performance.now(), ips: 0, msMoyen: 0 };
  let pulsation = 0;
  function demander() {
    if (raf || !visible || document.hidden) return;
    raf = requestAnimationFrame(image);
  }
  function planifier(ms) {
    if (rappel) return;
    rappel = setTimeout(() => { rappel = 0; demander(); }, ms);
  }
  function reveiller() { derniereInteraction = performance.now(); demander(); }
  function couperBoucle() { cancelAnimationFrame(raf); raf = 0; clearTimeout(rappel); rappel = 0; }
  const ambianceActive = () => animations && !enPause && !mouvementReduit();
  for (const ev of ['control', 'controlstart', 'controlend', 'transitionstart', 'update', 'wake']) controles.addEventListener(ev, reveiller);
  /* Caméra en mouvement : « wake » au départ, « sleep » ou « rest » à l'arrêt. camera-controls garde `active` à vrai
     après un déplacement instantané (setLookAt sans transition, comme le cadrage d'ouverture) : s'y fier ferait
     calculer une image par seconde d'écran pour toujours, alors que rien ne bouge (§5.10). */
  let cameraEnMouvement = false;
  controles.addEventListener('wake', () => { cameraEnMouvement = true; });
  for (const ev of ['sleep', 'rest']) controles.addEventListener(ev, () => { cameraEnMouvement = false; });

  function image(t) {
    raf = 0;
    const maintenant = performance.now();
    const debutCalcul = maintenant;
    const intervalle = 1000 / PROFIL.images;
    if (maintenant - derniereImage < intervalle - 2 && !premiere) { raf = requestAnimationFrame(image); return; }
    const ecart = maintenant - derniereImage;
    derniereImage = maintenant;
    horloge.update(t);
    const dt = Math.min(0.1, horloge.getDelta());
    const bouge = controles.update(dt);
    const inactif = maintenant - derniereInteraction;
    const ambiance = ambianceActive() && inactif < CADENCE.pauseApresMs;
    if (bouge) { majMurs(); majOmbre(); etiquettesASituer = true; }
    // vie ambiante : pleine de près, éteinte en vue d'ensemble (§5.8) — au loin, la carte redevient une image fixe
    const vie = ambiance ? vieAmbiante(controles.distance) : 0;
    if (vie > 0) animer(dt, vie);
    if (survolEnAttente) {
      const e = survolEnAttente;
      survolEnAttente = null;
      const d = choisir(e.clientX, e.clientY);
      const r = canvas.getBoundingClientRect();
      survolerRacine(d ? d.id : null);
      surSurvol(d ? { ...d, x: e.clientX - r.left, y: e.clientY - r.top } : null);
      canvas.style.cursor = d ? 'pointer' : '';
    }
    camera.updateMatrixWorld();
    ciel.position.copy(camera.position);
    controles.getTarget(cible);
    const d = camera.position.distanceTo(cible);
    scene.fog.near = d + 40;
    scene.fog.far = d + 260;
    couches.alertes.visible = etatCalques.alertes !== false && d > 70; // de près, les anneaux gêneraient la lecture de l'intérieur
    accessoires.visible = PROFIL.accessoires && d < 0.6 * controles.maxDistance; // sous 40 % du zoom : petits accessoires masqués
    if (uLot.uMasque.value[MASQUE.accessoires] !== (accessoires.visible ? 1 : 0)) { uLot.uMasque.value[MASQUE.accessoires] = accessoires.visible ? 1 : 0; renderer.shadowMap.needsUpdate = true; }
    majDetails();
    if (fete) {
      const p = Math.min(1, (maintenant - fete.debut) / fete.duree);
      fanions.position.y = -2.4 * (1 - p) ** 3; // les fanions montent sur le quai
      if (lanterne) lanterne.color.copy(p > 0.55 && p < 0.85 ? couleurDe('soleil') : fete.base); // le phare clignote une fois
      if (p >= 1) { fanions.position.y = 0; if (lanterne) lanterne.color.copy(fete.base); fete = null; renderer.shadowMap.needsUpdate = true; }
    }
    renderer.info.reset();
    if (composer && gtao) composer.render(); else renderer.render(scene, camera);
    if (capturerApres) { capturerApres = false; capturer(); }
    if (premiere) { premiere = false; surPremiereImage(); }
    if (etiquettesASituer) situer();
    if (bouge) surCamera({ azimut: controles.azimuthAngle, distance: d, cadre: cadreVue() });
    // qualité adaptative : temps par image mesuré pendant les images enchaînées
    const calcul = performance.now() - debutCalcul;
    if (ecart < 250) {
      mesure.images++;
      mesure.msMoyen += (calcul - mesure.msMoyen) / Math.min(30, mesure.images);
      if (veille.noter(calcul, maintenant) && options.qualite !== qualite && (options.qualite ?? 'auto') === 'auto' && qualite !== 'economie') descendre();
    }
    // la suite : pleine cadence tant que ça bouge ; 20 images/s pour l'ambiance après 30 s ; pause après 2 min
    if (bouge || cameraEnMouvement || zoomUneMain || fete) demander();
    else if (ambiance && vie > 0) {
      if (inactif < CADENCE.ambianceApresMs) demander();
      else planifier(1000 / CADENCE.ambiance);
    } else { /* image fixe (vue d'ensemble ou longue inaction) : reprise au premier mouvement */ }
  }
  /** `vie` (1 de près, 0 en vue d'ensemble) ralentit tout jusqu'à l'arrêt : rien ne bouge sans qu'on puisse le voir. */
  function animer(dt, vie = 1) {
    const pas = dt * vie;
    tempsAmbiance += pas; // mer, fanions, phare, bateaux : leur temps se fige avec l'éloignement
    const t = tempsAmbiance;
    uTemps.value = t;
    for (const f of flux) { f.t = (f.t + f.v * pas) % 1; f.colis.position.copy(f.courbe.getPoint(f.t)).setY(f.colis.position.y - 0.6); }
    // anneau critique : une pulsation de 1,2 s toutes les 4 s
    pulsation = (t % 4) / 1.2;
    for (const { a } of anneauxAlerte) { const s = pulsation < 1 ? 1 + 0.12 * vie * Math.sin(Math.PI * pulsation) : 1; a.scale.set(s, 1, s); }
    if (faisceau) faisceau.rotation.y = (t * Math.PI * 2) / 8; // une rotation en 8 s
    for (const { b, y, phase } of bateaux) { b.position.y = y + Math.sin(t * Math.PI + phase) * 0.05 * vie; b.rotation.z = Math.sin(t * Math.PI + phase) * 0.03 * vie; } // 0,5 Hz, 0,05 unité
    if (couches.trafic.visible) for (const c of trafic) {
      c.t = (c.t + c.vitesse * pas * 4) % 1;
      c.v.position.lerpVectors(c.a, c.b, c.t);
      c.v.rotation.y = Math.atan2(c.b.x - c.a.x, c.b.z - c.a.z) - Math.PI / 2;
    }
    // mouettes : seulement quand la caméra passe tout près, donc toujours en pleine vie
    for (const m of mouettes) {
      const proche = camera.position.distanceTo(m.depart) < 22;
      if (proche && m.vol === 0) m.vol = 0.001;
      if (m.vol > 0) {
        m.vol += dt;
        m.g.position.set(m.depart.x + m.vol * 6, m.depart.y + m.vol * 4, m.depart.z + m.vol * 3);
        m.battement.value = Math.sin(m.vol * 18) * 0.6;
        if (m.vol > 6) { m.vol = proche ? 6 : 0; if (!proche) { m.g.position.copy(m.depart); m.battement.value = 0; } }
      }
    }
    // ombres rafraîchies par moments pour les véhicules et les bateaux : inutile quand plus rien ne bouge
    if (vie > 0.05 && Math.floor(t * 20) % 3 === 0) renderer.shadowMap.needsUpdate = true;
  }
  function descendre() {
    const q = palierInferieur(qualite);
    if (q === qualite) return;
    qualite = q;
    const avant = PROFIL;
    PROFIL = { ...profil(q, { telephone: estTelephone }), materiauPbr: avant.materiauPbr }; // les matériaux restent : seuls l'occlusion, les ombres et la densité baissent
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, PROFIL.densiteMax));
    if (!PROFIL.gtao && composer) { composer.dispose?.(); composer = null; gtao = null; }
    if (!PROFIL.ombres) { renderer.shadowMap.enabled = false; soleil.castShadow = false; }
    else if (PROFIL.ombres < avant.ombres) { soleil.shadow.mapSize.set(PROFIL.ombres, PROFIL.ombres); soleil.shadow.map?.dispose(); soleil.shadow.map = null; }
    accessoires.visible = PROFIL.accessoires;
    uLot.uMasque.value[MASQUE.accessoires] = accessoires.visible ? 1 : 0;
    majDetails(true);
    veille = surveillance({ budgetMs: PROFIL.budget.msParImage, debut: performance.now() + 1e9 });
    taille();
  }
  /** Quadrilatère de la vue au sol (mini-carte) : intersections des coins de l'écran avec le plan y = 0. */
  const plan = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function cadreVue() {
    const res = [];
    for (const [x, y] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) {
      raycaster.setFromCamera(souris.set(x, y), camera);
      const p = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plan, p)) res.push([Math.max(x0, Math.min(x1, p.x)), Math.max(z0, Math.min(z1, p.z))]);
      else { const loin = raycaster.ray.at(400, new THREE.Vector3()); res.push([Math.max(x0, Math.min(x1, loin.x)), Math.max(z0, Math.min(z1, loin.z))]); }
    }
    return res;
  }

  // ---------------------------------------------------------------- image instantanée (§5.10) : rangée sur l'appareil
  let capturerApres = false;
  const CACHE_IMAGE = 'lb-carte-instantanee';
  function capturer() {
    try {
      if (typeof caches === 'undefined') return;
      const w = Math.max(1, Math.round(canvas.width / 2));
      const h = Math.max(1, Math.round(canvas.height / 2));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(canvas, 0, 0, w, h); // copie synchrone, juste après le rendu
      const ranger = (blob) => { if (blob) caches.open(CACHE_IMAGE).then((k) => k.put('/carte-instantanee', new Response(blob, { headers: { 'Content-Type': blob.type } }))).catch(() => {}); };
      c.toBlob((b) => (b && b.type === 'image/webp' ? ranger(b) : c.toBlob(ranger, 'image/png')), 'image/webp', 0.7);
    } catch { /* stockage indisponible : rien à faire */ }
  }
  const capturerMaintenant = () => { if (premiere) return; capturerApres = true; renderer.render(scene, camera); capturerApres = false; capturer(); };
  const minuteurImage = setInterval(() => { if (visible && !document.hidden && performance.now() - derniereInteraction < 600000) capturerMaintenant(); }, 600000);
  const ioCapture = new IntersectionObserver((e) => { if (!e.some((x) => x.isIntersecting)) capturerMaintenant(); });
  ioCapture.observe(conteneur);
  // fermeture de l'onglet ou passage en arrière-plan : dernière image rangée (à la fermeture de la carte, §5.10)
  const surDepart = () => capturerMaintenant();
  window.addEventListener('pagehide', surDepart);

  // « Ouverture du matin » (§4.27) : la caméra part du phare et descend sur le port pendant que l'aube passe à l'heure réelle
  if (options.ouverture && !mouvementReduit()) {
    const p = versPosition(new THREE.Vector3(0, 0, zCote + 17), 120, 1.15, Math.PI);
    controles.setLookAt(p.x, p.y, p.z, 0, 0, zCote, false);
    const fin = etatHeure(new Date(), { reglage: reglageHeure, themeSombre: themeSombre() });
    const debut = etatHeure(new Date(new Date().setHours(6, 30, 0, 0)), { reglage: reglageHeure === 'reelle' ? 'reelle' : reglageHeure, themeSombre: themeSombre() });
    const duree = Number.parseFloat(lireJeton('--bz-d-ouverture')) || 1600;
    const t0 = performance.now();
    const lissage = controles.smoothTime;
    controles.smoothTime = duree / 4000;
    setTimeout(() => { const q = versPosition(VUE.cible, distanceInitiale(), VUE.polaire, VUE.azimut); controles.setLookAt(q.x, q.y, q.z, VUE.cible.x, VUE.cible.y, VUE.cible.z, true); reveiller(); }, 60);
    const interrompre = () => { controles.smoothTime = lissage; appliquerHeure(); };
    controles.addEventListener('controlstart', interrompre);
    const pas = () => {
      const k = Math.min(1, (performance.now() - t0) / duree);
      if (reglageHeure === 'reelle') appliquerHeure({ ...fin, nuit: debut.nuit + (fin.nuit - debut.nuit) * k, soleilBas: debut.soleilBas * (1 - k) + fin.soleilBas * k, elevation: debut.elevation + (fin.elevation - debut.elevation) * k, azimut: debut.azimut + (fin.azimut - debut.azimut) * k });
      if (k < 1) requestAnimationFrame(pas); else { controles.smoothTime = lissage; controles.removeEventListener('controlstart', interrompre); }
    };
    requestAnimationFrame(pas);
  }
  appliquerHeure();
  // le thème de l'interface change : relire l'heure (« Suivre le thème ») et le fond des étiquettes
  const obsTheme = new MutationObserver(() => { reglerLissage(); appliquerHeure(); etiquettesASituer = true; });
  obsTheme.observe(racineDoc, { attributes: true, attributeFilter: ['data-theme', 'data-mouvement'] });
  demander();

  /** Mémoire des textures (§5.10), estimée : images des matériaux (mipmaps compris) et carte d'ombre, en Mo. */
  function memoireTextures() {
    const vues = new Set();
    let octets = 0;
    scene.traverse((o) => {
      for (const m of [o.material].flat()) {
        const t = m?.map;
        const img = t?.source?.data;
        if (!img || vues.has(t.source)) continue;
        vues.add(t.source);
        octets += (img.width ?? 0) * (img.height ?? 0) * 4 * (t.generateMipmaps === false ? 1 : 4 / 3);
      }
    });
    if (renderer.shadowMap.enabled) octets += soleil.shadow.mapSize.x * soleil.shadow.mapSize.y * 4;
    octets += LARGEUR_ETATS * HAUTEUR_ETATS * 4;
    return Math.round(octets / 1e5) / 10;
  }
  const api = {
    maj,
    selectionner,
    recentrer,
    zoomer,
    entrer,
    sortir: () => { if (!sortir()) recentrer(); },
    estDedans: () => dedans,
    calques(etat) { Object.assign(etatCalques, etat); appliquerCalques(); },
    etatCalques: () => ({ ...etatCalques }),
    pause(v) { enPause = v ?? !enPause; reveiller(); return enPause; },
    enPause: () => enPause || !ambianceActive(),
    /** Réglages › Carte : animations ambiantes, heure de la carte. */
    /** Le HUD a changé (panneau replié, feuille déplacée) : recalcule le centre de la vue. */
    recadrer: () => taille(),
    regler({ animations: a, heure } = {}) { if (typeof a === 'boolean') animations = a; if (heure) reglageHeure = heure; appliquerHeure(); reveiller(); },
    qualite: () => qualite,
    vueDessus() {
      const dessus = controles.polarAngle < 0.15;
      controles.rotatePolarTo(dessus ? VUE.polaire : 0.03, dureeVol() > 0);
      reveiller();
      return !dessus;
    },
    tourner45,
    /** Boussole : remet le nord en haut. */
    nord() { controles.rotateAzimuthTo(0, dureeVol() > 0); reveiller(); },
    /** Mini-carte : aller à un point du plan, sans changer la distance. */
    allerA(x, z) { volerVers(new THREE.Vector3(x, 0, z), controles.distance, controles.polarAngle); },
    plan: () => ({ plateau: { ...PLATEAU }, zones: Object.fromEntries(Object.entries(ZONES).map(([k, z]) => [k, { ...z }])), centre: { ...CENTRE } }),
    cadre: cadreVue,
    /** Surligne les étiquettes d'un objet (survol d'une action d'« Aujourd'hui ») ; null retire le surlignage. */
    surligner(id) {
      for (const p of puces) p.el.toggleAttribute('data-surligne', Boolean(id) && p.el.dataset.objet === id);
    },
    /** Fin de quête (§4.27) : les fanions montent sur le quai et le phare clignote une fois (1 200 ms), jamais en
        mouvement réduit (l'état final, sans animation) ; un niveau gagné pose aussitôt son élément du décor. */
    celebrer({ niveau } = {}) {
      if (typeof niveau === 'number') poserNiveaux(niveau);
      if (mouvementReduit() || !animations) { demander(); return; }
      fete = { debut: performance.now(), duree: Number.parseFloat(lireJeton('--bz-d-celebration')) || 1200, base: lanterne ? lanterne.color.clone() : null };
      reveiller();
    },
    /** Niveau du port affiché (0 : aucun élément, mode Calme). */
    niveauPort(n) { poserNiveaux(n); demander(); },
    /** Panneau Diagnostic (§8.2) : images par seconde, qualité, appels de dessin et triangles de la dernière image. */
    diagnostic: () => ({ qualite, msParImage: Math.round(mesure.msMoyen * 10) / 10, appels: renderer.info.render.calls, triangles: renderer.info.render.triangles, texturesMo: memoireTextures(), etiquettes: puces.length }),
    detruire() {
      capturerMaintenant();
      couperBoucle();
      clearInterval(minuteur);
      clearInterval(minuteurImage);
      obs.disconnect();
      io.disconnect();
      ioCapture.disconnect();
      obsTheme.disconnect();
      document.removeEventListener('visibilitychange', surVisibilite);
      window.removeEventListener('pagehide', surDepart);
      document.removeEventListener('keydown', arreterVol, true);
      controles.dispose();
      composer?.dispose?.();
      renderer.dispose();
      canvas.remove();
      couchePuces.remove();
      conteneur.classList.remove('bz-scene-cadre');
      conteneur.removeAttribute('data-focus-clavier');
    },
  };
  if (/[?&]diagnostic\b/.test(location.search)) window.__carte = { api, camera, controles, renderer, scene, etats: { donnees: donneesEtats, texture: texEtats, numeros: () => numeros } }; // outils de développement seulement
  return api;
}
