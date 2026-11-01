/**
 * Shared parts of the two table trackers (Fix 15 montage, Fix 16 negotiation): a standard Foundry window that remembers
 * its position per user, a controller that opens / re-renders / closes it when the shared state changes, and small
 * helpers for drops and the system rules journal.
 */

import { MODULE_ID } from "./shared.mjs";

/**
 * Standard window (frame, title bar, close / minimise, resizable width) whose left / top / width are saved per user
 * in a user flag, so GM and player tabs in one browser keep their own spots.
 * @param {typeof foundry.applications.api.ApplicationV2} Base
 * @param {{flag: string}} config
 */
export function TrackerWindowMixin(Base, { flag }) {
  return class TrackerWindow extends Base {
    constructor(options = {}) {
      const saved = game.user.getFlag(MODULE_ID, flag) ?? {};
      const position = {};
      for (const key of ["left", "top", "width"]) if (Number.isFinite(saved[key])) position[key] = saved[key];
      super(foundry.utils.mergeObject({ position }, options));
    }

    #saveTimer = null;

    _onPosition(position) {
      super._onPosition?.(position);
      clearTimeout(this.#saveTimer);
      this.#saveTimer = setTimeout(() => {
        if (!this.rendered || this.minimized) return;
        const { left, top, width } = this.position;
        const value = { left: Math.round(left), top: Math.round(top), width: Math.round(width) };
        const saved = game.user.getFlag(MODULE_ID, flag);
        if (saved && ["left", "top", "width"].every(k => saved[k] === value[k])) return;
        game.user.setFlag(MODULE_ID, flag, value)
          .catch(err => console.warn(`${MODULE_ID} | could not save the ${flag} position`, err));
      }, 500);
    }

    /** Keep the title bar in step with the state (montage title, NPC name). */
    async _onRender(context, options) {
      await super._onRender(context, options);
      const titleEl = this.window?.title;
      if (titleEl && titleEl.textContent !== this.title) titleEl.textContent = this.title;
    }
  };
}

/**
 * Opens, re-renders and closes one tracker window from the shared state (`{active, runId}`).
 * A window the user closes stays closed for that run until they reopen it from the Token controls.
 * @param {{label: string, getState: () => {active: boolean, runId: string|null}}} config
 */
export function createTrackerController({ label, getState }) {
  let AppClass = null;
  let instance = null;
  let timer = null;
  let dismissedRun = null;
  let closingBySync = false;

  async function sync({ open = false } = {}) {
    if (!AppClass || !game.ready) return;
    const state = getState();
    if (!state.active) {
      dismissedRun = null;
      if (instance?.rendered) {
        closingBySync = true;
        try {
          await instance.close();
        } finally {
          closingBySync = false;
        }
      }
      instance = null;
      return;
    }
    if (open) dismissedRun = null;
    if (instance?.rendered) {
      if (open) {
        if (instance.minimized) await instance.maximize();
        instance.bringToFront();
      }
      return instance.render();
    }
    if (dismissedRun && dismissedRun === state.runId) return;
    instance = new AppClass();
    await instance.render({ force: true });
  }

  return {
    get instance() {
      return instance;
    },
    /** Install the window class (at ready) and show the running tracker, if any. */
    ready(defineApp) {
      try {
        AppClass = defineApp();
      } catch (err) {
        console.error(`${MODULE_ID} | ${label}: could not define the window`, err);
        return false;
      }
      this.queue();
      return true;
    },
    sync,
    queue() {
      clearTimeout(timer);
      timer = setTimeout(() => sync().catch(err => console.error(`${MODULE_ID} | ${label}: render failed`, err)), 30);
    },
    /** Called from the window's _onClose: a close by the user hides it for this run. */
    closed(app) {
      if (app === instance) instance = null;
      if (!closingBySync) dismissedRun = getState().runId ?? null;
    },
  };
}

/** Read an Actor (hero/NPC) from drop data: actor or token drags, world or compendium. */
export async function actorFromDrop(event) {
  let data;
  try {
    data = JSON.parse(event.dataTransfer?.getData("text/plain") || "null");
  } catch {
    return null;
  }
  if (!data?.uuid || !["Actor", "Token"].includes(data.type)) return null;
  const doc = await fromUuid(data.uuid).catch(() => null);
  if (!doc) return null;
  return data.type === "Token" ? doc.actor ?? null : doc;
}

/** Open a page of the system's rules journal (`ds.CONFIG.references[key]`). */
export async function openRulesPage(key) {
  const uuid = globalThis.ds?.CONFIG?.references?.[key];
  const page = uuid ? await fromUuid(uuid).catch(() => null) : null;
  if (!page) return ui.notifications.warn(game.i18n.localize("DSLF.Trackers.NoRules"));
  if (page.parent?.sheet) return page.parent.sheet.render({ force: true, pageId: page.id });
  return page.sheet?.render({ force: true });
}
