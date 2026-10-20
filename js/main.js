(function (PB) {
  "use strict";

  const { buildCells, previewPalette, resolveAngle } = PB.generator;
  const { drawToCanvas, buildSvg } = PB.render;
  const { DEFAULTS, PRESETS, withDefaults } = PB.presets;
  const { packedToHex, harmonious, buildLevels } = PB.palette;
  const { mulberry32, randomSeed } = PB.random;

  const STORAGE_KEY = "pixelbg:v1";
  const MAX_EXTRAS = 3;
  const SVG_WARN_CELLS = 400000;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const canvas = $("#canvas");
  const preview = $("#preview");
  let state = loadState();
  let lastCells = null;
  let frame = 0;

  const formatters = {
    cellSize: (v) => `${v}px`,
    gap: (v) => `${v}px`,
    gridOpacity: (v) => `${v}%`,
    angle: (v) => `${v}°`,
    centerX: (v) => `${v}%`,
    centerY: (v) => `${v}%`,
    bias: (v) => (v > 0 ? `+${v}` : `${v}`),
    repeat: (v) => `${v}×`,
    levels: (v) => (v < 2 ? "Suave" : `${v}`),
    ditherAmount: (v) => `${v}%`,
    grain: (v) => `${v}%`,
    density: (v) => `${v}%`,
  };

  // State

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && typeof saved === "object") {
        const merged = withDefaults(saved);
        if (!Array.isArray(merged.extras)) merged.extras = [];
        merged.extras = merged.extras.slice(0, MAX_EXTRAS);
        return merged;
      }
    } catch (e) {
      /* ignore corrupt storage */
    }
    return withDefaults({});
  }

  let saveTimer = 0;
  function saveState() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        /* storage may be unavailable */
      }
    }, 250);
  }

  function update(patch) {
    Object.assign(state, patch);
    if (state.levels === 1) state.levels = 0;
    syncUI();
    scheduleRender();
    saveState();
  }

  // Rendering

  function scheduleRender() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(renderNow);
  }

  function renderNow() {
    cancelAnimationFrame(frame);
    const start = performance.now();
    lastCells = buildCells(state);
    drawToCanvas(canvas, state, lastCells);
    const ms = Math.round(performance.now() - start);
    $("#stats").innerHTML =
      `<strong>${state.width} × ${state.height}px</strong> · ` +
      `${lastCells.cols} × ${lastCells.rows} pixels · ${ms} ms`;
    updateExportHint();
  }

  // UI sync

  function syncUI() {
    for (const el of $$("[data-key]")) {
      const key = el.dataset.key;
      if (!(key in state) || (document.activeElement === el && el.type === "number")) continue;
      if (el.value !== String(state[key])) el.value = state[key];
    }
    for (const out of $$("output[data-for]")) {
      const key = out.dataset.for;
      const fmt = formatters[key] || String;
      out.textContent = fmt(state[key]);
    }

    const conditions = {
      gap: state.gap > 0,
      linear: state.gradientType === "linear",
      radial: state.gradientType === "radial",
      customAngle: state.direction === "custom",
      banded: state.levels >= 2,
      dither: state.levels >= 2 && state.ditherType !== "none",
    };
    for (const el of $$("[data-show-if]")) {
      el.hidden = !conditions[el.dataset.showIf];
    }

    $("#angleHint").textContent =
      state.direction === "random" ? `Ângulo sorteado pela seed: ${resolveAngle(state)}°` : "";

    const res = `${state.width}x${state.height}`;
    const select = $("#resolutionPreset");
    select.value = $$("option", select).some((o) => o.value === res) ? res : "custom";

    renderColorStops();
    renderPaletteStrip();
  }

  function renderColorStops() {
    const container = $("#colorStops");
    const stops = [
      { label: "Primária", key: "primary" },
      ...state.extras.map((_, i) => ({ label: `Intermediária ${i + 1}`, extra: i })),
      { label: "Secundária", key: "secondary" },
    ];

    const signature = stops.length;
    if (container.dataset.count !== String(signature)) {
      container.dataset.count = String(signature);
      container.innerHTML = "";
      for (const stop of stops) {
        const row = document.createElement("div");
        row.className = "color-stop";
        const input = document.createElement("input");
        input.type = "color";
        input.addEventListener("input", () => {
          if (stop.key) {
            update({ [stop.key]: input.value });
          } else {
            const extras = [...state.extras];
            extras[stop.extra] = input.value;
            update({ extras });
          }
        });
        const label = document.createElement("span");
        label.className = "label";
        label.textContent = stop.label;
        const hex = document.createElement("span");
        hex.className = "hex";
        row.append(input, label, hex);
        if (!stop.key) {
          const remove = document.createElement("button");
          remove.type = "button";
          remove.className = "btn remove";
          remove.title = "Remover cor";
          remove.textContent = "×";
          remove.addEventListener("click", () => {
            update({ extras: state.extras.filter((_, i) => i !== stop.extra) });
          });
          row.append(remove);
        }
        container.append(row);
      }
    }

    $$(".color-stop", container).forEach((row, i) => {
      const stop = stops[i];
      const value = stop.key ? state[stop.key] : state.extras[stop.extra];
      const input = $("input", row);
      if (input.value !== value) input.value = value;
      $(".hex", row).textContent = value.toUpperCase();
    });

    $("#addColorBtn").disabled = state.extras.length >= MAX_EXTRAS;
  }

  function renderPaletteStrip() {
    const strip = $("#paletteStrip");
    strip.innerHTML = previewPalette(state)
      .map((c) => `<span style="background:${packedToHex(c)}"></span>`)
      .join("");
  }

  function updateExportHint() {
    const count = lastCells ? lastCells.cols * lastCells.rows : 0;
    $("#exportHint").textContent =
      count > SVG_WARN_CELLS
        ? `Atenção: ${count.toLocaleString("pt-BR")} pixels. O SVG pode ficar grande; aumente o tamanho do pixel para um arquivo mais leve.`
        : "";
  }

  // Controls

  function readValue(el) {
    if (el.type === "range" || el.type === "number") {
      let v = Number(el.value);
      if (Number.isNaN(v)) v = DEFAULTS[el.dataset.key];
      if (el.min !== "") v = Math.max(Number(el.min), v);
      if (el.max !== "") v = Math.min(Number(el.max), v);
      return Math.round(v);
    }
    return el.value;
  }

  function bindControls() {
    for (const el of $$("[data-key]")) {
      const event = el.type === "number" ? "change" : "input";
      el.addEventListener(event, () => {
        const key = el.dataset.key;
        const value = readValue(el);
        if (el.type === "number") el.value = value;
        update({ [key]: value });
      });
    }

    $("#resolutionPreset").addEventListener("change", (e) => {
      if (e.target.value === "custom") return;
      const [width, height] = e.target.value.split("x").map(Number);
      update({ width, height });
    });

    $("#addColorBtn").addEventListener("click", () => {
      if (state.extras.length >= MAX_EXTRAS) return;
      const before = state.extras.length ? state.extras[state.extras.length - 1] : state.primary;
      const mid = buildLevels([before, state.secondary], 3)[1];
      update({ extras: [...state.extras, packedToHex(mid)] });
    });

    $("#reverseBtn").addEventListener("click", () => {
      update({
        primary: state.secondary,
        secondary: state.primary,
        extras: [...state.extras].reverse(),
      });
    });

    $("#newSeedBtn").addEventListener("click", newSeed);
    $("#surpriseBtn").addEventListener("click", surprise);
    $("#resetBtn").addEventListener("click", () => {
      state = withDefaults({});
      update({});
    });

    $("#zoomBtn").addEventListener("click", () => {
      const fit = preview.classList.toggle("fit");
      $("#zoomBtn").textContent = fit ? "Ver em 100%" : "Ajustar à tela";
    });

    $("#exportPngBtn").addEventListener("click", exportPng);
    $("#exportSvgBtn").addEventListener("click", exportSvg);

    document.addEventListener("keydown", (e) => {
      if (e.code !== "Space") return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(tag)) return;
      e.preventDefault();
      newSeed();
    });
  }

  function newSeed() {
    update({ seed: randomSeed() });
  }

  function pick(rng, list) {
    return list[Math.floor(rng() * list.length)];
  }

  function surprise() {
    const rng = mulberry32(randomSeed());
    const { stops, bg } = harmonious(rng);
    const levels = rng() < 0.2 ? 0 : 3 + Math.floor(rng() * 10);
    update({
      seed: randomSeed(),
      cellSize: pick(rng, [8, 12, 16, 20, 24, 32, 40]),
      gap: rng() < 0.6 ? 0 : pick(rng, [1, 1, 2, 3]),
      gridOpacity: pick(rng, [100, 100, 60, 20]),
      shape: rng() < 0.8 ? "square" : pick(rng, ["rounded", "circle"]),
      bgColor: bg,
      primary: stops[0],
      extras: stops.slice(1, -1).slice(0, MAX_EXTRAS),
      secondary: stops[stops.length - 1],
      gradientType: rng() < 0.85 ? "linear" : "radial",
      direction: pick(rng, ["0", "45", "90", "90", "135", "180", "random"]),
      centerX: Math.round(rng() * 100),
      centerY: Math.round(rng() * 100),
      bias: Math.round((rng() - 0.5) * 60),
      repeat: rng() < 0.85 ? 1 : 2,
      levels,
      ditherType: pick(rng, ["random", "random", "bayer2", "bayer4", "bayer8", "none"]),
      ditherAmount: 80 + Math.round(rng() * 80),
      grain: rng() < 0.6 ? 0 : Math.round(rng() * 15),
      density: rng() < 0.8 ? 100 : 70 + Math.round(rng() * 25),
    });
  }

  // Presets

  function applyPreset(preset) {
    state = withDefaults({ ...preset.config, width: state.width, height: state.height });
    update({});
  }

  function buildPresetList() {
    const list = $("#presetList");
    const thumbW = 240;
    for (const preset of PRESETS) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "preset";
      btn.title = `Aplicar preset "${preset.name}"`;
      const thumb = document.createElement("canvas");
      const cfg = withDefaults(preset.config);
      const scale = thumbW / cfg.width;
      cfg.width = thumbW;
      cfg.height = Math.round(thumbW * 0.45);
      cfg.cellSize = Math.max(2, Math.round(cfg.cellSize * scale * 2));
      cfg.gap = cfg.gap > 0 ? 1 : 0;
      drawToCanvas(thumb, cfg, buildCells(cfg));
      const label = document.createElement("span");
      label.textContent = preset.name;
      btn.append(thumb, label);
      btn.addEventListener("click", () => applyPreset(preset));
      list.append(btn);
    }
  }

  // Export

  function fileName(ext) {
    return `pixel-bg-${state.width}x${state.height}-${state.seed}.${ext}`;
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportPng() {
    renderNow();
    canvas.toBlob((blob) => {
      if (blob) download(blob, fileName("png"));
    }, "image/png");
  }

  function exportSvg() {
    renderNow();
    const count = lastCells.cols * lastCells.rows;
    if (
      count > SVG_WARN_CELLS &&
      !confirm(`O SVG terá ${count.toLocaleString("pt-BR")} pixels e pode ficar pesado. Continuar?`)
    ) {
      return;
    }
    const svg = buildSvg(state, lastCells);
    download(new Blob([svg], { type: "image/svg+xml" }), fileName("svg"));
  }

  // Init

  bindControls();
  buildPresetList();
  syncUI();
  renderNow();
})((window.PB = window.PB || {}));
