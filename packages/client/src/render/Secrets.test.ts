import { describe, expect, it } from 'vitest';
import { buildLevel } from '@kc/core';
import { SecretsView } from './Secrets.js';

describe('SecretsView', () => {
  it('draws every boomerang the player has not found, and hides one when it is found', () => {
    const level = buildLevel('jungle-world');
    const view = new SecretsView(level, null, new Set([`jungle-world:${level.secrets![0]!.id}`, 'glacier-world:boomerang-2']));
    expect(view.visibleCount).toBe(level.secrets!.length - 1);
    view.markFound(level.secrets![1]!.id);
    expect(view.visibleCount).toBe(level.secrets!.length - 2);
    // Without the model it is still drawn, as the fallback V.
    const node = view.group.children.find((c) => c.visible)!;
    expect(node.children.length).toBeGreaterThan(0);
    view.animate(1.3);
    expect(node.position.y).not.toBe(level.secrets![2]!.position.y + 999);
    view.dispose();
  });
});
