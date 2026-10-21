import assert from "node:assert/strict";
import { it } from "node:test";
import { ownsRecord } from "@/lib/portal/access";
import { registerSchema } from "@/lib/auth/user";
import { requestSchema } from "@/lib/certificates/requests";
import { randomUUID } from "node:crypto";
import { validateFile, MAX_FILE_BYTES } from "@/lib/documents/files";
it("ownership requires account ID or unexpired browser credential, never matching contact", () => {
  const guest = {
    userId: null,
    guestHash: "credential",
    guestExpiresAt: new Date(Date.now() + 60000),
  };
  assert.equal(ownsRecord({}, guest), false);
  assert.equal(ownsRecord({ guestHash: "other" }, guest), false);
  assert.equal(ownsRecord({ guestHash: "credential" }, guest), true);
  assert.equal(
    ownsRecord(
      { guestHash: "credential" },
      { ...guest, guestExpiresAt: new Date(0) },
    ),
    false,
  );
  assert.equal(
    ownsRecord({ userId: 1, guestHash: "credential" }, { ...guest, userId: 2 }),
    false,
  );
  assert.equal(ownsRecord({ userId: 2 }, { ...guest, userId: 2 }), true);
});
it("public registration rejects admin-role injection and bcrypt truncation", () => {
  const data = {
    name: "Ana Test",
    email: "ana@example.invalid",
    password: "a-secure-password",
    confirm: "a-secure-password",
    website: "",
  };
  assert.ok(registerSchema.safeParse(data).success);
  assert.equal(
    registerSchema.safeParse({ ...data, role: "admin" }).success,
    false,
  );
  assert.equal(
    registerSchema.safeParse({
      ...data,
      password: "😀".repeat(20),
      confirm: "😀".repeat(20),
    }).success,
    false,
  );
});
it("certificate requests validate type, record date and marriage/baptism identity fields", () => {
  const data = {
    clientRequestId: randomUUID(),
    type: "baptism",
    requesterName: "Ana Test",
    email: "ana@example.invalid",
    phone: "09123456789",
    recipientName: "Child Test",
    fatherName: "Father Test",
    motherName: "Mother Test",
    sacramentDate: "2020-01-01",
    parish: "San Antonio de Padua",
    purpose: "School record",
  };
  assert.ok(requestSchema.safeParse(data).success);
  for (const change of [
    { type: "unknown" },
    { sacramentDate: "2020-02-30" },
    { sacramentDate: "2099-01-01" },
    { fatherName: "" },
    { type: "wedding", spouseName: "" },
  ])
    assert.equal(
      requestSchema.safeParse({ ...data, ...change }).success,
      false,
    );
});
it("private uploads reject spoofed, corrupt and oversized files", async () => {
  await assert.rejects(
    validateFile(
      new File(["<script>evil()</script>"], "receipt.jpg", {
        type: "image/jpeg",
      }),
    ),
  );
  await assert.rejects(
    validateFile(
      new File(["%PDF-1.4 invalid"], "receipt.pdf", {
        type: "application/pdf",
      }),
    ),
  );
  await assert.rejects(
    validateFile(new File([new Uint8Array(MAX_FILE_BYTES + 1)], "huge.png")),
  );
});
