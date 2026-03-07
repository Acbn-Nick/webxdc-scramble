// rng.js - Seeded xorshift32 PRNG and deterministic shuffle

export function createRng(seed) {
  var s = seed | 0;
  if (s === 0) s = 1;
  return {
    next: function () {
      s ^= s << 13;
      s ^= s >>> 17;
      s ^= s << 5;
      return s >>> 0;
    },
    getState: function () { return s; },
  };
}

export function seededShuffle(array, rng) {
  for (var i = array.length - 1; i > 0; i--) {
    var j = rng.next() % (i + 1);
    var t = array[i];
    array[i] = array[j];
    array[j] = t;
  }
  return array;
}
