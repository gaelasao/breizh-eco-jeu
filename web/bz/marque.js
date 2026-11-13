// Breizhcosystem — noms de la marque et des produits (le réseau porte le nom de la marque) (direction de design §2.1).
// Identique dans le jeu et sur le réseau Breizhcosystem : si un nom change, seule cette constante change.
export const MARQUE = Object.freeze({
  mere: 'Breizhcosystem',
  jeu: 'Living Business',
  reseau: 'Breizhcosystem',
  offre: 'Breizhcosystem ACTIVE',
  endossement: (produit) => (produit === 'Breizhcosystem' ? produit : `${produit} par Breizhcosystem`),
});
