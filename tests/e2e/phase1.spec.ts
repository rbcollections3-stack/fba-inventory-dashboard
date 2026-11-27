import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { E2E_DIR } from "./global-setup";

test.describe.configure({ mode: "serial" });

async function logIn(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

test("sends visitors who are not logged in to the login page", async ({ page }) => {
  await page.goto("/skus");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/warehouse");
  await expect(page).toHaveURL(/\/login$/);
});

test("refuses a wrong password", async ({ page }) => {
  await logIn(page, "admin", "not-the-password");
  await expect(page.locator(".alert.error")).toHaveText("That username and password do not match.");
  await expect(page).toHaveURL(/\/login$/);
});

test("admin imports the SKU spreadsheet and sees all 21 SKUs", async ({ page }) => {
  await logIn(page, "admin", "admin-password-1");
  await expect(page).toHaveURL(/\/skus$/);
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

test("admin edits a SKU's pallet details", async ({ page }) => {
  await logIn(page, "admin", "admin-password-1");
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
});

test("warehouse staff only see the warehouse screen", async ({ page }) => {
  await logIn(page, "warehouse", "staff-password-1");
  await expect(page).toHaveURL(/\/warehouse$/);
  await expect(page.getByTestId("wh-card")).toHaveCount(21);
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText(["Warehouse"]);

  for (const p of ["/skus", "/skus/import", "/skus/1", "/accounts", "/"]) {
    await page.goto(p);
    await expect(page).toHaveURL(/\/warehouse$/);
  }
});

test("changing the staff password logs staff out and the new password works", async ({ browser }) => {
  const staff = await browser.newPage();
  await logIn(staff, "warehouse", "staff-password-1");
  await expect(staff).toHaveURL(/\/warehouse$/);

  const admin = await browser.newPage();
  await logIn(admin, "admin", "admin-password-1");
  await expect(admin).toHaveURL(/\/skus$/);
  await admin.goto("/accounts");
  await admin.getByLabel("New password for warehouse").fill("brand-new-staff-pw");
  await admin.getByLabel("Type it again").nth(1).fill("brand-new-staff-pw");
  await admin.getByRole("button", { name: "Change password" }).nth(1).click();
  await expect(admin.getByText("Password changed for warehouse.")).toBeVisible();

  await staff.reload();
  await expect(staff).toHaveURL(/\/login$/);
  await logIn(staff, "warehouse", "brand-new-staff-pw");
  await expect(staff).toHaveURL(/\/warehouse$/);

  // The admin stays logged in after changing their own password.
  await admin.getByLabel("New password for admin").fill("brand-new-admin-pw");
  await admin.getByLabel("Type it again").nth(0).fill("brand-new-admin-pw");
  await admin.getByRole("button", { name: "Change password" }).nth(0).click();
  await expect(admin.getByText("Password changed for admin.")).toBeVisible();
  await admin.goto("/skus");
  await expect(admin).toHaveURL(/\/skus$/);
});
