/**
 * @kc/core — the shared, deterministic heart of Kangaroo Chase.
 *
 * Everything in this package runs identically on the server (authority) and on every client
 * (prediction). It never imports a renderer, the DOM, or a network transport.
 */
export * from './math/index.js';
export * from './util/index.js';
export * from './physics/index.js';
export * from './world/index.js';
export * from './input/index.js';
export * from './player/index.js';
export * from './modes/index.js';
export * from './sim/index.js';
