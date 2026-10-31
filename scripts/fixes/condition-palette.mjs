/** Keep the condition palette readable at every canvas zoom; Shift-click sets the selected actors together. */
const installed = new WeakSet();
const list = value => value?.contents ?? [...(value ?? [])];

export async function setSelectedCondition(hud, event, target) {
  const { statusId } = target.dataset;
  const active = !target.classList.contains("active");
  const effectEnd = hud.element.querySelector('[data-name="system.end.type"]')?.value ?? "";
  const actors = new Map((globalThis.canvas?.tokens?.controlled ?? []).map(t => [t.actor?.uuid, t.actor]));
  let skipped = 0;
  for (const actor of actors.values()) {
    if (!actor?.isOwner) { skipped++; continue; }
    const config = CONFIG.statusEffects[statusId] ?? list(CONFIG.statusEffects).find(s => s.id === statusId);
    const effects = list(actor.effects).filter(e => e.statuses?.has(statusId));
    if (effects.some(e => config?._id ? e.id !== config._id : e.statuses.size !== 1)) { skipped++; continue; }
    try {
      if (active) {
        const inactive = effects.filter(e => !e.active).map(e => e.id);
        if (inactive.length) await actor.deleteEmbeddedDocuments("ActiveEffect", inactive);
      }
      await actor.toggleStatusEffect(statusId, { active, overlay: event.button === 2, effectEnd });
    } catch (error) { console.warn("stef-ds-qol | condition skipped", actor.name, error); skipped++; }
  }
  if (skipped) ui.notifications.warn(`${skipped} selected token actor(s) could not change this condition.`);
  await hud.render({ force: true });
}

export function resizeConditionPalette(hud) {
  // The native toggle button also has data-palette="effects" and precedes the palette.
  // Never scale or move that control: only resize the palette container itself.
  const palette = hud?.element?.querySelector('.status-effects.palette[data-palette="effects"]');
  if (!palette || !globalThis.canvas?.ready) return;
  const zoom = Number(canvas.stage?.scale?.x) || 1;
  const userScale = Number(game.settings.get("core", "uiConfig")?.uiScale) || 1;
  const scale = zoom * (Number(canvas.dimensions?.uiScale) || 1) / userScale;
  palette.style.scale = String(1 / scale);
  palette.style.transformOrigin = "left top";
  palette.style.maxHeight = `${Math.max(100, (window.innerHeight - 32) / userScale)}px`;
  palette.style.overflowY = "auto";
  palette.style.translate = "0px 0px";
  const rect = palette.getBoundingClientRect();
  const dx = rect.right > window.innerWidth - 8 ? window.innerWidth - 8 - rect.right : rect.left < 8 ? 8 - rect.left : 0;
  const dy = rect.bottom > window.innerHeight - 8 ? window.innerHeight - 8 - rect.bottom : rect.top < 8 ? 8 - rect.top : 0;
  palette.style.translate = `${dx / (scale * userScale)}px ${dy / (scale * userScale)}px`;
}

export function registerConditionPalette() {
  Hooks.on("renderDrawSteelTokenHUD", hud => {
    resizeConditionPalette(hud);
    if (installed.has(hud.element)) return;
    installed.add(hud.element);
    const intercept = event => {
      const target = event.target.closest('[data-action="effect"][data-status-id]');
      if (!event.shiftKey || !target || !canvas.tokens.controlled.length) return;
      event.preventDefault(); event.stopImmediatePropagation();
      void setSelectedCondition(hud, event, target);
    };
    hud.element.addEventListener("click", intercept, { capture: true });
    hud.element.addEventListener("contextmenu", intercept, { capture: true });
  });
  Hooks.on("canvasPan", () => resizeConditionPalette(canvas.hud?.token));
  window.addEventListener("resize", () => resizeConditionPalette(globalThis.canvas?.hud?.token));
}
