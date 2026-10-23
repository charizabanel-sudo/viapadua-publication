"use client";
import { useActionState, useState } from "react";
import { accountAction, type AccountState } from "@/app/account/actions";
import { PASSWORD_HINT, MIN_PASSWORD_LENGTH } from "@/lib/auth/policy";
import PasswordToggle from "./PasswordToggle";

/** Parishioner sign-in (homepage card) and registration (account page) form. */
export default function AccountForm({
  register = false,
  next,
  idPrefix = "account-",
}: {
  register?: boolean;
  next?: string | null;
  idPrefix?: string;
}) {
  const [state, action, pending] = useActionState<AccountState, FormData>(
    accountAction,
    {},
  );
  const [showPassword, setShowPassword] = useState(false);
  const ids = {
    name: `${idPrefix}name`,
    email: `${idPrefix}email`,
    password: `${idPrefix}password`,
    confirm: `${idPrefix}confirm`,
    error: `${idPrefix}error`,
    hint: `${idPrefix}password-hint`,
  };
  const invalid = (field: AccountState["field"]) =>
    state.error && (state.field === field || (!state.field && field !== "name"))
      ? { "aria-invalid": true as const, "aria-describedby": ids.error }
      : {};

  if (!register)
    return (
      <form
        className="signin-form"
        action={action}
        aria-busy={pending}
        onSubmit={(e) => {
          if (pending) e.preventDefault();
        }}
      >
        <input type="hidden" name="mode" value="login" />
        {next && <input type="hidden" name="next" value={next} />}
        {state.error && (
          <div className="form-alert" role="alert" id={ids.error}>
            <i className="fas fa-exclamation-circle" aria-hidden="true" />
            <span>{state.error}</span>
          </div>
        )}
        <div className="form-group">
          <label htmlFor={ids.email}>Email Address</label>
          <div className="input-icon-wrap">
            <i className="fas fa-envelope field-icon" aria-hidden="true" />
            <input
              id={ids.email}
              name="email"
              type="email"
              autoComplete="username"
              placeholder="you@example.com"
              required
              maxLength={255}
              defaultValue={state.email}
              key={state.email ?? "email"}
              {...invalid("email")}
            />
          </div>
        </div>
        <div className="form-group">
          <label htmlFor={ids.password}>Password</label>
          <div className="input-icon-wrap has-eye">
            <i className="fas fa-lock field-icon" aria-hidden="true" />
            <input
              id={ids.password}
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Enter your password"
              required
              maxLength={4096}
              {...invalid("password")}
            />
            <PasswordToggle
              inputId={ids.password}
              visible={showPassword}
              onToggle={() => setShowPassword((v) => !v)}
            />
          </div>
        </div>
        <button type="submit" className="btn-signin" disabled={pending}>
          {pending && (
            <i className="fas fa-circle-notch fa-spin" aria-hidden="true" />
          )}{" "}
          {pending ? "Signing in…" : "Sign In"}
        </button>
      </form>
    );

  return (
    <form
      className="portal-form"
      action={action}
      aria-busy={pending}
      onSubmit={(e) => {
        if (pending) e.preventDefault();
      }}
    >
      <input type="hidden" name="mode" value="register" />
      {next && <input type="hidden" name="next" value={next} />}
      <label htmlFor={ids.name}>
        Full name
        <input
          id={ids.name}
          name="name"
          autoComplete="name"
          required
          minLength={2}
          maxLength={100}
          defaultValue={state.name}
          key={`name:${state.name ?? ""}`}
          {...invalid("name")}
        />
      </label>
      <label htmlFor={ids.email}>
        Email
        <input
          id={ids.email}
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={255}
          defaultValue={state.email}
          key={`email:${state.email ?? ""}`}
          {...invalid("email")}
        />
      </label>
      <label htmlFor={ids.password}>
        Password
        <span className="password-wrap">
          <input
            id={ids.password}
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            {...invalid("password")}
            aria-describedby={
              state.error && state.field === "password"
                ? `${ids.hint} ${ids.error}`
                : ids.hint
            }
          />
          <PasswordToggle
            inputId={ids.password}
            visible={showPassword}
            onToggle={() => setShowPassword((v) => !v)}
          />
        </span>
      </label>
      <small id={ids.hint}>{PASSWORD_HINT}</small>
      <label htmlFor={ids.confirm}>
        Confirm password
        <input
          id={ids.confirm}
          name="confirm"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          required
          {...invalid("confirm")}
        />
      </label>
      <input
        name="website"
        className="sr-only"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
      />
      <button className="btn btn-primary" disabled={pending}>
        {pending ? "Please wait…" : "Create account"}
      </button>
      {state.error && (
        <p className="form-alert" role="alert" id={ids.error}>
          {state.error}
        </p>
      )}
    </form>
  );
}
