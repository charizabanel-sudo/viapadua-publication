"use client";

import { useEffect, useState } from "react";
import { cancelUserAppointment, updateUserAppointment } from "@/lib/server/actions/portal";
import ConfirmSubmitButton from "@/components/portal/ConfirmSubmitButton";
import { findSlotConflict, formatTime12h } from "@/lib/booking/schedule";

export type AppointmentStatus = "pending" | "confirmed" | "cancelled" | "completed";

export type Appointment = {
  id: number;
  reference: string;
  service: string;
  bookingDate: string; // ISO YYYY-MM-DD
  bookingTime: string | null; // "HH:mm"
  status: AppointmentStatus;
  requestedDate: string | null;
  requestedTime: string | null;
  rescheduleRequestedAt: string | null;
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

function serviceIcon(service: string): string {
  const name = service.toLowerCase();
  if (name.includes("bapt")) return "fa-water";
  if (name.includes("wedding") || name.includes("marriage") || name.includes("kasal")) return "fa-ring";
  if (name.includes("confirmation") || name.includes("kumpil")) return "fa-cross";
  if (name.includes("funeral") || name.includes("burial")) return "fa-church";
  if (name.includes("mass") || name.includes("blessing")) return "fa-hands-praying";
  return "fa-calendar-check";
}

export default function AppointmentCard({ booking }: { booking: Appointment }) {
  const [editing, setEditing] = useState(false);
  const [selectedDate, setSelectedDate] = useState(booking.bookingDate);
  const [selectedTime, setSelectedTime] = useState(booking.bookingTime ?? "");
  const [reservedTimes, setReservedTimes] = useState<string[]>([]);
  const [blockedDate, setBlockedDate] = useState(false);
  const actionable = booking.status === "pending" || booking.status === "confirmed";
  useEffect(() => {
    if (!selectedDate) return;
    const controller = new AbortController();
    void fetch(`/api/bookings?date=${encodeURIComponent(selectedDate)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((availability: { blocked?: boolean; reserved?: string[] } | null) => {
        if (!availability) return;
        setBlockedDate(Boolean(availability.blocked));
        setReservedTimes((availability.reserved ?? []).filter((time) => time !== booking.bookingTime));
      })
      .catch(() => {});
    return () => controller.abort();
  }, [selectedDate, booking.bookingTime]);
  const conflictTime = selectedTime ? findSlotConflict(selectedTime, reservedTimes) : null;
  const timeError = conflictTime
    ? `This time conflicts with an existing appointment at ${formatTime12h(conflictTime)}. Please choose another time.`
    : "";
  async function handleUpdate(form: FormData): Promise<void> {
    await updateUserAppointment(form);
  }
  async function handleCancel(form: FormData): Promise<void> {
    await cancelUserAppointment(form);
  }

  return (
    <article className="portal-card appointment-card">
      <div className="appointment-main">
        <div className="appointment-service-icon" aria-hidden="true">
          <i className={`fas ${serviceIcon(booking.service)}`} />
        </div>
        <div>
          <h3 className="appointment-ref">#{booking.reference}</h3>
          <p className="appointment-service">{booking.service}</p>
        </div>
      </div>

      <div className="appointment-schedule">
        <div className="schedule-line">
          <i className="fas fa-calendar-alt" aria-hidden="true" />
          <span>{formatDate(booking.bookingDate)}</span>
        </div>
        <div className="schedule-line">
          <i className="fas fa-clock" aria-hidden="true" />
          <span>{booking.bookingTime ? formatTime(booking.bookingTime) : "Not set"}</span>
        </div>
      </div>

      {booking.requestedDate && (
        <div className="form-alert" role="status">
          Reschedule pending approval: {formatDate(booking.requestedDate)}
          {booking.requestedTime ? ` at ${formatTime(booking.requestedTime)}` : ""}
        </div>
      )}

      <div className="appointment-actions">
        <span className={`status-badge status-${booking.status}`}>
          {booking.status}
        </span>
        {actionable && (
          <>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
            aria-controls={`edit-form-${booking.id}`}
          >
            Reschedule
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
          </>
        )}
      </div>

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
              onChange={(event) => setSelectedDate(event.currentTarget.value)}
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
              step="60"
              required
              onChange={(event) => {
                const time = event.currentTarget.value;
                setSelectedTime(time);
              }}
            />
          </label>
          {blockedDate && <p className="appointment-time-error" role="alert">This date is blocked by the parish office. Please choose another date.</p>}
          {timeError && <p className="appointment-time-error" role="alert">{timeError}</p>}

          <div className="form-row">
            <button type="submit" className="btn btn-primary" disabled={blockedDate || Boolean(timeError)}>
              Save changes
            </button>
          </div>
        </form>
      )}
    </article>
  );
}