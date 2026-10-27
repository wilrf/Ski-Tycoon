/** A square height grid in metres, row-major, row 0 at the top (back) of the map. */
export interface HeightGrid {
  readonly size: number;
  readonly cellSize: number;
  readonly h: Float64Array;
}

const NEIGHBOURS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;

/**
 * Each cell's steepest downhill neighbour (itself when it has none), the distance to it in cells, and an order that
 * lists every cell after the cell it drains to. The order comes from walking the drainage tree up from its outlets,
 * which is linear time, where sorting by height would not be.
 */
function drainage({ size: n, h }: HeightGrid): { to: Int32Array; dist: Float64Array; order: Int32Array } {
  const to = new Int32Array(n * n), dist = new Float64Array(n * n).fill(1), donors = new Int32Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      let best = 0;
      to[i] = i;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        const d = dx && dy ? Math.SQRT2 : 1, s = (h[i]! - h[ny * n + nx]!) / d;
        if (s > best) { best = s; to[i] = ny * n + nx; dist[i] = d; }
      }
      if (to[i] !== i) donors[to[i]!]++;
    }
  // Donor lists in compressed form: the donors of cell r are list[start[r] .. start[r + 1]).
  const start = new Int32Array(n * n + 1);
  for (let i = 0; i < n * n; i++) start[i + 1] = start[i]! + donors[i]!;
  const fill = start.slice(0, n * n), list = new Int32Array(n * n);
  for (let i = 0; i < n * n; i++) if (to[i] !== i) list[fill[to[i]!]++] = i;
  const order = new Int32Array(n * n);
  let head = 0, tail = 0;
  for (let i = 0; i < n * n; i++) if (to[i] === i) order[tail++] = i;
  while (head < tail) {
    const r = order[head++]!;
    for (let k = start[r]!; k < start[r + 1]!; k++) order[tail++] = list[k]!;
  }
  return { to, dist, order };
}

/**
 * Stream-power incision, the standard model of how rivers carve mountains. Water runs to each cell's steepest
 * neighbour, so upslope area piles up downstream, and channels cut in proportion to sqrt(area) x slope. The result
 * is a branching drainage network with spurs left standing between the gullies.
 *
 * Each pass uses the implicit update (Braun & Willett 2013): cells are solved outlet-first, so every cell's
 * outlet is already updated, and h' = (h + F h_out) / (1 + F) can never overshoot, however strong the incision.
 */
export function incise(grid: HeightGrid, strength: number, passes: number): void {
  const h = grid.h;
  const area = new Float64Array(h.length);
  for (let pass = 0; pass < passes; pass++) {
    const { to, dist, order } = drainage(grid);
    area.fill(1);
    for (let k = order.length - 1; k >= 0; k--) {
      const i = order[k]!;
      if (to[i] !== i) area[to[i]!] += area[i]!;
    }
    for (const i of order) {
      const r = to[i]!;
      if (r === i) continue;
      const f = (strength / passes) * Math.sqrt(area[i]!) / dist[i]!;
      h[i] = (h[i]! + f * h[r]!) / (1 + f);
    }
  }
}

/**
 * Fills every closed hollow up to its spill point, plus a slight tilt toward the exit, so water can drain off the map
 * from any cell. Real land almost never holds pits; noise does. Priority-flood (Barnes et al. 2014): grow inward from
 * the map edge, always from the lowest cell reached so far, raising any cell that sits below where it was reached from.
 */
export function fillPits(grid: HeightGrid, tilt = 0.01): void {
  const { size: n, h } = grid;
  const done = new Uint8Array(n * n);
  // A binary min-heap of cell indices keyed on height.
  const heap: number[] = [];
  const less = (a: number, b: number): boolean => h[heap[a]!]! < h[heap[b]!]!;
  const swap = (a: number, b: number): void => { [heap[a], heap[b]] = [heap[b]!, heap[a]!]; };
  const push = (i: number): void => {
    heap.push(i);
    for (let k = heap.length - 1; k > 0 && less(k, (k - 1) >> 1); k = (k - 1) >> 1) swap(k, (k - 1) >> 1);
  };
  const pop = (): number => {
    const top = heap[0]!, last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && less(l, m)) m = l;
        if (r < heap.length && less(r, m)) m = r;
        if (m === k) break;
        swap(k, m);
        k = m;
      }
    }
    return top;
  };
  for (let i = 0; i < n * n; i++) {
    const x = i % n, y = Math.floor(i / n);
    if (x === 0 || y === 0 || x === n - 1 || y === n - 1) { done[i] = 1; push(i); }
  }
  while (heap.length) {
    const i = pop(), x = i % n, y = Math.floor(i / n);
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const j = ny * n + nx;
      if (done[j]) continue;
      done[j] = 1;
      h[j] = Math.max(h[j]!, h[i]! + tilt);
      push(j);
    }
  }
}

/** Soil creep: slopes relax toward their neighbours' average, rounding crests and filling hollows. */
export function soften(grid: HeightGrid, amount: number, passes: number): void {
  const { size: n, h } = grid;
  const next = new Float64Array(h.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const avg = (h[y * n + Math.max(0, x - 1)]! + h[y * n + Math.min(n - 1, x + 1)]! + h[Math.max(0, y - 1) * n + x]! + h[Math.min(n - 1, y + 1) * n + x]!) / 4;
        next[i] = h[i]! + amount * (avg - h[i]!);
      }
    h.set(next);
  }
}

/**
 * Rock slides: wherever ground stands steeper than `talusDeg` above a neighbour, part of the excess moves down.
 * All moves in a pass are computed first and applied together, over all 8 neighbours, so no direction is favoured.
 */
export function slide(grid: HeightGrid, talusDeg: number, passes: number): void {
  const { size: n, cellSize, h } = grid;
  const tan = Math.tan((talusDeg * Math.PI) / 180);
  const step = NEIGHBOURS.map(([dx, dy]) => dy * n + dx);
  const limit = NEIGHBOURS.map(([dx, dy]) => tan * cellSize * (dx && dy ? Math.SQRT2 : 1));
  const delta = new Float64Array(h.length);
  for (let pass = 0; pass < passes; pass++) {
    delta.fill(0);
    // Edge cells only receive; their missing neighbours would need bounds checks in the hot loop.
    for (let y = 1; y < n - 1; y++)
      for (let i = y * n + 1; i < y * n + n - 1; i++)
        for (let k = 0; k < 8; k++) {
          const j = i + step[k]!, excess = h[i]! - h[j]! - limit[k]!;
          // An eighth of the excess per neighbour keeps a cell from giving away more than it has.
          if (excess > 0) { delta[i] -= excess / 16; delta[j] += excess / 16; }
        }
    for (let i = 0; i < h.length; i++) h[i] += delta[i]!;
  }
}
