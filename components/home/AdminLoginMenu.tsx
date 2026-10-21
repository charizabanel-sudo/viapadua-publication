"use client";

import { useId } from "react";
import LoginForm from "@/components/auth/LoginForm";
import { PublicDialog, ServicesLink, usePublicOverlay } from "@/components/public/PublicOverlayProvider";

export default function AdminLoginMenu() {
  const { active, requestOpen, requestClose } = usePublicOverlay();
  const titleId = useId();
  const open = active === "login";
  return (
    <>
      <button type="button" className={`admin-trigger${open ? " active" : ""}`} aria-label="Admin login" title="Admin login" aria-haspopup="dialog" aria-controls="public-dialog-login" aria-expanded={open} onClick={() => requestOpen("login")}>
        <span className="bars" aria-hidden="true"><span /><span /><span /></span>
      </button>
      <PublicDialog kind="login" labelledBy={titleId} className="login-layer login-card-workspace">
        <div className="login-card">
          <button type="button" className="login-close" onClick={requestClose} aria-label="Close login"><i className="fas fa-times" aria-hidden="true" /></button>
          <div className="login-card-head">
            <div className="login-logo" aria-hidden="true"><i className="fas fa-church" /></div>
            <h2 id={titleId}>Admin Sign In</h2>
            <p>Via Padua Parish · authorized staff only</p>
          </div>
          <LoginForm idPrefix="home-admin-" />
          <p className="login-card-foot">Guest bookings are welcome. <ServicesLink>Book a service</ServicesLink>.</p>
        </div>
      </PublicDialog>
    </>
  );
}
