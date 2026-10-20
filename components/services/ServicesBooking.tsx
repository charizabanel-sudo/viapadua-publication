"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent, type MouseEvent, type Ref } from "react";
import { submitBooking } from "@/app/services/actions";
import type { CreatedBooking } from "@/lib/booking/create";
import {
  BLESSING_OPTIONS,
  SERVICE_CARDS,
  formatPeso,
  getBookableService,
  type BookableService,
  type ServiceField,
} from "@/lib/booking/catalog";
import {
  EARLIEST_TIME,
  LATEST_TIME,
  MAX_ADVANCE_DAYS,
  addDays,
  formatDateLong,
  formatTime12h,
  isBlockedWeekday,
  todayInParish,
  weekdayName,
} from "@/lib/booking/schedule";

type FieldErrors = Record<string, string>;
type Step = "closed" | "blessing" | "form" | "gcash" | "success";
type Payment = "" | "gcash" | "church";

const GCASH_FIELDS = ["gcashAccountName", "gcashNumber", "gcashRefNumber"];

type Props = { gcashPayee: { number: string | null; name: string } };

export default function ServicesBooking({ gcashPayee }: Props) {
  const [openReqs, setOpenReqs] = useState<ReadonlySet<string>>(new Set());
  const [step, setStep] = useState<Step>("closed");
  const [service, setService] = useState<BookableService | null>(null);
  const [blessingChoice, setBlessingChoice] = useState("");
  const [blessingError, setBlessingError] = useState(false);
  const [payment, setPayment] = useState<Payment>("");
  const [date, setDate] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedBooking | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const bookingFormRef = useRef<HTMLFormElement>(null);
  const gcashFirstFieldRef = useRef<HTMLInputElement>(null);

  // Escape closes the active dialog (legacy behaviour), except while submitting.
  useEffect(() => {
    if (step === "closed") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) setStep("closed");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [step, pending]);

  // Move focus into the GCash step when it opens (its form stays mounted to keep entered values).
  useEffect(() => {
    if (step === "gcash") gcashFirstFieldRef.current?.focus();
  }, [step]);

  function toggleRequirements(slug: string) {
    setOpenReqs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function openBooking(code: string) {
    const selected = getBookableService(code);
    if (!selected) return;
    setService(selected);
    setPayment("");
    setDate("");
    setErrors({});
    setFormError(null);
    setCreated(null);
    setCopied(false);
    setFormKey((k) => k + 1);
    setStep("form");
  }

  function openBlessing() {
    setBlessingChoice("");
    setBlessingError(false);
    setStep("blessing");
  }

  function close() {
    if (!pending) setStep("closed");
  }

  function onOverlayMouseDown(e: MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) close();
  }

  function clearError(name: string) {
    if (!errors[name]) return;
    setErrors((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }

  function send(formData: FormData, fromGcash: boolean) {
    setFormError(null);
    startTransition(async () => {
      try {
        const result = await submitBooking(formData);
        if (result.status === "success") {
          setCreated(result.booking);
          setStep("success");
          return;
        }
        setErrors(result.fieldErrors);
        setFormError(result.formError ?? "Please check your booking details.");
        const keys = Object.keys(result.fieldErrors);
        const stayOnGcash = fromGcash && keys.every((k) => GCASH_FIELDS.includes(k));
        setStep(stayOnGcash ? "gcash" : "form");
      } catch {
        setFormError("We couldn't reach the server. Please check your connection and try again.");
      }
    });
  }

  function onBookingSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!payment) {
      setErrors((prev) => ({ ...prev, payment_method: "Please choose a payment method." }));
      setFormError("Please choose a payment method.");
      return;
    }
    if (date && isBlockedWeekday(date)) {
      const message = `${weekdayName(date)} is not available for bookings. Please choose another date.`;
      setErrors((prev) => ({ ...prev, bookDate: message }));
      setFormError(message);
      return;
    }
    if (payment === "gcash") {
      setFormError(null);
      setStep("gcash");
      return;
    }
    send(new FormData(e.currentTarget), false);
  }

  function onGcashSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!bookingFormRef.current) return;
    const data = new FormData(bookingFormRef.current);
    for (const [key, value] of new FormData(e.currentTarget).entries()) data.set(key, value);
    send(data, true);
  }

  async function copyReference() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.reference);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const today = step === "closed" ? "" : todayInParish();
  const dateBlocked = date !== "" && isBlockedWeekday(date);

  return (
    <>
      <div className="cards-grid">
        {SERVICE_CARDS.map((card) => {
          const reqOpen = openReqs.has(card.slug);
          const reqId = `req-${card.slug}`;
          return (
            <div className="card" id={card.slug} key={card.slug}>
              <div className="card-icon-bg" aria-hidden="true">
                <i className={`fas ${card.icon}`} />
              </div>
              <h2 className="service-title">{card.title}</h2>
              <p className="service-subtitle">{card.subtitle}</p>
              <h3 className="section-label">About {card.title}</h3>
              <p className="description">{card.about}</p>
              <button
                type="button"
                className="requirements-toggle"
                aria-expanded={reqOpen}
                aria-controls={reqId}
                onClick={() => toggleRequirements(card.slug)}
              >
                <span className="left">
                  <i className="fas fa-list-ul" aria-hidden="true" /> View Requirements
                </span>
                <i className="fas fa-chevron-down" aria-hidden="true" />
              </button>
              <div className={`requirements-content${reqOpen ? " show" : ""}`} id={reqId}>
                <ul>
                  {card.requirements.map((req) => (
                    <li key={req}>
                      <i className="fas fa-check-circle" aria-hidden="true" /> {req}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="fee-label">Service Fee</div>
              <div className="fee-amount">{formatPeso(card.fee)}</div>
              <div className="payment-info">GCash or pay at the church</div>
              <div className="button-group">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => (card.serviceCodes.length > 1 ? openBlessing() : openBooking(card.serviceCodes[0]))}
                >
                  Book Now
                </button>
                {card.certificate && (
                  <button
                    type="button"
                    className="btn btn-secondary awaiting"
                    aria-disabled="true"
                    title="Certificate requests are awaiting migration"
                    onClick={(e) => e.preventDefault()}
                  >
                    Request Certificate
                  </button>
                )}
              </div>
              {card.certificate && (
                <p className="awaiting-note">
                  <i className="fas fa-clock" aria-hidden="true" /> Online {card.certificate.name.toLowerCase()} requests (
                  {formatPeso(card.certificate.fee)}) are awaiting migration — please request at the parish office.
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* BLESSING CHOOSER */}
      {step === "blessing" && (
        <div className="modal-overlay show" onMouseDown={onOverlayMouseDown}>
          <div className="modal-box" style={{ width: 480 }} role="dialog" aria-modal="true" aria-labelledby="blessingTitle">
            <button type="button" className="modal-close" onClick={close} aria-label="Close">
              <i className="fas fa-times" aria-hidden="true" />
            </button>
            <h3 className="modal-title" id="blessingTitle">
              Blessing Service
            </h3>
            <p className="modal-subtitle">Choose the type of blessing</p>
            {blessingError && (
              <div className="form-error" role="alert">
                <i className="fas fa-exclamation-triangle" aria-hidden="true" /> Please choose a type of blessing.
              </div>
            )}
            <div className="payment-options" role="radiogroup" aria-labelledby="blessingTitle">
              {BLESSING_OPTIONS.map((opt) => (
                <button
                  type="button"
                  role="radio"
                  aria-checked={blessingChoice === opt.code}
                  aria-label={`${opt.title}: ${opt.description}`}
                  key={opt.code}
                  className={`payment-option${blessingChoice === opt.code ? " selected" : ""}`}
                  onClick={() => {
                    setBlessingChoice(opt.code);
                    setBlessingError(false);
                  }}
                >
                  <div className="payment-option-icon church">
                    <i className={`fas ${opt.icon}`} aria-hidden="true" />
                  </div>
                  <div className="payment-option-info">
                    <h4>{opt.title}</h4>
                    <p>{opt.description}</p>
                  </div>
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={close}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => (blessingChoice ? openBooking(blessingChoice) : setBlessingError(true))}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BOOKING FORM (kept mounted during the GCash step so its values are preserved) */}
      {service && (step === "form" || step === "gcash") && (
        <div className={`modal-overlay${step === "form" ? " show" : ""}`} onMouseDown={onOverlayMouseDown}>
          <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="bookingModalTitle">
            <button type="button" className="modal-close" onClick={close} aria-label="Close">
              <i className="fas fa-times" aria-hidden="true" />
            </button>
            <h3 className="modal-title" id="bookingModalTitle">
              Book {service.name} — {formatPeso(service.fee)}
            </h3>
            <p className="modal-subtitle">Please fill in the details below</p>

            {formError && step === "form" && (
              <div className="form-error" role="alert">
                <i className="fas fa-exclamation-triangle" aria-hidden="true" />
                <span>{formError}</span>
              </div>
            )}

            <form ref={bookingFormRef} key={formKey} onSubmit={onBookingSubmit}>
              <input type="hidden" name="serviceCode" value={service.code} />
              <div className="hp-field" aria-hidden="true">
                <label htmlFor="website">Website</label>
                <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
              </div>

              <div className="form-row">
                <TextInput name="bookFullName" label="Full Name" required autoComplete="name" errors={errors} onEdit={clearError} autoFocus />
                <TextInput
                  name="bookContact"
                  label="Contact Number"
                  type="tel"
                  required
                  placeholder="09XX XXX XXXX"
                  autoComplete="tel"
                  errors={errors}
                  onEdit={clearError}
                />
              </div>
              <TextInput
                name="bookEmail"
                label="Email Address"
                type="email"
                required
                placeholder="you@example.com"
                autoComplete="email"
                errors={errors}
                onEdit={clearError}
              />

              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="f-bookDate">
                    Preferred Date <span className="req">*</span>
                  </label>
                  <input
                    type="date"
                    id="f-bookDate"
                    name="bookDate"
                    required
                    min={today}
                    max={today ? addDays(today, MAX_ADVANCE_DAYS) : undefined}
                    value={date}
                    aria-invalid={Boolean(errors.bookDate) || dateBlocked}
                    aria-describedby="f-bookDate-hint"
                    onChange={(e) => {
                      setDate(e.target.value);
                      clearError("bookDate");
                    }}
                  />
                  <div className={`form-hint${dateBlocked || errors.bookDate ? " warn" : ""}`} id="f-bookDate-hint">
                    {errors.bookDate ? (
                      <>
                        <i className="fas fa-exclamation-circle" aria-hidden="true" /> {errors.bookDate}
                      </>
                    ) : dateBlocked ? (
                      <>
                        <i className="fas fa-exclamation-circle" aria-hidden="true" /> {weekdayName(date)} is blocked
                      </>
                    ) : (
                      <>
                        <i className="fas fa-info-circle" aria-hidden="true" /> Not available on Sundays &amp; Tuesdays
                      </>
                    )}
                  </div>
                </div>
                <div className="form-group">
                  <label htmlFor="f-bookTime">
                    Preferred Time <span className="req">*</span>
                  </label>
                  <input
                    type="time"
                    id="f-bookTime"
                    name="bookTime"
                    required
                    min={EARLIEST_TIME}
                    max={LATEST_TIME}
                    aria-invalid={Boolean(errors.bookTime)}
                    aria-describedby="f-bookTime-hint"
                    onChange={() => clearError("bookTime")}
                  />
                  <div className={`form-hint${errors.bookTime ? " warn" : ""}`} id="f-bookTime-hint">
                    {errors.bookTime ? (
                      <>
                        <i className="fas fa-exclamation-circle" aria-hidden="true" /> {errors.bookTime}
                      </>
                    ) : (
                      <>
                        <i className="fas fa-info-circle" aria-hidden="true" /> {formatTime12h(EARLIEST_TIME)} –{" "}
                        {formatTime12h(LATEST_TIME)}
                      </>
                    )}
                  </div>
                </div>
              </div>

              <div className={`date-warning${dateBlocked ? " show" : ""}`} role={dateBlocked ? "alert" : undefined}>
                <i className="fas fa-exclamation-triangle" aria-hidden="true" />
                <span>{dateBlocked ? `${weekdayName(date)} is not available for bookings. Please choose another date.` : ""}</span>
              </div>

              {service.fields.map((row, i) =>
                row.length > 1 ? (
                  <div className="form-row" key={i}>
                    {row.map((field) => (
                      <ServiceInput key={field.name} field={field} today={today} errors={errors} onEdit={clearError} />
                    ))}
                  </div>
                ) : (
                  <ServiceInput key={row[0].name} field={row[0]} today={today} errors={errors} onEdit={clearError} />
                ),
              )}

              <div className="form-group">
                <label htmlFor="f-bookNotes">Additional Notes / Special Requests</label>
                <textarea
                  id="f-bookNotes"
                  name="bookNotes"
                  maxLength={1000}
                  placeholder="Any special instructions or requests..."
                  aria-invalid={Boolean(errors.bookNotes)}
                />
                {errors.bookNotes && <div className="form-hint warn">{errors.bookNotes}</div>}
              </div>

              <div className="payment-section-title" id="paymentTitle">
                <i className="fas fa-wallet" aria-hidden="true" /> Payment Method <span className="req" style={{ color: "#ef4444" }}>*</span>
              </div>
              <input type="hidden" name="payment_method" value={payment} />
              <div className="payment-options" role="radiogroup" aria-labelledby="paymentTitle">
                <PaymentOption
                  selected={payment === "gcash"}
                  onSelect={() => {
                    setPayment("gcash");
                    clearError("payment_method");
                  }}
                  icon="fa-mobile-alt"
                  variant="gcash"
                  title="GCash"
                  description="Send via GCash, then enter your reference number"
                />
                <PaymentOption
                  selected={payment === "church"}
                  onSelect={() => {
                    setPayment("church");
                    clearError("payment_method");
                  }}
                  icon="fa-church"
                  variant="church"
                  title="Pay at the Church"
                  description="Pay in person at the parish office"
                />
              </div>
              {errors.payment_method && (
                <div className="form-hint warn" style={{ marginTop: -12, marginBottom: 14 }}>
                  <i className="fas fa-exclamation-circle" aria-hidden="true" /> {errors.payment_method}
                </div>
              )}

              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={close} disabled={pending}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={pending}>
                  {pending ? "Submitting…" : payment === "gcash" ? "Continue to GCash" : "Confirm Booking"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* GCASH STEP */}
      {service && (step === "form" || step === "gcash") && (
        <div className={`modal-overlay${step === "gcash" ? " show" : ""}`} onMouseDown={onOverlayMouseDown}>
          <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="gcashTitle">
            <button type="button" className="modal-close" onClick={close} aria-label="Close">
              <i className="fas fa-times" aria-hidden="true" />
            </button>
            <h3 className="modal-title" id="gcashTitle">
              GCash Payment
            </h3>
            <p className="modal-subtitle">Enter your GCash payment details</p>
            <div className="gcash-info-box">
              <strong>
                <i className="fas fa-info-circle" aria-hidden="true" /> Send your payment to:
              </strong>
              <br />
              GCash Number: <strong>{gcashPayee.number ?? "Please ask the parish office"}</strong>
              <br />
              Account Name: <strong>{gcashPayee.name}</strong>
              <br />
              Amount to pay: <span className="amount-highlight">{formatPeso(service.fee)}</span>
            </div>
            <div className="notice-box">
              <i className="fas fa-shield-alt" aria-hidden="true" /> Your booking stays <strong>pending and unpaid</strong> until
              the parish office verifies your GCash reference. Submitting a reference does not mark it as paid.
            </div>

            {formError && step === "gcash" && (
              <div className="form-error" role="alert">
                <i className="fas fa-exclamation-triangle" aria-hidden="true" />
                <span>{formError}</span>
              </div>
            )}

            <form key={formKey} onSubmit={onGcashSubmit}>
              <TextInput
                name="gcashAccountName"
                label="GCash Account Name"
                required
                placeholder="Name on your GCash"
                errors={errors}
                onEdit={clearError}
                inputRef={gcashFirstFieldRef}
              />
              <TextInput name="gcashNumber" label="GCash Number" type="tel" required placeholder="09XX XXX XXXX" errors={errors} onEdit={clearError} />
              <TextInput
                name="gcashRefNumber"
                label="GCash Reference Number"
                required
                placeholder="e.g., 1234567890123"
                errors={errors}
                onEdit={clearError}
              />
              <div className="form-group">
                <span className="sr-only">Upload Payment Proof</span>
                <div className="upload-area disabled" aria-disabled="true">
                  <i className="fas fa-cloud-upload-alt" aria-hidden="true" />
                  <p>Receipt upload is awaiting migration</p>
                  <p style={{ fontSize: 12, marginTop: 4 }}>Keep your GCash receipt — the parish may ask to see it.</p>
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setStep("form")} disabled={pending}>
                  Back
                </button>
                <button type="submit" className="btn btn-primary" disabled={pending}>
                  {pending ? "Submitting…" : "Submit Booking"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SUCCESS */}
      {step === "success" && created && (
        <div className="modal-overlay show" onMouseDown={onOverlayMouseDown}>
          <div className="modal-box" role="dialog" aria-modal="true" aria-labelledby="successTitle">
            <button type="button" className="modal-close" onClick={close} aria-label="Close">
              <i className="fas fa-times" aria-hidden="true" />
            </button>
            <div className="success-view">
              <div className="success-icon" aria-hidden="true">
                <i className="fas fa-check" />
              </div>
              <h3 className="modal-title" id="successTitle">
                Booking Request Submitted
              </h3>
              <p className="modal-subtitle">The parish office will review your request and contact you.</p>
              <div className="reference-box">
                <div className="reference-label">Your reference number</div>
                <div className="reference-value">{created.reference}</div>
                <button type="button" className="copy-btn" onClick={copyReference}>
                  <i className="fas fa-copy" aria-hidden="true" /> {copied ? "Copied" : "Copy reference"}
                </button>
              </div>
            </div>
            <div className="summary-list">
              <SummaryRow label="Service" value={created.service} />
              <SummaryRow label="Date" value={formatDateLong(created.date)} />
              <SummaryRow label="Time" value={formatTime12h(created.time)} />
              <SummaryRow label="Fee" value={formatPeso(created.fee)} />
              <SummaryRow label="Payment" value={created.paymentMethod === "gcash" ? "GCash (awaiting verification)" : "Pay at the church"} />
              <div className="summary-row">
                <span>Status</span>
                <strong>
                  <span className="status-pill">Pending · Unpaid</span>
                </strong>
              </div>
            </div>
            <div className="notice-box">
              Please save your reference number and present it at the parish office.{" "}
              {created.paymentMethod === "church"
                ? "Payment is made in person at the parish office."
                : "The parish office will verify your GCash reference before marking the booking as paid."}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={close}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

type InputProps = {
  name: string;
  label: string;
  type?: "text" | "email" | "tel";
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  errors: FieldErrors;
  onEdit: (name: string) => void;
};

function TextInput({ name, label, type = "text", required, placeholder, autoComplete, autoFocus, inputRef, errors, onEdit }: InputProps) {
  const id = `f-${name}`;
  const error = errors[name];
  return (
    <div className="form-group">
      <label htmlFor={id}>
        {label} {required && <span className="req">*</span>}
      </label>
      <input
        ref={inputRef}
        id={id}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        maxLength={255}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-err` : undefined}
        onChange={() => onEdit(name)}
      />
      {error && (
        <div className="form-hint warn" id={`${id}-err`}>
          <i className="fas fa-exclamation-circle" aria-hidden="true" /> {error}
        </div>
      )}
    </div>
  );
}

function ServiceInput({
  field,
  today,
  errors,
  onEdit,
}: {
  field: ServiceField;
  today: string;
  errors: FieldErrors;
  onEdit: (name: string) => void;
}) {
  const id = `f-${field.name}`;
  const error = errors[field.name];
  const common = {
    id,
    name: field.name,
    required: field.required,
    "aria-invalid": Boolean(error),
    "aria-describedby": error ? `${id}-err` : undefined,
    onChange: () => onEdit(field.name),
  };
  return (
    <div className="form-group">
      <label htmlFor={id}>
        {field.label} {field.required && <span className="req">*</span>}
      </label>
      {field.type === "select" ? (
        <select {...common} defaultValue="">
          <option value="">-- Select --</option>
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : field.type === "date" ? (
        <input {...common} type="date" min="1900-01-01" max={field.pastOnly ? today : undefined} />
      ) : (
        <input {...common} type="text" placeholder={field.placeholder} maxLength={field.maxLength ?? 100} />
      )}
      {error && (
        <div className="form-hint warn" id={`${id}-err`}>
          <i className="fas fa-exclamation-circle" aria-hidden="true" /> {error}
        </div>
      )}
    </div>
  );
}

function PaymentOption(props: {
  selected: boolean;
  onSelect: () => void;
  icon: string;
  variant: "gcash" | "church";
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={props.selected}
      aria-label={`${props.title}: ${props.description}`}
      className={`payment-option${props.selected ? " selected" : ""}`}
      onClick={props.onSelect}
    >
      <div className={`payment-option-icon ${props.variant}`}>
        <i className={`fas ${props.icon}`} aria-hidden="true" />
      </div>
      <div className="payment-option-info">
        <h4>{props.title}</h4>
        <p>{props.description}</p>
      </div>
    </button>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
