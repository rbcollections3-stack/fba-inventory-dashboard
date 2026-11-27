"use client";

import { useActionState, useState, useTransition } from "react";
import {
  addStaffAction,
  changeMyPasswordAction,
  resetAuthenticatorAction,
  setDisabledAction,
  setTemporaryPasswordAction,
  type AccountState,
} from "./actions";

function Messages({ state }: { state: AccountState }) {
  return (
    <>
      {state.error && <div className="alert error" role="alert">{state.error}</div>}
      {state.ok && <div className="alert ok" role="status">{state.ok}</div>}
    </>
  );
}

export function ChangeMyPasswordForm({ minLength }: { minLength: number }) {
  const [state, action, pending] = useActionState<AccountState, FormData>(changeMyPasswordAction, {});
  return (
    <form action={action} className="stack" key={state.ok}>
      <Messages state={state} />
      <div className="field">
        <label htmlFor="current">Current password</label>
        <input id="current" name="current" type="password" autoComplete="current-password" required />
      </div>
      <div className="grid-2">
        <div className="field">
          <label htmlFor="new-pw">New password</label>
          <input id="new-pw" name="password" type="password" autoComplete="new-password" required minLength={minLength} />
        </div>
        <div className="field">
          <label htmlFor="new-pw2">Type it again</label>
          <input id="new-pw2" name="confirm" type="password" autoComplete="new-password" required minLength={minLength} />
        </div>
      </div>
      <div>
        <button type="submit" disabled={pending}>{pending ? "Saving..." : "Change my password"}</button>
      </div>
    </form>
  );
}

export function AddStaffForm({ minLength }: { minLength: number }) {
  const [state, action, pending] = useActionState<AccountState, FormData>(addStaffAction, {});
  return (
    <form action={action} className="stack" key={state.ok}>
      <Messages state={state} />
      <div className="grid-2">
        <div className="field">
          <label htmlFor="new-username">Username</label>
          <input id="new-username" name="username" type="text" autoCapitalize="none" required />
          <span className="hint">For example their first name, such as maria.</span>
        </div>
        <div className="field">
          <label htmlFor="new-temp">Temporary password</label>
          <input id="new-temp" name="password" type="text" autoComplete="off" required minLength={minLength} />
          <span className="hint">They replace it at their first login.</span>
        </div>
      </div>
      <div>
        <button className="primary" type="submit" disabled={pending}>{pending ? "Adding..." : "Add staff login"}</button>
      </div>
    </form>
  );
}

/** Buttons and a temporary-password form for one other login. */
export function UserControls({
  userId,
  username,
  isStaff,
  disabled,
  minLength,
}: {
  userId: number;
  username: string;
  isStaff: boolean;
  disabled: boolean;
  minLength: number;
}) {
  const [state, action, pending] = useActionState<AccountState, FormData>(
    setTemporaryPasswordAction.bind(null, userId),
    {},
  );
  const [result, setResult] = useState<AccountState>({});
  const [busy, start] = useTransition();
  const shown = result.ok || result.error ? result : state;
  return (
    <div className="stack" style={{ maxWidth: "none" }}>
      <Messages state={shown} />
      <form action={(fd) => { setResult({}); action(fd); }} className="actions" style={{ alignItems: "flex-end" }}>
        <div className="field" style={{ minWidth: 240 }}>
          <label htmlFor={`temp-${userId}`}>Set a temporary password for {username}</label>
          <input id={`temp-${userId}`} name="password" type="text" autoComplete="off" required minLength={minLength} />
        </div>
        <button type="submit" disabled={pending}>{pending ? "Saving..." : "Set temporary password"}</button>
      </form>
      <div className="actions">
        <button type="button" disabled={busy} onClick={() => start(async () => setResult(await resetAuthenticatorAction(userId)))}>
          Reset authenticator app
        </button>
        {isStaff && (
          <button
            type="button"
            disabled={busy}
            onClick={() => start(async () => setResult(await setDisabledAction(userId, !disabled)))}
          >
            {disabled ? "Turn login back on" : "Turn login off"}
          </button>
        )}
      </div>
    </div>
  );
}
