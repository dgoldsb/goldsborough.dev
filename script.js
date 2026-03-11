document.addEventListener("DOMContentLoaded", () => {
  const field = document.getElementById("grass-field");
  if (!field) return;

  const GRID_SIZE = 30;
  const DISPLAY_SIZE_DESKTOP = 120; // CSS pixels, matches .grass-tile

  const BASE_GROW_INTERVAL_MS = 3_000;
  const BASE_LIFETIME_MS = 60_000;
  const TIMING_NOISE_FACTOR = 0.1; // 10% timing noise, tweakable

  const MAX_COLS = 9;
  const MAX_ROWS = 9;
  const START_COL = Math.floor(MAX_COLS / 2);
  const START_ROW = Math.floor(MAX_ROWS / 2);

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

  function sizeField() {
    const displaySize = currentDisplaySize();
    field.style.width = `${MAX_COLS * displaySize}px`;
    field.style.height = `${MAX_ROWS * displaySize}px`;

    const fieldCenterX = (MAX_COLS * displaySize) / 2;
    const fieldCenterY = (MAX_ROWS * displaySize) / 2;
    const tileCenterX = (START_COL + 0.5) * displaySize;
    const tileCenterY = (START_ROW + 0.5) * displaySize;
    const offsetX = fieldCenterX - tileCenterX;
    const offsetY = fieldCenterY - tileCenterY;
    field.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
  }

  function layoutTilesForCurrentSize() {
    const displaySize = currentDisplaySize();
    for (const t of tiles) {
      const left = t.x * displaySize;
      const top = t.y * displaySize;
      t.el.style.left = `${left}px`;
      t.el.style.top = `${top}px`;
    }
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
    // Simple dark ground at the bottom
    ctx.fillStyle = `hsl(${hue}, ${saturation}%, ${Math.max(10, lightnessBase - 10)}%)`;
    const groundHeight = 2;
    ctx.fillRect(0, h - groundHeight, w, groundHeight);

    // Side-view blades of grass
    for (let x = 0; x < w; x++) {
      if (Math.random() < 0.3) continue; // sparse blades
      const bladeHeight = Math.floor(h * (0.4 + Math.random() * 0.5));
      let currentX = x;
      for (let step = 0; step < bladeHeight; step++) {
        const y = h - groundHeight - step;
        if (y < 0) break;

        const heightFactor = step / bladeHeight;
        const light = lightnessBase + heightFactor * 20 + (Math.random() - 0.5) * 5;
        const clampedLight = Math.max(18, Math.min(80, light));
        ctx.fillStyle = `hsl(${hue}, ${saturation}%, ${clampedLight}%)`;
        ctx.fillRect(currentX, y, 1, 1);

        // Slight random lean for the blade
        if (Math.random() < 0.35) {
          currentX += Math.random() < 0.5 ? -1 : 1;
          if (currentX < 0) currentX = 0;
          if (currentX >= w) currentX = w - 1;
        }
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
    setTimeout(() => removeTile(tile), lifetime);

    canvas.addEventListener("click", () => removeTile(tile));
  }

  function spawnAdjacentGrass() {
    if (!tiles.length) {
      createGrassTile(START_COL, START_ROW);
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
      if (nx < 0 || nx >= MAX_COLS || ny < 0 || ny >= MAX_ROWS) {
        continue;
      }
      const key = `${nx},${ny}`;

      if (!occupied.has(key)) {
        hueOffset = (hueOffset + 25 + Math.random() * 10) % 360;
        createGrassTile(nx, ny);
        return true;
      }
    }

    return false;
  }

  function removeTile(tile) {
    const idx = tiles.indexOf(tile);
    if (idx !== -1) tiles.splice(idx, 1);
    if (tile.el.parentElement === field) field.removeChild(tile.el);
    if (growTimerId === null) scheduleNextGrowth();
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
  sizeField();
  createGrassTile(START_COL, START_ROW);

  // Grow new pieces roughly every 5 seconds until the field is full.
  scheduleNextGrowth();

  window.addEventListener("resize", () => {
    sizeField();
    layoutTilesForCurrentSize();
  });
});
