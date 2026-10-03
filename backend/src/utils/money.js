// All money is stored in the database as integer cents to avoid floating-point
// accounting errors. These helpers convert between the "dollars" a human types
// into a form and the integer cents persisted in Mongo.

export function toCents(value) {
  const n = Number(value);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}

export function fromCents(cents) {
  return Math.round(Number(cents) || 0) / 100;
}

export function addCents(...values) {
  return values.reduce((sum, v) => sum + (Number(v) || 0), 0);
}
