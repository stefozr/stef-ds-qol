/**
 * Fix 7 — combatant images fall back to the token ring art.
 *
 * Symptom: in the Combat Tracker dock and in the sidebar combat tracker some heroes show Foundry's
 * mystery-man silhouette although their tokens show proper art on the canvas.
 *
 * Cause: Tokenizer stores the art as the token's dynamic-ring *subject texture*
 * (`TokenDocument.ring.subject.texture`) and leaves `texture.src` as the default
 * `icons/svg/mystery-man.svg`. Core `Combatant#prepareDerivedData` (client/documents/combatant.mjs:160-172)
 * sets `this.img ||= token.texture.src || actor.img`, and the sidebar renders `combatant.img`
 * (sidebar/tabs/combat-tracker.mjs:153). The dock's `_getTokenImg` reads `texture.src` first as well
 * (that method is wrapped from tracker-dock.mjs with the helpers exported here).
 *
 * Mechanism: wrap `CONFIG.Combatant.documentClass.prototype.prepareDerivedData`; after the original
 * ran, when the combatant has no explicit image, is not a video token and ended up with the default
 * silhouette, use the ring subject texture if the ring is enabled and a subject is set. Anything
 * else is left exactly as core computed it.
 */

import { MODULE_ID } from "../shared.mjs";

/** Is this image missing or Foundry's default mystery-man silhouette? */
export function isDefaultImage(src) {
  if (!src) return true;
  if (src === CONST.DEFAULT_TOKEN) return true;
  return /mystery-man\.svg$/i.test(String(src));
}

/** The dynamic-ring subject texture of a token document, when the ring is enabled and a subject is set. */
export function ringArt(tokenDoc) {
  if (!tokenDoc?.ring?.enabled) return null;
  return tokenDoc.ring.subject?.texture || null;
}

/**
 * Wrapper for Combatant#prepareDerivedData.
 * @this {Combatant}
 */
function wrappedPrepareDerivedData(wrapped, ...args) {
  const result = wrapped(...args);
  try {
    if (!this._source?.img && !this._videoSrc && isDefaultImage(this.img)) {
      const art = ringArt(this.token);
      if (art) this.img = art;
    }
  } catch (_err) {
    // never break data preparation
  }
  return result;
}

export function registerRingArtImages() {
  Hooks.once("init", () => {
    const Combatant = CONFIG.Combatant?.documentClass;
    if (!(Combatant?.prototype?.prepareDerivedData instanceof Function)) {
      console.error(`${MODULE_ID} | Fix 7: CONFIG.Combatant.documentClass#prepareDerivedData not found; `
        + "combatant images are NOT patched.");
      return;
    }

    if (game.modules.get("lib-wrapper")?.active && (typeof libWrapper !== "undefined")) {
      libWrapper.register(MODULE_ID, "CONFIG.Combatant.documentClass.prototype.prepareDerivedData", wrappedPrepareDerivedData, "WRAPPER");
      console.log(`${MODULE_ID} | Fix 7: combatant images fall back to the token ring art (libWrapper).`);
      return;
    }

    const original = Combatant.prototype.prepareDerivedData;
    Combatant.prototype.prepareDerivedData = function (...args) {
      return wrappedPrepareDerivedData.call(this, original.bind(this), ...args);
    };
    console.log(`${MODULE_ID} | Fix 7: combatant images fall back to the token ring art (direct prototype patch).`);
  });
}
