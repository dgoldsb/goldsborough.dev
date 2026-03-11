document.addEventListener("DOMContentLoaded", () => {
  const field = document.getElementById("grass-field");
  if (!field) return;

  const GRID_SIZE = 30;
  const DISPLAY_SIZE_DESKTOP = 240; // CSS pixels, matches .grass-tile

  const BASE_GROW_INTERVAL_MS = 5_000;
  const BASE_LIFETIME_MS = 60_000;
  const TIMING_NOISE_FACTOR = 0.1; // 10% timing noise, tweakable

  const tiles = [];
  let growTimerId = null;
  let hueOffset = 0;

  function withTimingNoise(baseMs) {
    const range = baseMs * TIMING_NOISE_FACTOR;
    return baseMs + (Math.random() * 2 - 1) * range;
  }

  function currentDisplaySize() {
    // Keep JS positioning in sync with responsive CSS sizes
    const sample = field.querySelector(".grass-tile");
    if (sample) {
      const rect = sample.getBoundingClientRect();
      return rect.width || DISPLAY_SIZE_DESKTOP;
    }
    return DISPLAY_SIZE_DESKTOP;
  }

  function randomGrassBase() {
    const baseHue = (120 + hueOffset) % 360;
    const hue = baseHue + (Math.random() - 0.5) * 40;
    const saturation = 55 + Math.random() * 15;
    const lightnessBase = 22 + Math.random() * 12;
    return { hue, saturation, lightnessBase };
  }

  function drawGrass(canvas, base) {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { hue, saturation, lightnessBase } = base;
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const verticalFactor = y / h;
        const noise = (Math.random() - 0.5) * 10;
        let lightness = lightnessBase + verticalFactor * 22 + noise;
        lightness = Math.max(12, Math.min(70, lightness));
        ctx.fillStyle = `hsl(${hue}, ${saturation}%, ${lightness}%)`;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  function createGrassTile(x, y) {
    const canvas = document.createElement("canvas");
    canvas.width = GRID_SIZE;
    canvas.height = GRID_SIZE;
    canvas.className = "grass-tile";

    const base = randomGrassBase();
    drawGrass(canvas, base);

    const displaySize = currentDisplaySize();
    const left = x * displaySize;
    const top = y * displaySize;
    canvas.style.left = `${left}px`;
    canvas.style.top = `${top}px`;

    const tile = { x, y, el: canvas };
    tiles.push(tile);
    field.appendChild(canvas);

    const lifetime = withTimingNoise(BASE_LIFETIME_MS);
    setTimeout(() => {
      const idx = tiles.indexOf(tile);
      if (idx !== -1) {
        tiles.splice(idx, 1);
      }
      if (canvas.parentElement === field) {
        field.removeChild(canvas);
      }
    }, lifetime);

    canvas.addEventListener("click", () => {
      const idx = tiles.indexOf(tile);
      if (idx !== -1) {
        tiles.splice(idx, 1);
      }
      if (canvas.parentElement === field) {
        field.removeChild(canvas);
      }
    });
  }

  function spawnAdjacentGrass() {
    if (!tiles.length) {
      createGrassTile(0, 0);
      return true;
    }

    const directions = [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ];

    const occupied = new Set(tiles.map((t) => `${t.x},${t.y}`));

    for (let attempt = 0; attempt < 50; attempt++) {
      const base = tiles[Math.floor(Math.random() * tiles.length)];
      const dir = directions[Math.floor(Math.random() * directions.length)];
      const nx = base.x + dir.x;
      const ny = base.y + dir.y;
      const key = `${nx},${ny}`;

      if (!occupied.has(key)) {
        hueOffset = (hueOffset + 25 + Math.random() * 10) % 360;
        createGrassTile(nx, ny);
        return true;
      }
    }

    return false;
  }

  function scheduleNextGrowth() {
    const delay = withTimingNoise(BASE_GROW_INTERVAL_MS);
    growTimerId = setTimeout(() => {
      const grew = spawnAdjacentGrass();
      if (grew) {
        scheduleNextGrowth();
      } else {
        growTimerId = null;
      }
    }, delay);
  }

  // Start with a single piece of grass.
  createGrassTile(0, 0);

  // Grow new pieces roughly every 5 seconds until the field is full.
  scheduleNextGrowth();
});
