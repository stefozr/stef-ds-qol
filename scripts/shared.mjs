export const MODULE_ID = "stef-ds-qol";
export const DSCT_ID = "draw-steel-combat-tools";

/** Is Draw Steel: Combat Tools installed and enabled in this world? */
export const dsctActive = () => !!game.modules.get(DSCT_ID)?.active;

/**
 * 1.11.0: the Combat Tools versions Fixes 2, 3, 5, 8 and 18 were checked against (their seams are read from its
 * sources). Outside the list every fix still installs; the Director gets one warning per client and version.
 */
export const DSCT_VERIFIED = Object.freeze(["1.2.3", "1.2.6", "1.2.7", "1.2.8", "2.2.0", "2.2.1.1"]);

/** Is the installed Combat Tools a verified version (true when it is absent or inactive)? */
export function dsctVersionVerified() {
  const mod = game.modules.get(DSCT_ID);
  return !mod?.active || DSCT_VERIFIED.includes(String(mod.version));
}
