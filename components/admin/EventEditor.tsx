"use client";

import { useActionState, useEffect, useState, type ReactNode } from "react";
import { saveEventAction, type ActionResult } from "@/lib/server/actions/admin";
import { EVENT_TYPE_LABEL, EVENT_TYPES, type EventRow } from "@/lib/admin/events";
import Dialog from "./Dialog";
import { showToast } from "./Toaster";

type Props = {
  /** Existing event to edit; omit to create. */
  event?: EventRow;
  /** Pre-filled date for a new event (calendar day "+"). */
  defaultDate?: string;
  triggerClassName?: string;
  triggerLabel?: string;
  children: ReactNode;
};

/** Trigger + dialog for creating or editing a church event (legacy calendar event modal). */
export default function EventEditor({ event, defaultDate, triggerClassName = "btn btn-gold", triggerLabel, children }: Props) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);

  return (
    <>
      <button
        type="button"
        className={triggerClassName}
        aria-label={triggerLabel}
        title={triggerLabel}
        onClick={() => {
          setFormKey((k) => k + 1);
          setOpen(true);
        }}
      >
        {children}
      </button>
      <Dialog open={open} title={event ? "Edit Event" : "Add New Event"} onClose={() => setOpen(false)}>
        <EventForm key={formKey} event={event} defaultDate={defaultDate} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function EventForm({ event, defaultDate, onDone }: { event?: EventRow; defaultDate?: string; onDone: () => void }) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(saveEventAction, null);

  useEffect(() => {
    if (state?.ok) {
      showToast(true, state.message);
      onDone();
    }
  }, [state, onDone]);

  const err = state && !state.ok ? state.fieldErrors ?? {} : {};
  const invalid = (k: string) => (err[k] ? { "aria-invalid": true, "aria-describedby": `ev-${k}-err` } : {});

  return (
    <form action={formAction} noValidate aria-busy={pending} onSubmit={(e) => pending && e.preventDefault()}>
      {event && <input type="hidden" name="id" value={event.id} />}
      {state && !state.ok && (
        <div className="notice error" role="alert">
          <i className="fas fa-exclamation-circle" aria-hidden="true" /> {state.message}
        </div>
      )}
      <div className="form-grid">
        <div className="field full">
          <label htmlFor="ev-title">Event Title</label>
          <input id="ev-title" name="title" required maxLength={200} defaultValue={event?.title} placeholder="e.g., Sunday Mass, Parish Fiesta…" {...invalid("title")} />
          {err.title && <span className="error" id="ev-title-err">{err.title}</span>}
        </div>
        <div className="field">
          <label htmlFor="ev-date">Date</label>
          <input id="ev-date" name="date" type="date" required defaultValue={event?.date ?? defaultDate} {...invalid("date")} />
          {err.date && <span className="error" id="ev-date-err">{err.date}</span>}
        </div>
        <div className="field">
          <label htmlFor="ev-time">Time</label>
          <input id="ev-time" name="time" maxLength={50} defaultValue={event?.time} placeholder="e.g., 7:00 AM, All Day" {...invalid("time")} />
          {err.time && <span className="error" id="ev-time-err">{err.time}</span>}
        </div>
        <div className="field">
          <label htmlFor="ev-type">Type</label>
          <select id="ev-type" name="type" required defaultValue={event?.type ?? "mass"} {...invalid("type")}>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EVENT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          {err.type && <span className="error" id="ev-type-err">{err.type}</span>}
        </div>
        <div className="field">
          <label htmlFor="ev-location">Location</label>
          <input id="ev-location" name="location" maxLength={200} defaultValue={event?.location} placeholder="e.g., Main Church" {...invalid("location")} />
          {err.location && <span className="error" id="ev-location-err">{err.location}</span>}
        </div>
        <div className="field full">
          <label htmlFor="ev-description">Description</label>
          <textarea id="ev-description" name="description" maxLength={2000} defaultValue={event?.description} placeholder="Optional details about this event…" {...invalid("description")} />
          {err.description && <span className="error" id="ev-description-err">{err.description}</span>}
        </div>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-outline" onClick={onDone} disabled={pending}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? (
            <>
              <span className="spinner sm" aria-hidden="true" /> Saving…
            </>
          ) : (
            <>
              <i className="fas fa-save" aria-hidden="true" /> Save Event
            </>
          )}
        </button>
      </div>
    </form>
  );
}
