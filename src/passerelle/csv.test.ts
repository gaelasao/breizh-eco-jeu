import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertir, detecterSeparateur, parserCsv, proposerMapping } from './csv.ts';
import type { DefChamp, DefType } from '../core/univers.ts';

test('CSV Excel français : « ; », BOM, guillemets, retours ligne dans un champ', () => {
  const t = '﻿nom;note\r\n"Dupont ""fils""";"ligne1\nligne2"\r\n\r\nMartin;ok';
  assert.equal(detecterSeparateur('a;b;c'), ';');
  assert.deepEqual(parserCsv(t), [['nom', 'note'], ['Dupont "fils"', 'ligne1\nligne2'], ['Martin', 'ok']]);
});

test('CSV : limites de taille', () => {
  assert.throws(() => parserCsv('x'.repeat(1_000_001)), RangeError);
});

const champ = (type: DefChamp['type'], extra: Partial<DefChamp> = {}): DefChamp => ({ id: 'c', libelle: 'C', type, ...extra });

test('conversions : nombres français, dates JJ/MM/AAAA, oui/non, choix', () => {
  assert.deepEqual(convertir('1 234,5 €', champ('montant')), { ok: true, valeur: 1234.5 });
  assert.equal(convertir('abc', champ('nombre')).ok, false);
  assert.deepEqual(convertir('09/11/2026', champ('date')), { ok: true, valeur: '2026-11-09' });
  assert.equal(convertir('31/02/2026', champ('date')).ok, false);
  assert.deepEqual(convertir('Oui', champ('booleen')), { ok: true, valeur: true });
  assert.deepEqual(convertir('livree', champ('choix', { choix: ['en cours', 'livrée'] })), { ok: true, valeur: 'livrée' });
  assert.deepEqual(convertir('  ', champ('texte')), { ok: true, valeur: null });
});

test('correspondance proposée par libellé, sans doublon', () => {
  const t: DefType = {
    id: 'article', famille: 'ressource', libelle: 'Article', pluriel: 'Articles',
    champs: [champ('nombre', { id: 'quantite', libelle: 'Quantité' }), champ('nombre', { id: 'seuil_alerte', libelle: "Seuil d'alerte" })],
  };
  assert.deepEqual(proposerMapping(['Désignation', 'Quantité', 'Seuil d’alerte', 'Couleur'], t), {
    'Désignation': '__nom',
    'Quantité': 'quantite',
    'Seuil d’alerte': 'seuil_alerte',
    Couleur: null,
  });
});

import { telechargerSheets, validerLienSheets } from './connecteurs.ts';

test('Sheets : lien publié CSV accepté, redirection hors Google refusée', async () => {
  const v = validerLienSheets('https://docs.google.com/spreadsheets/d/e/2PACX-abc/pub?output=csv');
  assert.ok(v.ok);
  if (!v.ok) return;
  const vers = (location: string) => (async () => new Response(null, { status: 302, headers: { location } })) as unknown as typeof fetch;
  await assert.rejects(telechargerSheets(v.url, vers('https://evil.example/x.csv')), /non autorisé/);
  let appels = 0;
  const ok = (async () => (appels++ === 0
    ? new Response(null, { status: 307, headers: { location: 'https://doc-0s-sheets.googleusercontent.com/pub/x' } })
    : new Response('nom;ville\nA;B\n', { status: 200 }))) as unknown as typeof fetch;
  assert.equal(await telechargerSheets(v.url, ok), 'nom;ville\nA;B\n');
  const html = (async () => new Response('<!DOCTYPE html><html>', { status: 200 })) as unknown as typeof fetch;
  await assert.rejects(telechargerSheets(v.url, html), /pas publiée/);
});
