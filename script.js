document.addEventListener("DOMContentLoaded", () => {
  const field = document.getElementById("grass-field");
  if (!field) return;

  const GRID_SIZE = 30;
  const DISPLAY_SIZE_DESKTOP = 240; // CSS pixels, matches .grass-tile

  const tiles = [];
  let hueOffset = 0;

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

  function layoutTiles() {
    if (!tiles.length) return;
    let minX = tiles[0].x;
    let minY = tiles[0].y;
    let maxX = tiles[0].x;
    let maxY = tiles[0].y;

    for (const t of tiles) {
      if (t.x < minX) minX = t.x;
      if (t.y < minY) minY = t.y;
      if (t.x > maxX) maxX = t.x;
      if (t.y > maxY) maxY = t.y;
    }

    const displaySize = currentDisplaySize();

    const widthTiles = maxX - minX + 1;
    const heightTiles = maxY - minY + 1;
    field.style.width = `${widthTiles * displaySize}px`;
    field.style.height = `${heightTiles * displaySize}px`;

    for (const t of tiles) {
      const left = (t.x - minX) * displaySize;
      const top = (t.y - minY) * displaySize;
      t.el.style.left = `${left}px`;
      t.el.style.top = `${top}px`;
    }
  }

  function createGrassTile(x, y) {
    const canvas = document.createElement("canvas");
    canvas.width = GRID_SIZE;
    canvas.height = GRID_SIZE;
    canvas.className = "grass-tile";

    const base = randomGrassBase();
    drawGrass(canvas, base);

    const tile = { x, y, el: canvas };
    tiles.push(tile);
    field.appendChild(canvas);

    canvas.addEventListener("click", () => {
      hueOffset = (hueOffset + 25 + Math.random() * 10) % 360;
      drawGrass(canvas, randomGrassBase());
    });

    layoutTiles();
  }

  function spawnAdjacentGrass() {
    if (!tiles.length) {
      createGrassTile(0, 0);
      return;
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
        createGrassTile(nx, ny);
        return;
      }
    }
  }

  // Start with a single piece of grass.
  createGrassTile(0, 0);
});
