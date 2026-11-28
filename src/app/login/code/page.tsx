import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getDb } from "@/db";
import { getPendingLogin, nextLoginPath } from "@/lib/auth/session";
import { otpauthUrl } from "@/lib/auth/totp";
import { beginTotpSetup } from "@/lib/auth/users";
import { CodeForm, SetupForm } from "../forms";

export const metadata = { title: "Log in · RB Collections FBA Dashboard" };

function groups(secret: string): string {
  return secret.match(/.{1,4}/g)?.join(" ") ?? secret;
}

export default async function CodePage() {
  const pending = await getPendingLogin();
  if (!pending) redirect("/login");
  const { user } = pending;
  if (pending.mfa && user.totpEnabledAt) redirect(nextLoginPath(user, true));

  if (user.totpEnabledAt) {
    return (
      <div className="login-wrap">
        <div className="card login-card">
          <h1>Enter your code</h1>
          <p className="muted">Open your authenticator app and type the 6 digit code for RB Collections FBA.</p>
          <CodeForm />
        </div>
      </div>
    );
  }

  const secret = await beginTotpSetup(getDb(), user.id);
  if (!secret) redirect("/login");
  const qr = await QRCode.toDataURL(otpauthUrl(secret, user.username), { margin: 1, width: 220 });
  return (
    <div className="login-wrap">
      <div className="card" style={{ maxWidth: 480, width: "100%" }}>
        <h1>Set up your authenticator app</h1>
        <p className="muted">Every login needs a code from your phone as well as your password. This takes about a minute.</p>
        <ol style={{ paddingLeft: 20 }}>
          <li>
            Install an authenticator app on your phone, such as Google Authenticator or Microsoft Authenticator.
          </li>
          <li>In the app, tap the + button and scan this code.</li>
        </ol>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="QR code to scan with your authenticator app" width={220} height={220} />
        <p className="small muted">
          Can&apos;t scan? Choose &quot;Enter a setup key&quot; in the app and type:{" "}
          <code data-testid="totp-secret">{groups(secret)}</code>
        </p>
        <ol start={3} style={{ paddingLeft: 20 }}>
          <li>Type the 6 digit code the app shows to finish.</li>
        </ol>
        <SetupForm />
      </div>
    </div>
  );
}
