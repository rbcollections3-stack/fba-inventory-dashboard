import { expect, type Page } from "@playwright/test";
import { base32Decode, hotp, timeStep } from "../../src/lib/auth/totp";

/** Plays the part of each person's authenticator app. */
const secrets = new Map<string, string>();
const lastStep = new Map<string, number>();
export const backupCodes = new Map<string, string[]>();

/** The next code the app would accept: each code works once, so wait for a new one if needed. */
export async function nextCode(username: string): Promise<string> {
  const secret = secrets.get(username);
  if (!secret) throw new Error(`No authenticator set up for ${username}`);
  let step = Math.max(timeStep(new Date()), (lastStep.get(username) ?? -1) + 1);
  while (step > timeStep(new Date()) + 1) await new Promise((r) => setTimeout(r, 1000));
  step = Math.max(step, timeStep(new Date()) - 1);
  lastStep.set(username, step);
  return hotp(base32Decode(secret), step);
}

export async function enterPassword(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

/**
 * Logs in all the way: password, then the authenticator (setting it up on
 * first login), then a new password if the app asks for one.
 */
export async function fullLogin(page: Page, username: string, password: string, newPassword?: string) {
  await enterPassword(page, username, password);
  await expect(page).toHaveURL(/\/login\/code$/);
  if (!secrets.has(username)) {
    await expect(page.getByRole("heading", { name: "Set up your authenticator app" })).toBeVisible();
    const secret = (await page.getByTestId("totp-secret").innerText()).replace(/\s/g, "");
    secrets.set(username, secret);
    await page.getByLabel("6 digit code shown in the app").fill(await nextCode(username));
    await page.getByRole("button", { name: "Turn on" }).click();
    const codes = (await page.getByTestId("recovery-codes").innerText()).trim().split("\n");
    expect(codes).toHaveLength(8);
    backupCodes.set(username, codes);
    await page.getByRole("button", { name: "I have saved my backup codes" }).click();
  } else {
    await page.getByLabel("Code from your authenticator app").fill(await nextCode(username));
    await page.getByRole("button", { name: "Continue" }).click();
  }
  if (newPassword) {
    await expect(page).toHaveURL(/\/login\/new-password$/);
    await page.getByLabel("New password").fill(newPassword);
    await page.getByLabel("Type it again").fill(newPassword);
    await page.getByRole("button", { name: "Save password" }).click();
    await expect(page).not.toHaveURL(/\/login/);
  } else {
    // Past the code step: either in the app, or asked for a new password.
    await expect(page).not.toHaveURL(/\/login(\/code)?$/);
  }
}
