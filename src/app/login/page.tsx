import { redirect } from "next/navigation";
import { homeFor } from "@/lib/auth/access";
import { getCurrentUser } from "@/lib/auth/session";
import { LoginForm } from "./forms";

export const metadata = { title: "Log in · RB Collections FBA Dashboard" };

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user) redirect(homeFor(user.role));
  return (
    <div className="login-wrap">
      <div className="card login-card">
        <h1>RB Collections</h1>
        <p className="muted">FBA inventory dashboard</p>
        <LoginForm />
      </div>
    </div>
  );
}
