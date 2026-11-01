import assert from "node:assert/strict";
import {
  ATTITUDES, addEntry, applyAttitude, availableMotivations, defaultNegotiationState, negotiationStatus,
  normalizeNegotiation, patchEntry, removeEntry, resetValue, stateFromNpc, stepValue,
} from "../scripts/fixes/negotiation-tracker.mjs";

const fresh = { ...defaultNegotiationState(), active: true };

// Attitudes set interest and patience (value and starting value).
assert.equal(Object.keys(ATTITUDES).length, 6);
let s = applyAttitude(fresh, "suspicious");
assert.equal(s.attitude, "suspicious");
assert.deepEqual([s.interest.value, s.patience.value, s.interest.base, s.patience.base], [2, 2, 2, 2]);
assert.deepEqual([applyAttitude(fresh, "trusting").patience.value, applyAttitude(fresh, "hostile").interest.value], [5, 1]);
assert.equal(applyAttitude(s, "").attitude, "");

// Steps are clamped: interest / patience 0..5, impression from 0.
s = stepValue(stepValue(s, "interest", 1), "interest", 1);
assert.equal(s.interest.value, 4);
assert.equal(stepValue(stepValue(s, "interest", 1), "interest", 1).interest.value, 5);
assert.equal(stepValue(fresh, "patience", -1).patience.value, 0);
assert.equal(stepValue(fresh, "impression", 7).impression.value, 7);
assert.equal(stepValue(fresh, "bogus", 1), fresh);
assert.equal(resetValue(s, "interest").interest.value, 2, "reset to the attitude's value");

// From an NPC: values, lists with labels, reveal flags kept.
const revealed = { ...fresh, interest: { ...fresh.interest, revealed: true } };
const npc = stateFromNpc(revealed, {
  uuid: "Actor.npc", name: "Baron", img: "baron.webp",
  negotiation: { interest: 3, patience: 4, impression: 2, motivations: new Set(["greed", "power"]), pitfalls: ["justice"] },
}, k => k.toUpperCase());
assert.equal(npc.npcUuid, "Actor.npc");
assert.equal(npc.name, "Baron");
assert.deepEqual([npc.interest.value, npc.patience.value, npc.impression.value], [3, 4, 2]);
assert.equal(npc.interest.revealed, true);
assert.deepEqual(npc.motivations.map(e => [e.key, e.label]), [["greed", "GREED"], ["power", "POWER"]]);
assert.deepEqual(npc.pitfalls.map(e => e.key), ["justice"]);
assert.equal(stateFromNpc(fresh, { uuid: "x", negotiation: { interest: 9 } }).interest.value, 5, "clamped");

// Canonical motivations: each key once across both lists.
const all = ["benevolence", "greed", "justice", "power"];
assert.deepEqual(availableMotivations(npc, all), ["benevolence"]);
let a = addEntry(npc, "pitfalls", { key: "benevolence", label: "Benevolence" });
assert.equal(a.pitfalls.length, 2);
assert.equal(addEntry(a, "pitfalls", { key: "benevolence", label: "x" }), a, "no duplicate key");
a = addEntry(a, "motivations", { label: "  Their sister's safety ", id: "c1" });
assert.deepEqual(a.motivations.at(-1), { id: "c1", key: null, label: "Their sister's safety", revealed: false, used: false });
assert.equal(addEntry(a, "motivations", { label: "   ", id: "c2" }), a, "empty custom ignored");
assert.equal(addEntry(a, "bogus", { label: "x", id: "c3" }), a);

// Patch / remove.
a = patchEntry(a, "motivations", "greed", e => ({ revealed: !e.revealed, used: true }));
assert.deepEqual(a.motivations.find(e => e.id === "greed"), { id: "greed", key: "greed", label: "GREED", revealed: true, used: true });
a = removeEntry(a, "motivations", "c1");
assert.equal(a.motivations.some(e => e.id === "c1"), false);

// Status.
assert.equal(negotiationStatus(fresh), "", "nothing set up yet");
assert.equal(negotiationStatus(applyAttitude(fresh, "open")), "");
assert.equal(negotiationStatus(stepValue(applyAttitude(fresh, "open"), "interest", 5)), "agreed");
assert.equal(negotiationStatus(stepValue(applyAttitude(fresh, "open"), "interest", -5)), "noDeal");
assert.equal(negotiationStatus(stepValue(applyAttitude(fresh, "open"), "patience", -5)), "outOfPatience");

// Normalising stored data.
const n = normalizeNegotiation({ active: true, attitude: "weird", interest: { value: 12, revealed: 1 }, motivations: [{ id: "a", label: 5 }, {}] });
assert.equal(n.attitude, "");
assert.deepEqual(n.interest, { value: 5, base: 5, revealed: true });
assert.deepEqual(n.patience, { value: 0, base: 0, revealed: false });
assert.deepEqual(n.motivations, [{ id: "a", key: null, label: "5", revealed: false, used: false }]);
assert.deepEqual(normalizeNegotiation(null), defaultNegotiationState());
console.log("NEGOTIATION TRACKER TESTS PASSED");
