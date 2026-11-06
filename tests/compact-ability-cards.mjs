import assert from "node:assert/strict";
import { isCombatToolsNote, cleanText, metaSegments, rollSummary, tierLabelText, effectLabel, hasText, damageRollIndexes, suiteHasCondition, conditionOfButton } from "../scripts/fixes/compact-ability-cards.mjs";

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

class Dmg {}
assert.deepEqual(damageRollIndexes([{}, new Dmg(), {}, new Dmg()], r => r instanceof Dmg), [1, 3]);
assert.deepEqual(damageRollIndexes([{}], () => false), []);
const ops = [{ kind: "damage", partId: "p1" }, { kind: "condition", status: "skipped", partId: "p1", effectId: "bleeding", preId: "pre1" }];
assert.equal(suiteHasCondition({ effectId: "bleeding", uuid: "Actor.a.Item.i.PowerRollEffect.pre1" }, ops, "p1"), true);
assert.equal(suiteHasCondition({ effectId: "bleeding", uuid: "Actor.a.Item.i.PowerRollEffect.pre2" }, ops, "p1"), false);
assert.equal(suiteHasCondition({ effectId: "bleeding", uuid: "Actor.a.Item.i.PowerRollEffect.pre1" }, ops, "p2"), false);
assert.equal(suiteHasCondition({ effectId: "grabbed", uuid: "x.pre1" }, ops, "p1"), false);
assert.equal(suiteHasCondition({ effectId: "grabbed", uuid: "x.pre9" }, [], "p1", true), true);
assert.equal(suiteHasCondition({ effectId: "bleeding", uuid: "x.pre1" }, [{ ...ops[1], lib: true }], "p1"), false);
assert.equal(suiteHasCondition(null, ops, "p1", true), false);
assert.equal(suiteHasCondition({ effectId: "bleeding", uuid: "" }, ops, "p1"), true);
assert.equal(suiteHasCondition({ effectId: "bleeding", uuid: "" }, ops, "p2"), false);
assert.deepEqual(conditionOfButton({ action: "applyEffect", effectId: "bleeding", uuid: "A.pre1" }), { effectId: "bleeding", uuid: "A.pre1" });
assert.deepEqual(conditionOfButton({ dsctAction: "dsct-grab", dsctDsid: "claw-swing" }), { effectId: "grabbed", uuid: "" });
assert.deepEqual(conditionOfButton({ dsctAction: "dsct-frightened" }, id => id === "frightened"), { effectId: "frightened", uuid: "" });
assert.equal(conditionOfButton({ dsctAction: "dsct-fm" }, id => ["grabbed", "frightened"].includes(id)), null);
assert.equal(conditionOfButton({ action: "applyDamage" }), null);
assert.equal(conditionOfButton(null), null);
assert.deepEqual(damageRollIndexes(undefined, () => true), []);

console.log("compact-ability-cards: all assertions passed");
