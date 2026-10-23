"use client";

import {
  useEffect,
  useRef,
  useState,
  useTransition,
  type FormEvent,
  type Ref,
} from "react";
import {
  PublicDialog,
  usePublicOverlay,
} from "@/components/public/PublicOverlayProvider";
import PaymentQr from "./PaymentQr";
import CertificateRequestForm from "./CertificateRequestForm";
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
type Step = "catalog" | "blessing" | "form" | "gcash" | "success";
type Payment = "" | "gcash" | "church";

const GCASH_FIELDS = ["gcashAccountName", "gcashNumber", "gcashRefNumber"];

type Props = {
  gcashPayee: {
    number: string | null;
    name: string | null;
    qrPath: string | null;
  };
  /** Rendered inside the signed-in portal: submissions are saved to the account. */
  signedIn?: boolean;
};

export default function ServicesBooking({ gcashPayee, signedIn = false }: Props) {
  const [openReqs, setOpenReqs] = useState<ReadonlySet<string>>(new Set());
  const {
    active,
    servicesState,
    navigateServices,
    requestClose,
    requestOpen,
    registerGuard,
  } = usePublicOverlay();
  const service: BookableService | null =
    getBookableService(servicesState.service) ?? null;
  const [blessingChoice, setBlessingChoice] = useState("");
  const [blessingError, setBlessingError] = useState(false);
  const [payment, setPayment] = useState<Payment>("");
  const [date, setDate] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedBooking | null>(null);
  const [dirty, setDirty] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const bookingFormRef = useRef<HTMLFormElement>(null);
  const gcashFirstFieldRef = useRef<HTMLInputElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const rawStep = servicesState.step;
  const certificateType = rawStep === "certificate" && SERVICE_CARDS.some((card) => card.slug === servicesState.service && card.certificate) ? servicesState.service : "";
  let step: Step = "catalog";
  if (rawStep === "blessing") step = "blessing";
  else if (rawStep === "success" && created) step = "success";
  else if (service && (rawStep === "form" || rawStep === "gcash"))
    step = rawStep === "gcash" && payment === "gcash" ? "gcash" : "form";
  const formKey = `${service?.code ?? "booking"}-${formVersion}`;
  function setStep(next: Step) {
    navigateServices({ step: next });
  }

  useEffect(() => {
    return registerGuard(
      "services",
      () =>
        !pending &&
        (!dirty ||
          window.confirm(
            "You have unsent booking details. Continue? Details stay available while switching views, but choosing another service or leaving or reloading this page discards them.",
          )),
    );
  }, [registerGuard, pending, dirty]);

  useEffect(() => {
    if (!dirty || created) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, created]);

  // Move focus into the GCash step when it opens (its form stays mounted to keep entered values).
  useEffect(() => {
    if (active !== "services") return;
    const frame = requestAnimationFrame(() => {
      if (step === "gcash") gcashFirstFieldRef.current?.focus();
      else stepHeadingRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [step, active]);

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
    if (code === service?.code && !created) {
      setStep("form");
      return;
    }
    if (
      dirty &&
      !window.confirm(
        "Choose another service and discard the current booking details?",
      )
    )
      return;
    setPayment("");
    setDate("");
    setErrors({});
    setFormError(null);
    setCreated(null);
    setCopied(false);
    setFormVersion((version) => version + 1);
    setDirty(false);
    navigateServices({ service: selected.code, step: "form" });
  }

  function openBlessing() {
    setBlessingChoice("");
    setBlessingError(false);
    navigateServices({
      service: service?.code ?? "blessing",
      step: "blessing",
    });
  }

  function close() {
    if (!pending) requestClose();
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
          setDirty(false);
          setStep("success");
          return;
        }
        setErrors(result.fieldErrors);
        setFormError(result.formError ?? "Please check your booking details.");
        const keys = Object.keys(result.fieldErrors);
        const stayOnGcash =
          fromGcash && keys.every((k) => GCASH_FIELDS.includes(k));
        setStep(stayOnGcash ? "gcash" : "form");
      } catch {
        setFormError(
          "We couldn't reach the server. Please check your connection and try again.",
        );
      }
    });
  }

  function onBookingSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!payment) {
      setErrors((prev) => ({
        ...prev,
        payment_method: "Please choose a payment method.",
      }));
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
    for (const [key, value] of new FormData(e.currentTarget).entries())
      data.set(key, value);
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

  const today = todayInParish();
  const dateBlocked = date !== "" && isBlockedWeekday(date);

  return (
    <PublicDialog
      kind="services"
      labelledBy="services-workspace-title"
      className="vp-services services-workspace"
    >
      <header className="services-workspace-head">
        <div>
          <h2 id="services-workspace-title">Parish Services</h2>
          <p>
            {signedIn
              ? "View requirements, book a service or request a certificate. Requests are saved to your account."
              : "View requirements and book as a guest. No account is needed."}
          </p>
        </div>
        <button
          type="button"
          className="workspace-close"
          onClick={close}
          disabled={pending}
          aria-label="Close services"
        >
          <i className="fas fa-times" aria-hidden="true" />
        </button>
      </header>
      <div className="services-workspace-body">
        {certificateType && (
          <CertificateRequestForm
            key={certificateType}
            initialType={certificateType}
            visible={active === "services"}
            onDirtyChange={setDirty}
            onBack={() => {
              if (
                !dirty ||
                window.confirm("Discard unsent certificate request details?")
              ) {
                navigateServices({ service: "", step: "catalog" });
                setDirty(false);
              }
            }}
          />
        )}
        <div hidden={Boolean(certificateType)}>
          <div className="services-workspace-nav">
            {step !== "catalog" ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => setStep("catalog")}
              >
                <i className="fas fa-arrow-left" aria-hidden="true" /> All
                services
              </button>
            ) : (
              <span>Choose a parish service</span>
            )}
            <button
              type="button"
              disabled={pending}
              onClick={() => requestOpen("chat")}
            >
              <i className="fas fa-comment" aria-hidden="true" /> Message the
              parish
            </button>
          </div>
          <section hidden={step !== "catalog"} aria-label="Available services">
            <div className="blocked-notice">
              <i className="fas fa-calendar-alt" aria-hidden="true" />
              <p>
                Bookings are unavailable on Sundays and Tuesdays. Please choose
                another day.
              </p>
            </div>
            <div className="cards-grid">
              {SERVICE_CARDS.map((card) => {
                const reqOpen = openReqs.has(card.slug);
                const reqId = `req-${card.slug}`;
                return (
                  <div className="card" id={card.slug} key={card.slug}>
                    <div className="card-icon-bg" aria-hidden="true">
                      <i className={`fas ${card.icon}`} />
                    </div>
                    <h3 className="service-title">{card.title}</h3>
                    <p className="service-subtitle">{card.subtitle}</p>
                    <h4 className="section-label">About {card.title}</h4>
                    <p className="description">{card.about}</p>
                    <button
                      type="button"
                      className="requirements-toggle"
                      aria-expanded={reqOpen}
                      aria-controls={reqId}
                      onClick={() => toggleRequirements(card.slug)}
                    >
                      <span className="left">
                        <i className="fas fa-list-ul" aria-hidden="true" /> View
                        Requirements
                      </span>
                      <i className="fas fa-chevron-down" aria-hidden="true" />
                    </button>
                    <div
                      className={`requirements-content${reqOpen ? " show" : ""}`}
                      id={reqId}
                    >
                      <ul>
                        {card.requirements.map((req) => (
                          <li key={req}>
                            <i
                              className="fas fa-check-circle"
                              aria-hidden="true"
                            />{" "}
                            {req}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="fee-label">Service Fee</div>
                    <div className="fee-amount">{formatPeso(card.fee)}</div>
                    <div className="payment-info">
                      GCash or pay at the church
                    </div>
                    <div className="button-group">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() =>
                          card.serviceCodes.length > 1
                            ? openBlessing()
                            : openBooking(card.serviceCodes[0])
                        }
                      >
                        Book Now
                      </button>
                      {card.certificate && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => navigateServices({ service: card.slug, step: "certificate" })}
                        >
                          Request Certificate
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* BLESSING CHOOSER */}
          <section
            hidden={step !== "blessing"}
            className="services-step"
            aria-labelledby="blessingTitle"
          >
            <h3
              className="modal-title"
              id="blessingTitle"
              ref={step === "blessing" ? stepHeadingRef : undefined}
              tabIndex={-1}
            >
              Blessing Service
            </h3>
            <p className="modal-subtitle">Choose the type of blessing</p>
            {blessingError && (
              <div className="form-error" role="alert">
                <i className="fas fa-exclamation-triangle" aria-hidden="true" />{" "}
                Please choose a type of blessing.
              </div>
            )}
            <div
              className="payment-options"
              role="radiogroup"
              aria-labelledby="blessingTitle"
            >
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
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setStep("catalog")}
              >
                All services
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() =>
                  blessingChoice
                    ? openBooking(blessingChoice)
                    : setBlessingError(true)
                }
              >
                Continue
              </button>
            </div>
          </section>

          {/* BOOKING FORM (kept mounted during the GCash step so its values are preserved) */}
          {service && (
            <section
              hidden={step !== "form"}
              className="services-step"
              aria-labelledby="bookingModalTitle"
            >
              <h3
                className="modal-title"
                id="bookingModalTitle"
                ref={step === "form" ? stepHeadingRef : undefined}
                tabIndex={-1}
              >
                Book {service.name}{" "}
                <span className="booking-fee">{formatPeso(service.fee)}</span>
              </h3>
              <p className="modal-subtitle">Please fill in the details below</p>

              {formError && step === "form" && (
                <div className="form-error" role="alert">
                  <i
                    className="fas fa-exclamation-triangle"
                    aria-hidden="true"
                  />
                  <span>{formError}</span>
                </div>
              )}

              <form
                ref={bookingFormRef}
                key={formKey}
                onSubmit={onBookingSubmit}
                onInput={() => setDirty(true)}
                aria-busy={pending}
              >
                <input type="hidden" name="serviceCode" value={service.code} />
                <div className="hp-field" aria-hidden="true">
                  <label htmlFor="website">Website</label>
                  <input
                    id="website"
                    name="website"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                  />
                </div>

                <div className="form-row">
                  <TextInput
                    name="bookFullName"
                    label="Full Name"
                    required
                    autoComplete="name"
                    errors={errors}
                    onEdit={clearError}
                  />
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
                    <div
                      className={`form-hint${dateBlocked || errors.bookDate ? " warn" : ""}`}
                      id="f-bookDate-hint"
                    >
                      {errors.bookDate ? (
                        <>
                          <i
                            className="fas fa-exclamation-circle"
                            aria-hidden="true"
                          />{" "}
                          {errors.bookDate}
                        </>
                      ) : dateBlocked ? (
                        <>
                          <i
                            className="fas fa-exclamation-circle"
                            aria-hidden="true"
                          />{" "}
                          {weekdayName(date)} is blocked
                        </>
                      ) : (
                        <>
                          <i
                            className="fas fa-info-circle"
                            aria-hidden="true"
                          />{" "}
                          Not available on Sundays &amp; Tuesdays
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
                    <div
                      className={`form-hint${errors.bookTime ? " warn" : ""}`}
                      id="f-bookTime-hint"
                    >
                      {errors.bookTime ? (
                        <>
                          <i
                            className="fas fa-exclamation-circle"
                            aria-hidden="true"
                          />{" "}
                          {errors.bookTime}
                        </>
                      ) : (
                        <>
                          <i
                            className="fas fa-info-circle"
                            aria-hidden="true"
                          />{" "}
                          {formatTime12h(EARLIEST_TIME)} to{" "}
                          {formatTime12h(LATEST_TIME)}
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div
                  className={`date-warning${dateBlocked ? " show" : ""}`}
                  role={dateBlocked ? "alert" : undefined}
                >
                  <i
                    className="fas fa-exclamation-triangle"
                    aria-hidden="true"
                  />
                  <span>
                    {dateBlocked
                      ? `${weekdayName(date)} is not available for bookings. Please choose another date.`
                      : ""}
                  </span>
                </div>

                {service.fields.map((row, i) =>
                  row.length > 1 ? (
                    <div className="form-row" key={i}>
                      {row.map((field) => (
                        <ServiceInput
                          key={field.name}
                          field={field}
                          today={today}
                          errors={errors}
                          onEdit={clearError}
                        />
                      ))}
                    </div>
                  ) : (
                    <ServiceInput
                      key={row[0].name}
                      field={row[0]}
                      today={today}
                      errors={errors}
                      onEdit={clearError}
                    />
                  ),
                )}

                <div className="form-group">
                  <label htmlFor="f-bookNotes">
                    Additional Notes / Special Requests
                  </label>
                  <textarea
                    id="f-bookNotes"
                    name="bookNotes"
                    maxLength={1000}
                    placeholder="Any special instructions or requests..."
                    aria-invalid={Boolean(errors.bookNotes)}
                  />
                  {errors.bookNotes && (
                    <div className="form-hint warn">{errors.bookNotes}</div>
                  )}
                </div>

                <div className="payment-section-title" id="paymentTitle">
                  <i className="fas fa-wallet" aria-hidden="true" /> Payment
                  Method{" "}
                  <span className="req" style={{ color: "#ef4444" }}>
                    *
                  </span>
                </div>
                <input type="hidden" name="payment_method" value={payment} />
                <div
                  className="payment-options"
                  role="radiogroup"
                  aria-labelledby="paymentTitle"
                >
                  <PaymentOption
                    selected={payment === "gcash"}
                    onSelect={() => {
                      setPayment("gcash");
                      setDirty(true);
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
                      setDirty(true);
                      clearError("payment_method");
                    }}
                    icon="fa-church"
                    variant="church"
                    title="Pay at the Church"
                    description="Pay in person at the parish office"
                  />
                </div>
                {errors.payment_method && (
                  <div className="form-hint warn payment-error">
                    <i
                      className="fas fa-exclamation-circle"
                      aria-hidden="true"
                    />{" "}
                    {errors.payment_method}
                  </div>
                )}

                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={close}
                    disabled={pending}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={pending}
                  >
                    {pending
                      ? "Submitting…"
                      : payment === "gcash"
                        ? "Continue to GCash"
                        : "Confirm Booking"}
                  </button>
                </div>
              </form>
            </section>
          )}

          {/* GCASH STEP */}
          {service && (
            <section
              hidden={step !== "gcash"}
              className="services-step"
              aria-labelledby="gcashTitle"
            >
              <h3 className="modal-title" id="gcashTitle">
                GCash Payment
              </h3>
              <p className="modal-subtitle">Enter your GCash payment details</p>
              <PaymentQr path={gcashPayee.qrPath} />
              <div className="gcash-info-box">
                <strong>
                  <i className="fas fa-info-circle" aria-hidden="true" /> Send
                  your payment to:
                </strong>
                <br />
                GCash Number:{" "}
                <strong>
                  {gcashPayee.number ?? "Please ask the parish office"}
                </strong>
                <br />
                Account Name:{" "}
                <strong>
                  {gcashPayee.name ??
                    "Use the masked details on the original QR; confirm with the parish office"}
                </strong>
                <br />
                Amount to pay:{" "}
                <span className="amount-highlight">
                  {formatPeso(service.fee)}
                </span>
              </div>
              <div className="notice-box">
                <i className="fas fa-shield-alt" aria-hidden="true" /> Your
                booking stays <strong>pending and unpaid</strong> until the
                parish office verifies your GCash reference. Submitting a
                reference does not mark it as paid.
              </div>

              {formError && step === "gcash" && (
                <div className="form-error" role="alert">
                  <i
                    className="fas fa-exclamation-triangle"
                    aria-hidden="true"
                  />
                  <span>{formError}</span>
                </div>
              )}

              <form
                key={formKey}
                onSubmit={onGcashSubmit}
                onInput={() => setDirty(true)}
                aria-busy={pending}
              >
                <TextInput
                  name="gcashAccountName"
                  label="GCash Account Name"
                  required
                  placeholder="Name on your GCash"
                  errors={errors}
                  onEdit={clearError}
                  inputRef={gcashFirstFieldRef}
                />
                <TextInput
                  name="gcashNumber"
                  label="GCash Number"
                  type="tel"
                  required
                  placeholder="09XX XXX XXXX"
                  errors={errors}
                  onEdit={clearError}
                />
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
                  <label htmlFor="payment-proof">
                    Payment evidence (optional)
                  </label>
                  <input
                    id="payment-proof"
                    name="paymentProof"
                    type="file"
                    accept="image/jpeg,image/png,application/pdf"
                  />
                  <p>
                    JPEG, PNG or PDF up to 3 MB. Uploaded privately; staff must
                    verify payment.
                  </p>
                </div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setStep("form")}
                    disabled={pending}
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={pending}
                  >
                    {pending ? "Submitting…" : "Submit Booking"}
                  </button>
                </div>
              </form>
            </section>
          )}

          {/* SUCCESS */}
          {created && (
            <section
              hidden={step !== "success"}
              className="services-step"
              aria-labelledby="successTitle"
            >
              <div className="success-view">
                <div className="success-icon" aria-hidden="true">
                  <i className="fas fa-check" />
                </div>
                <h3
                  className="modal-title"
                  id="successTitle"
                  ref={step === "success" ? stepHeadingRef : undefined}
                  tabIndex={-1}
                >
                  Booking Request Submitted
                </h3>
                <p className="modal-subtitle">
                  The parish office will review your request and contact you.
                </p>
                <div className="reference-box">
                  <div className="reference-label">Your reference number</div>
                  <div className="reference-value">{created.reference}</div>
                  <button
                    type="button"
                    className="copy-btn"
                    onClick={copyReference}
                  >
                    <i className="fas fa-copy" aria-hidden="true" />{" "}
                    {copied ? "Copied" : "Copy reference"}
                  </button>
                </div>
              </div>
              <div className="summary-list">
                <SummaryRow label="Service" value={created.service} />
                <SummaryRow label="Date" value={formatDateLong(created.date)} />
                <SummaryRow label="Time" value={formatTime12h(created.time)} />
                <SummaryRow label="Fee" value={formatPeso(created.fee)} />
                <SummaryRow
                  label="Payment"
                  value={
                    created.paymentMethod === "gcash"
                      ? "GCash (awaiting verification)"
                      : "Pay at the church"
                  }
                />
                <div className="summary-row">
                  <span>Status</span>
                  <strong>
                    <span className="status-pill">Pending · Unpaid</span>
                  </strong>
                </div>
              </div>
              <div className="notice-box">
                Please save your reference number and present it at the parish
                office.{" "}
                {created.paymentMethod === "church"
                  ? "Payment is made in person at the parish office."
                  : "The parish office will verify your GCash reference before marking the booking as paid."}
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={close}
                >
                  Done
                </button>
              </div>
            </section>
          )}
        </div>
      </div>
    </PublicDialog>
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

function TextInput({
  name,
  label,
  type = "text",
  required,
  placeholder,
  autoComplete,
  autoFocus,
  inputRef,
  errors,
  onEdit,
}: InputProps) {
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
          <option value="">Please select</option>
          {field.options?.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : field.type === "date" ? (
        <input
          {...common}
          type="date"
          min="1900-01-01"
          max={field.pastOnly ? today : undefined}
        />
      ) : (
        <input
          {...common}
          type="text"
          placeholder={field.placeholder}
          maxLength={field.maxLength ?? 100}
        />
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
