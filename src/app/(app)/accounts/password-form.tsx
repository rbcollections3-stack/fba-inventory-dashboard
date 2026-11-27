"use client";

import { useActionState } from "react";
import { changePasswordAction, type PasswordState } from "./actions";

export function PasswordForm({ userId, username }: { userId: number; username: string }) {
  const [state, action, pending] = useActionState<PasswordState, FormData>(
    changePasswordAction.bind(null, userId),
    {},
  );
  return (
    <form action={action} className="stack" key={state.ok}>
      {state.error && <div className="alert error" role="alert">{state.error}</div>}
      {state.ok && <div className="alert ok" role="status">{state.ok}</div>}
      <div className="grid-2">
        <div className="field">
          <label htmlFor={`pw-${userId}`}>New password for {username}</label>
          <input id={`pw-${userId}`} name="password" type="password" autoComplete="new-password" required minLength={10} />
        </div>
        <div className="field">
          <label htmlFor={`pw2-${userId}`}>Type it again</label>
          <input id={`pw2-${userId}`} name="confirm" type="password" autoComplete="new-password" required minLength={10} />
        </div>
      </div>
      <div>
        <button type="submit" disabled={pending}>
          {pending ? "Saving..." : "Change password"}
        </button>
      </div>
    </form>
  );
}
