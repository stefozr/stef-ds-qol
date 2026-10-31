/**
 * Fix 8 — GM-hidden tokens stay hidden from players (Combat Tools overlays).
 *
 * Symptom: when the Director hides a token with Foundry's token "hidden" toggle, players still see
 * the token's numbered squad status icons, its health text, the turn glow / marker ring and the
 * floating squad box (group name, health bar, "x / y" numbers), which gives the hidden tokens'
 * positions away.
 *
 * Cause: Combat Tools (DSCT 1.2.2, `src/conditions/combat-reveal.mjs`) registers
 * `resolveTokenVisibility(token, real)` in the shared `ctlib.services` registry
 * (`draw-steel-ctlib/src/services.mjs`). Death Tracker's `Token#isVisible` wrapper
 * (`src/defeated-token-visibility.mjs`) calls `services.get("resolveTokenVisibility")(this, visible)`
 * on every visibility check. With DSCT's "Everyone Knows Where Everyone Is" setting on, the resolver
 * returns `real || forced` and `forced` is true for every living combatant, so a token that core
 * declared invisible because `document.hidden && !isGM` is rendered anyway (as a greyscale ghost)
 * together with all of its children. Two overlays live outside the token container and ignore the
 * flag on their own: the squad HUD boxes in `canvas.controls` (`src/squad-hud.mjs`, placed at the
 * centroid of the living minion tokens) and the squad turn-marker wrapper in `canvas.tokens`
 * (`src/squad-turns.mjs`, `token._dsctMarkerWrapper`).
 *
 * Mechanism (core semantics: hidden tokens are visible to GMs only):
 *   A. At `ready`, re-provide `resolveTokenVisibility` with a wrapper that returns false for a hidden
 *      token on a non-GM client (and clears `dsctForcedVisible`), delegating everything else to DSCT.
 *      `services.get()` is a live Map lookup, so the Death Tracker wrapper picks it up immediately.
 *   B. Wrap `ControlsLayer#addChild`: a squad HUD container is recognised by its crown sprite
 *      (`icons/skills/social/intimidation-impressing.webp`) plus a text child (the group name); on
 *      player clients it is hidden while every living minion token of that squad is GM-hidden, and
 *      re-evaluated when a token's hidden flag changes, on canvasReady and after combat changes.
 *   C. On `refreshToken`, the squad turn-marker wrapper follows `token.visible`.
 * Known limit: a squad with only some tokens hidden keeps its box at the centroid of all living
 * tokens (DSCT's positioning is module-private); only fully hidden squads lose the box.
 */

import { MODULE_ID, dsctActive } from "../shared.mjs";

const CTLIB_ID = "draw-steel-ctlib";
const RESOLVER = "resolveTokenVisibility";
const CROWN_ICON = "icons/skills/social/intimidation-impressing.webp";

const log = (...args) => console.log(`${MODULE_ID} | Fix 8:`, ...args);
const warn = (...args) => console.warn(`${MODULE_ID} | Fix 8:`, ...args);

/** Is this token document hidden from the current user by Foundry's rules? */
const hiddenForMe = (tokenDoc) => !!tokenDoc?.hidden && !game.user?.isGM;
const tokenOf = (combatant) => canvas.tokens?.get(combatant?.tokenId) ?? null;

/* -------------------------------------------------- */
/*  A. Visibility resolver                            */
/* -------------------------------------------------- */

let resolverWrapped = false;

function servicesRegistry() {
  return globalThis.ctlib?.services ?? game.modules.get(CTLIB_ID)?.api?.services ?? null;
}

function wrapResolver() {
  const services = servicesRegistry();
  if (!(services?.get instanceof Function) || !(services?.provide instanceof Function)) {
    log("ctlib services registry not found; core visibility rules apply.");
    return;
  }
  const original = services.get(RESOLVER);
  if (!(original instanceof Function)) {
    log("no Combat Tools visibility resolver registered; core visibility rules apply.");
    return;
  }
  if (original._dslfHiddenGuard) {
    resolverWrapped = true;
    return;
  }

  const wrapper = (token, real) => {
    if (hiddenForMe(token?.document)) {
      if (token) token.dsctForcedVisible = false;
      return false;
    }
    return original(token, real);
  };
  wrapper._dslfHiddenGuard = true;
  services.provide(RESOLVER, wrapper);
  resolverWrapped = true;
  log("GM-hidden tokens are never forced visible for players (Combat Tools reveal positions).");
}

function refreshVisibility() {
  for (const token of canvas.tokens?.placeables ?? []) token.renderFlags?.set?.({ refreshVisibility: true });
}

/* -------------------------------------------------- */
/*  B. Squad HUD boxes                                */
/* -------------------------------------------------- */

const textureIds = (sprite) => sprite?.texture?.textureCacheIds ?? [];

/** Recognise (and tag) a Combat Tools squad HUD container. */
function isSquadHud(obj) {
  if (!(obj instanceof PIXI.Container) || !obj.children?.length) return false;
  if (obj._dslfSquadName !== undefined) return true;
  const crown = obj.children.find(ch => (ch instanceof PIXI.Sprite) && textureIds(ch).includes(CROWN_ICON));
  if (!crown) return false;
  const text = obj.children.find(ch => ch instanceof PIXI.Text);
  if (!text) return false;
  obj._dslfSquadName = String(text.text ?? "");
  return true;
}

/** Hide the box while every living minion token of the named squad is GM-hidden. */
function applyHudVisibility(container) {
  if (game.user?.isGM) return;
  const name = container._dslfSquadName;
  if (!name || !game.combat) return;
  const squads = (game.combat.groups?.contents ?? []).filter(g => (g.type === "squad") && (g.name === name));
  if (!squads.length) return;
  const anyVisible = squads.some(group => [...group.members].some(member => {
    if (member.isDefeated || !member.actor?.system?.isMinion) return false;
    const token = tokenOf(member);
    return !!token && !hiddenForMe(token.document);
  }));
  container.visible = anyVisible;
  container.renderable = anyVisible;
}

function hudPass() {
  if (game.user?.isGM) return;
  for (const child of canvas.controls?.children ?? []) {
    if (isSquadHud(child)) applyHudVisibility(child);
  }
}

function onControlsChildrenAdded(children) {
  if (game.user?.isGM) return;
  for (const child of children) {
    if (isSquadHud(child)) applyHudVisibility(child);
  }
}

function patchControlsLayer() {
  const ControlsLayer = foundry.canvas?.layers?.ControlsLayer;
  if (!(ControlsLayer?.prototype?.addChild instanceof Function)) {
    console.error(`${MODULE_ID} | Fix 8: foundry.canvas.layers.ControlsLayer#addChild not found; squad HUD boxes are NOT hidden for hidden squads.`);
    return;
  }

  if (game.modules.get("lib-wrapper")?.active && (typeof libWrapper !== "undefined")) {
    try {
      libWrapper.register(MODULE_ID, "foundry.canvas.layers.ControlsLayer.prototype.addChild", function (wrapped, ...children) {
        const result = wrapped(...children);
        onControlsChildrenAdded(children);
        return result;
      }, "WRAPPER");
      log("squad HUD boxes follow token visibility (libWrapper).");
      return;
    } catch (err) {
      warn("libWrapper could not wrap ControlsLayer#addChild, patching directly.", err);
    }
  }

  const parentProto = Object.getPrototypeOf(ControlsLayer.prototype);
  const superAddChild = parentProto.addChild;
  ControlsLayer.prototype.addChild = function (...children) {
    const result = superAddChild.apply(this, children);
    onControlsChildrenAdded(children);
    return result;
  };
  log("squad HUD boxes follow token visibility (direct prototype patch).");
}

/* -------------------------------------------------- */
/*  C. Squad turn-marker wrapper                      */
/* -------------------------------------------------- */

function syncMarkerWrapper(token) {
  const wrapper = token?._dsctMarkerWrapper;
  if (!wrapper || wrapper.destroyed) return;
  if (wrapper.visible !== token.visible) wrapper.visible = token.visible;
}

function markerPass() {
  for (const token of canvas.tokens?.placeables ?? []) syncMarkerWrapper(token);
}

/* -------------------------------------------------- */
/*  Registration                                      */
/* -------------------------------------------------- */

function recheck() {
  if (resolverWrapped) refreshVisibility();
  hudPass();
  markerPass();
}

export const hiddenTokenApi = { recheck };

let hudTimer = null;
function scheduleHudPass(delay) {
  if (hudTimer) clearTimeout(hudTimer);
  hudTimer = setTimeout(() => {
    hudTimer = null;
    hudPass();
    markerPass();
  }, delay);
}

export function registerHiddenTokenPrivacy() {
  Hooks.once("init", () => {
    if (!dsctActive()) {
      warn("Draw Steel: Combat Tools is not active; nothing to patch (core already hides hidden tokens).");
      return;
    }
    patchControlsLayer();
  });

  Hooks.once("ready", () => {
    if (!dsctActive()) return;
    wrapResolver();
    if (resolverWrapped) refreshVisibility();

    Hooks.on("refreshToken", (token) => syncMarkerWrapper(token));
    Hooks.on("updateToken", (_doc, changes) => {
      if ("hidden" in changes) scheduleHudPass(50);
    });
    Hooks.on("canvasReady", () => scheduleHudPass(500));
    for (const hook of ["createCombatant", "updateCombatant", "deleteCombatant", "updateCombatantGroup", "createCombat", "deleteCombat"]) {
      Hooks.on(hook, () => scheduleHudPass(400));
    }
    scheduleHudPass(500);
    log("hidden-token privacy armed.");
  });
}
