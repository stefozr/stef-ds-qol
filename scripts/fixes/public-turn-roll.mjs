/**
 * Fix 1 — turn-start heroic resource roll is always public.
 *
 * `HeroModel#_onStartTurn` (draw-steel 1.1.2, draw-steel.mjs:3424-3437) posts the class
 * `turnGain` roll through `DSRoll#toMessage` without a message mode. `DSRoll#toMessage`
 * (draw-steel.mjs:795-835) then falls back to the *client* setting `core.messageMode`.
 * `_onStartTurn` runs on whichever client decrements the combatant's initiative, so when the
 * Director activates a hero while their chat is set to a private mode, the players never see
 * what their own hero rolled. The system already forces `messageMode: "public"` for the
 * "roll first" message (draw-steel.mjs:11819-11821); this module does the same for the
 * heroic resource gain.
 *
 * Mechanism: `_onStartTurn` never exposes the roll options, so two wrappers cooperate. The
 * `_onStartTurn` wrapper keeps a depth counter while it runs; the `DSRoll#toMessage` wrapper
 * injects `{ messageMode: "public" }` whenever that counter is above zero and the caller did
 * not choose a mode explicitly. libWrapper is used when active; otherwise the prototypes are
 * patched directly.
 */

import { MODULE_ID } from "../shared.mjs";

/** How many `_onStartTurn` calls are currently on the stack (per client). */
let startTurnDepth = 0;

/**
 * Wrapper for HeroModel#_onStartTurn: bump the depth counter for the duration of the call.
 * @this {object} HeroModel instance
 */
async function wrappedStartTurn(wrapped, ...args) {
  startTurnDepth++;
  try {
    return await wrapped(...args);
  } finally {
    startTurnDepth--;
  }
}

/**
 * Wrapper for DSRoll#toMessage: force a public message while a turn start is in progress,
 * unless the caller already picked a mode.
 * @this {object} DSRoll instance
 */
function wrappedToMessage(wrapped, messageData = {}, options = {}) {
  if ((startTurnDepth > 0) && !options.messageMode && !options.rollMode) {
    options = { ...options, messageMode: "public" };
  }
  return wrapped(messageData, options);
}

export function registerPublicTurnRoll() {
  Hooks.once("init", () => {
    const HeroModel = globalThis.ds?.data?.Actor?.HeroModel;
    const DSRoll = globalThis.ds?.rolls?.DSRoll;

    if (!(HeroModel?.prototype?._onStartTurn instanceof Function) || !(DSRoll?.prototype?.toMessage instanceof Function)) {
      console.error(`${MODULE_ID} | Fix 1: could not find ds.data.Actor.HeroModel#_onStartTurn or ds.rolls.DSRoll#toMessage. `
        + "The system API has changed; the public-resource-roll patch was NOT applied.");
      return;
    }

    if (game.modules.get("lib-wrapper")?.active && (typeof libWrapper !== "undefined")) {
      libWrapper.register(MODULE_ID, "ds.data.Actor.HeroModel.prototype._onStartTurn", wrappedStartTurn, "WRAPPER");
      libWrapper.register(MODULE_ID, "ds.rolls.DSRoll.prototype.toMessage", wrappedToMessage, "WRAPPER");
      console.log(`${MODULE_ID} | Fix 1: turn-start heroic resource roll forced public (libWrapper).`);
      return;
    }

    const originalStartTurn = HeroModel.prototype._onStartTurn;
    HeroModel.prototype._onStartTurn = function (...args) {
      return wrappedStartTurn.call(this, originalStartTurn.bind(this), ...args);
    };

    const originalToMessage = DSRoll.prototype.toMessage;
    DSRoll.prototype.toMessage = function (...args) {
      return wrappedToMessage.call(this, originalToMessage.bind(this), ...args);
    };

    console.log(`${MODULE_ID} | Fix 1: turn-start heroic resource roll forced public (direct prototype patch).`);
  });
}
