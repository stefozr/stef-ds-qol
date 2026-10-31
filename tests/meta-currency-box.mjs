import assert from "node:assert/strict";
import { clampPosition, defaultPosition, maliceVisible } from "../scripts/fixes/meta-currency-box.mjs";

const view = { w: 200, h: 60, vw: 1000, vh: 800 };
assert.deepEqual(clampPosition({ left: 300, top: 400 }, view), { left: 300, top: 400 }, "inside stays put");
assert.deepEqual(clampPosition({ left: -50, top: -10 }, view), { left: 8, top: 8 }, "top-left margin");
assert.deepEqual(clampPosition({ left: 990, top: 790 }, view), { left: 792, top: 732 }, "bottom-right margin");
assert.deepEqual(clampPosition({ left: "x", top: null }, view), { left: 8, top: 8 }, "garbage falls back to the corner");
assert.deepEqual(clampPosition({ left: 50, top: 50 }, { w: 300, h: 60, vw: 305, vh: 800 }), { left: 5, top: 50 }, "no margin when it barely fits");

assert.deepEqual(defaultPosition({ ...view, hotbarTop: 740 }), { left: 400, top: 668 }, "centred above the hotbar");
assert.deepEqual(defaultPosition({ ...view, hotbarTop: null }), { left: 400, top: 650 }, "no hotbar: near the bottom");

assert.equal(maliceVisible({ isGM: true, showPlayerMalice: false, inCombat: false }), true, "Director always");
assert.equal(maliceVisible({ isGM: false, showPlayerMalice: true, inCombat: false }), false, "players: not outside combat");
assert.equal(maliceVisible({ isGM: false, showPlayerMalice: false, inCombat: true }), false, "players: only with the setting");
assert.equal(maliceVisible({ isGM: false, showPlayerMalice: true, inCombat: true }), true, "players: setting + combat");
console.log("META CURRENCY BOX TESTS PASSED");
