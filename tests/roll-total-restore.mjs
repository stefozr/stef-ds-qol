import assert from "node:assert/strict";
import { missingTotals } from "../scripts/fixes/roll-total-restore.mjs";

/** Minimal fake: a roll row whose inline result holds the given classes. */
const row = (...classes) => ({
  querySelector: sel => (sel === ".inline-result"
    ? { querySelector: s => (classes.includes(s.slice(1)) ? {} : null) }
    : null),
});

// The Bleeding card: formula only (Combat Tools removed the apply button = the total).
const bleed = row("dice-formula");
assert.deepEqual(missingTotals([bleed], [5]), [{ row: bleed, total: 5 }]);
// A roll that still has its total (button or h4) is left alone.
assert.deepEqual(missingTotals([row("dice-formula", "dice-total")], [5]), []);
// After the restore the row has a total: a second pass adds nothing.
assert.deepEqual(missingTotals([row("dice-formula", "dice-total")], [5]), []);
// Non-finite totals and rows without a formula are skipped.
assert.deepEqual(missingTotals([bleed], [undefined]), []);
assert.deepEqual(missingTotals([bleed], [Number.NaN]), []);
assert.deepEqual(missingTotals([row()], [5]), []);
// Index pairing: second row gets the second total.
const a = row("dice-formula", "dice-total"), b = row("dice-formula");
assert.deepEqual(missingTotals([a, b], [7, 3]), [{ row: b, total: 3 }]);
assert.deepEqual(missingTotals(null, [1]), []);

console.log("roll-total-restore: all assertions passed");
