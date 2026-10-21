"use client";
/* eslint-disable @next/next/no-img-element -- Private blob previews are intentionally unoptimized. */
import { useEffect, useRef, useState } from "react";
import { downloadBlob } from "@/lib/certificates/pdf";
type Candidate = {
  id: number;
  reference: string;
  requesterName: string;
  bookingDate: string;
  service: string;
  evidence: string;
};
type Resolution = {
  kind: string;
  id: string | number;
  reference?: string;
  requesterName?: string;
  bookingId?: number;
  requestId?: string;
};
export default function DocumentScanner({
  initialReference = "",
  initialDocumentId = "",
  initialText = "",
}: {
  initialReference?: string;
  initialDocumentId?: string;
  initialText?: string;
}) {
  const [starting, setStarting] = useState(false);
  const [camera, setCamera] = useState(false),
    [file, setSelectedFile] = useState<File | null>(null),
    [preview, setPreview] = useState("");
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [text, setText] = useState(initialText),
    [query, setQuery] = useState(""),
    [reference, setReference] = useState(initialReference);
  const [documentId, setDocumentId] = useState(initialDocumentId),
    [candidates, setCandidates] = useState<Candidate[]>([]),
    [resolved, setResolved] = useState<Resolution | null>(null),
    [note, setNote] = useState("");
  const video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    mounted = useRef(true),
    busyRef = useRef(false);
  const cameraGeneration = useRef(0),
    startingRef = useRef(false);
  const previewRef = useRef("");
  const setFile = (next: File | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = next ? URL.createObjectURL(next) : "";
    setPreview(previewRef.current);
    setSelectedFile(next);
  };
  const stop = () => {
    cameraGeneration.current++;
    startingRef.current = false;
    setStarting(false);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setCamera(false);
  };
  useEffect(() => {
    mounted.current = true;
    const away = () => {
      cameraGeneration.current++;
      stream.current?.getTracks().forEach((t) => t.stop());
    };
    window.addEventListener("pagehide", away);
    return () => {
      mounted.current = false;
      away();
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
      window.removeEventListener("pagehide", away);
    };
  }, []);
  useEffect(() => {
    const element = video.current;
    if (!camera || !element || !stream.current) return;
    element.srcObject = stream.current;
    void element.play().catch(() => {
      if (mounted.current)
        setMessage(
          "Camera preview could not start. Stop the camera and retry, or import a file.",
        );
    });
    return () => {
      element.srcObject = null;
    };
  }, [camera]);
  async function start() {
    if (startingRef.current) return;
    stop();
    setMessage("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage(
        "Camera is unavailable here. Use a secure HTTPS connection or import a file below.",
      );
      return;
    }
    const generation = cameraGeneration.current;
    startingRef.current = true;
    setStarting(true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
        audio: false,
      });
      if (!mounted.current || generation !== cameraGeneration.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      setCamera(true);
    } catch {
      if (mounted.current && generation === cameraGeneration.current)
        setMessage(
          "Camera access was declined or is unavailable. Import an image or PDF below.",
        );
    } finally {
      if (mounted.current && generation === cameraGeneration.current) {
        startingRef.current = false;
        setStarting(false);
      }
    }
  }
  function capture() {
    const v = video.current;
    if (!v?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext("2d")!.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob && mounted.current) {
          setFile(new File([blob], "paper-scan.jpg", { type: "image/jpeg" }));
          setDocumentId("");
        }
      },
      "image/jpeg",
      0.9,
    );
    stop();
  }
  async function makePdf() {
    if (!file || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const { PDFDocument } = await import("pdf-lib"),
        pdf = await PDFDocument.create(),
        bytes = await file.arrayBuffer();
      const image =
        file.type === "image/png"
          ? await pdf.embedPng(bytes)
          : await pdf.embedJpg(bytes);
      const page = pdf.addPage([595.28, 841.89]),
        scale = Math.min(
          (page.getWidth() - 32) / image.width,
          (page.getHeight() - 32) / image.height,
        );
      page.drawImage(image, {
        x: (page.getWidth() - image.width * scale) / 2,
        y: (page.getHeight() - image.height * scale) / 2,
        width: image.width * scale,
        height: image.height * scale,
      });
      const blob = new Blob([new Uint8Array(await pdf.save())], {
        type: "application/pdf",
      });
      downloadBlob(blob, "paper-scan.pdf");
      setFile(new File([blob], "paper-scan.pdf", { type: "application/pdf" }));
      setDocumentId("");
    } catch {
      setMessage(
        "Could not convert this image. You can upload the original image.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function extract() {
    if (!file || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      if (file.type === "application/pdf") {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const task = pdfjs.getDocument({ data: await file.arrayBuffer() });
        const doc = await task.promise;
        try {
          let result = "";
          for (let n = 1; n <= Math.min(doc.numPages, 10); n++) {
            const page = await doc.getPage(n),
              content = await page.getTextContent();
            result +=
              content.items.map((i) => ("str" in i ? i.str : "")).join(" ") +
              "\n";
          }
          setText(result.slice(0, 12000));
          setMessage(
            result.trim()
              ? "Text extracted locally. Check it against the original; it does not establish ownership."
              : "This PDF has no readable text layer. Enter a reference/name/date manually; leave uncertain scans unassigned.",
          );
        } finally {
          await task.destroy();
        }
      } else {
        type Detector = {
          detect(source: ImageBitmap): Promise<{ rawValue: string }[]>;
        };
        const Constructor = (
          window as unknown as {
            BarcodeDetector?: new (opts: { formats: string[] }) => Detector;
          }
        ).BarcodeDetector;
        if (!Constructor) {
          setMessage(
            "QR detection is unsupported in this browser. Enter the opaque reference or search the paper's reference/name/date. Photo OCR is not configured.",
          );
          return;
        }
        const bitmap = await createImageBitmap(file);
        try {
          const codes = await new Constructor({ formats: ["qr_code"] }).detect(
            bitmap,
          );
          const value = codes[0]?.rawValue;
          if (value) {
            try {
              setReference(
                new URL(value).searchParams.get("reference") ?? value,
              );
            } catch {
              setReference(value);
            }
            setMessage("QR read. Resolve it with the server before attaching.");
          } else
            setMessage(
              "No QR detected. Enter the reference or search by name/date below.",
            );
        } finally {
          bitmap.close();
        }
      }
    } catch {
      setMessage(
        "Text/QR extraction could not read this file. Use manual search; uncertain scans remain unassigned.",
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function save() {
    if (!file || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("kind", "scan");
      form.set("extractedText", text.slice(0, 12000));
      const r = await fetch("/api/documents", { method: "POST", body: form }),
        data = await r.json();
      if (!r.ok) throw Error(data.error);
      setDocumentId(data.id);
      setMessage(
        "Saved privately and unassigned. Confirm a target below only after reviewing the source.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function search() {
    setBusy(true);
    try {
      const p = new URLSearchParams({
        q: query,
        text: text.slice(0, 2000),
        reference,
      });
      const r = await fetch("/api/admin/scans?" + p, { cache: "no-store" }),
        data = await r.json();
      if (!r.ok) throw Error(data.error);
      setCandidates(data.candidates);
      setResolved(data.resolved);
      setMessage(
        data.candidates.length || data.resolved
          ? "Possible matches only. Verify the source before attachment."
          : "No matches. The scan remains unassigned.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  }
  async function attach(target: { bookingId?: number; requestId?: string }) {
    if (!documentId || note.trim().length < 10) {
      setMessage("Save the scan and enter verification notes first.");
      return;
    }
    if (
      !window.confirm(
        "Attach this scan to the selected record after your review?",
      )
    )
      return;
    setBusy(true);
    try {
      const r = await fetch("/api/admin/scans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId, ...target, note }),
        }),
        data = await r.json();
      if (!r.ok) throw Error(data.error);
      setMessage(
        "Attachment recorded with your admin identity and timestamp. Payment and certificate approvals are unchanged.",
      );
      setDocumentId("");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Attachment failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="portal-form">
      <p>
        The camera captures an image. Use “Create PDF” separately, or import an
        existing PDF. Files stay private.
      </p>
      <div className="scan-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={start}
          disabled={busy || camera || starting}
        >
          {starting ? "Opening camera…" : "Start Camera"}
        </button>
        {starting && (
          <button type="button" className="btn btn-secondary" onClick={stop}>
            Cancel camera
          </button>
        )}
        {camera && (
          <>
            <button type="button" className="btn btn-primary" onClick={capture}>
              Capture
            </button>
            <button type="button" className="btn btn-secondary" onClick={stop}>
              Stop Camera
            </button>
          </>
        )}
      </div>
      {camera && (
        <video
          className="scan-video"
          ref={video}
          muted
          autoPlay
          playsInline
          aria-label="Rear camera preview"
        />
      )}
      <label>
        Import an image or PDF
        <input
          type="file"
          accept="image/jpeg,image/png,application/pdf"
          onChange={(e) => {
            stop();
            setFile(e.target.files?.[0] ?? null);
            setDocumentId("");
            setText("");
          }}
        />
      </label>
      {file && (
        <>
          <p>
            {file.name} · {(file.size / 1024).toFixed(0)} KB
          </p>
          {file.type === "application/pdf" ? (
            <iframe
              className="scan-preview"
              title="Imported PDF preview"
              src={preview}
              sandbox=""
            />
          ) : (
            <>
              <img
                className="scan-preview"
                src={preview}
                alt="Captured or imported document preview"
              />
            </>
          )}
          <div className="scan-actions">
            <button
              className="btn btn-secondary"
              onClick={() => {
                setFile(null);
                setDocumentId("");
                stop();
              }}
            >
              Retake / clear
            </button>
            {file.type !== "application/pdf" && (
              <button
                className="btn btn-secondary"
                onClick={makePdf}
                disabled={busy}
              >
                Create PDF
              </button>
            )}
            <button
              className="btn btn-secondary"
              onClick={extract}
              disabled={busy}
            >
              Read PDF text / QR locally
            </button>
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={busy || Boolean(documentId)}
            >
              Save unassigned scan
            </button>
          </div>
        </>
      )}
      <p role="status">{message}</p>
      <label>
        Extracted or transcribed text (unverified)
        <textarea
          maxLength={12000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <label>
        Opaque system reference
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          maxLength={36}
        />
      </label>
      <label>
        Search a booking reference or name
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={100}
        />
      </label>
      <button className="btn btn-secondary" disabled={busy} onClick={search}>
        Find possible matches
      </button>
      <label>
        Why this record matches (required before attachment)
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          minLength={10}
          maxLength={1000}
        />
      </label>
      {resolved && (
        <article className="portal-card">
          <h3>System reference resolved by server</h3>
          <p>
            {resolved.kind} · {resolved.reference ?? resolved.id} ·{" "}
            {resolved.requesterName}
          </p>
          {(resolved.kind === "booking" || resolved.bookingId) && (
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() =>
                attach({ bookingId: resolved.bookingId ?? Number(resolved.id) })
              }
            >
              Confirm booking attachment
            </button>
          )}
          {(resolved.kind === "request" || resolved.requestId) && (
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() =>
                attach({ requestId: resolved.requestId ?? String(resolved.id) })
              }
            >
              Confirm request attachment
            </button>
          )}
        </article>
      )}
      {candidates.map((c) => (
        <article className="portal-card" key={c.id}>
          <h3>
            {c.reference} · {c.requesterName}
          </h3>
          <p>
            {c.bookingDate.slice(0, 10)} · {c.service}
          </p>
          <p>{c.evidence}</p>
          <button
            disabled={busy}
            className="btn btn-primary"
            onClick={() => attach({ bookingId: c.id })}
          >
            Confirm attachment to this booking
          </button>
        </article>
      ))}
    </div>
  );
}
