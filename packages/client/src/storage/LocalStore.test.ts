import { describe, expect, it } from 'vitest';
import { sessionKeyFor } from './LocalStore.js';

describe('where a session is kept', () => {
  it("keeps the page's own server on the key every signed-in player already has", () => {
    // Changing it would sign out everybody on the web build the day this shipped.
    expect(sessionKeyFor(null)).toBe('kc.session.v1');
  });

  it("keeps each other server's token apart, so neither is handed the other's", () => {
    const hosted = sessionKeyFor('https://play.kangaroo.example');
    expect(hosted).not.toBe(sessionKeyFor(null));
    expect(hosted).not.toBe(sessionKeyFor('https://staging.kangaroo.example'));
  });
});
