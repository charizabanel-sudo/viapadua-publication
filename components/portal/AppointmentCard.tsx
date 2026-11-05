"use client";

import { useState } from "react";
import { cancelUserAppointment, updateUserAppointment } from "@/lib/server/actions/portal";
import ConfirmSubmitButton from "@/components/portal/ConfirmSubmitButton";

export type AppointmentStatus = "pending" | "confirmed" | "cancelled" | "completed";

export type Appointment = {
  id: number;
  reference: string;
  service: string;
  bookingDate: string; // ISO YYYY-MM-DD
  bookingTime: string | null; // "HH:mm"
  status: AppointmentStatus;
};

function formatTime(t: string) {
  const [h, m] = t.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("en-US", {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function AppointmentCard({ booking }: { booking: Appointment }) {
  const [editing, setEditing] = useState(false);
  const actionable = booking.status === "pending" || booking.status === "confirmed";
  async function handleCancel(form: FormData): Promise<void> {
    await cancelUserAppointment(form);
  }
  async function handleUpdate(form: FormData): Promise<void> {
    await updateUserAppointment(form);
  }

  return (
    <article className="portal-card appointment-card">
      <header className="appointment-header">
        <div>
          <h3 className="appointment-ref">#{booking.reference}</h3>
          <p className="appointment-service">{booking.service}</p>
        </div>
        <span className={`status-badge status-${booking.status}`}>
          {booking.status}
        </span>
      </header>

      <dl className="appointment-info">
        <div>
          <dt>Date</dt>
          <dd>{formatDate(booking.bookingDate)}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{booking.bookingTime ? formatTime(booking.bookingTime) : "Not set"}</dd>
        </div>
      </dl>

      {actionable && (
        <div className="appointment-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            aria-controls={`edit-form-${booking.id}`}
          >
            {editing ? "Close" : "Reschedule"}
          </button>

          <form action={handleCancel} className="inline-form">
            <input type="hidden" name="bookingId" value={booking.id} />
            <ConfirmSubmitButton
              className="btn btn-danger"
              confirmMessage={`Cancel appointment ${booking.reference}? This cannot be undone.`}
            >
              Cancel
            </ConfirmSubmitButton>
          </form>
        </div>
      )}

      {actionable && editing && (
        <form
          id={`edit-form-${booking.id}`}
          action={handleUpdate}
          className="portal-form appointment-edit-form"
        >
          <input type="hidden" name="bookingId" value={booking.id} />

          <label>
            New date
            <input
              type="date"
              name="bookingDate"
              defaultValue={booking.bookingDate}
              required
            />
          </label>

          <label>
            New time
            <input
              type="time"
              name="bookingTime"
              defaultValue={booking.bookingTime ?? ""}
              min="07:00"
              max="17:00"
              step="1800"
              required
            />
          </label>

          <div className="form-row">
            <button type="submit" className="btn btn-primary">
              Save changes
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setEditing(false)}
            >
              Discard
            </button>
          </div>
        </form>
      )}
    </article>
  );
}