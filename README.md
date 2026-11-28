# RB Collections FBA Inventory Dashboard

A private web dashboard for tracking Amazon FBA inventory and planning when to
ship to Amazon and when to reorder from China. It is built in phases; see the
build plan for the full picture.

**Phase 1:** logins, the SKU setup screen, and import of the SKU spreadsheet.

**Phase 2 (this version):** Amazon data in. Upload Seller Central reports to
see FBA available, FBA reserved, units inbound to FBA and units sold in the
last 30 days for every SKU, and enter warehouse stock counts.

- **Admin login** sees everything: SKU setup, spreadsheet import, Amazon
  reports, the warehouse screens and the Accounts screen.
- **Warehouse staff logins**, one per person, see only the Warehouse and
  Stock counts screens.

Login security:

- Passwords: at least 12 characters with a special character, not containing
  the username, expiring every 365 days. First logins and admin-set temporary
  passwords must be replaced.
- Every login needs a 6 digit code from an authenticator app (TOTP), with 8
  one-time backup codes. Secrets are stored encrypted; codes work once.
- 5 wrong passwords or codes lock a login for 15 minutes.
- Admin can add staff logins, set temporary passwords, reset an
  authenticator, and turn a login off. Any of these signs that person out.
- HTTPS only (HSTS header); remote database connections must use TLS.

To put the app online, follow **[SETUP.md](SETUP.md)**.

## The SKU spreadsheet

Fill in [`public/SKU-setup-template.xlsx`](public/SKU-setup-template.xlsx)
(also downloadable from the Import screen), one row per SKU, then upload it on
**Import spreadsheet**. The app checks every row, shows what it found, and saves
nothing until you press Import. Rows are matched by Amazon SKU, so uploading
again updates SKUs instead of adding copies. A filled-in "Warehouse on hand
(units)" cell is recorded as a warehouse count; leave it blank if you have not
counted yet. Counts can also be typed on each SKU's edit screen.

Required columns: Listing, Amazon SKU, In-house SKU, Units per case,
Tie (cases per layer), High (layers), Max cases per pallet. Optional:
Warehouse on hand (units), Product description, Warehouse location, ASIN,
Count date, Notes.

## Amazon reports

Upload on **Amazon reports**. The app recognises each file from its columns:

| Report (Seller Central > Reports > Fulfillment) | SP-API report type | Gives |
| --- | --- | --- |
| Manage FBA Inventory (.txt) | `GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA` | FBA available (fulfillable), reserved, unsellable, inbound working / shipped / receiving |
| Inventory Ledger, Detailed view (.tsv or .csv) | `GET_LEDGER_DETAIL_VIEW_DATA` | Daily events per SKU; `Shipments` are units sold |

- Only SKUs in the SKU list are used. Other SKUs and Amazon's `amzn.gr.*`
  resale SKUs are counted as skipped, never as errors.
- "Inbound to FBA" is working + shipped + receiving, matching Seller Central.
- Ledger rows are summed per SKU, day, event type and disposition across
  fulfillment centers. Uploading days already loaded replaces them, so sales
  are never counted twice.
- Each inventory upload is kept as a snapshot; the newest one is shown.
- The browser gzips files before upload, so a month of ledger fits easily.

`saveAmazonReport()` in `src/lib/amazon/repo.ts` is the single entry point
for both hand uploads and the Phase 3 SP-API pull (`source: "sp_api"`, with
`asOf` set to the report's data end time). Parsing lives in
`src/lib/amazon/parse.ts` and has no database dependencies.

Real Seller Central reports must only ever be uploaded into the running app,
never committed here. Test fixtures in `tests/fixtures/` are made up.

## Stock counts

**Warehouse > Enter stock counts** (`/warehouse/counts`) lets staff type full
cases and loose units per in-house SKU; the app works out the units. A second
count for the same SKU on the same day replaces the first. "Today" uses
`BUSINESS_TIME_ZONE` (default `America/Los_Angeles`).

## For developers

Stack: Next.js 16 (App Router, TypeScript), Postgres with Drizzle ORM,
cookie sessions signed with `jose`, passwords hashed with bcrypt, TOTP
(RFC 6238) implemented in `src/lib/auth/totp.ts`.

```bash
cp .env.example .env.local      # then fill in the values
npm install
npm run db:migrate              # create the tables
npm run db:sample               # optional: load 21 made-up example SKUs
npm run dev                     # http://localhost:3000
```

| Command | What it does |
| --- | --- |
| `npm test` | Unit tests, plus database tests when `TEST_DATABASE_URL` is set (the database is wiped) |
| `npm run test:e2e` | Builds the app and runs browser tests against `E2E_DATABASE_URL` (wiped) |
| `npm run lint` / `npm run typecheck` | Lint and type check |
| `npm run db:generate` | Create a migration after changing `src/db/schema.ts` |

Layout:

- `src/db/` database schema and connection; migrations in `drizzle/`
- `src/lib/auth/` logins, authenticator codes, sessions and who can see which screen
- `src/lib/skus/` spreadsheet reading, row checks and saving
- `src/app/` screens; `src/proxy.ts` sends logged-out visitors to the login page
- `tests/unit`, `tests/integration` (needs Postgres), `tests/e2e` (Playwright)

Never commit keys, passwords or real business data: this repository is public.
