/**
 * Fix 9 — collapse ability card descriptions in chat (client option).
 *
 * Symptom: every ability use prints the whole ability text in chat (keywords, distance, target, all
 * effect paragraphs, power-roll tiers) and floods the log. dnd5e has "Collapse Item Cards in Chat";
 * Draw Steel 1.1.2 has nothing comparable.
 *
 * Card structure (draw-steel.mjs:19778-19805, AbilityModel#toEmbed :6125-6149,
 * templates/embeds/item/ability.hbs): the ability-use message part renders a
 * `document-embed.draw-steel.ability` whose first child is `<h5>Name</h5>`, followed by
 * `section.metadata` (resource, flavor, keywords/type/distance/target/trigger), `section.effect.before`,
 * optional `section.powerResult`, `section.effect.after`; effect sections hold `dl > dt + dd` pairs.
 * The stock part template wraps the embed in `.message-part-html`, Draw Steel Plus' improved-chat
 * template override in `.chat-card.ability-card .card-embed`; every part sits in
 * `section[data-message-part]`. Draw Steel Plus also wraps the power-roll / spend / effect sections in
 * `div.dsp-collapsible-tray > label + .tray-content` (class `collapsed` hides the content).
 *
 * Mechanism: client setting `collapseAbilityCards`:
 *   off      — nothing is changed.
 *   effects  — the summary stays visible; every effect / power-roll section becomes a collapsed header
 *              (Draw Steel Plus' tray when present, otherwise our own `.dslf-tray`); clicking a header
 *              opens that section, clicking the ability name opens or closes all of them.
 *   all      — the whole card is collapsed behind the ability name; clicking the card expands it,
 *              clicking the name collapses it again.
 * Sections and cards the user opened are remembered per session so a re-render keeps them open.
 * All clicks go through ONE delegated capture-phase listener on `document`: other modules clone or
 * rewrite cards after render (which drops per-node listeners but keeps classes), and stopping
 * propagation for tray headers keeps Draw Steel Plus' own label listener from toggling them back.
 *
 * 1.12.0: with Draw Steel: Battle Log's "collapsible abilities" on, "all" hands the title to Battle Log. Both fixes
 * toggled on the same click (its listener sits on the h5, ours on document), so the card stayed hidden and the two
 * carets swapped. Now there is one caret (Battle Log's); a card created after this client loaded starts collapsed
 * once, through Battle Log's own click handler (a non-bubbling click on the title), so its state and storage agree.
 */

import { MODULE_ID } from "../shared.mjs";

const SETTING = "collapseAbilityCards";
const MODES = ["off", "effects", "all"];
const SECTION_SELECTOR = "section.effect.before, section.effect.after, section.powerResult, section.spend";
const TRAY_SELECTOR = ".dslf-tray, .dsp-collapsible-tray";
const TRAY_LABEL_SELECTOR = ".dslf-tray > .dslf-tray-label, .dsp-collapsible-tray > label";

/** Message ids whose card the user expanded in "all" mode. */
const expandedCards = new Set();
/** "all" with Battle Log: message ids this client collapsed once already (a later re-render keeps the user's choice). */
const seededCards = new Set();
const loadedAt = Date.now();

/** Does Battle Log fold ability cards itself (its "collapsible abilities")? Then "all" defers to it. */
export function battleLogCollapses() {
  if (!game.modules?.get?.("draw-steel-battle-log")?.active) return false;
  try {
    return !!game.settings.get("draw-steel-battle-log", "collapsibleAbilities");
  } catch (_err) {
    return false;
  }
}
/** "<messageId>:<n>" keys of sections the user opened in "effects" mode. */
const expandedSections = new Set();

function currentMode() {
  try {
    const value = game.settings.get(MODULE_ID, SETTING);
    return MODES.includes(value) ? value : "off";
  } catch (_err) {
    return "off";
  }
}

/* -------------------------------------------------- */
/*  DOM helpers                                       */
/* -------------------------------------------------- */

function ensureCaret(title) {
  if (title.querySelector(".dslf-caret")) return;
  const caret = document.createElement("i");
  caret.className = "fa-solid fa-caret-down dslf-caret";
  caret.inert = true;
  title.appendChild(caret);
}

function removeCaret(title) {
  title.querySelector(".dslf-caret")?.remove();
}

function sectionLabel(section) {
  if (section.matches("section.powerResult")) return "Power Roll";
  const text = section.querySelector("dt")?.textContent?.trim();
  if (text) return text;
  return section.matches("section.spend") ? "Spend" : "Effect";
}

const hasContent = (section) => (section.textContent.trim().length > 0) || !!section.querySelector("img, button");

/** The tray (Draw Steel Plus' or ours) around a section, creating ours when there is none. */
function trayFor(embed, section) {
  const existing = section.closest(TRAY_SELECTOR);
  if (existing && embed.contains(existing)) return existing;

  const tray = document.createElement("div");
  tray.className = "dslf-tray";
  const label = document.createElement("div");
  label.className = "dslf-tray-label";
  const caret = document.createElement("i");
  caret.className = "fa-solid fa-caret-down";
  caret.inert = true;
  const text = document.createElement("span");
  text.textContent = sectionLabel(section);
  label.append(caret, text);
  const content = document.createElement("div");
  content.className = "dslf-tray-content";

  section.before(tray);
  content.appendChild(section);
  tray.append(label, content);
  return tray;
}

/** Remove our own tray wrappers again (Draw Steel Plus' trays are left alone). */
function unwrapOurTrays(embed) {
  for (const tray of embed.querySelectorAll(".dslf-tray")) {
    const inner = tray.querySelector(":scope > .dslf-tray-content > *");
    if (inner) tray.replaceWith(inner);
    else tray.remove();
  }
}

function rememberTray(tray, collapsed) {
  const key = tray.dataset.dslfKey;
  if (!key) return;
  if (collapsed) expandedSections.delete(key);
  else expandedSections.add(key);
}

/* -------------------------------------------------- */
/*  Applying the mode                                 */
/* -------------------------------------------------- */

function applyEmbed(embed, messageId, mode) {
  const title = embed.querySelector(":scope > h5");
  if (!title) return;
  // Fix 13 (compact cards) already turned the sections into inline text and a folded tier table.
  if (mode === "effects" && embed.dataset.dslfCompact === "1") mode = "off";

  embed.classList.remove("dslf-collapsible", "dslf-collapsed", "dslf-sections");

  if (mode === "off") {
    delete embed.dataset.dslfMode;
    delete embed.dataset.dslfMessageId;
    removeCaret(title);
    title.removeAttribute("aria-expanded");
    unwrapOurTrays(embed);
    return;
  }

  embed.dataset.dslfMode = mode;
  if (messageId) embed.dataset.dslfMessageId = messageId;
  ensureCaret(title);

  if (mode === "all" && battleLogCollapses()) {
    delete embed.dataset.dslfMode;
    removeCaret(title);
    title.removeAttribute("aria-expanded");
    unwrapOurTrays(embed);
    seedBattleLog(embed, title, messageId);
    return;
  }

  if (mode === "all") {
    unwrapOurTrays(embed);
    embed.classList.add("dslf-collapsible");
    const collapsed = !expandedCards.has(messageId);
    embed.classList.toggle("dslf-collapsed", collapsed);
    title.setAttribute("aria-expanded", String(!collapsed));
    return;
  }

  // "effects": summary stays, each section becomes a collapsed header
  embed.classList.add("dslf-sections");
  let index = 0;
  let anyOpen = false;
  for (const section of embed.querySelectorAll(SECTION_SELECTOR)) {
    if (!hasContent(section)) continue;
    const tray = trayFor(embed, section);
    const key = `${messageId}:${index++}`;
    tray.dataset.dslfKey = key;
    const open = expandedSections.has(key);
    tray.classList.toggle("collapsed", !open);
    if (open) anyOpen = true;
  }
  title.setAttribute("aria-expanded", String(anyOpen));
}

/**
 * "all" with Battle Log: collapse a card created after this client loaded, once, by clicking its title the way the
 * user would (Battle Log's listener sits on the h5 and stores the state). Older cards keep Battle Log's stored state.
 */
function seedBattleLog(embed, title, messageId) {
  if (!messageId || !title.classList.contains("dsbl-ability-name")) return;
  const key = `${messageId}:${embed.dataset.dslfIndex ?? 0}`;
  if (seededCards.has(key)) return;
  seededCards.add(key);
  const created = Number(game.messages?.get?.(messageId)?.timestamp ?? 0);
  if (created < loadedAt || embed.classList.contains("dsbl-collapsed")) return;
  title.dispatchEvent(new MouseEvent("click", { bubbles: false, cancelable: true }));
}

/**
 * Ability embeds of a rendered message, whatever wraps them: the system's stock part template puts
 * the embed in `.message-part-html`, Draw Steel Plus' override in `.chat-card.ability-card .card-embed`.
 */
function abilityEmbeds(li) {
  const found = new Set();
  for (const embed of li.querySelectorAll("section[data-message-part] document-embed.ability, .message-content document-embed.ability")) {
    found.add(embed);
  }
  return found;
}

function applyMessage(li, messageId, mode = currentMode()) {
  if (!li?.querySelectorAll) return 0;
  const embeds = abilityEmbeds(li);
  // Battle Log keys its stored state by the embed's index among the message's ability embeds.
  const order = [...li.querySelectorAll("document-embed.draw-steel.ability")];
  for (const embed of embeds) {
    const i = order.indexOf(embed);
    if (i >= 0) embed.dataset.dslfIndex = String(i);
    applyEmbed(embed, messageId, mode);
  }
  return embeds.size;
}

/**
 * Re-apply the current mode to every rendered chat message (log, popouts, notifications).
 * @param {object} [options]
 * @param {boolean} [options.log=false]  Log how many cards were processed (console helper).
 * @returns {number} Number of ability cards processed.
 */
export function applyAll({ log = false } = {}) {
  const mode = currentMode();
  let count = 0;
  for (const li of document.querySelectorAll("li.chat-message[data-message-id]")) {
    count += applyMessage(li, li.dataset.messageId, mode);
  }
  if (log) console.log(`${MODULE_ID} | Fix 9: re-applied "${mode}" to ${count} ability card(s).`);
  return count;
}

export const collapseCardsApi = { applyAll: () => applyAll({ log: true }) };

/* -------------------------------------------------- */
/*  Clicks                                            */
/* -------------------------------------------------- */

function onDocumentClick(event) {
  const target = event.target;
  if (!target?.closest) return;
  const embed = target.closest("document-embed.ability[data-dslf-mode]");
  if (!embed) return;
  if (target.closest("a, button, input, select, textarea, [data-action]")) return;

  const mode = embed.dataset.dslfMode;
  const title = embed.querySelector(":scope > h5");
  const onHeading = !!target.closest("document-embed.ability > h5");

  if (mode === "all") {
    // collapsed card: any click expands (only the heading is visible); expanded card: heading collapses
    const collapsed = embed.classList.contains("dslf-collapsed");
    if (!collapsed && !onHeading) return;
    const nowCollapsed = embed.classList.toggle("dslf-collapsed");
    title?.setAttribute("aria-expanded", String(!nowCollapsed));
    const id = embed.dataset.dslfMessageId ?? embed.closest("li.chat-message")?.dataset.messageId;
    if (id) {
      if (nowCollapsed) expandedCards.delete(id);
      else expandedCards.add(id);
    }
    return;
  }

  if (mode !== "effects") return;

  // A section header: toggle just that section and own the click (Draw Steel Plus must not toggle it back)
  const label = target.closest(TRAY_LABEL_SELECTOR);
  if (label && embed.contains(label)) {
    const tray = label.parentElement;
    const nowCollapsed = tray.classList.toggle("collapsed");
    rememberTray(tray, nowCollapsed);
    event.stopPropagation();
    return;
  }

  // The ability name: open every section if any is closed, otherwise close all
  if (onHeading) {
    const trays = [...embed.querySelectorAll(TRAY_SELECTOR)].filter(t => t.dataset.dslfKey);
    if (!trays.length) return;
    const anyCollapsed = trays.some(t => t.classList.contains("collapsed"));
    for (const tray of trays) {
      tray.classList.toggle("collapsed", !anyCollapsed);
      rememberTray(tray, !anyCollapsed);
    }
    title?.setAttribute("aria-expanded", String(anyCollapsed));
  }
}

/* -------------------------------------------------- */
/*  Registration                                      */
/* -------------------------------------------------- */

export function registerCollapseAbilityCards() {
  Hooks.once("init", () => {
    game.settings.register(MODULE_ID, SETTING, {
      name: "DSLF.Chat.Settings.CollapseAbilityCards.Name",
      hint: "DSLF.Chat.Settings.CollapseAbilityCards.Hint",
      scope: "client",
      config: true,
      type: String,
      choices: {
        off: "DSLF.Chat.Settings.CollapseAbilityCards.Off",
        effects: "DSLF.Chat.Settings.CollapseAbilityCards.Effects",
        all: "DSLF.Chat.Settings.CollapseAbilityCards.All",
      },
      default: "off",
      onChange: () => applyAll(),
    });

    Hooks.on("renderChatMessageHTML", (message, html) => applyMessage(html, message?.id));
    document.addEventListener("click", onDocumentClick, true);
    console.log(`${MODULE_ID} | Fix 9: ability chat cards can be collapsed (client setting "${SETTING}").`);
  });
}
