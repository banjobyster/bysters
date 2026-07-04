// The Stage: the cast + the shared world. Each frame it builds one read-only
// World snapshot and steps every byster against it. This is the only place that
// knows the whole cast; the bysters themselves only ever see the world snapshot,
// so interaction stays decentralized.

import { buildWorld, makeNav } from './world.js';

export class Stage {
  constructor(graph, { store = null } = {}) {
    this.graph = graph;
    this.nav = graph ? makeNav(graph) : null;
    this.bysters = [];
    this.cursor = null;
    this.store = store; // the fixture store (null if the page declares no fixtures)
  }

  add(byster) {
    this.bysters.push(byster);
    return byster;
  }

  named(name) {
    return this.bysters.find((b) => b.name === name) || null;
  }

  setGraph(graph) {
    this.graph = graph;
    this.nav = makeNav(graph);
  }

  setCursor(cursor) {
    this.cursor = cursor;
  }

  step(dt) {
    const world = buildWorld({ agents: this.bysters, cursor: this.cursor, graph: this.graph, nav: this.nav, store: this.store, dt });
    for (const b of this.bysters) b.step(world, dt, this.store);
    return world;
  }
}
