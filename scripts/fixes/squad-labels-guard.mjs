/**
 * Fix 5 — squad labels are renamed, applied and repaired after combat start.
 *
 * Symptom: Combat Tools (DSCT 1.2.2) shows its "Auto-Rename Squads?" dialog when combat begins,
 * but the numbered Minion / Captain / Group status icons never appear on the squad tokens.
 *
 * Cause (DSCT `src/squad-labels.mjs`): `_applySquadLabels` only labels combatant groups whose name
 * matches `/^Group (\d+)([a-z]?)$/i` with N <= 10, that contain no hero, and whose member tokens
 * are on the *currently viewed* canvas. Any other group is skipped silently while the banner still
 * says "labels applied". A failed ActiveEffect creation is swallowed into a `console.warn`
 * (`DSCT | SL | failed to create label`). The label payload also carries `system.filters`, a key
 * that only exists on the `abilityModifier` effect type, not on `base` (draw-steel.mjs:1019-1041 /
 * 1186), which is the prime suspect for such a swallowed validation error.
 *
 * Mechanism: GM-only guard. After `combatStart` (once DSCT's dialog is closed), on `canvasReady`
 * and on group / combatant changes during a started combat it
 *   1. renames eligible non-hero groups that do not match the pattern to the lowest free "Group N",
 *   2. calls DSCT's own `api.squadLabels()`,
 *   3. verifies every live member token has a label and, where DSCT left none, creates an
 *      equivalent label itself (same flag, name, image and tint, but without `system.filters` and
 *      with `showIcon: ALWAYS`), logging the error text if even that fails,
 *   4. prints one summary line `stef-ds-qol | Fix 5 (<reason>): ...`.
 * Labels created here carry DSCT's flag, so DSCT's own passes treat them as its own and its
 * combat-end / canvas cleanup removes them normally.
 *
 * Console helpers: `game.modules.get("stef-ds-qol").api.squadLabels.ensure()` and
 * `.diagnose()` (dumps the squad/label state as JSON for bug reports).
 */

import { MODULE_ID, DSCT_ID, dsctActive } from "../shared.mjs";

const LABEL_RE = /^Group (\d+)([a-z]?)$/i;
const ICON_PATH = `modules/${DSCT_ID}/assets/Icons`;
const DIALOG_TITLE_KEY = "DSCT.dialog.autoRenameSquads.title";
const FLAG_KEY = "effectType";
const FLAG_VALUE = "squad-label";
const MAX_GROUPS = 10;

/** Copy of DSCT's GROUP_TINTS (src/squad-labels.mjs:8-19). */
const GROUP_TINTS = {
  1: "#ff4444", 2: "#4488ff", 3: "#44dd44", 4: "#ffcc00", 5: "#ff44ff",
  6: "#44ffff", 7: "#ff8800", 8: "#aa44ff", 9: "#00ff88", 10: "#ff88aa",
};

const log = (...args) => console.log(`${MODULE_ID} | Fix 5:`, ...args);
const warn = (...args) => console.warn(`${MODULE_ID} | Fix 5:`, ...args);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/* -------------------------------------------- */
/*  Helpers                                     */
/* -------------------------------------------- */

const dsctApi = () => game.modules.get(DSCT_ID)?.api;

function setting(key) {
  try {
    return game.settings.get(DSCT_ID, key);
  } catch (_err) {
    return undefined;
  }
}

/** All three DSCT switches the label feature depends on. */
const settingsOn = () => !!(setting("squadToolsEnabled") && setting("autoSquadLabelsEnabled") && setting("squadLabelApplyEffects"));

const isLabel = (effect) => effect?.flags?.[DSCT_ID]?.[FLAG_KEY] === FLAG_VALUE;
const labelsOf = (actor) => actor?.effects?.filter(isLabel) ?? [];

/** Parse "Group 3" / "Group 3b" into { num, letter }, or null. */
function parseName(name) {
  const match = String(name ?? "").match(LABEL_RE);
  if (!match) return null;
  const num = parseInt(match[1]);
  if (!(num >= 1 && num <= MAX_GROUPS)) return null;
  return { num, letter: (match[2] || "").toLowerCase() };
}

/** Can the guard act right now on this client? */
function canRun(reason) {
  if (!dsctActive()) return false;
  if (!game.users.activeGM?.isSelf) return false;
  const combat = game.combat;
  if (!combat) return false;
  if (!settingsOn()) return false;
  if (!canvas?.ready) return false;
  if (combat.scene && (combat.scene.id !== canvas.scene?.id)) {
    log(`(${reason}) the combat belongs to another scene than the one viewed; skipping.`);
    return false;
  }
  return true;
}

/**
 * Groups DSCT could label: non-empty, no hero, at least one live member with a token on the canvas.
 * @returns {{ group: CombatantGroup, members: Combatant[], live: Combatant[] }[]}
 */
function eligibleGroups(combat) {
  const out = [];
  for (const group of combat.groups?.contents ?? []) {
    const members = [...group.members];
    if (!members.length) continue;
    if (members.some(c => c.actor?.type === "hero")) continue;
    const live = members.filter(c => !c.isDefeated && canvas.tokens.get(c.tokenId)?.actor);
    if (!live.length) continue;
    out.push({ group, members, live });
  }
  return out;
}

/** The label DSCT would create for this member (mirrors _applySquadLabels, squad-labels.mjs:66-88). */
function expectedLabel(entry, combatant) {
  const parsed = parseName(entry.group.name);
  if (!parsed) return null;
  const actor = canvas.tokens.get(combatant.tokenId)?.actor;
  if (!actor) return null;
  const suffix = parsed.letter === "b" ? "B" : "";
  const captainId = entry.group.system?.captainId;
  const liveMinions = entry.members.filter(c => c.actor?.system?.isMinion && !c.isDefeated);
  const isCaptain = (combatant.id === captainId) && (liveMinions.length > 0);
  const prefix = isCaptain ? "Captain" : (actor.system?.isMinion ? "Minion" : "Group");
  return {
    name: entry.group.name,
    img: `${ICON_PATH}/${prefix}${parsed.num}${suffix}.png`,
    tint: GROUP_TINTS[parsed.num] ?? "#ffffff",
  };
}

/** Our fallback payload: DSCT's label minus the out-of-schema `system.filters`, icon forced on. */
function labelPayload(want) {
  return {
    name: want.name,
    img: want.img,
    type: "base",
    tint: want.tint,
    changes: [],
    disabled: false,
    transfer: false,
    statuses: [],
    description: "",
    sort: 0,
    showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS,
    duration: { expiry: "combatEnd" },
    flags: { [DSCT_ID]: { [FLAG_KEY]: FLAG_VALUE } },
  };
}

/* -------------------------------------------- */
/*  Core routine                                */
/* -------------------------------------------- */

/** Set while this module performs document updates, so its own hooks ignore them. */
let ownUpdate = false;

async function withOwnUpdate(fn) {
  ownUpdate = true;
  try {
    return await fn();
  } finally {
    ownUpdate = false;
  }
}

async function runEnsure(reason) {
  if (!canRun(reason)) return;
  const combat = game.combat;
  const api = dsctApi();
  if (!(api?.squadLabels instanceof Function)) {
    warn(`(${reason}) Combat Tools has no api.squadLabels; nothing done.`);
    return;
  }

  let eligible = eligibleGroups(combat);
  if (!eligible.length) return;

  // 1. Rename groups DSCT cannot label.
  const taken = new Set((combat.groups?.contents ?? []).map(g => parseName(g.name)?.num).filter(Boolean));
  let renamed = 0;
  for (const entry of eligible) {
    if (parseName(entry.group.name)) continue;
    let num = 1;
    while (taken.has(num) && (num <= MAX_GROUPS)) num++;
    if (num > MAX_GROUPS) {
      warn(`(${reason}) no free "Group N" number (1-${MAX_GROUPS}) for "${entry.group.name}"; it stays unlabeled.`);
      continue;
    }
    taken.add(num);
    const oldName = entry.group.name;
    try {
      await withOwnUpdate(() => entry.group.update({ name: `Group ${num}` }));
      log(`(${reason}) renamed "${oldName}" to "Group ${num}" so Combat Tools can label it.`);
      renamed++;
    } catch (err) {
      warn(`(${reason}) could not rename "${oldName}":`, err);
    }
  }

  // 2. Let DSCT do its own pass.
  try {
    await api.squadLabels();
  } catch (err) {
    warn(`(${reason}) Combat Tools api.squadLabels() threw:`, err);
  }

  // 3. Verify and repair.
  eligible = eligibleGroups(combat);
  let dsctLabeled = 0, created = 0, failed = 0, iconFixed = 0;
  for (const entry of eligible) {
    for (const combatant of entry.live) {
      const token = canvas.tokens.get(combatant.tokenId);
      const actor = token?.actor;
      if (!actor) continue;
      const existing = labelsOf(actor);
      if (existing.length) {
        dsctLabeled++;
        for (const effect of existing) {
          if (!effect.isTemporary && (effect.showIcon !== CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS)) {
            try {
              await effect.update({ showIcon: CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS });
              log(`(${reason}) label on ${token.name} was not drawable (not temporary); icon forced on.`);
              iconFixed++;
            } catch (err) {
              warn(`(${reason}) could not force the icon on ${token.name}:`, err);
            }
          }
        }
        continue;
      }
      const want = expectedLabel(entry, combatant);
      if (!want) continue;
      try {
        await actor.createEmbeddedDocuments("ActiveEffect", [labelPayload(want)]);
        log(`(${reason}) created label "${want.name}" for ${token.name} (Combat Tools left it unlabeled).`);
        created++;
      } catch (err) {
        warn(`(${reason}) label creation failed for ${token.name}:`, err);
        failed++;
      }
    }
  }

  log(`(${reason}) groups=${eligible.length} renamed=${renamed} dsctLabeled=${dsctLabeled} fallbackCreated=${created} iconFixed=${iconFixed} failed=${failed}`);
}

let running = null;
let runAgain = false;

/** Serialised entry point: concurrent calls fold into one re-run. */
export function ensure({ reason = "manual" } = {}) {
  if (running) {
    runAgain = true;
    return running;
  }
  running = (async () => {
    try {
      do {
        runAgain = false;
        await runEnsure(reason);
      } while (runAgain);
    } finally {
      running = null;
    }
  })();
  return running;
}

/* -------------------------------------------- */
/*  Diagnostics                                 */
/* -------------------------------------------- */

function labelSnapshot() {
  return canvas.tokens.placeables.flatMap(token => labelsOf(token.actor).map(e => ({
    token: token.name,
    name: e.name,
    img: e.img,
    expired: e.duration?.expired,
    disabled: e.disabled,
    active: e.active,
    temporary: e.isTemporary,
    showIcon: e.showIcon,
    applied: token.actor.appliedEffects.includes(e),
    drawnIcons: token.effects?.children?.length ?? 0,
  })));
}

/** Dump the squad / label state, run DSCT's labeler once and capture what it logs. */
export async function diagnose() {
  const combat = game.combat;
  const out = {
    module: `${MODULE_ID} Fix 5`,
    dsctVersion: game.modules.get(DSCT_ID)?.version,
    combat: !!combat,
    started: combat?.started,
    sceneMatch: !combat?.scene || (combat.scene.id === canvas.scene?.id),
    isActiveGM: !!game.users.activeGM?.isSelf,
    settings: {
      squadToolsEnabled: setting("squadToolsEnabled"),
      autoSquadLabelsEnabled: setting("autoSquadLabelsEnabled"),
      squadLabelApplyEffects: setting("squadLabelApplyEffects"),
      squadLabelRenamePreference: setting("squadLabelRenamePreference"),
    },
    groups: (combat?.groups?.contents ?? []).map(g => {
      const members = [...g.members];
      return {
        name: g.name,
        type: g.type,
        matchesPattern: !!parseName(g.name),
        members: members.length,
        hero: members.some(c => c.actor?.type === "hero"),
        onCanvas: members.filter(c => canvas.tokens.get(c.tokenId)).length,
        defeated: members.filter(c => c.isDefeated).length,
        hiddenTokens: members.filter(c => c.token?.hidden).length,
        captainId: g.system?.captainId ?? null,
      };
    }),
    labelsBefore: labelSnapshot(),
    messages: [],
  };

  const origWarn = console.warn, origError = console.error;
  console.warn = (...a) => { out.messages.push("W " + a.map(String).join(" ")); origWarn(...a); };
  console.error = (...a) => { out.messages.push("E " + a.map(String).join(" ")); origError(...a); };
  try {
    if (dsctApi()?.squadLabels instanceof Function) await dsctApi().squadLabels();
    else out.messages.push("THROW no api.squadLabels");
  } catch (err) {
    out.messages.push("THROW " + err);
  } finally {
    console.warn = origWarn;
    console.error = origError;
  }
  out.labelsAfter = labelSnapshot();
  console.log(JSON.stringify(out, null, 1));
  return out;
}

export const squadLabelsApi = { ensure, diagnose };

/* -------------------------------------------- */
/*  Hooks                                       */
/* -------------------------------------------- */

/** Is DSCT's "Auto-Rename Squads?" dialog currently open? */
function renameDialogOpen() {
  const DialogV2 = foundry.applications?.api?.DialogV2;
  if (!DialogV2) return false;
  const title = game.i18n.localize(DIALOG_TITLE_KEY);
  for (const app of foundry.applications.instances.values()) {
    if ((app instanceof DialogV2) && (app.title === title)) return true;
  }
  return false;
}

async function onCombatStart() {
  if (!dsctActive() || !game.users.activeGM?.isSelf || !settingsOn()) return;
  await sleep(2000);
  const deadline = Date.now() + (10 * 60 * 1000);
  while (renameDialogOpen() && (Date.now() < deadline)) await sleep(1000);
  await sleep(1500);
  await ensure({ reason: "combatStart" });
}

let timer = null;

/** Debounced re-check during a started combat. */
function schedule(reason, delay) {
  if (ownUpdate) return;
  if (!game.combat?.started) return;
  if (!game.users.activeGM?.isSelf) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    ensure({ reason });
  }, delay);
}

export function registerSquadLabelsGuard() {
  Hooks.once("ready", () => {
    if (!dsctActive()) {
      warn("Draw Steel: Combat Tools is not active; the squad-label guard is not armed.");
      return;
    }
    if (!(dsctApi()?.squadLabels instanceof Function)) {
      warn("Combat Tools exposes no api.squadLabels (API changed?); the squad-label guard is not armed.");
      return;
    }

    Hooks.on("combatStart", onCombatStart);
    Hooks.on("canvasReady", () => schedule("canvasReady", 2000));
    Hooks.on("createCombatantGroup", () => schedule("createCombatantGroup", 1500));
    Hooks.on("updateCombatantGroup", (_group, changes) => {
      if (changes?.name !== undefined) schedule("updateCombatantGroup", 1500);
    });
    Hooks.on("createCombatant", () => schedule("createCombatant", 1500));
    Hooks.on("updateCombatant", (_combatant, changes) => {
      if (changes?.group !== undefined) schedule("updateCombatant", 1500);
    });

    const role = game.user.isGM ? "GM client" : "player client, acts only when this user is the active GM";
    log(`squad-label guard armed (${role}).`);
  });
}
