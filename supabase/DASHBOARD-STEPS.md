# Dashboard steps for Jessika's Flip Side sync (v0.8.0)

Do these in the [Supabase dashboard](https://supabase.com/dashboard) for the
project at `https://novwnajwmsrrdgarvbry.supabase.co`. The app already has
the project URL and the publishable (browser-safe) key. There is no service
role key in the app, and these steps are the ones that have to be done by
hand.

Sign-in is a **pairing code**, not email. The first device signs in
anonymously when she taps **Turn on sync**. **Connect another device**
shows an 8-character one-time code. The other device types it. Nothing
is emailed. A recovery code is shown once so she can get her data back
if both devices are lost.

The app works fully without this. Until the SQL and anonymous sign-in
are in place, someone who tries to sync will see a friendly “Sync isn't
ready yet” and their items stay safe on the device.

## Already done

These were applied earlier and can be left as they are:

- `schema.sql` (tables `items`, `scans`, `kv`, and a private **photos** bucket)
- **Authentication → URL Configuration**: Site URL
  `https://kjnoot.github.io/flip-helper/` (trailing slash) and redirect
  URLs `https://kjnoot.github.io/flip-helper/**` and
  `https://kjnoot.github.io/flip-helper/`
- **Authentication → Sign In / Providers → Email**: OTP length **6**,
  expiry **3600**. Email sign-in is **not used** by the app right now
  (the free plan cannot edit the email template without custom SMTP).
  Leave these settings. They are ready if a domain is set up later.

## 1. Run the v2 SQL  ← do this first

1. Open **SQL Editor**.
2. Paste the entire contents of `supabase/schema-v2.sql` (in this folder).
3. Click **Run**. It is safe to run more than once. It is safe to run
   after `schema.sql`.
4. You should see a success result, with no red error. Under
   **Table Editor**, you should now also see `sync_owners`,
   `device_links`, `pairing_codes`, `pairing_attempts`, and
   `recovery_codes`, in addition to `items`, `scans`, and `kv`.
5. Under **Database → Functions** (or **SQL → Functions**), you should
   see `ensure_sync_owner`, `create_pairing_code`, `redeem_pairing_code`,
   `redeem_recovery_code`, `rotate_recovery_code`, `revoke_this_device`,
   and `current_owner_id`.

## 2. Allow anonymous sign-ins  ← required

This is the one new Auth toggle. Without it, “Turn on sync” cannot
create a session.

1. Go to **Authentication → Sign In / Providers**.
   (Sometimes the left nav says **Authentication → Providers**.)
2. Open **Anonymous**.
   (The row may be labeled **Anonymous**, **Anonymous Sign-Ins**, or
   **Allow anonymous sign-ins**.)
3. Turn the switch **ON**. The label on the switch itself is often
   **Enable Anonymous Sign-Ins** or **Allow anonymous sign-ins**.
4. Click **Save**.

You do **not** need to turn on any other provider (Google, Apple, etc.).
Email can stay enabled; the app will not show an email form.

## 3. Leave CAPTCHA off

A CAPTCHA would block a simple tap on the iPhone, and the app does not
send a CAPTCHA token.

1. Go to **Authentication → Attack Protection**
   (sometimes **Authentication → Bot and Attack Protection**, or
   **Project Settings → Authentication → Attack Protection**).
2. Confirm **Enable CAPTCHA protection** (or **CAPTCHA**) is **OFF**.
3. If it is on, turn it **OFF** and click **Save**.
4. Leave other attack-protection defaults (leaked-password checks do
   not apply to anonymous users).

## 4. Rate limits — defaults are fine

1. Go to **Authentication → Rate Limits**
   (sometimes under **Attack Protection** or **Project Settings → Auth**).
2. You do not need to change anything for a household. If “Turn on
   sync” ever says to wait a minute, it is this limit; wait and try
   again.
3. Pairing-code guesses are also limited in the SQL (8 missed tries
   per device per 15 minutes, 8 codes per account per hour, 6 devices
   per account). You do not set those in the dashboard.

## 5. Quick checks

- **Storage → photos** should still be **private** (not public).
- There is no “OpenAI key” table, and there should never be one. The
  AI key stays on each device.
- **Authentication → Users** will list an anonymous user after the
  first device turns on sync. You do not add users by hand. Anonymous
  users that never finish pairing and are older than 24 hours are
  cleaned up by the SQL when a later sync RPC runs.

## 6. What success looks like in the app

1. On the phone, Settings → **Sync with my computer** → **Turn on
   sync** (this is the first device).
2. A 16-character **recovery code** appears, once. She writes it down,
   saves a copy, or prints it, then taps **I saved it**. This is how
   she gets her items back if both devices are lost.
3. She taps **Connect another device**. A large 8-character code
   appears, good for about 10 minutes.
4. On the computer (or a second phone), she opens
   https://kjnoot.github.io/flip-helper/, goes to Settings → **Sync
   with my computer** → **I have a code**, and types the 8-character
   code.
5. After that: “This device is synced.” Items, photos, scans,
   listings, and statuses show up on both. What’s already on a device
   is uploaded and merged. Nothing is wiped. The AI key is not
   uploaded — if she wants drafts on the computer, she pastes the key
   in Settings there too.
6. If the v2 SQL has not been run, or anonymous sign-ins are still
   off, the app says **Sync isn't ready yet** and items stay on the
   device.

## If something goes wrong

- “Sync isn't ready yet”: step 1 has not been run, or the `photos`
  bucket is missing. Re-run `schema-v2.sql`.
- “Anonymous sign-ins are disabled” (or a similar Auth error): step 2
  is not on. Turn **Allow anonymous sign-ins** ON and Save.
- A CAPTCHA / “captcha required” error: step 3, turn CAPTCHA **OFF**.
- “That code didn't work or it expired”: codes last about 10 minutes
  and work only once. On the first device, tap **Connect another
  device** again for a new code.
- “Please wait a few minutes and try again”: too many guesses or too
  many new codes. Wait and retry.
- She lost both devices but has the recovery code: on a new device,
  **I have a code**, and type the 16-character recovery code. It stays
  valid until she makes a new one from a signed-in device.

## Email OTP, later

The app still contains the email 6-digit-code functions, but they are
**disabled and hidden**. To turn them on later, after a custom domain
and SMTP are set up, and after the Magic Link template is changed to
show `{{ .Token }}` and **not** `{{ .ConfirmationURL }}`: set
`EMAIL_SYNC_ENABLED` to `true` in `app/js/core/sync-config.js`. Do not
do that until the template shows the 6-digit code and is not a magic link
(a clickable ConfirmationURL opened from the iPhone Home Screen app would
jump out to Safari).
