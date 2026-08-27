import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require("/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright");
const executablePath = "/root/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome";
const appUrl = new URL("../dist/samt-app.html", import.meta.url).href;

if (!existsSync(executablePath)) {
  console.log("Browser smoke skipped: this build environment has no Chromium executable.");
  process.exit(0);
}

const browser = await chromium.launch({
  headless: true,
  executablePath
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));

try {
  await page.goto(appUrl, { waitUntil: "load" });
  await page.waitForSelector(".app-shell");

  for (const viewport of [
    { width: 320, height: 700 },
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 1440, height: 900 }
  ]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(30);
    const layout = await page.evaluate(() => {
      const visible = (element) => Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
      const brand = document.querySelector(".brand");
      const activeNavigation = [...document.querySelectorAll(".desktop-nav, .mobile-nav")].find(visible);
      return {
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        bodyOverflow: document.body.scrollWidth - document.body.clientWidth,
        brandVisible: visible(brand),
        brandText: brand?.textContent?.trim(),
        navigationVisible: visible(activeNavigation),
        headerWithinViewport: document.querySelector(".app-header")?.getBoundingClientRect().right <= innerWidth + 0.5
      };
    });
    assert.equal(layout.pageOverflow, 0, `page overflow at ${viewport.width}px`);
    assert.equal(layout.bodyOverflow, 0, `body overflow at ${viewport.width}px`);
    assert.equal(layout.brandVisible, true, `brand hidden at ${viewport.width}px`);
    assert.equal(layout.brandText, "SAMT", `brand text missing at ${viewport.width}px`);
    assert.equal(layout.navigationVisible, true, `navigation hidden at ${viewport.width}px`);
    assert.equal(layout.headerWithinViewport, true, `header clipped at ${viewport.width}px`);
  }

  await page.setViewportSize({ width: 320, height: 700 });
  await page.locator('[data-action="open-more"]').click();
  await page.waitForSelector(".modal-dialog");
  const modalState = await page.evaluate(() => ({
    open: document.body.classList.contains("modal-open"),
    modalTop: Number(getComputedStyle(document.querySelector(".modal-dialog")).zIndex || 0),
    backdropTop: Number(getComputedStyle(document.querySelector(".modal-backdrop")).zIndex || 0),
    destinations: [...document.querySelectorAll(".modal-dialog a")].map((item) => item.textContent.trim())
  }));
  assert.equal(modalState.open, true, "modal does not lock the document");
  assert.ok(modalState.modalTop > modalState.backdropTop, "dialog is not above its backdrop");
  for (const destination of ["Home", "Action Lists", "Blocks", "Actions", "Analysis", "History", "Settings"]) {
    assert.ok(modalState.destinations.includes(destination), `${destination} is unreachable on mobile`);
  }
  await page.keyboard.press("Escape");
  await page.waitForSelector(".modal-dialog", { state: "detached" });

  await page.locator('[data-action="new-action"]').count().then(async (count) => {
    if (!count) {
      await page.goto(`${appUrl}#/actions`, { waitUntil: "load" });
      await page.waitForSelector('[data-action="new-action"]');
    }
  });
  await page.locator('[data-action="new-action"]').click();
  await page.locator('input[name="name"]').fill("Browser Smoke Action");
  await page.locator('.modal-dialog button[type="submit"]').click();
  await page.waitForSelector("text=Browser Smoke Action");
  assert.equal(errors.length, 0, `browser errors: ${errors.join(" | ")}`);

  console.log("Browser smoke passed: responsive shell, navigation, modal and Action command.");
} finally {
  await browser.close();
}
