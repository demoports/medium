// QA only: replay the same 1 ms effect updates with one shared Render clock.
// The executable has one frame loop; its visible Comic springs, Tunnel
// damping, and camera/fog cache all advance together, including during photos.
export function installCadenceProfile(demo, rate = 60) {
  if (!(rate > 0 && rate <= 1000)) throw new RangeError('Render rate must be in (0, 1000]');
  const timeline = demo.timeline;
  const originalReset = timeline.hooks.onReset;
  const renderFrame = timeline.renderFrame.bind(timeline);
  let frameIndex = 0;
  const stats = {rate,frames:0,comicFrames:0,smallBlobSteps:0,outerBlobSteps:0,tunnelFrames:0};
  // Suppress only the production 60 Hz cache scheduler. The hook below
  // invokes the original cache operation at the selected frame boundaries.
  timeline.renderFrame = () => {};
  timeline.hooks.onReset = state => {
    originalReset?.(state);
    frameIndex = 0;
    for (const key of Object.keys(stats)) if (key !== 'rate') stats[key] = 0;
    renderFrame();
  };
  timeline.hooks.onRenderTick = state => {
    const next = Math.floor(state.tick * rate / 1000);
    if (next === frameIndex && state.tick !== Math.round(timeline.data.duration * 1000)) return;
    frameIndex = next;
    stats.frames++;
    for (const name of new Set(state.layers)) {
      const effect = demo.effects[name];
      if (name === 'comic') {
        const comic = state.effects.comic;
        if (effect.previousEffect !== comic) {
          effect.reset();
          effect.previousEffect = comic;
        }
        // Invoke the existing native spring step once, bypassing only its
        // fixed-rate accumulator. No force/radius/velocity formula changes.
        effect.renderAccumulator = 1000 - 60;
        effect.onRenderTick(state);
        stats.comicFrames++;
        if (comic.flag120) stats.smallBlobSteps++;
        if (comic.flag121) stats.outerBlobSteps++;
      } else if (name === 'tunnel') {
        effect.smoothFrame = 1000 - 60;
        effect.onRenderTick(state);
        stats.tunnelFrames++;
      }
    }
    renderFrame();
  };
  timeline.frameAt = seconds => {
    const end = Math.round(timeline.data.duration * 1000);
    const target = Math.max(0,Math.min(Math.floor(seconds * 1000),end));
    const tick = target === end ? end : Math.ceil(Math.floor(target * rate / 1000) * 1000 / rate);
    return timeline.stateAt((tick + .0001) / 1000);
  };
  timeline.reset();
  return stats;
}
