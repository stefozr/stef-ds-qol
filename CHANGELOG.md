# Changelog

All notable changes to this module are listed here, newest first.

## [1.2.0] - 2026-11-05

### Changed
- Verified with Draw Steel 1.2.0 and Combat Tools 2.2.0.

### Fixed
- Compact ability cards also fold the per-target results of Draw Steel 1.2: each target is one line with its name,
  dice total, tier and damage button; the dice and the damage formula open from the dice total, and the tier table
  opens from "tiers" inside the expanded ability. When the card has the automation section, the line's undo button is
  hidden (that section has the undo) and conditions it has a row for (applied, pending or resisted) show there only,
  without Combat Tools' "Applied Effect" box or the condition buttons under the target (the system's or Combat
  Tools' own Grabbed / Frightened / Taunted buttons). "Apply All Damage" is hidden once the automation section owns
  every damage row.
- Combat Tools: ending one grab of an ability that grabs several creatures (Claw Swing, Several Arms, ...) no longer
  drops the other grabs, which used to leave their Grabbed and Grabber effects behind (Fix 18).

## [1.1.0] - 2026-11-01

### Added
- Montage test tracker (Fix 15): the Director starts it from the Token controls and it opens on every screen.
  Success and failure limits for the montage difficulty and hero count, two rounds, heroes added from the party or
  by drag and drop, tests rolled from the tracker through the system's Power Roll dialog (players roll for their own
  heroes), skills already used, outcome and a Victory award. The Director chooses what players see.
- Negotiation tracker (Fix 16): drop an NPC to load its interest, patience, impression, motivations and pitfalls, or
  set an attitude; adjust values, mark motivations appealed to and pitfalls triggered, and reveal each value and entry
  to the players.
- Player colors and token portraits on chat cards (Fix 17): every card with a speaker gets a border and a name in
  the color of the speaker's player (NPCs and monsters: the Director who posted them) and the speaking token's
  image; click it to pan to the token. Two client settings, both on.
- Both trackers are standard windows that remember their position per user; closing one only hides it on that
  screen, and the Token-controls button (also shown to players while a tracker runs) reopens it. Each links to the
  system's rules page.

## [1.0.0] - 2026-10-31

First public release.

### Changed
- Fix 3 now looks for Stef's Automation Suite for Draw Steel (`stef-ds-automation`) to hand teleports over to its
  ability library.
- The Hero Tokens / Malice box setting hint now matches the clicks (click removes one, right-click adds one).

### Features
- Public heroic resource rolls at turn start; quiet info and success banners during combat.
- Combat Tools: ring art for unseen-token ghosts, teleport buttons on self-teleport abilities, reliable squad labels,
  GM-hidden tokens that stay hidden from players (checked against Combat Tools 1.2.3 to 1.2.8).
- Draw Steel - Combat Tracker 1.0.9 dock: turn activation mode with undo, group management, setup phase, sizing;
  ring art in tracker portraits.
- Chat: compact ability cards (on by default) and optional collapsed cards.
- Movable Hero Tokens / Malice box; a condition palette that stays readable at any zoom, with Shift-click for all
  selected tokens.
- Target Damage author lookup on Foundry 14; effect lists that stay current after "Update from compendium".

## Before 1.0 (private development as "Draw Steel: Local Fixes")

### 1.13.2
- Combat Tools 1.2.8 added to the verified versions.

### 1.13.1
- Hero Tokens / Malice box: the Director clicks to remove one and right-clicks to add one.

### 1.13.0
- Fix 14: movable Hero Tokens / Malice box, replacing the strip under the players list.

### 1.12.1
- Combat Tools 1.2.7 added to the verified versions.

### 1.12.0
- Fix 9 "All" hands collapsing to Draw Steel: Battle Log when its collapsible abilities are on (one caret).
- "tiers" on the result line opens the tier table even while the card is collapsed.

### 1.11.0
- Combat Tools version guard: the Director is warned once per browser and version when Combat Tools is not a
  verified version (1.2.3, 1.2.6).

### 1.10.0
- Fix 13: compact ability cards in chat.

### 1.9.1
- Fix 12: the zoom adjustment no longer resizes the condition menu's toggle button.

### 1.9.0
- Fix 12: the condition palette keeps its size while zooming; Shift-click applies to every selected owned token.

### 1.8.0
- Fix 11: effect lists stay current after "Update from compendium".

### 1.7.0
- Fix 3 steps aside for abilities whose teleport the automation suite's library handles.

### Earlier
- Fixes 1 to 10: public turn-start roll, Combat Tools ghost art, teleport abilities, quiet banners, squad labels,
  Combat Tracker dock, ring art portraits, hidden-token privacy, collapsible ability cards, Target Damage author shim.
