/**
 * Icône de l'application Mac (Living Business.app) : la Moucheture de scripts/icones.ts, dessinée en PNG de 1024 px
 * (gabarit macOS : conteneur à 824/1024), réduite aux tailles d'un jeu d'icônes par `sips`, puis assemblée par
 * `iconutil`. À relancer sur un Mac quand le symbole change :
 *
 *   node scripts/icone-mac.ts   → paquets/mac/living-business.icns
 *
 * Le .icns est enregistré dans le dépôt : la fabrication des paquets ne fait que le copier.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pixelsIconeMac, png } from './icones.ts';

/** Fichiers d'un jeu d'icônes macOS (.iconset) et leur côté en pixels. */
export const JEU_ICONES: readonly { nom: string; cote: number }[] = [16, 32, 128, 256, 512].flatMap((c) => [
  { nom: `icon_${c}x${c}.png`, cote: c },
  { nom: `icon_${c}x${c}@2x.png`, cote: c * 2 },
]);

export const ICONE_MAC = fileURLToPath(new URL('../paquets/mac/living-business.icns', import.meta.url));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.platform !== 'darwin') throw new Error('À lancer sur un Mac (sips et iconutil).');
  const travail = mkdtempSync(join(tmpdir(), 'lb-icone-mac-'));
  try {
    const grande = join(travail, 'icone-1024.png');
    writeFileSync(grande, png(1024, 1024, pixelsIconeMac(1024)));
    const jeu = join(travail, 'living-business.iconset');
    execFileSync('mkdir', [jeu]);
    for (const { nom, cote } of JEU_ICONES) {
      execFileSync('sips', ['-z', String(cote), String(cote), grande, '--out', join(jeu, nom)], { stdio: 'ignore' });
    }
    execFileSync('iconutil', ['-c', 'icns', '-o', ICONE_MAC, jeu]);
    console.log(`${ICONE_MAC} (${JEU_ICONES.length} images, de 16 à 1024 px)`);
  } finally {
    rmSync(travail, { recursive: true, force: true });
  }
}
