document.addEventListener("DOMContentLoaded", () => {
  const canvas = document.getElementById("sonar");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Exact complementary pair: green and magenta sum to white.
  const GREEN = { r: 0, g: 255, b: 0 };
  const MAGENTA = { r: 255, g: 0, b: 255 };

  const CELL = 2.5; // CSS pixels per grain cell
  const MAX_CELLS = 480_000; // safety cap for very large screens
  const SUBSTEPS = 3; // sim steps per frame; controls wave speed
  const COURANT = 0.3; // c^2 * dt^2 / dx^2, must stay < 0.5 for stability
  const DAMPING = 0.996;
  const IMPULSE_AMPLITUDE = 4;
  const IMPULSE_RADIUS = 2.2; // in cells
  const LIT_THRESHOLD = 0.02; // mean |u| over a link box that counts as "lit"
  const VISIBLE_FLOOR = 0.004; // |u| below this renders as pure black

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let gridW = 0;
  let gridH = 0;
  let u = null; // current wave field
  let uPrev = null; // previous wave field
  let mask = null; // 1 where a cell belongs to text
  let imageData = null;
  let pixels = null; // Uint32 view of imageData, ABGR little-endian
  let linkBoxes = []; // { el, x0, y0, x1, y1 } in grid coordinates
  let animating = false;

  // Cheap deterministic PRNG for per-frame dither noise.
  let rngState = 0x9e3779b9;
  function rng() {
    rngState ^= rngState << 13;
    rngState ^= rngState >>> 17;
    rngState ^= rngState << 5;
    return (rngState >>> 0) / 4294967296;
  }

  function layoutText(textCtx) {
    textCtx.clearRect(0, 0, gridW, gridH);
    textCtx.fillStyle = "#ffffff";
    textCtx.textAlign = "center";
    textCtx.textBaseline = "middle";

    const cx = gridW / 2;
    const nameLines = gridW < 260 ? ["Dylan", "Goldsborough"] : ["Dylan Goldsborough"];
    const longest = Math.max(...nameLines.map((l) => l.length));
    const nameSize = Math.min(40, Math.floor((gridW * 0.85) / (longest * 0.62)));
    const linkSize = Math.max(9, Math.floor(nameSize * 0.42));
    const lineGap = Math.round(nameSize * 1.15);
    const blockHeight = nameLines.length * lineGap + linkSize * 2.4;
    let y = Math.round(gridH / 2 - blockHeight / 2 + nameSize / 2);

    textCtx.font = `bold ${nameSize}px "Courier New", Courier, monospace`;
    for (const line of nameLines) {
      textCtx.fillText(line, cx, y);
      y += lineGap;
    }

    y += Math.round(linkSize * 1.2);
    textCtx.font = `bold ${linkSize}px "Courier New", Courier, monospace`;
    const labels = [
      { text: "GitHub", el: document.getElementById("link-github") },
      { text: "LinkedIn", el: document.getElementById("link-linkedin") },
      { text: "CV", el: document.getElementById("link-cv") },
    ];
    const gap = linkSize * 2;
    const widths = labels.map((l) => textCtx.measureText(l.text).width);
    const totalWidth = widths.reduce((a, b) => a + b, 0) + gap * (labels.length - 1);

    linkBoxes = [];
    let x = cx - totalWidth / 2;
    labels.forEach((label, i) => {
      const w = widths[i];
      textCtx.fillText(label.text, x + w / 2, y);
      const pad = 3;
      linkBoxes.push({
        el: label.el,
        x0: Math.max(0, Math.floor(x - pad)),
        y0: Math.max(0, Math.floor(y - linkSize / 2 - pad)),
        x1: Math.min(gridW - 1, Math.ceil(x + w + pad)),
        y1: Math.min(gridH - 1, Math.ceil(y + linkSize / 2 + pad)),
      });
      x += w + gap;
    });
  }

  function rebuild() {
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    let cell = CELL;
    if ((cssW / cell) * (cssH / cell) > MAX_CELLS) {
      cell = Math.sqrt((cssW * cssH) / MAX_CELLS);
    }
    gridW = Math.max(80, Math.round(cssW / cell));
    gridH = Math.max(60, Math.round(cssH / cell));

    canvas.width = gridW;
    canvas.height = gridH;

    const n = gridW * gridH;
    u = new Float32Array(n);
    uPrev = new Float32Array(n);
    imageData = ctx.createImageData(gridW, gridH);
    pixels = new Uint32Array(imageData.data.buffer);

    // Render the text once into an offscreen canvas and keep its alpha as a mask.
    const textCanvas = document.createElement("canvas");
    textCanvas.width = gridW;
    textCanvas.height = gridH;
    const textCtx = textCanvas.getContext("2d");
    layoutText(textCtx);
    const alpha = textCtx.getImageData(0, 0, gridW, gridH).data;
    mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      mask[i] = alpha[i * 4 + 3] > 96 ? 1 : 0;
    }

    if (reducedMotion) {
      renderStatic();
    } else {
      renderFrame();
    }
  }

  function toGrid(clientX, clientY) {
    return {
      gx: (clientX / window.innerWidth) * gridW,
      gy: (clientY / window.innerHeight) * gridH,
    };
  }

  function ping(gx, gy) {
    const r = Math.ceil(IMPULSE_RADIUS * 2.5);
    const invSigma2 = 1 / (IMPULSE_RADIUS * IMPULSE_RADIUS);
    for (let dy = -r; dy <= r; dy++) {
      const yy = Math.round(gy) + dy;
      if (yy < 1 || yy >= gridH - 1) continue;
      for (let dx = -r; dx <= r; dx++) {
        const xx = Math.round(gx) + dx;
        if (xx < 1 || xx >= gridW - 1) continue;
        const d2 = dx * dx + dy * dy;
        u[yy * gridW + xx] += IMPULSE_AMPLITUDE * Math.exp(-d2 * invSigma2);
      }
    }
    startAnimating();
  }

  function stepWave() {
    const w = gridW;
    const next = uPrev; // reuse the old buffer as the new one
    for (let yRow = 1; yRow < gridH - 1; yRow++) {
      const row = yRow * w;
      for (let xCol = 1; xCol < w - 1; xCol++) {
        const i = row + xCol;
        const lap = u[i - 1] + u[i + 1] + u[i - w] + u[i + w] - 4 * u[i];
        next[i] = (2 * u[i] - uPrev[i] + COURANT * lap) * DAMPING;
      }
    }
    uPrev = u;
    u = next;
  }

  function packColor(color, level) {
    // level in [0, 1]; ImageData is RGBA in memory, so little-endian ABGR here
    const r = (color.r * level) | 0;
    const g = (color.g * level) | 0;
    const b = (color.b * level) | 0;
    return (255 << 24) | (b << 16) | (g << 8) | r;
  }

  function renderFrame() {
    pixels.fill(0xff000000);
    const n = gridW * gridH;
    let visibleCells = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(u[i]);
      if (a < VISIBLE_FLOOR) continue;
      visibleCells++;
      if (mask[i]) {
        // Text answers the ping louder than the void: more sensitive
        // curve, less dropout, so glyphs stay legible as the wave passes.
        const level = Math.min(1, Math.pow(a * 5, 0.5)) * (0.75 + 0.25 * rng());
        pixels[i] = packColor(MAGENTA, level);
      } else {
        let level = Math.min(1, Math.pow(a * 1.6, 0.65));
        // Grainy dither: brightness jitters, faint cells drop out stochastically
        const noise = rng();
        if (level < 0.35 && noise > level * 3) continue;
        level *= 0.55 + 0.45 * rng();
        pixels[i] = packColor(GREEN, level);
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return visibleCells;
  }

  function renderStatic() {
    // Reduced motion: no waves, just the grainy text, always visible.
    pixels.fill(0xff000000);
    const n = gridW * gridH;
    for (let i = 0; i < n; i++) {
      if (mask[i]) pixels[i] = packColor(MAGENTA, 0.5 + 0.5 * rng());
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function frame() {
    for (let s = 0; s < SUBSTEPS; s++) stepWave();
    const visibleCells = renderFrame();
    if (visibleCells > 0) {
      requestAnimationFrame(frame);
    } else {
      // Field has gone quiet: paint pure black and stop burning CPU.
      pixels.fill(0xff000000);
      ctx.putImageData(imageData, 0, 0);
      u.fill(0);
      uPrev.fill(0);
      animating = false;
    }
  }

  function startAnimating() {
    if (animating || reducedMotion) return;
    animating = true;
    requestAnimationFrame(frame);
  }

  function linkAt(gx, gy) {
    for (const box of linkBoxes) {
      if (gx >= box.x0 && gx <= box.x1 && gy >= box.y0 && gy <= box.y1) return box;
    }
    return null;
  }

  function isLit(box) {
    if (reducedMotion) return true;
    let sum = 0;
    let count = 0;
    for (let yy = box.y0; yy <= box.y1; yy++) {
      for (let xx = box.x0; xx <= box.x1; xx++) {
        sum += Math.abs(u[yy * gridW + xx]);
        count++;
      }
    }
    return count > 0 && sum / count > LIT_THRESHOLD;
  }

  canvas.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    const { gx, gy } = toGrid(event.clientX, event.clientY);
    const box = linkAt(gx, gy);
    if (box && box.el && isLit(box)) {
      box.el.click();
      return;
    }
    ping(gx, gy);
  });

  canvas.addEventListener("pointermove", (event) => {
    const { gx, gy } = toGrid(event.clientX, event.clientY);
    const box = linkAt(gx, gy);
    canvas.classList.toggle("over-link", Boolean(box && isLit(box)));
  });

  // Keyboard/screen-reader focus on the hidden links pings their spot on screen.
  for (const id of ["link-github", "link-linkedin", "link-cv"]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener("focus", () => {
      const box = linkBoxes.find((b) => b.el === el);
      if (box && !reducedMotion) {
        ping((box.x0 + box.x1) / 2, (box.y0 + box.y1) / 2);
      }
    });
  }

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rebuild, 150);
  });

  rebuild();
});
