# Putting the dashboard online

This takes about 30 minutes. You create two free accounts, copy a few values
between them, and the app goes live at a web address only your logins can use.

- **Supabase** holds the database (your SKUs, counts and later your sales).
- **Vercel** runs the website and updates it automatically each time a change
  is approved on GitHub.

You will make up three secret values along the way. Keep them in a password
manager. Never paste them into chat, email or GitHub.

## 1. Create the database on Supabase

1. Go to [supabase.com](https://supabase.com) and sign up (signing in with
   GitHub is easiest).
2. Click **New project**. Name it `fba-dashboard`, pick the region closest to
   you, and click **Generate a password** for the database password. Copy that
   password into your password manager. Click **Create new project** and wait
   a minute or two.
3. Click **Connect** at the top of the project page. Find the
   **Transaction pooler** connection string (it ends in `:6543/postgres`).
   Copy it and replace `[YOUR-PASSWORD]` with the database password from step 2.
   This full line is your **DATABASE_URL**.

## 2. Create the website on Vercel

1. Go to [vercel.com](https://vercel.com) and sign up with GitHub.
2. Click **Add New... > Project**, find `fba-inventory-dashboard` and click
   **Import**. (If it is not listed, click **Adjust GitHub App Permissions**
   and give Vercel access to that repository.)
3. Open **Environment Variables** on the same screen and add these five:

   | Name | Value |
   | --- | --- |
   | `DATABASE_URL` | the line from Supabase step 3 |
   | `AUTH_SECRET` | a long random string, at least 32 characters. A password manager's "generate password" with 40 characters works. |
   | `ADMIN_PASSWORD` | the password you will use to log in (10 or more characters) |
   | `STAFF_PASSWORD` | the password for the warehouse staff login (10 or more characters, different from yours) |
   | `ADMIN_USERNAME` | optional. Leave out to use `admin` |

   You can also set `STAFF_USERNAME`; it defaults to `warehouse`.
4. Click **Deploy**. Vercel creates the database tables and builds the site.
   When it finishes it shows the web address, something like
   `fba-inventory-dashboard.vercel.app`.

## 3. First login

1. Open the web address and log in with username `admin` and your
   `ADMIN_PASSWORD`. The two logins are created the first time anyone logs in.
2. Go to **Import spreadsheet**, upload your filled-in SKU template, check the
   preview, and press **Import**. You should see all your SKUs on the **SKUs**
   screen.
3. Give the warehouse staff the web address, the username `warehouse` and the
   `STAFF_PASSWORD`. They will only see the Warehouse screen.
4. To change either password later, use the **Accounts** screen. Changing a
   password logs that login out on every other device. After the first login,
   the `ADMIN_PASSWORD` and `STAFF_PASSWORD` settings are no longer used.

## Costs to check

Both services have free plans, but check their current pricing pages before
relying on them for the business:

- Vercel's free **Hobby** plan is meant for personal, non-commercial use.
  A business tool should normally be on the **Pro** plan (per-user monthly
  price on [vercel.com/pricing](https://vercel.com/pricing)).
- Supabase's free plan pauses a project after a week with no activity. Daily
  use keeps it awake; the **Pro** plan never pauses and adds daily backups
  ([supabase.com/pricing](https://supabase.com/pricing)).

## If something goes wrong

- **"The app is not set up yet"** on the login page: `ADMIN_PASSWORD` or
  `STAFF_PASSWORD` is missing or shorter than 10 characters. Fix it in Vercel
  under **Settings > Environment Variables**, then **Deployments > Redeploy**.
- **The deploy fails at "db:migrate"**: the `DATABASE_URL` is wrong. Check the
  password was put in place of `[YOUR-PASSWORD]` with no brackets left.
- **Locked out after wrong passwords**: wait 15 minutes. Five wrong passwords
  in a row lock that login for 15 minutes.
