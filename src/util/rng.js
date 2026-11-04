// Gerador pseudo-aleatório determinístico (mulberry32) — o mundo é fixo entre partidas.
export function createRng(seed) {
  let a = (seed >>> 0) || 1;
  const rng = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (min, max) => min + (max - min) * rng();
  rng.int = (min, maxInclusive) => Math.floor(rng.range(min, maxInclusive + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];
  rng.sign = () => (rng() < 0.5 ? -1 : 1);
  rng.gauss = () => { // aproximação de distribuição normal (média 0, desvio ~1)
    let s = 0; for (let i = 0; i < 6; i++) s += rng(); return (s - 3) * 1.414;
  };
  return rng;
}

export function hashInt(x, y = 0, z = 0) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
