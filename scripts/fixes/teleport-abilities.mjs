/**
 * Fix 3 — hero self-teleport abilities carry Combat Tools teleport automation.
 *
 * Draw Steel: Combat Tools (DSCT) only offers its teleport button (distance preset, animation,
 * undo) when the actor's own ability item has a special effect of type `dsct.flatTeleport`
 * in `system.effects` (DSCT src/ability-automation/flat-special-effects.mjs:567-619 and
 * 1533-1566; src/compat/dstd-compat.mjs:1293-1323). Its own "enhanced abilities" pack entry for
 * Black Ash Teleport (packs/_source/enhanced-abilities/DSCTenhBlkAshTp1.json) ships without
 * one, and DSCT's pack refresh (`applyEnhanced`, src/setup-macros.mjs:296-320) overwrites the
 * item from the pack and deletes any typed-map entry the pack lacks (`_retypeSafe`, 177-201,
 * via `foundry.data.operators.ForcedDeletion`). So the effect has to be re-asserted from
 * outside the module.
 *
 * What this fix does (GM client only for writes):
 *   - TABLE: hand-written distances by `system._dsid` (Black Ash Teleport: 5 + insight spent;
 *     DSCT replaces `@spend` with the number in the chat flavor "Spent N ...",
 *     flat-special-effects.mjs:640-648).
 *   - Auto-detection: an ability on a hero (or in the sidebar) whose non-power effect text says
 *     "you teleport up to N squares" gets a self teleport of N squares. "Teleport the target"
 *     never matches. A `spend` effect mentioning "additional square(s)" adds `@spend` per
 *     resource spent.
 *   - Rule: ensure at least ONE `dsct.flatTeleport` exists. If DSCT (or a GM) adds its own,
 *     ours is not added, and a deletion of ours is only reverted when nothing else would remain.
 *   - Hooks: `preCreateItem` seeds new copies; `preUpdateItem` swaps DSCT's ForcedDeletion of
 *     our entry for the data again; `ready` repairs existing items; `createItem`/`updateItem`
 *     converge anything the pre-hooks missed. Typed-map updates merge per key (core
 *     fields.mjs:2192-2199), so only the explicit deletion needs handling.
 *   - Retired per ability (1.7.0): when the ability library of Stef's Automation Suite for Draw Steel
 *     automates the ability's teleport (an overlay with a teleport effect, e.g. its
 *     black-ash-teleport), the library's card row does the teleport with undo. This fix then adds
 *     nothing, lets DSCT's refresh delete our entry, and removes the entry it added earlier, so
 *     there is never a second teleport button.
 */

import { MODULE_ID, dsctActive } from "../shared.mjs";

/** 16 alphanumerics, as pseudo-document ids must be. */
export const EFFECT_ID = "dslfTeleport0001";
const FLAT_TYPE = "dsct.flatTeleport";
const TIERED_TYPE = "dsctTeleport";

/** Hand-written distances by `system._dsid`; these win over auto-detection. */
const TABLE = {
  "black-ash-teleport": "5 + @spend",
};

const SELF_TELEPORT = /\byou (?:can |may )?teleport (?:up to )?(\d+) squares?/i;
const ADDITIONAL = /(\d+)?\s*additional squares?/i;

/** @param {string} distance  A deterministic formula; `@spend` is resolved by DSCT at render time. */
export const teleportEffect = (distance) => ({
  _id: EFFECT_ID,
  type: FLAT_TYPE,
  name: "",
  img: null,
  sort: 300000,
  description: "",
  before: false,
  flatTeleport: {
    displayText: "",
    display: "",
    mode: "normal",
    mover: "self",
    distance: String(distance),
    animate: true,
    color: "#8a8078",
    duration: 600,
    // Insight for Black Ash is already deducted by the system's own spend flow.
    spend: { enabled: false, value: 1 },
  },
});

/* -------------------------------------------- */
/*  Detection                                   */
/* -------------------------------------------- */

const stripHtml = (html) => {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = String(html);
  return div.textContent ?? "";
};

const effectsOf = (item) => Array.from(item?.system?.effects?.contents ?? []);
const powerEffectsOf = (item) => Array.from(item?.system?.power?.effects?.contents ?? []);

const isEligibleItem = (item) =>
  !!item && item.type === "ability" && !item.pack && !item.parent?.pack
  && (!item.parent || item.parent.type === "hero");

/** Does the item already carry teleport automation other than our own entry? */
function hasOtherTeleport(item) {
  if (effectsOf(item).some(e => e.type === FLAT_TYPE && e.id !== EFFECT_ID)) return true;
  if (powerEffectsOf(item).some(e => e.type === TIERED_TYPE)) return true;
  const texts = [item.system?.description?.value ?? "", ...effectsOf(item).map(e => e.description ?? "")];
  return texts.some(t => String(t).includes("[[/teleport"));
}

/**
 * The distance formula this item should have, or null when it is not a self teleport.
 * @param {Item} item
 * @returns {string|null}
 */
export function wantedDistance(item) {
  if (!isEligibleItem(item)) return null;
  const dsid = item.system?._dsid;
  if (dsid && Object.hasOwn(TABLE, dsid)) return TABLE[dsid];

  let base = null;
  let perSpend = 0;
  for (const effect of effectsOf(item)) {
    if (effect.id === EFFECT_ID || String(effect.type).startsWith("dsct")) continue;
    const text = stripHtml(effect.description);
    if (base === null) {
      const m = text.match(SELF_TELEPORT);
      if (m) base = parseInt(m[1]);
    }
    if (effect.type === "spend") {
      const a = text.match(ADDITIONAL);
      if (a) perSpend = a[1] ? parseInt(a[1]) : 1;
    }
  }
  if (base === null) return null;
  if (!perSpend) return String(base);
  return perSpend === 1 ? `${base} + @spend` : `${base} + ${perSpend} * @spend`;
}

/**
 * Does the Automation Suite's ability library automate this ability's teleport? (Its overlay, read directly:
 * the core's own resolution leaves teleports to Combat Tools while our entry is on the item.)
 */
export function libraryTeleports(item) {
  try {
    const api = game.modules.get("stef-ds-automation")?.active ? game.modules.get("stef-ds-automation").api : null;
    if (!api?.library?.find || game.settings.get("stef-ds-automation", "libraryEnabled") === false) return false;
    const flags = item?.flags?.["stef-ds-automation"] ?? {};
    if (flags.disabled) return false;
    const selfTeleport = e => e?.type === "teleport" && e.targets === "self";
    // Detached automation on the item: its own entries decide.
    if (flags.overlay?.detached) {
      return [...(item.system?.effects?.contents ?? [])].some(e => e.type === "dsAuto.teleport" && e.dsAuto?.targets === "self");
    }
    const overlay = api.library.find(item);
    if (!overlay) return false;
    // An overlay that needs an inactive module does nothing.
    if ((overlay.requires?.modules ?? []).some(id => !game.modules.get(id)?.active)) return false;
    return overlay.effects.some(selfTeleport);
  } catch (_err) {
    return false;
  }
}

/** Should this item get our effect right now? Returns the distance or null. */
function needed(item) {
  const distance = wantedDistance(item);
  if (!distance) return null;
  if (hasOtherTeleport(item)) return null;
  if (libraryTeleports(item)) return null;
  return distance;
}

const ours = (item) => item?.system?.effects?.get?.(EFFECT_ID) ?? effectsOf(item).find(e => e.id === EFFECT_ID) ?? null;

const upToDate = (item, distance) => {
  const cur = ours(item);
  return !!cur && cur.type === FLAT_TYPE && String(cur.flatTeleport?.distance ?? "") === String(distance)
    && cur.flatTeleport?.mover === "self" && cur.flatTeleport?.mode === "normal";
};

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

const typeRegistered = () => !!globalThis.ds?.CONFIG?.SpecialEffect?.[FLAT_TYPE];
const isActingGM = () => game.user.isGM && (game.users.activeGM?.isSelf ?? true);

/** Items we are currently updating ourselves; prevents the updateItem hook from looping. */
const inFlight = new Set();

/**
 * Add or refresh our effect on one item. Returns true when an update was issued.
 * @param {Item} item
 * @param {{ quiet?: boolean }} [options]
 */
async function repairItem(item, { quiet = false } = {}) {
  if (!typeRegistered() || inFlight.has(item.uuid)) return false;
  const distance = needed(item);
  if (!distance) {
    // Our entry is superfluous when another teleport automation exists (or the library does it): step aside.
    if (ours(item) && (hasOtherTeleport(item) || libraryTeleports(item))) {
      inFlight.add(item.uuid);
      try {
        await item.update({ [`system.effects.${EFFECT_ID}`]: new foundry.data.operators.ForcedDeletion() });
        if (!quiet) console.log(`${MODULE_ID} | Fix 3: removed our teleport from ${label(item)} (other teleport automation present).`);
      } finally { inFlight.delete(item.uuid); }
      return true;
    }
    return false;
  }
  if (upToDate(item, distance)) return false;

  inFlight.add(item.uuid);
  try {
    await item.update({ [`system.effects.${EFFECT_ID}`]: teleportEffect(distance) });
    if (!quiet) console.log(`${MODULE_ID} | Fix 3: teleport ${label(item)} → ${distance} squares`);
    return true;
  } catch (err) {
    console.warn(`${MODULE_ID} | Fix 3: could not add teleport to ${label(item)}:`, err);
    return false;
  } finally {
    inFlight.delete(item.uuid);
  }
}

const label = (item) => `${item.parent ? `${item.parent.name} / ` : ""}${item.name}`;

/** Every candidate item in the world: sidebar items plus hero-embedded items. */
function* candidates() {
  for (const item of game.items) if (item.type === "ability") yield item;
  for (const actor of game.actors) {
    if (actor.type !== "hero") continue;
    for (const item of actor.items) if (item.type === "ability") yield item;
  }
}

async function repairAll() {
  let changed = 0, checked = 0;
  for (const item of candidates()) {
    checked++;
    if (await repairItem(item)) changed++;
  }
  console.log(`${MODULE_ID} | Fix 3: checked ${checked} hero abilities, updated ${changed}.`);
  return changed;
}

/** Seed newly created copies (drag from compendium, level-up, duplicate). */
function onPreCreateItem(item, _data, _options, userId) {
  if (userId !== game.user.id || !typeRegistered()) return;
  const distance = needed(item);
  if (!distance || upToDate(item, distance)) return;
  try {
    item.updateSource({ [`system.effects.${EFFECT_ID}`]: teleportEffect(distance) });
  } catch (err) {
    console.warn(`${MODULE_ID} | Fix 3: could not seed teleport on ${label(item)}:`, err);
  }
}

/**
 * DSCT's pack refresh sends `system.effects.<ourId>: ForcedDeletion`. Replace it with our data
 * again unless another teleport automation would remain on the item after this update.
 */
function onPreUpdateItem(item, changes, _options, userId) {
  if (userId !== game.user.id || !typeRegistered()) return;
  const effects = changes?.system?.effects;
  if (!effects || typeof effects !== "object") return;
  const Deletion = foundry.data?.operators?.ForcedDeletion;
  if (!Deletion || !(effects[EFFECT_ID] instanceof Deletion)) return;

  const distance = wantedDistance(item);
  if (!distance || libraryTeleports(item)) return;

  const remaining = effectsOf(item)
    .filter(e => e.id !== EFFECT_ID && e.type === FLAT_TYPE && !(effects[e.id] instanceof Deletion));
  const added = Object.entries(effects)
    .filter(([id, v]) => id !== EFFECT_ID && v && typeof v === "object" && !(v instanceof Deletion) && v.type === FLAT_TYPE);
  if (remaining.length || added.length) return;

  effects[EFFECT_ID] = teleportEffect(distance);
}

function onCreateItem(item, _options, userId) {
  if (!isActingGM() || !typeRegistered()) return;
  // DSCT's own createItem handler may still be swapping the item; look again shortly after.
  setTimeout(() => { if (!item.parent || item.parent.items.has(item.id)) repairItem(item); }, 1500);
}

function onUpdateItem(item, _changes, _options, userId) {
  if (!isActingGM() || !typeRegistered() || inFlight.has(item.uuid)) return;
  if (!isEligibleItem(item)) return;
  setTimeout(() => repairItem(item, { quiet: true }), 250);
}

export function registerTeleportAbilities() {
  Hooks.once("setup", () => {
    if (!dsctActive()) return;
    Hooks.on("preCreateItem", onPreCreateItem);
    Hooks.on("preUpdateItem", onPreUpdateItem);
    Hooks.on("createItem", onCreateItem);
    Hooks.on("updateItem", onUpdateItem);
  });

  Hooks.once("ready", async () => {
    if (!dsctActive()) return;
    if (!typeRegistered()) {
      console.warn(`${MODULE_ID} | Fix 3: ds.CONFIG.SpecialEffect["${FLAT_TYPE}"] is not registered `
        + "(Combat Tools inactive or flat effects disabled); teleport automation NOT applied.");
      return;
    }
    console.log(`${MODULE_ID} | Fix 3: teleport abilities guard installed (effect ${EFFECT_ID}).`);
    if (!isActingGM()) return;
    // DSCT's ready handler (alphabetically earlier) may still be refreshing enhanced abilities;
    // our preUpdateItem hook covers that, and a delayed pass catches what already landed.
    await new Promise(r => setTimeout(r, 3000));
    await repairAll();
  });
}

/** Console helper: `game.modules.get("stef-ds-qol").api.teleport.repairAll()` */
export const teleportApi = { repairAll, repairItem, wantedDistance, teleportEffect, libraryTeleports, EFFECT_ID };
