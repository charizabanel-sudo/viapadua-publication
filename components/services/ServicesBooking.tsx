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
import type { BookingResult } from "@/lib/booking/submit";
import { newRequestId, statusMessage, submitJson, UNCERTAIN_MESSAGE } from "@/lib/client/submit";
import type { CreatedBooking } from "@/lib/booking/create";
import {
  BLESSING_OPTIONS,
  SERVICE_CARDS,
  formatPeso,
  getBookableService,
  getServiceFee,
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
  findSlotConflict,
  isBlockedWeekday,
  isWithinServiceHours,
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
  signedIn?: boolean;
  account?: {
    fullname: string;
    email: string;
    phone?: string | null;
  };
};

export default function ServicesBooking({ gcashPayee, signedIn = false, account }: Props) {
  const [openReqs, setOpenReqs] = useState<ReadonlySet<string>>(new Set());
  const [selectedCatalogService, setSelectedCatalogService] = useState<string | null>(null);
  const {
    active,
    servicesState,
    navigateServices,
    requestClose,
    registerGuard,
  } = usePublicOverlay();
  const service: BookableService | null =
    getBookableService(servicesState.service) ?? null;
  const serviceCard = service
    ? SERVICE_CARDS.find((card) => card.serviceCodes.includes(service.code))
    : undefined;
  const [blessingChoice, setBlessingChoice] = useState("");
  const [blessingError, setBlessingError] = useState(false);
  const [payment, setPayment] = useState<Payment>("");
  const [serviceType, setServiceType] = useState<"ordinary" | "special" | null>(null);
  const [date, setDate] = useState("");
  const [adminBlockedDate, setAdminBlockedDate] = useState(false);
  const [reservedTimes, setReservedTimes] = useState<string[]>([]);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedBooking | null>(null);
  const [certificateRecipientName, setCertificateRecipientName] = useState("");
  const [dirty, setDirty] = useState(false);
  const [formVersion, setFormVersion] = useState(0);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();
  const bookingFormRef = useRef<HTMLFormElement>(null);
  const gcashFirstFieldRef = useRef<HTMLInputElement>(null);
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const requestIdRef = useRef("");
  const sendingRef = useRef(false);

  useEffect(() => {
    if (!date) {
      return;
    }
    const controller = new AbortController();
    void fetch(`/api/bookings?date=${encodeURIComponent(date)}`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((availability: { blocked?: boolean; reserved?: string[] } | null) => {
        if (!availability) return;
        setAdminBlockedDate(Boolean(availability.blocked));
        setReservedTimes(availability.reserved ?? []);
        if (availability.blocked) {
          setErrors((current) => ({
            ...current,
            bookDate: "The parish office is not accepting appointments on this date. Please choose another date.",
          }));
        } else {
          setErrors((current) => {
            const next = { ...current };
            delete next.bookDate;
            return next;
          });
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, [date]);

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
            "You have unsent appointment details. Continue? Details stay available while switching views, but choosing another service or leaving or reloading this page discards them.",
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
        "Choose another service and discard the current appointment details?",
      )
    )
      return;
    setPayment(selected.fee === 0 ? "church" : "");
    setServiceType(null);
    setDate("");
    setErrors({});
    setFormError(null);
    setCreated(null);
    setCopied(false);
    requestIdRef.current = "";
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

  function validateTime(value: string) {
    if (!value) {
      clearError("bookTime");
      return;
    }
    if (!isWithinServiceHours(value)) {
      setErrors((prev) => ({
        ...prev,
        bookTime: `Please choose a time between ${formatTime12h(EARLIEST_TIME)} and ${formatTime12h(LATEST_TIME)}.`,
      }));
      return;
    }
    const conflict = findSlotConflict(value, reservedTimes);
    if (conflict) {
      setErrors((prev) => ({
        ...prev,
        bookTime: `This time conflicts with an existing appointment at ${formatTime12h(conflict)}. Please choose another time.`,
      }));
      return;
    }
    clearError("bookTime");
  }

  function send(formData: FormData, fromGcash: boolean) {
    if (sendingRef.current) return;
    sendingRef.current = true;
    requestIdRef.current ||= newRequestId();
    formData.set("clientRequestId", requestIdRef.current);
    setFormError(null);
    startTransition(async () => {
      try {
        const outcome = await submitJson<BookingResult>("/api/bookings", { body: formData });
        if (outcome.kind === "uncertain") {
          setFormError(UNCERTAIN_MESSAGE);
          return;
        }
        const result = outcome.data;
        if (result?.status === "success") {
          requestIdRef.current = "";
          setCreated(result.booking);
          setDirty(false);
          setErrors({});
          setStep("success");
          return;
        }
        const fieldErrors = result?.fieldErrors ?? {};
        setErrors(fieldErrors);
        const keys = Object.keys(fieldErrors);
        const stayOnGcash = fromGcash && keys.every((k) => GCASH_FIELDS.includes(k));
        setStep(stayOnGcash ? "gcash" : "form");
        const messages = Object.entries(fieldErrors).map(([field, message]) => {
          const label =
            field === "serviceType"
              ? "Request type"
              : field === "payment_method"
                ? "Payment method"
                : field === "bookContact"
                  ? "Contact number"
                  : field === "bookDate"
                    ? "Preferred date"
                    : field === "bookTime"
                      ? "Preferred time"
                      : field === "bookFullName"
                        ? "Full name"
                        : field === "bookEmail"
                          ? "Email address"
                          : service?.fields.flat().find((item) => item.name === field)?.label ?? field;
          return `${label}: ${message}`;
        });
        setFormError(
          result?.formError === "Please correct the highlighted fields." && messages.length
            ? `Please check: ${messages.join(" ")}`
            : result?.formError ??
                (result ? "Please check your appointment details." : statusMessage(outcome.status)),
        );
        if (keys.length) {
          requestAnimationFrame(() => {
            const first = keys[0];
            const target =
              first === "serviceType"
                ? document.querySelector<HTMLElement>(".service-type-option")
                : first === "payment_method"
                  ? document.querySelector<HTMLElement>(".payment-options button")
                  : document.getElementById(`f-${first}`);
            target?.scrollIntoView({ block: "center", behavior: "smooth" });
            target?.focus({ preventScroll: true });
          });
        }
      } finally {
        sendingRef.current = false;
      }
    });
  }

  function onBookingSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (hasServiceTypeChoice && !serviceType) {
      const message = "Choose an ordinary or special appointment.";
      setErrors((prev) => ({ ...prev, serviceType: message }));
      setFormError(message);
      return;
    }
    if (!payment) {
      setErrors((prev) => ({
        ...prev,
        payment_method: "Please choose a payment method.",
      }));
      setFormError("Please choose a payment method.");
      return;
    }
    if (date && isBlockedWeekday(date)) {
      const message = `${weekdayName(date)} is not available for appointments. Please choose another date.`;
      setErrors((prev) => ({ ...prev, bookDate: message }));
      setFormError(message);
      return;
    }
    if (adminBlockedDate) {
      const message = "The parish office is not accepting appointments on this date. Please choose another date.";
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
  const dateBlocked = date !== "" && (isBlockedWeekday(date) || adminBlockedDate);
  const hasServiceTypeChoice = service?.code === "baptism";

  return (
    <PublicDialog
      kind="services"
      labelledBy="services-workspace-title"
      className="vp-services services-workspace"
    >
      {/* ===== HEADER: church photo banner + curved navy title bar ===== */}
      <header className="services-workspace-head">
        <div className="services-parish-banner">
          <div className="services-parish-identity">
            <span className="services-parish-saint" aria-hidden="true">
              {/* Place the portrait at public/images/church/st-anthony.png */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/images/church/st-anthony.jpg" alt="" />
            </span>
            <div className="services-parish-name">
              <strong>St. Anthony of Padua Parish</strong>
              <small>
                <span className="dash" aria-hidden="true" />
                Ponso, Polangui, Albay
                <span className="rule" aria-hidden="true" />
              </small>
            </div>
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
        </div>

        <div className="services-workspace-title">
          <div className="services-title-text">
            <h2 id="services-workspace-title">Parish Services</h2>
            <p>
              {signedIn
                ? "View requirements, book a service or request a certificate. Requests are saved to your account."
                : "View requirements and book as a guest. No account is needed."}
            </p>
          </div>
        </div>
      </header>

      <div className="services-workspace-body">
        {certificateType && (
          <CertificateRequestForm
            key={certificateType}
            initialType={certificateType}
            initialRecipientName={certificateRecipientName}
            visible={active === "services"}
            onDirtyChange={setDirty}
            signedIn={signedIn}
            account={account}
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
          {/* Back button only appears once the person has left the catalog */}
          {step !== "catalog" && (
            <div className="services-workspace-nav">
              <button
                type="button"
                disabled={pending}
                onClick={() => setStep("catalog")}
              >
                <i className="fas fa-arrow-left" aria-hidden="true" /> All
                services
              </button>
            </div>
          )}

          <section hidden={step !== "catalog"} aria-label="Available services">
            <div className="blocked-notice" role="note">
              <i className="fas fa-calendar-alt" aria-hidden="true" />
              <p>
                Appointments are unavailable on Sundays and Tuesdays. Please choose
                another day.
              </p>
            </div>

            <h3 className="services-choose-title">Choose a parish service</h3>

            {/* 3-column service grid */}
            <div className="service-catalog-menu">
              {SERVICE_CARDS.map((card) => (
                <button
                  type="button"
                  key={card.slug}
                  className={`service-catalog-word${selectedCatalogService === card.slug ? " active" : ""}`}
                  aria-expanded={selectedCatalogService === card.slug}
                  aria-controls={selectedCatalogService === card.slug ? `${card.slug}-details` : undefined}
                  onClick={() => setSelectedCatalogService((current) => current === card.slug ? null : card.slug)}
                >
                  <span className="service-catalog-icon" aria-hidden="true">
                    <i className={`fas ${card.icon}`} />
                  </span>
                  <span>{card.title}</span>
                  <i className="fas fa-chevron-right service-catalog-arrow" aria-hidden="true" />
                </button>
              ))}
            </div>

            {/* Single card that appears below the grid */}
            <div className="service-catalog-details">
              {SERVICE_CARDS.filter((card) => card.slug === selectedCatalogService).map((card) => {
                const reqOpen = openReqs.has(card.slug);
                const reqId = `req-${card.slug}`;
                return (
                  <div className="card" id={`${card.slug}-details`} key={card.slug}>
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
                            <i className="fas fa-check-circle" aria-hidden="true" />{" "}
                            {req}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="fee-label">Service Fee</div>
                    <div className={`fee-amount${card.priceLabel ? " fee-amount-details" : ""}`}>
                      {card.priceLabel ?? formatPeso(card.fee)}
                    </div>
                    {card.pricingNote && <p className="fee-note">{card.pricingNote}</p>}
                    <div className="payment-info">GCash or pay at the church</div>
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
                        Set Appointment
                      </button>
                      {card.certificate && (
                        <button
                          type="button"
                          className="btn btn-secondary"
                          onClick={() => {
                            const bookingValues = bookingFormRef.current
                              ? new FormData(bookingFormRef.current)
                              : null;
                            const recipientField =
                              card.slug === "baptism"
                                ? "childName"
                                : card.slug === "confirmation"
                                  ? "candidateName"
                                  : null;
                            setCertificateRecipientName(
                              recipientField
                                ? String(bookingValues?.get(recipientField) ?? "")
                                : "",
                            );
                            navigateServices({ service: card.slug, step: "certificate" });
                          }}
                        >
                          Request Certificate
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Gold rule with a small church in the middle */}
            <div className="services-footer-ornament" aria-hidden="true">
              <i className="fas fa-church" />
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

          {/* BOOKING FORM */}
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
                <span className="booking-fee">
                  {service.feeLabel ??
                    (service.code === "baptism" && !serviceType
                      ? "Choose an appointment type"
                      : formatPeso(getServiceFee(service, serviceType)))}
                </span>
              </h3>
              <p className="modal-subtitle">Please fill in the details below</p>
              {serviceCard?.pricingNote && (
                <p className="fee-note">{serviceCard.pricingNote}</p>
              )}

              {formError && step === "form" && (
                <div className="form-error" role="alert">
                  <i className="fas fa-exclamation-triangle" aria-hidden="true" />
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
                {hasServiceTypeChoice && (
                  <div className="service-type-section service-type-first">
                    <input type="hidden" name="serviceType" value={serviceType ?? ""} />
                    <span className="service-type-label">
                      Request Type <span className="req">*</span>
                    </span>
                    <div className="service-type-options">
                      <button
                        type="button"
                        className={`service-type-option${serviceType === "ordinary" ? " active" : ""}`}
                        aria-pressed={serviceType === "ordinary"}
                        onClick={() => {
                          setServiceType("ordinary");
                          setDirty(true);
                          clearError("serviceType");
                        }}
                      >
                        Regular Baptism · {formatPeso(getServiceFee(service, "ordinary"))}
                      </button>
                      <button
                        type="button"
                        className={`service-type-option${serviceType === "special" ? " active" : ""}`}
                        aria-pressed={serviceType === "special"}
                        onClick={() => {
                          setServiceType("special");
                          setDirty(true);
                          clearError("serviceType");
                        }}
                      >
                        <i className="fas fa-star" aria-hidden="true" /> Special Baptism ·{" "}
                        {formatPeso(getServiceFee(service, "special"))} (includes candle)
                      </button>
                    </div>
                    {errors.serviceType && (
                      <div className="form-hint warn" role="alert">
                        {errors.serviceType}
                      </div>
                    )}
                  </div>
                )}
                {serviceType === "special" && (
                  <p className="special-request-fee-note">
                    The special Baptism package includes a candle. The ₱1,650 package price is fixed.
                  </p>
                )}
                <>
                {signedIn && account && (
                  <>
                    <input type="hidden" name="bookFullName" value={account.fullname} />
                    <input type="hidden" name="bookEmail" value={account.email} />
                    {account.phone?.trim() ? (
                      <input type="hidden" name="bookContact" value={account.phone} />
                    ) : (
                      <TextInput
                        name="bookContact"
                        label="Contact Number"
                        type="tel"
                        required={!signedIn || Boolean(account?.phone?.trim())}
                        placeholder="09XX XXX XXXX"
                        autoComplete="tel"
                        errors={errors}
                        onEdit={clearError}
                      />
                    )}
                  </>
                )}
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

                    {!signedIn && (
                      <>
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
                      </>
                    )}

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
                            if (!e.target.value) {
                              setAdminBlockedDate(false);
                              setReservedTimes([]);
                            }
                            clearError("bookDate");
                          }}
                        />
                        <div
                          className={`form-hint${dateBlocked || errors.bookDate ? " warn" : ""}`}
                          id="f-bookDate-hint"
                        >
                          {errors.bookDate ? (
                            <>
                              <i className="fas fa-exclamation-circle" aria-hidden="true" />{" "}
                              {errors.bookDate}
                            </>
                          ) : dateBlocked ? (
                            <>
                              <i className="fas fa-exclamation-circle" aria-hidden="true" />{" "}
                              {adminBlockedDate
                                ? "This date is blocked by the parish office"
                                : `${weekdayName(date)} is blocked`}
                            </>
                          ) : (
                            <>
                              <i className="fas fa-info-circle" aria-hidden="true" /> Not
                              available on Sundays &amp; Tuesdays
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
                          step={60}
                          aria-invalid={Boolean(errors.bookTime)}
                          aria-describedby="f-bookTime-hint"
                          onChange={(event) => validateTime(event.currentTarget.value)}
                        />
                        <div
                          className={`form-hint${errors.bookTime ? " warn" : ""}`}
                          id="f-bookTime-hint"
                        >
                          {errors.bookTime ? (
                            <>
                              <i className="fas fa-exclamation-circle" aria-hidden="true" />{" "}
                              {errors.bookTime}
                            </>
                          ) : (
                            <>
                              <i className="fas fa-info-circle" aria-hidden="true" />{" "}
                              {formatTime12h(EARLIEST_TIME)} to {formatTime12h(LATEST_TIME)}
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div
                      className={`date-warning${dateBlocked ? " show" : ""}`}
                      role={dateBlocked ? "alert" : undefined}
                    >
                      <i className="fas fa-exclamation-triangle" aria-hidden="true" />
                      <span>
                        {dateBlocked
                          ? adminBlockedDate
                            ? "The parish office is not accepting appointments on this date. Please choose another date."
                            : `${weekdayName(date)} is not available for appointments. Please choose another date.`
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

                    <div className="payment-section-title" id="paymentTitle">
                      <i className="fas fa-wallet" aria-hidden="true" /> Payment Method{" "}
                      <span className="req" style={{ color: "#ef4444" }}>*</span>
                    </div>
                    <input type="hidden" name="payment_method" value={payment} />
                    <div
                      className="payment-options"
                      role="radiogroup"
                      aria-labelledby="paymentTitle"
                    >
                      {service.fee > 0 && (
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
                      )}
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
                        <i className="fas fa-exclamation-circle" aria-hidden="true" />{" "}
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
                      <button type="submit" className="btn btn-primary" disabled={pending}>
                        {pending
                          ? "Submitting…"
                          : payment === "gcash"
                            ? "Continue to GCash"
                            : "Confirm Appointment"}
                      </button>
                    </div>
                </>
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
                  <i className="fas fa-info-circle" aria-hidden="true" /> Send your payment to:
                </strong>
                <br />
                GCash Number:{" "}
                <strong>{gcashPayee.number ?? "Please ask the parish office"}</strong>
                <br />
                Account Name:{" "}
                <strong>
                  {gcashPayee.name ??
                    "Use the masked details on the original QR; confirm with the parish office"}
                </strong>
                <br />
                Amount to pay:{" "}
                <span className="amount-highlight">
                  {formatPeso(getServiceFee(service, serviceType))}
                </span>
                {serviceType === "special" && (
                  <p className="special-request-fee-note">
                    The special Baptism package includes a candle.
                  </p>
                )}
              </div>
              <div className="notice-box">
                <i className="fas fa-shield-alt" aria-hidden="true" /> Your appointment
                stays <strong>pending and unpaid</strong> until the parish office
                verifies your GCash reference. Submitting a reference does not mark it
                as paid.
              </div>

              {formError && step === "gcash" && (
                <div className="form-error" role="alert">
                  <i className="fas fa-exclamation-triangle" aria-hidden="true" />
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
                  <label htmlFor="payment-proof">Payment evidence (optional)</label>
                  <input
                    id="payment-proof"
                    name="paymentProof"
                    type="file"
                    accept="image/jpeg,image/png,application/pdf"
                  />
                  <p>
                    JPEG, PNG or PDF up to 3 MB. Uploaded privately; staff must verify
                    payment.
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
                  <button type="submit" className="btn btn-primary" disabled={pending}>
                    {pending ? "Submitting…" : "Submit Appointment"}
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
                  Appointment Request Submitted
                </h3>
                <p className="modal-subtitle" role="status">
                  <strong>Your request has been submitted to the parish office.</strong>{" "}
                  Status: Pending. The parish office will review your request and
                  contact you.
                </p>
                <div className="reference-box">
                  <div className="reference-label">Your reference number</div>
                  <div className="reference-value">{created.reference}</div>
                  <button type="button" className="copy-btn" onClick={copyReference}>
                    <i className="fas fa-copy" aria-hidden="true" />{" "}
                    {copied ? "Copied" : "Copy reference"}
                  </button>
                </div>
              </div>
              <div className="summary-list">
                <SummaryRow
                  label="Service"
                  value={
                    service?.code === "baptism" && serviceType
                      ? `${created.service} (${serviceType === "special" ? "Special" : "Regular"})`
                      : created.service
                  }
                />
                <SummaryRow label="Date" value={formatDateLong(created.date)} />
                <SummaryRow label="Time" value={formatTime12h(created.time)} />
                <SummaryRow
                  label={service?.feeLabel ? "Offering" : "Amount"}
                  value={service?.feeLabel ?? formatPeso(created.fee)}
                />
                <SummaryRow
                  label="Payment"
                  value={
                    created.paymentMethod === "gcash"
                      ? "GCash (awaiting verification)"
                      : service?.feeLabel
                        ? "Donation at the parish office"
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
                Please save your reference number and present it at the parish office.{" "}
                {created.paymentMethod === "church"
                  ? service?.feeLabel
                    ? "Any donation may be offered at the parish office."
                    : "Payment is made in person at the parish office."
                  : "The parish office will verify your GCash reference before marking the appointment as paid."}
              </div>
              <div className="modal-actions">
                <a
                  className="btn btn-secondary"
                  href={`/api/bookings/${encodeURIComponent(created.reference)}/receipt`}
                >
                  <i className="fas fa-download" aria-hidden="true" /> Download booking receipt (UNPAID)
                </a>
                <button type="button" className="btn btn-primary" onClick={close}>
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