#!/usr/bin/env python3
"""Polices de Breizhcosystem : sous-ensembles français d'Inter 4.1 et de Fraunces (direction de design §7.1).

Outil de développement (jamais exécuté par le jeu). Dépendances : fontTools 4.x et brotli (MIT), dans un venv :

    python3 -m venv /tmp/venv-polices && /tmp/venv-polices/bin/pip install fonttools==4.60.1 brotli==1.1.0
    /tmp/venv-polices/bin/python -I scripts/polices.py \\
        --inter chemin/InterVariable.ttf \\
        --fraunces "chemin/Fraunces[SOFT,WONK,opsz,wght].ttf" \\
        --atkinson chemin/atkinson-hyperlegible-next-latin-wght-normal.woff2

Sources exactes (empreintes relevées au moment de la copie, voir web/polices/*.json et LICENCES-TIERS.md) :
  - Inter 4.1 : https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip (InterVariable.ttf, LICENSE.txt)
  - Fraunces : https://github.com/google/fonts, ofl/fraunces/Fraunces[SOFT,WONK,opsz,wght].ttf au commit épinglé
  - Atkinson Hyperlegible Next 2.001 : paquet @fontsource-variable/atkinson-hyperlegible-next 5.3.0 (copié tel quel)

Inter : les variantes cv05 (l à queue) et cv08 (I à empattements) sont figées dans la table cmap (elles distinguent
I, l et 1 dans les SIRET et les références partout, même sous une règle CSS `font:` qui remet les réglages à zéro).

Écrit dans web/polices/ : inter-fr-4.1.woff2, inter-fr-4.1.json, fraunces-fr-titre.woff2, fraunces-fr-titre.json,
atkinson-next-2.001.woff2. Échoue si un caractère indispensable manque à Inter ; le signale sans échouer pour Fraunces
(la pile --bz-police-titre le prend alors dans Inter).
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import shutil
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

RACINE = Path(__file__).resolve().parent.parent
SORTIE = RACINE / "web" / "polices"

# Même liste que la commande du §7.1 (latin de base, Latin-1, œ Œ Ÿ, ponctuation française, flèches, ⌘ ⌥ ⇧, ▲ ▼)
UNICODES = (
    "U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+0178,U+02BC,U+02C6,U+02DA,U+02DC,U+2009,U+2010-2014,"
    "U+2018-201E,U+2020-2022,U+2026,U+202F,U+2030,U+2039-203A,U+20AC,U+2122,U+2190-2193,U+21E7,U+2212,"
    "U+2248,U+2264-2265,U+2303,U+2318,U+2325,U+25B2,U+25BC"
)
FONCTIONS_INTER = "kern,liga,calt,ccmp,locl,mark,mkmk,case,tnum,pnum,lnum,zero,frac,numr,dnom,sups,ordn,cv05,cv08"
FONCTIONS_FRAUNCES = "kern,liga,calt,ccmp,locl,mark,mkmk,case,lnum,pnum"

# Caractères vérifiés (§7.1 et §8.3) : espaces fines et insécables, guillemets, apostrophe, points de suspension, œ Œ Ÿ, €, ⌘
INDISPENSABLES = [0x202F, 0x00A0, 0x2009, 0x00AB, 0x00BB, 0x2019, 0x2026, 0x0153, 0x0152, 0x0178, 0x20AC, 0x2318]


def plages(spec: str) -> list[int]:
    points: list[int] = []
    for morceau in spec.split(","):
        morceau = morceau.strip().removeprefix("U+")
        if "-" in morceau:
            a, b = morceau.split("-")
            points.extend(range(int(a, 16), int(b, 16) + 1))
        else:
            points.append(int(morceau, 16))
    return points


def figer(police: TTFont, fonctions: tuple[str, ...]) -> int:
    """Fige des variantes (cv05 : l à queue ; cv08 : I à empattements) dans la table cmap : elles s'appliquent partout,
    même là où une règle CSS `font:` remet font-feature-settings à sa valeur initiale. Retourne le nombre de glyphes changés."""
    gsub = police["GSUB"].table
    remplacement: dict[str, str] = {}
    for fr in gsub.FeatureList.FeatureRecord:
        if fr.FeatureTag not in fonctions:
            continue
        for li in fr.Feature.LookupListIndex:
            lk = gsub.LookupList.Lookup[li]
            for st in lk.SubTable:
                genre = lk.LookupType
                if genre == 7:
                    genre, st = st.ExtensionLookupType, st.ExtSubTable
                if genre == 1:
                    remplacement.update(st.mapping)
    n = 0
    for table in police["cmap"].tables:
        if table.isUnicode():
            for cp, glyphe in list(table.cmap.items()):
                if glyphe in remplacement:
                    table.cmap[cp] = remplacement[glyphe]
                    n += 1
    return n


def sous_ensemble(police: TTFont, fonctions: str) -> bytes:
    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = fonctions.split(",")
    options.hinting = False
    options.desubroutinize = True
    options.name_IDs = ["*"]  # garde les champs de licence (exigence de l'OFL)
    options.name_languages = ["*"]
    options.notdef_outline = True
    s = subset.Subsetter(options=options)
    s.populate(unicodes=plages(UNICODES))
    s.subset(police)
    tampon = io.BytesIO()
    police.flavor = "woff2"
    police.save(tampon)
    return tampon.getvalue()


def decrire(nom: str, contenu: bytes, source: Path, version: str) -> dict:
    police = TTFont(io.BytesIO(contenu))
    cmap = sorted(police.getBestCmap().keys())
    axes = {a.axisTag: [a.minValue, a.maxValue] for a in police["fvar"].axes} if "fvar" in police else {}
    return {
        "fichier": nom,
        "version": version,
        "source": source.name,
        "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "sha256": hashlib.sha256(contenu).hexdigest(),
        "octets": len(contenu),
        "axes": axes,
        "pointsDeCode": [f"U+{c:04X}" for c in cmap],
        "absents": [f"U+{c:04X}" for c in INDISPENSABLES if c not in cmap],
    }


def version_de(police: TTFont) -> str:
    return str(police["name"].getDebugName(5) or "").strip()


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--inter", type=Path, required=True)
    p.add_argument("--fraunces", type=Path, required=True)
    p.add_argument("--atkinson", type=Path, required=True)
    a = p.parse_args()
    SORTIE.mkdir(parents=True, exist_ok=True)

    # Inter 4.1 : variable (wght 100-900, opsz 14-32), sous-ensemble français
    inter = TTFont(a.inter)
    v_inter = version_de(inter)
    figes = figer(inter, ("cv05", "cv08"))
    contenu = sous_ensemble(inter, FONCTIONS_INTER)
    (SORTIE / "inter-fr-4.1.woff2").write_bytes(contenu)
    d = decrire("inter-fr-4.1.woff2", contenu, a.inter, v_inter)
    if d["absents"]:
        print(f"Inter : caractères absents {d['absents']}", file=sys.stderr)
        return 1
    (SORTIE / "inter-fr-4.1.json").write_text(json.dumps(d, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"inter-fr-4.1.woff2 : {len(contenu)} octets, {len(d['pointsDeCode'])} caractères, version « {v_inter} », cv05 et cv08 figés ({figes} correspondances)")

    # Fraunces : instance figée SOFT=50 WONK=0 opsz=36, graisses 500 à 650, puis même sous-ensemble
    fraunces = TTFont(a.fraunces)
    v_fraunces = version_de(fraunces)
    figee = instancer.instantiateVariableFont(fraunces, {"SOFT": 50, "WONK": 0, "opsz": 36, "wght": (500, 650)})
    contenu = sous_ensemble(figee, FONCTIONS_FRAUNCES)
    (SORTIE / "fraunces-fr-titre.woff2").write_bytes(contenu)
    d = decrire("fraunces-fr-titre.woff2", contenu, a.fraunces, v_fraunces)
    (SORTIE / "fraunces-fr-titre.json").write_text(json.dumps(d, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"fraunces-fr-titre.woff2 : {len(contenu)} octets, version « {v_fraunces} »")
    if d["absents"]:
        print(f"Fraunces : caractères absents, pris dans Inter par la pile de polices : {d['absents']}")

    # Atkinson Hyperlegible Next 2.001 : copiée telle quelle (option « Police haute lisibilité », chargée à la demande)
    shutil.copyfile(a.atkinson, SORTIE / "atkinson-next-2.001.woff2")
    print(f"atkinson-next-2.001.woff2 : {a.atkinson.stat().st_size} octets (copie, sha256 {hashlib.sha256(a.atkinson.read_bytes()).hexdigest()})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
