# Licences et crédits

Living Business est un logiciel libre, édité par Breizhcosystem et distribué sous la licence GNU AGPL version 3 :
texte officiel dans [`LICENSE`](LICENSE) (en anglais, seul à faire foi), notice en français dans
[`NOTICE.md`](NOTICE.md). Les deux sont joints à chaque paquet et affichés dans le jeu (`/licences/agpl-3.0.txt` et
`/licence.html`).
Living Business embarque les composants libres suivants, sans modification sauf mention contraire. Chacun garde sa
propre licence, qui s'applique à lui seul : la licence de Living Business ne retire aucun des droits qu'elle donne.
Les textes complets des licences sont dans le dossier `web/licences/` (servis sous `/licences/`), et la page
`web/licences.html` (« Licences et crédits ») reprend ce contenu dans l'application.

## Compatibilité avec la licence GNU AGPL version 3

Vérifié le 12 novembre 2026 sur les textes des licences (dossier `web/licences/`, fichiers `LICENSE` des paquets npm
installés, licence de Node.js 24.22.2) : **aucun composant embarqué n'empêche de distribuer Living Business sous la
licence GNU AGPL version 3**. Cette vérification ne remplace pas l'avis d'un juriste. À refaire quand un composant
est ajouté, ou quand la version de Node.js embarquée (indiquée dans le `LISEZMOI.txt` de chaque paquet) intègre un
nouveau composant.

| Composant | Licence | Pourquoi rien ne s'y oppose |
|---|---|---|
| three.js et ses modules complémentaires servis (contrôles, chargeurs, post-traitement, shaders…), camera-controls, uPlot, uFuzzy, @github/combobox-nav | MIT ; dans three.js, `EXRLoader.js` reprend du code sous licence BSD à 3 clauses (TinyEXR, OpenEXR) | Licences permissives : ce code peut entrer dans un logiciel sous AGPL, à condition de garder les mentions de droit d'auteur. Elles sont gardées : textes dans `web/licences/`, et fichier `LICENSE` de chaque paquet dans `app/node_modules/`. |
| Lucide (icônes) | ISC ; MIT pour les icônes venues de Feather | Même raison. Texte : `web/licences/lucide-ISC-MIT.txt`. |
| Modèles 3D KayKit | CC0 1.0 (domaine public) | Aucune condition. |
| Polices Inter, Fraunces, Atkinson Hyperlegible Next | SIL OFL 1.1 | Les polices restent sous OFL (elle interdit de les placer sous une autre licence) : ce sont des œuvres séparées, jointes au logiciel et chargées par lui. L'OFL permet de les distribuer avec tout logiciel, et l'AGPL ne s'étend pas aux œuvres indépendantes réunies avec le programme (article 5, dernier alinéa). Aucune des trois ne déclare de nom de police réservé ; les sous-ensembles gardent les champs de licence dans le fichier. |
| tesseract.js et son cœur WebAssembly tesseract.js-core (lecture d'un justificatif photographié) | Apache 2.0 | Licence permissive, compatible avec la version 3 des licences GNU (c'est la version 3 qui permet cette combinaison ; la version 2 ne l'aurait pas permise). Ses conditions sont tenues : mentions de droit d'auteur gardées, texte complet dans `web/licences/tesseract-Apache-2.0.txt`, fichier `LICENSE` de chaque paquet dans `app/node_modules/`. Vérifié aussi : ni télémétrie, ni appel vers un tiers — les trois chemins (fil de travail, cœur, modèle) sont imposés par `web/lecture-moteur.js` et servis par Living Business. |
| Modèle de lecture français `fra.traineddata` | Apache 2.0 | Même raison. Fichier de données, joint au dépôt et non modifié ; source et empreinte plus bas. |
| Node.js (paquets téléchargeables seulement) | MIT ; composants intégrés sous MIT, BSD, ISC, Apache 2.0 (OpenSSL, simdjson…), licence Unicode (ICU), zlib, Blue Oak 1.0.0 (minimatch), domaine public | Programme séparé : binaire officiel, non modifié, joint au paquet pour lancer le jeu (même article 5). Toutes ces licences sont permissives ; Apache 2.0 est compatible avec la version 3 des licences GNU. Texte complet joint : `app/LICENCE-NODE.txt`. |

Rien n'est sous une licence qui interdirait la redistribution, l'usage commercial ou la modification. Les outils de
développement (plus bas) ne sont pas distribués avec le jeu.

**Code source des composants.** Deux bibliothèques sont servies sous forme réduite (« minifiée ») : camera-controls
(`dist/camera-controls.module.min.js`) et uPlot (`dist/uPlot.iife.min.js`, `dist/uPlot.min.css`). Leur forme lisible
est publiée par leurs auteurs, à la version exacte inscrite dans `package-lock.json` : dans le même paquet npm
(`dist/camera-controls.module.js`, `dist/uPlot.iife.js`) et dans le dépôt de chaque projet
(https://github.com/yomotsu/camera-controls, https://github.com/leeoniya/uPlot). Les polices en sous-ensemble se
refont depuis leurs sources avec `scripts/polices.py`, et le fichier d'icônes avec `scripts/sprite.ts`.

## Polices

- **Inter** 4.1 (fichier de police 4.001) — Copyright (c) 2016 The Inter Project Authors (https://github.com/rsms/inter).
  SIL Open Font License 1.1 (`web/licences/inter-OFL.txt`). Source : `InterVariable.ttf` de
  https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip (SHA-256 de l'archive
  `9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e`). Sous-ensemble (caractères français) réalisé
  par Breizhcosystem avec `scripts/polices.py` ; variantes cv05 et cv08 figées. Fichier : `web/polices/inter-fr-4.1.woff2`.
- **Fraunces** (fichier de police 1.000) — Copyright 2018 The Fraunces Project Authors (https://github.com/undercasetype/Fraunces).
  SIL Open Font License 1.1, sans nom de police réservé (`web/licences/fraunces-OFL.txt`). Source :
  `ofl/fraunces/Fraunces[SOFT,WONK,opsz,wght].ttf` de https://github.com/google/fonts au commit
  `4024282d9b0cffcdb8e3024560862746178d741f`. Instance figée (SOFT 50, WONK 0, opsz 36, graisses 500 à 650) et
  sous-ensemble réalisés par Breizhcosystem. Fichier : `web/polices/fraunces-fr-titre.woff2`.
- **Atkinson Hyperlegible Next** 2.001 — Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors
  (https://github.com/googlefonts/atkinson-hyperlegible-next). SIL Open Font License 1.1 (`web/licences/atkinson-OFL.txt`).
  Copié tel quel depuis le paquet `@fontsource-variable/atkinson-hyperlegible-next` 5.3.0
  (`files/atkinson-hyperlegible-next-latin-wght-normal.woff2`). Fichier : `web/polices/atkinson-next-2.001.woff2`.

## Icônes

- **Lucide** 1.71.0 — Copyright (c) 2026 Lucide Icons and Contributors. Licence ISC.
  Les icônes dérivées du projet Feather sont Copyright (c) 2013-present Cole Bemis, licence MIT
  (`web/licences/lucide-ISC-MIT.txt`). Sélection d'icônes réunie en un seul fichier (`web/bz/icones.svg`) par
  Breizhcosystem avec `scripts/sprite.ts`, depuis le paquet `lucide-static` 1.71.0.

## Bibliothèques

Servies par la passerelle depuis `node_modules`, sous un chemin qui porte leur version exacte.

- **three.js** 0.186.0 — Copyright © 2010-2026 three.js authors. Licence MIT (`web/licences/three-MIT.txt`).
- **camera-controls** 3.1.2 — Copyright (c) 2017 @yomotsu. Licence MIT (`web/licences/camera-controls-MIT.txt`).
- **uPlot** 1.6.32 — Copyright (c) 2022 Leon Sorokin. Licence MIT (`web/licences/uplot-MIT.txt`).
- **uFuzzy** 1.0.19 — Copyright (c) 2022 Leon Sorokin. Licence MIT (`web/licences/ufuzzy-MIT.txt`).
- **@github/combobox-nav** 3.0.2 — Copyright (c) 2018 GitHub. Licence MIT (`web/licences/combobox-nav-MIT.txt`).
- **tesseract.js** 7.0.0 et **tesseract.js-core** 7.0.0 — Copyright Tesseract.js contributors ; moteur Tesseract OCR
  Copyright Google Inc. et contributeurs. Licence Apache 2.0 (`web/licences/tesseract-Apache-2.0.txt`). Servis sous
  `/lecture/7.0.0/`, et seulement à la première photo d'un justificatif : `dist/tesseract.esm.min.js`,
  `dist/worker.min.js`, et UN cœur WebAssembly sur les deux (`tesseract-core-simd-lstm` ou `tesseract-core-lstm`,
  selon le processeur). Forme lisible publiée par les auteurs à la même version :
  https://github.com/naptha/tesseract.js et https://github.com/naptha/tesseract.js-core.

## Modèle de lecture

- **`fra.traineddata`** (français, modèle « fast ») — Copyright Google Inc. et contributeurs du projet Tesseract OCR.
  Licence Apache 2.0 (`web/licences/tesseract-Apache-2.0.txt`). Copié tel quel depuis
  https://github.com/tesseract-ocr/tessdata_fast au tag `4.1.0`, fichier `fra.traineddata` (SHA-256
  `ced037562e8c80c13122dece28dd477d399af80911a28791a66a63ac1e3445ca`), puis compressé par Breizhcosystem avec `gzip -9`
  pour n'être téléchargé qu'une fois. Fichier : `web/lecture/fra.traineddata.gz`, SHA-256
  `ecbd3e2600928fbbf730797fe9a33bdd554e9deb79978050d6c6ef4c670b93d9`. Le contenu décompressé est l'original, octet
  pour octet.

## Environnement d'exécution (paquets téléchargeables)

- **Node.js** (version indiquée dans le `LISEZMOI.txt` de chaque paquet) — Copyright Node.js contributors ; parties
  issues du dépôt joyent/node : Copyright Joyent, Inc. and other Node contributors. Licence MIT. Binaire `node`
  officiel de https://nodejs.org, tel quel (empreinte vérifiée contre `SHASUMS256.txt` signé, voir `scripts/paquets.ts`).
  Le texte complet de sa licence et de celles des composants qu'il intègre (dont OpenSSL, ICU et V8) est joint au
  paquet : `app/LICENCE-NODE.txt`. Hors paquet (`npm start`), le jeu utilise le Node.js installé sur la machine.

## Modèles 3D

- **KayKit : City Builder Bits** 1.0 et **KayKit : Furniture Bits** 1.0 — créés et distribués par
  Kay Lousberg (www.kaylousberg.com). Domaine public (CC0 1.0, `web/licences/kaykit-CC0.txt`). Matériaux adaptés par
  Breizhcosystem.

## Données géographiques

La carte du jeu se dézoome sur la Bretagne, puis sur la France : ces deux échelles sont dessinées avec le découpage
administratif français, publié en données ouvertes.

- **ADMIN EXPRESS COG** (édition 2018) — Institut national de l'information géographique et forestière (IGN).
  **Licence Ouverte / Open Licence** (Etalab, https://www.etalab.gouv.fr/licence-ouverte-open-licence), qui demande la
  seule mention de la paternité : c'est l'objet de cette section. Contours des 13 régions et des 96 départements de
  métropole, simplifiés et quantifiés pour le jeu (`web/carte/contours.js`). La conversion des fichiers de l'IGN au
  format GeoJSON est celle du dépôt public `france-geojson` de Grégoire David
  (https://github.com/gregoiredavid/france-geojson), lui-même publié sous Licence Ouverte.
- **Découpage administratif (communes, départements, régions)** — API geo.api.gouv.fr (Etalab), d'après le Code
  officiel géographique de l'INSEE et ADMIN EXPRESS de l'IGN. **Licence Ouverte / Open Licence.** Point de chaque code
  postal français : le centre de la commune qui le porte (`web/carte/communes.js`).

Ces licences sont permissives et n'imposent que l'attribution : rien ne s'oppose à la distribution sous GNU AGPL
version 3. Les deux fichiers sont **fabriqués**, jamais modifiés à la main — `node scripts/carte-contours.mjs
<dossier-des-sources>` les régénère, et leur en-tête rappelle la source, la licence et les réglages de simplification.
Rien d'autre n'est embarqué : aucun fond de carte en image, aucun appel à un service de cartographie, aucune donnée de
l'entreprise envoyée à qui que ce soit — les codes postaux des fiches sont résolus sur l'appareil, hors ligne.

**Ce que cela pèse** : 48,5 kio pour les contours et 34,2 kio pour les codes postaux, soit **82,6 kio** — environ
1,6 % de ce qui est envoyé au navigateur. La passerelle ne compresse pas : le poids sur disque est le poids
téléchargé. Les tracés de toutes les communes de France pèseraient des dizaines de mégaoctets ; on s'en tient aux
régions et aux départements, et un code postal n'est qu'un point. `src/ds/carte-echelles.test.ts` tient le plafond
de 100 kio : il ne se dépassera pas sans que quelqu'un l'ait décidé.

## Outils de développement (jamais envoyés au navigateur)

- **fontTools** 4.60.1 et **Brotli** 1.1.0 (MIT) : sous-ensembles de polices (`scripts/polices.py`).
- **lucide-static** 1.71.0 (ISC + MIT) : source du sprite d'icônes.
- **TypeScript** 7.0.2 (Apache-2.0) et **@types/node** (MIT) : vérification des types.

## Marque

Les noms « Breizhcosystem » et « Living Business » et le symbole « Moucheture » restent des marques de l'éditeur :
la licence de Living Business ne donne aucun droit sur elles (terme additionnel, permis par son article 7, point e :
voir [`NOTICE.md`](NOTICE.md), § 4).

Les illustrations et les icônes maison (`bz-moucheture`, `bz-nexus`, `bz-phare-allume`) sont l'œuvre de l'éditeur :
elles font partie de Living Business et suivent sa licence. Les licences des composants ci-dessus ne s'appliquent
pas à elles.
