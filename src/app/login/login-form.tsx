"use client";

import { useActionState } from "react";
import { login, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="stack">
      {state.error && (
        <div className="alert error" role="alert">
          {state.error}
        </div>
      )}
      <div className="field">
        <label htmlFor="username">Username</label>
        <input id="username" name="username" type="text" autoComplete="username" autoCapitalize="none" required />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <button className="primary" type="submit" disabled={pending}>
        {pending ? "Logging in..." : "Log in"}
      </button>
    </form>
  );
}
