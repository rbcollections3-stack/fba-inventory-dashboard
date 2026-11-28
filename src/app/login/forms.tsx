"use client";

import { useActionState } from "react";
import {
  chooseNewPassword,
  confirmSetup,
  finishSetup,
  login,
  submitCode,
  type FormState,
  type SetupState,
} from "./actions";

function ErrorBox({ error }: { error?: string }) {
  return error ? <div className="alert error" role="alert">{error}</div> : null;
}

export function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(login, {});
  return (
    <form action={action} className="stack">
      <ErrorBox error={state.error} />
      <div className="field">
        <label htmlFor="username">Username</label>
        <input id="username" name="username" type="text" autoComplete="username" autoCapitalize="none" required />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <button className="primary" type="submit" disabled={pending}>
        {pending ? "Checking..." : "Log in"}
      </button>
    </form>
  );
}

export function CodeForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(submitCode, {});
  return (
    <form action={action} className="stack">
      <ErrorBox error={state.error} />
      <div className="field">
        <label htmlFor="code">Code from your authenticator app</label>
        <input
          id="code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoCapitalize="none"
          required
          autoFocus
        />
        <span className="hint">Lost your phone? Type one of your backup codes here instead.</span>
      </div>
      <button className="primary" type="submit" disabled={pending}>
        {pending ? "Checking..." : "Continue"}
      </button>
    </form>
  );
}

export function SetupForm() {
  const [state, action, pending] = useActionState<SetupState, FormData>(confirmSetup, {});
  if (state.recoveryCodes) {
    return (
      <div className="stack">
        <div className="alert ok" role="status">Your authenticator app is set up.</div>
        <p>
          <strong>Save these backup codes</strong> somewhere safe, such as a password manager or a printed copy kept
          in a locked drawer. If you lose your phone, each code lets you log in once. They will not be shown again.
        </p>
        <pre className="codes" data-testid="recovery-codes">{state.recoveryCodes.join("\n")}</pre>
        <form action={finishSetup}>
          <input type="hidden" name="proof" value={state.proof ?? ""} />
          <button className="primary" type="submit">
            I have saved my backup codes
          </button>
        </form>
      </div>
    );
  }
  return (
    <form action={action} className="stack">
      <ErrorBox error={state.error} />
      <div className="field">
        <label htmlFor="code">6 digit code shown in the app</label>
        <input id="code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" required />
      </div>
      <button className="primary" type="submit" disabled={pending}>
        {pending ? "Checking..." : "Turn on"}
      </button>
    </form>
  );
}

export function NewPasswordForm({ minLength }: { minLength: number }) {
  const [state, action, pending] = useActionState<FormState, FormData>(chooseNewPassword, {});
  return (
    <form action={action} className="stack">
      <ErrorBox error={state.error} />
      <div className="field">
        <label htmlFor="password">New password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" required minLength={minLength} />
        <span className="hint">At least {minLength} characters, including a special character such as ! @ # $ % or -.</span>
      </div>
      <div className="field">
        <label htmlFor="confirm">Type it again</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={minLength} />
      </div>
      <button className="primary" type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save password"}
      </button>
    </form>
  );
}
