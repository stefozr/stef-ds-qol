import assert from "node:assert/strict";

const settings = { "draw-steel-battle-log.collapsibleAbilities": true };
let active = true;
globalThis.game = {
  modules: { get: id => (id === "draw-steel-battle-log" ? { active } : null) },
  settings: { get: (m, k) => { const key = `${m}.${k}`; if (!(key in settings)) throw new Error("not registered"); return settings[key]; } },
};
const { battleLogCollapses } = await import("../scripts/fixes/collapse-ability-cards.mjs");

assert.equal(battleLogCollapses(), true, "Battle Log active with collapsible abilities: Fix 9 \"all\" defers");
settings["draw-steel-battle-log.collapsibleAbilities"] = false;
assert.equal(battleLogCollapses(), false, "its option off: Fix 9 keeps its own caret");
settings["draw-steel-battle-log.collapsibleAbilities"] = true;
active = false;
assert.equal(battleLogCollapses(), false, "Battle Log inactive");
active = true;
delete settings["draw-steel-battle-log.collapsibleAbilities"];
assert.equal(battleLogCollapses(), false, "an unregistered setting never throws");

console.log("collapse-ability-cards: all assertions passed");
