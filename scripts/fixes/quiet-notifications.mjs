/**
 * Fix 4 — info and success banners are muted while a combat encounter exists.
 *
 * Symptom: during combat the screen fills with low-value banners — Target Damage's
 * "X dealt N damage to Y" (`src/chat-targeting.mjs` notifyDamageResult, fired on the clicking
 * client), Combat Tools' squad notices ("Squad labels applied", "Applied to N targets"), the death
 * tracker, Quick Strike and the system's own damage notifications. Each one is an
 * `ui.notifications.info(...)` / `.success(...)` call and they hide the chat log for five seconds.
 *
 * By design: hide EVERY `info` and `success` banner as long as a combat encounter exists in the
 * tracker (started or not). Warnings and errors always show.
 *
 * Mechanism: wrap `foundry.applications.ui.Notifications.prototype.notify(message, type, options)`
 * (core client/applications/ui/notifications.mjs:108), the single entry point for `info()`,
 * `success()`, `warn()` and `error()`. When the type is muted, `options.progress` and
 * `options.permanent` are not set and `game.combat` is non-null, the banner is not queued: the text
 * goes to `console.debug` instead and a frozen stub notification is returned (callers ignore it).
 * Progress bars and permanent notices are left alone so uploads and imports keep their feedback.
 * `game.combat` is `null` until documents are ready (core game.mjs:1691), so the server messages
 * replayed by the Notifications constructor are never affected.
 */

import { MODULE_ID } from "../shared.mjs";

/** Notification types that are hidden while a combat encounter exists. */
const QUIET_TYPES = new Set(["info", "success"]);

/** Does a combat encounter exist right now? Never throws. */
function combatExists() {
  try {
    return !!game.combat;
  } catch (_err) {
    return false;
  }
}

/** Resolve the text the banner would have shown, following core's localize/format rules. */
function resolveText(message, { localize = false, format } = {}) {
  let text = String(message);
  try {
    if (format) text = game.i18n.format(text, format);
    else if (localize) text = game.i18n.localize(text);
  } catch (_err) {
    // keep the raw text
  }
  return text;
}

/**
 * Wrapper for Notifications#notify.
 * @this {Notifications}
 */
function wrappedNotify(wrapped, message, type = "info", options = {}) {
  if (QUIET_TYPES.has(type) && !options?.progress && !options?.permanent && combatExists()) {
    const text = resolveText(message, options);
    if (options?.console !== false) console.debug(`${MODULE_ID} | Fix 4 muted ${type}: ${text}`);
    return Object.freeze({
      id: 0,
      type,
      message: text,
      timestamp: Date.now(),
      active: false,
      progress: false,
      permanent: false,
      console: false,
      pct: 0,
      remove() {},
      update() {},
    });
  }
  return wrapped(message, type, options);
}

export function registerQuietNotifications() {
  Hooks.once("init", () => {
    const Notifications = foundry.applications?.ui?.Notifications;
    if (!(Notifications?.prototype?.notify instanceof Function)) {
      console.error(`${MODULE_ID} | Fix 4: foundry.applications.ui.Notifications#notify not found. `
        + "The core API has changed; banners are NOT muted.");
      return;
    }

    if (game.modules.get("lib-wrapper")?.active && (typeof libWrapper !== "undefined")) {
      libWrapper.register(MODULE_ID, "foundry.applications.ui.Notifications.prototype.notify", wrappedNotify, "MIXED");
      console.log(`${MODULE_ID} | Fix 4: info/success banners muted while a combat encounter exists (libWrapper).`);
      return;
    }

    const originalNotify = Notifications.prototype.notify;
    Notifications.prototype.notify = function (...args) {
      return wrappedNotify.call(this, originalNotify.bind(this), ...args);
    };
    console.log(`${MODULE_ID} | Fix 4: info/success banners muted while a combat encounter exists (direct prototype patch).`);
  });
}
