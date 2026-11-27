import { redirect } from "next/navigation";
import { getPendingLogin } from "@/lib/auth/session";
import { MIN_PASSWORD_LENGTH, passwordExpiresOn } from "@/lib/auth/users";
import { NewPasswordForm } from "../forms";

export const metadata = { title: "Choose a new password · RB Collections FBA Dashboard" };

export default async function NewPasswordPage() {
  const pending = await getPendingLogin();
  if (!pending || !pending.mfa) redirect("/login");
  const expired = !pending.user.mustChangePassword && passwordExpiresOn(pending.user) <= new Date();
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>Choose a new password</h1>
        <p className="muted">
          {expired
            ? "Passwords must be changed once a year, and yours is due."
            : "This is your first login, or the admin set a temporary password for you. Choose your own password to continue."}
        </p>
        <NewPasswordForm minLength={MIN_PASSWORD_LENGTH} />
      </div>
    </div>
  );
}
