"use client";

import { useRouter } from "next/navigation";

type AppointmentStatus = "all" | "pending" | "confirmed" | "cancelled" | "completed";

export default function AppointmentStatusFilter({ status }: { status: string }) {
  const router = useRouter();
  const selectedStatus = status as AppointmentStatus;

  function selectStatus(nextStatus: AppointmentStatus) {
    router.push(nextStatus === "all"
      ? "/portal?tab=bookings"
      : `/portal?tab=bookings&status=${nextStatus}`);
  }

  return (
    <nav className="appointment-summary" aria-label="Appointment status summary">
      <label className="appointment-status-select">
        <span className="sr-only">Filter appointments by status</span>
        <select
          value={selectedStatus === "all" ? "" : selectedStatus}
          onChange={(event) => selectStatus((event.currentTarget.value || "all") as AppointmentStatus)}
        >
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
          <option value="completed">Completed</option>
        </select>
      </label>
    </nav>
  );
}
