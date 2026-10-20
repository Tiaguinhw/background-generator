(function (PB) {
  "use strict";

  const { hash } = PB.random;
  const { buildLevels, packRgb } = PB.palette;

  const EMPTY = -1;
  const SMOOTH_LUT_SIZE = 1024;

  function bayerMatrix(n) {
    let m = [[0]];
    while (m.length < n) {
      const size = m.length;
      const next = [];
      for (let y = 0; y < size * 2; y++) {
        next.push(new Array(size * 2));
      }
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const v = m[y][x] * 4;
          next[y][x] = v;
          next[y][x + size] = v + 2;
          next[y + size][x] = v + 3;
          next[y + size][x + size] = v + 1;
        }
      }
      m = next;
    }
    const total = n * n;
    return m.map((row) => row.map((v) => (v + 0.5) / total));
  }

  const BAYER = {
    bayer2: bayerMatrix(2),
    bayer4: bayerMatrix(4),
    bayer8: bayerMatrix(8),
  };

  function stopsOf(cfg) {
    return [cfg.primary, ...(cfg.extras || []), cfg.secondary];
  }

  function resolveAngle(cfg) {
    if (cfg.direction === "random") return Math.floor(hash(7, 13, cfg.seed, 99) * 360);
    if (cfg.direction === "custom") return Number(cfg.angle) || 0;
    return Number(cfg.direction) || 0;
  }

  // Builds a function (px, py) -> t in [0, 1] for the configured gradient.
  function gradientField(cfg, angle) {
    const W = cfg.width;
    const H = cfg.height;

    if (cfg.gradientType === "radial") {
      const cx = (cfg.centerX / 100) * W;
      const cy = (cfg.centerY / 100) * H;
      const maxD = Math.max(
        Math.hypot(cx, cy),
        Math.hypot(W - cx, cy),
        Math.hypot(cx, H - cy),
        Math.hypot(W - cx, H - cy)
      ) || 1;
      return (px, py) => Math.hypot(px - cx, py - cy) / maxD;
    }

    // Projected in normalized space so 45° always runs corner to corner, whatever the aspect ratio.
    const rad = (angle * Math.PI) / 180;
    const dx = Math.cos(rad) / W;
    const dy = Math.sin(rad) / H;
    const proj = [0, W * dx, H * dy, W * dx + H * dy];
    const min = Math.min(...proj);
    const range = Math.max(...proj) - min || 1;
    return (px, py) => (px * dx + py * dy - min) / range;
  }

  function shapeT(t, exponent, repeat) {
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    if (exponent !== 1) t = Math.pow(t, exponent);
    if (repeat > 1) {
      const s = Math.min(t * repeat, repeat - 1e-9);
      const i = Math.floor(s);
      const f = s - i;
      t = i % 2 === 0 ? f : 1 - f;
    }
    return t;
  }

  /**
   * Computes the color of every grid cell.
   * Returns packed 0xRRGGBB values, or EMPTY (-1) for cells left blank.
   */
  function buildCells(cfg) {
    const cs = Math.max(1, Math.round(cfg.cellSize));
    const cols = Math.ceil(cfg.width / cs);
    const rows = Math.ceil(cfg.height / cs);
    const seed = cfg.seed | 0;
    const angle = resolveAngle(cfg);
    const field = gradientField(cfg, angle);
    const exponent = Math.pow(4, -cfg.bias / 100);
    const repeat = Math.max(1, cfg.repeat | 0);

    const stops = stopsOf(cfg);
    const levels = cfg.levels | 0;
    const banded = levels >= 2;
    const palette = banded ? buildLevels(stops, levels) : buildLevels(stops, SMOOTH_LUT_SIZE);

    const matrix = banded ? BAYER[cfg.ditherType] : null;
    const matrixSize = matrix ? matrix.length : 0;
    const useRandom = banded && cfg.ditherType === "random";
    const ditherAmount = banded && cfg.ditherType !== "none" ? cfg.ditherAmount / 100 : 0;

    const grain = (cfg.grain / 100) * 70;
    const density = cfg.density / 100;

    const data = new Int32Array(cols * rows);

    for (let cy = 0; cy < rows; cy++) {
      const py = Math.min((cy + 0.5) * cs, cfg.height);
      for (let cx = 0; cx < cols; cx++) {
        const i = cy * cols + cx;

        if (density < 1 && hash(cx, cy, seed, 3) >= density) {
          data[i] = EMPTY;
          continue;
        }

        const px = Math.min((cx + 0.5) * cs, cfg.width);
        const t = shapeT(field(px, py), exponent, repeat);

        let color;
        if (banded) {
          let threshold = 0.5;
          if (matrix) threshold = matrix[cy % matrixSize][cx % matrixSize];
          else if (useRandom) threshold = hash(cx, cy, seed, 1);
          let idx = Math.floor(t * levels + (threshold - 0.5) * ditherAmount);
          if (idx < 0) idx = 0;
          else if (idx >= levels) idx = levels - 1;
          color = palette[idx];
        } else {
          color = palette[Math.min(SMOOTH_LUT_SIZE - 1, Math.floor(t * SMOOTH_LUT_SIZE))];
        }

        if (grain > 0) {
          const g = (hash(cx, cy, seed, 2) - 0.5) * grain;
          color = packRgb(((color >> 16) & 255) + g, ((color >> 8) & 255) + g, (color & 255) + g);
        }

        data[i] = color;
      }
    }

    return { cols, rows, cellSize: cs, data, angle };
  }

  // Swatches shown in the sidebar: the actual levels, or a sampled preview when smooth.
  function previewPalette(cfg) {
    const count = cfg.levels >= 2 ? cfg.levels | 0 : 24;
    return Array.from(buildLevels(stopsOf(cfg), count));
  }

  PB.generator = { buildCells, previewPalette, resolveAngle, stopsOf, EMPTY };
})((window.PB = window.PB || {}));
