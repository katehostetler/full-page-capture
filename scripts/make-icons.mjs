// Render icons/icon.svg to the PNG sizes Chrome expects. Uses the project's
// Playwright Chromium so no extra image tooling is needed.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const svg = fs.readFileSync(path.join(projectRoot, "extension/icons/icon.svg"), "utf8");
const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

const browser = await chromium.launch({ channel: "chromium", headless: true });
const page = await browser.newPage();

for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0"><img src="${dataUrl}" width="${size}" height="${size}"></body>`
  );
  const out = path.join(projectRoot, `extension/icons/icon${size}.png`);
  // omitBackground keeps the area around the camera transparent
  await page.screenshot({
    path: out,
    clip: { x: 0, y: 0, width: size, height: size },
    omitBackground: true,
  });
  console.log(`wrote ${out}`);
}

await browser.close();
