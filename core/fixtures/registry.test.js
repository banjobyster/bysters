// FX-6 (TDD 13.4 / 9.5): a fixture type may register a default agent behavior;
// a single element overrides it with data-byster-behavior. Adding a new type is
// register-a-default, and existing bysters pick it up with no edits.

import { describe, it, expect, beforeEach } from 'vitest';
import { registerFixtureType, resolveFixtureBehavior, clearFixtureTypes } from './registry.js';
import { makeFixture } from './fixture.js';

describe('FX-6: default vs override behavior resolution', () => {
  beforeEach(clearFixtureTypes);

  it('a fixture of a registered type gets the type default reaction', () => {
    registerFixtureType('rack', 'operate-rack');
    expect(resolveFixtureBehavior(makeFixture({ id: 'a', type: 'rack', states: ['x', 'y'] }))).toBe('operate-rack');
  });

  it('a per-element override (data-byster-behavior) wins over the type default', () => {
    registerFixtureType('rack', 'operate-rack');
    const fx = makeFixture({ id: 'b', type: 'rack', states: ['x', 'y'], bysterBehavior: 'special' });
    expect(resolveFixtureBehavior(fx)).toBe('special');
  });

  it('an unregistered type with no override resolves to null (no default reaction)', () => {
    expect(resolveFixtureBehavior(makeFixture({ id: 'c', type: 'unknown', states: ['x', 'y'] }))).toBe(null);
  });
});
