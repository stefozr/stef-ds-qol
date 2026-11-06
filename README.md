# Stef's Quality of Life Improvements for Draw Steel

A collection of small fixes and table conveniences for Foundry VTT's Draw Steel system and the modules around it
(Draw Steel: Combat Tools, Draw Steel - Combat Tracker, Draw Steel - Target Damage). Every change is applied from
outside, by wrapping methods and hooks, so updating the system or those modules never wipes it. Each fix checks that
what it patches is there (and, where it matters, which version it is) and steps aside otherwise.

## Features

- **Fix 1** The heroic resource roll at the start of a hero's turn is always posted publicly.
- **Fix 2** Combat Tools' greyscale "ghost" of unseen tokens keeps the dynamic token ring art.
- **Fix 3** Self-teleport abilities (Black Ash Teleport, "you teleport up to N squares") keep a Combat Tools teleport
  button.
- **Fix 4** Info and success banners are muted while a combat encounter exists.
- **Fix 5** Minion squads get Combat Tools' numbered squad labels reliably after combat starts.
- **Fix 6** The Combat Tracker dock gets a turn activation mode with undo, group management, a setup phase before
  combat and an adjustable size.
- **Fix 7** Tracker portraits use the token ring art instead of the default silhouette.
- **Fix 8** Tokens the Director hides stay hidden from players, with their icons, health text, turn markers and squad
  boxes.
- **Fix 9** Optional: collapse ability card descriptions in chat.
- **Fix 10** Draw Steel - Target Damage finds the author of a chat message on Foundry 14.
- **Fix 11** An item's effect lists stay current after "Update from compendium".
- **Fix 12** The condition palette keeps a readable size at any zoom; Shift-click applies a condition to every
  selected token.
- **Fix 13** Compact ability cards in chat (on by default).
- **Fix 14** A movable Hero Tokens / Malice box.
- **Fix 15** A montage test tracker: limits for the hero count, rounds, tests rolled from the tracker, outcome and
  Victories.
- **Fix 16** A negotiation tracker: drop an NPC to load its interest, patience, impression, motivations and pitfalls;
  players see only what the Director reveals.
- **Fix 17** Chat cards get the color of the speaker's player (border and name) and the speaking token's portrait.

## Installation

In Foundry: **Add-on Modules > Install Module**, paste this manifest URL and click Install:

```
https://github.com/stefozr/stef-ds-qol/releases/latest/download/module.json
```

Then enable **Stef's Quality of Life Improvements for Draw Steel** in your world's **Manage Modules**.

## Requirements and compatible modules

| Module | Required? | What it adds or why |
|---|---|---|
| Foundry VTT 14 | Yes | Built and tested on version 14. |
| Draw Steel system 1.1.2 | Yes | Every fix works on the system's documents, chat cards and interface. |
| [libWrapper](https://foundryvtt.com/packages/lib-wrapper) | Recommended | Wraps core and system methods cooperatively with other modules. Without it the fixes patch the methods directly. |
| Draw Steel: Combat Tools | Recommended | Fixes 2, 3, 5 and 8 repair parts of it. Checked against 1.2.3, 1.2.6, 1.2.7, 1.2.8 and 2.2.0 (Draw Steel 1.2.0); on another version the fixes still run and the Director is warned once. Without it those fixes do nothing. |
| Draw Steel: CTLib and Draw Steel: Death Tracker | With Combat Tools | Fix 8 replaces Combat Tools' visibility rule in CTLib's shared registry, which Death Tracker consults for every token. |
| Draw Steel - Combat Tracker | Recommended | Fix 6 extends its dock (version 1.0.9 only; other versions keep the stock dock and the Director gets a warning). Fix 7 also fixes its portraits (any version). |
| Draw Steel - Target Damage | Recommended | Fix 10 makes its author check work on Foundry 14 (checked with 1.0.8). |
| [Stef's Automation Suite for Draw Steel](https://github.com/stefozr/stef-ds-automation) | Optional | Where its ability library automates a teleport, Fix 3 leaves that ability to it. |
| Draw Steel: Battle Log | Optional | Fixes 9 and 13 work with its chat options (see Fix 9 and Fix 13). |
| Draw Steel Plus | Optional | Fixes 9 and 13 work with its improved chat; with its own Hero Tokens / Malice box on, Fix 14's box stays closed. |

## The fixes

### Fix 1: public heroic resource roll at turn start

**Problem.** When the Director starts a hero's turn while their own chat mode is private (Private GM, Blind, Self),
the hero's "Heroic Resource Gain" roll is whispered and the players never see what they rolled.

**What it changes.** While a hero's turn is starting, the system's resource roll is posted publicly unless the caller
chose a message mode itself. Nothing else is affected.

**Applies to.** The Draw Steel system. If the system renames the methods involved, the fix logs an error and does
nothing. No setting.

### Fix 2: Combat Tools' grey ghost keeps the ring art

**Problem.** With Combat Tools' "Everyone Knows Where Everyone Is" or "Grey Out What You Cannot See", players see
tokens they have no line of sight to as a greyscale ghost. For tokens whose art is the dynamic ring's subject image
(for example tokens made with Tokenizer), the ghost shows Foundry's mystery man or the square portrait, and the token
keeps that wrong image in colour once it is seen again. The Director never sees this.

**What it changes.** The ghost is made from the image the token actually displays, and a changed token image is never
ghosted from the old art. Tokens without a ring are unaffected.

**Applies to.** Draw Steel: Combat Tools (any version; see the version warning below). Without Combat Tools nothing is
installed. If a Combat Tools update fixes this itself, the fix becomes inert and says so in the console.

### Fix 3: self-teleport abilities keep a teleport button

**Problem.** Combat Tools offers its "Teleport N squares" button (preset distance, animation, undo) only when the
ability item carries its teleport effect. Some abilities lack it (Black Ash Teleport), and adding it by hand does not
last, because Combat Tools' refresh of its enhanced abilities removes entries its own data lacks.

**What it changes.** The Director's client keeps a Combat Tools teleport effect on hero abilities (on heroes and in the
Items sidebar, never in compendiums) that teleport the user:

- Black Ash Teleport: 5 squares plus 1 per Insight spent.
- Any ability whose effect text says "you teleport up to N squares": N squares, plus the spent resource when a spend
  effect mentions "additional squares".

If the ability already has a teleport automation of its own (from Combat Tools or added by you), nothing is added, and
an entry added earlier is removed again, so there is only ever one teleport button. New copies (dragged from a
compendium, gained on level-up) get the effect when they are created.

**Applies to.** Draw Steel: Combat Tools with its flat special effects available. Without them the fix logs a warning
and does nothing. When **Stef's Automation Suite for Draw Steel** is active, its "Ability library" setting is on and
its library automates the ability's teleport, the suite's own teleport row is used instead and this fix removes its
entry from that ability. Abilities the library does not cover keep the fix.

### Fix 4: quiet banners during combat

**Problem.** During combat the top of the screen fills with low-value banners ("X dealt N damage to Y", squad notices,
damage notifications), and each one covers the chat log for a few seconds.

**What it changes.** While a combat encounter exists in the tracker (started or not), every info and success banner is
skipped; its text goes to the browser console at debug level instead. Warnings, errors, progress bars and permanent
notices always show. With no encounter, everything shows as usual.

**Applies to.** Foundry core notifications, from every module. No setting: this is always on.

### Fix 5: squad labels after combat start

**Problem.** When combat begins, Combat Tools shows its "Auto-Rename Squads?" dialog, but the numbered Minion /
Captain / Group status icons often never appear. Combat Tools only labels groups named exactly "Group N" (N up to 10)
whose tokens are on the scene being viewed, skips everything else silently, and swallows errors when creating a label.

**What it changes.** On the active Director's client, after combat starts (once the dialog is closed), on scene
changes and when groups or combatants change during combat:

1. monster groups that are not named "Group N" are renamed to the lowest free "Group N" (groups with a hero are left
   alone);
2. Combat Tools' own labelling runs;
3. every member token without a label gets an equivalent one (same flag, name, icon and tint), so Combat Tools still
   treats it as its own and removes it at combat end.

**Applies to.** Draw Steel: Combat Tools with its squad tools, automatic squad labels and "apply label effects" settings
on. Without Combat Tools, or when it no longer offers its squad-label API, the fix logs a warning and stays off. API:
`api.squadLabels.ensure()` runs a pass now, `api.squadLabels.diagnose()` prints the state for a bug report.

### Fix 6: Combat Tracker dock

**Problem.** In the Draw Steel - Combat Tracker dock a single click on a portrait starts that creature's turn and rolls
the heroic resource, and a misclick cannot be undone. Groups cannot be managed from the dock, the dock only appears
once combat has started, and its size is fixed.

**What it changes.**

- **Turn activation** (setting): double-click (default), single click (the stock behaviour), click with a confirmation,
  or Ctrl/Shift + click. In every mode but single click, a plain click only selects and pans to the token(s).
- **Undo Last Activation** (button next to End Turn, menu and context menu) restores the initiative, the turn, the
  hero's heroic resource and deletes the roll card. Players' activations are relayed to the Director so they can be
  undone too.
- **Groups** for the Director: Create Group and Add Selected Tokens in the menu, drag a portrait onto a group pill (or
  off it), and a context menu on pills and portraits (rename, add selected, remove members, toggle captain or
  defeated, move to a group, remove from the encounter, plus the system's own group entries).
- **Setup phase** (setting): the dock shows as soon as an encounter exists, with Begin Combat, Add Selected Tokens and
  Roll for First.
- **Size**: a portrait size setting scales the whole dock, and the dock width you drag is kept per browser
  (double-click a handle to reset it).

**Applies to.** Draw Steel - Combat Tracker **1.0.9 only**. On any other version the dock stays stock, the console
says why and the Director sees a warning. Without the tracker nothing is installed. It works with Combat Tools' squad
turns (double-clicking a minion activates its squad). Known limits: undo cannot suppress the system's end-of-turn
events for the undone hero or revert Combat Tools' simultaneous-squad cascades, undo records are forgotten on reload,
and combatants added after Begin Combat keep no initiative value.

### Fix 7: ring art in tracker portraits

**Problem.** Tokens whose art is the dynamic ring's subject image (Tokenizer) keep Foundry's mystery-man silhouette as
their plain image, so the sidebar combat tracker and the Combat Tracker dock show a silhouette.

**What it changes.** When a combatant has no image of its own and would show the default silhouette, it shows the ring
subject image instead. Every other image stays as core or the dock chose it.

**Applies to.** Foundry's combat tracker (always) and the Draw Steel - Combat Tracker dock (any version, when active).
No setting.

### Fix 8: hidden tokens stay hidden

**Problem.** With Combat Tools' "Everyone Knows Where Everyone Is", a token the Director hides with Foundry's "hidden"
toggle is still drawn for players as a ghost, together with its squad icons, health text and turn glow, and Combat
Tools' floating squad box and turn marker give its position away.

**What it changes.** On player clients, a hidden token is never forced visible; its squad box disappears while every
living minion of that squad is hidden, and its turn marker follows the token's visibility. Revealing the token brings
everything back. The Director sees everything as before. Known limit: a squad with only some tokens hidden keeps its
box, placed at the centre of all its living tokens.

**Applies to.** Draw Steel: Combat Tools with Draw Steel: CTLib (the token visibility rule is consulted through Draw
Steel: Death Tracker). Without them the fix does nothing (core already hides hidden tokens). API: `api.hiddenTokens.recheck()`.

### Fix 9: collapse ability cards in chat

**Problem.** Every ability use prints the full ability text in chat, which floods the log.

**What it changes.** Client setting **Collapse ability cards in chat**:

- *Off* (default): nothing changes.
- *Effects only*: the summary (keywords, distance, target) stays; each effect and power roll section becomes a
  collapsed header you open one at a time; clicking the ability name opens or closes them all. Has no effect while
  compact cards (Fix 13) are on.
- *All*: only the ability name shows; click the card to expand it, click the name to collapse it again.

Cards you opened stay open when they re-render during the session. Buttons and power-roll results are never hidden.

**Applies to.** The Draw Steel system's ability cards, with or without Draw Steel Plus' improved chat. With Draw Steel:
Battle Log's "collapsible abilities" on, *All* hands the collapsing to Battle Log (one caret, Battle Log's); new cards
still start collapsed.

### Fix 10: Target Damage finds the message author

**Problem.** Draw Steel - Target Damage looks up a chat card's author under a field name Foundry renamed years ago, so
on Foundry 14 every client tries to save the target panel state. Players' clients are refused (permission errors in
the server log) and the panels can flicker.

**What it changes.** Chat messages get a read-only `user` property that returns the message author, so only the
author's client saves the panel state. If Foundry ever defines that property itself, the fix steps aside.

**Applies to.** Draw Steel - Target Damage (checked with 1.0.8). The property is added whether or not Target Damage is
active; it is harmless without it. No setting.

### Fix 11: effect lists stay current after "Update from compendium"

**Problem.** After **Update from compendium** on an ability, later changes to its special effects or power roll
effects are saved but do not show: the sheet, chat cards and modules keep seeing the old list until a reload.

**What it changes.** After every item, actor and chat message update, an effect list that lost its link to the
document's data is re-linked, the document is prepared again and its open sheets re-render. While the link is intact
(and once the system fixes this), nothing happens.

**Applies to.** The Draw Steel system (found on 1.1.2). No setting. API: `api.pseudoCollections.check(item)`,
`api.pseudoCollections.scan()`.

### Fix 12: condition palette

**Problem.** The token HUD's condition palette scales with the canvas zoom, so it becomes tiny or huge, and a
condition can only be set on one token at a time.

**What it changes.** The palette keeps its on-screen size at every zoom and stays inside the window. Shift-click (or
Shift + right-click for an overlay) on a condition applies the same change to every selected token whose actor you own
(each linked actor once), keeping the chosen expiry. Actors you do not own are skipped with a warning.

**Applies to.** The Draw Steel system's token HUD. No setting.

### Fix 13: compact ability cards in chat

**Problem.** An ability card is a stack of boxes: section headers ("Effect", "Power Roll Tiers", an empty "Effect
(After)"), Combat Tools' "automates part of this" note with a Reveal button on every enhanced ability, and a separate,
tall roll result block.

**What it changes.** Client setting **Compact ability cards in chat** (on by default):

- the ability name with one summary line (cost, action type, distance, target, keywords), the trigger on its own line;
- effect text without section headers ("**Effect:** ..."), empty sections and the Combat Tools note removed;
- the tier table folded behind **tiers**;
- the roll result on one line (total, tier, result), with the dice behind the total and the system's ⋮ menu beside it;
- footer buttons in one row.

Turning the setting off re-renders the cards as before, without a reload.

**Applies to.** The Draw Steel system's ability cards, with or without Draw Steel Plus' improved chat. Draw Steel:
Battle Log's chat options compose with it (its collapsible abilities and dice images keep working). On cards with
Target Damage's panel, Target Damage's own hiding wins. API: `api.compactCards.check()`, `.rerenderAll()`.

### Fix 14: movable Hero Tokens / Malice box

**Problem.** The system shows Hero Tokens and Malice only as a thin strip under the players list.

**What it changes.** Client setting **Movable Hero Tokens / Malice box** (on by default) shows both values in a small
box that you can drag anywhere; its position is saved per user and kept on screen when the window resizes. It replaces
the strip under the players list.

- Director: click Hero Tokens to spend one, right-click to give one (with a chat line); click Malice for −1,
  right-click for +1. Malice is dimmed outside combat, where the system sets it when combat starts.
- Players: click Hero Tokens to spend one after a confirmation; the system tells the Director in chat. Malice shows
  only when the system's "Show Malice to players" setting is on and a combat exists.
- ⋮ opens the system's own hero token and Malice menu, plus **Reset box position**.

**Applies to.** The Draw Steel system. If Draw Steel Plus is active with its own box on, this box stays closed. API:
`api.metaBox.check()`, `.resetPosition()`.

### Fix 15: montage test tracker

**Problem.** The system has no tool to run a montage test at the table.

**What it changes.** The Director gets a **montage test** button in the Token controls. It starts a montage and opens
its window on every screen (heroes of the primary party are added). **End montage** in the window's header menu ends
it and closes the window everywhere. Closing the window only hides it on that screen; the same button reopens it, and
players get the button too while a montage runs. Each user's window position and width are remembered.

- Director: title, difficulty (Easy 5/5, Moderate 6/4, Hard 7/3 successes / failures, adjusted by one for each hero
  above or below five, never below two) and hero count (empty = the heroes in the list). Successes and failures as
  bars with −/+, the round (two rounds) with previous / next; next round lets every hero act again.
- Each bar and the round have an eye: players see them only once revealed.
- Heroes: drop a hero actor or token on the window, or use **Add the party's heroes** in the header menu. Each row shows the skills
  already used in this montage, an "acted" checkbox and a remove button.
- Rolling: the dice button opens a small form (characteristic, test difficulty), then the system's own Power Roll
  dialog (skill, edges, banes). The result counts as a success at tier 1+ (easy test), 2+ (medium) or 3+ (hard).
  Players roll for their own heroes; the active Director's client records the result.
- Outcome: total success at the success limit; at the failure limit or when time is up, partial success with at
  least two more successes than failures, otherwise total failure. **Award** gives each hero in the list the Victories
  for the outcome (Easy 1 / 0, Moderate 1 / 1, Hard 2 / 1 for total / partial success) and posts a chat line.
  Players see the outcome once both bars are revealed.
- The header menu also opens the montage rules page of the system's rules journal and restarts the counters.

**Applies to.** The Draw Steel system. World setting **Montage test tracker** (on) shows the button. API:
`api.montage.start()`, `.open()`, `.end()`, `.check()`.

### Fix 16: negotiation tracker

**Problem.** NPCs carry negotiation stats on their sheet, but the system has no tool to run a negotiation at the
table.

**What it changes.** The Director gets a **negotiation** button in the Token controls; it starts a negotiation and
opens its window on every screen. **End negotiation** in the header menu ends it. As with the montage, closing the
window only hides it on that screen and the button (players get it too while a negotiation runs) reopens it.

- Drop an NPC (actor or token) on the window: its name, portrait, interest, patience, impression, motivations and
  pitfalls are copied into the tracker. The NPC itself is never changed. Without an NPC, type a name and pick an
  attitude (Hostile 1/2, Suspicious 2/2, Neutral 2/3, Open 3/3, Friendly 3/4, Trusting 3/5 interest / patience).
- Interest and patience (0 to 5) as pips, impression as a number, each with −/+, back to the starting value, and an
  eye to reveal it to players.
- Motivations and pitfalls: add from the system's list (each one only once across both lists) or type a custom one.
  Each entry has a checkbox (appealed to / triggered), an eye (discovered by the players) and a remove button.
- Players see the NPC name and portrait, the revealed values and the discovered motivations (M) and pitfalls (P).
- A status line shows interest 5 (they agree), interest 0 (no deal) or patience 0 (the negotiation ends).
- The header menu opens the negotiation rules page and unlinks the NPC.

**Applies to.** The Draw Steel system. World setting **Negotiation tracker** (on) shows the button. API:
`api.negotiation.start()`, `.open()`, `.end()`, `.fromNpc(actor)`, `.check()`.

Both trackers follow the features of Draw Steel Plus's montage and negotiation panels; the code is this module's own.

### Fix 17: player colors and token portraits on chat cards

**Problem.** Only plain out-of-character messages get their author's color as a border. Ability cards, tests and
every other card keep the neutral border, so it is hard to see at a glance who used what.

**What it changes.** Every chat card with a speaker (ability cards, tests, saves, damage, in-character chat) gets:

- a border, and the speaker name, in the color of the speaker's player: the player whose assigned character it is,
  else a player who owns it (a logged-in one first). A card the Director posts for a hero still gets that hero's
  player color. NPC and monster cards get the color of the Director who posted them.
- the speaking token's image left of the name (the ring art for ring tokens, else the token image, else the
  prototype token, else the actor portrait). Click it to pan to the token on the viewed scene.

Two client settings, **Player colors on chat cards** and **Token portraits on chat cards** (both on). Cards update
in place when a setting, a player's color or assigned character, or an actor's ownership changes.

**Applies to.** Core chat and the Draw Steel system's cards, in the chat log, popouts and notifications. API:
`api.chatSpeakers.check(messageId)`, `.refreshAll()`.

## Combat Tools version warning

Fixes 2, 3, 5 and 8 depend on how Combat Tools works inside, so they were checked against Combat Tools 1.2.3, 1.2.6,
1.2.7, 1.2.8 and 2.2.0. Draw Steel 1.2.0 with Combat Tools 2.2.0 is verified. With another version every fix still installs, but the Director sees one warning per browser and
version, and the console names the fixes to check.

## Settings

| Setting | Scope | What it does |
|---|---|---|
| Collapse ability cards in chat | Client | Fix 9: Off / Effects only / All. |
| Compact ability cards in chat | Client | Fix 13: on by default. |
| Movable Hero Tokens / Malice box | Client | Fix 14: on by default. |
| Player colors on chat cards | Client | Fix 17: on by default. |
| Token portraits on chat cards | Client | Fix 17: on by default. |
| Montage test tracker | World | Fix 15: the montage test button in the Token controls (on by default). |
| Negotiation tracker | World | Fix 16: the negotiation button in the Token controls (on by default). |
| Combat Tracker dock: Turn Activation | World | Fix 6: double-click (default), single click, click with confirmation, Ctrl/Shift + click. |
| Combat Tracker dock: Show Before Combat Starts | World | Fix 6: show the dock with a setup phase as soon as an encounter exists (on by default). |
| Combat Tracker dock: Portrait Size | Client | Fix 6: portrait size in pixels (48 to 140, default 80); the dock scales with it. |

Hidden: the dock width (client), the Combat Tools version already warned about (client), the running montage and
negotiation (world), the Fix 14 box position and the Fix 15 and 16 window positions (user flags).

## API

`game.modules.get("stef-ds-qol").api`:

| Entry | What it does |
|---|---|
| `teleport.repairAll()` | Fix 3: check every hero ability now (Director). |
| `teleport.libraryTeleports(item)` | Fix 3: does the Automation Suite's library handle this ability's teleport? |
| `squadLabels.ensure()`, `squadLabels.diagnose()` | Fix 5: run a labelling pass now; print the state for a bug report. |
| `trackerDock.sync()`, `trackerDock.undo()`, `trackerDock.installed` | Fix 6: re-sync the dock; undo the last activation; whether the dock was extended. |
| `hiddenTokens.recheck()` | Fix 8: re-evaluate the squad boxes now. |
| `collapseCards.applyAll()` | Fix 9: re-apply the setting to every rendered card. |
| `compactCards.check()`, `.applyAll()`, `.rerenderAll()` | Fix 13: report per card; re-apply; re-render. |
| `dstdAuthor.check()` | Fix 10: whether the author shim is active. |
| `pseudoCollections.check(doc)`, `.scan()` | Fix 11: link state of a document's effect lists; re-link every stale world item now. |
| `metaBox.check()`, `.render()`, `.resetPosition()` | Fix 14. |
| `chatSpeakers.check(messageId)`, `.refreshAll()` | Fix 17: chosen player, color and portrait of a message (default: the last); re-apply to every rendered card. |
| `montage.start()`, `.open()`, `.end()`, `.check()` | Fix 15: start or end the montage (Director); reopen its window; stored state, limits, outcome. |
| `negotiation.start()`, `.open()`, `.end()`, `.fromNpc(actor)`, `.check()` | Fix 16: start, end, load an NPC (Director); reopen its window; stored state. |

## Known limitations

- Fix 6 extends only Draw Steel - Combat Tracker 1.0.9.
- Fixes 2, 3, 5 and 8 are checked against Combat Tools 1.2.3 to 1.2.8 and 2.2.0 (verified with Draw Steel 1.2.0); later versions may need a new check.
- Fix 4 has no switch: info and success banners are always muted while an encounter exists.
- Fix 13's click toggles listen on the main window only, not in detached chat windows.
- Fix 6's undo records live in memory and are lost on reload.
- Fixes 15 and 16 keep the running montage and negotiation in world settings, which every client receives: the eyes
  hide values in the windows, but a player could read them from the browser console.
- Fix 15 records a test when it is rolled; a later reroll that changes the tier is not read again, so the Director
  corrects the bars with −/+.
- Fix 15 needs a Director online to record a player's test.

## Uninstalling

Disabling the module removes every patch at the next reload. What stays behind: Fix 3's teleport effect (id
`dslfTeleport0001`) on the abilities that received it (Combat Tools' next refresh of its enhanced abilities removes it
from those, or delete it on the ability sheet), squad labels and group names that Fix 5 created (Combat Tools removes
the labels at combat end), the box position in each user's flags and the module's settings.

## Stef's modules

| Module | What it does |
|---|---|
| [Stef's Automation Suite for Draw Steel](https://github.com/stefozr/stef-ds-automation) | Applies ability results per target (damage, conditions, forced movement, saves, triggered actions, summons, areas) with undo, plus the automation library and editor. |
| [Stef's Quality of Life Improvements for Draw Steel](https://github.com/stefozr/stef-ds-qol) | Small fixes and table conveniences for the Draw Steel system and the Combat Tools family. |
| [Stef's Auto FX for Draw Steel](https://github.com/stefozr/stef-ds-fx) | Sequencer animations for abilities, scaled by tier, per target with the Automation Suite. |
| [Stef's Character Sheets Evolved for Draw Steel](https://github.com/stefozr/stef-ds-charsheet) | A compact hero and monster sheet with class art, collapsible rows and a combat strip. |
| [Stef's Health Overlay](https://github.com/stefozr/stef-health-overlay) | Injury overlays on tokens by remaining Stamina / HP (Draw Steel and D&D 5e). |

## License

MIT, see [LICENSE](LICENSE). The Combat Tracker dock template, its stylesheet and parts of `scripts/fixes/tracker-dock.mjs`
are derived from Draw Steel - Combat Tracker by Ömer Cora (MIT); see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

Stef's Quality of Life Improvements for Draw Steel is an independent product and is not affiliated with, endorsed or
sponsored by MCDM Productions, LLC. Draw Steel is a trademark of MCDM Productions, LLC. This module ships no Draw Steel
rules text or artwork; it uses ability, feature, condition and monster names and compendium identifiers only to work
with content you already have.
