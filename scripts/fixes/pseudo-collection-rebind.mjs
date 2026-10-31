/**
 * Fix 11 — system: an item's special effects and power roll effects stay current after "Update from
 * compendium".
 *
 * Symptom: after "Update from compendium" on an ability, later changes to its special effects or power
 * roll effects (a deleted effect, one added by a module) are saved but do not show: the sheet, the chat
 * card and every module keep seeing the old list until the page is reloaded.
 *
 * Cause (Draw Steel 1.1.2): each document builds its pseudo-collections once, in
 * `DrawSteelDocument#_configure` (draw-steel.mjs:127-140), and each `ModelCollection` keeps a
 * non-writable reference to the source object at its field path (`_source`, draw-steel.mjs:9215-9223).
 * "Update from compendium" writes `system` as a `ForcedReplacement`, so the document's
 * `_source.system` becomes a new object. The collection still points at the old one, and
 * `ModelCollection#initialize` (draw-steel.mjs:9380-9396) rebuilds the list from that stale object on
 * every later update.
 *
 * Mechanism: after every update of an Item, Actor or ChatMessage, each pseudo-collection whose `_source`
 * is no longer the object at its field path gets the current data copied into its own object, which is
 * then put back at the field path, so the document and the collection share one object again. The
 * document is then re-prepared and its open sheets re-rendered. Self-detecting: nothing happens while
 * the binding is intact (also once the system fixes this upstream).
 */

import { MODULE_ID } from "../shared.mjs";

const DOCUMENTS = ["Item", "Actor", "ChatMessage"];

/** Field paths of a document's pseudo-collections, e.g. {SpecialEffect: "system.effects"}. */
function embeddedPaths(doc) {
  const model = CONFIG[doc?.documentName]?.dataModels?.[doc?._source?.type];
  return model?.metadata?.embedded ?? {};
}

/** Collections of a document whose `_source` is not the document's current data. */
function staleCollections(doc) {
  const out = [];
  const collections = doc?.pseudoCollections;
  if (!collections) return out;
  for (const [name, path] of Object.entries(embeddedPaths(doc))) {
    const collection = collections[name];
    if (!collection) continue;
    const current = foundry.utils.getProperty(doc._source, path);
    if (current && typeof current === "object" && collection._source !== current) out.push({ name, path, collection, current });
  }
  return out;
}

/**
 * Re-bind a document's stale pseudo-collections to its current source.
 * @returns {string[]} Names of the collections that were re-bound.
 */
export function rebind(doc) {
  const stale = staleCollections(doc);
  if (!stale.length) return [];
  for (const { path, collection, current } of stale) {
    const bound = collection._source;
    for (const key of Object.keys(bound)) delete bound[key];
    Object.assign(bound, current);
    foundry.utils.setProperty(doc._source, path, bound);
  }
  try {
    doc.reset();
  } catch (err) {
    console.warn(`${MODULE_ID} | Fix 11: could not re-prepare ${doc.uuid}`, err);
  }
  try {
    doc.render?.(false);
  } catch (_err) { /* no open sheets */ }
  const names = stale.map(s => s.name);
  console.log(`${MODULE_ID} | Fix 11: re-bound ${names.join(", ")} of ${doc.uuid} to its current data`);
  return names;
}

export function registerPseudoCollectionRebind() {
  for (const name of DOCUMENTS) {
    Hooks.on(`update${name}`, doc => {
      try {
        rebind(doc);
      } catch (err) {
        console.warn(`${MODULE_ID} | Fix 11: re-bind failed for ${doc?.uuid}`, err);
      }
    });
  }
}

/** Console helpers: game.modules.get("stef-ds-qol").api.pseudoCollections.check(item) / .scan() */
export const pseudoCollectionApi = {
  /** Binding of each pseudo-collection of one document. */
  check(doc) {
    return Object.fromEntries(Object.entries(embeddedPaths(doc)).map(([name, path]) => {
      const collection = doc?.pseudoCollections?.[name];
      return [name, collection ? collection._source === foundry.utils.getProperty(doc._source, path) : null];
    }));
  },
  /** Re-bind every stale world item and actor item now (e.g. after an update made before this fix ran). */
  scan() {
    const fixed = [];
    const docs = [...game.items, ...game.actors, ...game.actors.contents.flatMap(a => [...a.items])];
    for (const doc of docs) if (rebind(doc).length) fixed.push(doc.uuid);
    return fixed;
  },
  rebind,
};
