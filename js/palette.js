(function (PB) {
  "use strict";

  function hexToRgb(hex) {
    let h = String(hex).replace("#", "").trim();
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    if (Number.isNaN(n) || h.length !== 6) return [0, 0, 0];
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function clamp255(v) {
    return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
  }

  function rgbToHex(rgb) {
    return (
      "#" +
      rgb
        .map((v) => clamp255(v).toString(16).padStart(2, "0"))
        .join("")
    );
  }

  function packRgb(r, g, b) {
    return (clamp255(r) << 16) | (clamp255(g) << 8) | clamp255(b);
  }

  function packedToHex(p) {
    return "#" + p.toString(16).padStart(6, "0");
  }

  // sRGB <-> OKLab, so gradients between saturated hues don't go muddy.
  function srgbToLinear(c) {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function linearToSrgb(c) {
    const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return v * 255;
  }

  function rgbToOklab(rgb) {
    const r = srgbToLinear(rgb[0]);
    const g = srgbToLinear(rgb[1]);
    const b = srgbToLinear(rgb[2]);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  }

  function oklabToRgb(lab) {
    const l = Math.pow(lab[0] + 0.3963377774 * lab[1] + 0.2158037573 * lab[2], 3);
    const m = Math.pow(lab[0] - 0.1055613458 * lab[1] - 0.0638541728 * lab[2], 3);
    const s = Math.pow(lab[0] - 0.0894841775 * lab[1] - 1.291485548 * lab[2], 3);
    return [
      linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    ];
  }

  // Samples a multi-stop gradient (stops evenly spaced) at t in [0, 1].
  function sampleStops(labStops, t) {
    const n = labStops.length;
    if (n === 1) return oklabToRgb(labStops[0]);
    const s = Math.min(Math.max(t, 0), 1) * (n - 1);
    const i = Math.min(Math.floor(s), n - 2);
    const f = s - i;
    const a = labStops[i];
    const b = labStops[i + 1];
    return oklabToRgb([
      a[0] + (b[0] - a[0]) * f,
      a[1] + (b[1] - a[1]) * f,
      a[2] + (b[2] - a[2]) * f,
    ]);
  }

  // Returns `count` packed colors evenly sampled along the gradient.
  function buildLevels(hexStops, count) {
    const labStops = hexStops.map((h) => rgbToOklab(hexToRgb(h)));
    const out = new Int32Array(count);
    for (let i = 0; i < count; i++) {
      const rgb = sampleStops(labStops, count === 1 ? 0 : i / (count - 1));
      out[i] = packRgb(rgb[0], rgb[1], rgb[2]);
    }
    return out;
  }

  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s /= 100;
    l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return rgbToHex([f(0) * 255, f(8) * 255, f(4) * 255]);
  }

  // Random but pleasant palette: a hue walk from dark to light.
  function harmonious(rng) {
    const schemes = [
      { name: "análoga", spread: 60 },
      { name: "quente", spread: 90 },
      { name: "complementar", spread: 180 },
      { name: "tríade", spread: 240 },
      { name: "suave", spread: 30 },
    ];
    const scheme = schemes[Math.floor(rng() * schemes.length)];
    const baseHue = rng() * 360;
    const dir = rng() < 0.5 ? -1 : 1;
    const count = 2 + Math.floor(rng() * 4);
    const saturation = 65 + rng() * 30;
    const stops = [];
    for (let i = 0; i < count; i++) {
      const f = count === 1 ? 0 : i / (count - 1);
      const hue = baseHue + dir * scheme.spread * f;
      const light = 18 + f * (52 + rng() * 14);
      stops.push(hslToHex(hue, saturation, light));
    }
    if (rng() < 0.4) stops.reverse();
    const bg = hslToHex(baseHue + 10, 40 + rng() * 20, 6 + rng() * 8);
    return { stops, bg };
  }

  PB.palette = {
    hexToRgb,
    rgbToHex,
    packRgb,
    packedToHex,
    rgbToOklab,
    oklabToRgb,
    sampleStops,
    buildLevels,
    hslToHex,
    harmonious,
  };
})((window.PB = window.PB || {}));
