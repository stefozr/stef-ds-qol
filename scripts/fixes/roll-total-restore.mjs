/**
 * Fix 19 — a roll whose apply button another module removed still shows its total.
 *
 * Draw Steel 1.2 renders a damage roll's total AS its apply button (`systems/draw-steel/templates/rolls/damage.hbs`:
 * `button.dice-total.apply-damage`). Modules that apply the damage themselves remove that button so it cannot apply
 * twice, which removes the total with it: Combat Tools' Bleeding card (`src/chat-integration.mjs` rollBleeding, and its
 * render hook removes every `.apply-damage`) then shows only "1d6 + 1"; Combat Tools' system-fall takeover removes the
 * button of falling parts the same way.
 *
 * After every module's render hook ran, each system roll of a message part whose `.inline-result` has a formula but no
 * total gets the template's read-only total back (`h4.dice-total`, the variant the system uses without an apply index).
 * Combat Tools' own rows (`dsct-*` classes: effect and forced-movement rows) are not rolls of the part and are skipped.
 * Nothing is applied or re-enabled: only the number the roll already has is shown.
 */

import { MODULE_ID } from "../shared.mjs";

/** The system's own roll rows of a part section, in the order of the part's rolls. */
export const partRollRows = (section) =>
  [...(section?.querySelectorAll?.(":scope > .message-part-rolls > .dice-roll") ?? [])]
    .filter(el => !/\bdsct-/.test(String(el.className ?? "")));

/**
 * Pure: the rows that lack a total and the total each should show.
 * @param {Element[]} rows     partRollRows of one section.
 * @param {number[]} totals    The part's roll totals, same order.
 * @returns {{row: Element, total: number}[]}
 */
export function missingTotals(rows, totals) {
  const out = [];
  (rows ?? []).forEach((row, i) => {
    const inline = row?.querySelector?.(".inline-result");
    if (!inline || !inline.querySelector(".dice-formula") || inline.querySelector(".dice-total")) return;
    const total = Number(totals?.[i]?.valueOf?.() ?? totals?.[i]);
    if (Number.isFinite(total)) out.push({ row, total });
  });
  return out;
}

function restore(message, root) {
  const doc = root.ownerDocument ?? globalThis.document;
  for (const section of root.querySelectorAll("section[data-message-part]")) {
    const part = message?.system?.parts?.get?.(section.dataset.messagePart);
    const rolls = Array.from(part?.rolls ?? []);
    if (!rolls.length) continue;
    for (const { row, total } of missingTotals(partRollRows(section), rolls.map(r => r?.total))) {
      const h4 = doc.createElement("h4");
      h4.className = "dice-total dslf-restored-total";
      h4.textContent = String(total);
      row.querySelector(".inline-result .dice-formula").after(h4);
    }
  }
}

export function registerRollTotalRestore() {
  Hooks.on("renderChatMessageHTML", (message, html) => {
    const root = globalThis.HTMLElement && html instanceof HTMLElement ? html : html?.[0] ?? html;
    if (!root?.querySelectorAll) return;
    // Other modules remove the button in their own render hooks: look once they ran.
    setTimeout(() => {
      try {
        restore(message, root);
      } catch (err) {
        console.error(`${MODULE_ID} | Fix 19: roll total restore failed`, err);
      }
    }, 0);
  });
}
