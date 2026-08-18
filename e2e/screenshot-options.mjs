// Screenshot the options page as a real extension page (for design review).
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fpc-opt-"));
const extDir = path.join(workDir, "extension");
fs.cpSync(path.join(projectRoot, "extension"), extDir, { recursive: true });

const context = await chromium.launchPersistentContext(path.join(workDir, "profile"), {
  channel: "chromium",
  headless: true,
  viewport: { width: 420, height: 420 },
  args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
});

try {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 15000 });
  const extId = new URL(worker.url()).host;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/options.html`);
  await page.waitForTimeout(300);
  const out = path.join(projectRoot, "e2e-artifacts", "options.png");
  await page.screenshot({ path: out });
  console.log(`saved: ${out}`);
} finally {
  await context.close();
  fs.rmSync(workDir, { recursive: true, force: true });
}
