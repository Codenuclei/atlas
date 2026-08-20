import { readFileSync, writeFileSync } from "fs";

const src = readFileSync(new URL("../public/grok-bot.svg", import.meta.url), "utf8");
const rectRe = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="([^"]+)"(?: fill-opacity="([\d.]+)")?\s*\/>/g;

// 1. Index cells on the 2x1 grid
const cells = new Map(); // key = (x/2) + y * 4096
let m;
while ((m = rectRe.exec(src))) {
  const [, x, y, w, h, fill, op] = m;
  cells.set(+x / 2 + +y * 4096, { fill, op: op === undefined ? null : +op });
}
const cellAt = (x, y) => cells.get(x / 2 + y * 4096) ?? null;

// 2. Eye band: covers both eyes levelled to the same axis (cy 288) plus the
//    full gaze travel range. Texture is cloned from the forehead 96px above,
//    with fallbacks if the donor cell is outside the body.
const BAND = { x0: 148, y0: 232, x1: 340, y1: 348 };
const inBand = (x, y) => x >= BAND.x0 && x < BAND.x1 && y >= BAND.y0 && y < BAND.y1;
const DONOR_OFFSETS = [-96, -120, -72, 120, 96];

function bodyCell(x, y) {
  if (!inBand(x, y)) return cellAt(x, y);
  for (const off of DONOR_OFFSETS) {
    const donor = cellAt(x, y + off);
    if (donor) return donor;
  }
  return null;
}

// 3. Emit as a triangle mosaic: each 2x2 block is split along a diagonal
//    (orientation alternates per block for an even grain). Identical halves
//    collapse back into a single rect to keep the file lean.
const out = [];
for (let y = 0; y < 512; y += 2) {
  for (let x = 0; x < 512; x += 2) {
    const top = bodyCell(x, y);
    const bottom = bodyCell(x, y + 1);
    if (!top && !bottom) continue;

    if (top && bottom && top.fill === bottom.fill && top.op === bottom.op) {
      const op = top.op === null ? "" : ` fill-opacity="${top.op}"`;
      out.push(`<rect x="${x}" y="${y}" width="2" height="2" fill="${top.fill}"${op}/>`);
      continue;
    }

    const flip = (x / 2 + y / 2) % 2 === 1;
    const tri = (pts, cell) => {
      if (!cell) return;
      const op = cell.op === null ? "" : ` fill-opacity="${cell.op}"`;
      out.push(`<polygon points="${pts}" fill="${cell.fill}"${op}/>`);
    };
    if (flip) {
      tri(`${x},${y} ${x + 2},${y} ${x + 2},${y + 2}`, top); // upper-right
      tri(`${x},${y} ${x},${y + 2} ${x + 2},${y + 2}`, bottom); // lower-left
    } else {
      tri(`${x},${y} ${x + 2},${y} ${x},${y + 2}`, top); // upper-left
      tri(`${x + 2},${y} ${x + 2},${y + 2} ${x},${y + 2}`, bottom); // lower-right
    }
  }
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" shape-rendering="crispEdges">${out.join("")}</svg>`;
writeFileSync(new URL("../public/grok-bot-body.svg", import.meta.url), svg);
console.log(`emitted ${out.length} shapes, ${(svg.length / 1024 / 1024).toFixed(2)} MB`);
