#!/usr/bin/env bash
# Living Business — mettre le jeu en ligne sur VOTRE serveur, à VOTRE adresse (Ubuntu 24.04).
#
#   curl -fsSL __NEXUS_ORIGINE__/installer-jeu.sh -o installer-jeu.sh && sudo bash installer-jeu.sh jeu.monentreprise.fr
#   (vérification de la signature avant de lancer : Réglages → Mettre en ligne dans le jeu, ou README « Vérifier »)
#
# Le serveur est à vous, les données restent chez vous : l'éditeur n'a ni compte, ni accès, ni télémétrie.
# Seul canal de l'éditeur vers ce serveur : les mises à jour (lancées par vous, ou chaque nuit si vous l'acceptez), dont
# le code s'exécute en root. Chaque publication est signée hors ligne par l'éditeur (clé absente de Breizhcosystem) ; ce serveur vérifie la signature avec la clé enregistrée à l'installation
# avant d'exécuter quoi que ce soit, et refuse un paquet dont l'empreinte n'est pas celle signée.
# `sudo living-business-mise-a-jour` = mise à jour vérifiée ; vos données sont conservées.
# Ce que fait le script : mises à jour de sécurité automatiques, pare-feu (SSH, HTTP, HTTPS), SSH par clé seulement
# dès qu'une clé est installée (vérifié à chaque passage), HTTPS automatique (Caddy + Let's Encrypt), Living Business en service système isolé,
# sauvegarde quotidienne (et, si vous le voulez, copie chiffrée hors du serveur).
set -euo pipefail

NEXUS="${LB_NEXUS:-__NEXUS_ORIGINE__}"
DOMAINE="$(echo "${1:-}" | tr '[:upper:]' '[:lower:]')"
CONF=/etc/living-business
DONNEES=/var/lib/living-business
APP=/opt/living-business
PORT=4173
UTIL=living-business
UNITES=/etc/systemd/system
SSHD_CONFIG=/etc/ssh/sshd_config
SSHD_CONF_D=/etc/ssh/sshd_config.d
RACINE_SSH="" # préfixe des dossiers /home et /root (vide : la machine elle-même)
# durée des copies chiffrées hors du serveur (jours) : celle des sauvegardes locales (30 copies) et un jour de marge
CONSERVATION_HORS_SITE=31

etape() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
erreur() { printf '\n\033[31m%s\033[0m\n' "$1" >&2; exit 1; }

[[ $EUID -eq 0 ]] || erreur "À lancer avec sudo : sudo bash installer-jeu.sh jeu.monentreprise.fr"
# shellcheck source=/dev/null
. /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || erreur "Prévu pour Ubuntu 24.04. Système trouvé : ${PRETTY_NAME:-inconnu}."
if [[ -z "$DOMAINE" && -f "$CONF/domaine" ]]; then DOMAINE="$(cat "$CONF/domaine")"; fi
[[ "$DOMAINE" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] || erreur "Indiquez l'adresse du jeu, par exemple : sudo bash installer-jeu.sh jeu.monentreprise.fr"
# essai automatisé (CI) seulement : téléchargements servis en http sur la machine elle-même
PROTO=(--proto '=https')
if [[ "${LB_ESSAI_LOCAL:-}" == "1" && "$NEXUS" =~ ^http://127\.0\.0\.1:[0-9]+$ ]]; then PROTO=(); fi
[[ "$NEXUS" =~ ^https://[a-z0-9.-]+(:[0-9]+)?$ || ${#PROTO[@]} -eq 0 ]] || erreur "Adresse de téléchargement invalide ($NEXUS)."
[[ "$(uname -m)" == "x86_64" ]] || erreur "Serveur $(uname -m) : choisissez un serveur Intel/AMD 64 bits (x86_64)."

# ------------------------------------------------------------------ 0. publication signée par l'éditeur
# Remplie puis signée par scripts/signer-publication.ts sur le poste de l'éditeur, avec une clé gardée hors ligne
# (jamais sur Breizhcosystem ni dans la CI) : version, paquet Linux, son empreinte et la clé publique de l'éditeur. La signature
# couvre tout le script (dernière ligne). Le modèle non rempli (dépôt, paquet téléchargé) ne fait que récupérer la
# publication signée et la vérifier avant de l'exécuter.
PUBLIE_VERSION='__PUBLIE_VERSION__'
PUBLIE_PAQUET='__PUBLIE_PAQUET__'
PUBLIE_SHA256='__PUBLIE_SHA256__'
SIGNATAIRES='__SIGNATAIRES__'

# >>> vérification des publications (reprise telle quelle par living-business-mise-a-jour ; testée par scripts/signer-publication.test.ts)
# Publication = le script, puis une dernière ligne « # signature-living-business: <signature ssh-keygen -Y en base64> »
# (identité editeur-living-business, espace de noms living-business-installateur). Rien ne s'exécute sans elle.
verifier_script_signe() { # <script reçu> <fichier des signataires> <script vérifié (écrit seulement si valable)>
  local recu="$1" signataires="$2" sortie="$3" ligne motif='^# signature-living-business: ([A-Za-z0-9+/]+={0,2})$'
  [[ -s "$recu" && -s "$signataires" ]] || return 1
  grep -qE '^editeur-living-business ' "$signataires" || return 1
  ligne="$(tail -n 1 "$recu")"
  [[ "$ligne" =~ $motif ]] || return 1
  printf '%s' "${BASH_REMATCH[1]}" | base64 -d > "$sortie.sig" 2>/dev/null || { rm -f "$sortie.sig"; return 1; }
  sed '$d' "$recu" > "$sortie.tmp"
  if ssh-keygen -Y verify -f "$signataires" -I editeur-living-business -n living-business-installateur -s "$sortie.sig" < "$sortie.tmp" >/dev/null 2>&1; then
    rm -f "$sortie.sig"; mv "$sortie.tmp" "$sortie"; return 0
  fi
  rm -f "$sortie.sig" "$sortie.tmp"; return 1
}
publication_valide() { # <version> <paquet> <empreinte> : forme stricte, nom du paquet et version accordés
  [[ "$1" =~ ^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$ && "$2" == "living-business-$1-linux-x64.zip" && "$3" =~ ^[0-9a-f]{64}$ ]]
}
version_inferieure() { # <a> <b> : vrai si a est strictement plus ancienne que b (X.Y.Z)
  [[ "$1" != "$2" && "$(printf '%s\n%s\n' "$1" "$2" | sort -t. -k1,1n -k2,2n -k3,3n | head -n 1)" == "$1" ]]
}
lancer_publication_signee() { # <adresse Breizhcosystem> <fichier des signataires> <arguments du script…>
  local nexus="$1" signataires="$2" travail code=0
  shift 2
  travail="$(mktemp -d)"
  if ! curl -fsSL "${PROTO[@]}" "$nexus/installer-jeu.sh" -o "$travail/recu.sh"; then
    rm -rf "$travail"; echo "Script d'installation injoignable ($nexus)." >&2; return 1
  fi
  if ! verifier_script_signe "$travail/recu.sh" "$signataires" "$travail/verifie.sh"; then
    rm -rf "$travail"; echo "Signature de l'éditeur absente ou invalide : script refusé, rien n'a été exécuté." >&2; return 1
  fi
  bash "$travail/verifie.sh" "$@" || code=$?
  rm -rf "$travail"; return "$code"
}
# <<< vérification des publications

if [[ ! "$PUBLIE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  # modèle non signé : clé déjà enregistrée sur ce serveur, sinon celle de l'éditeur inscrite dans ce modèle
  SIG_CONNUS="$CONF/signataires"
  if [[ ! -s "$SIG_CONNUS" ]]; then
    [[ "$SIGNATAIRES" == editeur-living-business\ * ]] || erreur "Ce script n'est pas une publication signée et la clé de l'éditeur est inconnue : installation refusée. Téléchargez installer-jeu.sh depuis Breizhcosystem et vérifiez sa signature (Réglages → Mettre en ligne)."
    SIG_CONNUS="$(mktemp)"
    printf '%s\n' "$SIGNATAIRES" > "$SIG_CONNUS"
  fi
  command -v ssh-keygen >/dev/null || apt-get install -y -q openssh-client
  etape "Récupération de la publication signée par l'éditeur"
  lancer_publication_signee "$NEXUS" "$SIG_CONNUS" "$DOMAINE"
  exit 0
fi
publication_valide "$PUBLIE_VERSION" "$PUBLIE_PAQUET" "$PUBLIE_SHA256" || erreur "Publication mal formée : installation refusée."
[[ "$SIGNATAIRES" == editeur-living-business\ * ]] || erreur "Clé de l'éditeur absente de la publication : installation refusée."

# ------------------------------------------------------------------ 1. système (une seule fois)
if [[ ! -f "$CONF/systeme-pret" ]]; then
  etape "Mise à jour du système et outils (quelques minutes)"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get -y -q upgrade
  # Caddy : pas ici, depuis son dépôt officiel à chaque passage (« dépôt officiel de Caddy » plus bas)
  apt-get -y -q install curl unzip python3 ufw fail2ban unattended-upgrades rclone
  cat > /etc/apt/apt.conf.d/20auto-upgrades <<'X'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
X
  cat > /etc/apt/apt.conf.d/52living-business <<'X'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
X
  etape "Pare-feu : seuls SSH, HTTP et HTTPS sont ouverts"
  ufw default deny incoming
  ufw default allow outgoing
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 443/udp
  ufw --force enable
  systemctl enable --now fail2ban
  mkdir -p "$CONF"
  touch "$CONF/systeme-pret"
fi

# >>> durcissement SSH (testé par scripts/installateur.test.ts)
# Réévalué à CHAQUE passage : une clé ajoutée après la première installation (ssh-copy-id, puis relance) est prise en
# compte. Fichier « 00-… » : sshd garde la PREMIÈRE valeur lue, et 50-cloud-init.conf (images cloud livrées avec un
# mot de passe) autorise les mots de passe. Le résultat est contrôlé avec « sshd -T » : « clé uniquement » n'est
# affiché que si c'est vrai. Connexion root : par clé seulement si root a une clé (sinon refusée), jamais coupée.
cle_ssh_dans() { grep -qsE '(^|[[:space:]])(ssh-(ed25519|rsa|dss)|ecdsa-sha2-[a-z0-9-]+|sk-[a-z0-9@.-]+)[[:space:]]+[A-Za-z0-9+/]{20,}' "$@"; }
durcir_ssh() { # → 0 si SSH n'accepte plus que les clés (vérifié), 1 sinon (avertissement affiché)
  local f cles=() racine=no effectif
  for f in "$RACINE_SSH"/home/*/.ssh/authorized_keys "$RACINE_SSH"/root/.ssh/authorized_keys; do
    if [[ -f "$f" ]] && cle_ssh_dans "$f"; then cles+=("$f"); fi
  done
  if [[ ${#cles[@]} -eq 0 ]]; then
    if [[ ! -f "$SSHD_CONF_D/00-living-business.conf" ]]; then
      echo "Pas de clé SSH trouvée : la connexion SSH par mot de passe reste active. Ajoutez votre clé (ssh-copy-id), vérifiez qu'elle marche, puis relancez : sudo bash installer-jeu.sh" >&2
      return 1
    fi
  else
    if cle_ssh_dans "$RACINE_SSH/root/.ssh/authorized_keys"; then racine=prohibit-password; fi
    mkdir -p "$SSHD_CONF_D"
    printf '# Living Business (installer-jeu.sh) : connexion par clé uniquement\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin %s\n' "$racine" > "$SSHD_CONF_D/00-living-business.conf"
    rm -f "$SSHD_CONF_D/50-living-business.conf" # ancien nom, lu après 50-cloud-init.conf : sans effet
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  fi
  if ! effectif="$(sshd -T 2>/dev/null)"; then
    echo "Attention : configuration SSH non vérifiable (sshd -T a échoué). Contrôlez : sudo sshd -T | grep -i authentication" >&2
    return 1
  fi
  if grep -qx 'passwordauthentication no' <<<"$effectif" && grep -qx 'kbdinteractiveauthentication no' <<<"$effectif"; then
    echo "SSH : connexion par clé uniquement (vérifié avec sshd -T)."
    return 0
  fi
  echo "Attention : SSH accepte ENCORE les mots de passe : un autre réglage l'emporte ($(grep -lisE '^[[:space:]]*(PasswordAuthentication|KbdInteractiveAuthentication)[[:space:]]+yes' "$SSHD_CONFIG" "$SSHD_CONF_D"/*.conf 2>/dev/null | tr '\n' ' ')). Passez-le à « no », puis relancez." >&2
  return 1
}
# <<< durcissement SSH
etape "SSH"
durcir_ssh || true
mkdir -p "$CONF"
echo "$DOMAINE" > "$CONF/domaine"

# ------------------------------------------------------------------ 2. vérification de l'adresse (DNS)
IP_DOMAINE="$(getent ahostsv4 "$DOMAINE" | awk 'NR==1 {print $1}' || true)"
if [[ -z "$IP_DOMAINE" ]]; then
  echo "Attention : $DOMAINE ne pointe vers aucun serveur. Ajoutez chez votre registraire un enregistrement A → $(hostname -I | awk '{print $1}')." >&2
elif ! hostname -I | tr ' ' '\n' | grep -qx "$IP_DOMAINE"; then
  echo "Attention : $DOMAINE pointe vers $IP_DOMAINE, pas vers ce serveur ($(hostname -I | awk '{print $1}')). Le certificat HTTPS ne pourra pas être obtenu tant que ce n'est pas corrigé." >&2
fi

# ------------------------------------------------------------------ 3. version publiée, empreinte signée par l'éditeur
# clé de l'éditeur enregistrée sur ce serveur : les mises à jour suivantes seront vérifiées avec elle
printf '%s\n' "$SIGNATAIRES" > "$CONF/signataires.nouveau"
chmod 644 "$CONF/signataires.nouveau"
mv "$CONF/signataires.nouveau" "$CONF/signataires"
etape "Téléchargement de Living Business $PUBLIE_VERSION (version Linux)"
NOM="$PUBLIE_PAQUET" SHA="$PUBLIE_SHA256" VERSION="$PUBLIE_VERSION"
# >>> installation du paquet (testée par scripts/installateur.test.ts)
# Dossier nommé d'après le CONTENU : version et début de l'empreinte signée, empreinte complète notée dedans. Un paquet
# corrigé republié sous le même numéro est donc bien installé (avant : dossier « déjà présent », ancien code gardé).
dossier_paquet() { printf '%s-%s' "$1" "${2:0:16}"; } # <version> <empreinte>
version_de_dossier() { local n="${1##*/}"; printf '%s' "${n%%-*}"; } # « 0.1.0-ab12… » ou ancien « 0.1.0 » → 0.1.0
installer_paquet() { # <zip vérifié> <nom du paquet> <version> <empreinte> : $APP/actuel désigne ce contenu exact
  local zip="$1" nom="$2" version="$3" sha="$4" cible avant extrait deja="" d
  cible="$APP/versions/$(dossier_paquet "$version" "$sha")"
  avant="$(readlink "$APP/actuel" 2>/dev/null || true)"
  mkdir -p "$APP/versions"
  rm -rf "$APP/versions"/.extrait.*
  [[ -f "$cible/.empreinte-paquet" ]] && deja="$(cat "$cible/.empreinte-paquet")"
  if [[ "$deja" != "$sha" || ! -x "$cible/app/node" ]]; then
    extrait="$(mktemp -d "$APP/versions/.extrait.XXXXXX")"
    if ! unzip -q "$zip" -d "$extrait" || [[ ! -x "$extrait/${nom%.zip}/app/node" ]]; then
      rm -rf "$extrait"; echo "Paquet incomplet." >&2; return 1
    fi
    printf '%s\n' "$sha" > "$extrait/${nom%.zip}/.empreinte-paquet"
    chown -R root:root "$extrait/${nom%.zip}"
    chmod -R go-w "$extrait/${nom%.zip}"
    rm -rf "$cible"
    mv "$extrait/${nom%.zip}" "$cible"
    rm -rf "$extrait"
  fi
  ln -sfn "$cible" "$APP/actuel"
  if [[ "$avant" == "$cible" ]]; then echo "Déjà à jour : Living Business $version (paquet ${sha:0:12})."
  elif [[ -n "$avant" ]]; then echo "Mise à jour appliquée : ${avant##*/} → ${cible##*/}."
  else echo "Living Business $version installé (paquet ${sha:0:12})."
  fi
  # ménage : seules restent la version en service et la précédente (retour en arrière possible)
  for d in "$APP/versions"/*; do
    if [[ -d "$d" && "$d" != "$cible" && "$d" != "$avant" ]]; then rm -rf "$d"; fi
  done
  return 0
}
# <<< installation du paquet
ACTUELLE="$(version_de_dossier "$(readlink "$APP/actuel" 2>/dev/null || true)")"
if [[ "$ACTUELLE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && version_inferieure "$VERSION" "$ACTUELLE" && [[ "${LB_RETOUR_ARRIERE:-}" != "1" ]]; then
  erreur "Version $VERSION plus ancienne que celle installée ($ACTUELLE) : refusé. Retour en arrière volontaire : sudo env LB_RETOUR_ARRIERE=1 bash installer-jeu.sh"
fi
TRAVAIL="$(mktemp -d)"
trap 'rm -rf "$TRAVAIL"' EXIT
curl -fsSL "${PROTO[@]}" "$NEXUS/telechargements/$NOM" -o "$TRAVAIL/$NOM" || erreur "Téléchargement impossible ($NEXUS/telechargements/$NOM)."
echo "$SHA  $TRAVAIL/$NOM" | sha256sum -c --quiet || erreur "Empreinte SHA-256 différente de celle signée par l'éditeur : paquet refusé."
EN_SERVICE_AVANT="$(readlink "$APP/actuel" 2>/dev/null || true)"
installer_paquet "$TRAVAIL/$NOM" "$NOM" "$VERSION" "$SHA" || erreur "Paquet incomplet : installation abandonnée, la version en service est inchangée."

# ------------------------------------------------------------------ 4. service système isolé
etape "Service Living Business"
id "$UTIL" >/dev/null 2>&1 || useradd --system --home-dir "$DONNEES" --shell /usr/sbin/nologin "$UTIL"
install -d -m 700 -o "$UTIL" -g "$UTIL" "$DONNEES"
# >>> clé des secrets (testée par scripts/installateur.test.ts)
# La clé qui chiffre les jetons des outils n'est pas rangée à côté des données ($DONNEES) : identifiant systemd chiffré
# avec la clé propre à ce serveur (systemd-creds, /var/lib/systemd/credential.secret, lisible par root seul), remis au
# seul service à son démarrage (LoadCredentialEncrypted → $CREDENTIALS_DIRECTORY, en mémoire, en lecture seule). Une
# copie du dossier des données, des sauvegardes ou de /etc ne suffit donc pas à lire les jetons. systemd-creds
# indisponible : fichier réservé à root dans $CONF, remis de la même façon (LoadCredential). La clé déjà en service
# (ancienne installation : $DONNEES/cle-secrets) est reprise telle quelle, vérifiée, puis retirée du dossier des
# données après un démarrage réussi.
preparer_cle_secrets() { # → LIGNE_CLE (ligne de l'unité systemd)
  local cred="$CONF/cle-secrets.cred" clair="$CONF/cle-secrets" travail
  if [[ -s "$cred" ]]; then LIGNE_CLE="LoadCredentialEncrypted=cle-secrets:$cred"; return 0; fi
  if [[ -s "$clair" ]]; then LIGNE_CLE="LoadCredential=cle-secrets:$clair"; return 0; fi
  travail="$(umask 077; mktemp)"
  if [[ -s "$DONNEES/cle-secrets" ]]; then cat "$DONNEES/cle-secrets" > "$travail"
  else head -c 32 /dev/urandom | base64 > "$travail"; fi
  # 32 octets en base64, sinon rien n'est enfermé (une clé abîmée rendrait les jetons illisibles)
  if [[ "$(base64 -d < "$travail" 2>/dev/null | wc -c | tr -d '[:space:]')" != 32 ]]; then
    rm -f "$travail"; echo "Clé des secrets illisible ($DONNEES/cle-secrets) : rien n'a été changé." >&2; return 1
  fi
  if command -v systemd-creds >/dev/null 2>&1 \
    && systemd-creds encrypt --with-key=host --name=cle-secrets "$travail" "$cred.nouveau" >/dev/null 2>&1 \
    && systemd-creds decrypt --name=cle-secrets "$cred.nouveau" - 2>/dev/null | cmp -s - "$travail"; then
    chmod 600 "$cred.nouveau"
    mv "$cred.nouveau" "$cred"
    LIGNE_CLE="LoadCredentialEncrypted=cle-secrets:$cred"
  else
    rm -f "$cred.nouveau"
    (umask 077; cat "$travail" > "$clair.nouveau")
    chmod 600 "$clair.nouveau"
    mv "$clair.nouveau" "$clair"
    LIGNE_CLE="LoadCredential=cle-secrets:$clair"
  fi
  rm -f "$travail"
}
retirer_cle_des_donnees() { # après un démarrage réussi avec l'identifiant : plus de clé dans le dossier des données
  if [[ -e "$DONNEES/cle-secrets" ]] && { [[ -s "$CONF/cle-secrets.cred" ]] || [[ -s "$CONF/cle-secrets" ]]; }; then
    rm -f "$DONNEES/cle-secrets"
  fi
}
# <<< clé des secrets
preparer_cle_secrets || erreur "Clé des secrets : préparation impossible, installation arrêtée (la version en service est inchangée)."
UNITE_AVANT="$(cat "$UNITES/living-business.service" 2>/dev/null || true)"
# Isolement (contrôlé par « systemd-analyze security living-business ») : appels système limités à ceux d'un service
# (@system-service sans @privileged, refus par EPERM plutôt qu'un arrêt brutal), /proc réduit aux processus du jeu,
# ni horloge, ni nom d'hôte, ni journal du noyau, ni setuid, ni temps réel. Non retenus : PrivateUsers (non essayé
# sur toutes les images Ubuntu, un service qui ne démarre plus la nuit coûterait plus cher), MemoryDenyWriteExecute
# (incompatible avec le compilateur JavaScript de Node.js), PrivateNetwork et IPAddressDeny (le jeu appelle Breizhcosystem
# et les outils de l'entreprise, et Caddy le joint sur 127.0.0.1).
cat > "$UNITES/living-business.service" <<X
[Unit]
Description=Living Business ($DOMAINE)
After=network-online.target
Wants=network-online.target

[Service]
User=$UTIL
Group=$UTIL
WorkingDirectory=$APP/actuel/app
Environment=HOST=127.0.0.1 PORT=$PORT LB_DONNEES=$DONNEES LB_EN_LIGNE=1 LB_PROXY=1 LB_COOKIE_SECURE=1
Environment=LB_ORIGINE=https://$DOMAINE LB_HOTES=$DOMAINE LB_NEXUS_URL=$NEXUS LB_CLE_HORS_DONNEES=1
$LIGNE_CLE
ExecStart=$APP/actuel/app/node --disable-warning=ExperimentalWarning src/passerelle/serveur.ts
Restart=always
RestartSec=3
UMask=0077
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ReadWritePaths=$DONNEES
CapabilityBoundingSet=
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictNamespaces=yes
LockPersonality=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
ProtectKernelLogs=yes
ProtectClock=yes
ProtectHostname=yes
ProtectProc=invisible
ProcSubset=pid
RestrictSUIDSGID=yes
RestrictRealtime=yes
RemoveIPC=yes
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallFilter=~@privileged
SystemCallErrorNumber=EPERM

[Install]
WantedBy=multi-user.target
X
systemctl daemon-reload
systemctl enable living-business >/dev/null 2>&1
# redémarrage seulement si quelque chose a changé (les sessions ouvertes ne tombent pas pour rien chaque nuit)
if [[ "$EN_SERVICE_AVANT" != "$(readlink "$APP/actuel")" || "$UNITE_AVANT" != "$(cat "$UNITES/living-business.service")" ]] || ! systemctl is-active --quiet living-business; then
  systemctl restart living-business
fi

# commandes pratiques
cat > /usr/local/bin/living-business-secours <<X
#!/usr/bin/env bash
# Mot de passe ET code de secours perdus : lien de réinitialisation (15 min, une fois).
exec sudo -u $UTIL env LB_DONNEES=$DONNEES LB_EN_LIGNE=1 LB_ORIGINE=https://$DOMAINE PORT=$PORT $APP/actuel/app/node --disable-warning=ExperimentalWarning $APP/actuel/app/src/passerelle/secours.ts
X
# mise à jour : le script de Breizhcosystem ne s'exécute qu'après vérification de sa signature avec la clé de ce serveur
{
  echo '#!/usr/bin/env bash'
  echo "# Dernière version de Living Business (données conservées), signature de l'éditeur vérifiée avant exécution."
  echo 'set -euo pipefail'
  declare -p PROTO
  printf 'NEXUS=%q\nDOMAINE=%q\nSIGNATAIRES_LOCAUX=%q\n' "$NEXUS" "$DOMAINE" "$CONF/signataires"
  # essai automatisé (CI) seulement : la publication vérifiée garde l'adresse locale en http
  if [[ ${#PROTO[@]} -eq 0 ]]; then printf 'export LB_ESSAI_LOCAL=1 LB_NEXUS=%q\n' "$NEXUS"; fi
  declare -f verifier_script_signe lancer_publication_signee
  # shellcheck disable=SC2016 # écrit tel quel dans le script de mise à jour
  echo 'lancer_publication_signee "$NEXUS" "$SIGNATAIRES_LOCAUX" "$DOMAINE"'
} > /usr/local/bin/living-business-mise-a-jour.nouveau
mv /usr/local/bin/living-business-mise-a-jour.nouveau /usr/local/bin/living-business-mise-a-jour
chmod 755 /usr/local/bin/living-business-secours /usr/local/bin/living-business-mise-a-jour

# >>> mise à jour automatique (testée par scripts/installateur.test.ts)
# Chaque nuit, living-business-mise-a-jour (signature de l'éditeur vérifiée avant toute exécution, version plus
# ancienne refusée) : les correctifs du jeu et du Node.js embarqué arrivent sans attendre une intervention. Proposé à
# l'installation (recommandé), choix gardé dans $CONF/mise-a-jour-auto ; sans terminal : LB_MAJ_AUTO=0 pour refuser.
# Changer d'avis : sudo living-business-mise-a-jour-auto oui|non
regler_mise_a_jour_auto() { # <oui|non>
  [[ "$1" == oui || "$1" == non ]] || return 1
  cat > "$UNITES/living-business-mise-a-jour.service" <<X
[Unit]
Description=Mise à jour vérifiée de Living Business (signature de l'éditeur)
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/living-business-mise-a-jour
X
  cat > "$UNITES/living-business-mise-a-jour.timer" <<X
[Unit]
Description=Mise à jour vérifiée de Living Business, chaque nuit
[Timer]
OnCalendar=*-*-* 04:00:00
RandomizedDelaySec=3600
Persistent=true
[Install]
WantedBy=timers.target
X
  printf '%s\n' "$1" > "$CONF/mise-a-jour-auto"
  systemctl daemon-reload
  if [[ "$1" == oui ]]; then systemctl enable --now living-business-mise-a-jour.timer >/dev/null 2>&1
  else systemctl disable --now living-business-mise-a-jour.timer >/dev/null 2>&1 || true
  fi
}
choix_mise_a_jour_auto() { # → oui|non : choix déjà fait, sinon question (terminal) ou LB_MAJ_AUTO, oui par défaut
  local rep
  if [[ -f "$CONF/mise-a-jour-auto" ]]; then cat "$CONF/mise-a-jour-auto"; return 0; fi
  if [[ "${LB_MAJ_AUTO:-}" == "0" ]]; then echo non; return 0; fi
  if [[ "${LB_MAJ_AUTO:-}" == "1" || ! -t 0 ]]; then echo oui; return 0; fi
  read -r -p "Mises à jour automatiques chaque nuit, vérifiées par la signature de l'éditeur (recommandé) ? (O/n) " rep
  if [[ "${rep:-o}" =~ ^[nN] ]]; then echo non; else echo oui; fi
}
# <<< mise à jour automatique
MAJ_AUTO="$(choix_mise_a_jour_auto)"
regler_mise_a_jour_auto "$MAJ_AUTO"
{
  echo '#!/usr/bin/env bash'
  echo "# Mises à jour automatiques de Living Business : oui ou non (sudo living-business-mise-a-jour-auto non)."
  echo 'set -euo pipefail'
  # shellcheck disable=SC2016  # texte du script écrit tel quel : $EUID est évalué à son exécution, pas ici
  echo '[[ $EUID -eq 0 ]] || { echo "À lancer avec sudo." >&2; exit 1; }'
  printf 'CONF=%q\nUNITES=%q\n' "$CONF" "$UNITES"
  declare -f regler_mise_a_jour_auto
  # shellcheck disable=SC2016 # écrit tel quel
  echo 'regler_mise_a_jour_auto "${1:-}" || { echo "Usage : sudo living-business-mise-a-jour-auto oui|non" >&2; exit 1; }'
  # shellcheck disable=SC2016 # écrit tel quel
  echo 'echo "Mises à jour automatiques : $1."'
} > /usr/local/bin/living-business-mise-a-jour-auto
chmod 755 /usr/local/bin/living-business-mise-a-jour-auto

# ------------------------------------------------------------------ 5. HTTPS automatique
# >>> dépôt officiel de Caddy (testé par scripts/installateur.test.ts)
# Caddy est le seul programme de ce serveur exposé à Internet (443/tcp, et 443/udp pour HTTP/3). Le paquet « caddy »
# d'Ubuntu 24.04 vient du dépôt communautaire « universe » (version 2.6.2 de 2022) : ses correctifs de sécurité ne
# sont pas garantis. Caddy est donc pris dans le dépôt officiel du projet (Cloudsmith), signé par la clé du projet
# INSCRITE ci-dessous (« Caddy Web Server », empreinte 6576 0C51 EDEA 2017 CEA2  CA15 155B 6D79 CA56 EA34, contrôlée
# par les essais) : couverte par la signature de l'éditeur sur ce script, elle n'est jamais téléchargée en confiance.
# Le paquet d'Ubuntu est écarté (priorité -1), celui du dépôt officiel l'emporte (1001), et les mises à jour de
# sécurité automatiques (unattended-upgrades) le suivent ; à chaque passage, une version plus récente déjà connue
# d'apt est installée. Réévalué à CHAQUE passage : un serveur installé avec le paquet d'Ubuntu passe au dépôt officiel
# à sa prochaine mise à jour, en gardant son Caddyfile (--force-confold). Clé changée par le projet Caddy : nouvelle
# publication de ce script (procédure : docs/conformite/SECURITE.md).
APT_ETC=/etc/apt
CADDY_DEPOT=https://dl.cloudsmith.io/public/caddy/stable/deb/debian
CADDY_EMPREINTE=65760C51EDEA2017CEA2CA15155B6D79CA56EA34
cle_caddy() { # clé publique de publication du projet Caddy (https://dl.cloudsmith.io/public/caddy/stable/gpg.key)
  cat <<'CLE_CADDY'
-----BEGIN PGP PUBLIC KEY BLOCK-----

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
=wl92
-----END PGP PUBLIC KEY BLOCK-----
CLE_CADDY
}
ecrire_si_different() { # <fichier> <contenu> : écrit (0644) seulement si le contenu change → 0 si écrit, 1 sinon
  if [[ -f "$1" && "$(cat "$1")" == "$2" ]]; then return 1; fi
  printf '%s\n' "$2" > "$1.nouveau"
  chmod 644 "$1.nouveau"
  mv "$1.nouveau" "$1"
}
version_caddy() { # → version du paquet caddy installé (vide sinon)
  local etat
  # shellcheck disable=SC2016 # format de dpkg-query, pas une variable du script
  etat="$(dpkg-query -W -f='${Status}|${Version}' caddy 2>/dev/null || true)"
  if [[ "$etat" == "install ok installed|"* ]]; then printf '%s' "${etat#*|}"; fi
}
depot_caddy() { # → 0 : Caddy du dépôt officiel en service ; 2 : paquet d'Ubuntu encore là (nouvel essai au prochain passage) ; 1 : pas de Caddy
  local change=0 avant apres candidat
  mkdir -p "$APT_ETC/keyrings" "$APT_ETC/sources.list.d" "$APT_ETC/preferences.d" "$APT_ETC/apt.conf.d"
  ecrire_si_different "$APT_ETC/keyrings/caddy-stable.asc" "$(cle_caddy)" && change=1
  ecrire_si_different "$APT_ETC/sources.list.d/caddy-stable.sources" "# Living Business (installer-jeu.sh) : Caddy depuis son dépôt officiel, clé inscrite dans le script signé
Types: deb
URIs: $CADDY_DEPOT
Suites: any-version
Components: main
Architectures: amd64
Signed-By: $APT_ETC/keyrings/caddy-stable.asc" && change=1
  ecrire_si_different "$APT_ETC/preferences.d/living-business-caddy" "Explanation: Living Business (installer-jeu.sh) : Caddy vient de son dépôt officiel
Package: caddy
Pin: origin dl.cloudsmith.io
Pin-Priority: 1001

Explanation: jamais le paquet caddy d'Ubuntu (universe, correctifs non garantis)
Package: caddy
Pin: release o=Ubuntu
Pin-Priority: -1" && change=1
  ecrire_si_different "$APT_ETC/apt.conf.d/52living-business-caddy" '// Living Business (installer-jeu.sh) : mises à jour de sécurité automatiques de Caddy, depuis son dépôt officiel
Unattended-Upgrade::Origins-Pattern {
	"origin=cloudsmith/caddy/stable,site=dl.cloudsmith.io";
};' && change=1
  rm -f "$APT_ETC/sources.list.d/caddy-stable.list" # ancienne forme du dépôt (clé non épinglée) : jamais deux sources
  avant="$(version_caddy)"
  if [[ $change -eq 1 || -z "$avant" || "$avant" == *ubuntu* ]]; then apt-get update -q || true; fi
  candidat="$(LC_ALL=C apt-cache policy caddy 2>/dev/null | awk '$1 == "Candidate:" { print $2; exit }')"
  if [[ -z "$avant" || "$avant" == *ubuntu* || ( -n "$candidat" && "$candidat" != "(none)" && "$candidat" != "$avant" ) ]]; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold caddy || true
  fi
  apres="$(version_caddy)"
  if [[ -z "$apres" ]]; then
    echo "Caddy n'a pas pu être installé depuis son dépôt officiel ($CADDY_DEPOT, clé $CADDY_EMPREINTE)." >&2; return 1
  fi
  if [[ "$apres" == *ubuntu* ]]; then
    echo "Attention : Caddy $apres (paquet d'Ubuntu, correctifs non garantis) reste en service : le dépôt officiel n'a pas répondu. Nouvel essai à la prochaine mise à jour." >&2
    return 2
  fi
  if [[ "$apres" != "$avant" ]]; then echo "Caddy $apres installé depuis son dépôt officiel."; fi
  return 0
}
# <<< dépôt officiel de Caddy
etape "Caddy (dépôt officiel du projet)"
CODE_CADDY=0
depot_caddy || CODE_CADDY=$?
[[ $CODE_CADDY -ne 1 ]] || erreur "Caddy introuvable : vérifiez l'accès à dl.cloudsmith.io, puis relancez (la version du jeu en service est inchangée)."

etape "HTTPS automatique (Caddy)"
if [[ -f /etc/caddy/Caddyfile ]] && ! grep -q "Living Business" /etc/caddy/Caddyfile && ! grep -q "^:80" /etc/caddy/Caddyfile; then
  erreur "/etc/caddy/Caddyfile a déjà été modifié pour autre chose : ajoutez-y à la main le bloc de $CONF/Caddyfile.exemple."
fi
# >>> configuration de Caddy (testée par scripts/installateur.test.ts)
# API d'administration de Caddy COUPÉE (« admin off ») : par défaut elle écoute sur 127.0.0.1:2019 sans mot de passe,
# et tout processus de la machine, le service Living Business compris malgré son isolement, pourrait y charger une
# autre configuration (publier les clés TLS de /var/lib/caddy, renvoyer le trafic ailleurs). Sans API, « systemctl
# reload caddy » ne marche plus : la configuration est appliquée par un redémarrage, fait seulement si elle a changé
# (ou si Caddy ne tourne pas). Après une modification à la main : sudo systemctl restart caddy
CADDYFILE=/etc/caddy/Caddyfile
contenu_caddyfile() { # <domaine> <port>
  cat <<X
# Living Business — géré par installer-jeu.sh (HTTPS Let's Encrypt renouvelé tout seul)
{
	# API d'administration coupée : rien ne peut reconfigurer Caddy depuis la machine (redémarrage seulement)
	admin off
}

$1 {
	encode zstd gzip
	request_body {
		max_size 100MB
	}
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		-Server
	}
	reverse_proxy 127.0.0.1:$2
}
X
}
appliquer_caddy() { # <domaine> <port> : écrit $CADDYFILE ; redémarre Caddy si la configuration a changé ou s'il est arrêté
  local avant nouveau
  avant="$(cat "$CADDYFILE" 2>/dev/null || true)"
  nouveau="$(contenu_caddyfile "$1" "$2")"
  printf '%s\n' "$nouveau" > "$CADDYFILE.nouveau"
  mv "$CADDYFILE.nouveau" "$CADDYFILE"
  systemctl enable caddy >/dev/null 2>&1
  if [[ "$avant" != "$nouveau" ]] || ! systemctl is-active --quiet caddy; then systemctl restart caddy; fi
}
# <<< configuration de Caddy
appliquer_caddy "$DOMAINE" "$PORT"
cp "$CADDYFILE" "$CONF/Caddyfile.exemple"

# ------------------------------------------------------------------ 6. copie chiffrée hors du serveur (facultatif)
# >>> copie hors site (testée par scripts/installateur.test.ts)
# Service réécrit à CHAQUE passage (mise à jour comprise) dès que la copie est configurée : chaque nuit, envoi des
# sauvegardes récentes, puis effacement dans le stockage distant des copies de plus de $CONSERVATION_HORS_SITE jours
# (même durée que sur ce serveur : une personne effacée ne reste pas indéfiniment dans les copies). Jamais
# d'effacement si aucune copie récente n'est arrivée (panne du jeu ou de l'envoi) : les dernières copies restent.
# Stockage verrouillé ($CONF/copie-verrouillee : versionnage + Object Lock + clé sans droit d'effacement) : ce serveur
# n'efface rien, c'est la règle de cycle de vie du conteneur qui retire les copies de plus de $CONSERVATION_HORS_SITE jours.
# rclone ne tourne pas en root : utilisateur éphémère (DynamicUser), seul droit gardé = LIRE les fichiers
# (CAP_DAC_READ_SEARCH), et il ne voit de /var que les sauvegardes ; clé des secrets du jeu, identifiants systemd,
# clés SSH et TLS lui sont masqués ; aucune écriture possible sur le disque.
ecrire_copie_hors_site() { # → unités systemd de la copie chiffrée (si $CONF/rclone.env existe)
  [[ -f "$CONF/rclone.env" ]] || return 0
  local purge="ExecStartPost=/bin/sh -c '/usr/bin/rclone lsf chiffre: --files-only --max-age 72h | grep -q . && /usr/bin/rclone delete chiffre: --min-age ${CONSERVATION_HORS_SITE}d'"
  local description="gardées $CONSERVATION_HORS_SITE jours hors du serveur"
  if [[ -f "$CONF/copie-verrouillee" ]]; then
    purge="# stockage verrouillé : effacement par la règle de cycle de vie du conteneur ($CONSERVATION_HORS_SITE jours), jamais par ce serveur"
    description="stockage verrouillé, $CONSERVATION_HORS_SITE jours"
  fi
  cat > "$UNITES/living-business-sauvegarde.service" <<X
[Unit]
Description=Copie chiffrée des sauvegardes Living Business ($description)
[Service]
Type=oneshot
EnvironmentFile=$CONF/rclone.env
ExecStart=/usr/bin/rclone copy $DONNEES/sauvegardes chiffre: --max-age 72h
$purge
DynamicUser=yes
AmbientCapabilities=CAP_DAC_READ_SEARCH
CapabilityBoundingSet=CAP_DAC_READ_SEARCH
TemporaryFileSystem=/var:ro
BindReadOnlyPaths=-$DONNEES/sauvegardes
InaccessiblePaths=-$CONF/cle-secrets -$CONF/cle-secrets.cred -/run/credentials -/etc/credstore -/etc/credstore.encrypted -/etc/ssh -/etc/ssl/private -/etc/shadow -/etc/gshadow -/etc/sudoers -/etc/sudoers.d -/opt -/srv
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
NoNewPrivileges=yes
UMask=0077
ProtectProc=invisible
ProcSubset=pid
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictNamespaces=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallFilter=~@privileged
SystemCallErrorNumber=EPERM
X
  cat > "$UNITES/living-business-sauvegarde.timer" <<X
[Unit]
Description=Copie chiffrée chaque nuit
[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true
[Install]
WantedBy=timers.target
X
  systemctl daemon-reload
  systemctl enable --now living-business-sauvegarde.timer >/dev/null 2>&1
}
# Identifiants S3 et phrase de chiffrement : il faut bien les garder ici pour chiffrer et envoyer chaque nuit, donc un
# attaquant devenu root les lit. Ce qui protège les copies d'un rançongiciel, c'est le stockage lui-même (conteneur
# versionné et verrouillé, clé sans droit d'effacement). La phrase passe par l'entrée standard de rclone, jamais en
# argument (visible dans la liste des processus) ; le fichier n'est lisible que par root.
ecrire_rclone_env() { # <adresse S3> <région> <conteneur> <clé d'accès> <clé secrète> <phrase> → $CONF/rclone.env
  local mdp=""
  if ! mdp="$(printf '%s\n' "$6" | rclone obscure -)" || [[ -z "$mdp" ]]; then
    echo "rclone obscure a échoué : copie hors site non configurée." >&2; return 1
  fi
  (umask 077; cat > "$CONF/rclone.env.nouveau" <<X
RCLONE_CONFIG_S3_TYPE=s3
RCLONE_CONFIG_S3_PROVIDER=Other
RCLONE_CONFIG_S3_ENDPOINT=$1
RCLONE_CONFIG_S3_REGION=$2
RCLONE_CONFIG_S3_ACCESS_KEY_ID=$4
RCLONE_CONFIG_S3_SECRET_ACCESS_KEY=$5
RCLONE_CONFIG_CHIFFRE_TYPE=crypt
RCLONE_CONFIG_CHIFFRE_REMOTE=s3:$3/living-business
RCLONE_CONFIG_CHIFFRE_PASSWORD=$mdp
X
  )
  chmod 600 "$CONF/rclone.env.nouveau"
  mv "$CONF/rclone.env.nouveau" "$CONF/rclone.env"
}
# <<< copie hors site
if [[ ! -f "$CONF/sauvegarde-externe" && -t 0 ]]; then
  etape "Sauvegarde hors du serveur (facultatif)"
  echo "Le jeu garde déjà 30 jours de sauvegardes sur ce serveur. Pour une copie chiffrée chaque nuit dans un"
  echo "stockage S3 à votre nom (OVH Object Storage, Scaleway…), répondez o."
  echo
  echo "Recommandé, contre un rançongiciel qui prendrait ce serveur : créez le conteneur avec le VERSIONNAGE et le"
  echo "VERROUILLAGE DES OBJETS (Object Lock, mode conformité, rétention de $CONSERVATION_HORS_SITE jours), une règle de cycle de"
  echo "vie qui supprime les versions de plus de $CONSERVATION_HORS_SITE jours, et une clé d'accès SANS droit d'effacement"
  echo "(lecture et écriture seulement). Même maître de ce serveur, un attaquant ne pourra pas effacer les copies."
  echo "Sinon, ce serveur efface lui-même les copies de plus de $CONSERVATION_HORS_SITE jours (même durée que sur ce serveur)."
  read -r -p "Configurer maintenant ? (o/N) " REP
  if [[ "${REP:-n}" =~ ^[oO]$ ]]; then
    read -r -p "Adresse S3 (ex. https://s3.sbg.io.cloud.ovh.net) : " S3; [[ "$S3" =~ ^https://[a-z0-9.-]+$ ]] || erreur "Adresse S3 invalide."
    read -r -p "Région (ex. sbg) : " REGION; [[ "$REGION" =~ ^[a-z0-9-]{1,40}$ ]] || erreur "Région invalide."
    read -r -p "Nom du conteneur : " SEAU; [[ "$SEAU" =~ ^[a-z0-9][a-z0-9.-]{2,62}$ ]] || erreur "Nom invalide."
    read -r -p "Clé d'accès : " CLE; [[ "$CLE" =~ ^[A-Za-z0-9._/+=-]{8,256}$ ]] || erreur "Clé d'accès invalide."
    read -r -s -p "Clé secrète (masquée) : " SECRET; echo; [[ "$SECRET" =~ ^[A-Za-z0-9._/+=-]{8,256}$ ]] || erreur "Clé secrète invalide."
    read -r -p "Conteneur versionné et verrouillé (Object Lock), clé sans droit d'effacement ? (o/N) " VERROU
    PHRASE="$(head -c 32 /dev/urandom | base64 | tr -d '/+=' | head -c 40)"
    ecrire_rclone_env "$S3" "$REGION" "$SEAU" "$CLE" "$SECRET" "$PHRASE" || erreur "Copie hors site non configurée."
    if [[ "${VERROU:-n}" =~ ^[oO]$ ]]; then
      touch "$CONF/copie-verrouillee"
      echo "Stockage verrouillé : ce serveur n'effacera rien ; vérifiez la règle de cycle de vie ($CONSERVATION_HORS_SITE jours) chez l'hébergeur."
    else
      rm -f "$CONF/copie-verrouillee"
      echo "Attention : avec une clé qui peut effacer, un attaquant maître de ce serveur peut aussi effacer les copies." >&2
      echo "Plus tard : conteneur verrouillé, nouvelle clé, puis sudo touch $CONF/copie-verrouillee et sudo living-business-mise-a-jour" >&2
    fi
    echo "================================================================================"
    echo " PHRASE DE CHIFFREMENT DES COPIES : à garder dans votre gestionnaire de mots de passe."
    echo " Sans elle, les copies sont illisibles. Elle ne sera plus affichée :  $PHRASE"
    echo "================================================================================"
    read -r -p "Recopiée ? (Entrée) " _
  fi
  touch "$CONF/sauvegarde-externe"
fi
ecrire_copie_hors_site

# ------------------------------------------------------------------ 7. vérification et lien d'installation
etape "Vérification"
for _ in $(seq 1 30); do
  curl -fsS "http://127.0.0.1:$PORT/api/v1/vivant" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/api/v1/vivant" >/dev/null 2>&1 || erreur "Le jeu ne répond pas. Journal : sudo journalctl -u living-business -n 50"
retirer_cle_des_donnees
CODE=""
for _ in $(seq 1 10); do
  if [[ -f "$DONNEES/installation.txt" ]]; then CODE="$(tr -d '[:space:]' < "$DONNEES/installation.txt")"; break; fi
  sleep 1
done
etape "Living Business est en ligne : https://$DOMAINE"
if [[ "$CODE" =~ ^[A-Za-z0-9_-]{43}$ ]]; then
  echo "Créez votre compte administrateur (ou restaurez la sauvegarde exportée de votre ordinateur) :"
  echo
  echo "   https://$DOMAINE/installation#$CODE"
  echo
  echo "Ce lien est personnel et ne sert qu'une fois. Ensuite, activez la validation en deux étapes (demandée d'office)."
else
  echo "Déjà installé : ouvrez https://$DOMAINE et connectez-vous."
fi
echo "Mot de passe et code de secours perdus : sudo living-business-secours"
echo "Mise à jour (signature de l'éditeur vérifiée avant exécution) : sudo living-business-mise-a-jour"
if [[ "$MAJ_AUTO" == oui ]]; then echo "Mises à jour automatiques : chaque nuit (sudo living-business-mise-a-jour-auto non pour les arrêter)."
else echo "Mises à jour automatiques : désactivées. Pensez à lancer la mise à jour (ou : sudo living-business-mise-a-jour-auto oui)."
fi
