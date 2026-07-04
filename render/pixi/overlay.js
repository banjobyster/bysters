// Boots a full-page transparent Pixi canvas that ignores pointer events.
// Interaction with the robot happens via document-level listeners.

import { Application } from 'pixi.js';

export async function createOverlay() {
  const app = new Application();
  await app.init({
    resizeTo: window,
    backgroundAlpha: 0,
    preserveDrawingBuffer: true,
    antialias: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
  });
  // Assign properties individually: overwriting style.cssText would wipe the
  // width/height styles Pixi's autoDensity resize sets, leaving the canvas
  // displayed at raw buffer size until the next resize event.
  Object.assign(app.canvas.style, {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    zIndex: '10',
  });
  document.body.appendChild(app.canvas);
  return app;
}
