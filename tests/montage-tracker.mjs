import assert from "node:assert/strict";
import {
  addHero, adjustedLimits, defaultMontageState, effectiveHeroCount, montageOutcome, normalizeMontage, recordResult,
  removeHero, stepCounter, stepRound, testSucceeds, timeIsUp, victoriesFor,
} from "../scripts/fixes/montage-tracker.mjs";

// Limits: base table, adjusted by one per hero away from five, never below two.
assert.deepEqual(adjustedLimits("easy", 5), { success: 5, failure: 5 });
assert.deepEqual(adjustedLimits("moderate", 5), { success: 6, failure: 4 });
assert.deepEqual(adjustedLimits("hard", 5), { success: 7, failure: 3 });
assert.deepEqual(adjustedLimits("moderate", 3), { success: 4, failure: 2 }, "two fewer heroes");
assert.deepEqual(adjustedLimits("hard", 6), { success: 8, failure: 4 }, "one more hero");
assert.deepEqual(adjustedLimits("hard", 1), { success: 3, failure: 2 }, "minimum two");
assert.deepEqual(adjustedLimits("nonsense", 5), { success: 6, failure: 4 }, "unknown difficulty = moderate");

// Hero count: explicit, else the list, else five.
const fresh = { ...defaultMontageState(), active: true };
assert.equal(effectiveHeroCount(fresh), 5);
let s = ["a", "b", "c"].reduce((st, id) => addHero(st, { uuid: `Actor.${id}`, name: id }), fresh);
assert.equal(s.heroes.length, 3);
assert.equal(addHero(s, { uuid: "Actor.a", name: "again" }), s, "no duplicates");
assert.equal(effectiveHeroCount(s), 3);
assert.equal(effectiveHeroCount({ ...s, heroCount: 6 }), 6);

// Test success thresholds follow the system's test outcomes.
assert.equal(testSucceeds(1, "easy"), true);
assert.equal(testSucceeds(1, "medium"), false);
assert.equal(testSucceeds(2, "medium"), true);
assert.equal(testSucceeds(2, "hard"), false);
assert.equal(testSucceeds(3, "hard"), true);

// Recording results: acted, skills remembered once, counts capped at the limit (moderate, 3 heroes: 4/2).
s = recordResult(s, { uuid: "Actor.a", success: true, skill: "climb" });
s = recordResult(s, { uuid: "Actor.b", success: false, skill: "" });
assert.equal(s.successes, 1);
assert.equal(s.failures, 1);
assert.deepEqual(s.heroes.map(h => h.acted), [true, true, false]);
assert.deepEqual(s.heroes[0].skills, ["climb"]);
s = recordResult(s, { uuid: "Actor.a", success: true, skill: "climb" });
assert.deepEqual(s.heroes[0].skills, ["climb"], "skill kept once");
assert.equal(montageOutcome(s), "", "still running");
s = recordResult(s, { uuid: "Actor.c", success: false });
assert.equal(s.failures, 2);
assert.equal(montageOutcome(s), "totalFailure", "failure limit, successes not two ahead");
assert.equal(recordResult(s, { uuid: "Actor.c", success: false }).failures, 2, "capped");

// Partial success: failure limit reached or time up with two more successes than failures.
const p = { ...fresh, heroCount: 5, difficulty: "easy", successes: 4, failures: 2 };
assert.equal(montageOutcome(p), "");
assert.equal(montageOutcome({ ...p, failures: 5, successes: 4 }), "totalFailure");
assert.equal(montageOutcome({ ...p, round: 3 }), "partialSuccess", "time up, 4 vs 2");
assert.equal(montageOutcome({ ...p, successes: 5 }), "totalSuccess");

// Time: past the last round, or everyone acted in the last round.
let t = addHero(addHero({ ...fresh, round: 2 }, { uuid: "x" }), { uuid: "y" });
assert.equal(timeIsUp(t), false);
t = recordResult(recordResult(t, { uuid: "x", success: true }), { uuid: "y", success: true });
assert.equal(timeIsUp(t), true);
assert.equal(timeIsUp({ ...fresh, round: 3 }), true);
assert.equal(timeIsUp({ ...fresh, round: 2 }), false, "no heroes: not up until the round passes");

// Rounds: next clears acted, bounded to 1..maxRounds+1.
let r = recordResult(addHero(fresh, { uuid: "x" }), { uuid: "x", success: true });
r = stepRound(r, 1);
assert.equal(r.round, 2);
assert.equal(r.heroes[0].acted, false);
assert.equal(stepRound(stepRound(r, 1), 1).round, 3);
assert.equal(stepRound(fresh, -1), fresh, "not below 1");

// Counters.
assert.equal(stepCounter(fresh, "successes", 1).successes, 1);
assert.equal(stepCounter(fresh, "failures", -1).failures, 0);
assert.equal(stepCounter({ ...fresh, failures: 4 }, "failures", 1).failures, 4, "capped at the limit");
assert.equal(stepCounter(fresh, "round", 1), fresh, "unknown key ignored");

// Victories.
assert.equal(victoriesFor("totalSuccess", "easy"), 1);
assert.equal(victoriesFor("partialSuccess", "easy"), 0);
assert.equal(victoriesFor("partialSuccess", "moderate"), 1);
assert.equal(victoriesFor("totalSuccess", "hard"), 2);
assert.equal(victoriesFor("totalFailure", "hard"), 0);
assert.equal(victoriesFor("", "hard"), 0);

// Normalising stored data.
const n = normalizeMontage({ active: 1, difficulty: "bogus", heroCount: 0, reveal: { round: true }, heroes: [{ uuid: "u", name: "N" }, { name: "no uuid" }] });
assert.equal(n.active, true);
assert.equal(n.difficulty, "moderate");
assert.equal(n.heroCount, null);
assert.deepEqual(n.reveal, { successes: false, failures: false, round: true });
assert.equal(n.heroes.length, 1);
assert.deepEqual(n.heroes[0].skills, []);
assert.deepEqual(normalizeMontage(undefined), defaultMontageState());
assert.equal(removeHero(n, "u").heroes.length, 0);
console.log("MONTAGE TRACKER TESTS PASSED");
