// Space: the injected coordinate and scroll provider (TDD Section 5).
//
// The pure core never touches `window` or `getBoundingClientRect`; it consumes
// a Space snapshot instead. This is the single seam that lets the same
// simulation run in a normal page, an iframe, a nested scroller (a future
// ScrollerSpace), or a headless test (FixedSpace with scripted scroll).
//
// A snapshot (the object `read()` returns) is a consistent view for one frame:
// every scroll read and every `rectOf` within a frame agree, even if the page
// scrolls between frames.
//
//   snapshot = {
//     scrollX, scrollY, viewportW, viewportH, dpr,
//     docToWorld(x, y) -> { x, y },   // identity for the default page space
//     worldToDoc(x, y) -> { x, y },
//     rectOf(el)       -> { x, y, w, h }   // element rect in WORLD coordinates
//   }
//
// "World coordinates" here are document coordinates: robot logic runs in
// document space and the renderer offsets its container by -scroll each frame
// (see mount-dom / the portfolio facade). So docToWorld is the identity and
// rectOf returns document-space rects, exactly what the old inline
// `getBoundingClientRect() + scrollX/Y` produced.

const identity = (x, y) => ({ x, y });

// The default page space: today's behavior, one window scroll, document coords.
export class DocumentSpace {
  read() {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    return {
      scrollX,
      scrollY,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      dpr: window.devicePixelRatio || 1,
      docToWorld: identity,
      worldToDoc: identity,
      // Snapshot semantics: close over the scroll captured at read() time so a
      // frame's rects never mix scroll values with its scalar reads.
      rectOf(el) {
        const r = el.getBoundingClientRect();
        return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height };
      },
    };
  }
}

// A deterministic Space for headless tests and offscreen stepping. Scroll is
// scripted (setScroll), the viewport is fixed, and rectOf resolves rects the
// test registered against opaque element keys, so the whole simulation runs
// with no real DOM. This is what makes the acceptance spec's "given a
// FixedSpace, the sim is deterministic" invariant (PE-6, DI-2) hold.
export class FixedSpace {
  constructor({
    scrollX = 0,
    scrollY = 0,
    viewportW = 1280,
    viewportH = 800,
    dpr = 1,
    rects = new Map(),
  } = {}) {
    this.scrollX = scrollX;
    this.scrollY = scrollY;
    this.viewportW = viewportW;
    this.viewportH = viewportH;
    this.dpr = dpr;
    // rects: Map<elKey, { x, y, w, h }> in WORLD (document) coordinates, or a
    // plain object; either works.
    this.rects = rects instanceof Map ? rects : new Map(Object.entries(rects));
  }

  setScroll(x, y) {
    this.scrollX = x;
    this.scrollY = y;
    return this;
  }

  setRect(el, rect) {
    this.rects.set(el, rect);
    return this;
  }

  read() {
    const rects = this.rects;
    return {
      scrollX: this.scrollX,
      scrollY: this.scrollY,
      viewportW: this.viewportW,
      viewportH: this.viewportH,
      dpr: this.dpr,
      docToWorld: identity,
      worldToDoc: identity,
      rectOf(el) {
        return rects.get(el) || null;
      },
    };
  }
}
