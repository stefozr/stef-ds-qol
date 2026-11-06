/**
 * Fix 13 — compact ability cards in chat (client option, on by default).
 *
 * Symptom: an ability card is a stack of boxes. The ability text has tray headers ("EFFECT", "POWER ROLL TIERS",
 * "EFFECT (AFTER)", the last one even when the ability has no after-effect), every Draw Steel: Combat Tools enhanced
 * ability shows a "Reveal" button with the note "Draw Steel: Combat Tools automates part of this…", and the roll
 * result is its own block (tier box, a big dice box with an expander, then "12-16 6 damage").
 *
 * Card structure: the system renders `li.chat-message.draw-steel > header + section[data-message-part]*`
 * (draw-steel.mjs StandardModel#renderHTML :14750-14781). The abilityUse part holds
 * `document-embed.draw-steel.ability > h5 + section.metadata + section.effect.before + section.powerResult? +
 * section.effect.after` (AbilityModel#toEmbed :6125, templates/embeds/item/ability.hbs; both effect sections are
 * always rendered). The abilityResult part holds `.message-part-rolls` (one `.dice-roll` per roll, templates/rolls/
 * power.hbs) and `.message-part-html > dl.power-roll-display > dt.tierN + dd` (ability-result.hbs). Draw Steel Plus'
 * improved chat swaps the part templates (`.chat-card.ability-card > .card-embed`, `.chat-card.result-card >
 * .card-rolls + section.card-result > dl.power-roll-display`) and wraps the embed sections in
 * `div.dsp-collapsible-tray > label + .tray-content > .tray-inner` (draw-steel-plus scripts/chat.js :124-207).
 * The Combat Tools note is pack data: `<section class="secret">` in the ability's effect text; core wraps it in a
 * `<secret-block>` that adds `button.reveal` once connected.
 *
 * Mechanism: one post-render pass in `renderChatMessageHTML`, registered inside `Hooks.once("init")` so it runs after
 * Draw Steel Plus and Draw Steel: Battle Log (both register at module top level) and before Target Damage (`ready`):
 *   - the trays are unwrapped, empty effect sections removed, each effect's label inlined ("Effect: …");
 *   - the Combat Tools note is removed (before the li is connected, so no Reveal button is ever created);
 *   - the metadata becomes one line after the name ("Main Action · Melee 1 · 2 creatures · Melee, Strike, Weapon"),
 *     the trigger its own line, the story text a small line;
 *   - the tier table is folded behind "tiers" (a toggle on the result line when the card has one);
 *   - the result part becomes one line: dice total, tier, the system's tier box and the result text, then "tiers" and
 *     the system's "⋮" menu (moved, never cloned: the system's ContextMenu is delegated on the part section); the dice
 *     open from the dice total: Draw Steel: Battle Log's dice-image row when its "power roll results" option built one
 *     (it runs before us and had put it in the tier section), else the stock dice boxes.
 * Draw Steel 1.2 target results: a roll with targets makes one `targetResult` part per target instead of one
 * `abilityResult` (draw-steel.mjs TargetResultPart, templates/sidebar/chat/parts/target-result.hbs): `section[data-message-part]
 * > .message-part-header (img, .targetName, a[data-action=resultPartContext]) + .message-part-flavor? + .message-part-rolls
 * (one `.dice-roll` per roll: the power row, then one damage/heal row per DamageRoll, then Combat Tools' `.dsct-effect-roll`
 * and forced-movement rows) + .message-part-potency? + footer.message-part-buttons?`. Each target becomes ONE header line
 * ("[img] Name  dice total  Tier N  [apply damage + ctlib undo]  ⋮"); the power row and the damage rows fold behind the
 * dice total, and the CSS hides ctlib's undo when the card has stef-ds-automation's section (`.ds-auto-resolution`, which
 * has the undo). Such a card (`dslf-target-card`, no result line) keeps the ability block's own "Power Roll · tiers" bar:
 * the tier table opens inside the expanded ability and collapses with it. Conditions the Automation section has a row
 * for (a `condition` op of that part, effect id and power-roll effect in `flags["stef-ds-automation"].resolution`, any
 * status, or a button its ui/part-lock.mjs marked `ds-auto-locked`) show there only: Combat Tools' "Applied Effect" row
 * (`.dsct-effect-roll`) and footer effect buttons are hidden while the card shows that section.
 * The rows are never removed or reordered (Combat Tools indexes `.message-part-rolls > .dice-roll` by roll index):
 * only the apply buttons (with their ctlib `.ctlib-split` wrapper, whose handlers are bound per element) are moved into the
 * header and the rows are hidden by CSS. Effect rows, forced movement, the target text, potency lines and the footer stay.
 * This pass runs in `Hooks.once("ready")`, after Combat Tools and ctlib (both register at init) added their badges/undo.
 * Draw Steel: Battle Log's other chat options compose: its inlined "Effect:" labels are kept as they are, its
 * name-click collapse still hides everything under the name (our meta line included), its metadata fitting finds the
 * metadata gone and does nothing.
 * Wrappers other modules look for stay in place (`section[data-message-part]`, `.message-part-html`,
 * `footer.message-part-buttons`, `.card-buttons`, the `section.effect` / `section.powerResult` elements).
 * Clicks go through ONE capture-phase listener on `document` (other modules clone or re-render cards after render;
 * per-node listeners do not survive that). Open tier tables and dice are remembered per message for the session.
 */

import { MODULE_ID } from "../shared.mjs";

const SETTING = "compactAbilityCards";
const EMBED_SELECTOR = "section[data-message-part] document-embed.ability, .message-content document-embed.ability";
const TRAY_SELECTOR = ".dsp-collapsible-tray, .dslf-tray";
const EFFECT_SECTIONS = "section.effect.before, section.effect.after, section.spend";
const NOTE_LINK = 'a[href*="draw-steel-combat-tools/wiki"]';

/** "<messageId>:<embedIndex>" of tier tables the user opened. */
const openTiers = new Set();
/** "<messageId>:<partId>" of result parts whose dice the user opened. */
const openRolls = new Set();

export function enabled() {
  try {
    return game.settings.get(MODULE_ID, SETTING) !== false;
  } catch (_err) {
    return false;
  }
}

/* -------------------------------------------------- */
/*  Pure helpers (tests/compact-ability-cards.mjs)    */
/* -------------------------------------------------- */

export const isCombatToolsNote = (text) => /Combat Tools automates/i.test(String(text ?? ""));

export const cleanText = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

/** Ordered, non-empty segments of the one-line metadata. */
export function metaSegments({ resource = "", type = "", distance = "", target = "", keywords = "" } = {}) {
  return [
    ["resource", resource], ["type", type], ["distance", distance], ["target", target], ["keywords", keywords],
  ].map(([cls, text]) => ({ cls, text: cleanText(text) })).filter(s => s.text);
}

/** "13", or "Arixx 13 · Goblin 9" for several rolls. */
export function rollSummary(rolls = []) {
  const list = rolls.map(r => ({ header: cleanText(r?.header), total: cleanText(r?.total) })).filter(r => r.total);
  if (list.length <= 1) return list[0]?.total ?? "";
  return list.map(r => (r.header ? `${r.header} ${r.total}` : r.total)).join(" · ");
}

/** "Tier 2 (1 edge)" → "Tier 2". */
export const tierLabelText = (text) => cleanText(String(text ?? "").replace(/\([^)]*\)\s*$/, ""));

/** The inline label of an effect: "Effect:" before its text, the bare label when it has none. */
export function effectLabel(label, hasBody = true) {
  const text = cleanText(label);
  if (!text) return "";
  if (!hasBody) return text;
  return /[:.!?]$/.test(text) ? text : `${text}:`;
}

export const hasText = (text, hasMedia = false) => cleanText(text).length > 0 || !!hasMedia;

/** Indexes of the rolls `isDamage` accepts: the damage (and heal) rows of a target part, by roll index. */
export function damageRollIndexes(rolls = [], isDamage = () => false) {
  const out = [];
  (rolls ?? []).forEach((roll, i) => { if (isDamage(roll)) out.push(i); });
  return out;
}

/* -------------------------------------------------- */
/*  DOM                                               */
/* -------------------------------------------------- */

const textOf = (el) => cleanText(el?.textContent);
const localize = (key, fallback) => {
  const text = game.i18n?.localize?.(key);
  return text && text !== key ? text : fallback;
};

function make(doc, tag, className, text) {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  if (text != null) el.textContent = text;
  return el;
}

const sectionHasContent = (section) => hasText(section.textContent, !!section.querySelector("img, button, a.roll-link, [enricher]"));

/** Draw Steel Plus' (or Fix 9's) tray wrappers: the section goes back where the tray was. */
function unwrapTrays(embed) {
  for (const tray of embed.querySelectorAll(TRAY_SELECTOR)) {
    const inner = tray.querySelector(":scope > .tray-content > .tray-inner") ?? tray.querySelector(":scope > .dslf-tray-content");
    if (inner?.childNodes.length) tray.replaceWith(...inner.childNodes);
    else tray.remove();
  }
}

/** Combat Tools' pack note (and its Reveal button). Other secrets stay. */
function removePackNotes(embed) {
  for (const el of embed.querySelectorAll("secret-block, section.secret")) {
    if (!el.isConnected && !embed.contains(el)) continue;
    if (isCombatToolsNote(el.textContent) || el.querySelector(NOTE_LINK)) (el.closest("secret-block") ?? el).remove();
  }
}

function keywordsText(dd) {
  if (!dd) return "";
  const pills = [...dd.querySelectorAll(".dsbl-kw")].map(textOf).filter(Boolean);
  return pills.length ? pills.join(", ") : textOf(dd);
}

function glyphSpan(doc, dt) {
  const glyph = textOf(dt);
  if (!glyph) return null;
  const span = make(doc, "span", "dslf-glyph-sm", glyph);
  const tip = dt.getAttribute("data-tooltip-text");
  if (tip) span.dataset.tooltipText = tip;
  return span;
}

/** section.metadata → one meta line, a trigger line and a small story line after the name. */
function buildMeta(embed, title, doc) {
  const meta = embed.querySelector(":scope > section.metadata");
  if (!meta) return;
  const q = sel => meta.querySelector(sel);
  const segments = metaSegments({
    resource: textOf(q("p.resource")), type: textOf(q("dd.type")), distance: textOf(q("dd.distance")),
    target: textOf(q("dd.target")), keywords: keywordsText(q("dd.keywords")),
  });
  const line = make(doc, "div", "dslf-meta");
  for (const s of segments) {
    const span = make(doc, "span", `dslf-meta-${s.cls}`);
    const glyph = s.cls === "distance" || s.cls === "target" ? glyphSpan(doc, q(`dt.${s.cls}`)) : null;
    if (glyph) span.append(glyph, " ");
    span.append(s.text);
    line.append(span);
  }
  const nodes = [];
  if (segments.length) nodes.push(line);
  const trigger = textOf(q("dd.trigger"));
  if (trigger) {
    const row = make(doc, "div", "dslf-trigger");
    row.append(make(doc, "strong", null, effectLabel(textOf(q("dt.trigger")) || localize("DSLF.Chat.Compact.Trigger", "Trigger"))), " ", trigger);
    nodes.push(row);
  }
  const story = textOf(q("p.flavor"));
  if (story) {
    const p = make(doc, "p", "dslf-flavor");
    p.append(make(doc, "em", null, story));
    nodes.push(p);
  }
  title.after(...nodes);
  meta.remove();
}

/** Effect sections: empty ones go, labels move inline, the section elements stay. */
function compactEffects(embed, doc) {
  for (const section of embed.querySelectorAll(EFFECT_SECTIONS)) {
    if (!sectionHasContent(section)) {
      section.remove();
      continue;
    }
    section.classList.add("dslf-effects");
    for (const dl of section.querySelectorAll(":scope > dl")) {
      if (dl.dataset.dscpInline != null) continue;   // Draw Steel: Battle Log already inlined it
      const dt = dl.querySelector(":scope > dt");
      const dd = dl.querySelector(":scope > dd");
      if (!dt || !dd) continue;
      const label = effectLabel(textOf(dt), hasText(dd.textContent));
      if (label) {
        const strong = make(doc, "strong", "dslf-effect-label", label);
        const first = dd.firstElementChild;
        const host = first && first.tagName === "P" ? first : dd;
        host.prepend(strong, " ");
      }
      dt.remove();
    }
  }
}

/**
 * section.powerResult → a folded tier table with its own bar (hidden when the card has a result line).
 * Draw Steel: Battle Log's "power roll results" option has already put its dice-image row (`.dsbl-pr-rolls`, built from
 * the result part's rolls) in here: it is kept for the result line's dice fold (compactResult).
 */
function compactTiers(embed, key, doc) {
  const section = embed.querySelector("section.powerResult");
  if (!section) return;
  const diceRow = section.querySelector(".dsbl-pr-rolls");
  if (diceRow) {
    diceRow.remove();
    embed.dslfDiceRow = diceRow;
  }
  const table = section.querySelector("dl.power-roll-display");
  const heading = textOf(section.querySelector(":scope > p > strong")) || localize("DSLF.Chat.Compact.PowerRoll", "Power Roll");
  const bar = make(doc, "div", "dslf-tiers-bar");
  bar.append(make(doc, "span", "dslf-tiers-heading", heading), tiersToggle(doc));
  const body = make(doc, "div", "dslf-tiers-body");
  if (table) body.append(table);
  section.replaceChildren(bar, body);
  section.classList.add("dslf-tiers");
  section.dataset.dslfKey = key;
  section.classList.toggle("dslf-open", openTiers.has(key));
}

function tiersToggle(doc) {
  const a = make(doc, "a", "dslf-tiers-toggle");
  a.setAttribute("role", "button");
  a.append(make(doc, "span", null, localize("DSLF.Chat.Compact.Tiers", "tiers")), " ");
  const caret = make(doc, "i", "fa-solid fa-caret-right");
  caret.inert = true;
  a.append(caret);
  return a;
}

function compactEmbed(embed, key) {
  if (embed.dataset.dslfCompact === "1") return false;
  const title = embed.querySelector(":scope > h5");
  if (!title) return false;
  const doc = embed.ownerDocument ?? document;
  unwrapTrays(embed);
  removePackNotes(embed);
  buildMeta(embed, title, doc);
  compactEffects(embed, doc);
  compactTiers(embed, key, doc);
  embed.dataset.dslfCompact = "1";
  return true;
}

/** Parts of the message, whatever collection type the system uses. */
function partsOf(message) {
  const parts = message?.system?.parts;
  if (!parts) return [];
  if (Array.isArray(parts.contents)) return parts.contents;
  if (typeof parts.values === "function") return [...parts.values()];
  return Object.values(parts);
}

/** abilityResult sections of a rendered message with their part (null when only the DOM tells). */
function resultSections(li, message) {
  const out = [];
  for (const part of partsOf(message)) {
    if (part?.type !== "abilityResult") continue;
    const id = part.id ?? part._id;
    const section = id ? li.querySelector(`section[data-message-part="${id}"]`) : null;
    if (section) out.push({ section, part });
  }
  if (out.length || message) return out;
  for (const section of li.querySelectorAll("section[data-message-part]")) {
    if (section.querySelector("document-embed")) continue;
    if (section.querySelector(".message-part-header .targetName")) continue;   // a per-target part, see compactTarget
    if (section.querySelector("dl.power-roll-display") && section.querySelector(".message-part-rolls, .card-rolls")) out.push({ section, part: null });
  }
  return out;
}

/** The dice row an embed of this message kept (Battle Log), once. */
function takeDiceRow(li) {
  for (const embed of li.querySelectorAll("document-embed.ability")) {
    const row = embed.dslfDiceRow;
    if (row) {
      embed.dslfDiceRow = null;
      return row;
    }
  }
  return null;
}

function tierLabelFor(part, rolls) {
  try {
    const label = globalThis.ds?.rolls?.PowerRoll?.RESULT_TIERS?.[`tier${part?.tier}`]?.label;
    if (label) return game.i18n.localize(label);
  } catch (_err) { /* fall back to the roll's own text */ }
  const tier = rolls[0]?.querySelector(".tier");
  if (!tier) return "";
  const copy = tier.cloneNode(true);
  copy.querySelector("em")?.remove();
  return tierLabelText(copy.textContent);
}

function hasDamageRoll(part) {
  try {
    const DamageRoll = globalThis.ds?.rolls?.DamageRoll;
    return (part?.rolls ?? []).some(r => DamageRoll && r instanceof DamageRoll && !r.isHeal);
  } catch (_err) {
    return false;
  }
}

/** The result part → one line: dice total, tier, the tier box and text, then "tiers" and the "⋮" menu. */
function compactResult(li, section, part, messageId) {
  if (section.dataset.dslfCompact === "1") return false;
  const line = section.querySelector("dl.power-roll-display");
  if (!line) return false;   // private roll or missing ability
  const doc = section.ownerDocument ?? document;
  const rolls = [...section.querySelectorAll(".dice-roll")].filter(r => r.querySelector(".tier"));
  const lead = make(doc, "div", "dslf-result-lead");
  const total = rollSummary(rolls.map(r => ({ header: textOf(r.querySelector(".header")), total: textOf(r.querySelector(".dice-total")) })));
  if (total) {
    const toggle = make(doc, "a", "dslf-roll-toggle");
    toggle.setAttribute("role", "button");
    toggle.dataset.tooltip = localize("DSLF.Chat.Compact.ShowRolls", "Show dice");
    const icon = make(doc, "i", "fa-solid fa-dice-d10");
    icon.inert = true;
    toggle.append(icon, " ", make(doc, "span", null, total));
    lead.append(toggle);
  }
  const tier = tierLabelFor(part, rolls);
  if (tier) lead.append(make(doc, "span", "dslf-tier-label", tier));
  if (lead.childNodes.length) line.prepend(lead);

  const tools = make(doc, "div", "dslf-result-tools");
  if (li.querySelector("section.dslf-tiers")) tools.append(tiersToggle(doc));
  const header = section.querySelector(".message-part-header");
  const menu = header?.querySelector('[data-action="resultPartContext"]');
  if (menu) {
    tools.append(menu);
    if (!header.children.length && !textOf(header)) header.remove();
  } else if (!section.querySelector('[data-action="resultPartContext"]') && hasDamageRoll(part)) {
    // Draw Steel Plus' template has no menu for a single roll: the system's ContextMenu is delegated on the section.
    const a = make(doc, "a", "fa-fw fa-solid fa-ellipsis-vertical");
    a.dataset.action = "resultPartContext";
    a.setAttribute("aria-label", localize("DSLF.Chat.Compact.Options", "Options"));
    tools.append(a);
  }
  if (tools.childNodes.length) line.append(tools);

  // Battle Log's dice-image row (kept by compactTiers) becomes the dice fold; the stock boxes stay as the fallback.
  const diceRow = takeDiceRow(li);
  if (diceRow && !section.querySelector(".dslf-dice")) {
    const dice = make(doc, "div", "dslf-dice");
    dice.append(diceRow);
    line.after(dice);
  }

  line.classList.add("dslf-result");
  section.classList.add("dslf-result-part");
  const key = `${messageId}:${section.dataset.messagePart ?? ""}`;
  section.dataset.dslfRollsKey = key;
  section.classList.toggle("dslf-rolls-open", openRolls.has(key));
  section.dataset.dslfCompact = "1";
  li.classList.add("dslf-has-result");
  return true;
}

/** targetResult sections of a rendered message with their part. */
function targetSections(li, message) {
  const out = [];
  for (const part of partsOf(message)) {
    if (part?.type !== "targetResult") continue;
    const id = part.id ?? part._id;
    const section = id ? li.querySelector(`section[data-message-part="${id}"]`) : null;
    if (section) out.push({ section, part });
  }
  return out;
}

/**
 * The condition a target's effect button applies, whoever drew it: the system's `applyEffect` button
 * (`data-effect-id`, `data-uuid` = the power-roll effect) or Combat Tools' replacement (`data-dsct-action="dsct-<x>"`,
 * `dsct-grab` = grabbed; no uuid). `isStatus` keeps Combat Tools' other actions (teleport, forced movement) out.
 * @param {object|null} data   The button's dataset.
 * @param {(id: string) => boolean} [isStatus]
 * @returns {{effectId: string, uuid: string}|null}
 */
export function conditionOfButton(data, isStatus = () => true) {
  if (!data) return null;
  if (data.action === "applyEffect" && data.effectId) return { effectId: String(data.effectId), uuid: String(data.uuid ?? "") };
  const m = /^dsct-(.+)$/.exec(String(data.dsctAction ?? ""));
  if (!m) return null;
  const id = m[1] === "grab" ? "grabbed" : m[1];
  return isStatus(id) ? { effectId: id, uuid: "" } : null;
}

/**
 * Does stef-ds-automation's record have a row for this condition button (same part and effect id, and the same
 * power-roll effect when the button names one; any status: pending, applied, resisted/skipped, undone)? Its Automation
 * row shows the condition and has its own apply button. A button the suite locked (`ds-auto-locked`) counts too.
 * @param {{effectId?: string, uuid?: string}|null} button  conditionOfButton's result.
 * @param {object[]} ops       Ops of the message's `flags["stef-ds-automation"].resolution`.
 * @param {string} partId      The target part's id.
 * @param {boolean} [locked]   The button carries `ds-auto-locked`.
 */
export function suiteHasCondition(button, ops = [], partId = "", locked = false) {
  if (!button) return false;
  if (locked) return true;
  const uuid = String(button.uuid ?? "");
  return (ops ?? []).some(op => op?.kind === "condition" && !op.lib && op.partId === partId && op.effectId === button.effectId
    && (!uuid || (!!op.preId && (uuid === op.preId || uuid.endsWith(`.${op.preId}`)))));
}

const isStatusId = (id) => {
  const list = globalThis.CONFIG?.statusEffects;
  return Array.isArray(list) ? list.some(s => s?.id === id) : true;
};

const suiteOps = (message) => Object.values(message?.flags?.["stef-ds-automation"]?.resolution?.ops ?? {}).filter(Boolean);

const isDamageRoll = (roll) => {
  try {
    const DamageRoll = globalThis.ds?.rolls?.DamageRoll;
    return !!DamageRoll && roll instanceof DamageRoll;
  } catch (_err) {
    return false;
  }
};

/**
 * One target part → one header line: dice total, tier, the apply buttons and the "⋮" menu. The power row and the damage
 * rows stay in place (hidden by CSS until the dice total is clicked); only the buttons are moved.
 */
function compactTarget(li, section, part, message, diceRow) {
  if (section.dataset.dslfCompact === "1") return false;
  const header = section.querySelector(":scope > .message-part-header");
  if (!header) return false;   // private roll
  const doc = section.ownerDocument ?? document;
  const rows = [...section.querySelectorAll(".message-part-rolls > .dice-roll")];
  const powerRow = rows.find(r => r.querySelector(".power-result")) ?? null;
  powerRow?.classList.add("dslf-power-row");

  const lead = make(doc, "span", "dslf-result-lead");
  const damageRows = damageRollIndexes(part?.rolls, isDamageRoll).map(i => rows[i]).filter(row => row && row !== powerRow);
  const total = textOf(powerRow?.querySelector(".dice-total"));
  if (total || damageRows.length || diceRow) {
    const toggle = make(doc, "a", "dslf-roll-toggle");
    toggle.setAttribute("role", "button");
    toggle.dataset.tooltip = localize("DSLF.Chat.Compact.ShowRolls", "Show dice");
    const icon = make(doc, "i", "fa-solid fa-dice-d10");
    icon.inert = true;
    toggle.append(icon);
    if (total) toggle.append(" ", make(doc, "span", null, total));
    lead.append(toggle);
  }
  const tier = tierLabelFor(part, powerRow ? [powerRow] : []);
  if (tier) lead.append(make(doc, "span", "dslf-tier-label", tier));
  const name = header.querySelector(".targetName");
  if (lead.childNodes.length) {
    if (name) name.after(lead);
    else header.append(lead);
  }

  const apply = make(doc, "span", "dslf-target-apply");
  for (const row of damageRows) {
    row.classList.add("dslf-damage-row");
    const btn = row.querySelector('[data-action="applyDamage"]');
    if (btn) apply.append(btn.closest(".ctlib-split") ?? btn);
    else {
      const text = textOf(row.querySelector("h4.dice-total"));
      if (text) apply.append(make(doc, "span", "dslf-target-total", text));
    }
  }
  if (apply.childNodes.length) header.append(apply);
  const menu = header.querySelector('[data-action="resultPartContext"]');
  if (menu) header.append(menu);   // moved, never cloned: the system's ContextMenu is delegated on the part section

  // Conditions the Automation section has a row for show there only: Combat Tools' "Applied Effect" rows and the footer's
  // condition buttons (the system's or Combat Tools' own) are marked here and hidden by CSS while the card shows that section.
  const ops = suiteOps(message);
  const partId = section.dataset.messagePart ?? "";
  const owned = (btn) => !!btn && suiteHasCondition(conditionOfButton(btn.dataset, isStatusId), ops, partId, btn.classList.contains("ds-auto-locked"));
  for (const row of section.querySelectorAll(":scope > .message-part-rolls > .dsct-effect-roll")) {
    const btns = [...row.querySelectorAll("button")].filter(b => conditionOfButton(b.dataset, isStatusId));
    if (btns.length && btns.every(owned)) row.classList.add("dslf-suite-row");
  }
  for (const child of section.querySelectorAll(":scope > footer.message-part-buttons > *")) {
    // A footer child is a button, ctlib's split (button + undo) or Battle Log's row of buttons.
    const btns = child.matches?.("button") ? [child] : [...(child.querySelectorAll?.("button") ?? [])].filter(b => !b.matches(".ctlib-undo"));
    const marked = btns.filter(b => conditionOfButton(b.dataset, isStatusId) && owned(b));
    if (!marked.length) continue;
    if (marked.length === btns.length) child.classList.add("dslf-suite-btn");
    else for (const b of marked) (b.closest(".ctlib-split") ?? b).classList.add("dslf-suite-btn");
  }

  if (diceRow && !section.querySelector(".dslf-dice")) {
    const dice = make(doc, "div", "dslf-dice");
    dice.append(diceRow);
    header.after(dice);
  }

  section.classList.add("dslf-target-part");
  const key = `${message?.id ?? li.dataset?.messageId ?? ""}:${section.dataset.messagePart ?? ""}`;
  section.dataset.dslfRollsKey = key;
  section.classList.toggle("dslf-rolls-open", openRolls.has(key));
  section.dataset.dslfCompact = "1";
  li.classList.add("dslf-compact");
  return true;
}

/**
 * Compact the per-target parts of one rendered message (Draw Steel 1.2). Idempotent. Runs from the `ready` hook.
 * @returns {number} Target parts transformed.
 */
export function applyTargets(li, message) {
  if (!li?.querySelectorAll) return 0;
  const targets = targetSections(li, message);
  if (!targets.length) return 0;
  // Battle Log's dice row (parked by compactTiers) goes to the first target when no abilityResult part could take it.
  const takesDice = !partsOf(message).some(p => p?.type === "abilityResult");
  // No result line: the tiers button stays the ability block's own bar (css: dslf-target-card).
  if (takesDice) li.classList.add("dslf-target-card");
  let count = 0;
  for (const { section, part } of targets) {
    const diceRow = takesDice && count === 0 && section.dataset.dslfCompact !== "1" ? takeDiceRow(li) : null;
    if (compactTarget(li, section, part, message, diceRow)) count++;
  }
  return count;
}

/**
 * Compact one rendered message. Idempotent: every step checks its marker.
 * @returns {number} Embeds and result parts transformed.
 */
export function applyMessage(li, message) {
  if (!li?.querySelectorAll) return 0;
  const messageId = message?.id ?? li.dataset?.messageId ?? "";
  let count = 0;
  [...li.querySelectorAll(EMBED_SELECTOR)].forEach((embed, i) => { if (compactEmbed(embed, `${messageId}:${i}`)) count++; });
  for (const { section, part } of resultSections(li, message)) if (compactResult(li, section, part, messageId)) count++;
  if (count || li.querySelector('[data-dslf-compact="1"]')) li.classList.add("dslf-compact");
  return count;
}

/** In-place pass over every rendered message (console helper; new renders are handled by the hook). */
export function applyAll({ log = false } = {}) {
  if (!enabled()) return 0;
  let count = 0;
  for (const li of document.querySelectorAll("li.chat-message[data-message-id]")) {
    const message = game.messages?.get(li.dataset.messageId);
    count += applyMessage(li, message);
    count += applyTargets(li, message);
  }
  if (log) console.log(`${MODULE_ID} | Fix 13: compacted ${count} ability card part(s).`);
  return count;
}

const isAbilityMessage = (message) => partsOf(message).some(p => p?.type === "abilityUse" || p?.type === "abilityResult" || p?.type === "targetResult");

/** Re-render every rendered ability message (the setting changed: stock or compact again). */
export function rerenderAll() {
  const seen = new Set();
  for (const li of document.querySelectorAll("li.chat-message[data-message-id]")) {
    const id = li.dataset.messageId;
    if (seen.has(id)) continue;
    seen.add(id);
    const message = game.messages?.get(id);
    if (message && isAbilityMessage(message)) globalThis.ui?.chat?.updateMessage?.(message)?.catch?.(() => {});
  }
}

/** Per rendered ability message: what the compact pass left behind (for "If a package updates"). */
export function check({ log = true } = {}) {
  const rows = [];
  for (const li of document.querySelectorAll("li.chat-message[data-message-id]")) {
    const message = game.messages?.get(li.dataset.messageId);
    if (!message || !isAbilityMessage(message)) continue;
    const results = resultSections(li, message);
    const expectLine = results.some(r => r.section.querySelector("dl.power-roll-display"));
    const targets = targetSections(li, message);
    rows.push({
      id: li.dataset.messageId,
      where: li.closest("#chat-notifications") ? "notification" : li.closest(".chat-popout") ? "popout" : "log",
      compact: li.classList.contains("dslf-compact"),
      traysLeft: li.querySelectorAll(TRAY_SELECTOR).length,
      packNotesLeft: [...li.querySelectorAll("document-embed.ability :is(secret-block, section.secret)")].filter(el => isCombatToolsNote(el.textContent)).length,
      meta: !!li.querySelector("document-embed.ability > .dslf-meta"),
      resultLine: !!li.querySelector("dl.dslf-result"),
      resultExpected: expectLine,
      dice: li.querySelector(".dslf-dice") ? "battle-log" : li.querySelector(".dslf-result-part .dice-roll") ? "core" : null,
      targetLines: li.querySelectorAll("section.dslf-target-part").length,
      targetsExpected: targets.filter(t => t.section.querySelector(":scope > .message-part-header")).length,
      diceRowStranded: [...li.querySelectorAll("document-embed.ability")].some(embed => !!embed.dslfDiceRow),
      menus: results.map(r => r.section.querySelectorAll('.dslf-result-tools [data-action="resultPartContext"]').length),
    });
  }
  if (log) console.table(rows);
  return rows;
}

export const compactCardsApi = { applyAll: () => applyAll({ log: true }), check, rerenderAll };

/* -------------------------------------------------- */
/*  Clicks                                            */
/* -------------------------------------------------- */

function onDocumentClick(event) {
  const toggle = event.target?.closest?.(".dslf-tiers-toggle, .dslf-roll-toggle");
  if (!toggle) return;
  const li = toggle.closest("li.chat-message");
  if (!li) return;
  event.preventDefault();
  event.stopPropagation();

  if (toggle.matches(".dslf-tiers-toggle")) {
    const tables = [...li.querySelectorAll("section.dslf-tiers")];
    const open = !tables.some(t => t.classList.contains("dslf-open"));
    for (const t of tables) {
      t.classList.toggle("dslf-open", open);
      if (!t.dataset.dslfKey) continue;
      if (open) openTiers.add(t.dataset.dslfKey);
      else openTiers.delete(t.dataset.dslfKey);
    }
    return;
  }
  const section = toggle.closest("section[data-message-part]");
  if (!section) return;
  const open = section.classList.toggle("dslf-rolls-open");
  const key = section.dataset.dslfRollsKey;
  if (key) {
    if (open) openRolls.add(key);
    else openRolls.delete(key);
  }
}

/* -------------------------------------------------- */
/*  Registration                                      */
/* -------------------------------------------------- */

export function registerCompactAbilityCards() {
  Hooks.once("init", () => {
    game.settings.register(MODULE_ID, SETTING, {
      name: "DSLF.Chat.Settings.CompactAbilityCards.Name",
      hint: "DSLF.Chat.Settings.CompactAbilityCards.Hint",
      scope: "client",
      config: true,
      type: Boolean,
      default: true,
      onChange: () => rerenderAll(),
    });

    Hooks.on("renderChatMessageHTML", (message, html) => {
      if (!enabled()) return;
      const li = html instanceof HTMLElement ? html : html?.[0];
      try {
        applyMessage(li, message);
      } catch (err) {
        console.error(`${MODULE_ID} | Fix 13: compacting message ${message?.id} failed`, err);
      }
    });
    document.addEventListener("click", onDocumentClick, true);
    console.log(`${MODULE_ID} | Fix 13: ability chat cards are compact (client setting "${SETTING}").`);
  });

  // Draw Steel 1.2 target parts: after Combat Tools and ctlib (init hooks) added their badges and undo buttons.
  Hooks.once("ready", () => {
    Hooks.on("renderChatMessageHTML", (message, html) => {
      if (!enabled()) return;
      const li = html instanceof HTMLElement ? html : html?.[0];
      try {
        applyTargets(li, message);
      } catch (err) {
        console.error(`${MODULE_ID} | Fix 13: compacting target results of message ${message?.id} failed`, err);
      }
    });
    try {
      applyAll();   // messages rendered before ready
    } catch (err) {
      console.error(`${MODULE_ID} | Fix 13: compacting target results failed`, err);
    }
  });
}
