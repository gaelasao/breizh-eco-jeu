import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contactEditeur, TELEPHONE_EDITEUR } from './editeur.ts';

test('encart de l’éditeur : rien tant que le numéro n’est pas rempli, jamais un numéro illisible', () => {
  assert.equal(TELEPHONE_EDITEUR === '' ? contactEditeur({}) : null, null, 'numéro vide : pas d’encart');
  assert.deepEqual(contactEditeur({ LB_CONTACT_TELEPHONE: ' 02 98 00 00 00 ' }), { telephone: '02 98 00 00 00', lien: 'tel:0298000000' });
  assert.deepEqual(contactEditeur({ LB_CONTACT_TELEPHONE: '+33 2 98 00 00 00' }), { telephone: '+33 2 98 00 00 00', lien: 'tel:+33298000000' });
  for (const faux of ['', 'appelez-nous', '02', 'javascript:alert(1)', '02 98 00 00 00 <b>', '0'.repeat(40)]) assert.equal(contactEditeur({ LB_CONTACT_TELEPHONE: faux }), null, faux);
});
