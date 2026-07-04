# bysters

**Small procedurally-animated creatures that live on your web page.** They treat
your real layout as physical terrain, walk it from any angle, sense the cursor and
each other, and operate stateful elements on the page. One import, a list of
behaviours, and the page starts playing itself.

**[Live demo](https://banjobyster.github.io/bysters/)** (scroll down, and hover the
little bots)

```js
import { mount, behaviors } from 'bysters'
const { wander, followCursor, flee } = behaviors

await mount({
  terrain: '[data-walk]',                 // elements they can stand and climb on
  bysters: [
    { name: 'pip',  character: Pip,  behaviors: [followCursor(), wander()] },
    { name: 'byte', character: Byte, behaviors: [flee(v => v.name === 'pip'), wander()] },
  ],
})
```

That is the whole setup. Mark a few elements with `data-walk`, hand `mount()` your
cast, and they wake up.

## What it is

A byster is a **character** (its look and tuning) plus a **mind**: a short, ordered
stack of small, composable behaviours. Each frame a byster:

1. senses a read-only snapshot of the world (the cursor, the other bysters and their
   advertised state, the walkable graph), then
2. every behaviour bids **per channel** (locomotion, gaze, face, pace, appearance,
   interact), and the highest-priority bid wins each channel independently, so gaze,
   face and movement can be driven by three different behaviours at once, then
3. a motor executes the winning intents and smooths them into motion.

The framework is **value-neutral**: it has no notion of good or bad, fix or fail,
hero or villain. All of that meaning lives in your config and your CSS. The demo's
"green is fixed, red is broken" is entirely CSS on the consumer side; the framework
only ever moves opaque state between opaque states.

## Install

```sh
npm install bysters pixi.js
```

`pixi.js` (v8) is a peer dependency: bysters renders through it.

## Core ideas

### The DOM is the terrain

Mark anything walkable with `data-walk`. A plain `data-walk` is a top surface; opt
into other faces with `data-walk="top bottom left right"` and a byster will scale the
walls and hang under the undersides. bysters compiles those rectangles into a surface
graph with two movement primitives, a **walk** (along a surface or around a shared
corner) and a single **ballistic arc** (every hop, drop and leap is the same jump
under gravity). It re-plans the whole graph when the layout changes.

```html
<div data-walk style="...">a floor</div>
<div data-walk="top bottom left right" style="...">a box they circle</div>
```

### Behaviours compose

A personality is just a list. The built-in library (`import { behaviors }` or
`import { ... } from 'bysters/behaviors'`) includes:

| behaviour | what it does |
| --- | --- |
| `wander()` | amble to a random reachable spot |
| `followCursor()` / `fleeCursor({ alpha })` | seek or bolt from the pointer (bolt can turn glassy) |
| `watchCursor()` / `watchNearest()` / `avoidCursorGaze()` | where it looks |
| `approach(pred)` / `flee(pred)` | chase or run from a matching byster (route-aware) |
| `caughtBy(pred)` / `reactTo(pred)` | freeze when caught, or react to another's state |
| `operateFixtures({ match, drive })` | drive a stateful element toward a target state |
| `perch()` / `sleep()` / `mood()` / `flourish()` / `liveliness()` | idle life |
| `fatigue(inner)` / `sometimes(inner)` | higher-order wrappers around any behaviour |

Behaviours are **pure**: given the world and themselves, they return intents. They
never touch each other. Adding a byster edits no other byster.

### Bysters sense each other

Interaction is decentralised. A byster reacts to the others from its own behaviour
code, through `world.bysters` and each other's read-only `view()`
(`{ name, x, bodyY, surface, state, caps, tags }`). A byster can **broadcast tags**
that others sense, so "the cop is tired" or "the imp is caught" is just a string one
byster advertises and another reads:

```js
// the imp only fears the cop while the cop is not resting
flee(v => v.name === 'cop' && !v.tags.has('winded'))
```

### Fixtures: value-neutral stateful elements

Mark stateful elements with `data-fixture` and give them opaque states. A byster's
`operateFixtures` behaviour routes to one and transitions it through a guarded store.
Mirror the same behaviour with opposite config and you get a rivalry (one drives
things to `broken`, another to `fixed`) with no special-cased "saboteur" or "repairer"
type anywhere in the code. The store mirrors state onto `data-state` for your CSS.

## API

```js
import { mount, behaviors } from 'bysters'
```

### `mount(config) -> handle`

All keys optional except that each byster needs a `character`.

| key | meaning |
| --- | --- |
| `terrain` | selector for walkable elements (default `'[data-walk]'`) |
| `fixtures` | selector for fixtures, or `false` to disable (default `'[data-fixture]'`) |
| `ground` | synthesize a viewport-bottom floor (default `true`; `false` for tall multi-scene pages that bring their own floors) |
| `shadow` | draw the ground shadow under each byster (default `true`) |
| `bysters` | `[{ name, character, caps?, behaviors?, planner?, spawn? (ground fraction) or spawnAt? (selector), speedScale?, alpha?, tint?, shadow? }]` |
| `onFrame(frame)` | per-frame hook for consumer-drawn extras (a plug cable, an overlay) |
| `onPointerDown(worldPoint, event, handle)` | pointer hook |
| `space` | injected coordinate provider (default `DocumentSpace`; inject a `FixedSpace` for headless/deterministic runs) |

The handle exposes `stage`, `store`, `graph`, `cast`, `byName(name)`, `goto(name, el)`,
`on(event, cb)`, `step(seconds)` (deterministic stepping for tests) and `unmount()`.
Under `prefers-reduced-motion` or without WebGL, `mount()` resolves to a degraded
no-op handle and leaves the page untouched, so callers never have to branch.

### Bring your own character

A character is plain data: params (size, gait, springs), a palette, a pixel-face
definition, and `buildBody`/`buildHead` draw functions. The demo ships four
(a toddler, a glitch imp, a sergeant, a drifter); none of them import anything, so
they are easy to copy and retune. Use `caps: { maxLaunch, gravity }` to make one
byster leap harder or floatier than the rest.

## Develop

```sh
npm install
npm run dev        # the demo at /demo, on a dev server
npm test           # the pure core, headless under vitest
npm run build      # build the demo to ./dist
```

The pure core (`core/`) imports no `document`, `window` or Pixi, so it runs and is
tested entirely headless. DOM access lives only in `dom/`, Pixi only in `render/`.

## License

MIT. Creativity by [banjobyster](https://github.com/banjobyster).
