import { readFileSync } from "fs";

const src = readFileSync(new URL("../public/grok-bot.svg", import.meta.url), "utf8");
const rectRe = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="([^"]+)"(?: fill-opacity="([\d.]+)")?\s*\/>/g;

// Darkness map at 2px cells (256 x 256 grid over the 512 viewBox)
const G = 256;
const dark = new Float32Array(G * G);
let m;
let count = 0;
while ((m = rectRe.exec(src))) {
  count++;
  const [, x, y, w, h, fill, op] = m;
  const opacity = op === undefined ? 1 : +op;
  const isDark = fill.startsWith("#3") || fill.startsWith("#2");
  const x0 = Math.floor(+x / 2), x1 = Math.floor((+x + +w - 0.01) / 2);
  const cy = Math.floor((+y + +h / 2) / 2);
  for (let cx = x0; cx <= x1; cx++) {
    if (cx >= 0 && cx < G && cy >= 0 && cy < G) {
      dark[cy * G + cx] += isDark ? opacity : -opacity;
    }
  }
}
console.log("rects:", count);

// Threshold and find connected clusters
const seen = new Uint8Array(G * G);
const clusters = [];
for (let i = 0; i < G * G; i++) {
  if (seen[i] || dark[i] < 0.25) continue;
  const stack = [i];
  seen[i] = 1;
  let minX = G, maxX = 0, minY = G, maxY = 0, n = 0;
  while (stack.length) {
    const c = stack.pop();
    const cx = c % G, cy = (c / G) | 0;
    minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
    minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
    n++;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || nx >= G || ny < 0 || ny >= G) continue;
      const ni = ny * G + nx;
      if (!seen[ni] && dark[ni] >= 0.25) { seen[ni] = 1; stack.push(ni); }
    }
  }
  if (n > 12) clusters.push({ minX: minX * 2, maxX: maxX * 2 + 2, minY: minY * 2, maxY: maxY * 2 + 2, cells: n });
}
clusters.sort((a, b) => b.cells - a.cells);
for (const c of clusters.slice(0, 8)) {
  console.log(`cluster: x ${c.minX}-${c.maxX}  y ${c.minY}-${c.maxY}  w ${c.maxX - c.minX} h ${c.maxY - c.minY}  cells ${c.cells}`);
}

// ASCII visualization of the face region (x 120-360, y 180-400), 8px per char
console.log("\nface map (x 120-360, y 180-400):");
for (let y = 180; y < 400; y += 8) {
  let row = "";
  for (let x = 120; x < 360; x += 8) {
    let sum = 0;
    for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 4; dx++) {
      sum += dark[((y / 2 + dy) * G) + (x / 2 + dx)] || 0;
    }
    const avg = sum / 16;
    row += avg > 0.5 ? "#" : avg > 0.15 ? "+" : avg > -0.15 ? "." : avg > -0.5 ? "-" : " ";
  }
  console.log(row);
}
