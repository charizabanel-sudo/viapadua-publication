import assert from "node:assert/strict";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { chromium } from "playwright";

const testUrl = process.env.TEST_DATABASE_URL;
const parsed = new URL(testUrl ?? "http://invalid");
if (!["127.0.0.1", "localhost"].includes(parsed.hostname) || !/(?:^|_)test(?:_|$)/i.test(parsed.pathname.slice(1))) throw Error("Only a named local test database is allowed");
const base = "https://localhost:3445", out = "tmp/redesign-test";
fs.mkdirSync(out, { recursive: true });
const pool = new pg.Pool({ connectionString: testUrl });
const server = spawn(process.execPath, ["scripts/serve-test.mjs"], { env: { ...process.env, NODE_ENV: "production", DATABASE_URL: testUrl, DIRECT_URL: testUrl, AUTH_SECRET: randomBytes(48).toString("base64url") }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
let logs = "", browser, zoomContext;
server.stdout.on("data", data => { logs += data; });
server.stderr.on("data", data => { logs += data; });
const passed = [], errors = [];
const pass = label => { passed.push(label); console.log("PASS " + label); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function noOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  if (dimensions.scroll > dimensions.width + 1) { console.log(await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => { let parent = el.parentElement; while (parent && parent !== document.body) { if (/auto|hidden|clip|scroll/.test(getComputedStyle(parent).overflowX)) return false; parent = parent.parentElement; } return true; }).map(el => ({ tag: el.tagName, class: el.className, right: el.getBoundingClientRect().right, width: el.getBoundingClientRect().width, overflow: getComputedStyle(el).overflowX })).filter(el => el.right > innerWidth + 1).slice(0, 15))); console.log(await page.locator('body,.vp-admin,.dashboard,.main-content,.table-wrap,.month-bars').evaluateAll(items => items.map(el => ({ class: el.className, width: el.clientWidth, scroll: el.scrollWidth, overflow: getComputedStyle(el).overflowX, pos: getComputedStyle(el).position })))); await page.screenshot({ path: out + '/overflow.png', fullPage: true }); }
  assert.ok(dimensions.scroll <= dimensions.width + 1, label + " page overflow: " + JSON.stringify(dimensions));
}
async function focusTrapped(page, dialog) {
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')].some(el => el.getClientRects().length > 0 && el.contains(document.activeElement)));
  for (let i = 0; i < 24; i++) { await page.keyboard.press("Tab"); assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)), "Tab escaped dialog at " + i + ": " + await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 350))); }
  for (let i = 0; i < 3; i++) { await page.keyboard.press("Shift+Tab"); assert.ok(await dialog.evaluate(el => el.contains(document.activeElement)), "Shift+Tab escaped dialog"); }
}
try {
  for (let i = 0; i < 120 && !logs.includes("ISOLATED_TEST_READY"); i++) { if (server.exitCode !== null) throw Error(logs); await delay(250); }
  assert.match(logs, /ISOLATED_TEST_READY/);
  await pool.query("UPDATE admins SET name=$1 WHERE email='browser-staff@example.invalid'", ["Administrator Maria Alexandra de los Santos Villanueva"]);
  await pool.query("INSERT INTO bookings(reference,requester_name,requester_email,service,booking_date,booking_time,fee) VALUES('VP-REDESIGN-0001',$1,'layout@example.invalid','Baptism',CURRENT_DATE + 1,'09:30',500) ON CONFLICT(reference) DO UPDATE SET requester_name=EXCLUDED.requester_name,status='pending'", ["Maria Alexandra Concepcion de los Santos Villanueva and Family"]);
  browser = await chromium.launch({ ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}), headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", hasTouch: true });
  const staff = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const publicPage = await context.newPage(), admin = await staff.newPage();
  for (const page of [publicPage, admin]) page.on("pageerror", error => errors.push(error.message));
  await publicPage.goto(base);
  await publicPage.locator('.vp-splash').waitFor({ state: 'hidden' });
  await publicPage.screenshot({ path: out + "/home-desktop.png", fullPage: true });
  await publicPage.getByRole("button", { name: "Next service", exact: true }).focus();
  await publicPage.keyboard.press("ArrowRight");
  await publicPage.locator(".showcase-card.active").getByRole("heading", { name: "Wedding", exact: true }).waitFor();
  await publicPage.keyboard.press("ArrowLeft");
  await publicPage.locator(".showcase-card.active").getByRole("heading", { name: "Baptism", exact: true }).waitFor();
  assert.equal(await publicPage.locator(".showcase-card[inert]").count(), 5);
  await publicPage.locator(".showcase-card.active").getByRole("link", { name: /Request Certificate/ }).click();
  const services = publicPage.getByRole("dialog");
  assert.equal(await services.locator(".services-step select").first().inputValue(), "baptism");
  await focusTrapped(publicPage, services);
  await publicPage.keyboard.press("Escape");
  await services.waitFor({ state: "hidden" });
  assert.ok(await publicPage.locator(".showcase-card.active .showcase-certificate").evaluate(el => el === document.activeElement));
  await publicPage.locator(".showcase-card.active .showcase-book").click();
  await publicPage.getByRole("heading", { name: /Book Baptism/ }).waitFor();
  await publicPage.keyboard.press("Escape");
  pass("Carousel keyboard controls, inactive-card isolation, matching booking/certificate forms, focus trap and focus return");
  await admin.goto(base + "/?login=1");
  await admin.locator('.login-card input[name="email"]').fill("browser-staff@example.invalid");
  await admin.locator('.login-card input[name="password"]').fill("Browser-test-password-123");
  await admin.locator('.login-card button[type="submit"]').click();
  await admin.waitForURL(base + "/admin");
  for (const width of [360, 390, 768, 1440]) {
    const height = width < 500 ? 844 : 1000;
    await publicPage.setViewportSize({ width, height });
    await admin.setViewportSize({ width, height });
    await publicPage.goto(base);
    await noOverflow(publicPage, "Home " + width);
    const card = await publicPage.locator('.showcase-card.active').boundingBox();
    assert.ok(card.x >= 0 && card.x + card.width <= width, "Active service card escapes viewport");
    for (const route of ["/account/login", "/account/register", "/?services=1"]) {
      await publicPage.goto(base + route); await noOverflow(publicPage, route + " " + width);
    }
    await publicPage.keyboard.press("Escape");
    for (const route of ["/admin", "/admin/bookings", "/admin/events", "/admin/records", "/admin/calendar", "/admin/reports", "/admin/messages", "/admin/claims", "/admin/scanner", "/admin/requests"]) {
      await admin.goto(base + route); await noOverflow(admin, route + " " + width);
      if (["/admin", "/admin/bookings"].includes(route)) await admin.screenshot({ path: `${out}/${route === '/admin' ? 'dashboard' : 'bookings'}-${width}.png`, fullPage: true });
    }
    await publicPage.goto(base);
    if (width === 390) {
      await publicPage.locator('.showcase-stage').evaluate(el => {
        const first = new Touch({ identifier: 0, target: el, clientX: 290, clientY: 400 });
        const last = new Touch({ identifier: 0, target: el, clientX: 90, clientY: 410 });
        el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [first] }));
        el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, changedTouches: [last] }));
      });
      await publicPage.locator('.showcase-card.active').getByRole('heading', { name: 'Wedding', exact: true }).waitFor();
    }
    await publicPage.screenshot({ path: `${out}/home-${width}.png`, fullPage: true });
  }
  pass("360/390px phones, 768px tablet and 1440px desktop: homepage, account forms, floating services and all ten admin routes stay within viewport; touch swipe works");
  await admin.setViewportSize({ width: 1440, height: 500 });
  await admin.goto(base + "/admin");
  const sidebar = await admin.locator('.sidebar-nav').evaluate(el => ({ scrolls: el.scrollHeight > el.clientHeight, height: el.clientHeight }));
  assert.ok(sidebar.scrolls && sidebar.height > 0);
  await admin.locator('.sidebar-nav a').last().focus();
  assert.ok(await admin.locator('.sidebar-nav').evaluate(el => el.scrollTop > 0));
  const logout = await admin.getByRole('button', { name: 'Log out', exact: true }).boundingBox();
  assert.ok(logout.y >= 0 && logout.y + logout.height <= 500);
  pass("Short-window sidebar scrolls by keyboard while account/logout remain accessible; long account/requester names wrap or truncate safely");
  await admin.setViewportSize({ width: 1440, height: 1000 });
  await admin.goto(base + '/admin/bookings');
  const fixture = admin.locator('.payment-card').filter({ hasText: 'VP-REDESIGN-0001' });
  await fixture.getByRole('link', { name: 'View', exact: true }).click();
  await focusTrapped(admin, admin.getByRole('dialog'));
  await admin.keyboard.press('Escape');
  await admin.getByRole('dialog').waitFor({ state: 'hidden' });
  pass("Booking detail dialog traps forward/backward keyboard focus and closes with Escape");
  assert.equal(await publicPage.locator('.hero-emblem').evaluate(el => getComputedStyle(el).transform), 'none');
  await publicPage.goto(base + '/account/login');
  await publicPage.locator('.portal-auth input[name="email"]').fill('browser-a@example.invalid');
  await publicPage.locator('.portal-auth input[name="password"]').fill('Browser-test-password-123');
  await publicPage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await publicPage.waitForURL(base + '/portal');
  for (const width of [360, 390, 768, 1440]) {
    await publicPage.setViewportSize({ width, height: 900 });
    for (const tab of ['bookings', 'calendar', 'receipts', 'certificates']) { await publicPage.goto(base + '/portal?tab=' + tab); await noOverflow(publicPage, 'Portal ' + tab + ' ' + width); }
    if (width === 390) await publicPage.screenshot({ path: out + '/portal-390.png', fullPage: true });
  }
  pass("Authenticated bookings/calendar/receipts/certificates portal tabs fit all four viewport sizes");
  const motionContext = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 1000 }, reducedMotion: 'no-preference' });
  const motion = await motionContext.newPage();
  await motion.goto(base);
  await motion.locator('.vp-splash').waitFor({ state: 'hidden' });
  const scene = await motion.locator('.hero-emblem-scene').boundingBox();
  await motion.mouse.move(scene.x + scene.width * .75, scene.y + scene.height * .7);
  assert.ok(await motion.locator('.hero-emblem').evaluate(el => el.style.getPropertyValue('--tilt-y')));
  const activeTitle = await motion.locator('.showcase-card.active h3').innerText();
  await delay(600);
  assert.equal(await motion.locator('.showcase-card.active h3').innerText(), activeTitle);
  await motionContext.close();
  pass("Desktop pointer tilt works, reduced-motion hero remains stable, and the carousel does not autoplay");
  // A separate disposable browser profile applies Chromium's native default zoom preference.
  const profile = out + '/zoom-profile-' + Date.now();
  fs.mkdirSync(profile + '/Default', { recursive: true });
  fs.writeFileSync(profile + '/Default/Preferences', JSON.stringify({ partition: { default_zoom_level: Math.log(2) / Math.log(1.2) } }));
  zoomContext = await chromium.launchPersistentContext(profile, { ...(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : {}), headless: true, viewport: null, ignoreHTTPSErrors: true, reducedMotion: 'reduce', args: ['--window-size=1440,1000'] });
  const zoomSettings = await zoomContext.newPage();
  try {
    await zoomSettings.goto('edge://settings/appearance', { timeout: 10000 });
    await zoomSettings.evaluate(() => window.chrome?.send?.('setDefaultZoom', [2]));
  } catch { /* Unsupported browser settings fall back to the explicit CSS reflow check below. */ }
  await zoomSettings.close();
  await zoomContext.addCookies(await staff.cookies());
  const zoomPage = await zoomContext.newPage();
  await zoomPage.goto(base + '/admin');
  const zoom = await zoomPage.evaluate(() => ({ cssWidth: innerWidth, outer: outerWidth, dpr: devicePixelRatio }));
  console.log('Native zoom metrics ' + JSON.stringify(zoom));
  const nativeZoom = zoom.dpr > 1.9 && zoom.dpr < 2.1;
  if (!nativeZoom) await zoomPage.setViewportSize({ width: 720, height: 500 });
  for (const route of ['/admin', '/admin/bookings', '/admin/events', '/admin/records', '/admin/calendar', '/admin/reports', '/admin/messages', '/admin/claims', '/admin/scanner', '/admin/requests']) { await zoomPage.goto(base + route); await noOverflow(zoomPage, '200% zoom ' + route); }
  await zoomPage.screenshot({ path: out + '/zoom-reflow.png', fullPage: true });
  await zoomContext.clearCookies();
  for (const route of ['/', '/account/login', '/account/register', '/?services=1']) { await zoomPage.goto(base + route); await noOverflow(zoomPage, '200% zoom ' + route); }
  pass(nativeZoom ? "Native 200% browser zoom fits public pages, account forms, floating services and all admin modules" : "200% equivalent CSS viewport fits public pages, forms, services and all admin modules (native browser zoom unavailable)");
  assert.deepEqual(errors, []);
  assert.doesNotMatch(logs, /quality.*not configured|qualities.*config/i);
} catch (error) { console.error(error); errors.push(error.stack); process.exitCode = 1; }
finally { fs.writeFileSync(out + '/results.json', JSON.stringify({ passed, errors }, null, 2)); fs.writeFileSync(out + '/server.log', logs); await zoomContext?.close(); await browser?.close(); server.kill(); await pool.end(); }
