// Derived from Draw Steel - Combat Tracker (MIT, Copyright (c) 2026 Ömer Cora); see THIRD-PARTY-NOTICES.md.
/**
 * Fix 6 — Draw Steel - Combat Tracker dock: activation mode + undo, group management,
 *         setup phase before combat, adjustable size.
 *
 * Extends draw-steel-combat-tracker 1.0.9 (Ömer Cora) from the outside; the tracker's own files stay
 * untouched. The four features:
 *
 *   F1  Turn activation mode (world setting): double-click (default), single click (stock), click
 *       with confirmation, or Ctrl/Shift/Meta+click. In every mode but "click" a plain click only
 *       selects and pans to the token(s). Every activation snapshots turn, initiatives, the hero's
 *       heroic resource and the chat message the system posts, so "Undo Last Activation" (menu
 *       entry, button next to End Turn, context menu) can revert a misclick. Players relay their
 *       record to the GM over this module's socket so the Director can undo for them.
 *   F2  Group management for the GM: Create Group / Add Selected Tokens in the menu, drag & drop of
 *       portraits onto group pills or onto a side (leave group), and a context menu on pills and
 *       portraits (rename, add selected, remove members, toggle defeated/captain, move to group,
 *       remove from encounter, plus the system's own group entries).
 *   F3  Setup phase (world setting): the dock is shown as soon as an encounter exists, with
 *       "Setting up", Begin Combat, Add Selected Tokens and Roll for First.
 *   F4  Sizing: client setting for the portrait size driving CSS variables, and the resizable
 *       width is persisted per client (double-click a handle to reset).
 *
 * Mechanism: `scripts/combat-dock.mjs` of the tracker exports `class CombatDock`; its `module.mjs`
 * imports it statically, so a dynamic `import()` of the same URL from here returns the very same
 * module instance. The prototype methods that the patch changed (`render`, `close`,
 * `_prepareContext`, `_activateListeners`, `_onResizeStart`, the three activation handlers and
 * `_onAction`) are replaced with the patched versions and the new methods are added. Method names
 * and `(event, el)` signatures are kept because Combat Tools (`src/squad-turns.mjs`) layers its own
 * patch of `_getEntries` / `_onMiniPortraitClick` on top at `ready`. `_getEntries` is not touched
 * here; the mode-aware tooltip hint is injected in `_prepareContext` instead.
 *
 * Upstream's own lifecycle hooks stay registered. They close the dock whenever the combat has not
 * started; the `close` override re-syncs afterwards so the setup dock comes back. The port installs
 * only on tracker versions listed in VERIFIED_VERSIONS and otherwise disables itself with a console
 * warning and a GM notification.
 *
 * Settings live under this module's namespace (`trackerActivationMode`, `trackerShowBeforeStart`,
 * `trackerPortraitSize`, `trackerDockWidth`); values stored by the old patch under the tracker's
 * namespace are migrated once at `ready`.
 */

import { MODULE_ID } from "../shared.mjs";
import { isDefaultImage, ringArt } from "./ring-art-images.mjs";

const TRACKER_ID = "draw-steel-combat-tracker";
const VERIFIED_VERSIONS = ["1.0.9"];
const TEMPLATE = `modules/${MODULE_ID}/templates/tracker-combat-dock.hbs`;
const SOCKET = `module.${MODULE_ID}`;

const SETTINGS = {
  activationMode: "trackerActivationMode",
  showBeforeStart: "trackerShowBeforeStart",
  portraitSize: "trackerPortraitSize",
  dockWidth: "trackerDockWidth",
};

const log = (...args) => console.log(`${MODULE_ID} | Fix 6:`, ...args);
const warn = (...args) => console.warn(`${MODULE_ID} | Fix 6:`, ...args);

/** Our own strings. */
const L = (key) => game.i18n.localize(`DSLF.Tracker.${key}`);
const F = (key, data) => game.i18n.format(`DSLF.Tracker.${key}`, data);
/** Strings shipped by the tracker itself. */
const T = (key) => game.i18n.localize(`${TRACKER_ID}.${key}`);

const getSetting = (key) => game.settings.get(MODULE_ID, SETTINGS[key]);
const setSetting = (key, value) => game.settings.set(MODULE_ID, SETTINGS[key], value);

/** The tracker's CombatDock class once imported. */
let CombatDockClass = null;
/** True once the prototype overrides are in place. */
let installed = false;
/** Why the fix is disabled (shown to the GM at ready), or null. */
let disabledReason = null;
/** Resolves when installation has been attempted (success or not). */
let installPromise = null;

/* -------------------------------------------------- */
/*  Dock lifecycle (port of module.mjs)               */
/* -------------------------------------------------- */

/**
 * Should the dock be shown for this combat? Before the encounter starts it is shown only when the
 * setup-phase setting is on.
 */
function shouldShowDock(combat) {
  if (!combat || !game.combats?.isDefaultInitiativeMode) return false;
  if (!game.combats.has(combat.id)) return false;
  return combat.started || !!getSetting("showBeforeStart");
}

let syncTimer = null;

/**
 * Idempotently create, refresh or close the dock for the currently viewed combat. Deferred by a
 * tick so that `game.combat` reflects the update that triggered the call.
 */
function syncDock() {
  if (!installed) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    const combat = game.combat;
    if (!shouldShowDock(combat)) {
      ui.dsCombatDock?.close();
      return;
    }
    if (ui.dsCombatDock?.combat !== combat) new CombatDockClass(combat).render();
    else ui.dsCombatDock.scheduleRefresh();
  }, 0);
}

function registerLifecycleHooks() {
  Hooks.on("createCombat", (combat) => {
    if (combat === game.combat || combat.active) syncDock();
  });
  Hooks.on("combatStart", () => syncDock());
  Hooks.on("updateCombat", (combat, changes) => {
    // Another encounter activated, scene reassigned, or round moved (incl. back to 0): resync
    if (("active" in changes) || ("scene" in changes) || ("round" in changes)) syncDock();
  });
  Hooks.on("createCombatant", (combatant) => {
    // First token added to a fresh encounter: the setup dock may not exist yet
    if ((combatant.combat === game.combat) && (ui.dsCombatDock?.combat !== combatant.combat)) syncDock();
  });
  Hooks.on("canvasReady", () => syncDock());
}

function registerSocket() {
  game.socket.on(SOCKET, (data) => {
    if (!data?.tracker || !game.user.isGM) return;
    const dock = ui.dsCombatDock;
    if (!dock) return;
    if ((data.type === "activation") && (data.record?.combatId === dock.combat?.id)) {
      dock._lastActivation = data.record;
      dock.scheduleRefresh();
    } else if ((data.type === "activationUndone") && (data.combatId === dock.combat?.id)) {
      dock._lastActivation = null;
      dock.scheduleRefresh();
    }
  });
}

/* -------------------------------------------------- */
/*  Settings                                          */
/* -------------------------------------------------- */

function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.activationMode, {
    name: "DSLF.Tracker.Settings.ActivationMode.Name",
    hint: "DSLF.Tracker.Settings.ActivationMode.Hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      doubleClick: "DSLF.Tracker.Settings.ActivationMode.DoubleClick",
      click: "DSLF.Tracker.Settings.ActivationMode.Click",
      confirm: "DSLF.Tracker.Settings.ActivationMode.Confirm",
      modifier: "DSLF.Tracker.Settings.ActivationMode.Modifier",
    },
    default: "doubleClick",
    onChange: () => ui.dsCombatDock?.scheduleRefresh(),
  });

  game.settings.register(MODULE_ID, SETTINGS.showBeforeStart, {
    name: "DSLF.Tracker.Settings.ShowBeforeStart.Name",
    hint: "DSLF.Tracker.Settings.ShowBeforeStart.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => syncDock(),
  });

  game.settings.register(MODULE_ID, SETTINGS.portraitSize, {
    name: "DSLF.Tracker.Settings.PortraitSize.Name",
    hint: "DSLF.Tracker.Settings.PortraitSize.Hint",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 48, max: 140, step: 4 },
    default: 80,
    onChange: () => {
      ui.dsCombatDock?.applySizing?.();
      ui.dsCombatDock?.scheduleRefresh();
    },
  });

  game.settings.register(MODULE_ID, SETTINGS.dockWidth, {
    scope: "client",
    config: false,
    type: Number,
    default: 0,
  });
}

/** Parse a stored setting value that may still be its JSON string form. */
function parseStored(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (_err) {
    return value;
  }
}

/** One-time copy of the values the old in-place patch stored under the tracker's namespace. */
async function migrateOldSettings() {
  const defaults = (key) => game.settings.settings.get(`${MODULE_ID}.${SETTINGS[key]}`)?.default;

  if (game.user.isGM) {
    for (const key of ["activationMode", "showBeforeStart"]) {
      try {
        if (getSetting(key) !== defaults(key)) continue;
        const old = game.settings.storage.get("world")?.getSetting?.(`${TRACKER_ID}.${key}`);
        if (!old) continue;
        const value = parseStored(old.value);
        if ((value === undefined) || (value === null) || (value === defaults(key))) continue;
        await setSetting(key, value);
        log(`migrated world setting ${key} = ${JSON.stringify(value)} from the old in-place patch.`);
      } catch (err) {
        warn(`could not migrate world setting ${key}:`, err);
      }
    }
  }

  for (const key of ["portraitSize", "dockWidth"]) {
    try {
      if (getSetting(key) !== defaults(key)) continue;
      const raw = game.settings.storage.get("client")?.getItem?.(`${TRACKER_ID}.${key}`);
      if (raw === null || raw === undefined) continue;
      const value = parseStored(raw);
      if (!Number.isFinite(value) || (value === defaults(key))) continue;
      await setSetting(key, value);
      log(`migrated client setting ${key} = ${value} from the old in-place patch.`);
    } catch (err) {
      warn(`could not migrate client setting ${key}:`, err);
    }
  }
}

/* -------------------------------------------------- */
/*  Prototype overrides (port of combat-dock.mjs)     */
/* -------------------------------------------------- */

/**
 * Build the replacement / additional methods for CombatDock.prototype.
 * @param {object} orig  The original prototype methods that are replaced.
 */
function buildOverrides(orig) {
  const DialogClass = () => foundry.applications.api.DialogV2 ?? foundry.applications.api.Dialog;

  return {
    /* ---------- render / close ---------- */

    async render() {
      // Only show for Draw Steel's default (zipper) initiative mode
      if (!game.combats?.isDefaultInitiativeMode) return;
      // A closed or replaced dock never renders (the constructor replaces ui.dsCombatDock via close()).
      if (this._dslfClosed || (ui.dsCombatDock !== this)) return;

      const context = this._prepareContext();
      if (!context.visible) return;

      const html = await foundry.applications.handlebars.renderTemplate(TEMPLATE, context);

      // The template fetch is asynchronous: if this dock was closed or replaced meanwhile, stop here
      // instead of appending a second, orphaned dock element.
      if (this._dslfClosed || (ui.dsCombatDock !== this)) return;

      if (!this.element) {
        // Remove any stale dock element left behind by another path before creating ours.
        for (const el of document.querySelectorAll("section#ds-combat-dock")) {
          if (el !== this.element) el.remove();
        }
        this.element = document.createElement("section");
        this.element.id = "ds-combat-dock";
        this.element.classList.add(TRACKER_ID);
        document.getElementById("ui-top")?.prepend(this.element);
      }

      this.element.innerHTML = html;
      if (this._collapsed) this.element.classList.add("collapsed");
      this.element.classList.toggle("setup", !context.started);

      // Align-left mode
      const alignLeft = game.settings.get(TRACKER_ID, "alignLeft");
      this.element.classList.toggle("align-left", alignLeft);

      // Resizable width mode
      const resizable = game.settings.get(TRACKER_ID, "resizableWidth");
      this.element.classList.toggle("resizable", resizable);
      if (resizable) {
        this._dockWidth ??= getSetting("dockWidth") || null;
        if (this._dockWidth) this.element.style.setProperty("--dock-width", this._dockWidth + "px");
        const inner = this.element.querySelector(".ds-combat-dock");
        if (inner) {
          for (const side of ["left", "right"]) {
            const handle = document.createElement("div");
            handle.classList.add("ds-resize-handle", `ds-resize-handle-${side}`);
            inner.appendChild(handle);
          }
        }
      } else {
        this.element.style.removeProperty("--dock-width");
        this._dockWidth = null;
      }

      this.applySizing();
      this._activateListeners();

      // Scroll party side to right end so the active (rightmost) portraits are visible
      const partyEl = this.element.querySelector(".ds-dock-party");
      if (partyEl) partyEl.scrollLeft = partyEl.scrollWidth;
    },

    /**
     * Apply the client's portrait size setting as CSS variables on the dock element.
     * `--ds-portrait-size` is a length; `--ds-scale` is the unitless ratio to the 80px default.
     */
    applySizing() {
      if (!this.element) return;
      const size = Number(getSetting("portraitSize")) || 80;
      this.element.style.setProperty("--ds-portrait-size", `${size}px`);
      this.element.style.setProperty("--ds-scale", String(size / 80));
    },

    close() {
      const combat = this.combat;
      this._dslfClosed = true;
      if (this._contextMenu && (ui.context === this._contextMenu)) this._contextMenu.close({ animate: false });
      this._contextMenu = null;
      orig.close.call(this);
      // The tracker's own hooks close the dock whenever the combat has not started; bring the
      // setup dock back when it should be visible. (A replacement dock created right after this
      // close is detected by syncDock and merely refreshed.)
      if (combat && (combat === game.combat) && shouldShowDock(combat)) syncDock();
    },

    /* ---------- context ---------- */

    _prepareContext() {
      const combat = this.combat;
      if (!combat) return { visible: false, started: false };
      const started = combat.started;
      if (!started && !getSetting("showBeforeStart")) return { visible: false, started: false };
      const setup = !started;

      const entries = this._getEntries();
      const partyEntries = entries.filter(e => e.isParty).reverse();
      const enemyEntries = entries.filter(e => !e.isParty);

      const currentCombatant = combat.combatant;
      const rawHasTurn = (currentCombatant != null) && Number.isNumeric(combat.turn);
      const hasTurn = !setup && rawHasTurn && !this._isInitialPhase();

      // Determine turn label and track acting side
      let turnLabel = "";
      if (hasTurn) {
        const isParty = currentCombatant.hasPlayerOwner || (currentCombatant.disposition === 2);
        this._lastActedSide = isParty ? "party" : "enemy";
        turnLabel = T(isParty ? "HeroTurn" : "VillainTurn");
      }

      // Determine which side should be highlighted (act next)
      let partyHighlighted = false;
      let enemyHighlighted = false;

      if (!hasTurn && !setup) {
        const partyCanAct = partyEntries.some(e => e.canAct);
        const enemyCanAct = enemyEntries.some(e => e.canAct);

        if ((this._lastActedSide === "party") && enemyCanAct) {
          enemyHighlighted = true;
        } else if ((this._lastActedSide === "enemy") && partyCanAct) {
          partyHighlighted = true;
        } else {
          partyHighlighted = partyCanAct;
          enemyHighlighted = enemyCanAct;
        }
      }

      // Compute CSS classes per entry (and nested retainerData); inject the mode-aware action hint
      for (const entry of entries) {
        entry.actionHint = this._getActionHint(entry.canAct, entry.defeated);
        const classes = [];
        if (entry.defeated) classes.push("defeated");
        if (!setup) {
          if (entry.active && hasTurn) classes.push("active");
          else if (!entry.canAct && !entry.defeated) classes.push("done");
          if (entry.canAct && !entry.defeated) classes.push("can-act");
        }
        if (entry.hidden) classes.push("hidden-combatant");
        if (entry.totalTurns > 1) {
          classes.push("multi-turn");
          if (entry.initiative >= entry.totalTurns) classes.push("outer-ready");
        }
        entry.cssClass = classes.join(" ");

        if (entry.retainerData) {
          const rd = entry.retainerData;
          rd.actionHint = this._getActionHint(rd.canAct, rd.defeated);
          const rClasses = [];
          if (rd.defeated) rClasses.push("defeated");
          if (!setup) {
            if (rd.active && hasTurn) rClasses.push("active");
            else if (!rd.canAct && !rd.defeated) rClasses.push("done");
            if (rd.canAct && !rd.defeated) rClasses.push("can-act");
          }
          if (rd.hidden) rClasses.push("hidden-combatant");
          rd.cssClass = rClasses.join(" ");
        }
      }

      // End turn permissions
      const canEndTurn = hasTurn && (game.user.isGM || currentCombatant.players?.includes(game.user));

      // Check if all non-defeated entries have acted
      const allActed = !setup && entries.filter(e => !e.defeated).every(e => !e.canAct);

      // Turn label when round is complete
      if (!hasTurn && allActed) turnLabel = T("RoundComplete");
      if (setup) turnLabel = L("SetupPhase");

      // Store tooltip data for floating tooltip
      this._tooltipData = new Map();
      for (const entry of entries) {
        if (entry.tooltipData) {
          this._tooltipData.set(entry.id, { name: entry.name, actionHint: entry.actionHint, tooltipData: entry.tooltipData, isOwner: entry.isOwner });
        }
        if (entry.captainData?.tooltipData) {
          this._tooltipData.set(entry.captainData.id, { name: entry.captainData.name, actionHint: entry.actionHint, tooltipData: entry.captainData.tooltipData, isOwner: entry.isOwner });
        }
        if (entry.nonMinionMembers) {
          for (const m of entry.nonMinionMembers) {
            if (m.tooltipData) {
              this._tooltipData.set(m.id, { name: m.name, actionHint: entry.actionHint, tooltipData: m.tooltipData, isOwner: entry.isOwner });
            }
          }
        }
        if (entry.minionGroups) {
          for (const chunk of entry.minionGroups) {
            for (const m of chunk) {
              if (m.tooltipData) {
                this._tooltipData.set(m.id, { name: m.name, actionHint: entry.actionHint, tooltipData: m.tooltipData, isOwner: entry.isOwner });
              }
            }
          }
        }
        if (entry.retainerData?.tooltipData) {
          this._tooltipData.set(entry.retainerData.id, { name: entry.retainerData.name, actionHint: entry.retainerData.actionHint, tooltipData: entry.retainerData.tooltipData, isOwner: entry.isOwner });
        }
      }

      return {
        visible: true,
        started,
        setup,
        isGM: game.user.isGM,
        canUndo: !!this._getUndoableActivation(),
        combatantCount: combat.combatants.size,
        round: combat.round,
        turnLabel,
        hasTurn,
        canEndTurn,
        allActed: allActed && !hasTurn,
        partyEntries,
        enemyEntries,
        partyHighlighted,
        enemyHighlighted,
      };
    },

    /* ---------- listeners ---------- */

    _activateListeners() {
      if (!this.element) return;

      const isGM = game.user.isGM;

      /**
       * Bind click + dblclick on an element and route both through the activation dispatcher.
       * @param {HTMLElement} el                 The element receiving the events.
       * @param {Function} handler               The activation handler (called with event, el-like).
       * @param {object} [opts]
       * @param {boolean} [opts.stop]            Stop propagation (nested elements).
       * @param {Function} [opts.skip]           Predicate: ignore events matching it.
       * @param {HTMLElement} [opts.target]      Element to use for select/pan and state checks.
       */
      const bindActivation = (el, handler, { stop = false, skip = null, target = null } = {}) => {
        const run = (event) => {
          if (skip && skip(event)) return;
          if (stop) event.stopPropagation();
          this._dispatchActivation(event, target ?? el, handler);
        };
        el.addEventListener("click", run);
        el.addEventListener("dblclick", run);
      };

      // Portrait interactions (individual combatants — skip those inside a mentor pair)
      for (const el of this.element.querySelectorAll(".ds-portrait")) {
        if (el.closest(".ds-mentor-pair")) continue;
        bindActivation(el, (event) => this._onPortraitClick(event, el));
        if (!isGM) el.addEventListener("contextmenu", (event) => this._onPortraitContext(event, el));
        el.addEventListener("mouseenter", (event) => { this._onPortraitHover(event, el, true); this._showTooltip(el); });
        el.addEventListener("mouseleave", (event) => { this._onPortraitHover(event, el, false); this._hideTooltip(); });
      }

      // Retainer portrait interactions (activation takes retainer's own turn, right-click opens sheet)
      for (const el of this.element.querySelectorAll(".ds-retainer-portrait")) {
        const memberId = el.dataset.memberId;
        bindActivation(el, (event) => this._onPortraitClick(event, { dataset: { id: memberId } }), { stop: true });
        if (!isGM) {
          el.addEventListener("contextmenu", (event) => {
            event.stopPropagation();
            event.preventDefault();
            const combatant = this.combat.combatants.get(memberId);
            if (combatant?.actor?.testUserPermission(game.user, "OBSERVER")) {
              combatant.actor.sheet?.render(true);
            }
          });
        }
        el.addEventListener("mouseenter", (event) => { event.stopPropagation(); this._showTooltip(el); });
        el.addEventListener("mouseleave", (event) => { event.stopPropagation(); this._hideTooltip(); });
      }

      // Mentor pair interactions (the pair wrapper acts/restores the mentor)
      for (const el of this.element.querySelectorAll(".ds-mentor-pair")) {
        const mentorPortrait = el.querySelector(".ds-portrait");
        if (!mentorPortrait) continue;
        bindActivation(el, (event) => this._onPortraitClick(event, el), {
          skip: (event) => event.target.closest(".ds-retainer-portrait"),
        });
        if (!isGM) {
          el.addEventListener("contextmenu", (event) => {
            if (event.target.closest(".ds-retainer-portrait")) return;
            this._onPortraitContext(event, el);
          });
        }
        el.addEventListener("mouseenter", (event) => { this._onPortraitHover(event, el, true); this._showTooltip(mentorPortrait); });
        el.addEventListener("mouseleave", (event) => { this._onPortraitHover(event, el, false); this._hideTooltip(); });
      }

      // Group container interactions (pill toggles group act/restore)
      for (const el of this.element.querySelectorAll(".ds-group-container")) {
        bindActivation(el, (event) => this._onGroupPillClick(event, el));
        if (!isGM) el.addEventListener("contextmenu", (event) => this._onPortraitContext(event, el));
        el.addEventListener("mouseenter", (event) => this._onPortraitHover(event, el, true));
        el.addEventListener("mouseleave", (event) => {
          this._onPortraitHover(event, el, false);
          // If moving to the labels (still inside wrapper but outside pill), re-hover the group
          const wrapper = el.closest(".ds-group-wrapper");
          if (wrapper && event.relatedTarget && wrapper.contains(event.relatedTarget) && !el.contains(event.relatedTarget)) {
            this._onPortraitHover(event, el, true);
          }
        });
      }

      // Group wrapper interactions (labels below the pill act like the pill itself)
      for (const el of this.element.querySelectorAll(".ds-group-wrapper")) {
        const groupEl = el.querySelector(".ds-group-container");
        if (!groupEl) continue;
        bindActivation(el, (event) => this._onGroupPillClick(event, groupEl), {
          skip: (event) => event.target.closest(".ds-group-container"),
          target: groupEl,
        });
        if (!isGM) {
          el.addEventListener("contextmenu", (event) => {
            if (event.target.closest(".ds-group-container")) return;
            this._onPortraitContext(event, groupEl);
          });
        }
        el.addEventListener("mouseenter", (event) => {
          if (event.target.closest(".ds-group-container")) return;
          this._onPortraitHover(event, groupEl, true);
        });
        el.addEventListener("mouseleave", (event) => {
          this._onPortraitHover(event, groupEl, false);
        });
      }

      // Group member interactions (activate individual), right-click, tooltip, and hover highlight
      for (const el of this.element.querySelectorAll(".ds-mini-portrait")) {
        bindActivation(el, (event) => this._onMiniPortraitClick(event, el), { stop: true });
        if (!isGM) {
          el.addEventListener("contextmenu", (event) => {
            event.stopPropagation();
            this._onPortraitContext(event, el);
          });
        }
        el.addEventListener("mouseenter", (event) => {
          event.stopPropagation();
          this._onMiniPortraitHover(event, el, true);
          this._showTooltip(el);
        });
        el.addEventListener("mouseleave", (event) => {
          this._onMiniPortraitHover(event, el, false);
          this._hideTooltip();
          // If moving back to the pill/wrapper area (not to another mini-portrait), re-hover the whole group
          const groupEl = el.closest(".ds-group-container");
          const wrapper = el.closest(".ds-group-wrapper");
          const target = event.relatedTarget;
          if (groupEl && target && (wrapper?.contains(target) || groupEl.contains(target)) && !target.closest?.(".ds-mini-portrait")) {
            const groupId = groupEl.dataset.id;
            const group = this.combat?.groups?.get(groupId);
            if (group) {
              for (const member of group.members) {
                const token = canvas?.tokens?.get(member.tokenId);
                if (token?.visible) token._onHoverIn(event, { hoverOutOthers: false });
              }
            }
          }
        });
      }

      // GM-only: drag & drop of combatants between groups, and context menus
      if (isGM) {
        for (const el of this.element.querySelectorAll("[draggable='true'][data-combatant-id]")) {
          el.addEventListener("dragstart", (event) => this._onDragStart(event, el));
          el.addEventListener("dragend", () => this._onDragEnd());
        }
        for (const el of this.element.querySelectorAll(".ds-group-container, .ds-dock-side")) {
          el.addEventListener("dragover", (event) => {
            if (!event.dataTransfer?.types?.includes("text/plain")) return;
            event.preventDefault();
            event.stopPropagation();
            el.classList.add("ds-drop-target");
          });
          el.addEventListener("dragleave", (event) => {
            if (!el.contains(event.relatedTarget)) el.classList.remove("ds-drop-target");
          });
          el.addEventListener("drop", (event) => this._onDrop(event, el));
        }
        this._createContextMenu();
      }

      // Mouse wheel horizontal scroll for side containers
      for (const el of this.element.querySelectorAll(".ds-dock-side")) {
        el.addEventListener("wheel", (event) => {
          if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            event.preventDefault();
            el.scrollLeft += event.deltaY;
          }
        }, { passive: false });
      }

      // Action buttons
      for (const btn of this.element.querySelectorAll("[data-action]")) {
        btn.addEventListener("click", (event) => this._onAction(event, btn.dataset.action, btn));
      }

      document.removeEventListener("pointerdown", this._onDocumentPointerDown, true);
      document.addEventListener("pointerdown", this._onDocumentPointerDown, true);

      // Drawer toggle buttons (hide and show)
      for (const toggleBtn of this.element.querySelectorAll(".ds-dock-toggle")) {
        toggleBtn.addEventListener("click", () => {
          this._collapsed = !this._collapsed;
          this.element.classList.toggle("collapsed", this._collapsed);
        });
      }

      // Resize handles for horizontal width dragging (double-click resets the width)
      for (const handle of this.element.querySelectorAll(".ds-resize-handle")) {
        handle.addEventListener("mousedown", (event) => this._onResizeStart(event, handle));
        handle.addEventListener("dblclick", (event) => {
          event.preventDefault();
          this._dockWidth = null;
          this.element.style.removeProperty("--dock-width");
          setSetting("dockWidth", 0).catch(() => {});
        });
      }
    },

    _onResizeStart(event, handle) {
      event.preventDefault();
      const isLeft = handle.classList.contains("ds-resize-handle-left");
      const startX = event.clientX;
      const startWidth = this.element.offsetWidth;
      // Minimum accommodates ~3 regular portraits per side + gaps + center panel, scaled with portrait size
      const size = Number(getSetting("portraitSize")) || 80;
      const minWidth = Math.max(600, Math.round(6 * size + 260));
      handle.classList.add("active");

      const onMove = (e) => {
        const delta = e.clientX - startX;
        // Since the dock is centered, double the delta so the edge tracks the cursor
        const newWidth = Math.max(isLeft ? startWidth - (delta * 2) : startWidth + (delta * 2), minWidth);
        this._dockWidth = newWidth;
        this.element.style.setProperty("--dock-width", newWidth + "px");
      };

      const onUp = () => {
        handle.classList.remove("active");
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        // Persist per client so the width survives reloads and dock re-creation
        setSetting("dockWidth", this._dockWidth ?? 0).catch(() => {});
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },

    /* ---------- activation handlers (names/signatures kept for Combat Tools) ---------- */

    async _onPortraitClick(event, el) {
      event.preventDefault();
      if (!this.combat.started) return;
      const { id } = el.dataset;

      const combatant = this.combat.combatants.get(id);
      if (!combatant) return;
      if (!combatant.isOwner && !game.user.isGM) return;

      // Block activation while another turn is active (non-GM)
      const hasTurn = (this.combat.combatant != null) && Number.isNumeric(this.combat.turn) && !this._isInitialPhase();
      const oldValue = combatant.initiative;

      if (oldValue) {
        if (hasTurn && !game.user.isGM) {
          // Allow players to activate their own retainer even during a turn
          const mentorRef = combatant.actor?.type === "retainer"
            ? (combatant.actor.system?.retainer?.mentor?.id ?? combatant.actor.system?.retainer?.mentor)
            : null;
          const isOwnRetainer = mentorRef && (game.user.character?.id === mentorRef);
          if (!isOwnRetainer) return;
        }
        // Activating: decrement initiative and set as current turn
        const rec = this._beginActivation({ combatant });
        try {
          await combatant.update({ initiative: oldValue - 1 });
          const newTurn = this.combat.turns.findIndex(c => c === combatant);
          await this.combat.update({ turn: newTurn }, { direction: 1 });
        } finally {
          this._endActivation(rec);
        }
      } else {
        // Done: restore initiative (GM only)
        if (!game.user.isGM) return;
        const newValue = combatant.actor?.system?.combat?.turns ?? 1;
        await combatant.update({ initiative: newValue });
      }
    },

    async _onMiniPortraitClick(event, el) {
      event.preventDefault();
      event.stopPropagation();
      if (!this.combat.started) return;
      const memberId = el.dataset.memberId;
      const combatant = this.combat.combatants.get(memberId);
      if (!combatant) return;
      if (!combatant.isOwner && !game.user.isGM) return;

      const hasTurn = (this.combat.combatant != null) && Number.isNumeric(this.combat.turn) && !this._isInitialPhase();
      const oldValue = combatant.initiative;

      if (oldValue) {
        if (hasTurn && !game.user.isGM) return;
        // Activating: decrement member initiative and parent group initiative, set as turn
        const group = combatant.group;
        const rec = this._beginActivation({ combatant, group: (group && (group.initiative > 0)) ? group : null });
        try {
          await combatant.update({ initiative: oldValue - 1 });
          if (group && (group.initiative > 0)) {
            await group.update({ initiative: group.initiative - 1 });
          }
          const newTurn = this.combat.turns.findIndex(c => c === combatant);
          await this.combat.update({ turn: newTurn }, { direction: 1 });
        } finally {
          this._endActivation(rec);
        }
      } else {
        // Done: restore initiative (GM only)
        if (!game.user.isGM) return;
        const newValue = combatant.actor?.system?.combat?.turns ?? 1;
        await combatant.update({ initiative: newValue });
      }
    },

    async _onGroupPillClick(event, el) {
      event.preventDefault();
      if (!this.combat.started) return;
      const { id } = el.dataset;
      const group = this.combat.groups.get(id);
      if (!group) return;
      if (!group.isOwner && !game.user.isGM) return;

      const hasTurn = (this.combat.combatant != null) && Number.isNumeric(this.combat.turn) && !this._isInitialPhase();
      const oldValue = group.initiative;

      if (oldValue) {
        if (hasTurn && !game.user.isGM) return;
        // Activating: decrement group initiative, pick a member, decrement their initiative, set as turn
        const combatant = Array.from(group.members).find(c => c.initiative);
        const rec = this._beginActivation({ combatant: combatant ?? null, group });
        try {
          await group.update({ initiative: oldValue - 1 });
          if (combatant) {
            await combatant.update({ initiative: (combatant.initiative ?? 1) - 1 });
            const newTurn = this.combat.turns.findIndex(c => c === combatant);
            await this.combat.update({ turn: newTurn }, { direction: 1 });
          }
        } finally {
          this._endActivation(rec);
        }
      } else {
        // Done: restore initiative (GM only)
        if (!game.user.isGM) return;
        await group.update({ initiative: 1 });
      }
    },

    /* ---------- activation dispatch, selection, undo ---------- */

    /**
     * Route a click or double-click on a portrait/pill according to the activation mode setting.
     * A plain click never activates in `doubleClick` mode: it selects and pans to the token(s).
     */
    async _dispatchActivation(event, el, handler) {
      if (!this.combat?.started) {
        if (event.type === "click") this._selectToken(el);
        return;
      }
      const mode = getSetting("activationMode");
      const activating = el.classList?.contains("can-act") ?? true;

      if (event.type === "dblclick") {
        if (mode === "doubleClick") return handler(event, el);
        return;
      }

      switch (mode) {
        case "click":
          return handler(event, el);
        case "modifier":
          if (event.ctrlKey || event.metaKey || event.shiftKey) return handler(event, el);
          return this._selectToken(el);
        case "confirm":
          if (!activating) return handler(event, el);
          if (this._confirmOpen) return;
          this._confirmOpen = true;
          try {
            if (await this._confirmActivation(el)) return handler(event, el);
          } finally {
            this._confirmOpen = false;
          }
          return;
        default: // doubleClick
          return this._selectToken(el);
      }
    },

    /** Ask the user to confirm starting a turn (`confirm` activation mode). */
    async _confirmActivation(el) {
      const id = el.dataset?.memberId ?? el.dataset?.id;
      const name = this._tooltipData?.get(id)?.name
        ?? this.combat.combatants.get(id)?.name
        ?? this.combat.groups.get(id)?.name
        ?? el.querySelector?.("img")?.alt
        ?? "";
      const content = `<p>${F("ConfirmActivation.Content", { name: foundry.utils.escapeHTML(name) })}</p>`;
      return DialogClass().confirm({
        window: { title: L("ConfirmActivation.Title") },
        content,
        modal: true,
      });
    },

    /**
     * Select (control) and pan to the token(s) behind a portrait or group pill. For a group, every
     * visible, controllable member token is controlled and the view pans to their centroid.
     */
    _selectToken(el) {
      if (!canvas?.ready) return;
      const id = el.dataset?.memberId ?? el.dataset?.id;
      const type = el.dataset?.memberId ? "combatant" : el.dataset?.type;
      if (!id) return;

      let tokens = [];
      if (type === "group") {
        const group = this.combat.groups.get(id);
        if (!group) return;
        tokens = Array.from(group.members).map(m => m.token?.object).filter(Boolean);
      } else {
        const combatant = this.combat.combatants.get(id);
        const token = combatant?.token?.object;
        if (token) tokens = [token];
      }

      const visible = tokens.filter(t => t.visible);
      if (!visible.length) return;

      const controllable = visible.filter(t => t.can(game.user, "control"));
      controllable.forEach((t, i) => t.control({ releaseOthers: i === 0 }));

      const centers = visible.map(t => t.center);
      const x = centers.reduce((sum, c) => sum + c.x, 0) / centers.length;
      const y = centers.reduce((sum, c) => sum + c.y, 0) / centers.length;
      canvas.animatePan({ x, y, duration: 250 });
    },

    /** Localized action hint for the tooltip header, depending on the activation mode. */
    _getActionHint(canAct, defeated) {
      if (!this.combat?.started) return L("SetupHint");
      const mode = getSetting("activationMode");
      if (canAct) {
        switch (mode) {
          case "click": return T("Act");
          case "confirm": return L("ActConfirm");
          case "modifier": return L("ActModifier");
          default: return L("ActDouble");
        }
      }
      if (defeated) return T("Defeated");
      return mode === "doubleClick" ? L("RestoreDouble") : T("Restore");
    },

    /**
     * Snapshot the state an activation is about to change. A temporary `createChatMessage` hook
     * captures the heroic-resource gain message the system posts from `DrawSteelCombatant._preUpdate`
     * (which runs on this client, before `update()` resolves).
     */
    _beginActivation({ combatant, group = null }) {
      const actor = combatant?.actor;
      const rec = {
        combatId: this.combat.id,
        round: this.combat.round,
        userId: game.user.id,
        combatantId: combatant?.id ?? null,
        combatantName: combatant?.name ?? group?.name ?? "",
        prevInitiative: combatant?.initiative ?? null,
        groupId: group?.id ?? null,
        prevGroupInitiative: group?.initiative ?? null,
        prevTurn: this.combat.turn,
        prevLastActedSide: this._lastActedSide,
        prevPrimaryValue: actor?.type === "hero"
          ? (foundry.utils.getProperty(actor, "system.hero.primary.value") ?? null)
          : null,
        messageIds: [],
      };
      const tokenId = combatant?.tokenId ?? null;
      rec._hook = Hooks.on("createChatMessage", (msg) => {
        if (!msg.isAuthor) return;
        if (tokenId && (msg.speaker?.token !== tokenId)) return;
        rec.messageIds.push(msg.id);
      });
      return rec;
    },

    /** Finish an activation: drop the capture hook, remember the record, and tell the GM about it. */
    _endActivation(rec) {
      if (!rec) return;
      if (rec._hook) Hooks.off("createChatMessage", rec._hook);
      delete rec._hook;
      this._lastActivation = rec;
      if (!game.user.isGM) {
        try {
          game.socket.emit(SOCKET, { tracker: true, type: "activation", record: rec });
        } catch (err) {
          warn("could not relay activation record", err);
        }
      }
      this.scheduleRefresh();
    },

    /** Return the last activation record if it can still be undone by this user, else null. */
    _getUndoableActivation() {
      const rec = this._lastActivation;
      if (!rec || !this.combat) return null;
      if ((rec.combatId !== this.combat.id) || (rec.round !== this.combat.round)) return null;
      if (!game.user.isGM && (rec.userId !== game.user.id)) return null;
      if (rec.combatantId) {
        const combatant = this.combat.combatants.get(rec.combatantId);
        if (!combatant) return null;
        if ((rec.prevInitiative == null) || (combatant.initiative !== rec.prevInitiative - 1)) return null;
      }
      if (rec.groupId) {
        const group = this.combat.groups.get(rec.groupId);
        if (!group) return null;
        if ((rec.prevGroupInitiative == null) || (group.initiative !== rec.prevGroupInitiative - 1)) return null;
      }
      if (!rec.combatantId && !rec.groupId) return null;
      return rec;
    },

    /**
     * Undo the last activation: restore turn, group/combatant initiative, the hero's heroic
     * resource, and delete the gain chat message(s).
     */
    async _undoLastActivation() {
      const rec = this._getUndoableActivation();
      if (!rec) {
        ui.notifications?.warn("DSLF.Tracker.NothingToUndo", { localize: true });
        this._lastActivation = null;
        this.scheduleRefresh();
        return;
      }

      const combatant = rec.combatantId ? this.combat.combatants.get(rec.combatantId) : null;
      const group = rec.groupId ? this.combat.groups.get(rec.groupId) : null;

      try {
        await this.combat.update({ turn: rec.prevTurn });
        // Group first, so that Combat Tools' decrease-only squad hooks see nothing to cascade
        if (group) await group.update({ initiative: rec.prevGroupInitiative });
        if (combatant) await combatant.update({ initiative: rec.prevInitiative });
        if (combatant?.actor && (rec.prevPrimaryValue != null)) {
          await combatant.actor.update({ "system.hero.primary.value": rec.prevPrimaryValue });
        }
        const messages = rec.messageIds.map(id => game.messages.get(id)).filter(Boolean);
        if (messages.length) {
          if (game.user.isGM) await CONFIG.ChatMessage.documentClass.deleteDocuments(messages.map(m => m.id));
          else await Promise.allSettled(messages.map(m => m.delete()));
        }
      } catch (err) {
        console.error(`${MODULE_ID} | Fix 6: undo activation failed`, err);
        ui.notifications?.error(err.message);
        return;
      } finally {
        this._lastActedSide = rec.prevLastActedSide ?? null;
        this._lastActivation = null;
        if (!game.user.isGM) {
          try {
            game.socket.emit(SOCKET, { tracker: true, type: "activationUndone", combatId: rec.combatId });
          } catch (_err) {
            // nothing to do
          }
        }
        this.scheduleRefresh();
      }
      ui.notifications?.info(F("UndoDone", { name: rec.combatantName }));
    },

    /* ---------- setup-phase actions ---------- */

    /** Begin the encounter from the dock (GM only). */
    async _startCombat() {
      if (!game.user.isGM || this.combat.started) return;
      if (!this.combat.combatants.size) {
        ui.notifications?.warn("DSLF.Tracker.Notifications.NoCombatants", { localize: true });
        return;
      }
      await this.combat.startCombat();
    },

    /** Add the selected canvas tokens to this encounter (GM only). */
    async _addSelectedTokens() {
      if (!game.user.isGM) return;
      const tokens = canvas?.tokens?.controlled?.map(t => t.document) ?? [];
      if (!tokens.length) {
        ui.notifications?.warn("DSLF.Tracker.Notifications.SelectTokensToAdd", { localize: true });
        return;
      }
      await CONFIG.Token.documentClass.createCombatants(tokens, { combat: this.combat });
    },

    /** Use Draw Steel's "roll for first" if available (GM only). */
    async _rollFirst() {
      if (!game.user.isGM) return;
      if (typeof this.combat.rollFirst !== "function") return;
      await this.combat.rollFirst();
    },

    /* ---------- group management (GM only) ---------- */

    /** Open the system's create dialog for a new, empty combatant group. */
    async _createGroup() {
      if (!game.user.isGM) return;
      const CombatantGroup = CONFIG.CombatantGroup?.documentClass;
      if (typeof CombatantGroup?.createDialog !== "function") return;
      await CombatantGroup.createDialog({}, { parent: this.combat });
    },

    /**
     * Move a combatant into a group (or out of any group with `null`), enforcing the system's rule
     * that minions may only join squads.
     */
    async _moveToGroup(combatant, group) {
      if (!game.user.isGM || !combatant) return;
      if (group) {
        if (combatant.actor?.isMinion && (group.type !== "squad")) {
          ui.notifications?.error("DRAW_STEEL.CombatantGroup.Error.MinionMustSquad", { localize: true });
          return;
        }
        if (combatant.group?.id === group.id) return;
        await combatant.update({ group: group.id });
      } else if (combatant.group) {
        await combatant.update({ group: null });
      }
    },

    /** Add the selected canvas tokens to an existing group (creating combatants as needed). */
    async _addSelectedToGroup(group) {
      if (!game.user.isGM || !group) return;
      const tokens = canvas?.tokens?.controlled?.map(t => t.document) ?? [];
      if (!tokens.length) {
        ui.notifications?.warn("DSLF.Tracker.Notifications.SelectTokensToAdd", { localize: true });
        return;
      }
      if ((group.type !== "squad") && tokens.some(t => t.actor?.isMinion)) {
        ui.notifications?.error("DRAW_STEEL.CombatantGroup.Error.MinionMustSquad", { localize: true });
        return;
      }
      await CONFIG.Token.documentClass.createCombatants(tokens, { combat: this.combat });
      const updates = tokens
        .map(t => this.combat.combatants.find(c => c.tokenId === t.id))
        .filter(c => c && (c.group?.id !== group.id))
        .map(c => ({ _id: c.id, group: group.id }));
      if (updates.length) await this.combat.updateEmbeddedDocuments("Combatant", updates);
    },

    /** Prompt for a new group name. */
    async _renameGroup(group) {
      if (!game.user.isGM || !group) return;
      const current = foundry.utils.escapeHTML(group.name ?? "");
      const content = `<div class="form-group"><input type="text" name="name" value="${current}" autofocus></div>`;
      const name = await DialogClass().prompt({
        window: { title: L("Groups.Rename") },
        content,
        ok: { callback: (event, button) => button.form.elements.name.value.trim() },
      });
      if (name) await group.update({ name });
    },

    /** Remove every member from a group. */
    async _ungroupAll(group) {
      if (!game.user.isGM || !group) return;
      const updates = Array.from(group.members).map(m => ({ _id: m.id, group: null }));
      if (updates.length) await this.combat.updateEmbeddedDocuments("Combatant", updates);
    },

    /** Delete a group, ungrouping its members first so no combatant keeps a dangling group id. */
    async _deleteGroup(group) {
      if (!game.user.isGM || !group) return;
      await this._ungroupAll(group);
      await group.delete();
    },

    /**
     * Build one ContextMenu (bound to the inner dock element, which is recreated on every render)
     * covering group pills and every kind of combatant portrait.
     */
    _createContextMenu() {
      if (!game.user.isGM) return;
      const ContextMenu = foundry.applications.ux.ContextMenu;
      const inner = this.element?.querySelector(".ds-combat-dock");
      if (!ContextMenu || !inner) return;

      const selector = ".ds-group-wrapper, .ds-mini-portrait, .ds-retainer-portrait, .ds-portrait";
      const items = [...this._getCombatantContextItems(), ...this._getGroupContextItems()];
      this._contextMenu = new ContextMenu(inner, selector, items, { jQuery: false, fixed: true });
    },

    /** Context menu entries for a combatant portrait. */
    _getCombatantContextItems() {
      const get = (target) => this.combat.combatants.get(target.dataset.combatantId);
      const isCombatant = (target) => !!target.dataset.combatantId && !!get(target);

      const items = [
        {
          label: L("Context.OpenSheet"),
          icon: "fa-solid fa-user",
          visible: (target) => isCombatant(target) && !!get(target).actor,
          onClick: (event, target) => get(target).actor?.sheet?.render(true),
        },
        {
          label: L("UndoActivation"),
          icon: "fa-solid fa-rotate-left",
          visible: (target) => isCombatant(target) && (this._getUndoableActivation()?.combatantId === target.dataset.combatantId),
          onClick: () => this._undoLastActivation(),
        },
        {
          label: L("Context.ToggleDefeated"),
          icon: "fa-solid fa-skull",
          visible: (target) => isCombatant(target),
          onClick: async (event, target) => {
            const combatant = get(target);
            const defeated = !combatant.isDefeated;
            await combatant.update({ defeated });
            const statusId = CONFIG.specialStatusEffects?.DEFEATED ?? "dead";
            await combatant.actor?.toggleStatusEffect(statusId, { overlay: true, active: defeated });
          },
        },
        {
          label: "DRAW_STEEL.Combatant.ToggleCaptain",
          icon: "fa-solid fa-helmet-battle",
          visible: (target) => {
            if (!isCombatant(target)) return false;
            const combatant = get(target);
            return !combatant.actor?.isMinion && (combatant.group?.type === "squad");
          },
          onClick: (event, target) => {
            const combatant = get(target);
            const newCaptain = combatant.system?.isCaptain ? null : combatant.id;
            return combatant.group?.update({ "system.captainId": newCaptain });
          },
        },
        {
          label: L("Groups.RemoveFromGroup"),
          icon: "fa-solid fa-user-minus",
          visible: (target) => isCombatant(target) && !!get(target).group,
          onClick: (event, target) => this._moveToGroup(get(target), null),
        },
      ];

      // One "Move to <group>" entry per group in the encounter
      for (const group of this.combat.groups) {
        items.push({
          label: F("Groups.MoveTo", { group: group.name }),
          icon: "fa-solid fa-users",
          visible: (target) => {
            if (!isCombatant(target)) return false;
            const combatant = get(target);
            if (combatant.group?.id === group.id) return false;
            if (combatant.actor?.isMinion && (group.type !== "squad")) return false;
            return true;
          },
          onClick: (event, target) => this._moveToGroup(get(target), group),
        });
      }

      items.push({
        label: L("Context.RemoveFromCombat"),
        icon: "fa-solid fa-trash",
        visible: (target) => isCombatant(target),
        onClick: (event, target) => get(target).delete(),
      });

      return items;
    },

    /**
     * Context menu entries for a group pill: our entries first, then the system's own group entries
     * reused from the sidebar tracker when available.
     */
    _getGroupContextItems() {
      const get = (target) => this.combat.groups.get(target.dataset.groupId);
      const isGroup = (target) => !!target.dataset.groupId && !!get(target);

      const items = [
        {
          label: L("Groups.Rename"),
          icon: "fa-solid fa-pen",
          visible: isGroup,
          onClick: (event, target) => this._renameGroup(get(target)),
        },
        {
          label: L("Groups.AddSelected"),
          icon: "fa-solid fa-user-plus",
          visible: isGroup,
          onClick: (event, target) => this._addSelectedToGroup(get(target)),
        },
        {
          label: L("Groups.UngroupAll"),
          icon: "fa-solid fa-users-slash",
          visible: (target) => isGroup(target) && (get(target).members.size > 0),
          onClick: (event, target) => this._ungroupAll(get(target)),
        },
      ];

      // Reuse the system's group entries; they only read `this.viewed` and `target.dataset.groupId`.
      let systemItems = null;
      try {
        if (typeof ui.combat?._getGroupContextOptions === "function") {
          systemItems = ui.combat._getGroupContextOptions.call({ viewed: this.combat });
        }
      } catch (err) {
        warn("could not reuse system group context options", err);
      }

      if (Array.isArray(systemItems)) {
        const deleteLabel = game.i18n.format("DOCUMENT.Delete", { type: game.i18n.localize("DOCUMENT.CombatantGroup") });
        for (const item of systemItems) {
          const visible = item.visible;
          const entry = {
            ...item,
            visible: (target) => isGroup(target) && ((typeof visible === "function") ? visible(target) : (visible !== false)),
          };
          // Ungroup members before deleting so no combatant keeps a dangling group id
          if (item.label === deleteLabel) entry.onClick = (event, target) => this._deleteGroup(get(target));
          items.push(entry);
        }
      } else {
        items.push(
          {
            label: game.i18n.format("DOCUMENT.Update", { type: game.i18n.localize("DOCUMENT.CombatantGroup") }),
            icon: "fa-solid fa-edit",
            visible: isGroup,
            onClick: (event, target) => get(target).sheet?.render({ force: true }),
          },
          {
            label: game.i18n.format("DOCUMENT.Delete", { type: game.i18n.localize("DOCUMENT.CombatantGroup") }),
            icon: "fa-solid fa-trash",
            visible: isGroup,
            onClick: (event, target) => this._deleteGroup(get(target)),
          },
        );
      }

      return items;
    },

    /**
     * Start dragging a combatant portrait. Uses the same payload as the system's sidebar tracker so
     * drags work in both directions between the dock and the sidebar.
     */
    _onDragStart(event, el) {
      const combatant = this.combat.combatants.get(el.dataset.combatantId);
      if (!combatant) return event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.setData("text/plain", JSON.stringify(combatant.toDragData()));
      event.dataTransfer.effectAllowed = "move";
      this.element?.classList.add("ds-dragging");
      this._hideTooltip();
    },

    /** Clean up drag state. */
    _onDragEnd() {
      this.element?.classList.remove("ds-dragging");
      for (const el of this.element?.querySelectorAll(".ds-drop-target") ?? []) el.classList.remove("ds-drop-target");
    },

    /** Drop a combatant onto a group pill (join) or onto a side area (leave its group). */
    async _onDrop(event, el) {
      event.preventDefault();
      event.stopPropagation();
      this._onDragEnd();
      if (!game.user.isGM) return;

      let data;
      try {
        data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      } catch (_err) {
        return;
      }
      if (data?.type !== "Combatant") return;
      const combatant = await CONFIG.Combatant.documentClass.fromDropData(data);
      if (!combatant || (combatant.parent !== this.combat)) return;

      if (el.classList.contains("ds-group-container")) {
        const group = this.combat.groups.get(el.dataset.id);
        if (!group) return;
        await this._moveToGroup(combatant, group);
      } else {
        await this._moveToGroup(combatant, null);
      }
    },

    /* ---------- actions ---------- */

    async _onAction(event, action, target) {
      switch (action) {
        case "createGroup":
          event.preventDefault();
          event.stopPropagation();
          this._hideActionsMenu();
          return this._createGroup();
        case "addSelectedTokens":
          event.preventDefault();
          event.stopPropagation();
          this._hideActionsMenu();
          return this._addSelectedTokens();
        case "undoActivation":
          event.preventDefault();
          event.stopPropagation();
          this._hideActionsMenu();
          return this._undoLastActivation();
        case "startCombat":
          event.preventDefault();
          event.stopPropagation();
          return this._startCombat();
        case "rollFirst":
          event.preventDefault();
          event.stopPropagation();
          return this._rollFirst();
        default:
          return orig._onAction.call(this, event, action, target);
      }
    },
  };
}

/* -------------------------------------------------- */
/*  Installation                                      */
/* -------------------------------------------------- */

const REQUIRED_METHODS = [
  "render", "close", "scheduleRefresh", "_prepareContext", "_getEntries", "_activateListeners",
  "_onResizeStart", "_onPortraitClick", "_onMiniPortraitClick", "_onGroupPillClick",
  "_onPortraitContext", "_onPortraitHover", "_onMiniPortraitHover", "_showTooltip", "_hideTooltip",
  "_isInitialPhase", "_hideActionsMenu", "_handleDocumentPointerDown", "_onAction",
];

async function install() {
  const tracker = game.modules.get(TRACKER_ID);
  if (!tracker?.active) {
    warn("Draw Steel - Combat Tracker is not active; the dock patch is not installed.");
    return;
  }

  let mod;
  try {
    mod = await import(foundry.utils.getRoute(`modules/${TRACKER_ID}/scripts/combat-dock.mjs`));
  } catch (err) {
    console.error(`${MODULE_ID} | Fix 6: could not import the tracker's combat-dock.mjs; the dock runs stock.`, err);
    return;
  }

  const CombatDock = mod?.CombatDock;
  const proto = CombatDock?.prototype;
  if (!proto) {
    console.error(`${MODULE_ID} | Fix 6: the tracker's combat-dock.mjs exports no CombatDock class; the dock runs stock.`);
    return;
  }

  // Fix 7 (not version-gated, pure fallback): dock portraits use the token ring art when the plain
  // token image is the default silhouette.
  if ((proto._getTokenImg instanceof Function) && !proto._dslfRingArtPatch) {
    const origGetTokenImg = proto._getTokenImg;
    proto._getTokenImg = function (combatant) {
      const img = origGetTokenImg.call(this, combatant);
      if (!isDefaultImage(img)) return img;
      return ringArt(combatant?.token) ?? img;
    };
    Object.defineProperty(proto, "_dslfRingArtPatch", { value: true, configurable: true });
    console.log(`${MODULE_ID} | Fix 7: dock portraits fall back to the token ring art.`);
  }

  const version = tracker.version;
  if (!VERIFIED_VERSIONS.includes(version)) {
    disabledReason = F("Disabled", { version, verified: VERIFIED_VERSIONS.join(", ") });
    warn(`Combat Tracker ${version} is not a verified version (${VERIFIED_VERSIONS.join(", ")}); `
      + "the dock runs stock. Diff the new release against the 1.0.9 sources, then add the version to VERIFIED_VERSIONS.");
    return;
  }

  const missing = REQUIRED_METHODS.filter(name => !(proto[name] instanceof Function));
  if (missing.length) {
    console.error(`${MODULE_ID} | Fix 6: CombatDock is missing ${missing.join(", ")}; the dock runs stock.`);
    return;
  }
  if (proto._dslfTrackerPatch) return;

  const orig = {};
  for (const name of REQUIRED_METHODS) orig[name] = proto[name];
  Object.assign(proto, buildOverrides(orig));
  Object.defineProperty(proto, "_dslfTrackerPatch", { value: true, configurable: true });

  CombatDockClass = CombatDock;
  installed = true;
  registerLifecycleHooks();
  log(`Combat Tracker dock patched (activation mode, undo, groups, setup phase, sizing) for tracker ${version}.`);
}

export const trackerDockApi = {
  sync: () => syncDock(),
  undo: () => ui.dsCombatDock?._undoLastActivation?.(),
  get installed() {
    return installed;
  },
};

export function registerTrackerDock() {
  Hooks.once("init", () => {
    registerSettings();
  });

  Hooks.once("setup", () => {
    installPromise = install().catch(err => {
      console.error(`${MODULE_ID} | Fix 6: installation failed`, err);
    });
  });

  Hooks.once("ready", async () => {
    await installPromise;
    if (disabledReason && game.user.isGM) ui.notifications?.warn(disabledReason);
    if (!installed) return;
    registerSocket();
    await migrateOldSettings();
    syncDock();
  });
}
