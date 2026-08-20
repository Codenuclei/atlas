import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:3000/", { waitUntil: "networkidle" });

// Idle, cursor off to the side
await page.mouse.move(1100, 120);
await page.waitForTimeout(1200);
const bot = page.locator("[role='img'][aria-label^='Atlas']").first();
const box = await bot.boundingBox();
const pad = 20;
const clip = { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 };
await page.screenshot({ path: "/tmp/bot-idle.png", clip });

// Typing state
await page.locator("textarea").click();
await page.locator("textarea").pressSequentially("Analyze Masters Union", { delay: 30 });
await page.waitForTimeout(600);
await page.screenshot({ path: "/tmp/bot-typing.png", clip });

await browser.close();
