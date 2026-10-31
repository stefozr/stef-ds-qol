import assert from "node:assert/strict";
import { isCombatToolsNote, cleanText, metaSegments, rollSummary, tierLabelText, effectLabel, hasText } from "../scripts/fixes/compact-ability-cards.mjs";

assert.equal(isCombatToolsNote("Draw Steel: Combat Tools automates part of this. What it does, and what it leaves to you"), true);
assert.equal(isCombatToolsNote("A GM-only note"), false);
assert.equal(isCombatToolsNote(null), false);

assert.equal(cleanText("  Main\n   Action "), "Main Action");

assert.deepEqual(metaSegments({ type: "Main Action", distance: "Melee 1", target: "2 creatures or objects", keywords: "Melee, Strike, Weapon" }), [
  { cls: "type", text: "Main Action" }, { cls: "distance", text: "Melee 1" },
  { cls: "target", text: "2 creatures or objects" }, { cls: "keywords", text: "Melee, Strike, Weapon" },
]);
assert.deepEqual(metaSegments({ resource: "3 Insight", type: "Maneuver", distance: " ", target: "Self" }).map(s => s.cls), ["resource", "type", "target"]);
assert.deepEqual(metaSegments(), []);

assert.equal(rollSummary([{ total: "13" }]), "13");
assert.equal(rollSummary([{ header: "Arixx", total: "13" }]), "13", "one roll: no name");
assert.equal(rollSummary([{ header: "Arixx", total: "13" }, { header: "Goblin", total: "9" }]), "Arixx 13 · Goblin 9");
assert.equal(rollSummary([{ header: "A", total: "" }, { header: "B", total: "7" }]), "7");
assert.equal(rollSummary([]), "");

assert.equal(tierLabelText("Tier 2 (1 edge)"), "Tier 2");
assert.equal(tierLabelText(" Tier 3 "), "Tier 3");

assert.equal(effectLabel("Effect"), "Effect:");
assert.equal(effectLabel("Effect:"), "Effect:");
assert.equal(effectLabel("Spend 1 Insight", false), "Spend 1 Insight");
assert.equal(effectLabel(""), "");

assert.equal(hasText("  \n "), false);
assert.equal(hasText("", true), true);
assert.equal(hasText("x"), true);

console.log("compact-ability-cards: all assertions passed");
