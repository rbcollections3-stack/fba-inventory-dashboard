import { expect, test, type Browser, type Page } from "@playwright/test";
import path from "node:path";
import { ROOT } from "../helpers";
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
  await expect(admin).toHaveURL(/\/overview$/);

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
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link")).toHaveText(["Warehouse", "Pallet sheets", "Barcode labels", "Stock counts"]);

  for (const p of ["/overview", "/overview/1", "/shipments", "/skus", "/skus/import", "/skus/1", "/accounts", "/amazon", "/"]) {
    await page.goto(p);
    await expect(page).toHaveURL(/\/warehouse$/);
  }

  // Staff enter a stock count: 10 full cases of X001 (12 per case) plus 3 loose.
  await page.getByRole("link", { name: "Enter stock counts" }).click();
  await expect(page).toHaveURL(/\/warehouse\/counts$/);
  await expect(page.getByTestId("count-row")).toHaveCount(21);
  await page.getByLabel("Full cases of X001").fill("10");
  await page.getByLabel("Loose units of X001").fill("3");
  const x001 = page.getByTestId("count-row").filter({ hasText: "X001" });
  await expect(x001.getByTestId("count-total")).toHaveText("123");
  await page.getByLabel("Full cases of X002").fill("abc");
  await page.getByRole("button", { name: "Save counts" }).click();
  await expect(page.locator(".alert.error")).toContainText("Nothing was saved");
  await page.getByLabel("Full cases of X002").fill("");
  await page.getByRole("button", { name: "Save counts" }).click();
  await expect(page.getByText("Saved 1 count.")).toBeVisible();
  await expect(x001).toContainText("123");
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

const fixture = (name: string) => path.join(ROOT, "tests/fixtures", name);

// Phase 2: Amazon reports. The fixtures are made-up files in Seller Central's layouts.
test("admin uploads both Amazon reports and sees FBA stock, inbound and sales per SKU", async () => {
  const page = admin;
  await page.goto("/skus");
  await expect(page.getByTestId("amazon-freshness")).toContainText("No FBA stock loaded yet");

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Amazon reports" }).click();
  await expect(page).toHaveURL(/\/amazon$/);
  await page.getByLabel("Amazon report files").setInputFiles([
    fixture("fba-inventory-sample.txt"),
    fixture("ledger-detail-sample.tsv"),
  ]);
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByTestId("upload-ok")).toHaveCount(2);
  await expect(page.getByTestId("upload-ok").first()).toContainText("Manage FBA Inventory");
  await expect(page.getByTestId("upload-ok").first()).toContainText("Skipped 2 rows");
  await expect(page.getByTestId("upload-ok").nth(1)).toContainText("Oct 1, 2026 to Oct 31, 2026");
  await expect(page.getByTestId("import-row")).toHaveCount(2);

  await page.goto("/skus");
  const blk = page.getByTestId("sku-row").filter({ hasText: "EX-TOTE-BLK" });
  await expect(blk.getByTestId("fba-cell")).toHaveText("240");
  await expect(blk.getByTestId("inbound-cell")).toHaveText("120");
  await expect(blk.getByTestId("sold-cell")).toHaveText("4");
  await expect(page.getByTestId("fba-total")).toHaveText("310");
  await expect(page.getByTestId("inbound-total")).toHaveText("120");
  await expect(page.getByTestId("amazon-freshness")).toContainText("Oct 2, 2026 to Oct 31, 2026");

  // A file that is not one of the two reports is refused with a plain reason.
  await page.goto("/amazon");
  await page.getByLabel("Amazon report files").setInputFiles({
    name: "business-report.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Date,Units Ordered\n10/01/2026,5\n"),
  });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.locator(".alert.error")).toContainText("not one of the Amazon reports");
});

// Phase 3: the automatic Amazon connection. No Amazon keys are set in tests.
test("Amazon page shows the connection is not set up, and the daily pull needs its secret", async ({ request }) => {
  const page = admin;
  await page.goto("/amazon");
  const box = page.getByTestId("amazon-connection");
  await expect(box).toContainText("Not set up");
  await expect(box).toContainText("SP_API_CLIENT_ID");
  await expect(page.getByTestId("sync-fba_inventory")).toContainText("Never pulled");
  await expect(page.getByTestId("refresh-amazon")).toBeDisabled();

  const noSecret = await request.get("/api/cron/amazon-sync");
  expect(noSecret.status()).toBe(401);
  const wrong = await request.get("/api/cron/amazon-sync", { headers: { authorization: "Bearer wrong" } });
  expect(wrong.status()).toBe(401);
});

// Phase 4: the forecast and Overview. Uses the reports uploaded above.
test("Overview shows dates per SKU, and expected daily sales can be entered by hand", async () => {
  const page = admin;
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Overview" }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByTestId("forecast-row")).toHaveCount(21);
  await expect(page.getByTestId("forecast-basis")).toContainText("Oct 2, 2026 to Oct 31, 2026 (30 days)");

  // EX-TOTE-BLK sold 4 in 30 days and has 360 units in or on the way to FBA: far from due.
  const blk = page.getByTestId("forecast-row").filter({ hasText: "EX-TOTE-BLK" });
  await expect(blk).toHaveAttribute("data-status", "green");
  await expect(blk.getByTestId("rate-cell")).toHaveText("0.1");
  await expect(blk.getByTestId("ship-by")).toContainText("1 case (12 units)");

  // A SKU with no sales shows no dates and a note.
  const tote = page.getByTestId("forecast-row").filter({ hasText: "EX-TOTE-RED" });
  await expect(tote).toHaveAttribute("data-status", "none");
  await expect(tote).toContainText("No sales in the last 30 days");

  // Enter 10 a day by hand. It has no FBA stock, so shipping is overdue.
  await tote.getByRole("link", { name: "EX-TOTE-RED" }).click();
  await expect(page.getByRole("heading", { name: /EX-TOTE-RED/ })).toBeVisible();
  await page.getByLabel("Expected units sold per day").fill("ten");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".alert.error")).toContainText("Enter units per day as a number");
  await page.getByLabel("Expected units sold per day").fill("10");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved. The dates now use your number.")).toBeVisible();
  await expect(page.getByTestId("calc-table")).toContainText("Expected daily sales you entered");

  await page.goto("/overview");
  const after = page.getByTestId("forecast-row").filter({ hasText: "EX-TOTE-RED" });
  await expect(after).toHaveAttribute("data-status", "red");
  await expect(after.getByTestId("rate-cell")).toContainText("entered by hand");
  // Most urgent first: the red SKU is now at the top.
  await expect(page.getByTestId("forecast-row").first()).toContainText("EX-TOTE-RED");

  // Clearing it goes back to real sales.
  await after.getByRole("link", { name: "EX-TOTE-RED" }).click();
  await page.getByRole("button", { name: "Clear and use real sales" }).click();
  await expect(page.getByText("Cleared. The dates now use real Amazon sales.")).toBeVisible();
  await page.goto("/overview?view=listing");
  await expect(page.getByTestId("forecast-row").filter({ hasText: "EX-TOTE-RED" })).toHaveAttribute("data-status", "none");
});

// Phase 5: ship to Amazon and pallet build sheets. X001 (EX-TOTE-BLK) packs
// 12 per case, tie 7 (edited above), high 5, max 40, so 35 cases per pallet.
// Staff counted 123 units of it above.
const SHOTS = process.env.E2E_SCREENSHOTS ? path.join(ROOT, "test-results", "screens") : null;

test("admin plans a shipment; staff build it from the pallet sheets and mark it sent", async ({ browser }) => {
  const page = admin;
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Ship to Amazon" }).click();
  await expect(page).toHaveURL(/\/shipments$/);
  await expect(page.getByTestId("plan-row")).toHaveCount(21);

  // Start from a clean slate, then send 40 cases of X001.
  for (const box of await page.getByRole("checkbox", { checked: true }).all()) await box.uncheck();
  const row = page.getByTestId("plan-row").filter({ hasText: "X001" });
  await expect(row).toContainText("10"); // 123 units = 10 full cases on the shelf
  await page.getByLabel("Cases of X001").fill("40");
  await expect(page.getByLabel("Include X001")).toBeChecked();
  await expect(row.getByTestId("plan-pallets")).toContainText("2");
  await expect(row.getByTestId("plan-pallets")).toContainText("35 + 5 cases");
  await expect(row).toContainText("More than the 10 full cases last counted.");
  await page.getByLabel("Note for the warehouse (optional)").fill("Pickup Tuesday 10 AM");
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "1-plan-shipment.png"), fullPage: true });
  await page.getByRole("button", { name: "Create shipment and pallet sheets" }).click();

  await expect(page).toHaveURL(/\/warehouse\/shipments\/\d+\?new=1$/);
  await expect(page.getByTestId("shipment-status")).toHaveText("To build");
  await expect(page.getByTestId("pallet-sheet")).toHaveCount(2);
  const first = page.getByTestId("pallet-sheet").first();
  await expect(first).toContainText("Pallet 1 of 2");
  await expect(first.getByTestId("sheet-inhouse")).toHaveText("X001");
  await expect(first).toContainText("Amazon SKU: EX-TOTE-BLK");
  await expect(first.getByTestId("sheet-cases")).toHaveText("35");
  await expect(first).toContainText("Stack 4 more layers of 7 cases on top");
  const second = page.getByTestId("pallet-sheet").nth(1);
  await expect(second.getByTestId("sheet-cases")).toHaveText("5");
  await expect(second).toContainText("Put all 5 cases flat on the pallet");
  await page.getByLabel("Amazon shipment ID (needed to print Amazon labels)").fill("not-an-id");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".alert.error")).toContainText("Amazon shipment IDs start with FBA");
  await page.getByLabel("Amazon shipment ID (needed to print Amazon labels)").fill("fba15example");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("pallet-sheet").first()).toContainText("Amazon FBA15EXAMPLE");
  const sheetUrl = page.url().replace(/\?.*$/, "");

  // Planning again shows X001 is already in a shipment and leaves it unticked.
  await page.goto("/shipments");
  await expect(page.getByTestId("plan-row").filter({ hasText: "X001" })).toContainText("Already in shipment #");
  await expect(page.getByLabel("Include X001")).not.toBeChecked();

  // Warehouse staff see it and build from the sheets.
  const staff = await newPage(browser);
  await fullLogin(staff, "warehouse", "Brand-new-staff-5%");
  await expect(staff).toHaveURL(/\/warehouse$/);
  await expect(staff.getByTestId("shipment-row")).toHaveCount(1);
  await expect(staff.getByTestId("shipment-row")).toContainText("X001 x 40");
  await staff.getByTestId("shipment-row").getByRole("link").first().click();
  await expect(staff.getByTestId("pallet-sheet")).toHaveCount(2);
  await expect(staff.getByText("Note: Pickup Tuesday 10 AM")).toBeVisible();
  // Staff cannot cancel or edit the Amazon ID.
  await expect(staff.getByRole("button", { name: "Cancel this shipment" })).toHaveCount(0);
  if (SHOTS) {
    await staff.setViewportSize({ width: 1024, height: 1366 }); // a tablet held upright
    await staff.screenshot({ path: path.join(SHOTS, "2-pallet-sheets-tablet.png"), fullPage: true });
    await staff.emulateMedia({ media: "print" });
    await staff.pdf({ path: path.join(SHOTS, "3-pallet-sheets-printed.pdf"), format: "Letter", printBackground: true });
    await staff.emulateMedia({ media: "screen" });
  }

  // Barcode stickers: the FNSKU came from the Amazon report uploaded earlier.
  await staff.getByRole("link", { name: "Barcode stickers for 480 units" }).click();
  await expect(staff.getByRole("heading", { level: 1 })).toHaveText("480 barcode labels for X001");
  await expect(staff.getByTestId("fnsku-labels")).toHaveAttribute("data-count", "480");
  await expect(staff.locator(".fnsku-preview")).toContainText("X000EXAMP1");
  if (SHOTS) {
    await staff.setViewportSize({ width: 1280, height: 900 });
    await staff.screenshot({ path: path.join(SHOTS, "6-barcode-print.png"), fullPage: true });
    await staff.goto(staff.url().replace("qty=480", "qty=3"));
    await staff.emulateMedia({ media: "print" });
    await staff.pdf({ path: path.join(SHOTS, "7-barcode-labels-2.25x1.25.pdf"), preferCSSPageSize: true, printBackground: true });
    await staff.emulateMedia({ media: "screen" });
  }
  await staff.goto("/warehouse/labels");
  await expect(staff.getByTestId("label-row").filter({ hasText: "X001" })).toContainText("X000EXAMP1");
  if (SHOTS) await staff.screenshot({ path: path.join(SHOTS, "5-barcode-labels.png"), fullPage: true });
  await staff.goto("/warehouse/labels/print?sku=1&qty=0");
  await expect(staff.locator(".alert.error")).toContainText("Type how many labels you need");

  // Amazon labels need the Amazon connection, which the test site does not have.
  await staff.goto(sheetUrl + "/labels");
  await expect(staff.getByText("The app is not connected to Amazon")).toBeVisible();
  const noKeys = await staff.request.get(sheetUrl + "/labels/pdf?ship=FBA15EXAMPLE&kind=pallet&pallets=2");
  expect(noKeys.status()).toBe(503);
  const otherShip = await staff.request.get(sheetUrl + "/labels/pdf?ship=FBA15OTHER00&kind=pallet&pallets=2");
  expect(otherShip.status()).toBe(400);
  await staff.goto(sheetUrl);

  // Mark it sent: 480 units left, so the shelf should now be empty.
  await staff.getByTestId("mark-sent-link").click();
  await expect(staff).toHaveURL(/\/send$/);
  await expect(staff.getByLabel("Full cases of X001 left")).toHaveValue("0");
  await staff.getByLabel("Full cases of X001 left").fill("");
  await staff.getByTestId("confirm-sent").click();
  await expect(staff.locator(".alert.error")).toContainText("Every SKU in the shipment needs a count");
  await staff.getByLabel("Full cases of X001 left").fill("0");
  await staff.getByLabel("Loose units of X001 left").fill("3");
  if (SHOTS) await staff.screenshot({ path: path.join(SHOTS, "4-mark-sent.png"), fullPage: true });
  await staff.getByTestId("confirm-sent").click();
  await expect(staff.getByTestId("sent-confirmation")).toBeVisible();
  await expect(staff.getByTestId("shipment-status")).toHaveText("Sent");
  await expect(staff.getByTestId("mark-sent-link")).toHaveCount(0);

  // The count is saved, and the units count as on the way to Amazon.
  await staff.goto("/warehouse/counts");
  await expect(staff.getByTestId("count-row").filter({ hasText: "X001" })).toContainText("3");
  await expect(staff.getByText(/after shipment #\d+ left/)).toBeVisible();
  await page.goto("/overview");
  await expect(page.getByTestId("forecast-row").filter({ hasText: "EX-TOTE-BLK" })).toContainText("incl. 480 just sent");

  // A sent shipment cannot be sent again.
  await staff.goto(sheetUrl + "/send");
  await expect(staff).toHaveURL(sheetUrl);
});
