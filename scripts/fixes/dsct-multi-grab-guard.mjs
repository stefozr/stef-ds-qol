/**
 * Fix 18 — ending one grab no longer drops the other grabs of a multi-grab ability (Combat Tools).
 *
 * Symptom: a creature holds two grabs (Claw Swing, Choking Grasp, Several Arms, ...). Ending one of them (Undo on the
 * card, the panel, or removing the Grabbed condition) also drops the OTHER grab from Combat Tools' tracking: that
 * creature keeps "Grabbed" and the grabber keeps a "Grabber" effect that nothing ends any more (no movement follow,
 * no release when the grab ends).
 *
 * Cause: `draw-steel-combat-tools/src/conditions/grab.mjs` (2.2.0, deleteActiveEffect hook, lines 115-136) finds the
 * grab of a deleted effect by id only:
 *
 *     if (effect.id !== grab.grabbedEffectId && effect.id !== grab.grabberEffectId) continue;
 *
 * The system creates every status effect with the same static id (`grabbed000000000` on every actor), so the
 * deletion of one creature's Grabbed effect matches the first tracked grab whatever its creature, and that entry is
 * deleted (teardown) or ended.
 *
 * Mechanism: our own `deleteActiveEffect` hook is registered at load, before Combat Tools installs its hook (it does
 * that lazily, on the first grab), so ours runs first. For a deleted effect it gives every tracked grab whose effect
 * id matches but whose token is NOT the effect's token a temporary unique id, and puts the ids back in a microtask,
 * after Combat Tools' handler has run its synchronous match. The map keeps its size (Combat Tools never tears its
 * hooks down early) and the right grab still matches. Once upstream compares the token too, this is a no-op.
 */

import { MODULE_ID, dsctActive } from "../shared.mjs";

const MASK = "#stef-ds-qol-guard";

/** Token ids an effect's actor stands for: its own token (unlinked) or its active tokens. */
function tokenIdsOf(effect) {
  const actor = effect?.parent;
  if (!actor || actor.documentName !== "Actor") return null;
  if (actor.isToken) return actor.token?.id ? [actor.token.id] : null;
  return actor.getActiveTokens?.(false, true)?.map(t => t.id) ?? null;
}

/**
 * Pure: the tracked grabs a deleted effect matches by id but does NOT belong to (another creature's static-id status,
 * or another grabber's effect).
 * @param {Iterable<object>} grabs   Values of Combat Tools' `window._activeGrabs`.
 * @param {string} effectId
 * @param {string[]} tokenIds        Token ids of the effect's actor.
 * @returns {{grab: object, field: "grabbedEffectId"|"grabberEffectId"}[]}
 */
export function foreignMatches(grabs, effectId, tokenIds) {
  const out = [];
  for (const grab of grabs ?? []) {
    if (grab?.grabbedEffectId === effectId && !tokenIds.includes(grab.grabbedTokenId)) out.push({ grab, field: "grabbedEffectId" });
    if (grab?.grabberEffectId === effectId && !tokenIds.includes(grab.grabberTokenId)) out.push({ grab, field: "grabberEffectId" });
  }
  return out;
}

function onDeleteEffect(effect) {
  const map = globalThis.window?._activeGrabs;
  if (!map?.size || !effect?.id) return;
  const tokenIds = tokenIdsOf(effect);
  if (!tokenIds) return;
  const masked = foreignMatches(map.values(), effect.id, tokenIds);
  if (!masked.length) return;
  for (const m of masked) m.grab[m.field] = `${effect.id}${MASK}`;
  queueMicrotask(() => {
    for (const m of masked) if (m.grab[m.field] === `${effect.id}${MASK}`) m.grab[m.field] = effect.id;
  });
}

export function registerMultiGrabGuard() {
  // At load, not in a hook: Combat Tools adds its deleteActiveEffect hook on the first grab, after ours.
  Hooks.on("deleteActiveEffect", (effect) => {
    try {
      if (dsctActive()) onDeleteEffect(effect);
    } catch (err) {
      console.error(`${MODULE_ID} | Fix 18: multi-grab guard failed`, err);
    }
  });
}
