import { readFileSync, writeFileSync } from "fs";

const src = readFileSync(new URL("../public/grok-bot.svg", import.meta.url), "utf8");

// Eye regions (from analyze-bot.mjs cluster detection), slightly padded
const EYES = [
  { x0: 158, y0: 250, x1: 222, y1: 348 }, // left
  { x0: 266, y0: 224, x1: 328, y1: 324 }, // right
];

const inEye = (cx, cy) =>
  EYES.some((e) => cx >= e.x0 && cx <= e.x1 && cy >= e.y0 && cy <= e.y1);

const rectRe = /<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" fill="([^"]+)"(?: fill-opacity="([\d.]+)")?\s*\/>/g;

const kept = [];
let m;
while ((m = rectRe.exec(src))) {
  const [, x, y, w, h] = m;
  const cx = +x + +w / 2;
  const cy = +y + +h / 2;
  if (!inEye(cx, cy)) kept.push(m[0]);
}

// Re-dither the eye boxes with the body's opaque checkerboard pattern
const synth = [];
for (const e of EYES) {
  for (let y = e.y0; y < e.y1; y++) {
    for (let x = e.x0; x < e.x1; x += 2) {
      const darkCell = (x / 2 + y) % 2 === 0;
      synth.push(`<rect x="${x}" y="${y}" width="2" height="1" fill="${darkCell ? "#303001" : "#fffedb"}"/>`);
    }
  }
}

const header = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" shape-rendering="crispEdges">`;
const out = header + kept.join("") + synth.join("") + `</svg>`;
writeFileSync(new URL("../public/grok-bot-body.svg", import.meta.url), out);
console.log(`kept ${kept.length} rects, synthesized ${synth.length}, total ${kept.length + synth.length}`);
