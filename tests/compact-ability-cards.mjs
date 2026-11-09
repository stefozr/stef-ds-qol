import assert from "node:assert/strict";
import { isCombatToolsNote, cleanText, metaSegments, rollSummary, tierLabelText, effectLabel, hasText, damageRollIndexes, suiteHasCondition, conditionOfButton, suiteHasForced, markForcedRows, foldTierText } from "../scripts/fixes/compact-ability-cards.mjs";

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

// Minimal fake DOM: a section with a rolls frame (two fm rows, a dl) and a header.
class El {
  constructor(tag, cls = "") { this.tag = tag; this.classList = new Set(cls.split(/\s+/).filter(Boolean)); this.children = []; this.parent = null; this.className = cls; }
  append(...kids) { for (const k of kids) { k.parent?.children.splice(k.parent.children.indexOf(k), 1); k.parent = this; this.children.push(k); } }
  after(node) { const i = this.parent.children.indexOf(this); node.parent = this.parent; this.parent.children.splice(i + 1, 0, node); }
  has(c) { return this.classList.has(c) || String(this.className).split(/\s+/).includes(c); }
  get root() { return this.parent ? this.parent.root : this; }
  // Only the selectors the fix uses.
  querySelectorAll(sel) {
    if (sel === ":scope > .message-part-rolls > .dsct-fm-roll") return this.kids("message-part-rolls").flatMap(r => r.children.filter(c => c.has("dsct-fm-roll")));
    if (sel === ":scope > .message-part-rolls > dl.power-roll-display") return this.kids("message-part-rolls").flatMap(r => r.children.filter(c => c.tag === "dl" && c.has("power-roll-display")));
    if (sel === ":scope > .dslf-dice") return this.kids("dslf-dice");
    throw new Error(`fake: ${sel}`);
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  kids(c) { return this.children.filter(k => k.has(c)); }
}
const fakeDoc = { createElement: (tag) => new El(tag) };
function fakeSection() {
  const section = new El("section"), header = new El("div", "message-part-header"), rolls = new El("div", "message-part-rolls");
  const fm1 = new El("div", "dice-roll dsct-fm-roll"), fm2 = new El("div", "dice-roll dsct-fm-roll"), power = new El("div", "dice-roll");
  const dl = new El("dl", "power-roll-display");
  rolls.append(power, dl, fm1, fm2);
  section.append(header, rolls);
  return { section, header, rolls, fm1, fm2, power, dl };
}
assert.equal(suiteHasForced([{ kind: "forced", partId: "p1" }], "p1"), true);
assert.equal(suiteHasForced([{ kind: "forced", partId: "p2" }, { kind: "damage", partId: "p1" }], "p1"), false);
assert.equal(suiteHasForced(undefined, "p1"), false);
{
  const t = fakeSection();
  assert.equal(markForcedRows(t.section, [{ kind: "forced", partId: "p1", status: "applied" }], "p1"), 2);
  assert.ok(t.fm1.has("dslf-suite-row") && t.fm2.has("dslf-suite-row"));
  assert.ok(!t.power.has("dslf-suite-row"));
  const u = fakeSection();
  assert.equal(markForcedRows(u.section, [], "p1"), 0);
  assert.equal(markForcedRows(u.section, [{ kind: "forced", partId: "other" }], "p1"), 0);
  assert.ok(!u.fm1.has("dslf-suite-row"));
}
{
  const t = fakeSection();
  assert.equal(foldTierText(t.section, t.header, fakeDoc), t.dl);
  const dice = t.section.kids("dslf-dice");
  assert.equal(dice.length, 1);
  assert.deepEqual(dice[0].children, [t.dl]);
  assert.ok(!t.rolls.children.includes(t.dl), "dl left the rolls frame");
  assert.equal(foldTierText(t.section, t.header, fakeDoc), null, "second pass: nothing to move");
  assert.equal(t.section.kids("dslf-dice").length, 1);
  assert.equal(dice[0].children.length, 1, "no duplicate");
  // Battle Log's fold is reused.
  const b = fakeSection();
  const bl = new El("div", "dslf-dice"); b.section.append(bl);
  foldTierText(b.section, b.header, fakeDoc);
  assert.equal(b.section.kids("dslf-dice").length, 1);
  assert.deepEqual(bl.children, [b.dl]);
}

console.log("compact-ability-cards: all assertions passed");
