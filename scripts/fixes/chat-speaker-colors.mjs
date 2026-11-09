/**
 * Fix 17 — player colors and token portraits on chat cards.
 *
 * Symptom: only plain out-of-character messages get a colored border; ability cards, tests and every other
 * in-character card keep the neutral border, so it is hard to see who used what.
 *
 * Cause: core `ChatMessage#renderHTML` sets `borderColor` only for `CHAT_MESSAGE_STYLES.OOC` (author color,
 * client/documents/chat-message.mjs:442), and the system's `StandardModel#renderHTML` / `#renderFrame`
 * (draw-steel.mjs:14750-14808) applies `options.borderColor` only when one is passed, which never happens for
 * in-character cards.
 *
 * Mechanism: a `renderChatMessageHTML` pass on messages with a speaker actor (not OOC):
 * - color = the player behind the speaker: a non-GM user whose assigned character it is, else a non-GM owner
 *   (an active one first), else the message author (so NPC and monster cards get the Director's color). The color goes
 *   on the `<li>` border and into `--dslf-speaker-color`, which the sender name uses;
 * - portrait = the speaking token's art (ring subject art when the ring is on, as Fix 7), else the prototype token,
 *   else the actor portrait, inserted at the start of `.message-header`; clicking it pans to the token.
 * Client settings `chatSpeakerColors` and `chatSpeakerPortraits` (both on). Rendered messages are updated in place
 * when a setting, a user's color / character or an actor's ownership changes.
 */

import { MODULE_ID } from "../shared.mjs";
import { ringArt } from "./ring-art-images.mjs";

const COLORS = "chatSpeakerColors";
const PORTRAITS = "chatSpeakerPortraits";
const CLASS = "dslf-speaker";
const TOKEN_CLASS = "dslf-has-token";
const IMG_CLASS = "dslf-speaker-token";

/* -------------------------------------------------- */
/*   Pure helpers (tests/chat-speaker-colors.mjs)     */
/* -------------------------------------------------- */

/**
 * Whose color a card gets: a player with the actor as assigned character, else a player owner, else the author.
 * Among several candidates an active (logged-in) one wins, else the first.
 */
export function pickSpeakerUser({ characterUserIds = [], ownerUserIds = [], activeUserIds = [], authorId = null }) {
  const pick = ids => ids.find(id => activeUserIds.includes(id)) ?? ids[0];
  if (characterUserIds.length) return pick(characterUserIds);
  if (ownerUserIds.length) return pick(ownerUserIds);
  return authorId ?? null;
}

const VIDEO = /\.(webm|mp4|m4v|ogv|ogg)(\?.*)?$/i;

/** Missing, wildcard, video or Foundry's default silhouette: not usable as a portrait. */
export function unusableImage(src, defaultToken = globalThis.CONST?.DEFAULT_TOKEN) {
  if (!src) return true;
  const s = String(src);
  return s.includes("*") || VIDEO.test(s) || /mystery-man\.svg$/i.test(s) || (!!defaultToken && s === defaultToken);
}

/**
 * Portrait for a card: token (ring art first), then prototype token (same rule), then the actor portrait.
 * @returns {{src: string, ring: boolean} | null}
 */
export function speakerImage({ token = null, prototype = null, actorImg = null, defaultToken } = {}) {
  for (const t of [token, prototype]) {
    if (!t) continue;
    const art = ringArt(t);
    if (art && !unusableImage(art, defaultToken)) return { src: art, ring: true };
    const src = t.texture?.src;
    if (!unusableImage(src, defaultToken)) return { src, ring: !!t.ring?.enabled };
  }
  if (!unusableImage(actorImg, defaultToken)) return { src: actorImg, ring: false };
  return null;
}

/* -------------------------------------------------- */
/*   Foundry side                                     */
/* -------------------------------------------------- */

const setting = key => {
  try {
    return !!game.settings.get(MODULE_ID, key);
  } catch {
    return false;
  }
};

/** The user whose color the message gets. */
function speakerUser(message, actor) {
  const players = game.users.filter(u => !u.isGM);
  const baseId = actor.id;
  const characterUserIds = players.filter(u => u.character?.id === baseId).map(u => u.id);
  const ownerUserIds = players.filter(u => actor.testUserPermission(u, "OWNER")).map(u => u.id);
  const activeUserIds = game.users.filter(u => u.active).map(u => u.id);
  const id = pickSpeakerUser({ characterUserIds, ownerUserIds, activeUserIds, authorId: message.author?.id ?? null });
  return id ? game.users.get(id) ?? null : null;
}

function speakerToken(message) {
  const { scene, token } = message.speaker ?? {};
  if (!scene || !token) return null;
  return game.scenes.get(scene)?.tokens.get(token) ?? null;
}

function colorOf(user) {
  const c = user?.color;
  if (!c) return null;
  return typeof c === "string" ? c : c.css ?? String(c);
}

/** Undo what applyMessage did (for in-place refreshes). */
function clear(li) {
  li.querySelector(`.message-header > .${IMG_CLASS}`)?.remove();
  li.classList.remove(TOKEN_CLASS);
  if (li.classList.contains(CLASS)) {
    li.classList.remove(CLASS);
    li.style.removeProperty("--dslf-speaker-color");
    li.style.removeProperty("border-color");
    delete li.dataset.dslfSpeakerUser;
  }
}

function applyMessage(message, li) {
  if (!message || !(li instanceof HTMLElement)) return;
  clear(li);
  if (message.style === CONST.CHAT_MESSAGE_STYLES.OOC) return;
  const actor = message.speakerActor;
  if (!actor) return;

  if (setting(COLORS)) {
    const user = speakerUser(message, actor);
    const color = colorOf(user);
    if (color) {
      li.classList.add(CLASS);
      li.style.setProperty("--dslf-speaker-color", color);
      li.style.setProperty("border-color", color);
      li.dataset.dslfSpeakerUser = user.id;
    }
  }

  if (setting(PORTRAITS)) {
    const header = li.querySelector(".message-header");
    const token = speakerToken(message);
    const image = speakerImage({ token, prototype: actor.prototypeToken, actorImg: actor.img });
    if (header && image) {
      const img = document.createElement("img");
      img.className = IMG_CLASS + (image.ring ? " ring" : "");
      img.src = image.src;
      img.alt = "";
      // Never `loading = "lazy"`: the chat log's first render waits for every image (ChatLog#scrollBottom waitImages);
      // a lazy one scrolled out of view never loads, so the chat log and the whole sidebar (tab switching) hang.
      if (token) {
        img.dataset.sceneId = token.parent?.id ?? "";
        img.dataset.tokenId = token.id;
        img.dataset.tooltip = "DSLF.ChatSpeakers.PanToToken";
      }
      header.prepend(img);
      li.classList.add(TOKEN_CLASS);
    }
  }
}

/** Re-apply to every rendered message (chat log, popouts, notifications). */
function refreshAll() {
  for (const li of document.querySelectorAll(".chat-message[data-message-id]")) {
    try {
      applyMessage(game.messages.get(li.dataset.messageId), li);
    } catch (err) {
      console.error(`${MODULE_ID} | Fix 17: refreshing message ${li.dataset.messageId} failed`, err);
    }
  }
}

let refreshTimer = null;
function queueRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshAll, 100);
}

/** Click on a portrait: pan to the token when it is on the viewed scene and visible to this user. */
function onDocumentClick(event) {
  const img = event.target.closest?.(`img.${IMG_CLASS}[data-token-id]`);
  if (!img || !canvas?.ready || canvas.scene?.id !== img.dataset.sceneId) return;
  const token = canvas.tokens?.get(img.dataset.tokenId);
  if (!token?.visible) return;
  event.preventDefault();
  event.stopPropagation();
  canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 250 });
}

export const chatSpeakersApi = {
  refreshAll,
  /** Console check for one message: speaker, chosen user and color, portrait. */
  check(messageId) {
    const message = game.messages.get(messageId) ?? game.messages.contents.at(-1);
    if (!message) return null;
    const actor = message.speakerActor;
    const user = actor ? speakerUser(message, actor) : null;
    return {
      message: message.id,
      style: message.style,
      speaker: actor?.name ?? null,
      author: message.author?.name ?? null,
      user: user?.name ?? null,
      color: colorOf(user),
      image: actor ? speakerImage({ token: speakerToken(message), prototype: actor.prototypeToken, actorImg: actor.img }) : null,
      settings: { colors: setting(COLORS), portraits: setting(PORTRAITS) },
    };
  },
};

export function registerChatSpeakerColors() {
  Hooks.once("init", () => {
    for (const [key, label] of [[COLORS, "Colors"], [PORTRAITS, "Portraits"]]) {
      game.settings.register(MODULE_ID, key, {
        name: `DSLF.ChatSpeakers.Settings.${label}.Name`,
        hint: `DSLF.ChatSpeakers.Settings.${label}.Hint`,
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: () => refreshAll(),
      });
    }

    Hooks.on("renderChatMessageHTML", (message, html) => {
      try {
        applyMessage(message, html instanceof HTMLElement ? html : html?.[0]);
      } catch (err) {
        console.error(`${MODULE_ID} | Fix 17: coloring message ${message?.id} failed`, err);
      }
    });
    Hooks.on("updateUser", (user, changes) => {
      if ("color" in changes || "character" in changes) queueRefresh();
    });
    Hooks.on("updateActor", (actor, changes) => {
      if ("ownership" in changes) queueRefresh();
    });
    document.addEventListener("click", onDocumentClick, true);
    console.log(`${MODULE_ID} | Fix 17: player colors and token portraits on chat cards`);
  });
}
