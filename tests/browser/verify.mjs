import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import pg from "pg";
import bcrypt from "bcryptjs";
import { chromium } from "playwright";
import { PDFDocument, StandardFonts } from "pdf-lib";
const testUrl = process.env.TEST_DATABASE_URL;
const parsed = testUrl ? new URL(testUrl) : null;
if (
  !parsed ||
  !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
  !/(?:^|_)test(?:_|$)/i.test(parsed.pathname.slice(1))
)
  throw Error(
    "Set TEST_DATABASE_URL to a named local test database. Production databases are refused.",
  );
const port = Number(process.env.TEST_PORT ?? 3445),
  base = `https://localhost:${port}`,
  out = "tmp/portal-test";
fs.mkdirSync(out, { recursive: true });
const pool = new pg.Pool({ connectionString: testUrl });
const results = { passed: [], errors: [] };
const pass = (label) => {
  results.passed.push(label);
  console.log("PASS " + label);
};
const server = spawn(process.execPath, ["scripts/serve-test.mjs"], {
  env: {
    ...process.env,
    NODE_ENV: "production",
    DATABASE_URL: testUrl,
    DIRECT_URL: testUrl,
    AUTH_SECRET: randomBytes(48).toString("base64url"),
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let serverLog = "";
server.stdout.on("data", (d) => {
  serverLog += d;
});
server.stderr.on("data", (d) => {
  serverLog += d;
});
let browser;
const post = (ctx, url, data) =>
  ctx.request.post(base + url, { headers: { Origin: base }, data });
const api = async (ctx, url) => (await ctx.request.get(base + url)).json();
const wait = async (test, label) => {
  for (let i = 0; i < 120; i++) {
    if (await test()) return;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Error("Timed out: " + label);
};
const password = "Browser-test-password-123";
async function tinyPdf() {
  const d = await PDFDocument.create(),
    p = d.addPage([595, 842]),
    f = await d.embedFont(StandardFonts.Helvetica);
  p.drawText("Reference VP-TEST-0099 | 2026-11-05", {
    x: 20,
    y: 800,
    size: 14,
    font: f,
  });
  return Buffer.from(await d.save());
}
const shiftIso = (month) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
};
async function register(page, name, email) {
  await page.goto(base + "/account/register");
  await page.locator('.portal-auth [name="name"]').fill(name);
  await page.locator('.portal-auth [name="email"]').fill(email);
  await page.locator('.portal-auth [name="password"]').fill(password);
  await page.locator('.portal-auth [name="confirm"]').fill(password);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.waitForURL(base + "/portal");
}
try {
  await wait(
    () => serverLog.includes("ISOLATED_TEST_READY") || server.exitCode !== null,
    "HTTPS test server",
  );
  if (server.exitCode !== null) throw Error(serverLog);
  await pool.query(
    "TRUNCATE users, admins, bookings, guest_chat_sessions, certificate_requests, private_documents, booking_claims, portal_audit, rate_limit_events, admin_events, blocked_dates RESTART IDENTITY CASCADE",
  );
  await pool.query(
    "INSERT INTO admins(email,name,password_hash) VALUES($1,$2,$3)",
    [
      "browser-staff@example.invalid",
      "Browser Staff",
      await bcrypt.hash(password, 12),
    ],
  );
  browser = await chromium.launch({
    ...(process.env.BROWSER_EXECUTABLE
      ? { executablePath: process.env.BROWSER_EXECUTABLE }
      : {}),
    headless: true,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const guest = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 360, height: 800 },
    reducedMotion: "reduce",
  });
  const userA = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
  });
  const userB = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const staff = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 1000 },
    reducedMotion: "reduce",
  });
  const gp = await guest.newPage(),
    a = await userA.newPage(),
    b = await userB.newPage(),
    admin = await staff.newPage();
  for (const p of [gp, a, b, admin])
    p.on("pageerror", (e) => results.errors.push(e.message));
  await gp.goto(base + "/?services=1");
  await gp
    .getByRole("button", { name: "Request Certificate", exact: true })
    .first()
    .click();
  const form = gp.locator(".portal-form.services-step form");
  for (const [name, value] of Object.entries({
    requesterName: "Guest Requester",
    email: "guest@example.invalid",
    phone: "09123456789",
    recipientName: "Browser Child",
    fatherName: "Father Test",
    motherName: "Mother Test",
    sacramentDate: "2020-01-01",
    purpose: "School record",
  }))
    await form.locator(`[name="${name}"]`).fill(value);
  await form
    .getByRole("button", { name: "Submit request", exact: true })
    .click();
  await gp.getByRole("status").filter({ hasText: "submitted" }).waitFor();
  const guestRequest = (await api(guest, "/api/certificate-requests"))
    .requests[0];
  assert.equal(guestRequest.status, "pending");
  pass(
    "Floating certificate request submits and persists pending status for its guest credential",
  );
  const docBytes = await tinyPdf();
  const evidence = await guest.request.post(base + "/api/documents", {
    headers: { Origin: base },
    multipart: {
      kind: "payment_proof",
      requestId: guestRequest.id,
      file: {
        name: "proof.pdf",
        mimeType: "application/pdf",
        buffer: docBytes,
      },
    },
  });
  assert.equal(evidence.status(), 200);
  assert.equal(
    (await api(guest, "/api/certificate-requests")).requests[0].status,
    "pending",
  );
  const forged = await guest.request.post(base + "/api/documents", {
    headers: { Origin: base },
    multipart: {
      kind: "payment_proof",
      requestId: guestRequest.id,
      file: {
        name: "fake.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from("not an image"),
      },
    },
  });
  assert.equal(forged.status(), 400);
  const otherGuest = await browser.newContext({ ignoreHTTPSErrors: true });
  assert.equal(
    (await otherGuest.request.get(base + "/api/certificate-requests")).status(),
    200,
  );
  assert.equal(
    (await api(otherGuest, "/api/certificate-requests")).requests.length,
    0,
  );
  assert.equal(
    (
      await otherGuest.request.get(base + "/admin/export?kind=records")
    ).status(),
    401,
  );
  pass(
    "Payment proof is private, type-validated, and never auto-approves a certificate or payment",
  );
  // The account is created in the same browser as an existing guest conversation.
  await a.goto(base);
  await a.evaluate(() => fetch("/api/chat"));
  const guestMessage = await post(userA, "/api/chat", {
    op: "send",
    displayName: "Account A",
    text: "Guest history before sign-up",
    clientMessageId: randomUUID(),
  });
  assert.equal(guestMessage.status(), 200);
  await register(a, "Account A", "browser-a@example.invalid");
  await register(b, "Account B", "browser-b@example.invalid");
  assert.equal((await api(userA, "/api/chat?account=1")).thread, null);
  await a.goto(base + "/portal?tab=messages");
  await a
    .getByText("Bring this browser's guest conversation into my account", {
      exact: true,
    })
    .click();
  await a.locator('[name="consent"]').check();
  await a
    .getByRole("button", { name: "Link my guest conversation", exact: true })
    .click();
  await a
    .getByRole("status")
    .filter({ hasText: "Guest conversation linked" })
    .waitFor();
  const linked = await api(userA, "/api/chat?account=1");
  assert.equal(linked.messages[0].text, "Guest history before sign-up");
  assert.equal((await api(userA, "/api/chat")).thread, null);
  const accountSend = {
    op: "send",
    conversationId: linked.thread.id,
    text: "Persistent account message",
    clientMessageId: randomUUID(),
  };
  assert.equal(
    (await post(userA, "/api/chat?account=1", accountSend)).status(),
    200,
  );
  assert.equal(
    (await post(userA, "/api/chat?account=1", accountSend)).status(),
    200,
  );
  assert.equal(
    (await api(userA, "/api/chat?account=1")).messages.filter(
      (m) => m.text === accountSend.text,
    ).length,
    1,
  );
  assert.equal(
    (
      await userB.request.get(
        base + "/api/chat?account=1&conversationId=" + linked.thread.id,
      )
    ).status(),
    404,
  );
  assert.equal(
    (await userA.request.get(base + "/api/admin/scans")).status(),
    401,
  );
  for (const type of ["wedding", "confirmation"]) {
    const response = await post(userA, "/api/certificate-requests", {
      clientRequestId: randomUUID(),
      type,
      requesterName: "Account A",
      email: "browser-b@example.invalid",
      phone: "09123456789",
      recipientName: "Browser Recipient",
      spouseName: type === "wedding" ? "Browser Spouse" : "",
      sacramentDate: "2020-01-01",
      parish: "San Antonio de Padua Parish",
      purpose: "Personal copy",
    });
    assert.equal(response.status(), 200);
    const created = await response.json();
    const record = (
      await pool.query(
        "SELECT user_id,fee FROM certificate_requests WHERE id=$1",
        [created.id],
      )
    ).rows[0];
    assert.equal(
      record.user_id,
      (
        await pool.query(
          "SELECT id FROM users WHERE email='browser-a@example.invalid'",
        )
      ).rows[0].id,
    );
    assert.equal(Number(record.fee), type === "wedding" ? 200 : 150);
  }
  assert.equal(
    (await api(userB, "/api/certificate-requests")).requests.length,
    0,
  );
  pass(
    "Registration, all applicable certificate types with server fees, account chat persistence, consent-only guest linking, send deduplication, and cross-user/admin denial",
  );
  await admin.goto(base + "/?login=1");
  await admin
    .locator('.login-card input[name="email"]')
    .fill("browser-staff@example.invalid");
  await admin.locator('.login-card input[name="password"]').fill(password);
  await admin.locator('.login-card button[type="submit"]').click();
  await admin.waitForURL(base + "/admin");
  assert.equal(
    (await staff.cookies()).find((c) => c.name === "__Host-vp_admin_session")
      ?.secure,
    true,
  );
  for (const url of ["/login", "/admin/login"]) {
    const r = await staff.request.get(base + url, { maxRedirects: 0 });
    assert.equal(r.headers().location, "/admin");
  }
  for (const kind of ["records", "bookings", "guests"]) {
    const r = await staff.request.get(base + "/admin/export?kind=" + kind);
    assert.equal(r.status(), 200);
    assert.match(r.headers()["content-type"], /text\/csv/);
    assert.match(r.headers()["content-disposition"], /attachment/);
  }
  await admin.goto(base + "/admin/reports");
  const csvDownload = admin.waitForEvent("download");
  await admin.getByRole("link", { name: "Bookings CSV", exact: true }).click();
  const csvFile = await csvDownload;
  assert.match(csvFile.suggestedFilename(), /^ViaPadua_Bookings_.*\.csv$/);
  const csvPath = path.join(out, "bookings.csv");
  await csvFile.saveAs(csvPath);
  const csvText = fs.readFileSync(csvPath, "utf8");
  assert.equal(csvText.charCodeAt(0), 0xfeff);
  assert.ok(csvText.slice(1).startsWith("Reference,Service,Date,Time,Requester"));
  assert.doesNotMatch(csvText, /<html|Sign in again/i);
  pass(
    "HTTPS admin login and all signed-in redirects open Dashboard; authorized CSV exports and UI download work; guests remain denied",
  );
  const adminSnapshot = await api(staff, "/api/admin/messages");
  assert.ok(adminSnapshot.unread > 0);
  const response = await post(staff, "/api/admin/messages", {
    op: "reply",
    conversationId: linked.thread.id,
    text: "Staff replied",
    clientMessageId: randomUUID(),
  });
  assert.equal(response.status(), 200);
  assert.equal((await api(userA, "/api/chat?account=1")).unread, 1);
  await a.goto(base + "/portal?chat=1");
  await a.getByText("Staff replied", { exact: true }).waitFor();
  await wait(
    async () => (await api(userA, "/api/chat?account=1")).unread === 0,
    "read marker",
  );
  await a.reload();
  await a.getByText("Staff replied", { exact: true }).waitFor();
  pass(
    "Admin replies, unread/read markers, and account chat survive page refresh",
  );
  await admin.goto(base + "/admin/requests");
  let card = admin
    .locator("article")
    .filter({ hasText: guestRequest.reference })
    .first();
  await card.locator('select[name="status"]').selectOption("processing");
  await card
    .locator('textarea[name="note"]')
    .fill("Parish register and requester authority checked.");
  await card.getByRole("button", { name: "Save review", exact: true }).click();
  await card
    .getByRole("button", { name: "Prepare certificate", exact: true })
    .click();
  const editor = admin.getByRole("dialog");
  const nameField = editor.locator('input.cert-field[aria-label^="Child"]');
  await nameField.waitFor();
  await nameField.fill("Edited Browser Child");
  await nameField.blur();
  // Exercise the real print preparation, replacing only the final native dialog.
  await admin.addInitScript(() => {
    window.print = () => window.top.postMessage("VP_ISOLATED_PRINT", "*");
  });
  await admin.evaluate(() => {
    window.__certificatePrinted = false;
    window.addEventListener("message", event => {
      if (event.data === "VP_ISOLATED_PRINT") window.__certificatePrinted = true;
    });
  });
  await editor.getByRole("button", { name: "Save & Print", exact: true }).click();
  await wait(() => admin.evaluate(() => window.__certificatePrinted), "certificate print preparation");
  const pdfDownload = admin.waitForEvent("download");
  await editor
    .getByRole("button", { name: "Download PDF", exact: true })
    .click();
  const file = await pdfDownload;
  const pdfPath = path.join(out, "certificate.pdf");
  await file.saveAs(pdfPath);
  const bytes = fs.readFileSync(pdfPath);
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.ok(Math.abs(pdf.getPage(0).getWidth() - (297 / 25.4) * 72) < 0.01);
  assert.ok(Math.abs(pdf.getPage(0).getHeight() - (198 / 25.4) * 72) < 0.01);
  await editor.screenshot({ path: path.join(out, "certificate-editor.png") });
  await editor.getByRole("checkbox").check();
  const releaseDownload = admin.waitForEvent("download");
  await editor
    .getByRole("button", { name: "Release PDF to requester", exact: true })
    .click();
  await releaseDownload;
  const released = (await api(guest, "/api/certificate-requests")).requests[0];
  assert.equal(released.status, "released");
  assert.ok(released.documents.length);
  const downloadUrl = "/api/documents/" + released.documents[0].id;
  const delivered = await guest.request.get(base + downloadUrl);
  assert.equal(delivered.status(), 200);
  assert.match(delivered.headers()["content-type"], /application\/pdf/);
  assert.equal((await userA.request.get(base + downloadUrl)).status(), 404);
  // No session at all: a sign-in prompt (same for every id), never the file or an attachment.
  const noSession = await otherGuest.request.get(base + downloadUrl);
  assert.equal(noSession.status(), 401);
  assert.equal(noSession.headers()["content-disposition"], undefined);
  assert.equal(
    (await otherGuest.request.get(base + "/api/documents/" + randomUUID())).status(),
    401,
  );
  pass(
    "Edited certificate produces an actual PDF at 297×198 mm, releases only after admin verification, and downloads only for its owner",
  );
  // A real booking submission must bind to the current account, ignoring the submitted email.
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 4);
  while ([0, 2].includes(date.getUTCDay()))
    date.setUTCDate(date.getUTCDate() + 1);
  const iso = date.toISOString().slice(0, 10);
  await a.goto(base + "/?services=1&service=mass-intention&step=form");
  const bookingForm = a
    .locator("form")
    .filter({ has: a.locator('[name="bookFullName"]') });
  for (const [name, value] of Object.entries({
    bookFullName: "Account A booking",
    bookEmail: "other-contact@example.invalid",
    bookContact: "09123456789",
    bookDate: iso,
    bookTime: "10:00",
    intentionPerson: "Family Test",
  }))
    await bookingForm.locator(`[name="${name}"]`).fill(value);
  await bookingForm.locator('[name="massType"]').selectOption({ index: 1 });
  await bookingForm.getByRole("radio", { name: /Pay at the Church/i }).click();
  await bookingForm
    .getByRole("button", { name: "Confirm Booking", exact: true })
    .click();
  await a.getByText("Booking Request Submitted", { exact: true }).waitFor();
  const accountBooking = (
    await pool.query(
      "SELECT b.id,b.reference,b.user_id,u.id AS owner FROM bookings b JOIN users u ON u.email=$1 WHERE b.requester_name=$2",
      ["browser-a@example.invalid", "Account A booking"],
    )
  ).rows[0];
  assert.equal(accountBooking.user_id, accountBooking.owner);
  await pool.query(
    "INSERT INTO bookings(reference,requester_name,requester_email,service,booking_date,source) VALUES('VP-TEST-0099','Historical guest','browser-a@example.invalid','Baptism','2026-11-05','legacy')",
  );
  await a.goto(base + "/portal");
  assert.equal(await a.getByText("VP-TEST-0099", { exact: true }).count(), 0);
  assert.equal(await a.getByText(/historical guest booking|claim/i).count(), 0);
  assert.equal((await staff.request.get(base + "/admin/claims", { maxRedirects: 0 })).status(), 404);
  // Ownership established before claims were retired keeps working; claim rows stay untouched.
  await pool.query("UPDATE bookings SET user_id=$1 WHERE reference='VP-TEST-0099'", [accountBooking.owner]);
  await a.reload();
  assert.match(await a.locator("main").innerText(), /VP-TEST-0099/);
  await b.goto(base + "/portal");
  assert.doesNotMatch(
    await b.locator("main").innerText(),
    /VP-TEST-0099|Account A booking/,
  );
  await gp.goto(base + "/?services=1&service=mass-intention&step=form");
  const guestBookingForm = gp
    .locator("form")
    .filter({ has: gp.locator('[name="bookFullName"]') });
  for (const [name, value] of Object.entries({
    bookFullName: "Guest GCash booking",
    bookEmail: "guest-booking@example.invalid",
    bookContact: "09123456789",
    bookDate: iso,
    bookTime: "11:30",
    intentionPerson: "Guest family",
  }))
    await guestBookingForm.locator('[name="' + name + '"]').fill(value);
  await guestBookingForm
    .locator('[name="massType"]')
    .selectOption({ index: 1 });
  await guestBookingForm.getByRole("radio", { name: /GCash/i }).click();
  await guestBookingForm
    .getByRole("button", { name: "Continue to GCash", exact: true })
    .click();
  for (const [name, value] of Object.entries({
    gcashAccountName: "Guest payer",
    gcashNumber: "09123456789",
    gcashRefNumber: "TESTUNVERIFIED123",
  }))
    await gp.locator('[name="' + name + '"]').fill(value);
  await gp.locator("#payment-proof").setInputFiles({
    name: "guest-payment.pdf",
    mimeType: "application/pdf",
    buffer: docBytes,
  });
  await gp.getByRole("button", { name: "Submit Booking", exact: true }).click();
  await gp.getByText("Booking Request Submitted", { exact: true }).waitFor();
  const guestBooking = (
    await pool.query(
      "SELECT id,user_id,status,payment_status FROM bookings WHERE requester_name='Guest GCash booking'",
    )
  ).rows[0];
  assert.equal(guestBooking.user_id, null);
  assert.equal(guestBooking.status, "pending");
  assert.equal(guestBooking.payment_status, "unpaid");
  const guestProof = (
    await pool.query("SELECT id FROM private_documents WHERE booking_id=$1", [
      guestBooking.id,
    ])
  ).rows[0];
  assert.equal(
    (
      await guest.request.get(base + "/api/documents/" + guestProof.id)
    ).status(),
    200,
  );
  assert.equal(
    (
      await userA.request.get(base + "/api/documents/" + guestProof.id)
    ).status(),
    404,
  );
  pass(
    "Guest GCash booking persists private PDF evidence under its browser credential and remains pending/unpaid",
  );
  pass(
    "Authenticated booking binds to account ID; matching email alone never grants history; claims UI/endpoint retired while established ownership keeps working for that user only",
  );
  const proof = await userA.request.post(base + "/api/documents", {
    headers: { Origin: base },
    multipart: {
      kind: "payment_proof",
      bookingId: String(accountBooking.id),
      file: {
        name: "payment.pdf",
        mimeType: "application/pdf",
        buffer: docBytes,
      },
    },
  });
  assert.equal(proof.status(), 200);
  const proofId = (await proof.json()).id;
  assert.equal(
    (await userB.request.get(base + "/api/documents/" + proofId)).status(),
    404,
  );
  assert.equal(
    (
      await pool.query("SELECT payment_status FROM bookings WHERE id=$1", [
        accountBooking.id,
      ])
    ).rows[0].payment_status,
    "unpaid",
  );
  const prematureReceipt = await staff.request.post(base + "/api/documents", {
    headers: { Origin: base },
    multipart: {
      kind: "receipt",
      verified: "true",
      bookingId: String(accountBooking.id),
      file: {
        name: "receipt.pdf",
        mimeType: "application/pdf",
        buffer: docBytes,
      },
    },
  });
  assert.equal(prematureReceipt.status(), 400);
  await admin.goto(base + "/admin/records?q=" + accountBooking.reference);
  admin.once("dialog", (d) => d.accept());
  await admin
    .getByRole("button", { name: "Mark as Paid", exact: true })
    .click();
  await wait(
    async () =>
      (
        await pool.query("SELECT payment_status FROM bookings WHERE id=$1", [
          accountBooking.id,
        ])
      ).rows[0].payment_status === "paid",
    "manual payment verification",
  );
  const receipt = await staff.request.post(base + "/api/documents", {
    headers: { Origin: base },
    multipart: {
      kind: "receipt",
      verified: "true",
      bookingId: String(accountBooking.id),
      file: {
        name: "official-receipt.pdf",
        mimeType: "application/pdf",
        buffer: docBytes,
      },
    },
  });
  assert.equal(receipt.status(), 200);
  await a.goto(base + "/portal?tab=receipts");
  const receiptDownload = a.waitForEvent("download");
  await a
    .getByRole("link", { name: "Download official receipt", exact: true })
    .click();
  const receiptPath = path.join(out, "receipt.pdf");
  await (await receiptDownload).saveAs(receiptPath);
  assert.deepEqual(fs.readFileSync(receiptPath), docBytes);
  await a.getByRole("button", { name: "Open", exact: true }).waitFor();
  const receiptId = (await pool.query("SELECT id FROM private_documents WHERE kind='receipt' LIMIT 1")).rows[0].id;
  assert.equal((await userB.request.get(base + "/api/documents/" + receiptId)).status(), 404);
  const signedOut = await browser.newContext({ ignoreHTTPSErrors: true });
  const anonymous = await signedOut.request.get(base + "/api/documents/" + receiptId);
  assert.equal(anonymous.status(), 401);
  assert.match(anonymous.headers()["content-type"], /text\/plain/);
  assert.equal(anonymous.headers()["content-disposition"], undefined);
  const anonymousCsv = await signedOut.request.get(base + "/admin/export?kind=guests");
  assert.equal(anonymousCsv.status(), 401);
  assert.equal(anonymousCsv.headers()["content-disposition"], undefined);
  await signedOut.close();
  const preview = await userA.request.get(base + "/api/documents/" + receiptId + "?preview=1");
  assert.match(preview.headers()["content-disposition"], /^inline;/);
  assert.doesNotMatch(preview.headers()["content-security-policy"], /sandbox/);
  pass(
    "Proof remains unpaid until admin review; official receipt release is gated, persistent, and ownership protected",
  );
  await pool.query(
    "INSERT INTO admin_events(title,event_date,is_public) VALUES('Public parish gathering',$1,true),('PRIVATE STAFF MEETING',$1,false)",
    [iso],
  );
  await b.goto(base + "/portal?tab=calendar&month=" + iso.slice(0, 7));
  const calendarText = await b.locator("main").innerText();
  assert.match(calendarText, /Public parish gathering/);
  assert.doesNotMatch(
    calendarText,
    /PRIVATE STAFF MEETING|Account A booking|Historical guest/,
  );
  assert.ok((await b.locator(".cal-day").count()) >= 28);
  await b.locator(`.cal-day[data-date="${iso}"]`).click();
  await b.locator(".cal-agenda").getByText("Public parish gathering").click();
  assert.equal(await b.getByRole("link", { name: "Book Now" }).getAttribute("href"), "/?services=1");
  await b.getByRole("link", { name: "Next month" }).click();
  await b.waitForURL(new RegExp("month=" + shiftIso(iso.slice(0, 7))));
  await b.goto(base + "/portal?tab=calendar");
  const todayIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
  assert.ok(await b.locator(`.cal-day.today[data-date="${todayIso}"]`).count());
  await a.goto(base + "/portal?tab=calendar&month=" + iso.slice(0, 7));
  assert.match(await a.locator(`.cal-day[data-date="${iso}"]`).getAttribute("aria-label"), /your booking/);
  await a.getByRole("button", { name: "Portal menu" }).click();
  await a.getByRole("link", { name: "Receipts" }).waitFor();
  await a.keyboard.press("Escape");
  await a.getByRole("button", { name: "Portal menu" }).waitFor();
  assert.equal(await a.getByRole("link", { name: "Receipts" }).isVisible(), false);
  pass(
    "User calendar shows month grid, today, own bookings, public events and availability without private events or other users' identities; phone drawer opens and closes with Escape",
  );
  await admin.setViewportSize({ width: 360, height: 800 });
  await admin.goto(base + "/admin/scanner");
  await staff.grantPermissions(["camera"]);
  await admin.evaluate(() => {
    // A real canvas stream avoids Edge dropping its fake camera after PDF viewing.
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640; canvas.height = 480;
      const context = canvas.getContext("2d");
      context.fillStyle = "#d7c29e"; context.fillRect(0, 0, 640, 480);
      const s = canvas.captureStream(10);
      const timer = setInterval(() => {
        if (s.getTracks().every(t => t.readyState === "ended")) clearInterval(timer);
        else { context.fillStyle = "#d7c29e"; context.fillRect(0, 0, 640, 480); }
      }, 100);
      window.__cameraTracks = s.getTracks();
      return s;
    };
  });
  await admin
    .getByRole("button", { name: "Start Camera", exact: true })
    .click();
  await admin.waitForFunction(
    () => document.querySelector("video")?.videoWidth > 0,
  );
  await admin.getByRole("button", { name: "Capture", exact: true }).click();
  assert.ok(
    await admin.evaluate(() =>
      window.__cameraTracks.every((t) => t.readyState === "ended"),
    ),
  );
  const scanPdfDownload = admin.waitForEvent("download");
  await admin.getByRole("button", { name: "Create PDF", exact: true }).click();
  assert.match((await scanPdfDownload).suggestedFilename(), /\.pdf$/);
  await admin
    .getByRole("button", { name: "Retake / clear", exact: true })
    .click();
  // Edge can remove its fake hardware device after the PDF viewer opens.
  // Use a real canvas MediaStream to test restart/navigation cleanup independently.
  await admin.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 640; canvas.height = 480;
      const context = canvas.getContext("2d");
      const media = canvas.captureStream(10);
      const paint = () => { context.fillStyle = "#f4c928"; context.fillRect(0, 0, 640, 480); };
      paint();
      const timer = setInterval(() => {
        if (media.getTracks().every(t => t.readyState === "ended")) clearInterval(timer);
        else paint();
      }, 100);
      window.__cameraTracks = media.getTracks();
      return media;
    };
  });
  await admin
    .getByRole("button", { name: "Start Camera", exact: true })
    .click();
  await admin.waitForFunction(
    () => document.querySelector("video")?.videoWidth > 0,
  );
  await admin.getByRole("link", { name: "Dashboard", exact: true }).click();
  await wait(
    () =>
      admin.evaluate(() =>
        window.__cameraTracks.every((t) => t.readyState === "ended"),
      ),
    "camera tracks stopped on navigation",
  );
  await admin.goto(base + "/admin/scanner");
  const resolvedReference = await api(
    staff,
    "/api/admin/scans?reference=" + guestRequest.id,
  );
  assert.equal(resolvedReference.resolved.kind, "request");
  await admin.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      throw new DOMException("Denied for test", "NotAllowedError");
    };
  });
  await admin
    .getByRole("button", { name: "Start Camera", exact: true })
    .click();
  await admin.getByRole("status").filter({ hasText: "declined" }).waitFor();
  await admin.locator('input[type="file"]').setInputFiles({
    name: "external-scan.pdf",
    mimeType: "application/pdf",
    buffer: docBytes,
  });
  await admin
    .getByRole("button", { name: "Read PDF text / QR locally", exact: true })
    .click();
  await wait(
    async () =>
      (await admin.locator("textarea").first().inputValue()).includes(
        "VP-TEST-0099",
      ),
    "local PDF text extraction",
  );
  await admin
    .getByRole("button", { name: "Save unassigned scan", exact: true })
    .click();
  await admin
    .getByRole("status")
    .filter({ hasText: "Saved privately" })
    .waitFor();
  await admin
    .getByRole("button", { name: "Find possible matches", exact: true })
    .click();
  await admin
    .getByText("Reference found in extracted text", { exact: true })
    .waitFor();
  const scanRow = (
    await pool.query(
      "SELECT id,booking_id FROM private_documents WHERE kind='scan' ORDER BY created_at DESC LIMIT 1",
    )
  ).rows[0];
  assert.equal(scanRow.booking_id, null);
  await admin
    .getByLabel("Why this record matches (required before attachment)")
    .fill("Reference and name on source checked against the parish register.");
  admin.once("dialog", (d) => d.accept());
  await admin
    .getByRole("button", {
      name: "Confirm attachment to this booking",
      exact: true,
    })
    .click();
  await admin
    .getByRole("status")
    .filter({ hasText: "Attachment recorded" })
    .waitFor();
  assert.ok(
    (
      await pool.query("SELECT booking_id FROM private_documents WHERE id=$1", [
        scanRow.id,
      ])
    ).rows[0].booking_id,
  );
  assert.ok(
    (
      await pool.query(
        "SELECT admin_id FROM portal_audit WHERE action='scan_attached' AND target_id=$1",
        [scanRow.id],
      )
    ).rows[0].admin_id,
  );
  assert.equal(
    (await userA.request.get(base + "/api/admin/scans")).status(),
    401,
  );
  pass(
    "Small-phone scanner captures with a synthetic rear-camera stream, stops tracks, handles permission refusal, imports/extracts PDF locally, and requires audited attachment confirmation",
  );
  for (const [page, label, url] of [
    [gp, "services-mobile", "/?services=1"],
    [a, "portal-mobile", "/portal"],
    [admin, "scanner-mobile", "/admin/scanner"],
    [admin, "messages-mobile", "/admin/messages"],
    [admin, "reports-mobile", "/admin/reports"],
    [admin, "records-mobile", "/admin/records"],
  ]) {
    await page.goto(base + url);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      ),
      false,
      label + " overflow",
    );
    await page.screenshot({
      path: path.join(out, label + ".png"),
      fullPage: true,
    });
  }
  pass(
    "360/390 px services, account portal and admin scanner have no horizontal page overflow",
  );
  await a.goto(base + "/portal");
  await a.getByRole("button", { name: "Portal menu" }).click();
  await a.getByRole("button", { name: "Log out", exact: true }).click();
  await a.waitForURL(base + "/");
  for (const viewport of [{ width: 360, height: 740 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 900 }]) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport, reducedMotion: "reduce" });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => results.errors.push(e.message));
    const legacy = await ctx.request.get(base + "/account/login", { maxRedirects: 0 });
    assert.equal(legacy.headers().location, "/?signin=1");
    await p.goto(base + "/portal?tab=calendar");
    await p.waitForURL(/\/\?signin=1&next=%2Fportal%3Ftab%3Dcalendar/);
    const card = p.getByRole("dialog", { name: "Sign In", exact: true });
    await card.waitFor();
    assert.match(await card.innerText(), /Parishioner account/i);
    await wait(() => p.evaluate(() => document.activeElement?.getAttribute("name") === "email"), "sign-in focus");
    await card.locator('input[name="email"]').fill("browser-a@example.invalid");
    const pw = card.locator('input[name="password"]');
    await pw.fill("wrong-password-1");
    await pw.focus();
    await card.getByRole("button", { name: "Show password" }).click();
    assert.equal(await pw.getAttribute("type"), "text");
    assert.equal(await pw.inputValue(), "wrong-password-1");
    assert.equal(await p.evaluate(() => document.activeElement?.getAttribute("name")), "password");
    await card.getByRole("button", { name: "Hide password" }).click();
    assert.equal(await pw.getAttribute("type"), "password");
    await card.getByRole("button", { name: "Sign In", exact: true }).click();
    await card.getByRole("alert").filter({ hasText: "Invalid email or password." }).waitFor();
    assert.equal(await card.locator('input[name="email"]').inputValue(), "browser-a@example.invalid");
    await p.keyboard.press("Escape");
    await card.waitFor({ state: "hidden" });
    await p.getByRole("link", { name: "Sign in" }).click();
    await card.waitFor();
    await card.getByRole("button", { name: "Admin sign in" }).click();
    await p.getByRole("dialog", { name: "Admin Sign In" }).waitFor();
    assert.equal(await card.isVisible(), false);
    await p.getByRole("dialog", { name: "Admin Sign In" }).getByRole("button", { name: "Show password" }).waitFor();
    await p.goto(base + "/?signin=1&next=%2Fportal%3Ftab%3Dcalendar");
    await card.locator('input[name="email"]').fill("browser-a@example.invalid");
    await card.locator('input[name="password"]').fill(password);
    await card.getByRole("button", { name: "Sign In", exact: true }).click();
    await p.waitForURL(base + "/portal?tab=calendar");
    await p.locator(".cal-day").first().waitFor();
    await p.screenshot({ path: path.join(out, `calendar-${viewport.width}.png`), fullPage: true });
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "calendar overflow " + viewport.width);
    // Services workspace opens over the portal without leaving it, and closing restores the same view.
    const phone = viewport.width < 900;
    const services = p.getByRole("dialog", { name: "Parish Services" });
    await p.locator(`.cal-day[data-date="${iso}"]`).click();
    await p.evaluate(() => window.scrollTo(0, 260));
    const scrollBefore = await p.evaluate(() => window.scrollY);
    if (phone) {
      await p.getByRole("button", { name: "Portal menu" }).click();
      assert.ok((await p.locator(".portal-sidebar").boundingBox()).width <= 300);
    } else {
      const side = await p.locator(".portal-sidebar").boundingBox();
      assert.ok(side.width >= 220 && side.width <= 240, "sidebar width " + side.width);
    }
    await p.getByRole("link", { name: "Book / request a certificate" }).click();
    await services.waitFor();
    assert.equal(new URL(p.url()).pathname, "/portal");
    assert.equal(new URL(p.url()).searchParams.get("tab"), "calendar");
    assert.equal(new URL(p.url()).searchParams.get("services"), "1");
    assert.equal(await p.locator(".public-overlay:not([hidden])").count(), 1);
    assert.equal(await p.evaluate(() => getComputedStyle(document.body).overflow), "hidden");
    const box = await services.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1, "services card fits " + viewport.width);
    for (const btn of await services.getByRole("button").all())
      if (await btn.isVisible()) {
        const b = await btn.boundingBox();
        assert.ok(b.height >= 36, "touch target " + (await btn.innerText()) + " " + b.height);
      }
    await p.keyboard.press("Escape");
    await services.waitFor({ state: "hidden" });
    assert.equal(new URL(p.url()).search, "?tab=calendar");
    assert.equal(await p.locator(`.cal-day[data-date="${iso}"]`).getAttribute("aria-pressed"), "true");
    assert.equal(await p.evaluate(() => window.scrollY), scrollBefore);
    assert.equal(await p.evaluate(() => getComputedStyle(document.body).overflow), "visible");
    assert.ok(await p.evaluate(() => document.activeElement && document.activeElement !== document.body), "focus returned");
    await p.getByRole("link", { name: "Book Now" }).click();
    await services.waitFor();
    // Unsaved input asks before leaving; Back closes the card and stays in the portal.
    await services.getByRole("button", { name: "Request Certificate", exact: true }).first().click();
    await services.locator('[name="requesterName"]').fill("Draft name");
    p.once("dialog", (d) => d.dismiss());
    await p.keyboard.press("Escape");
    await p.waitForTimeout(150);
    assert.ok(await services.isVisible(), "dirty form kept open after cancelling the prompt");
    const acceptLeave = (d) => d.accept();
    p.on("dialog", acceptLeave);
    await p.goBack();
    await p.goBack();
    await services.waitFor({ state: "hidden" });
    p.off("dialog", acceptLeave);
    assert.equal(new URL(p.url()).pathname, "/portal");
    assert.equal(await p.locator(`.cal-day[data-date="${iso}"]`).getAttribute("aria-pressed"), "true");
    if (viewport.width === 1280) {
      // Authenticated booking and certificate request submitted from inside the portal stay bound to this account.
      await p.goto(base + "/portal?tab=bookings&services=1&service=mass-intention&step=form");
      const portalForm = services.locator("form").filter({ has: p.locator('[name="bookFullName"]') });
      for (const [name, value] of Object.entries({ bookFullName: "Portal overlay booking", bookEmail: "portal-contact@example.invalid", bookContact: "09123456789", bookDate: iso, bookTime: "14:00", intentionPerson: "Portal family" }))
        await portalForm.locator(`[name="${name}"]`).fill(value);
      await portalForm.locator('[name="massType"]').selectOption({ index: 1 });
      await portalForm.getByRole("radio", { name: /Pay at the Church/i }).click();
      await portalForm.getByRole("button", { name: "Confirm Booking", exact: true }).click();
      await p.getByText("Booking Request Submitted", { exact: true }).waitFor();
      assert.equal(new URL(p.url()).pathname, "/portal");
      const owner = (await pool.query("SELECT b.user_id, u.email FROM bookings b JOIN users u ON u.id=b.user_id WHERE b.requester_name='Portal overlay booking'")).rows[0];
      assert.equal(owner.email, "browser-a@example.invalid");
      await services.getByRole("button", { name: /Close/ }).first().click();
      await services.waitFor({ state: "hidden" });
      await p.reload();
      assert.match(await p.locator("main").innerText(), /Mass Intention/);
      await p.goto(base + "/portal?tab=certificates");
      await p.getByRole("link", { name: "Book / request a certificate" }).click();
      await services.getByRole("button", { name: "Request Certificate", exact: true }).first().click();
      const certForm = services.locator(".portal-form.services-step form");
      for (const [name, value] of Object.entries({ requesterName: "Portal Requester", email: "portal-req@example.invalid", phone: "09123456789", recipientName: "Portal Child", fatherName: "Father P", motherName: "Mother P", sacramentDate: "2019-02-02", purpose: "School record" }))
        await certForm.locator(`[name="${name}"]`).fill(value);
      await certForm.getByRole("button", { name: "Submit request", exact: true }).click();
      await services.getByRole("status").filter({ hasText: "submitted" }).waitFor();
      const req = (await pool.query("SELECT u.email FROM certificate_requests r JOIN users u ON u.id=r.user_id WHERE r.requester_name='Portal Requester'")).rows[0];
      assert.equal(req?.email, "browser-a@example.invalid");
      assert.equal(new URL(p.url()).pathname, "/portal");
    }
    await p.screenshot({ path: path.join(out, `portal-overlay-${viewport.width}.png`) });
    const back = await ctx.request.get(base + "/account/login?next=https://evil.example", { maxRedirects: 0 });
    assert.equal(back.headers().location, "/portal");
    await ctx.close();
  }
  pass(
    "Floating parishioner sign-in: legacy URL redirect, safe return, focus, Escape, inline error keeps email, password visibility toggle keeps value and focus, admin card switch, desktop/mobile calendar without overflow",
  );
  pass(
    "Portal services card at 360/390/768/1280 px: opens over the portal (drawer on phones), keeps tab, selected date, scroll and focus; Escape, Back and the unsaved-input prompt work; account-bound booking and certificate request submitted inside the portal",
  );
  assert.equal(
    (await userA.request.get(base + "/api/chat?account=1")).status(),
    401,
  );
  await admin.goto(base + "/admin");
  await admin.getByRole("button", { name: "Log out", exact: true }).click();
  await admin.waitForURL(base + "/");
  assert.equal(
    (await staff.request.get(base + "/admin/export?kind=records")).status(),
    401,
  );
  pass(
    "User/admin logout return home and revoke private account chat/export access",
  );
  assert.deepEqual(results.errors, []);
} catch (error) {
  results.failure = error.stack;
  console.error(error);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(
    path.join(out, "browser-results.json"),
    JSON.stringify(results, null, 2),
  );
  fs.writeFileSync(path.join(out, "server.log"), serverLog);
  await browser?.close();
  server.kill();
  await pool.end();
}
