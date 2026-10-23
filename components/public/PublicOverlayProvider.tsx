"use client";

import { Suspense, createContext, useCallback, useContext, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePathname, useSearchParams } from "next/navigation";

export type PublicOverlay = "services" | "login" | "signin" | "chat";
type ServicesState = { service: string; step: string };
type OverlayState = { active: PublicOverlay | null; servicesState: ServicesState };
type OverlayContext = OverlayState & {
  requestOpen: (kind: PublicOverlay, options?: { service?: string; step?: string }) => boolean;
  requestClose: () => boolean;
  registerGuard: (kind: PublicOverlay, guard: () => boolean) => () => void;
  navigateServices: (state: Partial<ServicesState>) => void;
};

const Context = createContext<OverlayContext | null>(null);
const emptyState: OverlayState = { active: null, servicesState: { service: "", step: "catalog" } };
const flags: PublicOverlay[] = ["services", "login", "signin", "chat"];

function readLocation(): OverlayState {
  const url = new URL(window.location.href);
  const active = flags.find((key) => url.searchParams.get(key) === "1") ?? null;
  const service = url.searchParams.get("service") ?? (active === "services" ? url.hash.slice(1) : "");
  return {
    active,
    servicesState: { service, step: url.searchParams.get("step") ?? (service === "blessing" ? "blessing" : service ? "form" : "catalog") },
  };
}

export function PublicOverlayProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OverlayState>(emptyState);
  const current = useRef(state);
  const guards = useRef(new Map<PublicOverlay, () => boolean>());
  const previousUrl = useRef("");
  const update = useCallback((next: OverlayState) => { current.current = next; setState(next); }, []);
  const mayLeave = useCallback(() => {
    const kind = current.current.active;
    return !kind || (guards.current.get(kind)?.() ?? true);
  }, []);
  const writeLocation = useCallback((next: OverlayState) => {
    const url = new URL(window.location.href);
    flags.forEach((key) => url.searchParams.delete(key));
    url.searchParams.delete("service");
    url.searchParams.delete("step");
    // A return destination only belongs to an open parishioner sign-in card.
    if (next.active !== "signin") url.searchParams.delete("next");
    if (next.active) url.searchParams.set(next.active, "1");
    if (next.active === "services") {
      if (next.servicesState.service) url.searchParams.set("service", next.servicesState.service);
      if (next.servicesState.step !== "catalog") url.searchParams.set("step", next.servicesState.step);
    }
    const href = url.pathname + url.search + url.hash;
    if (href !== window.location.pathname + window.location.search + window.location.hash) {
      window.history.pushState({ ...window.history.state, publicOverlay: true }, "", href);
    }
    previousUrl.current = href;
    update(next);
  }, [update]);

  const syncLocation = useCallback((warn = false) => {
      const href = window.location.pathname + window.location.search + window.location.hash;
      if (href === previousUrl.current) return;
      const next = readLocation();
      const old = current.current;
      if (next.active !== "services") next.servicesState = old.servicesState;
      else if (!next.servicesState.service && next.servicesState.step === "catalog") next.servicesState.service = old.servicesState.service;
      const leaving = next.active !== old.active || (old.active === "services" && next.servicesState.service !== old.servicesState.service);
      if (warn && leaving && !mayLeave()) {
        window.history.pushState(window.history.state, "", previousUrl.current);
        return;
      }
      previousUrl.current = href;
      update(next);
  }, [mayLeave, update]);

  useEffect(() => {
    const onPop = () => syncLocation(true);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [syncLocation]);

  useEffect(() => {
    if (!state.active) return;
    const { body, documentElement } = document;
    const old = { overflow: body.style.overflow, paddingRight: body.style.paddingRight };
    const scrollbar = window.innerWidth - documentElement.clientWidth;
    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;
    return () => { body.style.overflow = old.overflow; body.style.paddingRight = old.paddingRight; };
  }, [state.active]);

  const requestOpen = useCallback((kind: PublicOverlay, options?: { service?: string; step?: string }) => {
    if (kind !== current.current.active && !mayLeave()) return false;
    const service = options?.service;
    if (kind === "services" && service && service !== current.current.servicesState.service && current.current.active !== "services" && !(guards.current.get("services")?.() ?? true)) return false;
    writeLocation({ active: kind, servicesState: service === undefined ? current.current.servicesState : { service, step: options?.step ?? (service === "blessing" ? "blessing" : service ? "form" : "catalog") } });
    return true;
  }, [mayLeave, writeLocation]);
  const requestClose = useCallback(() => {
    if (!mayLeave()) return false;
    writeLocation({ ...current.current, active: null });
    return true;
  }, [mayLeave, writeLocation]);
  const navigateServices = useCallback((next: Partial<ServicesState>) => {
    writeLocation({ active: "services", servicesState: { ...current.current.servicesState, ...next } });
  }, [writeLocation]);
  const registerGuard = useCallback((kind: PublicOverlay, guard: () => boolean) => {
    guards.current.set(kind, guard);
    return () => { if (guards.current.get(kind) === guard) guards.current.delete(kind); };
  }, []);

  return <Context.Provider value={{ ...state, requestOpen, requestClose, registerGuard, navigateServices }}><Suspense fallback={null}><LocationObserver onChange={syncLocation} /></Suspense>{children}</Context.Provider>;
}

function LocationObserver({ onChange }: { onChange: () => void }) {
  const pathname = usePathname();
  const params = useSearchParams();
  useEffect(() => { onChange(); }, [pathname, params, onChange]);
  return null;
}

export function usePublicOverlay() {
  const value = useContext(Context);
  if (!value) throw new Error("Public overlays require PublicOverlayProvider.");
  return value;
}

export function ServicesLink({ service, step, children, ...props }: { service?: string; step?: "certificate"; children: ReactNode; className?: string; "aria-label"?: string }) {
  const { requestOpen } = usePublicOverlay();
  const href = `/?services=1${service ? `&service=${encodeURIComponent(service)}&step=${step ?? (service === "blessing" ? "blessing" : "form")}` : ""}`;
  function click(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (window.location.pathname !== "/") return;
    event.preventDefault();
    requestOpen("services", service === undefined ? undefined : { service, step });
  }
  return <a href={href} onClick={click} {...props}>{children}</a>;
}

const focusable = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function PublicDialog({ kind, labelledBy, className = "", children }: { kind: PublicOverlay; labelledBy: string; className?: string; children: ReactNode }) {
  const { active, requestClose } = usePublicOverlay();
  const [mounted, setMounted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const visible = active === kind;
  useEffect(() => { const timer = window.setTimeout(() => setMounted(true), 0); return () => window.clearTimeout(timer); }, []);
  useEffect(() => {
    if (!visible || !mounted) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = requestAnimationFrame(() => {
      const first = ref.current?.querySelector<HTMLElement>(kind === "login" || kind === "signin" ? 'input[name="email"]' : "[data-dialog-autofocus]") ?? ref.current;
      first?.focus();
    });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); requestClose(); return; }
      if (event.key !== "Tab" || !ref.current) return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(focusable)].filter((item) => item.getClientRects().length > 0 && !item.closest("[hidden]"));
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) { event.preventDefault(); ref.current.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !ref.current.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [visible, mounted, requestClose, kind]);
  if (!mounted) return null;
  return createPortal(
    <div className={`public-overlay public-overlay-${kind}`} hidden={!visible}>
      <div className="public-overlay-backdrop" aria-hidden="true" onMouseDown={() => requestClose()} />
      <div id={`public-dialog-${kind}`} ref={ref} className={`public-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1}>{children}</div>
    </div>, document.body,
  );
}
