/**
 * Fix 14 — movable Hero Tokens / Malice box.
 *
 * Symptom: the system shows Hero Tokens and Malice only as a thin strip under the players list
 * (`DrawSteelPlayers#_onRender` appends `templates/ui/players.hbs`, system bundle L28376). Draw Steel Plus replaced
 * it with a draggable box; this box is for tables that run without Draw Steel Plus.
 *
 * Mechanism: a frameless, positioned ApplicationV2 (`#dslf-meta-currency`) shows both values. Reads and writes go
 * through the system API only: `game.actors.heroTokens.giveToken()` / `.spendToken("generic")` (players are routed
 * to the active GM by the system's own query) and the `draw-steel.malice` world setting. The ⋮ button opens the
 * system's own meta-currency menu (`ui.players._metaCurrencyContextMenuOptions()` plus the
 * `getMetaCurrencyContextOptions` hook) with a "Reset position" entry added. The box is dragged by its body and the
 * position is saved per user in the user flag `stef-ds-qol.metaBox` (client settings are shared by every user of
 * one browser). While the box is shown, `body.dslf-meta-box` hides the system strip.
 *
 * Client setting `metaCurrencyBox` (default on). Draw Steel Plus with its own box on wins: ours stays closed.
 */

import { MODULE_ID } from "../shared.mjs";

const SYSTEM_ID = "draw-steel";
const SETTING = "metaCurrencyBox";
const FLAG = "metaBox";
const BODY_CLASS = "dslf-meta-box";
const TEMPLATE = `modules/${MODULE_ID}/templates/meta-currency-box.hbs`;
const DSP_ID = "draw-steel-plus";
const MARGIN = 8;

const L = key => game.i18n.localize(`DSLF.MetaBox.${key}`);

/* -------------------------------------------------- */
/*   Pure helpers (tests/meta-currency-box.mjs)       */
/* -------------------------------------------------- */

/** Keep a box of size w×h fully inside a vw×vh viewport (with a small margin when there is room). */
export function clampPosition({ left, top }, { w, h, vw, vh, margin = MARGIN }) {
  const clamp = (value, size, view) => {
    const lo = size + 2 * margin <= view ? margin : 0;
    const hi = Math.max(lo, view - size - lo);
    return Math.round(Math.min(Math.max(Number(value) || 0, lo), hi));
  };
  return { left: clamp(left, w, vw), top: clamp(top, h, vh) };
}

/** Default spot: horizontally centred, just above the hotbar (or near the bottom edge without one). */
export function defaultPosition({ w, h, vw, vh, hotbarTop = null, gap = 12 }) {
  const bottom = Number.isFinite(hotbarTop) && hotbarTop > h ? hotbarTop - gap : vh - 90;
  return clampPosition({ left: (vw - w) / 2, top: bottom - h }, { w, h, vw, vh });
}

/** Malice is always shown to the Director; players see it only during combat when the system setting allows. */
export function maliceVisible({ isGM, showPlayerMalice, inCombat }) {
  return !!isGM || (!!showPlayerMalice && !!inCombat);
}

/* -------------------------------------------------- */
/*   Application                                      */
/* -------------------------------------------------- */

let BoxClass = null;
let instance = null;
let renderTimer = null;
let dspWarned = false;

function defineBox() {
  const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

  return class MetaCurrencyBox extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
      id: "dslf-meta-currency",
      tag: "aside",
      classes: ["dslf-meta-currency", "themed", "theme-dark"],
      window: { frame: false, positioned: true },
      position: { width: "auto", height: "auto" },
      actions: {
        heroTokens: MetaCurrencyBox.#onHeroTokens,
        malice: MetaCurrencyBox.#onMalice,
      },
    };

    static PARTS = { content: { template: TEMPLATE } };

    #drag = null;

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const isGM = game.user.isGM;
      const inCombat = !!game.combat;
      const heroTokens = game.actors.heroTokens;
      const malice = game.actors.malice;
      return Object.assign(context, {
        isGM,
        heroTokens: { value: heroTokens?.value ?? 0, label: heroTokens?.label ?? L("HeroTokens") },
        malice: { value: malice?.value ?? 0, label: malice?.label ?? L("Malice") },
        showMalice: maliceVisible({ isGM, showPlayerMalice: game.settings.get(SYSTEM_ID, "showPlayerMalice"), inCombat }),
        maliceIdle: isGM && !inCombat,
        heroTooltip: isGM ? L("Tooltip.HeroTokensGM") : L("Tooltip.HeroTokensPlayer"),
        maliceTooltip: isGM ? (inCombat ? L("Tooltip.MaliceGM") : L("Tooltip.MaliceIdle")) : "",
      });
    }

    async _onFirstRender(context, options) {
      await super._onFirstRender(context, options);
      const entries = buildMenuEntries();
      new foundry.applications.ux.ContextMenu(this.element, ".dslf-mb-menu", entries, {
        eventName: "click", jQuery: false, fixed: true,
      });
      this.element.addEventListener("contextmenu", event => this.#onRightClick(event));
      this.element.addEventListener("pointerdown", event => this.#onDragStart(event));
    }

    async _onRender(context, options) {
      await super._onRender(context, options);
      this.restorePosition();
    }

    /** Move to the saved position (or the default one), clamped to the current viewport. */
    restorePosition() {
      if (!this.element) return;
      const { w, h, vw, vh } = this.#metrics();
      const saved = game.user.getFlag(MODULE_ID, FLAG);
      const pos = saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)
        ? clampPosition(saved, { w, h, vw, vh })
        : defaultPosition({ w, h, vw, vh, hotbarTop: document.getElementById("hotbar")?.getBoundingClientRect().top ?? null });
      this.setPosition(pos);
    }

    #metrics() {
      const rect = this.element.getBoundingClientRect();
      const { clientWidth: vw, clientHeight: vh } = document.documentElement;
      return { w: rect.width, h: rect.height, vw, vh };
    }

    /* ---------- dragging ---------- */

    #onDragStart(event) {
      if (event.button !== 0 || event.target.closest("button, [data-action], input")) return;
      event.preventDefault();
      const rect = this.element.getBoundingClientRect();
      this.#drag = { dx: event.clientX - rect.left, dy: event.clientY - rect.top, moved: false };
      this.element.classList.add("dragging");
      const move = ev => {
        this.#drag.moved = true;
        const { w, h, vw, vh } = this.#metrics();
        this.setPosition(clampPosition({ left: ev.clientX - this.#drag.dx, top: ev.clientY - this.#drag.dy }, { w, h, vw, vh }));
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
        this.element?.classList.remove("dragging");
        const moved = this.#drag?.moved;
        this.#drag = null;
        if (!moved) return;
        const { left, top } = this.position;
        game.user.setFlag(MODULE_ID, FLAG, { left: Math.round(left), top: Math.round(top) })
          .catch(err => console.warn(`${MODULE_ID} | Fix 14: could not save the box position`, err));
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    }

    /* ---------- value clicks ---------- */

    #onRightClick(event) {
      const target = event.target.closest("[data-action]");
      if (!target) return;
      event.preventDefault();
      if (!game.user.isGM) return;
      if (target.dataset.action === "heroTokens") void game.actors.heroTokens.giveToken();
      else if (target.dataset.action === "malice") void adjustMalice(1);
    }

    /** Director: click spends one, right-click (#onRightClick) gives one. Players: click spends, after a confirmation. */
    static async #onHeroTokens(event, target) {
      const heroTokens = game.actors.heroTokens;
      if (game.user.isGM) return heroTokens.spendToken("generic");
      const ok = await foundry.applications.api.DialogV2.confirm({
        window: { title: L("SpendTitle") },
        content: `<p>${L("SpendConfirm")}</p>`,
      });
      if (ok) await heroTokens.spendToken("generic");
    }

    /** Director: click −1, right-click (#onRightClick) +1. */
    static async #onMalice(event, target) {
      if (game.user.isGM) await adjustMalice(-1);
    }
  };
}

/** Change Malice by delta (Director only); the system's setting onChange refreshes NPC sheets and the players list. */
async function adjustMalice(delta) {
  if (!game.user.isGM) return;
  const value = (game.actors.malice?.value ?? 0) + delta;
  await game.settings.set(SYSTEM_ID, "malice", { value });
}

/** The system's own meta-currency menu entries (same hook as the players list) plus "Reset position". */
function buildMenuEntries() {
  let entries = [];
  try {
    entries = ui.players?._metaCurrencyContextMenuOptions?.() ?? [];
    Hooks.call("getMetaCurrencyContextOptions", ui.players, entries);
  } catch (err) {
    console.warn(`${MODULE_ID} | Fix 14: could not read the system meta-currency menu`, err);
  }
  entries.push({
    label: "DSLF.MetaBox.ResetPosition",
    icon: "fa-solid fa-arrows-to-dot",
    onClick: () => resetPosition(),
  });
  return entries;
}

/* -------------------------------------------------- */
/*   Lifecycle                                        */
/* -------------------------------------------------- */

function dspBoxActive() {
  if (!game.modules.get(DSP_ID)?.active) return false;
  try { return !!game.settings.get(DSP_ID, "useCustomMetaCurrency"); } catch { return false; }
}

function enabled() {
  if (!game.settings.get(MODULE_ID, SETTING)) return false;
  if (dspBoxActive()) {
    if (!dspWarned) console.log(`${MODULE_ID} | Fix 14: Draw Steel Plus shows its own Hero Tokens / Malice box; ours stays closed.`);
    dspWarned = true;
    return false;
  }
  return true;
}

async function sync() {
  if (!BoxClass || !game.ready) return;
  if (!enabled()) {
    document.body.classList.remove(BODY_CLASS);
    if (instance?.rendered) await instance.close();
    return;
  }
  document.body.classList.add(BODY_CLASS);
  instance ??= new BoxClass();
  await instance.render({ force: true });
}

function queueSync() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => sync().catch(err => console.error(`${MODULE_ID} | Fix 14: render failed`, err)), 50);
}

async function resetPosition() {
  await game.user.unsetFlag(MODULE_ID, FLAG);
  instance?.restorePosition();
}

export const metaBoxApi = {
  render: () => sync(),
  resetPosition,
  /** Console check: what the box shows and where it sits. */
  check() {
    const el = document.getElementById("dslf-meta-currency");
    const strip = document.getElementById("meta-currency");
    return {
      setting: game.settings.get(MODULE_ID, SETTING),
      dspBox: dspBoxActive(),
      rendered: !!instance?.rendered,
      heroTokens: game.actors.heroTokens?.value,
      malice: game.actors.malice?.value,
      text: el?.innerText.replace(/\s+/g, " ").trim() ?? null,
      position: instance?.position ? { left: instance.position.left, top: instance.position.top } : null,
      saved: game.user.getFlag(MODULE_ID, FLAG) ?? null,
      systemStripHidden: strip ? getComputedStyle(strip).display === "none" : null,
    };
  },
};

export function registerMetaCurrencyBox() {
  Hooks.once("init", () => {
    game.settings.register(MODULE_ID, SETTING, {
      name: "DSLF.MetaBox.Settings.Name",
      hint: "DSLF.MetaBox.Settings.Hint",
      scope: "client",
      config: true,
      type: Boolean,
      default: true,
      onChange: () => queueSync(),
    });
  });

  Hooks.once("ready", () => {
    try {
      BoxClass = defineBox();
    } catch (err) {
      console.error(`${MODULE_ID} | Fix 14: could not define the meta-currency box`, err);
      return;
    }
    console.log(`${MODULE_ID} | Fix 14: movable Hero Tokens / Malice box`);
    queueSync();
    Hooks.on("renderPlayers", () => queueSync());
    Hooks.on("updateSetting", setting => {
      if ([`${SYSTEM_ID}.heroTokens`, `${SYSTEM_ID}.malice`, `${SYSTEM_ID}.showPlayerMalice`].includes(setting.key)) queueSync();
    });
    for (const hook of ["createCombat", "updateCombat", "deleteCombat"]) Hooks.on(hook, () => queueSync());
    window.addEventListener("resize", foundry.utils.debounce(() => instance?.rendered && instance.restorePosition(), 100));
  });
}
