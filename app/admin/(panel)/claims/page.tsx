import FeedbackForm from "@/components/portal/FeedbackForm";
import { requireAdmin } from "@/lib/server/auth";
import { getDb } from "@/lib/server/db";
import { reviewClaimAction } from "@/lib/server/actions/portal";
export default async function ClaimsPage() {
  await requireAdmin();
  const rows = await getDb().bookingClaim.findMany({
    take: 100,
    orderBy: { createdAt: "desc" },
    include: { user: { select: { fullname: true, email: true } } },
  });
  return (
    <div className="portal-content">
      <h1>Historical booking claims</h1>
      <p>
        Verify the claimant&apos;s identity and contact with the parish record.
        Names, email addresses and reference numbers alone do not prove
        ownership.
      </p>
      {rows.map((c) => (
        <article className="portal-card" key={c.id}>
          <h2>{c.reference}</h2>
          <p>
            {c.user.fullname} · {c.user.email}
          </p>
          <p>{c.evidence}</p>
          <p>Status: {c.status}</p>
          {c.reviewNote && <p>Review: {c.reviewNote}</p>}
          {c.status === "pending" && (
            <FeedbackForm action={reviewClaimAction}>
              <input name="id" type="hidden" value={c.id} />
              <label>
                Verification and decision notes
                <textarea
                  name="note"
                  required
                  minLength={10}
                  maxLength={1000}
                />
              </label>
              <label>
                Decision
                <select name="decision">
                  <option value="reject">Reject / unable to verify</option>
                  <option value="approve">
                    Approve · identity/contact independently verified
                  </option>
                </select>
              </label>
              <button className="btn btn-primary">Record decision</button>
            </FeedbackForm>
          )}
        </article>
      ))}
    </div>
  );
}
