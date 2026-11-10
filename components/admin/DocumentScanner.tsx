"use client";
/* eslint-disable @next/next/no-img-element -- Private blob previews are intentionally unoptimized. */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { downloadBlob } from "@/lib/certificates/pdf";

type Owner = {
  id: number;
  name?: string | null;
  fullname?: string | null;
  email: string | null;
};

type Candidate = {
  kind: "booking" | "request" | "user";
  id: number | string;
  reference: string;
  requesterName: string;
  bookingDate: string | Date;
  service: string;
  evidence: string;
  matchedName?: string;
  score?: number;
  owner?: Owner | null;
  userId?: number | null;
};
type Resolution = {
  kind: string;
  id: string | number;
  reference?: string;
  requesterName?: string;
  bookingId?: number;
  requestId?: string;
  owner?: Owner | null;
  userId?: number | null;
};

function destinationForMatch(data: {
  candidates: Candidate[];
  resolved: Resolution | null;
}): string | null {
  const resolved = data.resolved;
  if (resolved?.kind === "booking" && resolved.reference) {
    return `/admin/records?q=${encodeURIComponent(resolved.reference)}`;
  }
  if (resolved?.kind === "request" && resolved.reference) {
    return `/admin/requests?reference=${encodeURIComponent(resolved.reference)}`;
  }
  if (data.candidates.length !== 1) return null;

  const [candidate] = data.candidates;
  if (candidate.kind === "booking") {
    return `/admin/records?q=${encodeURIComponent(candidate.reference)}`;
  }
  if (candidate.kind === "request") {
    return `/admin/requests?reference=${encodeURIComponent(candidate.reference)}`;
  }
  const userId = candidate.userId ?? candidate.id;
  return Number.isSafeInteger(Number(userId))
    ? `/admin/records?userId=${encodeURIComponent(String(userId))}`
    : null;
}

function destinationForCandidate(candidate: Candidate): string | null {
  if (candidate.kind === "booking") {
    return `/admin/records?q=${encodeURIComponent(candidate.reference)}`;
  }
  if (candidate.kind === "request") {
    return `/admin/requests?reference=${encodeURIComponent(candidate.reference)}`;
  }
  const userId = candidate.userId ?? candidate.id;
  return Number.isSafeInteger(Number(userId))
    ? `/admin/records?userId=${encodeURIComponent(String(userId))}`
    : null;
}

function extractBookingReference(text: string): string | null {
  const compact = text.toUpperCase().replace(/\s+/g, "");
  const match = compact.match(/\bVP-?([0-9A-Z]{4})-?([0-9A-Z]{4})\b|\bVP-?L(\d{6,})\b/);
  if (!match) return null;
  return match[3] ? `VP-L${match[3]}` : `VP-${match[1]}-${match[2]}`;
}

function extractDocumentName(text: string): string | null {
  const lines = text.split(/\r?\n/);
  const patterns = [
    /received from\s*:?\s*(.+)/i,
    /this is to certify(?: that)?\s+(.+)/i,
    /(?:recipient|requester)(?:'s)? name\s*:?\s*(.+)/i,
    /\bname\s*:\s*(.+)/i,
  ];
  for (const line of lines) {
    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (!match) continue;
      const name = match[1]
        .replace(/\s+(?:who was|was|is|for|on)\b.*$/i, "")
        .replace(/[^a-zA-Z .'-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 100);
      if (name.length >= 3) return name;
    }
  }
  return null;
}
export default function DocumentScanner({
  initialReference = "",
  initialDocumentId = "",
  initialText = "",
}: {
  initialReference?: string;
  initialDocumentId?: string;
  initialText?: string;
}) {
  const router = useRouter();
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
    [resolved, setResolved] = useState<Resolution | null>(null);
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
  const resetScanMatch = () => {
    setDocumentId("");
    setText("");
    setQuery("");
    setReference("");
    setCandidates([]);
    setResolved(null);
    setMessage("");
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
          const captured = new File([blob], "paper-scan.jpg", { type: "image/jpeg" });
          setFile(captured);
          resetScanMatch();
          void extract(captured, true);
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

  // The whole OCR text goes to the server, which matches names itself,
  // so no reference code is needed.
  async function findMatches(
    scanText = text,
    scanReference = reference,
    searchQuery = query,
  ) {
    const response = await fetch("/api/admin/scans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "match",
        text: scanText.slice(0, 12000),
        q: searchQuery.slice(0, 100),
        reference: scanReference.slice(0, 64),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error);
    setCandidates(data.candidates);
    setResolved(data.resolved);
    return data as { candidates: Candidate[]; resolved: Resolution | null };
  }

  async function ocr(source: Blob | HTMLCanvasElement) {
    setMessage("Preparing OCR…");
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, {
      logger: ({ status, progress }) => {
        if (!mounted.current) return;
        setMessage(
          status === "recognizing text"
            ? `Reading document text… ${Math.round(progress * 100)}%`
            : `Preparing OCR… ${status}`,
        );
      },
    });
    try {
      const result = await worker.recognize(source, { rotateAuto: true });
      return result.data.text.trim();
    } finally {
      await worker.terminate();
    }
  }

  async function extract(targetFile: File | null = file, isNewScan = false) {
    if (!targetFile || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    let extracted = "";
    let qrReference = "";
    try {
      if (targetFile.type === "application/pdf") {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const task = pdfjs.getDocument({ data: await targetFile.arrayBuffer() });
        const doc = await task.promise;
        try {
          for (let n = 1; n <= Math.min(doc.numPages, 10); n++) {
            const page = await doc.getPage(n);
            const content = await page.getTextContent();
            extracted +=
              content.items.map((i) => ("str" in i ? i.str : "")).join(" ") + "\n";
          }
          // Scanned PDF with no text layer: render the pages and OCR them.
          if (!extracted.trim()) {
            for (let n = 1; n <= Math.min(doc.numPages, 3); n++) {
              const page = await doc.getPage(n);
              const viewport = page.getViewport({ scale: 2 });
              const canvas = document.createElement("canvas");
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              await page.render({
                canvasContext: canvas.getContext("2d")!,
                canvas,
                viewport,
              } as Parameters<typeof page.render>[0]).promise;
              extracted += (await ocr(canvas)) + "\n";
            }
          }
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
        const bitmap = await createImageBitmap(targetFile);
        try {
          if (Constructor) {
            const codes = await new Constructor({ formats: ["qr_code"] }).detect(bitmap);
            const value = codes[0]?.rawValue;
            if (value) {
              try {
                qrReference = new URL(value).searchParams.get("reference") ?? value;
              } catch {
                qrReference = value;
              }
            }
          }
        } finally {
          bitmap.close();
        }
        extracted = await ocr(targetFile);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? `Could not read the document: ${error.message}`
          : "Could not read the document. Try a clearer photo or search by name.",
      );
      busyRef.current = false;
      setBusy(false);
      return;
    }

    extracted = extracted.slice(0, 12000);
    setText(extracted);
    const foundReference =
      qrReference || extractBookingReference(extracted) || (isNewScan ? "" : reference);
    const foundName = extractDocumentName(extracted);
    if (foundReference) setReference(foundReference);
    if (foundName) setQuery(foundName);
    setCandidates([]);
    setResolved(null);
    setMessage(
      extracted
        ? "Document text ready. Select Identify owner / record to find its match."
        : "No readable text. Try a brighter, sharper photo with the whole document in frame.",
    );
    busyRef.current = false;
    setBusy(false);
  }

  // Saves the file once and returns its id (reused if already saved).
  async function saveFile(): Promise<string> {
    if (documentId) return documentId;
    if (!file) throw Error("No file to save.");
    const form = new FormData();
    form.set("file", file);
    form.set("kind", "scan");
    form.set("extractedText", text.slice(0, 12000));
    const r = await fetch("/api/documents", { method: "POST", body: form });
    const data = await r.json();
    if (!r.ok) throw Error(data.error);
    setDocumentId(data.id);
    return data.id as string;
  }

  async function save() {
    if (!file || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      await saveFile();
      setMessage(
        "Saved privately and unassigned. You can attach it to a match below.",
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
      const data = await findMatches();
      setMessage(
        data.candidates.length || data.resolved
          ? "One confident match found. Verify the source before attachment."
          : "No confident unique match. The scan remains unassigned; use a reference, matching date, and service to distinguish repeated names.",
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  }

  async function attach(
    target: { bookingId?: number; requestId?: string; userId?: number },
    c?: Candidate,
  ) {
    if (!file && !documentId) {
      setMessage("Scan or import a document first.");
      return;
    }
    const owner = c?.owner
      ? `${c.owner.name ?? c.owner.email ?? "linked account"}${c.owner.email && c.owner.name ? ` · ${c.owner.email}` : ""}`
      : "no linked account";
    const reason = `Scan matched by ${c?.evidence ?? "system reference"}${
      c?.score ? ` (${c.score}%)` : ""
    }; confirmed by staff.`;
    if (
      !window.confirm(
        `Attach this scan to ${c?.reference ?? "the selected record"}${
          c ? ` (${c.requesterName})` : ""
        }? Account owner: ${owner}.`,
      )
    )
      return;
    setBusy(true);
    try {
      const id = await saveFile(); // auto-save, no separate step needed
      const r = await fetch("/api/admin/scans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ documentId: id, ...target, note: reason }),
        }),
        data = await r.json();
      if (!r.ok) throw Error(data.error);
      setFile(null);
      resetScanMatch();
      setMessage(
        `Attached to ${c?.reference ?? "the record"} (owner: ${owner}). Recorded with your admin identity and timestamp. Payment and certificate approvals are unchanged.`,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Attachment failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="portal-form">
      <p>
        Photo text is read locally in your browser. The image is uploaded only
        when you save or attach the scan; matches are suggestions and require
        your review.
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
          disabled={busy}
          onChange={(e) => {
            stop();
            const selected = e.target.files?.[0] ?? null;
            setFile(selected);
            resetScanMatch();
            // Images and PDFs are both read automatically (PDFs fall back to OCR).
            if (selected) void extract(selected, true);
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
              disabled={busy}
              onClick={() => {
                setFile(null);
                resetScanMatch();
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
              onClick={() => void extract()}
              disabled={busy}
            >
              {file.type === "application/pdf" ? "Read PDF (text / OCR)" : "Read photo (OCR + QR)"}
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
        Opaque system reference (optional)
        <input
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          maxLength={36}
        />
      </label>
      <label>
        Search by name or reference (optional)
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          maxLength={100}
        />
      </label>
      <p>Finding matches uses the extracted text and does not save or upload the scan. Save is optional; attaching a match saves it automatically.</p>
      <button className="btn btn-secondary" disabled={busy} onClick={search}>
        Identify owner / record
      </button>
      {resolved && (
        <article className="portal-card">
          <h3>System reference resolved by server</h3>
          <p>
            {resolved.kind} · {resolved.reference ?? resolved.id} ·{" "}
            {resolved.requesterName}
          </p>
          <p>
            Account owner: {" "}
            {resolved.owner
              ? `${resolved.owner.fullname ?? resolved.owner.name ?? "(no name)"}${resolved.owner.email ? ` · ${resolved.owner.email}` : ""}`
              : "No linked user account (guest / walk-in)"}
          </p>
          {(resolved.kind === "booking" || resolved.kind === "request") && (
            <button
              className="btn btn-primary"
              onClick={() => {
                const destination = destinationForMatch({
                  candidates: [],
                  resolved,
                });
                if (destination) router.push(destination);
              }}
            >
              Open {resolved.kind === "booking" ? "booking" : "request"} record
            </button>
          )}
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
      {candidates.map((c, i) => (
        <article className="portal-card" key={`${c.kind}-${c.id}`}>
          <h3>
            {i === 0 && "Best match · "}
            {c.kind === "user"
              ? `Account match · ${c.requesterName}`
              : `${c.reference} · ${c.matchedName || c.requesterName}`}
            {c.score != null && ` · ${c.score}%`}
          </h3>
          <p>
            Account owner:{" "}
            {c.owner
              ? `${c.owner.fullname ?? c.owner.name ?? "(no name)"}${c.owner.email ? ` · ${c.owner.email}` : ""}`
              : "No linked user account (guest / walk-in)"}
          </p>
          <p>
            {c.kind !== "user" &&
              `${new Date(c.bookingDate).toLocaleDateString("en-PH", { timeZone: "Asia/Manila" })} · ${c.service}`}
          </p>
          {c.matchedName && <p>Matched document name: {c.matchedName}</p>}
          <p>{c.evidence}</p>
          {destinationForCandidate(c) && (
            <button
              className="btn btn-primary"
              onClick={() => {
                const destination = destinationForCandidate(c);
                if (destination) router.push(destination);
              }}
            >
              Open matching record
            </button>
          )}
          <button
            disabled={busy}
            className="btn btn-primary"
            onClick={() =>
              c.kind === "booking"
                ? attach({ bookingId: Number(c.id) })
                : c.kind === "request"
                  ? attach({ requestId: String(c.id) })
                  : attach({ userId: Number(c.id) })
            }
          >
            {c.kind === "booking"
              ? "Confirm attachment to this booking"
              : c.kind === "request"
                ? "Confirm attachment to this certificate request"
                : "Confirm attachment to this user account"}
          </button>
        </article>
      ))}
    </div>
  );
}