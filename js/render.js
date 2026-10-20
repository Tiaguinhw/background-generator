(function (PB) {
  "use strict";

  const { EMPTY } = PB.generator;
  const { packedToHex } = PB.palette;

  function geometry(cfg, cells) {
    const cs = cells.cellSize;
    const gap = Math.max(0, Math.min(Math.round(cfg.gap), cs - 1));
    const inner = cs - gap;
    const offset = Math.floor(gap / 2);
    const underAlpha = gap > 0 ? 1 - cfg.gridOpacity / 100 : 0;
    const radius = cfg.shape === "circle" ? inner / 2 : cfg.shape === "rounded" ? inner * 0.3 : 0;
    return { cs, gap, inner, offset, underAlpha, radius };
  }

  // Groups cells by color as horizontal runs [cx, cy, length].
  function collectRuns(cells, merge) {
    const { cols, rows, data } = cells;
    const groups = new Map();
    for (let cy = 0; cy < rows; cy++) {
      let cx = 0;
      while (cx < cols) {
        const color = data[cy * cols + cx];
        let len = 1;
        if (merge) {
          while (cx + len < cols && data[cy * cols + cx + len] === color) len++;
        }
        if (color !== EMPTY) {
          let list = groups.get(color);
          if (!list) groups.set(color, (list = []));
          list.push(cx, cy, len);
        }
        cx += len;
      }
    }
    return groups;
  }

  function roundedRectPath(ctx, x, y, w, h, r) {
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawToCanvas(canvas, cfg, cells) {
    canvas.width = cfg.width;
    canvas.height = cfg.height;
    const ctx = canvas.getContext("2d");
    const g = geometry(cfg, cells);

    ctx.fillStyle = cfg.bgColor;
    ctx.fillRect(0, 0, cfg.width, cfg.height);

    if (g.underAlpha > 0) {
      ctx.globalAlpha = g.underAlpha;
      for (const [color, runs] of collectRuns(cells, true)) {
        ctx.fillStyle = packedToHex(color);
        for (let i = 0; i < runs.length; i += 3) {
          ctx.fillRect(runs[i] * g.cs, runs[i + 1] * g.cs, runs[i + 2] * g.cs, g.cs);
        }
      }
      ctx.globalAlpha = 1;
    }

    const square = cfg.shape === "square";
    const groups = collectRuns(cells, square && g.gap === 0);

    for (const [color, runs] of groups) {
      ctx.fillStyle = packedToHex(color);
      if (square) {
        for (let i = 0; i < runs.length; i += 3) {
          const w = g.gap === 0 ? runs[i + 2] * g.cs : g.inner;
          ctx.fillRect(runs[i] * g.cs + g.offset, runs[i + 1] * g.cs + g.offset, w, g.inner);
        }
        continue;
      }
      ctx.beginPath();
      for (let i = 0; i < runs.length; i += 3) {
        const x = runs[i] * g.cs + g.offset;
        const y = runs[i + 1] * g.cs + g.offset;
        if (cfg.shape === "circle") {
          ctx.moveTo(x + g.inner, y + g.radius);
          ctx.arc(x + g.radius, y + g.radius, g.radius, 0, Math.PI * 2);
        } else {
          roundedRectPath(ctx, x, y, g.inner, g.inner, g.radius);
        }
      }
      ctx.fill();
    }
  }

  function num(v) {
    return Math.round(v * 100) / 100;
  }

  function svgShape(shape, x, y, w, h, r) {
    if (shape === "circle") {
      return `M${num(x)} ${num(y + r)}a${num(r)} ${num(r)} 0 1 0 ${num(2 * r)} 0a${num(r)} ${num(r)} 0 1 0 ${num(-2 * r)} 0z`;
    }
    if (shape === "rounded" && r > 0) {
      const ir = num(r);
      return (
        `M${num(x + r)} ${num(y)}h${num(w - 2 * r)}a${ir} ${ir} 0 0 1 ${ir} ${ir}` +
        `v${num(h - 2 * r)}a${ir} ${ir} 0 0 1 ${-ir} ${ir}h${num(-(w - 2 * r))}` +
        `a${ir} ${ir} 0 0 1 ${-ir} ${-ir}v${num(-(h - 2 * r))}a${ir} ${ir} 0 0 1 ${ir} ${-ir}z`
      );
    }
    return `M${num(x)} ${num(y)}h${num(w)}v${num(h)}h${num(-w)}z`;
  }

  function buildSvg(cfg, cells) {
    const g = geometry(cfg, cells);
    const W = cfg.width;
    const H = cfg.height;
    const square = cfg.shape === "square";
    const parts = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"` +
        (square ? ' shape-rendering="crispEdges"' : "") +
        ">",
      `<rect width="${W}" height="${H}" fill="${cfg.bgColor}"/>`,
    ];

    if (g.underAlpha > 0) {
      parts.push(`<g opacity="${num(g.underAlpha)}">`);
      for (const [color, runs] of collectRuns(cells, true)) {
        let d = "";
        for (let i = 0; i < runs.length; i += 3) {
          d += svgShape("square", runs[i] * g.cs, runs[i + 1] * g.cs, runs[i + 2] * g.cs, g.cs, 0);
        }
        parts.push(`<path fill="${packedToHex(color)}" d="${d}"/>`);
      }
      parts.push("</g>");
    }

    for (const [color, runs] of collectRuns(cells, square && g.gap === 0)) {
      let d = "";
      for (let i = 0; i < runs.length; i += 3) {
        const w = square && g.gap === 0 ? runs[i + 2] * g.cs : g.inner;
        d += svgShape(cfg.shape, runs[i] * g.cs + g.offset, runs[i + 1] * g.cs + g.offset, w, g.inner, g.radius);
      }
      parts.push(`<path fill="${packedToHex(color)}" d="${d}"/>`);
    }

    parts.push("</svg>");
    return parts.join("\n");
  }

  PB.render = { drawToCanvas, buildSvg };
})((window.PB = window.PB || {}));
