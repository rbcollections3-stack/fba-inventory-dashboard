import { expect, test, type Browser, type Page } from "@playwright/test";
import path from "node:path";
import { E2E_DIR } from "./global-setup";
import { backupCodes, enterPassword, fullLogin, nextCode } from "./login-helpers";

test.describe.configure({ mode: "serial" });

const ADMIN_FIRST = "Dashboard-key-01!";
const ADMIN_PW = "My-own-boss-pw-7#";
const STAFF_FIRST = "Shelf-pallet-02!";
const STAFF_PW = "Forklift-safety-3$";

let admin: Page;

async function newPage(browser: Browser) {
  return (await browser.newContext()).newPage();
}

test("sends visitors who are not logged in to the login page", async ({ page }) => {
  await page.goto("/skus");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/warehouse");
  await expect(page).toHaveURL(/\/login$/);
});

test("refuses a wrong password", async ({ page }) => {
  await enterPassword(page, "admin", "not-the-password");
  await expect(page.locator(".alert.error")).toHaveText("That username and password do not match.");
  await expect(page).toHaveURL(/\/login$/);
});

test("first admin login: password, authenticator setup, then a new password", async ({ browser }) => {
  const page = await newPage(browser);
  await enterPassword(page, "admin", ADMIN_FIRST);
  // Without the code step finished, no screen opens.
  await page.goto("/skus");
  await expect(page).toHaveURL(/\/login$/);

  admin = await newPage(browser);
  await enterPassword(admin, "admin", ADMIN_FIRST);
  await expect(admin).toHaveURL(/\/login\/code$/);
  await admin.getByLabel("6 digit code shown in the app").fill("000000");
  await admin.getByRole("button", { name: "Turn on" }).click();
  await expect(admin.locator(".alert.error")).toContainText("That code is not right");
  await admin.goto("/login");

  // The password rules are enforced on the new password.
  await enterPassword(admin, "admin", ADMIN_FIRST);
  await admin.goto("/login/new-password");
  await expect(admin).toHaveURL(/\/login$/);
  await fullLogin(admin, "admin", ADMIN_FIRST);
  await expect(admin).toHaveURL(/\/login\/new-password$/);
  await admin.getByLabel("New password").fill("nospecialchars12");
  await admin.getByLabel("Type it again").fill("nospecialchars12");
  await admin.getByRole("button", { name: "Save password" }).click();
  await expect(admin.locator(".alert.error")).toContainText("special character");
  await admin.getByLabel("New password").fill(ADMIN_PW);
  await admin.getByLabel("Type it again").fill(ADMIN_PW);
  await admin.getByRole("button", { name: "Save password" }).click();
  await expect(admin).toHaveURL(/\/skus$/);

  // The first password no longer works.
  await enterPassword(page, "admin", ADMIN_FIRST);
  await expect(page.locator(".alert.error")).toHaveText("That username and password do not match.");
});

test("admin imports the SKU spreadsheet and sees all 21 SKUs", async () => {
  const page = admin;
  await page.goto("/skus");
  await expect(page.getByText("No SKUs yet")).toBeVisible();

  await page.getByRole("link", { name: "Import spreadsheet" }).first().click();

  // A file with a mistake is rejected with the row and the reason.
  await page.getByLabel(/Filled-in SKU template/).setInputFiles(path.join(E2E_DIR, "skus-bad.xlsx"));
  await page.getByRole("button", { name: "Check file" }).click();
  await expect(page.locator(".alert.error")).toContainText("Nothing was imported");
  await expect(page.locator(".alert.error")).toContainText('Row 3: Units per case must be a whole number, but it says "24 pcs".');

  await page.getByLabel(/Filled-in SKU template/).setInputFiles(path.join(E2E_DIR, "skus-filled.xlsx"));
  await page.getByRole("button", { name: "Check file" }).click();
  await expect(page.getByText("21 SKUs (21 new, 0 already in the app will be updated)")).toBeVisible();
  await page.getByRole("button", { name: "Import 21 SKUs" }).click();
  await expect(page.getByText("Import finished: 21 new SKUs added and 0 updated.")).toBeVisible();

  await page.getByRole("link", { name: "See all SKUs" }).click();
  await expect(page.getByTestId("sku-count")).toHaveText("21");
  await expect(page.getByTestId("listing-count")).toHaveText("5");
  await expect(page.getByTestId("sku-row")).toHaveCount(21);
  const row = page.getByTestId("sku-row").filter({ hasText: "EX-TOTE-BLK" });
  await expect(row).toContainText("X001");

  // Importing the same file again updates instead of duplicating.
  await page.goto("/skus/import");
  await page.getByLabel(/Filled-in SKU template/).setInputFiles(path.join(E2E_DIR, "skus-filled.xlsx"));
  await page.getByRole("button", { name: "Check file" }).click();
  await expect(page.getByText("21 SKUs (0 new, 21 already in the app will be updated)")).toBeVisible();
  await page.getByRole("button", { name: "Import 21 SKUs" }).click();
  await expect(page.getByText("0 new SKUs added and 21 updated")).toBeVisible();
  await page.goto("/skus");
  await expect(page.getByTestId("sku-row")).toHaveCount(21);
});

test("admin edits a SKU's pallet details", async () => {
  const page = admin;
  await page.goto("/skus");
  await page.getByRole("link", { name: "EX-TOTE-BLK" }).click();
  await expect(page.getByRole("heading", { name: "Edit EX-TOTE-BLK" })).toBeVisible();
  await page.getByLabel("Tie (cases per layer)").fill("0");
  await page.getByLabel("Tie (cases per layer)").evaluate((el: HTMLInputElement) => el.removeAttribute("min"));
  await page.getByRole("button", { name: "Save SKU" }).click();
  await expect(page.getByText("Tie must be at least 1.")).toBeVisible();
  await page.getByLabel("Tie (cases per layer)").fill("7");
  await page.getByRole("button", { name: "Save SKU" }).click();
  await expect(page).toHaveURL(/\/skus$/);
  const row = page.getByTestId("sku-row").filter({ hasText: "EX-TOTE-BLK" });
  await expect(row.locator("td").nth(4)).toHaveText("7");

  // Typing a new warehouse count records it.
  await page.getByRole("link", { name: "EX-TOTE-BLK" }).click();
  await page.getByLabel("New warehouse count (units)").fill("1234");
  await page.getByRole("button", { name: "Save SKU" }).click();
  await expect(page).toHaveURL(/\/skus$/);
  await page.getByRole("link", { name: "EX-TOTE-BLK" }).click();
  await expect(page.getByText(/Warehouse on hand: 1,234 units/)).toBeVisible();
});

test("warehouse staff only see the warehouse screen", async ({ browser }) => {
  const page = await newPage(browser);
  await fullLogin(page, "warehouse", STAFF_FIRST, STAFF_PW);
  await expect(page).toHaveURL(/\/warehouse$/);
  await expect(page.getByTestId("wh-card")).toHaveCount(21);
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText(["Warehouse"]);

  for (const p of ["/skus", "/skus/import", "/skus/1", "/accounts", "/"]) {
    await page.goto(p);
    await expect(page).toHaveURL(/\/warehouse$/);
  }
});

test("admin adds an individual staff login, who sets up their own password and app", async ({ browser }) => {
  await admin.goto("/accounts");
  await admin.getByLabel("Username", { exact: true }).fill("maria");
  await admin.getByLabel("Temporary password", { exact: true }).fill("short");
  await admin.getByLabel("Temporary password", { exact: true }).evaluate((el: HTMLInputElement) => el.removeAttribute("minlength"));
  await admin.getByRole("button", { name: "Add staff login" }).click();
  await expect(admin.locator(".alert.error")).toContainText("at least 12 characters");
  // The form clears after each try, as forms do.
  await admin.getByLabel("Username", { exact: true }).fill("maria");
  await admin.getByLabel("Temporary password", { exact: true }).fill("Welcome-shift-1!");
  await admin.getByRole("button", { name: "Add staff login" }).click();
  await expect(admin.getByText("Added maria.")).toBeVisible();
  await expect(admin.getByTestId("user-row")).toHaveCount(3);

  const maria = await newPage(browser);
  await fullLogin(maria, "maria", "Welcome-shift-1!", "Pallet-crew-pass-9!");
  await expect(maria).toHaveURL(/\/warehouse$/);

  // Turning the login off signs her out at once.
  await admin.reload();
  await admin.locator(".card", { has: admin.getByRole("heading", { name: /^maria \(/ }) }).getByRole("button", { name: "Turn login off" }).click();
  await expect(admin.getByText("maria has been turned off and logged out.")).toBeVisible();
  await maria.reload();
  await expect(maria).toHaveURL(/\/login$/);
  await enterPassword(maria, "maria", "Pallet-crew-pass-9!");
  await expect(maria.locator(".alert.error")).toHaveText("This login has been turned off. Ask the admin.");
});

test("a temporary password logs staff out; a backup code gets them back in", async ({ browser }) => {
  const staff = await newPage(browser);
  await fullLogin(staff, "warehouse", STAFF_PW);
  await expect(staff).toHaveURL(/\/warehouse$/);

  await admin.goto("/accounts");
  await admin.getByLabel("Set a temporary password for warehouse").fill("Temp-for-staff-4!");
  await admin.locator(".card", { has: admin.getByRole("heading", { name: /^warehouse \(/ }) }).getByRole("button", { name: "Set temporary password" }).click();
  await expect(admin.getByText("Temporary password set for warehouse.")).toBeVisible();

  await staff.reload();
  await expect(staff).toHaveURL(/\/login$/);
  await enterPassword(staff, "warehouse", "Temp-for-staff-4!");
  await staff.getByLabel("Code from your authenticator app").fill(backupCodes.get("warehouse")![0]);
  await staff.getByRole("button", { name: "Continue" }).click();
  await expect(staff).toHaveURL(/\/login\/new-password$/);
  await staff.getByLabel("New password").fill("Temp-for-staff-4!");
  await staff.getByLabel("Type it again").fill("Temp-for-staff-4!");
  await staff.getByRole("button", { name: "Save password" }).click();
  await expect(staff.locator(".alert.error")).toContainText("not used for this login before");
  await staff.getByLabel("New password").fill("Brand-new-staff-5%");
  await staff.getByLabel("Type it again").fill("Brand-new-staff-5%");
  await staff.getByRole("button", { name: "Save password" }).click();
  await expect(staff).toHaveURL(/\/warehouse$/);

  // A backup code only works once.
  const again = await newPage(browser);
  await enterPassword(again, "warehouse", "Brand-new-staff-5%");
  await again.getByLabel("Code from your authenticator app").fill(backupCodes.get("warehouse")![0]);
  await again.getByRole("button", { name: "Continue" }).click();
  await expect(again.locator(".alert.error")).toContainText("That code is not right");
  await again.getByLabel("Code from your authenticator app").fill(await nextCode("warehouse"));
  await again.getByRole("button", { name: "Continue" }).click();
  await expect(again).toHaveURL(/\/warehouse$/);
});

test("admin changes their own password and stays logged in", async () => {
  await admin.goto("/accounts");
  await admin.getByLabel("Current password").fill("wrong-current-pw!");
  await admin.getByLabel("New password", { exact: true }).fill("Owner-second-pw-8&");
  await admin.getByLabel("Type it again").first().fill("Owner-second-pw-8&");
  await admin.getByRole("button", { name: "Change my password" }).click();
  await expect(admin.locator(".alert.error")).toHaveText("Your current password is not right.");
  await admin.getByLabel("Current password").fill(ADMIN_PW);
  await admin.getByLabel("New password", { exact: true }).fill("Owner-second-pw-8&");
  await admin.getByLabel("Type it again").first().fill("Owner-second-pw-8&");
  await admin.getByRole("button", { name: "Change my password" }).click();
  await expect(admin.getByText("Your password has been changed.")).toBeVisible();
  await admin.goto("/skus");
  await expect(admin).toHaveURL(/\/skus$/);
});

test("the site sends security headers", async ({ request }) => {
  const res = await request.get("/login");
  expect(res.headers()["strict-transport-security"]).toContain("max-age=");
  expect(res.headers()["x-frame-options"]).toBe("DENY");
  expect(res.headers()["x-powered-by"]).toBeUndefined();
});
