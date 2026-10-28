// How many saves/edits are in flight right now, and what the latest one is
// doing ("Saving payment…"), for the BusyOverlay. The API client counts every
// POST/PUT/PATCH/DELETE in and out.
let count = 0;
let label = 'Saving…';
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn(count, label));

export function beginBusy(text = 'Saving…') {
  count += 1;
  label = text;
  emit();
}

export function endBusy() {
  count = Math.max(0, count - 1);
  emit();
}

export function subscribeBusy(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
