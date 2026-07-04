// The bysters landing, wired live. The page IS the demo: a scene-locked cast on
// the real mount() engine. Each byster is seated in its own scene (spawnAt its
// floor) and, because the scenes sit far enough apart that their terrain forms
// disconnected graph clusters, it physically cannot wander out of its act:
//
//   HERO   Pip crosses to fix a broken beacon (a gremlin re-breaks it, so he
//          keeps working). He notices the cursor.
//   SCENE 2  Byte wrecks a relay; Sarge chases it off in tiring bursts; Byte
//          flees only Sarge. Small vs big: Byte takes routes Sarge cannot.
//   SCENE 3  Winnow lives on the feature cards below, treating them as terrain:
//          she walks their tops, scales their walls and hangs beneath them,
//          drifting on low gravity and shying away from the cursor.
//
// Every personality is just a list of generic library behaviors + tuning; the
// framework knows nothing of good/bad/fix/break. All that meaning is device CSS
// (green = fixed, red = broken) and the consumer config below.

import { mount, behaviors, LAUNCH, LAUNCH_AGILE, reachableVertexIds, nearestVertex } from 'bysters';
import { Graphics } from 'pixi.js';
import { CRT_TODDLER } from './characters/crt-toddler.js';
import { GLITCH_IMP } from './characters/glitch-imp.js';
import { SARGE } from './characters/sarge.js';
import { WINNOW } from './characters/winnow.js';
import './main.css';

const {
  operateFixtures, followCursor, wander, watchCursor, watchNearest,
  approach, flee, caughtBy, reactTo, perch, fatigue, avoidCursorGaze, fleeCursor, liveliness, mood, flourish,
} = behaviors;

const SARGE_CAPS = { maxLaunch: 770, gravity: 2400 }; // heavier than the imp, lighter than nothing
const MOON = { maxLaunch: 900, gravity: 780 }; // low gravity: big, slow, floaty leaps (scene 3 shows off custom physics)
const DERATE = 0.72; // scene-wide cruise derate so nobody blurs on screen

const CAST = [
  {
    name: 'pip',
    character: CRT_TODDLER,
    caps: LAUNCH,
    speedScale: DERATE,
    spawnAt: '#hero-floor',
    behaviors: [
      operateFixtures({ match: (fx) => fx.type === 'herodev' && fx.state === 'broken', drive: 'fixed', face: 'happy' }),
      followCursor({ face: 'happy' }),
      wander(),
      watchCursor(),
      flourish(['happy', 'excited'], { every: 6 }),
      liveliness({ base: DERATE, vary: 0.16, every: 3 }), // easy, gentle strides
      mood('idle'),
    ],
  },
  {
    name: 'sarge',
    character: SARGE,
    caps: SARGE_CAPS,
    speedScale: DERATE,
    spawnAt: '#s2-floor',
    behaviors: [
      // Chase Byte, but ignore him once he is caught (tagged), so Sarge lets go
      // instead of pinning a stunned imp forever. Resting broadcasts 'winded', so
      // Byte can tell when the cop is spent.
      fatigue(approach((v) => v.name === 'byte' && !v.tags.has('caught'), { notice: 520, face: 'alert' }), { runFor: 4, restFor: 3, face: 'winded', tag: 'winded' }),
      // When he does catch Byte, don't freeze on the spot (they jam up): saunter
      // slowly and pleased near the frozen imp, glancing back at his catch, while
      // wander keeps him ambling. The catch reads from Sarge's side too.
      reactTo((v) => v.name === 'byte', { tag: 'caught', radius: 200, face: 'happy', pace: 0.55, gaze: true }),
      perch({ every: 16, dwell: 4, face: 'content', priority: 50 }),
      wander(),
      watchCursor(),
      liveliness({ base: DERATE, vary: 0.1, every: 3.6 }), // deliberate, steady on patrol
      mood('idle'),
    ],
  },
  {
    name: 'byte',
    character: GLITCH_IMP,
    caps: LAUNCH_AGILE,
    speedScale: DERATE,
    spawnAt: '#s2-floor',
    behaviors: [
      // Only a cop who is NOT winded can scare or catch him: when Sarge is resting,
      // Byte drops his guard and struts around (until Sarge springs back up).
      caughtBy((v) => v.name === 'sarge' && !v.tags.has('winded'), { radius: 56, stunFor: 2.4, immuneFor: 1.4, face: 'panic' }),
      flee((v) => v.name === 'sarge' && !v.tags.has('winded'), { radius: 210 }),
      operateFixtures({ match: (fx) => fx.type === 's2dev' && fx.state !== 'broken', drive: 'broken', face: 'mischief' }),
      perch({ every: 12, dwell: 3, face: 'mischief', priority: 40 }),
      wander(),
      watchNearest(),
      liveliness({ base: DERATE, vary: 0.42, every: 1.3 }), // twitchy, darts and dawdles
      mood('mischief'),
    ],
  },
  {
    // scene 3 IS the features section: Winnow spawns on the recap cards and
    // treats them as terrain. Low gravity (MOON) turns her hops between cards
    // into big, slow, floaty leaps, a visibly different bot, and she walks the
    // card tops, scales their walls and hangs under them: any-angle traversal
    // shown on real content.
    name: 'winnow',
    character: WINNOW,
    caps: MOON,
    speedScale: DERATE,
    spawnAt: '.card.c1',
    alpha: 0.55,
    behaviors: [
      fleeCursor({ radius: 250, face: 'lookaway', speed: 1.7, alpha: 0.12 }), // reading a card? she bolts off it, FAST, turning glassy while startled
      perch({ every: 6, dwell: 3, face: 'peek', priority: 60 }), // pause and take a card in
      avoidCursorGaze(),
      wander(),
      flourish(['peek', 'dream'], { every: 5 }),
      liveliness({ base: DERATE, vary: 0.26, every: 4.4 }), // languid, long lazy swells
      mood('idle'),
    ],
  },
];

// Consumer-drawn interaction visual: a cable from a plugged byster to its
// fixture, tinted by who. The framework only reports it is plugged; the look is ours.
const CABLE_COLOR = { pip: 0x7de88a, sarge: 0xd6a24a, byte: 0xff9a3c, winnow: 0x8fded0 };
let gCable = null;
function drawCables({ app, cast, store }) {
  if (!store) return;
  if (!gCable) {
    gCable = new Graphics();
    app.stage.addChildAt(gCable, 0);
  }
  gCable.clear();
  for (const m of cast) {
    const act = m.byster && m.byster.actuator;
    if (!act || !act.plugged || act.fixtureId == null) continue;
    const fx = store.fixture(act.fixtureId);
    if (!fx) continue;
    const cx = m.mover.x;
    const cy = m.mover.bodyY;
    const mx = (cx + fx.x) / 2;
    const my = Math.max(cy, fx.y) + 14;
    const color = CABLE_COLOR[m.name] || 0xffffff;
    gCable.moveTo(cx, cy);
    gCable.quadraticCurveTo(mx, my, fx.x, fx.y); // a simple curved cable, drawn with Pixi's own bezier
    gCable.stroke({ width: 2, color, alpha: 0.85 });
    gCable.circle(fx.x, fx.y, 3).fill({ color, alpha: 0.9 });
  }
}

// ?debug draws the nav graph each byster reasons over, seeded from where each
// byster actually stands: surfaces are green if reachable by its owner, red if
// stranded, plus the jump arcs. The fastest way to see WHY a ledge is or is not
// reachable, per scene, with no dependence on a floor-class convention.
let debugOn = typeof location !== 'undefined' && new URLSearchParams(location.search).has('debug');
let gDebug = null;
let dbgTick = 0;

// The debug window: a live table of every bot and which behaviour is currently
// driving each of its channels (read straight off the arbiter), plus its body
// state. Toggled by the bug button; pairs with the nav-graph overlay.
function updateDebugPanel(cast) {
  const body = document.querySelector('#dbg-panel .dbg-body');
  if (!body) return;
  body.innerHTML = cast
    .map((m) => {
      const own = (m.byster && m.byster.arbiter && m.byster.arbiter.owner) || {};
      const mv = m.mover;
      const tags = [...(m.byster ? m.byster.tags : [])].join(', ') || 'none';
      return `<div class="dbg-row"><b>${m.name}</b> ${mv.state} · surf ${mv.surface} · pace ${mv.pace.toFixed(2)} · α ${Math.round(mv.alpha * 100)}%<br><span class="dbg-dim">tags: ${tags} · loco:${own.locomotion || '-'} face:${own.face || '-'} gaze:${own.gaze || '-'}</span></div>`;
    })
    .join('');
}

function drawDebug({ app, graph, cast }) {
  if (!graph) return;
  if (!gDebug) {
    gDebug = new Graphics();
    app.stage.addChild(gDebug);
  }
  gDebug.clear();
  const seeds = [];
  for (const m of cast) {
    const v = nearestVertex(graph, m.mover.x, m.mover.bodyY);
    if (v) seeds.push(v.id);
  }
  const reach = reachableVertexIds(graph, seeds, LAUNCH_AGILE);
  for (const [aId, edges] of graph.adj) {
    const a = graph.vertices[aId];
    for (const e of edges) {
      if (e.type !== 'jump') continue;
      // draw the arc the byster will fly, from the jump edge's public launch data
      // (standard projectile motion: pos = start + v*t + 0.5*g*t^2)
      const L = e.launch;
      gDebug.moveTo(a.x, a.y);
      for (let i = 1; i <= 12; i++) {
        const t = (L.t * i) / 12;
        gDebug.lineTo(a.x + L.vx * t, a.y + L.vy * t + 0.5 * L.g * t * t);
      }
      gDebug.stroke({ width: 1, color: 0xe0a83c, alpha: 0.25 });
    }
  }
  for (let si = 0; si < graph.surfaces.length; si++) {
    const s = graph.surfaces[si];
    const ok = graph.vertices.some((v) => v.surface === si && reach.has(v.id));
    gDebug.moveTo(s.a.x, s.a.y).lineTo(s.b.x, s.b.y).stroke({ width: 3, color: ok ? 0x3ddc97 : 0xff5d5d, alpha: 0.9 });
  }
  for (const v of graph.vertices) gDebug.circle(v.x, v.y, 2).fill({ color: reach.has(v.id) ? 0x3ddc97 : 0xff5d5d, alpha: 0.7 });
}

// The small nudges that tell you what a click does, kept in sync with the store
// so they read the CURRENT actionable state (and re-attach across a rebuild).
function wirePrompts(handle) {
  const update = () => {
    const store = handle.store;
    if (!store) return;
    const hero = store.fixture('hero-dev');
    const s2 = store.fixture('s2-dev');
    const hp = document.getElementById('hero-prompt');
    const sp = document.getElementById('s2-prompt');
    if (hp && hero) hp.textContent = hero.state === 'fixed' ? 'click to switch off' : 'watch it come back';
    if (sp && s2) sp.textContent = s2.state === 'broken' ? 'click to turn it blue' : 'now watch them go';
  };
  const attach = () => {
    if (handle.store) handle.store.subscribe(update);
    update();
  };
  attach();
  handle.on('rebuild', attach);
}

// The bug button toggles the debug window (and the nav-graph overlay) at runtime,
// so there is no need to reload the page with ?debug.
function wireDebug() {
  const btn = document.getElementById('debug-toggle');
  const panel = document.getElementById('dbg-panel');
  if (!btn || !panel) return;
  const apply = () => {
    btn.setAttribute('aria-pressed', String(debugOn));
    panel.hidden = !debugOn;
    if (!debugOn && gDebug) gDebug.clear();
  };
  btn.addEventListener('click', () => {
    debugOn = !debugOn;
    apply();
  });
  apply();
}

async function main() {
  const handle = await mount({
    bysters: CAST,
    terrain: '[data-walk]',
    fixtures: '[data-fixture]',
    ground: false, // tall multi-scene page: each scene brings its own floor
    shadow: false, // a ground shadow reads wrong on walls/undersides here; drop it
    onFrame: (f) => {
      drawCables(f);
      if (debugOn) {
        drawDebug(f);
        if (dbgTick++ % 6 === 0) updateDebugPanel(f.cast); // ~10fps panel refresh
      } else if (gDebug) {
        gDebug.clear();
      }
    },
    debug: debugOn,
  });
  if (handle.degraded) return;

  // A human can operate the devices too: click one to flip it through the SAME
  // guarded store the bysters use, so a byster may immediately react.
  for (const el of document.querySelectorAll('[data-fixture]')) {
    el.addEventListener('click', () => {
      const store = handle.store;
      const id = el.dataset.fixtureId || el.id;
      const fx = store && store.fixture(id);
      if (!fx) return;
      const options = fx.states.filter((s) => s !== fx.state && store.canTransition(id, s));
      if (options.length) store.transition(id, options[Math.floor(Math.random() * options.length)], 'you');
    });
  }

  wirePrompts(handle);
  wireDebug();
  window.__playground = handle;
}

main();
