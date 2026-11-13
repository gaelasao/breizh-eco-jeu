/**
 * Blocs de deploiement/installer-jeu.sh exécutés pour de vrai (bash), avec des dossiers temporaires et des commandes
 * système remplacées (systemctl, chown…) : rien n'est installé sur la machine qui lance les tests.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lireCles } from './openpgp.ts';
import { INSTALLATEUR } from './signer-publication.ts';

const modele = readFileSync(INSTALLATEUR, 'utf8');
const bashPresent = spawnSync('bash', ['-c', 'true']).status === 0;

/** Bloc « # >>> nom » … « # <<< nom » de l'installateur. */
function bloc(nom: string): string {
  const debut = modele.indexOf(`# >>> ${nom}`);
  const fin = modele.indexOf(`# <<< ${nom}`);
  assert.ok(debut >= 0 && fin > debut, `bloc « ${nom} » introuvable dans installer-jeu.sh`);
  return modele.slice(debut, fin);
}
const bash = (script: string, env: NodeJS.ProcessEnv = {}) => spawnSync('bash', ['-c', script], { encoding: 'utf8', env: { ...process.env, ...env } });

test('copie hors site : effacement des copies distantes de plus de 31 jours, seulement si une copie récente est arrivée', { skip: !bashPresent && 'bash absent' }, () => {
  const d = mkdtempSync(join(tmpdir(), 'lb-copie-'));
  try {
    const conf = join(d, 'conf');
    const unites = join(d, 'unites');
    mkdirSync(conf);
    mkdirSync(unites);
    const prelude = `set -euo pipefail\nCONF='${conf}' DONNEES=/var/lib/living-business UNITES='${unites}' CONSERVATION_HORS_SITE=31\nsystemctl() { :; }\n`;
    // pas de copie configurée : aucun service
    assert.equal(bash(`${prelude}${bloc('copie hors site')}\necrire_copie_hors_site`).status, 0);
    assert.equal(existsSync(join(unites, 'living-business-sauvegarde.service')), false);
    // copie configurée (installation déjà faite, mise à jour) : service réécrit avec la purge
    writeFileSync(join(conf, 'rclone.env'), 'RCLONE_CONFIG_S3_TYPE=s3\n');
    const r = bash(`${prelude}${bloc('copie hors site')}\necrire_copie_hors_site`);
    assert.equal(r.status, 0, r.stderr);
    const service = readFileSync(join(unites, 'living-business-sauvegarde.service'), 'utf8');
    assert.match(service, /^ExecStart=\/usr\/bin\/rclone copy \/var\/lib\/living-business\/sauvegardes chiffre: --max-age 72h$/m);
    const post = /^ExecStartPost=\/bin\/sh -c '(.+)'$/m.exec(service)?.[1];
    assert.ok(post, 'effacement à distance après chaque copie');
    assert.ok(existsSync(join(unites, 'living-business-sauvegarde.timer')));

    // la commande d'effacement, jouée avec un faux rclone : jamais d'effacement sans copie récente
    const faux = join(d, 'rclone');
    const appels = join(d, 'appels');
    writeFileSync(faux, `#!/usr/bin/env bash\necho "$*" >> '${appels}'\nif [[ "$1" == lsf ]]; then cat '${join(d, 'recentes')}' 2>/dev/null; fi\n`);
    chmodSync(faux, 0o755);
    const jouer = () => spawnSync('sh', ['-c', post!.replaceAll('/usr/bin/rclone', faux)], { encoding: 'utf8' });
    jouer();
    assert.doesNotMatch(readFileSync(appels, 'utf8'), /^delete/m, 'aucune copie récente : rien n’est effacé');
    writeFileSync(join(d, 'recentes'), 'monde-2026-11-10.json\n');
    jouer();
    assert.match(readFileSync(appels, 'utf8'), /^delete chiffre: --min-age 31d$/m);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('copie hors site : le service est réécrit à chaque passage, pas seulement à la première configuration', () => {
  const i = modele.indexOf('\necrire_copie_hors_site\n');
  assert.ok(i > 0, 'appel hors de la question posée une seule fois');
  const question = modele.indexOf('if [[ ! -f "$CONF/sauvegarde-externe" && -t 0 ]]; then');
  assert.ok(question > 0 && question < i);
  assert.doesNotMatch(modele.slice(question, i), /living-business-sauvegarde\.service/, 'le service n’est plus écrit dans la partie posée une fois');
});

const zipPresent = spawnSync('zip', ['-v'], { stdio: 'ignore' }).status === 0 && spawnSync('unzip', ['-v'], { stdio: 'ignore' }).status === 0;

test('paquet republié sous le même numéro : le nouveau contenu est installé, « déjà à jour » ensuite, ménage des anciens', { skip: (!bashPresent || !zipPresent) && 'bash, zip ou unzip absent' }, () => {
  const d = mkdtempSync(join(tmpdir(), 'lb-paquet-'));
  try {
    const app = join(d, 'opt');
    /** Paquet factice : living-business-<v>-linux-x64/app/node qui affiche son contenu. */
    const paquet = (version: string, contenu: string, complet = true) => {
      const nom = `living-business-${version}-linux-x64`;
      const src = join(d, `src-${contenu}`);
      mkdirSync(join(src, nom, 'app'), { recursive: true });
      if (complet) { writeFileSync(join(src, nom, 'app', 'node'), `#!/bin/sh\necho ${contenu}\n`); chmodSync(join(src, nom, 'app', 'node'), 0o755); }
      else writeFileSync(join(src, nom, 'app', 'LISEZMOI'), contenu);
      const zip = join(d, `${contenu}.zip`);
      assert.equal(spawnSync('zip', ['-qr', zip, nom], { cwd: src }).status, 0);
      const sha = spawnSync('shasum', ['-a', '256', zip], { encoding: 'utf8' }).stdout.split(' ')[0] || spawnSync('sha256sum', [zip], { encoding: 'utf8' }).stdout.split(' ')[0];
      return { zip, nom: `${nom}.zip`, sha: sha as string };
    };
    const installer = (p: { zip: string; nom: string; sha: string }, version: string) => bash(`set -euo pipefail\nAPP='${app}'\nchown() { :; }\n${bloc('installation du paquet')}\ninstaller_paquet '${p.zip}' '${p.nom}' '${version}' '${p.sha}'`);
    const servi = () => spawnSync(join(app, 'actuel', 'app', 'node'), { encoding: 'utf8' }).stdout.trim();

    // ancienne installation (dossier nommé par la seule version, avant ce correctif)
    const ancien = paquet('0.1.0', 'ANCIEN-CODE-VULNERABLE');
    mkdirSync(join(app, 'versions'), { recursive: true });
    assert.equal(spawnSync('unzip', ['-q', ancien.zip, '-d', join(d, 'x')]).status, 0);
    spawnSync('mv', [join(d, 'x', 'living-business-0.1.0-linux-x64'), join(app, 'versions', '0.1.0')]);
    spawnSync('ln', ['-sfn', join(app, 'versions', '0.1.0'), join(app, 'actuel')]);
    assert.equal(servi(), 'ANCIEN-CODE-VULNERABLE');

    const correctif = paquet('0.1.0', 'CORRECTIF-DE-SECURITE');
    let r = installer(correctif, '0.1.0');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(servi(), 'CORRECTIF-DE-SECURITE', 'même numéro, autre contenu : le correctif est en service');
    assert.match(r.stdout, new RegExp(`Mise à jour appliquée : 0\\.1\\.0 → 0\\.1\\.0-${correctif.sha.slice(0, 16)}\\.`));
    assert.equal(readFileSync(join(app, 'actuel', '.empreinte-paquet'), 'utf8').trim(), correctif.sha);
    r = installer(correctif, '0.1.0');
    assert.match(r.stdout, /^Déjà à jour : Living Business 0\.1\.0/m);
    assert.equal(servi(), 'CORRECTIF-DE-SECURITE');

    // paquet incomplet : refusé, la version en service ne bouge pas
    const casse = paquet('0.1.1', 'CASSE', false);
    assert.notEqual(installer(casse, '0.1.1').status, 0);
    assert.equal(servi(), 'CORRECTIF-DE-SECURITE');

    // version suivante : seules restent la version en service et la précédente
    const suivante = paquet('0.1.1', 'VERSION-SUIVANTE');
    assert.equal(installer(suivante, '0.1.1').status, 0);
    assert.equal(servi(), 'VERSION-SUIVANTE');
    const restants = spawnSync('ls', ['-A', join(app, 'versions')], { encoding: 'utf8' }).stdout.trim().split('\n').sort();
    assert.deepEqual(restants, [`0.1.0-${correctif.sha.slice(0, 16)}`, `0.1.1-${suivante.sha.slice(0, 16)}`]);
    assert.equal(bash(`${bloc('installation du paquet')}\nversion_de_dossier /opt/living-business/versions/0.1.0-abcdef0123456789`).stdout, '0.1.0');
    assert.equal(bash(`${bloc('installation du paquet')}\nversion_de_dossier /opt/living-business/versions/0.1.0`).stdout, '0.1.0');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

const SSHD = '/usr/sbin/sshd';
/** Faux système pour sshd -T (vrai sshd, configuration temporaire) : renvoie les chemins utiles. */
function systemeSsh(d: string) {
  const conf = join(d, 'sshd_config');
  const confD = join(d, 'sshd_config.d');
  const racine = join(d, 'racine');
  mkdirSync(confD, { recursive: true });
  mkdirSync(join(racine, 'home', 'ubuntu', '.ssh'), { recursive: true });
  mkdirSync(join(racine, 'root', '.ssh'), { recursive: true });
  spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', join(d, 'hote')], { stdio: 'ignore' });
  writeFileSync(conf, `Include ${confD}/*.conf\nHostKey ${join(d, 'hote')}\nPidFile ${join(d, 'pid')}\n`);
  // image cloud livrée avec un mot de passe : cloud-init autorise les mots de passe
  writeFileSync(join(confD, '50-cloud-init.conf'), 'PasswordAuthentication yes\n');
  const lancer = () => bash(`set -euo pipefail\nSSHD_CONFIG='${conf}' SSHD_CONF_D='${confD}' RACINE_SSH='${racine}'\nsshd() { '${SSHD}' -f '${conf}' "$@"; }\nsystemctl() { :; }\n${bloc('durcissement SSH')}\ndurcir_ssh`);
  const effectif = () => spawnSync(SSHD, ['-T', '-f', conf], { encoding: 'utf8' }).stdout;
  return { conf, confD, racine, lancer, effectif };
}
const sshdUtilisable = (() => {
  if (!bashPresent || !existsSync(SSHD)) return false;
  const d = mkdtempSync(join(tmpdir(), 'lb-sshd-'));
  try { return systemeSsh(d).effectif().includes('passwordauthentication'); } catch { return false; } finally { rmSync(d, { recursive: true, force: true }); }
})();
const CLE = (n: string) => `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${n.repeat(43).slice(0, 43)} ${n}@poste\n`;

test('SSH : clé ajoutée après coup prise en compte à la relance, 50-cloud-init.conf supplanté, résultat vérifié par sshd -T', { skip: !sshdUtilisable && 'sshd -T indisponible' }, () => {
  const d = mkdtempSync(join(tmpdir(), 'lb-ssh-'));
  try {
    const s = systemeSsh(d);
    assert.match(s.effectif(), /^passwordauthentication yes$/m, 'départ : mots de passe acceptés (cloud-init)');
    // 1re exécution : aucune clé, rien n'est coupé, et on ne prétend pas le contraire
    let r = s.lancer();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Pas de clé SSH trouvée/);
    assert.doesNotMatch(r.stdout, /clé uniquement/);
    // ancienne installation : fichier 50-living-business.conf (lu après cloud-init, donc sans effet)
    writeFileSync(join(s.confD, '50-living-business.conf'), 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n');
    assert.match(s.effectif(), /^passwordauthentication yes$/m, 'preuve du défaut : l’ancien fichier ne l’emporte pas');
    // la personne ajoute sa clé (ssh-copy-id) et relance : durcissement appliqué ET vérifié
    writeFileSync(join(s.racine, 'home', 'ubuntu', '.ssh', 'authorized_keys'), CLE('a'));
    r = s.lancer();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /SSH : connexion par clé uniquement \(vérifié avec sshd -T\)\./);
    assert.match(s.effectif(), /^passwordauthentication no$/m);
    assert.match(s.effectif(), /^kbdinteractiveauthentication no$/m);
    assert.match(s.effectif(), /^permitrootlogin no$/m);
    assert.equal(existsSync(join(s.confD, '50-living-business.conf')), false, 'ancien fichier retiré');
    assert.ok(existsSync(join(s.confD, '00-living-business.conf')));
    // root n'a qu'une clé : il garde la connexion par clé (jamais coupé)
    writeFileSync(join(s.racine, 'root', '.ssh', 'authorized_keys'), CLE('r'));
    assert.equal(s.lancer().status, 0);
    assert.match(s.effectif(), /^permitrootlogin without-password$|^permitrootlogin prohibit-password$/m);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('SSH : un réglage qui l’emporte encore est signalé, jamais « clé uniquement » affiché à tort', { skip: !sshdUtilisable && 'sshd -T indisponible' }, () => {
  const d = mkdtempSync(join(tmpdir(), 'lb-ssh2-'));
  try {
    const s = systemeSsh(d);
    // réglage écrit AVANT l'Include dans le fichier principal : il est lu en premier
    writeFileSync(s.conf, `PasswordAuthentication yes\n${readFileSync(s.conf, 'utf8')}`);
    writeFileSync(join(s.racine, 'home', 'ubuntu', '.ssh', 'authorized_keys'), CLE('b'));
    const r = s.lancer();
    assert.equal(r.status, 1);
    assert.doesNotMatch(r.stdout, /clé uniquement/);
    assert.match(r.stderr, /SSH accepte ENCORE les mots de passe/);
    assert.ok(r.stderr.includes(s.conf), 'le fichier fautif est nommé');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('SSH : durcissement hors de la partie « système » faite une seule fois', () => {
  const pret = modele.indexOf('if [[ ! -f "$CONF/systeme-pret" ]]; then');
  const finPret = modele.indexOf('touch "$CONF/systeme-pret"\nfi\n');
  const appel = modele.indexOf('\ndurcir_ssh || true\n');
  assert.ok(pret > 0 && finPret > pret && appel > finPret, 'appelé à chaque passage, après la partie faite une fois');
  assert.doesNotMatch(modele.slice(pret, finPret), /sshd_config|PasswordAuthentication/);
});

test('mise à jour automatique : minuterie chaque nuit (signature vérifiée), proposée et désactivable, choix gardé', { skip: !bashPresent && 'bash absent' }, () => {
  const d = mkdtempSync(join(tmpdir(), 'lb-maj-'));
  try {
    const conf = join(d, 'conf');
    const unites = join(d, 'unites');
    mkdirSync(conf);
    mkdirSync(unites);
    const appels = join(d, 'systemctl');
    const jouer = (appel: string, env: NodeJS.ProcessEnv = {}) => bash(`set -euo pipefail\nCONF='${conf}' UNITES='${unites}'\nsystemctl() { echo "$*" >> '${appels}'; }\n${bloc('mise à jour automatique')}\n${appel}`, env);
    // sans terminal (Claude, script) et sans avis : oui ; LB_MAJ_AUTO=0 : non
    assert.equal(jouer('choix_mise_a_jour_auto < /dev/null').stdout.trim(), 'oui');
    assert.equal(jouer('choix_mise_a_jour_auto < /dev/null', { LB_MAJ_AUTO: '0' }).stdout.trim(), 'non');
    let r = jouer('regler_mise_a_jour_auto oui');
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(join(unites, 'living-business-mise-a-jour.service'), 'utf8'), /^ExecStart=\/usr\/local\/bin\/living-business-mise-a-jour$/m, 'la commande qui vérifie la signature avant tout');
    assert.match(readFileSync(join(unites, 'living-business-mise-a-jour.timer'), 'utf8'), /^OnCalendar=\*-\*-\* 04:00:00$/m);
    assert.match(readFileSync(appels, 'utf8'), /^enable --now living-business-mise-a-jour\.timer$/m);
    // choix gardé : une relance (ou la mise à jour elle-même) ne repose pas la question et ne change rien
    r = jouer('regler_mise_a_jour_auto non');
    assert.match(readFileSync(appels, 'utf8'), /^disable --now living-business-mise-a-jour\.timer$/m);
    assert.equal(jouer('choix_mise_a_jour_auto < /dev/null', { LB_MAJ_AUTO: '1' }).stdout.trim(), 'non', 'choix de l’entreprise respecté');
    assert.notEqual(jouer('regler_mise_a_jour_auto peut-etre').status, 0);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('mise à jour : le service ne redémarre que si la version ou sa configuration a changé', () => {
  assert.match(modele, /EN_SERVICE_AVANT="\$\(readlink "\$APP\/actuel" 2>\/dev\/null \|\| true\)"/);
  assert.match(modele, /if \[\[ "\$EN_SERVICE_AVANT" != "\$\(readlink "\$APP\/actuel"\)" \|\| "\$UNITE_AVANT" != .*\]\] \|\| ! systemctl is-active --quiet living-business; then\n {2}systemctl restart living-business\nfi/);
  assert.doesNotMatch(modele, /^systemctl restart living-business$/m, 'plus de redémarrage systématique');
});

test('clé des secrets : sortie du dossier des données, chiffrée par systemd-creds, reprise telle quelle, jamais recréée', { skip: !bashPresent && 'bash absent' }, () => {
  const d = mkdtempSync(join(tmpdir(), 'lb-cle-'));
  try {
    const conf = join(d, 'conf');
    const donnees = join(d, 'donnees');
    const outils = join(d, 'outils');
    for (const x of [conf, donnees, outils]) mkdirSync(x);
    // faux systemd-creds : « chiffre » en préfixant le nom, « déchiffre » en vérifiant ce nom (comme le vrai)
    writeFileSync(join(outils, 'systemd-creds'), `#!/usr/bin/env bash
set -e
mode="$1"; shift
nom=""; args=()
for a in "$@"; do case "$a" in --name=*) nom="\${a#--name=}";; --with-key=*) echo "$a" >> '${join(d, 'cles')}';; *) args+=("$a");; esac; done
[[ -n "\${ECHEC_CREDS:-}" ]] && exit 1
if [[ "$mode" == encrypt ]]; then { echo "CHIFFRE:$nom"; base64 < "\${args[0]}"; } > "\${args[1]}"
else [[ "$(head -n 1 "\${args[0]}")" == "CHIFFRE:$nom" ]] || exit 1; tail -n +2 "\${args[0]}" | base64 -d; fi
`);
    chmodSync(join(outils, 'systemd-creds'), 0o755);
    const jouer = (appel: string, env: NodeJS.ProcessEnv = {}) =>
      bash(`set -euo pipefail\nCONF='${conf}' DONNEES='${donnees}'\n${bloc('clé des secrets')}\n${appel}`, { PATH: `${outils}:${process.env.PATH}`, ...env });
    const ancienne = Buffer.alloc(32, 7).toString('base64');
    writeFileSync(join(donnees, 'cle-secrets'), ancienne, { mode: 0o600 });

    // ancienne installation : la clé en service est reprise (pas une nouvelle), chiffrée avec la clé du serveur
    let r = jouer('preparer_cle_secrets; echo "$LIGNE_CLE"');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), `LoadCredentialEncrypted=cle-secrets:${conf}/cle-secrets.cred`);
    const cred = readFileSync(join(conf, 'cle-secrets.cred'), 'utf8');
    assert.match(cred, /^CHIFFRE:cle-secrets\n/);
    assert.equal(Buffer.from(cred.split('\n').slice(1).join(''), 'base64').toString(), ancienne, 'même clé : les jetons restent lisibles');
    assert.match(readFileSync(join(d, 'cles'), 'utf8'), /^--with-key=host$/m, 'clé du serveur, pas la puce TPM (migration de VPS)');
    assert.equal((statSync(join(conf, 'cle-secrets.cred')).mode & 0o777).toString(8), '600');
    assert.equal(existsSync(join(conf, 'cle-secrets')), false, 'aucune copie en clair');
    // relance (mise à jour) : rien n'est refait ; retrait de l'ancienne copie après démarrage réussi
    r = jouer('preparer_cle_secrets; echo "$LIGNE_CLE"; retirer_cle_des_donnees', { ECHEC_CREDS: '1' });
    assert.equal(r.stdout.trim(), `LoadCredentialEncrypted=cle-secrets:${conf}/cle-secrets.cred`);
    assert.equal(readFileSync(join(conf, 'cle-secrets.cred'), 'utf8'), cred);
    assert.equal(existsSync(join(donnees, 'cle-secrets')), false, 'plus de clé à côté des données');

    // systemd-creds indisponible : fichier réservé dans la configuration, remis par LoadCredential
    rmSync(join(conf, 'cle-secrets.cred'));
    writeFileSync(join(donnees, 'cle-secrets'), ancienne);
    r = jouer('preparer_cle_secrets; echo "$LIGNE_CLE"', { ECHEC_CREDS: '1' });
    assert.equal(r.stdout.trim(), `LoadCredential=cle-secrets:${conf}/cle-secrets`);
    assert.equal(readFileSync(join(conf, 'cle-secrets'), 'utf8'), ancienne);
    assert.equal(existsSync(join(conf, 'cle-secrets.cred.nouveau')), false);

    // clé abîmée : rien n'est enfermé, l'installation s'arrête
    rmSync(join(conf, 'cle-secrets'));
    writeFileSync(join(donnees, 'cle-secrets'), 'pas-une-cle');
    r = jouer('preparer_cle_secrets');
    assert.notEqual(r.status, 0);
    assert.equal(existsSync(join(conf, 'cle-secrets.cred')) || existsSync(join(conf, 'cle-secrets')), false);
    // première installation : clé neuve de 32 octets
    rmSync(join(donnees, 'cle-secrets'));
    r = jouer('preparer_cle_secrets');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(Buffer.from(readFileSync(join(conf, 'cle-secrets.cred'), 'utf8').split('\n').slice(1).join(''), 'base64').toString().trim().length, 44);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('service en ligne : clé remise par systemd, jamais lue ni créée dans le dossier des données, retirée après démarrage', () => {
  assert.match(modele, /^Environment=LB_ORIGINE=.* LB_CLE_HORS_DONNEES=1$/m);
  assert.match(modele, /^\$LIGNE_CLE$/m, 'ligne LoadCredential(Encrypted) dans l’unité');
  assert.match(modele, /^preparer_cle_secrets \|\| erreur /m);
  const verif = modele.indexOf('curl -fsS "http://127.0.0.1:$PORT/api/v1/vivant" >/dev/null 2>&1 || erreur');
  assert.ok(verif > 0 && modele.indexOf('retirer_cle_des_donnees\n', verif) > verif, 'retrait seulement après la vérification du service');
});

/** Unité systemd écrite par l'installateur (heredoc « cat > "$UNITES/<nom>" <<X … X »). */
function unite(nom: string): string {
  const debut = modele.indexOf(`cat > "$UNITES/${nom}" <<X\n`);
  assert.ok(debut >= 0, `unité ${nom} introuvable`);
  const corps = modele.slice(modele.indexOf('\n', debut) + 1);
  return corps.slice(0, corps.indexOf('\nX\n'));
}

test('service du jeu : appels système filtrés, /proc réduit, ni horloge, ni nom d’hôte, ni setuid, ni temps réel', () => {
  const u = unite('living-business.service');
  for (const ligne of [
    'SystemCallFilter=@system-service', 'SystemCallFilter=~@privileged', 'SystemCallErrorNumber=EPERM', 'SystemCallArchitectures=native',
    'ProtectProc=invisible', 'ProcSubset=pid', 'RestrictSUIDSGID=yes', 'RestrictRealtime=yes', 'ProtectKernelLogs=yes',
    'ProtectClock=yes', 'ProtectHostname=yes', 'RemoveIPC=yes',
    // déjà là : rien n'est retiré
    'NoNewPrivileges=yes', 'ProtectSystem=strict', 'ProtectHome=yes', 'PrivateTmp=yes', 'PrivateDevices=yes', 'CapabilityBoundingSet=',
    'RestrictNamespaces=yes', 'LockPersonality=yes', 'ProtectKernelTunables=yes', 'ProtectKernelModules=yes', 'ProtectControlGroups=yes',
  ]) assert.ok(u.split('\n').includes(ligne), `${ligne} dans living-business.service`);
  assert.doesNotMatch(u, /^MemoryDenyWriteExecute=yes$/m, 'incompatible avec le compilateur JavaScript de Node.js');
});

test('Caddy : API d’administration coupée, configuration appliquée par redémarrage seulement si elle change', { skip: !bashPresent && 'bash absent' }, () => {
  const d = mkdtempSync(join(tmpdir(), 'lb-caddy-'));
  try {
    const caddyfile = join(d, 'Caddyfile');
    const appels = join(d, 'systemctl');
    const actif = join(d, 'actif');
    const jouer = () => bash(`set -euo pipefail\n${bloc('configuration de Caddy')}\nCADDYFILE='${caddyfile}'\nsystemctl() { echo "$*" >> '${appels}'; if [[ "$1" == is-active ]]; then [[ -f '${actif}' ]]; fi; }\nappliquer_caddy jeu.exemple.fr 4173`);
    writeFileSync(caddyfile, ':80 {\n\troot * /usr/share/caddy\n\tfile_server\n}\n'); // Caddyfile livré par le paquet
    writeFileSync(actif, '');
    let r = jouer();
    assert.equal(r.status, 0, r.stderr);
    const conf = readFileSync(caddyfile, 'utf8');
    // bloc d'options globales en tête (Caddy n'en accepte qu'un, avant les sites), avec « admin off »
    assert.match(conf, /^# Living Business[^\n]*\n\{\n(?:\t#[^\n]*\n)*\tadmin off\n\}\n/);
    assert.match(conf, /^jeu\.exemple\.fr \{$/m);
    assert.match(conf, /^\treverse_proxy 127\.0\.0\.1:4173$/m);
    assert.match(readFileSync(appels, 'utf8'), /^restart caddy$/m, 'configuration changée : redémarrage (reload passe par l’API coupée)');
    // relance identique (mise à jour de nuit) : rien n'est redémarré
    rmSync(appels);
    r = jouer();
    assert.equal(r.status, 0, r.stderr);
    assert.doesNotMatch(readFileSync(appels, 'utf8'), /^restart/m);
    // Caddy arrêté : redémarré même sans changement
    rmSync(actif);
    jouer();
    assert.match(readFileSync(appels, 'utf8'), /^restart caddy$/m);
    assert.doesNotMatch(modele, /systemctl reload caddy/, 'plus aucun reload : il passerait par l’API d’administration');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('Caddy : clé du dépôt officiel inscrite dans le script, celle du projet Caddy (empreinte épinglée)', () => {
  const b = bloc('dépôt officiel de Caddy');
  const empreinte = /^CADDY_EMPREINTE=([0-9A-F]{40})$/m.exec(b)?.[1];
  assert.equal(empreinte, '65760C51EDEA2017CEA2CA15155B6D79CA56EA34', 'clé « Caddy Web Server » publiée par dl.cloudsmith.io/public/caddy/stable');
  const armure = /cat <<'CLE_CADDY'\n([\s\S]+?)\nCLE_CADDY\n/.exec(b)?.[1];
  assert.ok(armure, 'clé inscrite dans le script (jamais téléchargée en confiance)');
  const cles = lireCles(armure);
  assert.ok(cles.length > 0, 'clé lisible');
  assert.deepEqual([...new Set(cles.map((c) => c.principale))], [empreinte], 'une seule clé principale, celle épinglée');
  assert.match(b, /^CADDY_DEPOT=https:\/\/dl\.cloudsmith\.io\/public\/caddy\/stable\/deb\/debian$/m);
  assert.doesNotMatch(b, /curl|wget|gpg --recv|apt-key/, 'ni clé ni dépôt récupérés à l’exécution');
});

test('Caddy : installé depuis son dépôt officiel à chaque passage, jamais le paquet « universe » d’Ubuntu', { skip: !bashPresent && 'bash absent' }, () => {
  const d = mkdtempSync(join(tmpdir(), 'lb-depot-caddy-'));
  try {
    const apt = join(d, 'apt');
    const appels = join(d, 'appels');
    const installe = join(d, 'installe'); // version installée (absent = pas de caddy)
    const candidat = join(d, 'candidat'); // version proposée par apt après lecture des dépôts
    const officiel = join(d, 'officiel'); // version que le dépôt officiel fournit à « apt-get install »
    const jouer = () => bash(`set -euo pipefail
${bloc('dépôt officiel de Caddy')}
APT_ETC='${apt}'
apt-get() { echo "apt-get $*" >> '${appels}'; if [[ " $* " == *" install "* && -s '${officiel}' ]]; then cp '${officiel}' '${installe}'; fi; }
dpkg-query() { [[ -s '${installe}' ]] && printf 'install ok installed|%s' "$(cat '${installe}')"; }
apt-cache() { printf 'caddy:\\n  Installed: x\\n  Candidate: %s\\n' "$(cat '${candidat}' 2>/dev/null || echo '(none)')"; }
code=0; depot_caddy || code=$?; echo "code=$code"`);
    const lus = () => (existsSync(appels) ? readFileSync(appels, 'utf8') : '');

    // serveur installé avant ce correctif : Caddy 2.6.2 d'Ubuntu (universe), ancienne source .list
    mkdirSync(join(apt, 'sources.list.d'), { recursive: true });
    writeFileSync(join(apt, 'sources.list.d', 'caddy-stable.list'), 'deb https://exemple.invalid any-version main\n');
    writeFileSync(installe, '2.6.2-6ubuntu0.24.04.3');
    writeFileSync(candidat, '2.10.2');
    writeFileSync(officiel, '2.10.2');
    let r = jouer();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /code=0/);
    assert.match(lus(), /^apt-get update -q$/m, 'dépôt ajouté : listes relues');
    assert.match(lus(), /^apt-get install -y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold caddy$/m, 'Caddyfile gardé');
    assert.equal(readFileSync(installe, 'utf8'), '2.10.2');
    const source = readFileSync(join(apt, 'sources.list.d', 'caddy-stable.sources'), 'utf8');
    assert.match(source, /^URIs: https:\/\/dl\.cloudsmith\.io\/public\/caddy\/stable\/deb\/debian$/m);
    assert.match(source, new RegExp(`^Signed-By: ${apt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/keyrings/caddy-stable\\.asc$`, 'm'), 'signature exigée avec la seule clé de Caddy');
    assert.equal(existsSync(join(apt, 'sources.list.d', 'caddy-stable.list')), false, 'une seule source pour Caddy');
    const cle = readFileSync(join(apt, 'keyrings', 'caddy-stable.asc'), 'utf8');
    assert.deepEqual([...new Set(lireCles(cle).map((c) => c.principale))], ['65760C51EDEA2017CEA2CA15155B6D79CA56EA34']);
    assert.equal(statSync(join(apt, 'keyrings', 'caddy-stable.asc')).mode & 0o777, 0o644, 'lisible par apt (_apt)');
    const prefs = readFileSync(join(apt, 'preferences.d', 'living-business-caddy'), 'utf8');
    assert.match(prefs, /Package: caddy\nPin: origin dl\.cloudsmith\.io\nPin-Priority: 1001/);
    assert.match(prefs, /Package: caddy\nPin: release o=Ubuntu\nPin-Priority: -1/, 'paquet d’Ubuntu écarté');
    assert.match(readFileSync(join(apt, 'apt.conf.d', '52living-business-caddy'), 'utf8'), /Unattended-Upgrade::Origins-Pattern \{\n\t"origin=cloudsmith\/caddy\/stable,site=dl\.cloudsmith\.io";\n\};/, 'mises à jour de sécurité automatiques');

    // passage suivant (mise à jour de nuit), rien de nouveau : ni lecture des dépôts ni installation
    rmSync(appels);
    r = jouer();
    assert.equal(r.status, 0, r.stderr);
    assert.equal(lus(), '');
    // version plus récente déjà connue d'apt : installée, sans relire les dépôts
    writeFileSync(candidat, '2.10.3');
    writeFileSync(officiel, '2.10.3');
    r = jouer();
    assert.doesNotMatch(lus(), /update/);
    assert.match(lus(), /install .* caddy$/m);
    assert.equal(readFileSync(installe, 'utf8'), '2.10.3');

    // dépôt officiel injoignable : le Caddy d'Ubuntu reste (signalé, nouvel essai au prochain passage)…
    rmSync(appels);
    writeFileSync(installe, '2.6.2-6ubuntu0.24.04.3');
    writeFileSync(candidat, '(none)');
    rmSync(officiel);
    r = jouer();
    assert.match(r.stdout, /code=2/);
    assert.match(r.stderr, /paquet d'Ubuntu, correctifs non garantis/);
    assert.match(lus(), /^apt-get update -q$/m, 'paquet d’Ubuntu encore là : nouvel essai');
    // … et une première installation sans Caddy échoue franchement
    rmSync(installe);
    r = jouer();
    assert.match(r.stdout, /code=1/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('Caddy : plus installé avec les outils du système, dépôt officiel préparé avant la configuration HTTPS', () => {
  const systeme = modele.slice(modele.indexOf('if [[ ! -f "$CONF/systeme-pret" ]]; then'), modele.indexOf('touch "$CONF/systeme-pret"'));
  assert.match(systeme, /apt-get -y -q install curl /);
  assert.doesNotMatch(systeme.replace(/^\s*#.*$/gm, ''), /\bcaddy\b/, 'pas de « caddy » d’Ubuntu à la première installation');
  const appel = modele.indexOf('depot_caddy || CODE_CADDY=$?');
  assert.ok(appel > modele.indexOf('touch "$CONF/systeme-pret"'), 'réévalué à chaque passage, hors de la partie faite une seule fois');
  assert.ok(appel < modele.indexOf('appliquer_caddy "$DOMAINE" "$PORT"'), 'avant d’écrire le Caddyfile');
});

test('copie hors site : rclone sans root, ne voit que les sauvegardes, clé des secrets et identifiants masqués',{ skip: !bashPresent && 'bash absent' }, () => {
  const d = mkdtempSync(join(tmpdir(), 'lb-copie-'));
  try {
    const conf = join(d, 'conf');
    const unites = join(d, 'unites');
    mkdirSync(conf);
    mkdirSync(unites);
    writeFileSync(join(conf, 'rclone.env'), 'RCLONE_CONFIG_S3_TYPE=s3\n');
    const prelude = `set -euo pipefail\nCONF='${conf}' DONNEES=/var/lib/living-business UNITES='${unites}' CONSERVATION_HORS_SITE=31\nsystemctl() { :; }\n`;
    const r = bash(`${prelude}${bloc('copie hors site')}\necrire_copie_hors_site`);
    assert.equal(r.status, 0, r.stderr);
    const lignes = readFileSync(join(unites, 'living-business-sauvegarde.service'), 'utf8').split('\n');
    for (const l of [
      'DynamicUser=yes', 'AmbientCapabilities=CAP_DAC_READ_SEARCH', 'CapabilityBoundingSet=CAP_DAC_READ_SEARCH',
      'TemporaryFileSystem=/var:ro', 'BindReadOnlyPaths=-/var/lib/living-business/sauvegardes',
      'ProtectSystem=strict', 'ProtectHome=yes', 'PrivateTmp=yes', 'PrivateDevices=yes', 'NoNewPrivileges=yes', 'ProtectProc=invisible',
      'MemoryDenyWriteExecute=yes', 'SystemCallFilter=@system-service', 'SystemCallFilter=~@privileged', 'RestrictNamespaces=yes',
    ]) assert.ok(lignes.includes(l), `${l} dans living-business-sauvegarde.service`);
    assert.equal(lignes.some((l) => /^User=/.test(l)), false, 'pas de compte fixe (root par défaut avant)');
    const masques = lignes.find((l) => l.startsWith('InaccessiblePaths='))?.split(/\s+/) ?? [];
    for (const p of [`-${conf}/cle-secrets`, `-${conf}/cle-secrets.cred`, '-/run/credentials', '-/etc/ssh', '-/etc/shadow']) {
      assert.ok(masques.includes(p) || masques.includes(`InaccessiblePaths=${p}`), `${p} masqué`);
    }
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('copie hors site : phrase de chiffrement passée à rclone par l’entrée standard ; stockage verrouillé = aucun effacement par le serveur', { skip: !bashPresent && 'bash absent' }, () => {
  const d = mkdtempSync(join(tmpdir(), 'lb-copie-'));
  try {
    const conf = join(d, 'conf');
    const unites = join(d, 'unites');
    const outils = join(d, 'outils');
    for (const x of [conf, unites, outils]) mkdirSync(x);
    // faux rclone : note ses arguments et ce qu'il lit sur l'entrée standard
    writeFileSync(join(outils, 'rclone'), `#!/usr/bin/env bash\necho "$*" > '${join(d, 'args')}'\ncat > '${join(d, 'entree')}'\necho OBSCURCI-ESSAI\n`);
    chmodSync(join(outils, 'rclone'), 0o755);
    const prelude = `set -euo pipefail\nCONF='${conf}' DONNEES=/var/lib/living-business UNITES='${unites}' CONSERVATION_HORS_SITE=31\nsystemctl() { :; }\n`;
    const phrase = `phrase-${Date.now()}-essai`;
    const secret = ['essai', 'secret', String(process.pid)].join('-'); // faux secret construit à l'exécution
    let r = bash(`${prelude}${bloc('copie hors site')}\necrire_rclone_env https://s3.sbg.exemple sbg conteneur-essai CLEESSAI01 '${secret}' '${phrase}'`, { PATH: `${outils}:${process.env.PATH}` });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(join(d, 'args'), 'utf8').trim(), 'obscure -', 'aucune phrase dans les arguments (liste des processus)');
    assert.equal(readFileSync(join(d, 'entree'), 'utf8'), `${phrase}\n`);
    const env = readFileSync(join(conf, 'rclone.env'), 'utf8');
    assert.match(env, /^RCLONE_CONFIG_CHIFFRE_PASSWORD=OBSCURCI-ESSAI$/m);
    assert.match(env, /^RCLONE_CONFIG_CHIFFRE_REMOTE=s3:conteneur-essai\/living-business$/m);
    assert.equal(env.includes(phrase), false, 'phrase jamais écrite en clair');
    assert.equal((statSync(join(conf, 'rclone.env')).mode & 0o777).toString(8), '600');

    // clé avec droit d'effacement (par défaut) : le serveur efface les copies de plus de 31 jours
    r = bash(`${prelude}${bloc('copie hors site')}\necrire_copie_hors_site`);
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(join(unites, 'living-business-sauvegarde.service'), 'utf8'), /^ExecStartPost=.*rclone delete chiffre: --min-age 31d'$/m);
    // stockage verrouillé (Object Lock, clé sans effacement) : rien n'est effacé d'ici, la règle de cycle de vie s'en charge
    writeFileSync(join(conf, 'copie-verrouillee'), '');
    r = bash(`${prelude}${bloc('copie hors site')}\necrire_copie_hors_site`);
    assert.equal(r.status, 0, r.stderr);
    const service = readFileSync(join(unites, 'living-business-sauvegarde.service'), 'utf8');
    assert.doesNotMatch(service, /delete/);
    assert.doesNotMatch(service, /^ExecStartPost=/m);
    assert.match(service, /^ExecStart=\/usr\/bin\/rclone copy \/var\/lib\/living-business\/sauvegardes chiffre: --max-age 72h$/m);
    // l'installateur ne passe plus la phrase en argument
    assert.doesNotMatch(modele, /rclone obscure "\$/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
