/**
 * Fix 10 — Draw Steel: Target Damage finds the author of a chat message on Foundry v14.
 *
 * Symptom: the server log fills with "User <player> lacks permission to update ChatMessage [...]"
 * whenever an ability card is posted, and Target Damage panels flicker while every client races to
 * write the same state.
 *
 * Cause: Target Damage 1.0.8 resolves a card's author with
 * `message?.user?.id ?? message?.user ?? message?.userId` (src/target-utils.mjs:73-75). Foundry v12+
 * renamed the field to `author`, so the result is always null, the guard
 * `if (authorId && authorId !== game.user.id) return;` (src/chat-targeting.mjs:212-213) never stops
 * a non-author, and every client tries to persist the panel state onto messages it cannot update.
 * A patch inside the Target Damage folder would be lost on every module update, hence this shim.
 *
 * Mechanism: give ChatMessage a read-only `user` accessor that returns `this.author`. It is defined
 * only when core does not already provide a `user` property, so a future core getter always wins.
 * No other enabled module reads `message.user` (autoanimations reads `author ?? user`).
 *
 * Only the author's client persists Target Damage's initial panel state (not the GM's as well). The
 * author is online when the card is created, so this only matters for cards re-rendered after the
 * author left before the first render.
 */

import { MODULE_ID } from "../shared.mjs";

export function registerDstdAuthorShim() {
  const proto = foundry.documents?.ChatMessage?.prototype;
  if (!proto) {
    console.warn(`${MODULE_ID} | Fix 10: foundry.documents.ChatMessage is missing, shim not installed`);
    return;
  }
  if ("user" in proto) {
    console.log(`${MODULE_ID} | Fix 10: ChatMessage already has a "user" property, shim not needed`);
    return;
  }
  Object.defineProperty(proto, "user", {
    get() {
      return this.author;
    },
    configurable: true,
    enumerable: false,
  });
  console.log(`${MODULE_ID} | Fix 10: ChatMessage#user now returns the message author (Target Damage v14 shim)`);
}

/** Console helpers: game.modules.get("stef-ds-qol").api.dstdAuthor.check() */
export const dstdAuthorApi = {
  /** Report whether the shim is active and what it returns for the latest chat message. */
  check() {
    const desc = Object.getOwnPropertyDescriptor(foundry.documents.ChatMessage.prototype, "user");
    const last = game.messages?.contents.at(-1);
    const report = {
      shimInstalled: !!desc?.get,
      latestMessage: last?.id ?? null,
      author: last?.author?.name ?? null,
      userGetter: last?.user?.name ?? null,
      dstdVersion: game.modules.get("draw-steel-target-damage")?.version ?? null,
    };
    console.table(report);
    return report;
  },
};
