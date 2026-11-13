/**
 * Dialogues web/bz/dialogue.js (constat coherence-9) : dans un formulaire method="dialog", la touche Entrée dans un
 * champ active le PREMIER bouton submit (soumission implicite, règle HTML). Le « Fermer » de l'en-tête et « Annuler »
 * doivent donc être des type="button" (fermeture par [data-ferme]), sinon Entrée dans demander() ferme le dialogue
 * sans rien valider (« Enregistrer cette vue » perdu). Petit DOM simulé : aucune dépendance.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

class FauxNoeud {
  parent: FauxElement | null = null;
  enfants: FauxNoeud[] = [];
  texte = '';
  get textContent(): string { return this.texte + this.enfants.map((e) => e.textContent).join(''); }
  set textContent(v: string) { this.texte = v; this.enfants = []; }
}

class FauxElement extends FauxNoeud {
  tagName: string;
  attributs = new Map<string, string>();
  ecouteurs = new Map<string, ((e: unknown) => void)[]>();
  open = false;
  returnValue = '';
  value = '';
  dataset: Record<string, string> = {};
  constructor(balise: string) { super(); this.tagName = balise.toUpperCase(); }
  set className(v: string) { this.attributs.set('class', v); }
  get className(): string { return this.attributs.get('class') ?? ''; }
  get id(): string { return this.attributs.get('id') ?? ''; }
  get isConnected(): boolean { return true; }
  setAttribute(k: string, v: string) { this.attributs.set(k, v); if (k === 'value') this.value = v; }
  getAttribute(k: string) { return this.attributs.get(k) ?? null; }
  hasAttribute(k: string) { return this.attributs.has(k); }
  removeAttribute(k: string) { this.attributs.delete(k); }
  append(...n: FauxNoeud[]) { for (const x of n) { x.parent = this; this.enfants.push(x); } }
  remove() { if (this.parent) this.parent.enfants = this.parent.enfants.filter((x) => x !== this); }
  addEventListener(t: string, f: (e: unknown) => void) { this.ecouteurs.set(t, [...(this.ecouteurs.get(t) ?? []), f]); }
  emettre(t: string, e: unknown = {}) { for (const f of this.ecouteurs.get(t) ?? []) f(e); }
  querySelector(): null { return null; }
  closest(sel: string): FauxElement | null {
    const attr = /^\[([a-z-]+)\]$/.exec(sel)?.[1];
    for (let n: FauxElement | null = this; n; n = n.parent) {
      if (attr ? n.attributs.has(attr) : n.tagName === sel.toUpperCase()) return n;
    }
    return null;
  }
  focus() { /* sans effet */ }
  matches() { return true; }
  showModal() { this.open = true; }
  close(v = '') { if (!this.open) return; this.open = false; this.returnValue = v; this.emettre('close'); }
  getBoundingClientRect() { return { left: 0, right: 0, top: 0, bottom: 0 }; }
  /** Éléments du sous-arbre, dans l'ordre du document. */
  *parcourir(): Generator<FauxElement> {
    for (const e of this.enfants) if (e instanceof FauxElement) { yield e; yield* e.parcourir(); }
  }
}

const ecouteursDocument = new Map<string, ((e: unknown) => void)[]>();
const corps = new FauxElement('body');
const g = globalThis as Record<string, unknown>;
g.Node = FauxNoeud;
g.Element = FauxElement;
g.HTMLElement = FauxElement;
g.HTMLDialogElement = FauxElement;
g.CSS = { escape: (s: string) => s };
g.window = { matchMedia: () => ({ matches: false }) };
g.document = {
  body: corps,
  activeElement: corps,
  documentElement: new FauxElement('html'),
  createElement: (b: string) => new FauxElement(b),
  createElementNS: (_ns: string, b: string) => new FauxElement(b),
  createTextNode: (t: string) => { const n = new FauxNoeud(); n.texte = t; return n; },
  addEventListener: (t: string, f: (e: unknown) => void) => ecouteursDocument.set(t, [...(ecouteursDocument.get(t) ?? []), f]),
  querySelectorAll: () => [],
  querySelector: () => null,
  getElementById: () => null,
};

const { demander } = await import(new URL('../../web/bz/dialogue.js', import.meta.url).href);

const dernierDialogue = () => corps.enfants.filter((e): e is FauxElement => e instanceof FauxElement && e.tagName === 'DIALOG').at(-1) as FauxElement;
const typeDe = (b: FauxElement) => b.getAttribute('type') ?? 'submit'; // <button> sans type = submit
/** Touche Entrée dans le champ : le premier bouton submit du formulaire est activé, method="dialog" ferme avec sa valeur. */
function appuyerEntree(d: FauxElement) {
  const form = [...d.parcourir()].find((e) => e.tagName === 'FORM') as FauxElement;
  assert.equal(form.getAttribute('method'), 'dialog');
  const parDefaut = [...form.parcourir()].find((e) => e.tagName === 'BUTTON' && typeDe(e) === 'submit');
  assert.ok(parDefaut, 'un bouton submit dans le dialogue');
  d.close(parDefaut.value);
}

test('demander() : Entrée dans le champ VALIDE la saisie (le premier bouton submit est « Valider »)', async () => {
  const p = demander({ titre: 'Enregistrer cette vue', libelle: 'Nom de la vue', valider: 'Enregistrer' });
  const d = dernierDialogue();
  const champ = [...d.parcourir()].find((e) => e.tagName === 'INPUT') as FauxElement;
  champ.value = 'Chantiers en retard';
  appuyerEntree(d);
  assert.equal(await p, 'Chantiers en retard');
});

test('demander() : « Fermer » (en-tête) et « Annuler » ferment sans valider, par [data-ferme]', async () => {
  for (const libelle of ['Fermer', 'Annuler']) {
    const p = demander({ titre: 'Renommer', libelle: 'Nom' });
    const d = dernierDialogue();
    const bouton = [...d.parcourir()].find((e) => e.tagName === 'BUTTON' && (e.getAttribute('aria-label') === libelle || e.textContent === libelle)) as FauxElement;
    assert.ok(bouton, libelle);
    assert.equal(typeDe(bouton), 'button', `${libelle} n'est pas un bouton submit (sinon il capte la touche Entrée)`);
    assert.ok(bouton.hasAttribute('data-ferme'));
    for (const f of ecouteursDocument.get('click') ?? []) f({ target: bouton, preventDefault() {} });
    assert.equal(await p, null, `${libelle} annule`);
  }
});
