/**
 * Fix 15 — montage test tracker.
 *
 * Need: the system has no montage test tool. Draw Steel Plus had one; this is our own version for tables that run
 * without it (no Draw Steel Plus code is used).
 *
 * Mechanism: the montage lives in the hidden world setting `stef-ds-qol.montageState`. The Director starts it with a
 * Token-controls button and ends it from the window's header menu; the setting's onChange opens, re-renders or closes
 * the window `#dslf-montage` on every client (tracker-helpers.mjs). A user who closes the window reopens it with the
 * same button, which players also get while a montage runs. Only the Director writes the setting. A player rolls a test
 * for a hero they own through the system's own `rollCharacteristic` (Power Roll dialog with skill, edges and banes);
 * the tier is read from the test part of the chat message and sent to the active Director with the core query
 * `stef-ds-qol.montage`, who records it. Success: tier >= 1 / 2 / 3 for an easy / medium / hard test.
 *
 * Rules data: success / failure limits 5/5, 6/4, 7/3 for easy / moderate / hard, adjusted by one per hero above or
 * below five (minimum 2); two rounds. Total success at the success limit; at the failure limit or when time runs out,
 * partial success with at least two more successes than failures, else total failure.
 *
 * World setting `montageTracker` (default on) shows the Director's button.
 */

import { MODULE_ID } from "../shared.mjs";
import { TrackerWindowMixin, actorFromDrop, createTrackerController, openRulesPage } from "../tracker-helpers.mjs";

const STATE = "montageState";
const ENABLED = "montageTracker";
const FLAG = "montageWindow";
const QUERY = `${MODULE_ID}.montage`;
const TEMPLATE = `modules/${MODULE_ID}/templates/montage-tracker.hbs`;
const TOOL = "dslfMontage";

const L = (key, data) => data ? game.i18n.format(`DSLF.Montage.${key}`, data) : game.i18n.localize(`DSLF.Montage.${key}`);

/* -------------------------------------------------- */
/*   Rules and pure state helpers (tests/montage-tracker.mjs) */
/* -------------------------------------------------- */

export const MONTAGE_DIFFICULTIES = Object.freeze({
  easy: Object.freeze({ success: 5, failure: 5 }),
  moderate: Object.freeze({ success: 6, failure: 4 }),
  hard: Object.freeze({ success: 7, failure: 3 }),
});

/** Victories per outcome and montage difficulty. */
export const MONTAGE_VICTORIES = Object.freeze({
  easy: Object.freeze({ totalSuccess: 1, partialSuccess: 0 }),
  moderate: Object.freeze({ totalSuccess: 1, partialSuccess: 1 }),
  hard: Object.freeze({ totalSuccess: 2, partialSuccess: 1 }),
});

/** Lowest tier that counts as a success for a test of this difficulty (system `ds.CONST.testOutcomes`). */
const TEST_THRESHOLD = Object.freeze({ easy: 1, medium: 2, hard: 3 });

export function defaultMontageState() {
  return {
    active: false,
    runId: null,
    title: "",
    difficulty: "moderate",
    heroCount: null,
    successes: 0,
    failures: 0,
    round: 1,
    maxRounds: 2,
    reveal: { successes: false, failures: false, round: false },
    heroes: [],
    awarded: false,
  };
}

const int = (value, fallback) => Number.isInteger(value) ? value : fallback;

/** Fill a stored (possibly partial or older) state with the defaults. */
export function normalizeMontage(raw) {
  const base = defaultMontageState();
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    ...base,
    active: !!src.active,
    runId: typeof src.runId === "string" ? src.runId : null,
    title: typeof src.title === "string" ? src.title : "",
    difficulty: src.difficulty in MONTAGE_DIFFICULTIES ? src.difficulty : base.difficulty,
    heroCount: Number.isInteger(src.heroCount) && src.heroCount > 0 ? src.heroCount : null,
    successes: Math.max(0, int(src.successes, 0)),
    failures: Math.max(0, int(src.failures, 0)),
    round: Math.max(1, int(src.round, 1)),
    maxRounds: Math.max(1, int(src.maxRounds, base.maxRounds)),
    reveal: { ...base.reveal, ...(src.reveal ?? {}) },
    heroes: Array.isArray(src.heroes) ? src.heroes.filter(h => h?.uuid).map(h => ({
      uuid: h.uuid,
      name: String(h.name ?? ""),
      img: h.img || "icons/svg/mystery-man.svg",
      acted: !!h.acted,
      skills: Array.isArray(h.skills) ? [...h.skills] : [],
    })) : [],
    awarded: !!src.awarded,
  };
}

/** Hero count used for the limits: the Director's number, else the heroes added, else five. */
export function effectiveHeroCount(state) {
  return state.heroCount ?? (state.heroes.length || 5);
}

export function adjustedLimits(difficulty, heroCount) {
  const base = MONTAGE_DIFFICULTIES[difficulty] ?? MONTAGE_DIFFICULTIES.moderate;
  const adjust = (Number(heroCount) || 5) - 5;
  return { success: Math.max(2, base.success + adjust), failure: Math.max(2, base.failure + adjust) };
}

export function limitsOf(state) {
  return adjustedLimits(state.difficulty, effectiveHeroCount(state));
}

/** Time is up once the round passes the last one, or every hero has acted in the last round. */
export function timeIsUp(state) {
  if (state.round > state.maxRounds) return true;
  return state.round === state.maxRounds && state.heroes.length > 0 && state.heroes.every(h => h.acted);
}

/** "" while running, else "totalSuccess" / "partialSuccess" / "totalFailure". */
export function montageOutcome(state) {
  const { success, failure } = limitsOf(state);
  if (state.successes >= success) return "totalSuccess";
  if (state.failures >= failure || timeIsUp(state)) {
    return state.successes - state.failures >= 2 ? "partialSuccess" : "totalFailure";
  }
  return "";
}

export function victoriesFor(outcome, difficulty) {
  return MONTAGE_VICTORIES[difficulty]?.[outcome] ?? 0;
}

export function testSucceeds(tier, difficulty) {
  return Number(tier) >= (TEST_THRESHOLD[difficulty] ?? TEST_THRESHOLD.medium);
}

export function addHero(state, { uuid, name, img }) {
  if (!uuid || state.heroes.some(h => h.uuid === uuid)) return state;
  return { ...state, heroes: [...state.heroes, { uuid, name, img: img || "icons/svg/mystery-man.svg", acted: false, skills: [] }] };
}

export function removeHero(state, uuid) {
  return { ...state, heroes: state.heroes.filter(h => h.uuid !== uuid) };
}

/** Record one test: the hero has acted, the skill is remembered, a success or failure is counted (up to the limit). */
export function recordResult(state, { uuid, success, skill }) {
  const { success: sMax, failure: fMax } = limitsOf(state);
  const heroes = state.heroes.map(h => {
    if (h.uuid !== uuid) return h;
    const skills = skill && !h.skills.includes(skill) ? [...h.skills, skill] : h.skills;
    return { ...h, acted: true, skills };
  });
  return success
    ? { ...state, heroes, successes: Math.min(sMax, state.successes + 1) }
    : { ...state, heroes, failures: Math.min(fMax, state.failures + 1) };
}

/** Successes or failures ±1, kept between 0 and the limit. */
export function stepCounter(state, key, delta) {
  if (!["successes", "failures"].includes(key)) return state;
  const limits = limitsOf(state);
  const max = key === "successes" ? limits.success : limits.failure;
  return { ...state, [key]: Math.min(max, Math.max(0, state[key] + delta)) };
}

/** Round ±1 (up to one past the last round, which means time is up); every hero may act again. */
export function stepRound(state, delta) {
  const round = Math.min(state.maxRounds + 1, Math.max(1, state.round + delta));
  if (round === state.round) return state;
  return { ...state, round, heroes: state.heroes.map(h => ({ ...h, acted: false })) };
}

/* -------------------------------------------------- */
/*   State access                                     */
/* -------------------------------------------------- */

const getState = () => normalizeMontage(game.settings.get(MODULE_ID, STATE));

async function saveState(state) {
  if (!game.user.isGM) return;
  await game.settings.set(MODULE_ID, STATE, state);
}

async function update(fn) {
  const next = fn(getState());
  await saveState(next);
  return next;
}

/** Heroes of the primary party (system `game.actors.party`), else heroes owned by a player. */
function partyHeroes() {
  const members = game.actors.party?.system?.members;
  const fromParty = [];
  try {
    for (const entry of members?.values?.() ?? []) {
      if (entry?.actor?.type === "hero") fromParty.push(entry.actor);
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | Fix 15: could not read the party`, err);
  }
  if (fromParty.length) return fromParty;
  return game.actors.filter(a => a.type === "hero" && a.hasPlayerOwner);
}

const heroData = actor => ({ uuid: actor.uuid, name: actor.name, img: actor.img });

async function addParty() {
  await update(state => partyHeroes().reduce((s, actor) => addHero(s, heroData(actor)), state));
}

async function start() {
  if (!game.user.isGM) return;
  if (getState().active) return tracker.sync({ open: true });
  const fresh = { ...defaultMontageState(), active: true, runId: foundry.utils.randomID() };
  await saveState(partyHeroes().reduce((s, actor) => addHero(s, heroData(actor)), fresh));
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
  await saveState(defaultMontageState());
  return true;
}

/** Same montage, counters back to the start: no successes or failures, round 1, no hero has acted or used a skill. */
async function restart() {
  await update(s => ({
    ...s, successes: 0, failures: 0, round: 1, awarded: false,
    heroes: s.heroes.map(h => ({ ...h, acted: false, skills: [] })),
  }));
}

/** Director side of a test result (local, or from a player's query). */
async function applyResult({ userId, uuid, success, skill }) {
  if (!game.user.isGM) return false;
  const user = game.users.get(userId);
  const actor = await fromUuid(uuid).catch(() => null);
  if (!user || !actor || !actor.testUserPermission(user, "OWNER")) return false;
  const state = getState();
  if (!state.active || !state.heroes.some(h => h.uuid === uuid)) return false;
  await saveState(recordResult(state, { uuid, success: !!success, skill: skill || "" }));
  return true;
}

/** Roll a test for a hero in the montage and hand the result to the Director. */
async function rollTest(uuid, characteristic, difficulty) {
  const actor = await fromUuid(uuid).catch(() => null);
  if (!actor?.isOwner || typeof actor.system?.rollCharacteristic !== "function") return;
  const message = await actor.system.rollCharacteristic(characteristic, { difficulty });
  if (!message) return;
  const part = message.system?.parts?.sortedContents?.findLast?.(p => p.type === "test");
  const tier = part?.latestTest?.product ?? message.rolls?.[0]?.product;
  if (tier == null) {
    console.warn(`${MODULE_ID} | Fix 15: no test tier on message ${message.id}`);
    return ui.notifications.warn(L("NoTier"));
  }
  const payload = {
    userId: game.user.id,
    uuid,
    success: testSucceeds(tier, difficulty),
    skill: message.rolls?.[0]?.options?.skill || "",
  };
  if (game.user.isGM) return applyResult(payload);
  const gm = game.users.activeGM;
  if (!gm) return ui.notifications.warn(game.i18n.localize("DSLF.Trackers.NoGM"));
  try {
    await gm.query(QUERY, payload, { timeout: 30000 });
  } catch (err) {
    console.error(`${MODULE_ID} | Fix 15: the Director did not record the test`, err);
    ui.notifications.warn(game.i18n.localize("DSLF.Trackers.NoGM"));
  }
}

async function awardVictories() {
  if (!game.user.isGM) return;
  const state = getState();
  const outcome = montageOutcome(state);
  const count = victoriesFor(outcome, state.difficulty);
  if (!count || state.awarded) return;
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: L("Award") },
    content: `<p>${L("AwardConfirm", { victories: L(count === 1 ? "VictoryOne" : "VictoryMany", { count }), heroes: state.heroes.length })}</p>`,
  });
  if (!ok) return;
  const victories = L(count === 1 ? "VictoryOne" : "VictoryMany", { count });
  const names = [];
  for (const hero of state.heroes) {
    const actor = await fromUuid(hero.uuid).catch(() => null);
    if (actor?.type !== "hero") continue;
    await actor.update({ "system.hero.victories": (actor.system.hero?.victories ?? 0) + count });
    names.push(Handlebars.escapeExpression(actor.name));
  }
  await saveState({ ...getState(), awarded: true });
  const title = Handlebars.escapeExpression(state.title || L("Title"));
  await ChatMessage.create({
    speaker: { alias: title },
    content: `<p><strong>${title}</strong>: ${L(`Outcome.${outcome}`)}.</p><p>${L("AwardChat", { victories, names: names.join(", ") })}</p>`,
  });
}

/* -------------------------------------------------- */
/*   Application                                      */
/* -------------------------------------------------- */

const tracker = createTrackerController({ label: "Fix 15", getState });

function defineApp() {
  const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
  const Base = TrackerWindowMixin(HandlebarsApplicationMixin(ApplicationV2), { flag: FLAG });

  return class MontageTracker extends Base {
    static DEFAULT_OPTIONS = {
      id: "dslf-montage",
      classes: ["dslf-tracker", "dslf-montage"],
      window: { title: "DSLF.Montage.Title", icon: "fa-solid fa-mountain-sun", resizable: true },
      position: { width: 360, height: "auto" },
      actions: {
        step: MontageTracker.#onStep,
        reveal: MontageTracker.#onReveal,
        round: MontageTracker.#onRound,
        toggleActed: MontageTracker.#onToggleActed,
        removeHero: MontageTracker.#onRemoveHero,
        openRoll: MontageTracker.#onOpenRoll,
        roll: MontageTracker.#onRoll,
        award: () => awardVictories(),
        addParty: () => addParty(),
        rules: () => openRulesPage("montageTest"),
        restart: () => restart(),
        end: () => end(),
      },
    };

    static PARTS = { content: { template: TEMPLATE } };

    get title() {
      return getState().title || L("Title");
    }

    /** Local, per client: the hero whose roll form is open, and its last choices. */
    rollFor = null;
    rollChr = "might";
    rollDiff = "medium";

    _getHeaderControls() {
      const controls = super._getHeaderControls();
      controls.push({ icon: "fa-solid fa-book-open", label: "DSLF.Trackers.Rules", action: "rules" });
      if (game.user.isGM) {
        controls.push(
          { icon: "fa-solid fa-users", label: "DSLF.Montage.AddParty", action: "addParty" },
          { icon: "fa-solid fa-rotate-left", label: "DSLF.Montage.ResetCounters", action: "restart" },
          { icon: "fa-solid fa-flag-checkered", label: "DSLF.Montage.End", action: "end" },
        );
      }
      return controls;
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const state = getState();
      const isGM = game.user.isGM;
      const limits = limitsOf(state);
      const outcome = montageOutcome(state);
      const segments = (value, max) => Array.from({ length: max }, (_, i) => ({ on: i < value }));
      const bars = [
        { key: "successes", value: state.successes, max: limits.success },
        { key: "failures", value: state.failures, max: limits.failure },
      ].map(b => ({
        ...b,
        label: L(b.key === "successes" ? "Successes" : "Failures"),
        segments: segments(b.value, b.max),
        revealed: state.reveal[b.key],
        show: isGM || state.reveal[b.key],
      }));
      const skills = globalThis.ds?.CONFIG?.skills?.list ?? {};
      const skillLabel = key => game.i18n.localize(skills[key]?.label ?? key);
      const canAct = !outcome && state.round <= state.maxRounds;
      const heroes = state.heroes.map(h => {
        const actor = fromUuidSync(h.uuid, { strict: false });
        return {
          ...h,
          skillLabels: h.skills.map(skillLabel),
          canRoll: canAct && !h.acted && (isGM || !!actor?.isOwner),
          rolling: this.rollFor === h.uuid,
        };
      });
      const characteristics = Object.entries(globalThis.ds?.CONFIG?.characteristics ?? {}).map(([key, c]) => ({
        key, label: game.i18n.localize(c.label ?? key), selected: key === this.rollChr,
      }));
      const testDifficulties = Object.entries(globalThis.ds?.CONST?.testOutcomes ?? {}).map(([key, t]) => ({
        key, label: game.i18n.localize(t.label ?? key), selected: key === this.rollDiff,
      }));
      const victories = victoriesFor(outcome, state.difficulty);
      return Object.assign(context, {
        isGM,
        title: state.title,
        titleLabel: state.title || L("Title"),
        difficulty: state.difficulty,
        difficulties: Object.keys(MONTAGE_DIFFICULTIES).map(key => {
          const l = adjustedLimits(key, effectiveHeroCount(state));
          return { key, label: L(`Difficulty.${key}`), limits: `${l.success}/${l.failure}`, selected: key === state.difficulty };
        }),
        heroCount: state.heroCount ?? "",
        heroCountAuto: effectiveHeroCount(state),
        bars,
        round: {
          value: Math.min(state.round, state.maxRounds),
          max: state.maxRounds,
          over: timeIsUp(state),
          revealed: state.reveal.round,
          show: isGM || state.reveal.round,
          canBack: state.round > 1,
          canForward: state.round <= state.maxRounds,
        },
        heroes,
        characteristics,
        testDifficulties,
        outcome: outcome ? {
          key: outcome,
          label: L(`Outcome.${outcome}`),
          victories,
          victoriesLabel: L(victories === 1 ? "VictoryOne" : "VictoryMany", { count: victories }),
          canAward: isGM && victories > 0 && !state.awarded,
          awarded: state.awarded,
          show: isGM || (state.reveal.successes && state.reveal.failures),
        } : null,
      });
    }

    async _onFirstRender(context, options) {
      await super._onFirstRender(context, options);
      this.element.addEventListener("change", event => this.#onChange(event));
      this.element.addEventListener("dragover", event => {
        if (game.user.isGM) event.preventDefault();
      });
      this.element.addEventListener("drop", event => this.#onDrop(event));
    }

    async #onChange(event) {
      const field = event.target.dataset.field;
      const value = event.target.value;
      switch (field) {
        case "rollChr": this.rollChr = value; return;
        case "rollDiff": this.rollDiff = value; return;
      }
      if (!game.user.isGM) return;
      switch (field) {
        case "title": return update(s => ({ ...s, title: value.trim() }));
        case "difficulty": return update(s => ({ ...s, difficulty: value }));
        case "heroCount": {
          const n = Number.parseInt(value, 10);
          return update(s => ({ ...s, heroCount: Number.isInteger(n) && n > 0 ? n : null }));
        }
      }
    }

    async #onDrop(event) {
      if (!game.user.isGM) return;
      event.preventDefault();
      const actor = await actorFromDrop(event);
      if (actor?.type !== "hero") return;
      await update(s => addHero(s, heroData(actor)));
    }

    static async #onStep(event, target) {
      await update(s => stepCounter(s, target.dataset.key, Number(target.dataset.delta) || 0));
    }

    static async #onReveal(event, target) {
      const key = target.dataset.key;
      await update(s => ({ ...s, reveal: { ...s.reveal, [key]: !s.reveal[key] } }));
    }

    static async #onRound(event, target) {
      await update(s => stepRound(s, Number(target.dataset.delta) || 0));
    }

    static async #onToggleActed(event, target) {
      const uuid = target.closest("[data-uuid]")?.dataset.uuid;
      await update(s => ({ ...s, heroes: s.heroes.map(h => h.uuid === uuid ? { ...h, acted: !h.acted } : h) }));
    }

    static async #onRemoveHero(event, target) {
      const uuid = target.closest("[data-uuid]")?.dataset.uuid;
      await update(s => removeHero(s, uuid));
    }

    static #onOpenRoll(event, target) {
      const uuid = target.closest("[data-uuid]")?.dataset.uuid;
      this.rollFor = this.rollFor === uuid ? null : uuid;
      this.render();
    }

    static async #onRoll(event, target) {
      const uuid = this.rollFor;
      if (!uuid) return;
      this.rollFor = null;
      this.render();
      await rollTest(uuid, this.rollChr, this.rollDiff);
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

export const montageApi = {
  start,
  end,
  /** Open (or bring forward) the running montage's window on this client. */
  open: () => tracker.sync({ open: true }),
  /** Console check: the stored state and what the window shows. */
  check() {
    const state = getState();
    return {
      state,
      limits: limitsOf(state),
      outcome: montageOutcome(state),
      rendered: !!tracker.instance?.rendered,
      text: document.getElementById("dslf-montage")?.innerText.replace(/\s+/g, " ").trim() ?? null,
    };
  },
};

export function registerMontageTracker() {
  Hooks.once("init", () => {
    game.settings.register(MODULE_ID, STATE, {
      scope: "world",
      config: false,
      type: Object,
      default: defaultMontageState(),
      onChange: () => {
        tracker.queue();
        ui.controls?.render();
      },
    });
    game.settings.register(MODULE_ID, ENABLED, {
      name: "DSLF.Montage.Settings.Name",
      hint: "DSLF.Montage.Settings.Hint",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      onChange: () => ui.controls?.render(),
    });
    CONFIG.queries[QUERY] = payload => applyResult(payload ?? {});
  });

  Hooks.on("getSceneControlButtons", controls => {
    try {
      const tools = controls.tokens?.tools;
      if (!tools || !game.settings.get(MODULE_ID, ENABLED)) return;
      const active = getState().active;
      if (!game.user.isGM && !active) return;
      tools[TOOL] = {
        name: TOOL,
        title: game.user.isGM && !active ? "DSLF.Montage.Start" : "DSLF.Montage.Open",
        icon: "fa-solid fa-mountain-sun",
        order: Object.keys(tools).length,
        button: true,
        onChange: () => void (game.user.isGM && !getState().active ? start() : tracker.sync({ open: true })),
      };
    } catch (err) {
      console.error(`${MODULE_ID} | Fix 15: scene control failed`, err);
    }
  });

  Hooks.once("ready", () => {
    if (tracker.ready(defineApp)) console.log(`${MODULE_ID} | Fix 15: montage tracker`);
  });
}
