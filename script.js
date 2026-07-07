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
  const IMAGE_MAX_LEVEL = 0.8; // portrait highlights cap below full magenta
  const NOISE_MAX_GAIN = 0.055; // ceiling for the reveal noise, kept gentle

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let gridW = 0;
  let gridH = 0;
  let u = null; // current wave field
  let uPrev = null; // previous wave field
  let mask = null; // magenta response per cell: 1 for text, graded for the portrait
  let cover = null; // how much a cell belongs to text/portrait vs the void;
  // feathered edge cells sit in between and dither between the two per frame
  let maskWeight = 0; // sum of mask * cover, for normalizing the audio level
  let imageData = null;
  let pixels = null; // Uint32 view of imageData, ABGR little-endian
  let linkBoxes = []; // { el, x0, y0, x1, y1 } in grid coordinates
  let animating = false;
  let portrait = null; // Image element once assets/portrait.jpg has loaded
  let audio = null; // { ctx, gain } once the first gesture unlocks Web Audio

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

    // Portrait sits above the name; the whole block stays centered.
    let imgRect = null;
    if (portrait && portrait.naturalWidth > 0) {
      const aspect = portrait.naturalWidth / portrait.naturalHeight;
      let ih = Math.round(gridH * 0.38);
      let iw = Math.round(ih * aspect);
      if (iw > gridW * 0.72) {
        iw = Math.round(gridW * 0.72);
        ih = Math.round(iw / aspect);
      }
      imgRect = { w: iw, h: ih };
    }

    const imgGap = imgRect ? Math.round(nameSize * 0.9) : 0;
    const blockHeight =
      (imgRect ? imgRect.h + imgGap : 0) + nameLines.length * lineGap + linkSize * 2.4;
    let y = Math.round(gridH / 2 - blockHeight / 2);
    if (imgRect) {
      imgRect.x = Math.round(cx - imgRect.w / 2);
      imgRect.y = Math.max(0, y);
      y += imgRect.h + imgGap;
    }
    y += Math.round(nameSize / 2);

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

    return imgRect;
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

    // Render text and portrait once into an offscreen canvas; keep a graded
    // magenta-response mask: 1 for text, luminance-scaled for the portrait.
    const textCanvas = document.createElement("canvas");
    textCanvas.width = gridW;
    textCanvas.height = gridH;
    const textCtx = textCanvas.getContext("2d");
    const imgRect = layoutText(textCtx);
    const alpha = textCtx.getImageData(0, 0, gridW, gridH).data;
    mask = new Float32Array(n);
    cover = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (alpha[i * 4 + 3] > 96) {
        mask[i] = 1;
        cover[i] = 1;
      }
    }

    if (imgRect) {
      textCtx.clearRect(0, 0, gridW, gridH);
      textCtx.drawImage(portrait, imgRect.x, imgRect.y, imgRect.w, imgRect.h);
      const img = textCtx.getImageData(0, 0, gridW, gridH).data;
      const lum = new Float32Array(n);
      const seen = [];
      for (let i = 0; i < n; i++) {
        if (img[i * 4 + 3] === 0) continue;
        const l = (0.2126 * img[i * 4] + 0.7152 * img[i * 4 + 1] + 0.0722 * img[i * 4 + 2]) / 255;
        lum[i] = Math.max(l, 1e-4); // nonzero marks "inside the photo"
        seen.push(l);
      }
      // Normalize so the portrait's own highlights (p99, robust against
      // specks) land at IMAGE_MAX_LEVEL instead of a fixed absolute scale.
      seen.sort((a, b) => a - b);
      const p99 = seen.length ? seen[Math.floor(seen.length * 0.99)] : 1;
      const scale = p99 > 0 ? IMAGE_MAX_LEVEL / p99 : 0;
      // Feather via coverage, not brightness: over the outer ~12% a cell's
      // odds of acting as photo (vs ordinary green void) taper to zero, so
      // the edge dissolves while still riding the waves normally.
      const feather = Math.max(3, Math.round(Math.min(imgRect.w, imgRect.h) * 0.12));
      for (let i = 0; i < n; i++) {
        if (lum[i] > 0 && cover[i] === 0) {
          const px = i % gridW;
          const py = (i / gridW) | 0;
          const edge = Math.min(
            px - imgRect.x,
            imgRect.x + imgRect.w - 1 - px,
            py - imgRect.y,
            imgRect.y + imgRect.h - 1 - py
          );
          let fade = Math.min(1, Math.max(0, edge / feather));
          fade *= fade * (3 - 2 * fade);
          cover[i] = fade;
          mask[i] = Math.min(IMAGE_MAX_LEVEL, lum[i] * scale);
        }
      }
    }

    maskWeight = 0;
    for (let i = 0; i < n; i++) maskWeight += mask[i] * cover[i];

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

  // Gentle grainy reveal noise: a looped pink-noise buffer behind a lowpass,
  // whose gain follows how much magenta is currently lit. Web Audio can only
  // start from a user gesture, so this is created lazily on first pointerdown.
  function ensureAudio() {
    if (reducedMotion) return;
    if (audio) {
      if (audio.ctx.state === "suspended") audio.ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const actx = new AudioCtx();
    const buffer = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.25;
    }
    const source = actx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = actx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1400;
    const gain = actx.createGain();
    gain.gain.value = 0;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(actx.destination);
    source.start();
    audio = { ctx: actx, gain };
  }

  function updateNoise(reveal) {
    if (!audio) return;
    const target = Math.min(1, reveal * 2.5) * NOISE_MAX_GAIN;
    audio.gain.gain.setTargetAtTime(target, audio.ctx.currentTime, 0.1);
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
    let revealLevel = 0;
    for (let i = 0; i < n; i++) {
      const a = Math.abs(u[i]);
      if (a < VISIBLE_FLOOR) continue;
      visibleCells++;
      const cv = cover[i];
      if (cv > 0 && rng() < cv) {
        // Text and portrait answer the ping louder than the void: more
        // sensitive curve, less dropout, so they stay legible as it passes.
        const level = Math.min(1, Math.pow(a * 5, 0.5)) * mask[i] * (0.75 + 0.25 * rng());
        revealLevel += level;
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
    updateNoise(maskWeight > 0 ? revealLevel / maskWeight : 0);
    return visibleCells;
  }

  function renderStatic() {
    // Reduced motion: no waves, just the grainy text and portrait, visible.
    pixels.fill(0xff000000);
    const n = gridW * gridH;
    for (let i = 0; i < n; i++) {
      if (cover[i] > 0 && rng() < cover[i]) {
        pixels[i] = packColor(MAGENTA, mask[i] * (0.5 + 0.5 * rng()));
      }
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
      updateNoise(0);
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
    ensureAudio();
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

  const portraitImg = new Image();
  portraitImg.addEventListener("load", () => {
    portrait = portraitImg;
    rebuild();
  });
  portraitImg.src = "assets/portrait.jpg";

  // Tiny handle for automated verification of the reveal noise.
  window.__sonarNoise = () => (audio ? audio.gain.gain.value : null);

  rebuild();
});
