// Frame-exact virtual clock for capturing a web page as video.
// Inject before any page script, e.g. Playwright: await context.addInitScript({ path: "virtual-clock.js" }).
// Then, once per frame: await page.evaluate(t => window.__clock.advance(t), frameIndex * 1000 / fps).
// Timers, requestAnimationFrame, performance.now, Date.now and Math.random become deterministic,
// and CSS animations and transitions are paused and pinned to virtual time.
(() => {
  let now = 0, nextTimer = 1, nextFrame = 1, seed = 7;
  const timers = new Map(), frames = new Map();
  const epoch = 1767225600000;            // fixed, so every capture run is identical
  performance.now = () => now;
  Date.now = () => epoch + now;
  Math.random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  window.setTimeout = (fn, ms = 0, ...args) => {
    const id = nextTimer++;
    timers.set(id, { t: now + Math.max(0, +ms || 0), fn, args });
    return id;
  };
  window.clearTimeout = id => timers.delete(id);
  window.setInterval = (fn, ms = 0, ...args) => {
    const id = nextTimer++, every = Math.max(1, +ms || 0);
    timers.set(id, { t: now + every, fn, args, every });
    return id;
  };
  window.clearInterval = id => timers.delete(id);
  window.requestAnimationFrame = fn => {
    const id = nextFrame++;
    frames.set(id, fn);
    return id;
  };
  window.cancelAnimationFrame = id => frames.delete(id);

  const syncCss = () => {
    if (typeof document === "undefined" || !document.getAnimations) return;
    for (const a of document.getAnimations()) {
      if (a.__virtualStart == null) { a.__virtualStart = now; a.pause(); }
      try { a.currentTime = now - a.__virtualStart; } catch (e) {}
    }
  };

  window.__clock = {
    // Run every timer due up to `to` (in order), then one animation frame at `to`.
    advance(to) {
      for (;;) {
        let due = null;
        for (const [id, x] of timers) if (x.t <= to && (!due || x.t < due[1].t)) due = [id, x];
        if (!due) break;
        const [id, x] = due;
        now = Math.max(now, x.t);
        if (x.every) x.t += x.every; else timers.delete(id);
        try { if (typeof x.fn === "function") x.fn(...x.args); } catch (e) { console.error(e); }
      }
      now = Math.max(now, to);
      const callbacks = [...frames.values()];
      frames.clear();
      for (const fn of callbacks) { try { fn(now); } catch (e) { console.error(e); } }
      syncCss();
    },
    syncCss,
    get now() { return now; }
  };
})();
