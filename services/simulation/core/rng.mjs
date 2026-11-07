/**
 * VORQYN lane-2 simulation kernel — seeded deterministic PRNG.
 *
 * Scope: VQ-08-PREP (#20) only. Pure, dependency-free, platform-stable.
 *
 * Determinism contract:
 * - No Math.random(), no Date.now(), no crypto, no network, no globals.
 * - All randomness is derived from an explicit unsigned 32-bit integer seed
 *   via SplitMix32 (integer-only arithmetic: Math.imul + unsigned shifts).
 * - Only operations with engine-independent IEEE-754 results are used
 *   (integer ops, +, -, *, /, Math.floor), so identical seed + call order
 *   yields identical streams on any conformant engine.
 *
 * This module is internal to services/simulation/core and is NOT part of any
 * shared contract; the VQ-01 (#2) contracts own all public mission types.
 */

/**
 * Mix a base seed with any number of unsigned 32-bit integer streams keys.
 * Used to give each robot/sensor/sample an independent reproducible noise
 * stream so that changing sample frequency or robot order cannot silently
 * shift another sensor's noise sequence.
 *
 * @param {number} baseSeed unsigned 32-bit integer
 * @param {...number} streamKeys unsigned 32-bit integers
 * @returns {number} mixed unsigned 32-bit seed
 */
export function deriveSeed(baseSeed, ...streamKeys) {
  let mixed = toUint32(baseSeed);
  for (let i = 0; i < streamKeys.length; i += 1) {
    mixed = splitMix32Round(mixed ^ toUint32(streamKeys[i]));
  }
  return splitMix32Round(mixed);
}

/**
 * Create a deterministic [0,1) float generator from a 32-bit seed.
 *
 * @param {number} seed unsigned 32-bit integer
 * @returns {() => number} next() returning floats in [0, 1)
 */
export function createRng(seed) {
  let state = toUint32(seed);
  return function next() {
    state = splitMix32Round(state);
    return state / 4294967296; // exact: state is a uint32, denominator 2^32
  };
}

/**
 * Create a deterministic noise generator producing symmetric values in
 * [-1, 1). Observation code multiplies by a per-sensor fixture amplitude.
 *
 * @param {number} seed unsigned 32-bit integer
 * @returns {() => number} next() returning floats in [-1, 1)
 */
export function createSymmetricNoise(seed) {
  const next = createRng(seed);
  return function nextSigned() {
    return next() * 2 - 1; // in [-1, 1); exact linear map of a uint32 stream
  };
}

function splitMix32Round(x) {
  // Internal intermediates may be signed (Math.imul, XOR); >>> 0 coerces
  // them to the unsigned 32-bit domain without validation.
  let z = (x + 0x9e3779b9) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
  z = (z ^ (z >>> 15)) >>> 0;
  return z;
}

function toUint32(value) {
  if (!Number.isFinite(value) || value < 0 || value > 4294967295) {
    throw new RangeError(`seed value must be an unsigned 32-bit integer, got ${value}`);
  }
  return value >>> 0;
}
