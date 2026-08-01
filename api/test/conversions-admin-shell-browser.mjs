import assert from "node:assert/strict";
import { chromium } from "playwright";
import { adminLayout } from "../src/admin/templates/layout.ts";

async function readState(page) {
  return page.evaluate(() => {
    const sidebar = document.getElementById("sidebar");
    const toggle = document.querySelector(".mobile-menu-btn");
    const active = document.activeElement;
    if (!sidebar || !toggle) throw new Error("sidebar controls are missing");
    const sidebarRect = sidebar.getBoundingClientRect();
    const activeRect = active?.getBoundingClientRect();
    return {
      activeLabel: active?.getAttribute("aria-label") ?? active?.textContent?.trim() ?? null,
      activeHref: active instanceof HTMLAnchorElement ? active.getAttribute("href") : null,
      activeRect: activeRect
        ? { left: activeRect.left, right: activeRect.right, top: activeRect.top, bottom: activeRect.bottom }
        : null,
      ariaExpanded: toggle.getAttribute("aria-expanded"),
      ariaHidden: sidebar.getAttribute("aria-hidden"),
      inert: sidebar.hasAttribute("inert") && sidebar.inert,
      open: sidebar.classList.contains("open"),
      visibility: getComputedStyle(sidebar).visibility,
      transitionDuration: getComputedStyle(sidebar).transitionDuration,
      animationDuration: getComputedStyle(sidebar).animationDuration,
      sidebarRect: {
        left: sidebarRect.left,
        right: sidebarRect.right,
        top: sidebarRect.top,
        bottom: sidebarRect.bottom,
      },
    };
  });
}

async function readSidebarAccessibility(page) {
  const session = await page.context().newCDPSession(page);
  try {
    const { nodes } = await session.send("Accessibility.getFullAXTree");
    return {
      navigationExposed: nodes.some((node) =>
        node.ignored !== true &&
        node.role?.value === "navigation" &&
        node.name?.value === "Admin sections"),
    };
  } finally {
    await session.detach();
  }
}

async function nextTwoFrames(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

function assertFocusedInViewport(state, width, height) {
  assert(state.activeRect, "expected a focused element with a bounding rectangle");
  assert(state.activeRect.right > 0 && state.activeRect.left < width, "focused element is horizontally off viewport");
  assert(state.activeRect.bottom > 0 && state.activeRect.top < height, "focused element is vertically off viewport");
}

const html = adminLayout({
  title: "Conversions browser verification",
  activePath: "/admin/conversions/flows",
  content: '<a href="/admin/content-target">Visible content target</a>',
  conversionsUiEnabled: true,
});

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 640 } });
  await page.setContent(html, { waitUntil: "load" });

  let state = await readState(page);
  assert.equal(state.ariaExpanded, "false");
  assert.equal(state.ariaHidden, "true");
  assert.equal(state.inert, true);
  assert.equal(state.open, false);
  assert.equal(state.visibility, "hidden");

  await page.keyboard.press("Tab");
  state = await readState(page);
  assert.equal(state.activeLabel, "Toggle navigation");
  assertFocusedInViewport(state, 320, 640);

  await page.keyboard.press("Tab");
  state = await readState(page);
  assert.equal(state.activeHref, "/admin/content-target");
  assertFocusedInViewport(state, 320, 640);
  await page.keyboard.press("Shift+Tab");

  await page.keyboard.press("Enter");
  await page.waitForTimeout(380);
  state = await readState(page);
  assert.equal(state.ariaExpanded, "true");
  assert.equal(state.ariaHidden, null);
  assert.equal(state.inert, false);
  assert.equal(state.open, true);
  assert.equal(state.visibility, "visible");
  assert.equal(state.activeHref, "/admin");
  assertFocusedInViewport(state, 320, 640);

  await page.keyboard.press("Escape");
  state = await readState(page);
  assert.equal(state.activeLabel, "Toggle navigation");
  assert.equal(state.ariaExpanded, "false");
  assert.equal(state.ariaHidden, "true");
  assert.equal(state.inert, true);
  assert.equal(state.open, false);
  assertFocusedInViewport(state, 320, 640);

  await page.keyboard.press("Enter");
  await page.waitForTimeout(380);
  await page.mouse.click(300, 300);
  state = await readState(page);
  assert.equal(state.activeLabel, "Toggle navigation");
  assert.equal(state.ariaExpanded, "false");
  assert.equal(state.ariaHidden, "true");
  assert.equal(state.inert, true);
  assert.equal(state.open, false);
  assertFocusedInViewport(state, 320, 640);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(50);
  state = await readState(page);
  assert.equal(state.ariaExpanded, "true");
  assert.equal(state.ariaHidden, null);
  assert.equal(state.inert, false);
  assert.equal(state.open, false);
  assert.equal(state.activeHref, "/admin");
  assert(state.sidebarRect.left >= 0 && state.sidebarRect.right <= 1440, "desktop sidebar must remain visible");
  assertFocusedInViewport(state, 1440, 900);

  await page.setViewportSize({ width: 320, height: 640 });
  await page.waitForTimeout(50);
  state = await readState(page);
  assert.equal(state.activeLabel, "Toggle navigation");
  assert.equal(state.ariaExpanded, "false");
  assert.equal(state.ariaHidden, "true");
  assert.equal(state.inert, true);
  assert.equal(state.open, false);
  assertFocusedInViewport(state, 320, 640);

  const desktopPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await desktopPage.setContent(html, { waitUntil: "load" });
  await desktopPage.keyboard.press("Tab");
  const desktopState = await readState(desktopPage);
  assert.equal(desktopState.activeHref, "/admin");
  assert.equal(desktopState.ariaHidden, null);
  assert.equal(desktopState.inert, false);
  assert.equal(desktopState.ariaExpanded, "true");
  assert.equal(desktopState.visibility, "visible");
  assertFocusedInViewport(desktopState, 1440, 900);
  await desktopPage.close();

  const noScriptContext = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 320, height: 640 },
  });
  const noScriptMobile = await noScriptContext.newPage();
  await noScriptMobile.setContent(html, { waitUntil: "load" });
  state = await readState(noScriptMobile);
  assert.equal(state.visibility, "hidden");
  assert.equal(state.ariaHidden, null);
  assert.equal(state.inert, false);
  assert.equal((await readSidebarAccessibility(noScriptMobile)).navigationExposed, false);
  await noScriptMobile.keyboard.press("Tab");
  state = await readState(noScriptMobile);
  assert.equal(state.activeLabel, "Toggle navigation");
  assertFocusedInViewport(state, 320, 640);
  await noScriptMobile.keyboard.press("Tab");
  state = await readState(noScriptMobile);
  assert.equal(state.activeHref, "/admin/content-target");
  assertFocusedInViewport(state, 320, 640);

  const noScriptDesktop = await noScriptContext.newPage();
  await noScriptDesktop.setViewportSize({ width: 1440, height: 900 });
  await noScriptDesktop.setContent(html, { waitUntil: "load" });
  state = await readState(noScriptDesktop);
  assert.equal(state.visibility, "visible");
  assert.equal((await readSidebarAccessibility(noScriptDesktop)).navigationExposed, true);
  await noScriptDesktop.keyboard.press("Tab");
  state = await readState(noScriptDesktop);
  assert.equal(state.activeHref, "/admin");
  assertFocusedInViewport(state, 1440, 900);
  await noScriptContext.close();

  const reducedPage = await browser.newPage({ viewport: { width: 320, height: 640 } });
  await reducedPage.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await reducedPage.setContent(html, { waitUntil: "load" });
  state = await readState(reducedPage);
  assert.equal(state.transitionDuration, "0s");
  assert.equal(state.animationDuration, "0s");
  await reducedPage.keyboard.press("Tab");
  await reducedPage.keyboard.press("Enter");
  await nextTwoFrames(reducedPage);
  state = await readState(reducedPage);
  assert.equal(state.activeHref, "/admin");
  assert.equal(state.visibility, "visible");
  assertFocusedInViewport(state, 320, 640);
  for (let index = 0; index < 7; index += 1) {
    await reducedPage.keyboard.press("Tab");
  }
  state = await readState(reducedPage);
  assert.equal(state.activeHref, "/admin/conversions/flows");
  assertFocusedInViewport(state, 320, 640);
  const forcedColorsFocus = await reducedPage.evaluate(() => {
    const active = document.activeElement;
    const style = active ? getComputedStyle(active) : null;
    return style ? { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth } : null;
  });
  assert(forcedColorsFocus);
  assert.notEqual(forcedColorsFocus.outlineStyle, "none");
  assert(parseFloat(forcedColorsFocus.outlineWidth) >= 3);
  await reducedPage.close();

  const dynamicMotionPage = await browser.newPage({ viewport: { width: 320, height: 640 } });
  await dynamicMotionPage.emulateMedia({ reducedMotion: "no-preference" });
  await dynamicMotionPage.setContent(html, { waitUntil: "load" });
  await dynamicMotionPage.keyboard.press("Tab");
  await dynamicMotionPage.keyboard.press("Enter");
  await dynamicMotionPage.emulateMedia({ reducedMotion: "reduce" });
  await nextTwoFrames(dynamicMotionPage);
  state = await readState(dynamicMotionPage);
  assert.equal(state.transitionDuration, "0s");
  assert.equal(state.activeHref, "/admin");
  assertFocusedInViewport(state, 320, 640);
  await dynamicMotionPage.close();

  process.stdout.write(JSON.stringify({
    result: "PASS",
    mobile: "closed sidebar inert and aria-hidden; toggle first; open/Escape/outside focus restored",
    resize: "mobile and desktop state synchronized without hidden focus",
    desktop: "sidebar visible and focusable",
    noScript: "mobile sidebar CSS-hidden and absent from AX/Tab order; desktop sidebar visible and reachable",
    media: "reduced motion zeroes sidebar duration and focuses next-frame; dynamic preference and forced colors pass",
  }) + "\n");
} finally {
  await browser.close();
}
