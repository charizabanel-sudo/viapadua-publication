import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Db } from "@/lib/db/client";
import {
  selectUniqueScanMatch,
  suggestBookings,
  suggestUsers,
} from "@/lib/documents/scans";

const rows = [
  {
    id: 1,
    reference: "VP-AAAA-0001",
    requesterName: "purple",
    bookingDate: new Date("2026-11-09T00:00:00.000Z"),
    service: "Funeral",
    userId: 7,
  },
  {
    id: 2,
    reference: "VP-AAAA-0002",
    requesterName: "purple",
    bookingDate: new Date("2026-11-26T00:00:00.000Z"),
    service: "Baptism",
    userId: 7,
  },
  {
    id: 3,
    reference: "VP-AAAA-0003",
    requesterName: "purple",
    bookingDate: new Date("2026-11-19T00:00:00.000Z"),
    service: "Baptism",
    userId: 7,
  },
];

function mockDb(): Db {
  return {
    booking: { findMany: async () => rows },
    user: {
      findMany: async () => [
        { id: 7, fullname: "purple", email: "purple@example.com" },
      ],
    },
  } as unknown as Db;
}

describe("document scan matching", () => {
  it("does not choose among repeated records from a name alone", async () => {
    const candidates = await suggestBookings(mockDb(), "purple");

    assert.equal(candidates.length, 3);
    assert.deepEqual(selectUniqueScanMatch(candidates), []);
  });

  it("returns one confident match when the name, date, and service distinguish it", async () => {
    const candidates = await suggestBookings(
      mockDb(),
      "purple 2026-11-09 Funeral",
    );
    const [match] = selectUniqueScanMatch(candidates);

    assert.equal(match?.id, 1);
    assert.equal(match?.score, 98);
  });

  it("prefers an exact reference over ambiguous same-name records", async () => {
    const candidates = await suggestBookings(
      mockDb(),
      "purple reference VP-AAAA-0002",
    );
    const [match] = selectUniqueScanMatch(candidates);

    assert.equal(match?.id, 2);
    assert.equal(match?.score, 100);
  });

  it("identifies one account owner instead of returning each booking for that owner", async () => {
    const matches = await suggestUsers(
      mockDb(),
      "Document holder: purple",
      "purple",
    );
    const [match] = selectUniqueScanMatch(matches);

    assert.equal(matches.length, 1);
    assert.equal(match?.kind, "user");
    assert.equal(match?.id, 7);
    assert.equal(match?.owner?.email, "purple@example.com");
  });

  it("uses the service subject stored on a booking rather than only its requester name", async () => {
    const db = {
      ...mockDb(),
      booking: {
        findMany: async () => [
          {
            ...rows[0],
            requesterName: "Account Holder",
            details: { deceasedName: "Maria Dela Cruz", dateOfDeath: "2026-11-09" },
          },
        ],
      },
    } as unknown as Db;
    const [match] = await suggestBookings(
      db,
      "Maria Dela Cruz Funeral 2026-11-09",
    );

    assert.equal(match?.matchedName, "Maria Dela Cruz");
    assert.equal(match?.score, 98);
  });
});
