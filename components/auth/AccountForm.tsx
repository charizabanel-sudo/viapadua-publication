"use client";
import { useActionState } from "react";
import { accountAction } from "@/app/account/actions";
export default function AccountForm({
  register = false,
}: {
  register?: boolean;
}) {
  const [state, action, pending] = useActionState(accountAction, {});
  return (
    <form className="portal-form" action={action}>
      <input
        type="hidden"
        name="mode"
        value={register ? "register" : "login"}
      />
      {register && (
        <label>
          Full name
          <input
            name="name"
            autoComplete="name"
            required
            minLength={2}
            maxLength={100}
          />
        </label>
      )}
      <label>
        Email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={255}
        />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete={register ? "new-password" : "current-password"}
          required
          minLength={register ? 12 : 1}
          maxLength={register ? 72 : 4096}
        />
      </label>
      {register && (
        <>
          <small>At least 12 characters; maximum 72 UTF-8 bytes.</small>
          <label>
            Confirm password
            <input
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
            />
          </label>
          <input
            name="website"
            className="sr-only"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
          />
        </>
      )}
      <button className="btn btn-primary" disabled={pending}>
        {pending ? "Please wait…" : register ? "Create account" : "Sign in"}
      </button>
      {state.error && <p role="alert">{state.error}</p>}
    </form>
  );
}
