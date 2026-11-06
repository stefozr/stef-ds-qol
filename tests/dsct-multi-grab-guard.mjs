import assert from "node:assert/strict";
import { foreignMatches } from "../scripts/fixes/dsct-multi-grab-guard.mjs";

const brick = { grabbedTokenId: "B", grabberTokenId: "A", grabbedEffectId: "grabbed000000000", grabberEffectId: "g1" };
const jaan = { grabbedTokenId: "J", grabberTokenId: "A", grabbedEffectId: "grabbed000000000", grabberEffectId: "g2" };

// Brick's Grabbed (static id) is deleted: Ja'an's grab matches by id but is another creature's.
assert.deepEqual(foreignMatches([brick, jaan], "grabbed000000000", ["B"]), [{ grab: jaan, field: "grabbedEffectId" }]);
// A Grabber effect id is unique: only its own grab matches, and it is not foreign.
assert.deepEqual(foreignMatches([brick, jaan], "g1", ["A"]), []);
// Unrelated effect: nothing.
assert.deepEqual(foreignMatches([brick, jaan], "other", ["B"]), []);
assert.deepEqual(foreignMatches(null, "grabbed000000000", ["B"]), []);

console.log("dsct-multi-grab-guard: all assertions passed");
