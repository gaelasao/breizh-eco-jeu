/**
 * Pont MCP « stdio » pour Claude Desktop (ou tout client MCP local) vers le serveur Living Business.
 * Chaque ligne JSON-RPC reçue sur l'entrée standard est envoyée à LB_URL/mcp avec la clé d'API LB_CLE, et chaque
 * requête reçoit une réponse JSON-RPC sur la sortie standard (voir pont.ts : les deux ères du protocole, les erreurs).
 *
 * claude_desktop_config.json :
 *   { "mcpServers": { "living-business": { "command": "node",
 *       "args": ["/chemin/vers/Living Business/app/src/mcp/pont-stdio.ts"],
 *       "env": { "LB_URL": "http://127.0.0.1:4173", "LB_CLE": "lb_…" } } } }
 * Dans un paquet installé, ce fichier est dans <dossier de Living Business>/app/src/mcp/ ; sans Node.js sur le poste,
 * la commande est <dossier>/app/node (app\node.exe sous Windows). Depuis les sources : <dépôt>/src/mcp/pont-stdio.ts.
 */
import { createInterface } from 'node:readline';
import { creerPont } from './pont.ts';

const url = `${(process.env.LB_URL ?? 'http://127.0.0.1:4173').replace(/\/$/, '')}/mcp`;
const cle = process.env.LB_CLE ?? '';
if (!/^lb_[A-Za-z0-9_-]{43}$/.test(cle)) {
  process.stderr.write('LB_CLE manquante ou invalide : créez une clé dans Living Business → Réglages → Clés d’API.\n');
  process.exit(1);
}

const pont = creerPont({
  url, cle,
  ecrire: (ligne) => { process.stdout.write(`${ligne}\n`); },
  journal: (texte) => { process.stderr.write(`[pont MCP] ${texte}\n`); },
});
createInterface({ input: process.stdin }).on('line', (ligne) => { void pont.ligne(ligne); });
