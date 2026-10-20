"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  CERT_FIELDS,
  certKind,
  certPrefill,
  getCertificateCSS,
  getCertificateHTML,
  type CertificateBooking,
} from "@/lib/certificates/legacy-certificate";
import { saveCertificateAction } from "@/lib/server/actions/admin";
import Dialog from "./Dialog";
import { showToast } from "./Toaster";

type Props = {
  bookingId: number;
  reference: string;
  booking: CertificateBooking;
  saved: Record<string, unknown> | null;
  label: string;
};

type Values = Record<string, string | number>;

const DISCARD_PROMPT = "Discard unsaved certificate changes?";

/** Opens the certificate workspace. Admins edit details directly on the certificate. */
export default function CertificateEditor({ bookingId, reference, booking, saved, label }: Props) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  // Latest saved certificate from this dialog (the page also refreshes from the server after a save).
  const [localSaved, setLocalSaved] = useState<Record<string, unknown> | null>(null);
  const dirtyRef = useRef(false);

  const requestClose = useCallback(() => {
    if (dirtyRef.current && !window.confirm(DISCARD_PROMPT)) return;
    dirtyRef.current = false;
    setOpen(false);
  }, []);

  return (
    <>
      <button
        type="button"
        className="btn btn-blue btn-sm"
        onClick={() => {
          setFormKey((k) => k + 1);
          setOpen(true);
        }}
      >
        <i className="fas fa-scroll" aria-hidden="true" /> {label}
      </button>
      <Dialog open={open} title={`Certificate — ${booking.service} (${reference})`} onClose={requestClose} wide>
        <Workspace
          key={formKey}
          bookingId={bookingId}
          booking={booking}
          saved={localSaved ?? saved}
          onSaved={(c) => setLocalSaved(c)}
          onDirtyChange={(d) => {
            dirtyRef.current = d;
          }}
          onClose={requestClose}
        />
      </Dialog>
    </>
  );
}

const EXTRA_LABELS: Record<string, string> = {
  dateGiven: "Date given",
  place: "Place",
  priest: "Parish priest",
  minister: "Confirming bishop",
  witness: "Witness",
  witnesses: "Witnesses",
  fatherName: "Father's name",
  motherName: "Mother's name",
  godparents: "Godparents / sponsors",
  birthDate: "Birth date",
  birthPlace: "Birthplace",
  baptizedAt: "Baptized at",
  baptizedDate: "Date of baptism",
  fullName: "Name",
  childName: "Child's name",
  groomName: "Groom's name",
  brideName: "Bride's name",
};

type Field = { id: string; key: string; date: boolean; left: number; top: number; width: number; height: number };

function Workspace({
  bookingId,
  booking,
  saved,
  onSaved,
  onDirtyChange,
  onClose,
}: {
  bookingId: number;
  booking: CertificateBooking;
  saved: Record<string, unknown> | null;
  onSaved: (cert: Record<string, unknown>) => void;
  onDirtyChange: (dirty: boolean) => void;
  onClose: () => void;
}) {
  const kind = certKind(booking.service);
  const fieldDefs = CERT_FIELDS[kind] ?? CERT_FIELDS.generic;
  const labels = useMemo(() => {
    const map: Record<string, string> = { ...EXTRA_LABELS };
    for (const f of fieldDefs) map[f.key] = f.label;
    return map;
  }, [fieldDefs]);

  const [values, setValues] = useState<Values>(() => certPrefill(booking, saved ?? {}));
  const [srcDoc, setSrcDoc] = useState("");
  const [fields, setFields] = useState<Field[]>([]);
  const [focused, setFocused] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [stageWidth, setStageWidth] = useState(0);
  const [pending, startTransition] = useTransition();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const printRef = useRef<HTMLIFrameElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  /** Set by Escape so the following blur discards the draft instead of committing it. */
  const cancelEditRef = useRef(false);

  /** Structured certificate data (exactly what is saved and printed). */
  const collect = useCallback(
    (v: Values): Record<string, string | number> => {
      const c: Record<string, string | number> = {
        dateGiven: String(v.dateGiven ?? ""),
        place: String(v.place ?? "").trim(),
        priest: String(v.priest ?? "").trim(),
        nameDy: Number(v.nameDy) || 0,
        nameScale: Number(v.nameScale) || 100,
      };
      for (const f of fieldDefs) c[f.key] = String(v[f.key] ?? "").trim();
      if (kind === "confirmation" || kind === "baptism") c.parents = [c.fatherName, c.motherName].filter(Boolean).join(" & ");
      if (kind === "baptism") c.fullName = c.childName;
      if (kind === "marriage") c.fullName = [c.groomName, c.brideName].filter(Boolean).join(" & ");
      if (kind === "confirmation") c.minister = String(v.minister ?? "").trim();
      return c;
    },
    [fieldDefs, kind],
  );

  const [baseline, setBaseline] = useState(() => JSON.stringify(collect(certPrefill(booking, saved ?? {}))));
  const dirty = JSON.stringify(collect(values)) !== baseline;

  useEffect(() => {
    onDirtyChange(dirty);
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, onDirtyChange]);

  // Re-render the editable certificate when committed values change.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const css = `${getCertificateCSS()} html, body { background: #ecebe4; overflow: hidden; } body { padding: 0; } .cert-sheet { width: 100% !important; box-shadow: none !important; }`;
      const html = getCertificateHTML(booking, collect(values), { edit: true });
      setSrcDoc(`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>${css}</style></head><body>${html}</body></html>`);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [values, booking, collect]);

  /** Measures every marked field inside the certificate and positions an input over it. */
  const measure = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    const win = frameRef.current?.contentWindow as (Window & { __certFit?: () => void }) | null;
    if (!doc || !win) return;
    win.__certFit?.();
    setStageWidth(stageRef.current?.clientWidth ?? 0);
    const groups = new Map<string, { key: string; date: boolean; rects: DOMRect[] }>();
    let n = 0;
    doc.querySelectorAll<HTMLElement>("[data-f]").forEach((el) => {
      const key = el.dataset.f!;
      const date = el.dataset.k === "date";
      const id = date ? `${key}-date` : `${key}-${n++}`;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return;
      const g = groups.get(id) ?? { key, date, rects: [] };
      g.rects.push(r);
      groups.set(id, g);
    });
    const next: Field[] = [];
    for (const [id, g] of groups) {
      const left = Math.min(...g.rects.map((r) => r.left));
      const top = Math.min(...g.rects.map((r) => r.top));
      const right = Math.max(...g.rects.map((r) => r.right));
      const bottom = Math.max(...g.rects.map((r) => r.bottom));
      next.push({ id, key: g.key, date: g.date, left, top, width: right - left, height: bottom - top });
    }
    next.sort((a, b) => (Math.abs(a.top - b.top) < 6 ? a.left - b.left : a.top - b.top));
    setFields(next);
  }, []);

  const onFrameLoad = useCallback(() => {
    measure();
    const doc = frameRef.current?.contentDocument;
    doc?.fonts?.ready.then(() => measure()).catch(() => undefined);
    doc?.querySelector<HTMLImageElement>(".cert-bg")?.addEventListener("load", () => measure(), { once: true });
  }, [measure]);

  // Keep overlays aligned on resize / zoom.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    });
    ro.observe(frame);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [measure]);

  const commit = (key: string, value: string) => {
    setValues((v) => (String(v[key] ?? "") === value ? v : { ...v, [key]: value }));
  };

  const printClean = (cert: Record<string, string | number>) =>
    new Promise<void>((resolve) => {
      const frame = printRef.current;
      if (!frame) return resolve();
      frame.onload = () => {
        frame.onload = null;
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        resolve();
      };
      frame.srcdoc = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Certificate</title><style>${getCertificateCSS()}</style></head><body>${getCertificateHTML(booking, cert)}</body></html>`;
    });

  const save = (thenPrint: boolean) => {
    const cert = collect(values);
    startTransition(async () => {
      try {
        const result = await saveCertificateAction(bookingId, cert);
        showToast(result.ok, result.message);
        if (result.ok) {
          setBaseline(JSON.stringify(cert));
          onSaved(cert);
        }
        if (thenPrint && (result.ok || window.confirm("The certificate could not be saved.\n\nPrint it anyway?"))) await printClean(cert);
      } catch {
        showToast(false, "Request failed. Check your connection and try again.");
      }
    });
  };

  return (
    <div className="cert-workspace">
      <div className="cert-toolbar">
        <p className="cert-tip">
          <i className="fas fa-pen-nib" aria-hidden="true" /> Click or tab to any detail on the certificate to edit it.
        </p>
        <div className="cert-name-controls">
          <label>
            Name position
            <input
              type="range"
              min={-40}
              max={40}
              step={1}
              value={Number(values.nameDy) || 0}
              onChange={(e) => commit("nameDy", e.target.value)}
              aria-valuetext={`${Number(values.nameDy) || 0}`}
            />
          </label>
          <label>
            Name size
            <input
              type="range"
              min={60}
              max={130}
              step={1}
              value={Number(values.nameScale) || 100}
              onChange={(e) => commit("nameScale", e.target.value)}
              aria-valuetext={`${Number(values.nameScale) || 100}%`}
            />
          </label>
        </div>
      </div>

      <div className="cert-stage" ref={stageRef}>
        <iframe ref={frameRef} title="Certificate (editable)" srcDoc={srcDoc} onLoad={onFrameLoad} tabIndex={-1} />
        <div className="cert-overlays">
          {fields.map((f) => {
            const isFocused = focused === f.id;
            const value = String(values[f.key] ?? "");
            const minW = isFocused ? Math.min(Math.max(f.width, 220), Math.max(stageWidth - 8, 120)) : Math.max(f.width, 28);
            const left = Math.max(0, Math.min(f.left - (minW - f.width) / 2, Math.max(0, stageWidth - minW)));
            const height = isFocused ? Math.max(f.height, 34) : Math.max(f.height, 14);
            const style = { left, top: f.top + f.height / 2 - height / 2, width: minW, height };
            const aria = `${labels[f.key] ?? f.key}${value ? "" : " (empty)"}`;
            if (f.date) {
              return (
                <input
                  key={f.id}
                  type="date"
                  className={`cert-field date${isFocused ? " focused" : ""}`}
                  style={style}
                  aria-label={labels.dateGiven}
                  value={value}
                  onFocus={() => setFocused(f.id)}
                  onBlur={() => setFocused(null)}
                  onChange={(e) => e.target.value && commit("dateGiven", e.target.value)}
                />
              );
            }
            return (
              <input
                key={f.id}
                type="text"
                className={`cert-field${isFocused ? " focused" : ""}`}
                style={style}
                aria-label={aria}
                maxLength={200}
                placeholder={labels[f.key]}
                value={isFocused ? draft : value}
                onFocus={() => {
                  setDraft(value);
                  setFocused(f.id);
                }}
                onChange={(e) => setDraft(e.target.value.replace(/[\r\n]+/g, " "))}
                onBlur={() => {
                  if (cancelEditRef.current) cancelEditRef.current = false;
                  else commit(f.key, draft.trim());
                  setFocused(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit(f.key, draft.trim());
                    (e.target as HTMLInputElement).blur();
                  } else if (e.key === "Escape") {
                    e.stopPropagation();
                    cancelEditRef.current = true;
                    setDraft(value);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
            );
          })}
        </div>
      </div>

      {/* Clean, marker-free document used only for printing / Save as PDF. */}
      <iframe ref={printRef} className="cert-print-frame" title="Certificate print" aria-hidden="true" tabIndex={-1} />

      <div className="modal-footer cert-footer">
        <span className={`cert-status${dirty ? " dirty" : ""}`} role="status">
          {dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <button type="button" className="btn btn-outline" onClick={onClose} disabled={pending}>
          Close
        </button>
        <button type="button" className="btn btn-primary" onClick={() => save(false)} disabled={pending}>
          {pending ? <span className="spinner sm" aria-hidden="true" /> : <i className="fas fa-save" aria-hidden="true" />} Save
        </button>
        <button type="button" className="btn btn-gold" onClick={() => save(true)} disabled={pending}>
          <i className="fas fa-print" aria-hidden="true" /> Save &amp; Print / PDF
        </button>
      </div>
    </div>
  );
}
