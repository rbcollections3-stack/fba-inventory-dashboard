# Putting the dashboard online

This takes about 30 minutes. You create two accounts, copy a few values
between them, and the app goes live at a web address only your logins can use.

- **Supabase** holds the database (your SKUs, counts and later your sales).
- **Vercel** runs the website and updates it automatically each time a change
  is approved on GitHub.

You will make up a few secret values along the way. Keep them in a password
manager. Never paste them into chat, email or GitHub.

You also need an **authenticator app** on your phone, such as Google
Authenticator or Microsoft Authenticator (both free). Every login asks for a
6 digit code from it.

## 1. Create the database on Supabase

1. Go to [supabase.com](https://supabase.com) and sign up (signing in with
   GitHub is easiest).
2. Click **New project**. Name it `fba-dashboard`, pick the region closest to
   you, and click **Generate a password** for the database password. Copy that
   password into your password manager.
   Under **Data access** (sometimes under "Security" or "Advanced"), **untick**
   "Enable Data API", "Grant API access to new tables automatically" and
   "Enable RLS on new tables automatically". The dashboard connects to the
   database directly and never uses the Data API, so leaving it on would only
   open an extra way in. Click **Create new project** and wait a minute or two.
   (If the project already exists, turn it off under
   **Project Settings > Data API**.)
3. Click **Connect** at the top of the project page. Find the
   **Transaction pooler** connection string (it ends in `:6543/postgres`).
   Copy it and replace `[YOUR-PASSWORD]` with the database password from step 2.
   This full line is your **DATABASE_URL**.
4. Go to **Project Settings > Database** and turn on **Enforce SSL on incoming
   connections**, so the database only accepts encrypted connections. (The app
   already insists on encryption from its side.)

## 2. Create the website on Vercel

1. Go to [vercel.com](https://vercel.com) and sign up with GitHub.
2. Click **Add New... > Project**, find `fba-inventory-dashboard` and click
   **Import**. (If it is not listed, click **Adjust GitHub App Permissions**
   and give Vercel access to that repository.)
3. Open **Environment Variables** on the same screen and add these:

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | the line from Supabase step 3 |
   | `AUTH_SECRET` | a long random string, at least 32 characters. A password manager's "generate password" with 40 characters works. **Never change it later**: it also locks the stored authenticator keys, so changing it means everyone sets up their app again. |
   | `ADMIN_PASSWORD` | a first password for you: 12 or more characters, with a special character such as `!` or `-`, and not containing the word "admin". You replace it at your first login. |
   | `STAFF_PASSWORD` | a first password for the first warehouse login, following the same rules and not containing "warehouse". They replace it at their first login. |
   | `ADMIN_USERNAME` | optional. Leave out to use `admin` |
   | `STAFF_USERNAME` | optional. Leave out to use `warehouse`. Using the employee's first name is better, because each login belongs to one person. |
   Tick **Production** and **Preview** for each one. Preview is the test
   copy of the site that Vercel builds for each pull request, so you can try
   changes before approving them.
4. Click **Deploy**. Vercel creates the database tables and builds the site.
   When it finishes it shows the web address, something like
   `fba-inventory-dashboard.vercel.app`. It is HTTPS only. (If you deploy
   before the first pull request is approved, this first build fails because
   the main branch has no app yet. That is expected: use the pull request's
   preview link until it is merged.)

## 3. First login

1. Open the web address and log in with username `admin` (or your
   `ADMIN_USERNAME`) and your `ADMIN_PASSWORD`.
2. Set up your authenticator app: open the app, tap **+**, and scan the QR
   code on screen. Type the 6 digit code it shows.
3. **Save the 8 backup codes** shown next. Each one lets you log in once if
   you lose your phone. Keep them in your password manager or print them and
   lock them away.
4. Choose your own password (same rules: 12 or more characters with a special
   character).
5. Go to **Import spreadsheet**, upload your filled-in SKU template, check the
   preview, and press **Import**. You should see all your SKUs on the **SKUs**
   screen.

## 4. Warehouse staff

Every person gets their own login. Never share one.

- The first staff login is the `STAFF_USERNAME` with `STAFF_PASSWORD`. Give
  it to one person.
- For anyone else, go to **Accounts > Add a warehouse staff login**, choose a
  username and a temporary password, and give them both.
- At their first login each person sets up an authenticator app on their own
  phone, saves their backup codes, and chooses their own password. They only
  see the Warehouse screen.
- When someone leaves, go to **Accounts** and press **Turn login off**. They
  are logged out at once.
- If someone loses their phone and backup codes, press **Reset authenticator
  app** on their login. They set it up again at their next login.

Passwords expire after 365 days, and the app asks for a new one at the next
login after that. The **Accounts** screen shows each login's expiry date.

## 5. Connect Amazon (automatic daily reports)

Once this is set up, the app pulls your FBA stock, units inbound to Amazon and
the last 31 days of daily sales from Amazon every morning, so you no longer
need to download and upload reports. Uploading still works as a backup.

The connection is **read-only**. The app can only ask Amazon for two reports,
Manage FBA Inventory and the Inventory Ledger (detailed view). It cannot change
listings, prices, shipments or anything else, and it never asks for customer
names or addresses. Your app in Seller Central needs the **Amazon Fulfillment**
role ticked.

You need the three keys you saved in your password manager: the **Client ID**,
the **Client Secret** and the **Refresh Token**. Type or paste them only into
Vercel, never into chat, email or a file.

1. In Vercel, open the project, then **Settings > Environment Variables**.
2. Add each of these. For each one, tick **Production** and **Preview**, and
   switch on **Sensitive** so nobody can read the value back later.

   | Name | Value |
   | --- | --- |
   | `SP_API_CLIENT_ID` | the Client ID (starts with `amzn1.application-oa2-client.`) |
   | `SP_API_CLIENT_SECRET` | the Client Secret |
   | `SP_API_REFRESH_TOKEN` | the Refresh Token (starts with `Atzr|`) |
   | `CRON_SECRET` | a new random string of 32 or more letters and numbers, made with your password manager's "generate password". It stops strangers from starting the daily pull. You never need to type it anywhere else. |

3. Open **Deployments**, click the three dots next to the newest deployment
   and choose **Redeploy**. New settings only take effect after a redeploy.
4. Log in to the dashboard, open **Amazon**, and press
   **Refresh from Amazon now**. Amazon takes 1 to 5 minutes to prepare the
   reports. If the page says Amazon is still preparing them, wait a few
   minutes and reload the page. Both rows should then show **OK**.

The daily pull runs at about 5 AM and again at about 7 AM Pacific, an hour later in summer (the second
run only finishes anything Amazon was slow with). Vercel runs it on the live
site only, not on previews. On the free Hobby plan Vercel may start it any time
within that hour.

**Previews share the live database**, so pressing Refresh on a preview link
loads Amazon's numbers into your live data. That is safe: it is the same data
the live site would load.

**If the Amazon box shows "Failed":** the message under **Problem** says why.
The common ones:

- *did not accept the Client ID or Client Secret*, or *did not accept the
  Refresh Token*: a key was mistyped or has a space at the end. Re-enter it in
  Vercel and redeploy. If you re-authorised the app in Seller Central, the
  Refresh Token changed: use the new one.
- *refused access (403)*: the app is missing the **Amazon Fulfillment** role,
  or the role was added after the Refresh Token was made. In Seller Central go
  to **Apps and Services > Develop Apps**, check the role, then authorise the
  app again to get a new Refresh Token and put that in Vercel.

**Canada and other marketplaces.** The app reads Amazon.com (US) only for now.
Optional settings `SP_API_MARKETPLACE_ID` (default `ATVPDKIKX0DER`, US) and
`SP_API_REGION` (default `na`) exist so another marketplace can be added
later without a rewrite.

## Costs and the "database not publicly reachable" question

Check the current pricing pages before you rely on these.

- Vercel's free **Hobby** plan is meant for personal, non-commercial use, so a
  business tool should normally be on **Pro** ([vercel.com/pricing](https://vercel.com/pricing)).
- Supabase's free plan pauses a project after a week with no activity. Daily
  use keeps it awake. **Pro** never pauses and adds daily backups
  ([supabase.com/pricing](https://supabase.com/pricing)).
- **Locking the database so only the website can reach it.** By default a
  Supabase database accepts connections from anywhere on the internet that
  have the database password, and the connection is encrypted. To restrict
  it to the website only, Vercel's **Static IPs** add-on gives the site fixed
  addresses (Pro plan, listed at $100 per month per project), and Supabase's
  **Network Restrictions** setting then allows only those addresses. Steps:
  in Vercel, **Settings > Networking > Advanced Networking > Static IPs**,
  pick the region nearest your Supabase project and copy the addresses. In
  Supabase, **Project Settings > Database > Network Restrictions**, add those
  addresses, then redeploy on Vercel.

## If something goes wrong

- **"The app is not set up yet"** on the login page: `ADMIN_PASSWORD` or
  `STAFF_PASSWORD` is missing or breaks the password rules (12 or more
  characters, a special character, not containing the username). Fix it in
  Vercel under **Settings > Environment Variables**, then
  **Deployments > Redeploy**.
- **The deploy fails at "db:migrate"**: the `DATABASE_URL` is wrong. Check the
  password was put in place of `[YOUR-PASSWORD]` with no brackets left.
- **"That code is not right"**: codes change every 30 seconds, so type the
  newest one. If it keeps failing, check the phone's clock is set
  automatically.
- **Locked out after wrong tries**: wait 15 minutes. Five wrong passwords or
  codes in a row lock that login for 15 minutes.
- **You (the admin) lost your phone and your backup codes**: in Supabase, open
  **SQL Editor** and run
  `update users set totp_secret_enc = null, totp_enabled_at = null, totp_last_step = null, session_version = session_version + 1 where username = 'admin';`
  then log in and set up your authenticator again.
