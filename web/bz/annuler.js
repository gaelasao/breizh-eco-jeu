// Breizhcosystem — « Annuler plutôt que confirmer » (direction de design P4, §4.16).
// - Pile d'annulation globale avec libellés (⌘Z / Ctrl+Z, ⇧⌘Z / Ctrl+Y pour rétablir), valable 30 minutes.
// - Action réversible : toast « Client archivé. · Annuler ».
// - Message à un tiers : envoi différé de 10 s (--bz-d-envoi), annulable, compte à rebours en pause avec le toast.
import { annoncer } from './dialogue.js';
import { toast } from './toasts.js';

const VALIDITE_MS = 30 * 60_000;
const JOURNAL_MAX = 60;
const pile = [];
const retablir = [];
const notes = [];
const abonnes = new Set();

const notifier = () => { for (const f of abonnes) { try { f(historique()); } catch { /* abonné défaillant ignoré */ } } };
const purger = () => { const limite = Date.now() - VALIDITE_MS; while (pile.length && (pile[0]?.le ?? 0) < limite) pile.shift(); };

/** Délai d'annulation d'un message à un tiers, lu dans les jetons (10 s par défaut). */
export function delaiEnvoi() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--bz-d-envoi').trim();
  const m = /^([\d.]+)(ms|s)$/.exec(v);
  return m ? Number(m[1]) * (m[2] === 's' ? 1000 : 1) : 10_000;
}

/** Enregistre une action déjà faite et la façon de la défaire. enregistrer({ libelle: 'archivage de Kerlann Bois', annuler, refaire }) */
export function enregistrer({ libelle, annuler, refaire = null }) {
  purger();
  const e = { libelle, annuler, refaire, le: Date.now() };
  pile.push(e);
  retablir.length = 0;
  notifier();
  return e;
}

/** Action réversible annoncée par un toast « Annuler » : actionAnnulable({ texte: 'Client archivé.', libelle, annuler }) */
export function actionAnnulable({ texte, libelle = texte, annuler, refaire = null }) {
  const e = enregistrer({ libelle, annuler, refaire });
  toast({ texte, ton: 'ok', action: { libelle: 'Annuler', faire: () => { void annulerEntree(e); } } });
  return e;
}

async function annulerEntree(e) {
  const i = pile.indexOf(e);
  if (i < 0) return false;
  pile.splice(i, 1);
  try {
    await e.annuler();
    if (e.refaire) retablir.push(e);
    annoncer(`Annulé : ${e.libelle}`);
    return true;
  } catch (err) {
    toast({ texte: `Impossible d’annuler : ${err instanceof Error ? err.message : String(err)}`, ton: 'critique' });
    return false;
  } finally {
    notifier();
  }
}

/** ⌘Z : annule la dernière action encore valable. */
export async function annulerDerniere() {
  purger();
  const e = pile.at(-1);
  if (!e) { annoncer('Rien à annuler.'); return false; }
  return annulerEntree(e);
}

/** ⇧⌘Z : refait la dernière action annulée. */
export async function retablirDerniere() {
  const e = retablir.pop();
  if (!e?.refaire) { annoncer('Rien à rétablir.'); return false; }
  try { await e.refaire(); pile.push({ ...e, le: Date.now() }); annoncer(`Rétabli : ${e.libelle}`); return true; } catch (err) {
    toast({ texte: `Impossible de rétablir : ${err instanceof Error ? err.message : String(err)}`, ton: 'critique' });
    return false;
  } finally { notifier(); }
}

/** Actions encore annulables (Activité récente), la plus récente d'abord. */
export function historique() {
  purger();
  return pile.slice().reverse().map((e) => ({ libelle: e.libelle, le: e.le, annuler: () => annulerEntree(e) }));
}
export function surHistorique(f) { abonnes.add(f); return () => abonnes.delete(f); }

/**
 * Journal de l'activité récente de cette session (Activité récente, §4.16) : ce qui s'est passé, avec l'heure.
 * noter({ texte: 'Import terminé : 12 clients.', ton: 'ok' }). Un toast n'est jamais le seul porteur d'un retour.
 */
export function noter({ texte, ton = 'info' } = {}) {
  if (!texte) return;
  notes.push({ texte: String(texte), ton, le: Date.now() });
  if (notes.length > JOURNAL_MAX) notes.splice(0, notes.length - JOURNAL_MAX);
  notifier();
}
/** Entrées du journal, la plus récente d'abord. */
export function journal() { return notes.slice().reverse(); }

/**
 * Envoi différé d'un message à un tiers (relance, devis, réponse), sans dialogue :
 * differer({ texte: 'Envoi de la relance à Kerlann Bois dans 10 s.', fait: 'Relance envoyée à Kerlann Bois.', envoyer })
 * Retourne { annuler() }. Le toast en pause (survol, focus) suspend le compte à rebours ; fermé, l'envoi part à l'échéance.
 */
export function differer({ texte, fait = null, annule = 'Envoi annulé.', envoyer, delai = delaiEnvoi() }) {
  let etat = 'attente';
  let secours = null;
  const partir = async () => {
    if (etat !== 'attente') return;
    etat = 'envoi';
    try { await envoyer(); etat = 'envoye'; if (fait) toast({ texte: fait, ton: 'ok' }); } catch (err) {
      etat = 'echec';
      toast({ texte: err instanceof Error ? err.message : String(err), ton: 'critique' });
    }
  };
  const t = toast({
    texte, ton: 'info', duree: delai,
    action: { libelle: 'Annuler', faire: () => { if (etat === 'attente') { etat = 'annule'; annoncer(annule); } } },
    surFin: (raison, reste) => {
      if (raison === 'delai') void partir();
      else if (raison === 'fermeture' && etat === 'attente') secours = setTimeout(() => void partir(), reste);
    },
  });
  return { annuler: () => { if (etat === 'attente') { etat = 'annule'; clearTimeout(secours); t.fermer(); annoncer(annule); return true; } return false; } };
}
