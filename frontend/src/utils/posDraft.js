// localStorage, not sessionStorage: a cashier's unsaved invoice must survive
// closing the browser (or the computer being switched off) and still be
// there whenever POS is next opened, not just an in-tab route change. The
// trade-off is that two POS tabs open at once for the same user share one
// draft slot per context and the last write wins -- acceptable since that's
// not a normal way to use the POS.
const memory = new Map();
export function draftKey(userId, context = 'new') { return `pos:draft:${userId}:${context}`; }
export function readDraft(key, storage = globalThis.localStorage) {
  try {
    const value = JSON.parse(storage.getItem(key) || 'null');
    if (value?.version === 1 && Array.isArray(value.lines)) { memory.set(key, value); return value; }
  } catch { /* Memory still preserves route navigation when storage is unavailable. */ }
  return memory.get(key) || null;
}
export function writeDraft(key, draft, storage = globalThis.localStorage) {
  const value = { ...draft, version: 1 };
  memory.set(key, value);
  try { storage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
export function clearDraft(key, storage = globalThis.localStorage) {
  memory.delete(key);
  try { storage.removeItem(key); } catch { /* Storage can be disabled. */ }
}

// A draft is worth keeping/resuming once the cashier has actually typed
// something into it -- an untouched blank form is not a draft. Shared by
// POSPage (decides whether to write vs clear on every change) and the
// Sales Invoice list (decides whether to jump straight back into it instead
// of showing the list), so the two can never disagree about what counts.
export function isDraftMeaningful(draft) {
  if (!draft) return false;
  return !!(
    draft.customer ||
    draft.lines?.length ||
    draft.customerQuery ||
    draft.enteredCustomer?.name ||
    draft.enteredCustomer?.phone ||
    draft.paidAmount ||
    Number(draft.discount) ||
    draft.notes
  );
}
