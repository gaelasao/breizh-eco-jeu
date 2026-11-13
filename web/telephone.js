// « Mettre en ligne » (direction de design §6.1 P9) : page ouverte sur le téléphone par le QR code de l'assistant.
// Elle renvoie le jeton du fragment (#…) à Living Business ; l'ordinateur affiche alors « répond bien sur votre
// téléphone ». Aucune session, aucune donnée de l'entreprise : la réponse n'est que « reçu ».
import { typo } from '/bz/typo.js';

const zone = document.getElementById('verification');
const jeton = location.hash.slice(1);
history.replaceState(null, '', location.pathname); // le jeton ne reste ni dans l'historique ni dans un favori

function afficher(titre, texte, ok) {
  const h1 = document.createElement('h1');
  h1.textContent = typo(titre);
  const p = document.createElement('p');
  p.textContent = typo(texte);
  zone.querySelector('h1')?.remove();
  zone.querySelectorAll('p:not(.surtitre)').forEach((n) => n.remove());
  zone.append(h1, p);
  if (ok) {
    const a = document.createElement('a');
    a.className = 'bouton';
    a.href = '/';
    a.textContent = typo('Ouvrir Living Business');
    zone.append(a);
  }
}

async function verifier() {
  if (!/^[A-Za-z0-9_-]{22}$/.test(jeton)) { afficher('Lien incomplet', 'Scannez de nouveau le QR code affiché sur l’ordinateur.', false); return; }
  try {
    const r = await fetch(`/api/public/telephone/${jeton}`, { method: 'POST', headers: { 'x-lb-requete': '1' }, credentials: 'omit' });
    if (r.ok) afficher('Ce téléphone joint bien Living Business', 'Revenez sur l’ordinateur : l’assistant a reçu la réponse. Vous pouvez ajouter Living Business à l’écran d’accueil.', true);
    else afficher('Ce lien a expiré', 'Relancez la vérification depuis l’ordinateur (Réglages › Mettre en ligne).', false);
  } catch {
    afficher('Living Business ne répond pas', 'Vérifiez que ce téléphone est sur le même réseau ou que Tailscale est allumé, puis rescannez le QR code.', false);
  }
}
verifier();
