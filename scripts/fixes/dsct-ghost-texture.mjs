/**
 * Fix 2 — Combat Tools' greyscale "ghost" keeps the ring art of dynamic-ring tokens.
 *
 * Symptom (players only): tokens they cannot currently see are drawn as the Foundry mystery man
 * inside a ring, or as the actor's square portrait with no ring, while the GM sees the proper
 * ring token.
 *
 * Cause: `draw-steel-combat-tools/src/conditions/combat-reveal.mjs` (1.2.2, `syncPositionGhost`,
 * lines 113-137) bakes a black-and-white copy of a token the viewer has no line of sight to:
 *
 *     const source = mesh.dsctColourTexture ?? token.texture ?? mesh.texture;   // line 129
 *     mesh.dsctColourTexture = source; mesh.texture = baked;                      // grey
 *     mesh.texture = mesh.dsctColourTexture; delete mesh.dsctColourTexture;       // un-grey
 *
 * For a token with a dynamic ring, `token.texture` is the image loaded from `texture.src`
 * (core token.mjs:1212, fallback icons/svg/mystery-man.svg) while the ring draws
 * `ring.subject.texture` on `mesh.texture` (core tokens/ring.mjs:505-510). Tokenizer stores the
 * art as the ring subject, so DSCT greys from the wrong image and then "restores" that wrong
 * image in colour. The GM never takes this path.
 *
 * Mechanism: DSCT reads and writes `mesh.dsctColourTexture`, an ad-hoc expando on the token's
 * `PrimarySpriteMesh`. We define that name as an accessor on the prototype:
 *   - get → the mesh's current texture, unless it is a baked ghost (a `PIXI.RenderTexture`) or
 *     empty, so DSCT's `??` chain resolves to the displayed (ring subject) texture;
 *   - set → defines an own data property on the instance, which DSCT later `delete`s, exposing
 *     the accessor again.
 * For tokens without a ring `mesh.texture === token.texture`, so nothing changes. Tiles share
 * the class; the inert property is harmless. Once upstream fixes the line, the accessor is
 * behaviour-neutral, so it can stay. A thin wrapper on `PrimaryCanvasGroup#addToken` drops a
 * stored colour texture when a mesh is reused on redraw, so a changed token image is never
 * ghosted from the old art.
 */

import { MODULE_ID, DSCT_ID, dsctActive } from "../shared.mjs";

const PROP = "dsctColourTexture";
const DSCT_FILE = `modules/${DSCT_ID}/src/conditions/combat-reveal.mjs`;
const BUGGY_SOURCE = /mesh\.dsctColourTexture\s*\?\?\s*token\.texture/;

function installAccessor() {
  const Mesh = foundry.canvas?.primary?.PrimarySpriteMesh;
  if (!Mesh?.prototype) {
    console.error(`${MODULE_ID} | Fix 2: foundry.canvas.primary.PrimarySpriteMesh not found; ghost-texture fix NOT applied.`);
    return false;
  }
  if (Object.getOwnPropertyDescriptor(Mesh.prototype, PROP)) return true;

  Object.defineProperty(Mesh.prototype, PROP, {
    configurable: true,
    enumerable: false,
    get() {
      const t = this.texture;
      if (!t || t === PIXI.Texture.EMPTY || (t instanceof PIXI.RenderTexture)) return undefined;
      return t;
    },
    set(value) {
      Object.defineProperty(this, PROP, { value, writable: true, configurable: true, enumerable: true });
    },
  });
  return true;
}

/**
 * On a redraw `PrimaryCanvasGroup#addToken` reuses the existing mesh (core primary.mjs:378) and
 * puts the fresh texture on it. A colour texture DSCT stored before the redraw is stale (the
 * token image may have changed), so drop it right there, before DSCT's drawToken handler bakes
 * from it. The accessor then yields the newly displayed art on the next greying.
 */
function wrappedAddToken(wrapped, token, ...rest) {
  const mesh = token?.objectId ? this.tokens?.get(token.objectId) : null;
  if (mesh && Object.prototype.hasOwnProperty.call(mesh, PROP)) delete mesh[PROP];
  return wrapped(token, ...rest);
}

function installAddTokenWrapper() {
  const Group = foundry.canvas?.groups?.PrimaryCanvasGroup;
  if (!(Group?.prototype?.addToken instanceof Function)) {
    console.warn(`${MODULE_ID} | Fix 2: PrimaryCanvasGroup#addToken not found; stale-texture guard skipped.`);
    return;
  }
  if (game.modules.get("lib-wrapper")?.active && (typeof libWrapper !== "undefined")) {
    libWrapper.register(MODULE_ID, "foundry.canvas.groups.PrimaryCanvasGroup.prototype.addToken", wrappedAddToken, "WRAPPER");
    return;
  }
  const original = Group.prototype.addToken;
  Group.prototype.addToken = function (...args) {
    return wrappedAddToken.call(this, original.bind(this), ...args);
  };
}

/** Informational: tell the console if upstream changed the line we are working around. */
async function checkUpstream() {
  try {
    const res = await fetch(foundry.utils.getRoute(DSCT_FILE), { cache: "no-store" });
    if (!res.ok) return;
    const text = await res.text();
    if (!BUGGY_SOURCE.test(text)) {
      console.warn(`${MODULE_ID} | Fix 2: ${DSCT_FILE} no longer contains "mesh.dsctColourTexture ?? token.texture". `
        + "Upstream may have fixed the ghost texture; this fix is now inert and can be removed.");
    }
  } catch (err) {
    console.debug(`${MODULE_ID} | Fix 2: could not inspect ${DSCT_FILE}:`, err);
  }
}

export function registerGhostTextureFix() {
  Hooks.once("setup", () => {
    if (!dsctActive()) return;
    if (!installAccessor()) return;
    installAddTokenWrapper();
    console.log(`${MODULE_ID} | Fix 2: Combat Tools ghost texture made ring-aware.`);
  });
  Hooks.once("ready", () => { if (dsctActive()) checkUpstream(); });
}
