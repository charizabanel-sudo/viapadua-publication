import { z } from "zod";
import type { Db } from "@/lib/db/client";
import { EXCLUDE_SAMPLES } from "@/lib/booking/samples";

export async function findDocumentReference(db: Db, reference: string) {
  const isUuid = z.uuid().safeParse(reference).success;
  const [document, bookingByDocumentReference, bookingByReference, requestById, requestByReference] =
    await Promise.all([
      isUuid
        ? db.privateDocument.findUnique({
            where: { reference },
            select: { id: true, bookingId: true, requestId: true },
          })
        : null,
      isUuid
        ? db.booking.findUnique({
            where: { documentReference: reference },
            select: {
              id: true,
              reference: true,
              requesterName: true,
              bookingDate: true,
              userId: true,
            },
          })
        : null,
      db.booking.findUnique({
        where: { reference },
        select: {
          id: true,
          reference: true,
          requesterName: true,
          bookingDate: true,
          userId: true,
        },
      }),
      isUuid
        ? db.certificateRequest.findUnique({
            where: { id: reference },
            select: { id: true, reference: true, requesterName: true, userId: true },
          })
        : null,
      db.certificateRequest.findUnique({
        where: { reference },
        select: { id: true, reference: true, requesterName: true, userId: true },
      }),
    ]);

  const match = document
    ? { kind: "document", ...document }
    : bookingByDocumentReference
      ? { kind: "booking", ...bookingByDocumentReference }
      : bookingByReference
        ? { kind: "booking", ...bookingByReference }
        : requestById
          ? { kind: "request", ...requestById }
          : requestByReference
            ? { kind: "request", ...requestByReference }
            : null;

  if (!match || !("userId" in match)) return match;
  const [withOwner] = await attachOwners(db, [{ userId: match.userId }]);
  return { ...match, owner: withOwner?.owner ?? null };
}

// ---------------------------------------------------------------------------
// Name matching: lets a plain photo/PDF be matched to a record (and its user)
// using only the OCR text, with no reference code required.
// ---------------------------------------------------------------------------

// Words that appear on parish paperwork but are not person names. Used only to
// choose which OCR words to search the database with.
const STOP = new Set([
  "THE", "AND", "FOR", "WITH", "THIS", "THAT", "CERTIFY", "CERTIFICATE", "BAPTISM",
  "BAPTISMAL", "CONFIRMATION", "MARRIAGE", "MATRIMONY", "DEATH", "BURIAL", "FUNERAL",
  "PARISH", "CHURCH", "SAINT", "ANTHONY", "PADUA", "PONSO", "POLANGUI", "ALBAY",
  "PHILIPPINES", "DIOCESE", "LEGAZPI", "DATE", "DATED", "BORN", "SON", "DAUGHTER",
  "RECEIVED", "FROM", "AMOUNT", "PESOS", "OFFICIAL", "RECEIPT", "NAME", "ISSUED",
  "PRIEST", "FATHER", "WAS", "WHO", "ARE", "HAS", "HAVE",
]);

function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s: string): string[] {
  return norm(s)
    .split(" ")
    .filter((t) => t.length >= 3);
}

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array<number>(b.length).fill(0),
  ]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
  return d[a.length][b.length];
}

/**
 * 0..1 — share of a record's name words found in the OCR text. Tolerates one
 * OCR typo in words of 5+ letters. Single-word names are allowed so people who
 * use only a first name still get a sensible match suggestion.
 */
function nameScore(name: string, pool: Set<string>, arr: string[]): number {
  const nt = tokens(name);
  if (!nt.length) return 0;

  const hits = nt.filter((t) => {
    if (pool.has(t)) return true;
    if (t.length >= 5)
      return arr.some((x) => Math.abs(x.length - t.length) <= 1 && lev(x, t) <= 1);
    return false;
  }).length;

  if (nt.length === 1) return hits === 1 ? 1 : 0;
  return hits >= 2 ? hits / nt.length : 0;
}

function detailValues(details: unknown): Record<string, string> {
  if (!details || typeof details !== "object" || Array.isArray(details)) return {};
  return Object.fromEntries(
    Object.entries(details).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

const PERSON_DETAIL_KEYS = [
  "childName",
  "candidateName",
  "deceasedName",
  "intentionPerson",
  "groomName",
  "brideName",
  "fatherName",
  "motherName",
  "sponsorName",
  "blessingContact",
];

function bestNameMatch(names: string[], pool: Set<string>, arr: string[]) {
  return names.reduce(
    (best, name) => {
      const score = nameScore(name, pool, arr);
      return score > best.score ? { name, score } : best;
    },
    { name: "", score: 0 },
  );
}

function searchTokens(text: string, q: string) {
  const arr = [...new Set(tokens(`${text} ${q}`))];
  const distinctive = arr
    .filter((t) => !STOP.has(t))
    .sort((a, b) => b.length - a.length)
    .slice(0, 40);
  return { arr, pool: new Set(arr), distinctive };
}

const MIN_SCORE = 0.5;

function extractDates(text: string): Set<string> {
  const dates = new Set<string>();
  const addDate = (year: number, month: number, day: number) => {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    ) {
      dates.add(date.toISOString().slice(0, 10));
    }
  };

  for (const match of text.matchAll(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g)) {
    addDate(Number(match[1]), Number(match[2]), Number(match[3]));
  }
  for (const match of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2})\b/g)) {
    addDate(Number(match[3]), Number(match[1]), Number(match[2]));
    addDate(Number(match[3]), Number(match[2]), Number(match[1]));
  }

  const months: Record<string, number> = {
    JAN: 1, JANUARY: 1, FEB: 2, FEBRUARY: 2, MAR: 3, MARCH: 3,
    APR: 4, APRIL: 4, MAY: 5, JUN: 6, JUNE: 6, JUL: 7, JULY: 7,
    AUG: 8, AUGUST: 8, SEP: 9, SEPT: 9, SEPTEMBER: 9, OCT: 10,
    OCTOBER: 10, NOV: 11, NOVEMBER: 11, DEC: 12, DECEMBER: 12,
  };
  const monthPattern =
    /\b(JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUN(?:E)?|JUL(?:Y)?|AUG(?:UST)?|SEP(?:TEMBER)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)\.?\s+(\d{1,2})(?:,)?\s+(20\d{2})\b/gi;
  for (const match of text.matchAll(monthPattern)) {
    const month = months[match[1].toUpperCase()];
    if (month) addDate(Number(match[3]), month, Number(match[2]));
  }
  return dates;
}

function hasServiceEvidence(text: string, service: string): boolean {
  const words = tokens(service);
  const normalizedText = norm(text);
  return words.length > 0 && words.every((word) => normalizedText.includes(word));
}

function matchConfidence(input: {
  referenceHit: boolean;
  name: string;
  nameScore: number;
  dateHit: boolean;
  serviceHit: boolean;
}): number {
  if (input.referenceHit) return 100;
  if (input.nameScore < MIN_SCORE) return 0;

  const multiWordName = tokens(input.name).length >= 2;
  if (input.dateHit) return 90 + (input.serviceHit ? 8 : 0);
  if (input.serviceHit && input.nameScore >= 0.8) {
    return multiWordName ? 88 : 80;
  }
  if (multiWordName && input.nameScore === 1) return 80;
  return 35;
}

/** Returns one candidate only when it is a confident, unique winner. */
export function selectUniqueScanMatch<T extends { score: number }>(
  candidates: T[],
): T[] {
  const ranked = [...candidates].sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best || best.score < 80) return [];
  if (
    ranked[1] &&
    (best.score === ranked[1].score ||
      (best.score < 100 && best.score - ranked[1].score < 15))
  ) {
    return [];
  }
  return [best];
}

export async function suggestUsers(db: Db, text: string, query = "") {
  const q = query.trim().slice(0, 100);
  const { arr, pool, distinctive } = searchTokens(text, q);
  const searchTerms = [...new Set([q, ...distinctive].filter((term) => term.length >= 3))]
    .slice(0, 20);
  if (!searchTerms.length) return [];

  const users = await db.user.findMany({
    where: {
      OR: searchTerms.map((term) => ({
        fullname: { contains: term, mode: "insensitive" as const },
      })),
    },
    select: { id: true, fullname: true, email: true, createdAt: true },
    take: 300,
  });
  const normalizedText = ` ${norm(text)} `;

  return users.flatMap((user) => {
    const fullName = user.fullname.trim();
    const normalizedName = norm(fullName);
    const exactName =
      normalizedName.length >= 3 &&
      normalizedText.includes(` ${normalizedName} `);
    const score = exactName
      ? 100
      : nameScore(fullName, pool, arr) === 1
        ? 95
        : nameScore(fullName, pool, arr) >= 0.75
          ? 85
          : 0;
    if (score < 80) return [];
    return [{
      kind: "user" as const,
      id: user.id,
      reference: "User account",
      requesterName: fullName,
      bookingDate: user.createdAt,
      service: "Account owner",
      userId: user.id,
      owner: { id: user.id, name: fullName, email: user.email },
      score,
      evidence: exactName
        ? "Account name appears as a complete name in the scanned text"
        : "Account name matches the scanned text",
    }];
  });
}

/** Adds the linked user account (who the record belongs to) to each candidate. */
export async function attachOwners<T extends { userId: number | null }>(
  db: Db,
  rows: T[],
) {
  const ids = [
    ...new Set(rows.map((r) => r.userId).filter((x): x is number => x != null)),
  ];
  const users = ids.length
    ? await db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, fullname: true, email: true },
      })
    : [];
  const byId = new Map(
    users.map((u) => [u.id, { id: u.id, name: u.fullname, email: u.email }]),
  );
  return rows.map((r) => ({
    ...r,
    owner: r.userId != null ? (byId.get(r.userId) ?? null) : null,
  }));
}

export async function suggestBookings(db: Db, text: string, query = "") {
  const references = [
    ...new Set(text.match(/VP-[A-Z0-9]{4}-[A-Z0-9]{4}|VP-L\d{6,}|LEGACY-\d+/gi) ?? []),
  ].slice(0, 20);
  const dates = extractDates(text);
  const q = query.trim().slice(0, 100);
  const { arr, pool, distinctive } = searchTokens(text, q);
  if (!references.length && !distinctive.length && q.length < 3) return [];

  const rows = await db.booking.findMany({
    where: {
      // Scans are matched to real parish records only, never to Sample/Demo bookings.
      ...EXCLUDE_SAMPLES,
      OR: [
        ...(references.length
          ? [{ reference: { in: references, mode: "insensitive" as const } }]
          : []),
        ...distinctive.slice(0, 20).flatMap((t) => [
          { requesterName: { contains: t, mode: "insensitive" as const } },
          ...PERSON_DETAIL_KEYS.map((key) => ({
            details: {
              path: [key],
              string_contains: t,
              mode: "insensitive" as const,
            },
          })),
        ]),
        ...(q.length >= 3
          ? [
              { requesterName: { contains: q, mode: "insensitive" as const } },
              { reference: { contains: q, mode: "insensitive" as const } },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      reference: true,
      requesterName: true,
      bookingDate: true,
      service: true,
      userId: true,
      details: true,
    },
    take: 300,
    orderBy: { createdAt: "desc" },
  });

  const nq = norm(q);
  const out = rows
    .map((b) => {
      const refHit = references.some(
        (r) => r.toLowerCase() === b.reference.toLowerCase(),
      );
      const details = detailValues(b.details);
      const nameMatch = bestNameMatch(
        [
          b.requesterName,
          ...PERSON_DETAIL_KEYS.map((key) => details[key] ?? ""),
        ],
        pool,
        arr,
      );
      const staffHit =
        q.length >= 3 &&
        (norm(b.requesterName).includes(nq) ||
          b.reference.toLowerCase().includes(q.toLowerCase()));
      const dateHit = dates.has(b.bookingDate.toISOString().slice(0, 10));
      const detailDateHit = Object.entries(details).some(
        ([key, value]) => /date|dob/i.test(key) && dates.has(value),
      );
      const recordDateHit = dateHit || detailDateHit;
      const serviceHit = hasServiceEvidence(text, b.service);
      const score = matchConfidence({
        referenceHit: refHit,
        name: nameMatch.name,
        nameScore: nameMatch.score,
        dateHit: recordDateHit,
        serviceHit,
      });
      return { b, refHit, nameMatch, staffHit, recordDateHit, score };
    })
    .filter((x) => x.refHit || x.nameMatch.score >= MIN_SCORE || x.staffHit)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ b, refHit, nameMatch, recordDateHit, score }) => ({
      kind: "booking" as const,
      ...b,
      matchedName: nameMatch.name,
      score: Math.round(score),
      evidence: refHit
        ? "Reference found in scanned text"
        : recordDateHit && score >= 95
          ? "Name, booking date, and service match the scanned text"
          : recordDateHit
            ? "Name and booking date match the scanned text"
            : hasServiceEvidence(text, b.service)
              ? "Name and service match the scanned text"
              : "Full name uniquely matches the scanned text",
    }));
  return attachOwners(db, out);
}

export async function suggestCertificateRequests(
  db: Db,
  text: string,
  query = "",
) {
  const references = [
    ...new Set(text.match(/VP-[A-Z0-9]{4}-[A-Z0-9]{4}|VP-L\d{6,}/gi) ?? []),
  ].slice(0, 20);
  const dates = extractDates(text);
  const q = query.trim().slice(0, 100);
  const { arr, pool, distinctive } = searchTokens(text, q);
  if (!references.length && !distinctive.length && q.length < 3) return [];

  const rows = await db.certificateRequest.findMany({
    where: {
      OR: [
        ...(references.length
          ? [{ reference: { in: references, mode: "insensitive" as const } }]
          : []),
        ...distinctive.slice(0, 20).flatMap((t) => [
          { requesterName: { contains: t, mode: "insensitive" as const } },
          ...PERSON_DETAIL_KEYS.map((key) => ({
            details: {
              path: [key],
              string_contains: t,
              mode: "insensitive" as const,
            },
          })),
          {
            details: {
              path: ["spouseName"],
              string_contains: t,
              mode: "insensitive" as const,
            },
          },
        ]),
        ...(q.length >= 3
          ? [
              { requesterName: { contains: q, mode: "insensitive" as const } },
              {
                details: {
                  path: ["recipientName"],
                  string_contains: q,
                  mode: "insensitive" as const,
                },
              },
            ]
          : []),
      ],
    },
    select: {
      id: true,
      reference: true,
      requesterName: true,
      type: true,
      createdAt: true,
      userId: true,
      details: true,
    },
    take: 300,
    orderBy: { createdAt: "desc" },
  });

  const nq = norm(q);
  const out = rows
    .map((r) => {
      const details = detailValues(r.details);
      const recipientName = details.recipientName ?? "";
      const refHit = references.some(
        (x) => x.toLowerCase() === r.reference.toLowerCase(),
      );
      const nameMatch = bestNameMatch(
        [
          recipientName,
          r.requesterName,
          ...PERSON_DETAIL_KEYS.map((key) => details[key] ?? ""),
          details.spouseName ?? "",
        ],
        pool,
        arr,
      );
      const staffHit =
        q.length >= 3 &&
        (norm(r.requesterName).includes(nq) ||
          (recipientName !== "" && norm(recipientName).includes(nq)));
      const dateHit = Object.entries(details).some(
        ([key, value]) => /date|dob/i.test(key) && dates.has(value),
      );
      const serviceHit = hasServiceEvidence(
        text,
        typeof r.type === "string" ? r.type : "",
      );
      const score = matchConfidence({
        referenceHit: refHit,
        name: nameMatch.name,
        nameScore: nameMatch.score,
        dateHit,
        serviceHit,
      });
      return { r, refHit, nameMatch, staffHit, score };
    })
    .filter((x) => x.refHit || x.nameMatch.score >= MIN_SCORE || x.staffHit)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ r, refHit, nameMatch, score }) => ({
      kind: "request" as const,
      id: r.id,
      reference: r.reference,
      requesterName: r.requesterName,
      matchedName: nameMatch.name,
      userId: r.userId,
      bookingDate: r.createdAt,
      service: `${r.type} certificate`,
      score: Math.round(score),
      evidence: refHit
        ? "Certificate request reference found in scanned text"
        : score >= 95
          ? "Recipient name, sacrament date, and certificate type match the scanned text"
          : score >= 90
            ? "Recipient name and sacrament date match the scanned text"
            : hasServiceEvidence(text, r.type)
              ? "Recipient name and certificate type match the scanned text"
              : "Full recipient name uniquely matches the scanned text",
    }));
  return attachOwners(db, out);
}

export async function attachScan(
  db: Db,
  input: {
    documentId: string;
    bookingId?: number;
    requestId?: string;
    userId?: number;
    adminId: number;
    note: string;
  },
) {
  const targets = [input.bookingId, input.requestId, input.userId].filter(
    (target) => target !== undefined,
  );
  if (targets.length !== 1 || input.note.trim().length < 10)
    throw Error(
      "Choose exactly one target and provide a scan-matching reason.",
    );
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM private_documents WHERE id = ${input.documentId}::uuid FOR UPDATE`;
    const d = await tx.privateDocument.findUnique({
      where: { id: input.documentId },
    });
    if (!d || d.kind !== "scan" || d.bookingId || d.requestId || d.userId)
      throw Error("Only an unassigned scan can be attached here.");
    const b = input.bookingId
      ? await tx.booking.findUnique({ where: { id: input.bookingId } })
      : null;
    const r = input.requestId
      ? await tx.certificateRequest.findUnique({
          where: { id: input.requestId },
        })
      : null;
    const u = input.userId
      ? await tx.user.findUnique({ where: { id: input.userId } })
      : null;
    if (
      (input.bookingId && !b) ||
      (input.requestId && !r) ||
      (input.userId && !u)
    )
      throw Error("Target unavailable. Leave the scan unassigned.");
    await tx.privateDocument.update({
      where: { id: d.id },
      data: {
        bookingId: b?.id,
        requestId: r?.id,
        userId: b?.userId ?? r?.userId ?? u?.id,
        released: false,
      },
    });
    await tx.portalAudit.create({
      data: {
        action: "scan_attached",
        targetId: d.id,
        adminId: input.adminId,
        userId: b?.userId ?? r?.userId ?? u?.id,
        detail: {
          bookingId: b?.id ?? null,
          requestId: r?.id ?? null,
          matchedUserId: u?.id ?? null,
          reason: input.note,
        },
      },
    });
  });
}