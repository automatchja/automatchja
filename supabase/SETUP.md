# AutoMatch seller portal setup

The existing public showroom remains unchanged while this portal is introduced.
The migration creates the seller-scoped data model and access policies; it does
not copy inventory or customer requests out of the current Google Apps Script.

## 1. Create a Supabase project

Create a project in the Supabase dashboard and keep its database password private.
In **SQL Editor**, run
[`migrations/20261022190000_multitenant_core.sql`](./migrations/20261022190000_multitenant_core.sql).

## 2. Create Allan's account

Set the Supabase Auth **Site URL** to the current hosted website address (or
`http://localhost:3000` while testing locally) and add the exact seller portal
URL to **Redirect URLs** (for local testing, `http://localhost:3000/seller.html`).
A custom domain can replace these later.

In **Authentication → Users**, invite Allan's email address. Public sign-ups
should remain disabled; accounts should be invited by an administrator.
The database trigger creates a non-privileged profile for each new auth user.
Open the invite link and set a password on the seller portal before signing in.
If the invite link expires or you have not set a password, use **Set or reset
password** on the sign-in page to request a fresh password link.

In SQL Editor, promote that profile to master, replacing the placeholder email:

```sql
update public.user_profiles
set role = 'master'
where id = (
  select id from auth.users where email = 'allan@example.com'
);
```

The migration seeds the ATL Approved seller. The master account can select
ATL Approved or any other seller in the portal and manage that seller's
inventory and requests.

## 3. Configure the static portal

Set the project's URL and its public publishable key (or legacy anon key) in
`seller-config.js`, using the values from **Project Settings → API**. These
browser values are intended to be public. Never put a `service_role` key,
database password, or other secret in this file.

Open `seller.html` through the same static hosting used for the existing site.
For local testing, serve the repository over HTTP rather than opening the file
directly. Sign in with the invited account.

## Current scope

- One account can hold master access and memberships in one or more sellers.
- Seller membership is enforced in Postgres with row-level security; hiding a
  seller in the interface is not the security boundary.
- Only published stock from active sellers is publicly readable. Drafts and
  leads are not public.
- The portal can create and publish inventory and review/update leads.
- Invite and password-recovery links return to the seller portal, where the user
  can set a password before continuing. Password reset emails are sent by
  Supabase Auth and may require a configured SMTP provider outside development.
- Lead creation is intentionally restricted to the Supabase service role. A
  trusted submission endpoint with spam/rate-limit protections must be added
  before moving public lead submissions from Apps Script into Supabase.
- Inventory currently entered in Google Sheets is not migrated by this change.
