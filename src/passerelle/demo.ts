/** `npm run demo` : démonstration jetable (en mémoire, profils fictifs, sans mot de passe). */
process.env.LB_CONNEXION = 'demo';
process.env.LB_DONNEES ??= 'memoire';
process.env.EXEMPLE ??= 'eti';
await import('./serveur.ts');
