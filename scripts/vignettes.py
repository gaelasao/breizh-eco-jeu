"""Illustrations tirées de la maquette (direction de design §2.5) — outil de développement.

    python3 -I scripts/vignettes.py

Lit design/vignettes/<nom>-capture.webp|png (reçus par scripts/vignettes.ts), recadre sur le port (phare, quai,
bateau, premières maisons), réduit à 960 × 600 (2× d'un affichage de 480 × 300) et écrit :
  web/illustrations/<nom>.avif  (20 Ko au plus, budget du §8.2)
  web/illustrations/<nom>.webp  (repli des navigateurs sans AVIF)
Dépendance : Pillow ≥ 11.3 avec le module AVIF (libavif), outil de développement uniquement (jamais envoyé au navigateur).
"""
from pathlib import Path
import sys

from PIL import Image

RACINE = Path(__file__).resolve().parent.parent
SOURCES = RACINE / "design" / "vignettes"
SORTIE = RACINE / "web" / "illustrations"
TAILLE = (960, 600)
BUDGET_AVIF = 20_000
# cadrage relatif (gauche, haut, droite, bas) dans la capture : le port, sans la zone couverte par le panneau
CADRAGE = {"port-aube": (0.21, 0.10, 0.88, 0.95), "port-nuit": (0.21, 0.10, 0.88, 0.95)}


def recadrer(im: Image.Image, cadre: tuple) -> Image.Image:
    l, h = im.size
    g, t, d, b = cadre
    boite = [g * l, t * h, d * l, b * h]
    # même rapport que la sortie (16:10), centré dans la boîte demandée
    largeur, hauteur = boite[2] - boite[0], boite[3] - boite[1]
    voulu = TAILLE[0] / TAILLE[1]
    if largeur / hauteur > voulu:
        nouvelle = hauteur * voulu
        boite[0] += (largeur - nouvelle) / 2
        boite[2] = boite[0] + nouvelle
    else:
        nouvelle = largeur / voulu
        boite[1] += (hauteur - nouvelle) / 2
        boite[3] = boite[1] + nouvelle
    return im.crop(tuple(round(x) for x in boite)).resize(TAILLE, Image.LANCZOS)


def principal() -> int:
    SORTIE.mkdir(parents=True, exist_ok=True)
    trouves = 0
    for nom, cadre in CADRAGE.items():
        source = next((p for p in (SOURCES / f"{nom}-capture.webp", SOURCES / f"{nom}-capture.png") if p.exists()), None)
        if not source:
            print(f"{nom} : capture absente ({SOURCES}), lancez scripts/vignettes.ts", file=sys.stderr)
            continue
        im = recadrer(Image.open(source).convert("RGB"), cadre)
        avif = SORTIE / f"{nom}.avif"
        for qualite in (55, 48, 42, 36, 30):
            im.save(avif, "AVIF", quality=qualite, speed=4)
            if avif.stat().st_size <= BUDGET_AVIF:
                break
        webp = SORTIE / f"{nom}.webp"
        im.save(webp, "WEBP", quality=58, method=6)
        print(f"{nom} : {avif.stat().st_size} octets (AVIF), {webp.stat().st_size} octets (WebP)")
        if avif.stat().st_size > BUDGET_AVIF:
            print(f"{nom} : dépasse le budget de {BUDGET_AVIF} octets", file=sys.stderr)
            return 1
        trouves += 1
    return 0 if trouves else 1


if __name__ == "__main__":
    sys.exit(principal())
