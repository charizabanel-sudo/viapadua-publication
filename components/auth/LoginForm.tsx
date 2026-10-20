"use client";

import { useActionState, useState, type Ref } from "react";
import { loginAction, type LoginState } from "@/lib/server/actions/login";

type Props = {
  /** Prefix for element ids, so the form can appear on another page (homepage panel) without id clashes. */
  idPrefix?: string;
  emailRef?: Ref<HTMLInputElement>;
};

/** Admin sign-in form. Rendered in the homepage login card (the only login UI). */
export default function LoginForm({ idPrefix = "", emailRef }: Props) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(loginAction, {});
  const [showPassword, setShowPassword] = useState(false);
  const ids = { email: `${idPrefix}email`, password: `${idPrefix}password` };

  return (
    <form
      className="signin-form"
      action={formAction}
      noValidate
      aria-busy={pending}
      onSubmit={(e) => {
        // Ignore repeat submissions (Enter key, double click, scripted submit) while one is in flight.
        if (pending) e.preventDefault();
      }}
    >
      {state.error && (
        <div className="form-alert" role="alert">
          <i className="fas fa-exclamation-circle" aria-hidden="true" />
          <span>{state.error}</span>
        </div>
      )}

      <div className="form-group">
        <label htmlFor={ids.email}>Email Address</label>
        <div className="input-icon-wrap">
          <i className="fas fa-envelope field-icon" aria-hidden="true" />
          <input
            type="email"
            ref={emailRef}
            id={ids.email}
            name="email"
            placeholder="admin@example.com"
            autoComplete="username"
            required
            maxLength={255}
            defaultValue={state.email}
            key={state.email ?? "email"}
            aria-invalid={Boolean(state.fieldErrors?.email)}
            aria-describedby={state.fieldErrors?.email ? `${ids.email}-error` : undefined}
          />
        </div>
        {state.fieldErrors?.email && (
          <span className="field-error" id={`${ids.email}-error`}>
            {state.fieldErrors.email}
          </span>
        )}
      </div>

      <div className="form-group">
        <label htmlFor={ids.password}>Password</label>
        <div className="input-icon-wrap has-eye">
          <i className="fas fa-lock field-icon" aria-hidden="true" />
          <input
            type={showPassword ? "text" : "password"}
            id={ids.password}
            name="password"
            placeholder="Enter your password"
            autoComplete="current-password"
            required
            maxLength={200}
            aria-invalid={Boolean(state.fieldErrors?.password)}
            aria-describedby={state.fieldErrors?.password ? `${ids.password}-error` : undefined}
          />
          <button
            type="button"
            className="toggle-password"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            title={showPassword ? "Hide password" : "Show password"}
          >
            <i className={`fas ${showPassword ? "fa-eye-slash" : "fa-eye"}`} aria-hidden="true" />
          </button>
        </div>
        {state.fieldErrors?.password && (
          <span className="field-error" id={`${ids.password}-error`}>
            {state.fieldErrors.password}
          </span>
        )}
      </div>

      <button type="submit" className="btn-signin" disabled={pending}>
        {pending && <i className="fas fa-circle-notch fa-spin" aria-hidden="true" />} {pending ? "Signing in…" : "Sign In"}
      </button>
    </form>
  );
}
