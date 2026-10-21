import DocumentScanner from "@/components/admin/DocumentScanner";
import { getDb } from "@/lib/server/db";
import { requireAdmin } from "@/lib/server/auth";
export default async function ScannerPage({
  searchParams,
}: {
  searchParams: Promise<{ reference?: string; document?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const selected =
    params.document && /^[0-9a-f-]{36}$/i.test(params.document)
      ? await getDb().privateDocument.findFirst({
          where: {
            id: params.document,
            kind: "scan",
            bookingId: null,
            requestId: null,
          },
          select: { id: true, extractedText: true },
        })
      : null;
  const rows = await getDb().privateDocument.findMany({
    where: { kind: "scan" },
    select: {
      id: true,
      filename: true,
      createdAt: true,
      bookingId: true,
      requestId: true,
      uploadedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return (
    <main className="portal-content">
      <h1>Document scanner</h1>
      <DocumentScanner
        key={selected?.id ?? "new"}
        initialReference={params.reference}
        initialDocumentId={selected?.id}
        initialText={selected?.extractedText ?? ""}
      />
      <h2>Saved scans</h2>
      {rows.map((d) => (
        <article className="portal-card" key={d.id}>
          <a href={`/api/documents/${d.id}`}>{d.filename}</a>
          {!d.bookingId && !d.requestId && (
            <p>
              <a href={`/admin/scanner?document=${d.id}`}>
                Review / attach this saved scan
              </a>
            </p>
          )}
          <p>
            {d.bookingId
              ? `Booking #${d.bookingId}`
              : d.requestId
                ? `Certificate request ${d.requestId}`
                : "Unassigned"}{" "}
            · {d.uploadedBy?.name ?? "Staff"} ·{" "}
            {d.createdAt.toLocaleString("en-PH", { timeZone: "Asia/Manila" })}
          </p>
        </article>
      ))}
    </main>
  );
}
