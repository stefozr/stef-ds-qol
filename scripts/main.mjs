/**
 * Stef's Quality of Life Improvements for Draw Steel — loader.
 *
 * Fixes and conveniences for the Draw Steel system and the Combat Tools family, applied from outside so they
 * survive system and module updates. Each fix lives in its own file under scripts/fixes/ and documents its
 * symptom, cause and mechanism at the top.
 *
 *   Fix 1  public-turn-roll.mjs      system: turn-start heroic resource roll is always public
 *   Fix 2  dsct-ghost-texture.mjs    Combat Tools: greyscale ghost keeps dynamic-ring art
 *   Fix 3  teleport-abilities.mjs    Combat Tools: self-teleport abilities keep teleport automation
 *   Fix 4  quiet-notifications.mjs   core: info/success banners are muted while a combat exists
 *   Fix 5  squad-labels-guard.mjs    Combat Tools: squad labels are renamed/applied/repaired
 *   Fix 6  tracker-dock.mjs          Combat Tracker: activation mode + undo, groups, setup phase, sizing
 *   Fix 7  ring-art-images.mjs       core + Combat Tracker: combatant images fall back to the ring art
 *   Fix 8  hidden-token-privacy.mjs  Combat Tools: GM-hidden tokens and their overlays stay hidden from players
 *   Fix 9  collapse-ability-cards.mjs system: client option to collapse ability card descriptions in chat
 *   Fix 10 dstd-author-shim.mjs      Target Damage: message author is found on v14 (ChatMessage#user getter)
 *   Fix 11 pseudo-collection-rebind.mjs system: effects lists stay current after "Update from compendium"
 *   Fix 12 condition-palette.mjs     core: the condition palette stays readable; Shift-click sets selected actors
 *   Fix 13 compact-ability-cards.mjs system + Draw Steel Plus: compact ability cards in chat (registered before Fix 9)
 *   Fix 14 meta-currency-box.mjs     system: movable Hero Tokens / Malice box (replaces the players-list strip)
 *   Fix 15 montage-tracker.mjs       system: montage test tracker (limits, rounds, hero tests, Victories)
 *   Fix 16 negotiation-tracker.mjs   system: negotiation tracker (interest, patience, motivations, pitfalls; from an NPC)
 *   Fix 17 chat-speaker-colors.mjs   core + system: chat cards get the speaker's player color and token portrait
 *   Fix 18 dsct-multi-grab-guard.mjs Combat Tools: ending one grab keeps the grabber's other grabs tracked
 *
 * 1.11.0: the Director is warned once per client and Combat Tools version when that version is not one the Combat
 * Tools fixes were checked against (shared.mjs DSCT_VERIFIED).
 *
 * Version numbers above 1.0 in these comments (1.7.0 to 1.13.2) are those of the private predecessor, Draw Steel:
 * Local Fixes. The 1.0.0 release renamed it; legacy-migration.mjs imports its settings and the user flag of Fix 14
 * once.
 */

import { DSCT_ID, DSCT_VERIFIED, MODULE_ID, dsctVersionVerified } from "./shared.mjs";
import { registerLegacyMigration } from "./legacy-migration.mjs";
import { registerConditionPalette } from "./fixes/condition-palette.mjs";
import { registerPublicTurnRoll } from "./fixes/public-turn-roll.mjs";
import { registerGhostTextureFix } from "./fixes/dsct-ghost-texture.mjs";
import { registerTeleportAbilities, teleportApi } from "./fixes/teleport-abilities.mjs";
import { registerQuietNotifications } from "./fixes/quiet-notifications.mjs";
import { registerSquadLabelsGuard, squadLabelsApi } from "./fixes/squad-labels-guard.mjs";
import { registerTrackerDock, trackerDockApi } from "./fixes/tracker-dock.mjs";
import { registerRingArtImages } from "./fixes/ring-art-images.mjs";
import { registerHiddenTokenPrivacy, hiddenTokenApi } from "./fixes/hidden-token-privacy.mjs";
import { registerCompactAbilityCards, compactCardsApi } from "./fixes/compact-ability-cards.mjs";
import { registerCollapseAbilityCards, collapseCardsApi } from "./fixes/collapse-ability-cards.mjs";
import { registerDstdAuthorShim, dstdAuthorApi } from "./fixes/dstd-author-shim.mjs";
import { registerPseudoCollectionRebind, pseudoCollectionApi } from "./fixes/pseudo-collection-rebind.mjs";
import { registerMetaCurrencyBox, metaBoxApi } from "./fixes/meta-currency-box.mjs";
import { registerMontageTracker, montageApi } from "./fixes/montage-tracker.mjs";
import { registerNegotiationTracker, negotiationApi } from "./fixes/negotiation-tracker.mjs";
import { registerChatSpeakerColors, chatSpeakersApi } from "./fixes/chat-speaker-colors.mjs";
import { registerMultiGrabGuard } from "./fixes/dsct-multi-grab-guard.mjs";

// Registered before the fixes, so its init/ready hooks run first.
const legacy = registerLegacyMigration({ moduleId: MODULE_ID, legacyIds: ["ds-local-fixes"], version: "1.0.0" });

registerPublicTurnRoll();
registerConditionPalette();
registerGhostTextureFix();
registerTeleportAbilities();
registerQuietNotifications();
registerSquadLabelsGuard();
registerRingArtImages();
registerTrackerDock();
registerHiddenTokenPrivacy();
// Fix 13 before Fix 9: both register their render hook inside Hooks.once("init"), which runs in registration order.
registerCompactAbilityCards();
registerCollapseAbilityCards();
registerDstdAuthorShim();
registerPseudoCollectionRebind();
registerMetaCurrencyBox();
registerMontageTracker();
registerNegotiationTracker();
registerChatSpeakerColors();
registerMultiGrabGuard();

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "dsctVersionWarned", { scope: "client", config: false, type: String, default: "" });
  const mod = game.modules.get(MODULE_ID);
  if (mod) {
    mod.api = {
      teleport: teleportApi,
      squadLabels: squadLabelsApi,
      trackerDock: trackerDockApi,
      hiddenTokens: hiddenTokenApi,
      collapseCards: collapseCardsApi,
      compactCards: compactCardsApi,
      dstdAuthor: dstdAuthorApi,
      pseudoCollections: pseudoCollectionApi,
      metaBox: metaBoxApi,
      montage: montageApi,
      negotiation: negotiationApi,
      chatSpeakers: chatSpeakersApi,
      migrateLegacy: legacy.migrate,
    };
  }
});

Hooks.once("ready", () => {
  try {
    if (!game.user.isGM || dsctVersionVerified()) return;
    const version = String(game.modules.get(DSCT_ID)?.version ?? "");
    console.warn(`${MODULE_ID} | Combat Tools ${version} is not a verified version (${DSCT_VERIFIED.join(", ")}); check Fixes 2, 3, 5 and 8.`);
    if (game.settings.get(MODULE_ID, "dsctVersionWarned") === version) return;
    ui.notifications.warn(game.i18n.format("DSLF.Version.Unverified", { version, verified: DSCT_VERIFIED.join(", ") }), { permanent: true });
    game.settings.set(MODULE_ID, "dsctVersionWarned", version).catch(() => {});
  } catch (err) {
    console.error(`${MODULE_ID} | version check failed`, err);
  }
});
