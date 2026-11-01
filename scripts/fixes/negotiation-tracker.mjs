/**
 * Fix 16 — negotiation tracker.
 *
 * Need: the system keeps negotiation numbers on each NPC (`system.negotiation`: interest, patience, impression,
 * motivations, pitfalls) but has no table tool to run a negotiation. Draw Steel Plus had one; this is our own version
 * (no Draw Steel Plus code is used) that can start from an NPC.
 *
 * Mechanism: the negotiation lives in the hidden world setting `stef-ds-qol.negotiationState`; the Director starts it
 * with a Token-controls button and ends it from the window's header menu, and the setting's onChange opens,
 * re-renders or closes the window `#dslf-negotiation` on every client (tracker-helpers.mjs). A user who closes the
 * window reopens it with the same button, which players also get while a negotiation runs. Dropping an NPC (actor or token) copies its name, portrait and
 * `system.negotiation` into the tracker; the NPC itself is never written to. An attitude sets interest and patience.
 * Each value and each motivation / pitfall has an eye: players see only what the Director reveals.
 *
 * World setting `negotiationTracker` (default on) shows the Director's button.
 */

import { MODULE_ID } from "../shared.mjs";
import { TrackerWindowMixin, actorFromDrop, createTrackerController, openRulesPage } from "../tracker-helpers.mjs";

const STATE = "negotiationState";
const ENABLED = "negotiationTracker";
const FLAG = "negotiationWindow";
const TEMPLATE = `modules/${MODULE_ID}/templates/negotiation-tracker.hbs`;
const TOOL = "dslfNegotiation";

const L = (key, data) => data ? game.i18n.format(`DSLF.Negotiation.${key}`, data) : game.i18n.localize(`DSLF.Negotiation.${key}`);

/* -------------------------------------------------- */
/*   Rules and pure state helpers (tests/negotiation-tracker.mjs) */
/* -------------------------------------------------- */

/** Starting interest and patience by NPC attitude. */
export const ATTITUDES = Object.freeze({
  hostile: Object.freeze({ interest: 1, patience: 2 }),
  suspicious: Object.freeze({ interest: 2, patience: 2 }),
  neutral: Object.freeze({ interest: 2, patience: 3 }),
  open: Object.freeze({ interest: 3, patience: 3 }),
  friendly: Object.freeze({ interest: 3, patience: 4 }),
  trusting: Object.freeze({ interest: 3, patience: 5 }),
});

export const VALUE_KEYS = Object.freeze(["interest", "patience", "impression"]);
const MAX = Object.freeze({ interest: 5, patience: 5, impression: 99 });
const LISTS = Object.freeze(["motivations", "pitfalls"]);

const value = (v = 0) => ({ value: v, base: v, revealed: false });

export function defaultNegotiationState() {
  return {
    active: false,
    runId: null,
    npcUuid: null,
    name: "",
    img: "",
    attitude: "",
    interest: value(),
    patience: value(),
    impression: value(),
    motivations: [],
    pitfalls: [],
  };
}

const clampValue = (key, v) => Math.min(MAX[key], Math.max(0, Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0));

function normalizeEntry(e) {
  return { id: String(e.id), key: e.key ?? null, label: String(e.label ?? ""), revealed: !!e.revealed, used: !!e.used };
}

export function normalizeNegotiation(raw) {
  const base = defaultNegotiationState();
  const src = raw && typeof raw === "object" ? raw : {};
  const state = {
    ...base,
    active: !!src.active,
    runId: typeof src.runId === "string" ? src.runId : null,
    npcUuid: src.npcUuid || null,
    name: typeof src.name === "string" ? src.name : "",
    img: typeof src.img === "string" ? src.img : "",
    attitude: src.attitude in ATTITUDES ? src.attitude : "",
  };
  for (const key of VALUE_KEYS) {
    const v = src[key] ?? {};
    state[key] = { value: clampValue(key, v.value), base: clampValue(key, v.base ?? v.value), revealed: !!v.revealed };
  }
  for (const list of LISTS) state[list] = Array.isArray(src[list]) ? src[list].filter(e => e?.id).map(normalizeEntry) : [];
  return state;
}

/** Interest / patience / impression ±delta, kept in range. */
export function stepValue(state, key, delta) {
  if (!VALUE_KEYS.includes(key)) return state;
  return { ...state, [key]: { ...state[key], value: clampValue(key, state[key].value + delta) } };
}

/** Back to the starting value (from the attitude or the NPC). */
export function resetValue(state, key) {
  if (!VALUE_KEYS.includes(key)) return state;
  return { ...state, [key]: { ...state[key], value: state[key].base } };
}

export function applyAttitude(state, attitude) {
  const a = ATTITUDES[attitude];
  if (!a) return { ...state, attitude: "" };
  return {
    ...state,
    attitude,
    interest: { ...state.interest, value: a.interest, base: a.interest },
    patience: { ...state.patience, value: a.patience, base: a.patience },
  };
}

/**
 * A tracker state from an NPC: name, portrait, values and lists (labels resolved with `labelFor(key)`).
 * Reveal flags and the active flag are kept from `state`.
 */
export function stateFromNpc(state, { uuid, name, img, negotiation = {} }, labelFor = k => k) {
  const entries = keys => Array.from(keys ?? []).map(key => ({ id: key, key, label: labelFor(key), revealed: false, used: false }));
  const set = (key, v) => {
    const n = clampValue(key, v);
    return { value: n, base: n, revealed: state[key].revealed };
  };
  return {
    ...state,
    npcUuid: uuid ?? null,
    name: name ?? "",
    img: img ?? "",
    attitude: "",
    interest: set("interest", negotiation.interest),
    patience: set("patience", negotiation.patience),
    impression: set("impression", negotiation.impression),
    motivations: entries(negotiation.motivations),
    pitfalls: entries(negotiation.pitfalls),
  };
}

/** Canonical motivation keys not used yet in either list. */
export function availableMotivations(state, allKeys) {
  const used = new Set(LISTS.flatMap(list => state[list].map(e => e.key).filter(Boolean)));
  return allKeys.filter(k => !used.has(k));
}

/** Add a canonical (`key`) or custom (`label`) entry to a list. `id` is used for custom entries. */
export function addEntry(state, list, { key = null, label = "", id }) {
  if (!LISTS.includes(list)) return state;
  if (key && state[list].some(e => e.key === key)) return state;
  if (!key && !label.trim()) return state;
  const entry = { id: key ?? id, key, label: key ? label : label.trim(), revealed: false, used: false };
  return { ...state, [list]: [...state[list], entry] };
}

export function patchEntry(state, list, id, patch) {
  if (!LISTS.includes(list)) return state;
  return { ...state, [list]: state[list].map(e => e.id === id ? { ...e, ...patch(e) } : e) };
}

export function removeEntry(state, list, id) {
  if (!LISTS.includes(list)) return state;
  return { ...state, [list]: state[list].filter(e => e.id !== id) };
}

/** "" / "agreed" (interest 5) / "noDeal" (interest 0) / "outOfPatience" (patience 0). */
export function negotiationStatus(state) {
  if (state.interest.value >= MAX.interest) return "agreed";
  if (state.interest.value <= 0 && (state.attitude || state.npcUuid)) return "noDeal";
  if (state.patience.value <= 0 && (state.attitude || state.npcUuid)) return "outOfPatience";
  return "";
}

/* -------------------------------------------------- */
/*   State access                                     */
/* -------------------------------------------------- */

const getState = () => normalizeNegotiation(game.settings.get(MODULE_ID, STATE));

async function saveState(state) {
  if (!game.user.isGM) return;
  await game.settings.set(MODULE_ID, STATE, state);
}

async function update(fn) {
  const next = fn(getState());
  await saveState(next);
  return next;
}

const motivationConfig = () => globalThis.ds?.CONFIG?.negotiation?.motivations ?? {};
const motivationLabel = key => game.i18n.localize(motivationConfig()[key]?.label ?? key);

async function start() {
  if (!game.user.isGM) return;
  if (getState().active) return tracker.sync({ open: true });
  await saveState({ ...defaultNegotiationState(), active: true, runId: foundry.utils.randomID() });
}

async function end({ confirm = true } = {}) {
  if (!game.user.isGM || !getState().active) return false;
  if (confirm) {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: L("End") },
      content: `<p>${L("EndConfirm")}</p>`,
    });
    if (!ok) return false;
  }
  await saveState(defaultNegotiationState());
  return true;
}

/** Fill the tracker from an NPC actor (Director). */
async function loadNpc(actor) {
  if (!game.user.isGM || actor?.type !== "npc") return;
  const n = actor.system?.negotiation ?? {};
  await update(s => stateFromNpc(s, {
    uuid: actor.uuid,
    name: actor.name,
    img: actor.img,
    negotiation: { interest: n.interest, patience: n.patience, impression: n.impression, motivations: n.motivations, pitfalls: n.pitfalls },
  }, motivationLabel));
}

/* -------------------------------------------------- */
/*   Application                                      */
/* -------------------------------------------------- */

const tracker = createTrackerController({ label: "Fix 16", getState });

function defineApp() {
  const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
  const Base = TrackerWindowMixin(HandlebarsApplicationMixin(ApplicationV2), { flag: FLAG });

  return class NegotiationTracker extends Base {
    static DEFAULT_OPTIONS = {
      id: "dslf-negotiation",
      classes: ["dslf-tracker", "dslf-negotiation"],
      window: { title: "DSLF.Negotiation.Title", icon: "fa-solid fa-handshake", resizable: true },
      position: { width: 340, height: "auto" },
      actions: {
        step: NegotiationTracker.#onStep,
        resetValue: NegotiationTracker.#onResetValue,
        reveal: NegotiationTracker.#onReveal,
        revealEntry: NegotiationTracker.#onRevealEntry,
        useEntry: NegotiationTracker.#onUseEntry,
        removeEntry: NegotiationTracker.#onRemoveEntry,
        addCustom: NegotiationTracker.#onAddCustom,
        openNpc: NegotiationTracker.#onOpenNpc,
        rules: () => openRulesPage("negotiation"),
        unlink: () => update(s => ({ ...s, npcUuid: null })),
        end: () => end(),
      },
    };

    static PARTS = { content: { template: TEMPLATE } };

    get title() {
      return getState().name || L("Title");
    }

    _getHeaderControls() {
      const controls = super._getHeaderControls();
      controls.push({ icon: "fa-solid fa-book-open", label: "DSLF.Trackers.Rules", action: "rules" });
      if (game.user.isGM) {
        if (getState().npcUuid) controls.push({ icon: "fa-solid fa-link-slash", label: "DSLF.Negotiation.Unlink", action: "unlink" });
        controls.push({ icon: "fa-solid fa-flag-checkered", label: "DSLF.Negotiation.End", action: "end" });
      }
      return controls;
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const state = getState();
      const isGM = game.user.isGM;
      const values = VALUE_KEYS.map(key => {
        const v = state[key];
        const pips = key === "impression" ? null
          : Array.from({ length: MAX[key] }, (_, i) => ({ on: i < v.value }));
        return {
          key,
          label: L(`Values.${key}`),
          value: v.value,
          max: key === "impression" ? null : MAX[key],
          pips,
          revealed: v.revealed,
          show: isGM || v.revealed,
          changed: v.value !== v.base,
        };
      });
      const lists = LISTS.map(list => {
        const entries = state[list]
          .filter(e => isGM || e.revealed)
          .map(e => ({ ...e, text: e.key ? motivationLabel(e.key) : e.label }));
        return {
          list,
          label: L(list === "motivations" ? "Motivations" : "Pitfalls"),
          usedLabel: L(list === "motivations" ? "Appealed" : "Triggered"),
          badge: list === "motivations" ? "M" : "P",
          entries,
          show: isGM || entries.length > 0,
        };
      });
      const available = isGM
        ? availableMotivations(state, Object.keys(motivationConfig())).map(key => ({ key, label: motivationLabel(key) }))
        : [];
      const status = negotiationStatus(state);
      return Object.assign(context, {
        isGM,
        name: state.name,
        nameLabel: state.name || L("Title"),
        img: state.img,
        showHeader: isGM || !!state.img,
        linked: !!state.npcUuid,
        attitudes: Object.entries(ATTITUDES).map(([key, a]) => ({
          key, label: L(`Attitudes.${key}`), stats: `${a.interest}/${a.patience}`, selected: key === state.attitude,
        })),
        attitude: state.attitude,
        values,
        lists,
        available,
        status: status ? { key: status, label: L(`Status.${status}`) } : null,
        showStatus: !!status && (isGM || state.interest.revealed || state.patience.revealed),
        nothingShown: !isGM && !values.some(v => v.show) && !lists.some(l => l.show),
      });
    }

    async _onFirstRender(context, options) {
      await super._onFirstRender(context, options);
      this.element.addEventListener("change", event => this.#onChange(event));
      this.element.addEventListener("keydown", event => {
        if (event.key === "Enter" && event.target.matches("input[data-custom]")) {
          event.preventDefault();
          this.#addCustomFrom(event.target);
        }
      });
      this.element.addEventListener("dragover", event => {
        if (game.user.isGM) event.preventDefault();
      });
      this.element.addEventListener("drop", async event => {
        if (!game.user.isGM) return;
        event.preventDefault();
        const actor = await actorFromDrop(event);
        if (actor?.type === "npc") await loadNpc(actor);
      });
    }

    async #onChange(event) {
      if (!game.user.isGM) return;
      const t = event.target;
      switch (t.dataset.field) {
        case "name": return update(s => ({ ...s, name: t.value.trim() }));
        case "attitude": return update(s => applyAttitude(s, t.value));
        case "impression": return update(s => ({ ...s, impression: { ...s.impression, value: clampValue("impression", t.value) } }));
        case "addMotivation": {
          const key = t.value;
          if (!key) return;
          return update(s => addEntry(s, t.dataset.list, { key, label: motivationLabel(key) }));
        }
      }
    }

    #addCustomFrom(input) {
      const label = input?.value ?? "";
      if (!label.trim()) return;
      return update(s => addEntry(s, input.dataset.list, { label, id: foundry.utils.randomID() }));
    }

    static async #onStep(event, target) {
      await update(s => stepValue(s, target.dataset.key, Number(target.dataset.delta) || 0));
    }

    static async #onResetValue(event, target) {
      await update(s => resetValue(s, target.dataset.key));
    }

    static async #onReveal(event, target) {
      const key = target.dataset.key;
      await update(s => ({ ...s, [key]: { ...s[key], revealed: !s[key].revealed } }));
    }

    static async #onRevealEntry(event, target) {
      const { list, id } = target.closest("[data-id]").dataset;
      await update(s => patchEntry(s, list, id, e => ({ revealed: !e.revealed })));
    }

    static async #onUseEntry(event, target) {
      const { list, id } = target.closest("[data-id]").dataset;
      await update(s => patchEntry(s, list, id, e => ({ used: !e.used })));
    }

    static async #onRemoveEntry(event, target) {
      const { list, id } = target.closest("[data-id]").dataset;
      await update(s => removeEntry(s, list, id));
    }

    static #onAddCustom(event, target) {
      this.#addCustomFrom(target.closest(".dslf-tr-add")?.querySelector("input[data-custom]"));
    }

    static async #onOpenNpc() {
      const uuid = getState().npcUuid;
      const actor = uuid ? await fromUuid(uuid).catch(() => null) : null;
      actor?.sheet?.render({ force: true });
    }

    _onClose(options) {
      super._onClose(options);
      tracker.closed(this);
    }
  };
}

/* -------------------------------------------------- */
/*   Lifecycle                                        */
/* -------------------------------------------------- */

export const negotiationApi = {
  start,
  end,
  /** Fill the running negotiation from an NPC actor (or start one first). */
  async fromNpc(actor) {
    if (!getState().active) await start();
    await loadNpc(actor);
  },
  /** Open (or bring forward) the running negotiation's window on this client. */
  open: () => tracker.sync({ open: true }),
  /** Console check: the stored state and what the window shows. */
  check() {
    const state = getState();
    return {
      state,
      status: negotiationStatus(state),
      rendered: !!tracker.instance?.rendered,
      text: document.getElementById("dslf-negotiation")?.innerText.replace(/\s+/g, " ").trim() ?? null,
    };
  },
};

export function registerNegotiationTracker() {
  Hooks.once("init", () => {
    game.settings.register(MODULE_ID, STATE, {
      scope: "world",
      config: false,
      type: Object,
      default: defaultNegotiationState(),
      onChange: () => {
        tracker.queue();
        ui.controls?.render();
      },
    });
    game.settings.register(MODULE_ID, ENABLED, {
      name: "DSLF.Negotiation.Settings.Name",
      hint: "DSLF.Negotiation.Settings.Hint",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      onChange: () => ui.controls?.render(),
    });
  });

  Hooks.on("getSceneControlButtons", controls => {
    try {
      const tools = controls.tokens?.tools;
      if (!tools || !game.settings.get(MODULE_ID, ENABLED)) return;
      const active = getState().active;
      if (!game.user.isGM && !active) return;
      tools[TOOL] = {
        name: TOOL,
        title: game.user.isGM && !active ? "DSLF.Negotiation.Start" : "DSLF.Negotiation.Open",
        icon: "fa-solid fa-handshake",
        order: Object.keys(tools).length,
        button: true,
        onChange: () => void (game.user.isGM && !getState().active ? start() : tracker.sync({ open: true })),
      };
    } catch (err) {
      console.error(`${MODULE_ID} | Fix 16: scene control failed`, err);
    }
  });

  Hooks.once("ready", () => {
    if (tracker.ready(defineApp)) console.log(`${MODULE_ID} | Fix 16: negotiation tracker`);
  });
}
