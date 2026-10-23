# AutoMatch seller portal setup

The public showroom reads published vehicle inventory from Supabase, with the
existing Apps Script feed as a fallback. Customer requests, representative
profiles, and other showroom content remain on Apps Script for now.

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

The migration seeds the ATL Approved seller. Run the additional migration
[`migrations/20261023170000_master_membership_management.sql`](./migrations/20261023170000_master_membership_management.sql)
to enable master-approved seller memberships. In the portal's **Workspace
access** panel, a master can assign or revoke seller workspaces for invited
accounts. Only assigned workspaces appear to seller users; the database
rechecks membership on every protected query. The master account can select
any seller workspace.

## 3. Import ATL Approved inventory

Run
[`migrations/20261023180000_inventory_import_fields.sql`](./migrations/20261023180000_inventory_import_fields.sql)
in SQL Editor. While signed in as master, choose **ATL Approved** in the
seller portal and select **Import existing ATL stock**. This copies currently
available vehicles from the existing public Apps Script feed into Supabase as
published stock. Source IDs make retries skip already imported rows; existing
rows are not overwritten. This import does not change Google Sheets or lead
data. Image-folder IDs and current image URLs are retained as metadata; image
galleries continue using the existing Apps Script image endpoint.

## 4. Configure the static portal

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
- A master must approve each seller account in **Workspace access**. Invite an
  account first, then assign its exact email to the seller workspace.
- The inventory import is a one-time copy from the existing public vehicle feed.
  The public showroom prefers published Supabase inventory and falls back to
  the existing feed if Supabase is unavailable. Leads remain on Apps Script.
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
