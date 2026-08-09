# Setup Guide — Right Vehicle To Learners Driving School Website

**Status: the site is already live at [rv2learners.au](https://rv2learners.au)**, hosted on Vercel and deployed automatically from a connected GitHub repo (`rv2learners-site`). Hosting and the domain are done — the only thing left is wiring up **calendar-synced booking** (section 1 below).

## What's in this folder

```
index.html                    the website
css/styles.css                styling
js/script.js                  interactivity + booking form logic
google-apps-script/Code.gs    backend that syncs bookings to Google Calendar
robots.txt                    tells search engines the site is crawlable
sitemap.xml                   single-page sitemap for search engines
SETUP-GUIDE.md                this file
```

## 1. Connect bookings to Google Calendar (Google Apps Script)

The booking form needs a backend to actually create calendar events — a static site can't do that alone. Google Apps Script is the free, no-server way to do it, running on the **owner's own Google account**.

**This step must be done while logged into `rv2learners@gmail.com`** (the dedicated business Google account), since the script creates events on that account's calendar and sends email from that address.

1. Go to [script.google.com](https://script.google.com) and sign in with **rv2learners@gmail.com**.
2. Click **New project**.
3. Delete the placeholder code and paste in the contents of `google-apps-script/Code.gs`.
4. Near the top of the script, update if needed:
   - `OWNER_EMAIL` — already set to `rv2learners@gmail.com`.
   - `CALENDAR_ID` — leave as `"primary"` to use the owner's main calendar, or paste a specific Calendar ID if they want a dedicated "Bookings" calendar (Calendar → Settings → that calendar → **Integrate calendar** → Calendar ID).
   - `LESSON_DURATION_MINUTES` — default lesson length used to block out the calendar slot.
   - `BUFFER_MINUTES` — gap required between lessons (default 15 min). Set to `0` for back-to-back bookings with no gap.
5. Click **Deploy → New deployment**.
   - Click the gear icon next to "Select type" and choose **Web app**.
   - Description: "Booking endpoint" (anything works).
   - Execute as: **Me** (the owner's account).
   - Who has access: **Anyone**.
   - Click **Deploy**.
6. Google will ask you to authorize the script (it needs Calendar + Gmail access). Review and accept — this is expected since the script creates events and sends emails on the owner's behalf.
7. Copy the **Web app URL** it gives you (looks like `https://script.google.com/macros/s/XXXXXXXX/exec`).
8. Open `js/script.js` and replace:
   ```js
   const BOOKING_ENDPOINT = "YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE";
   ```
   with the URL you copied.

That's it — booking form submissions will now create a calendar event, invite the customer (as a calendar guest, which also emails them the invite), and send both the customer and the owner a confirmation email.

**Test it:**
1. Open the site, submit a test booking with your own email, and check that (a) an event appears on the calendar and (b) you get a confirmation email.
2. Then submit a **second** booking for the same (or an overlapping) date/time. It should be rejected with "that time is no longer available" instead of creating a second event — this confirms conflict detection is working.

**Double-booking protection:** the script checks the calendar for existing events overlapping the requested time (padded by `BUFFER_MINUTES` on each side) before creating a new one, and rejects the request if there's a clash. It also uses Apps Script's `LockService` to serialize requests, so two people submitting at nearly the same instant can't both slip through the conflict check before either event is created.

**Note on CORS:** the booking form reads the script's JSON response directly (needed to tell a successful booking apart from a rejected one). This relies on Apps Script returning a readable response for simple cross-origin requests, which is the normal behavior for "Anyone" access — but if a customer's browser ever blocks it (shows in the browser console as a CORS error), the form falls back to a generic "please call to confirm" message rather than silently failing.

**One more one-time step — automatic confirmations for manual bookings + reminders:**
The script can also email a "Thanks for booking" confirmation for lessons Vijay adds straight into the calendar (not just website bookings), and a reminder email `REMINDER_DAYS_BEFORE` (default 2) days before every lesson. Both run automatically in the background, but need to be scheduled once:
1. In the Apps Script editor, use the function dropdown next to the **Run** button and select **setupTriggers**.
2. Click **Run**. Approve any permission prompt if it appears.
3. That's it — this creates two triggers (visible under the clock icon on the left sidebar): one checking for new bookings every 15 minutes, one sending reminders daily. Safe to re-run `setupTriggers` any time (it clears old triggers first, so it never duplicates them).

For a manually-added event to get a confirmation email, just add the customer's email as a **Guest** on the calendar event — that's how the script knows who to email.

**2-hour lessons and multi-day bookings:** the booking form lets customers choose a duration (1 hour or 2 hours) and, optionally, repeat the same time across several consecutive days (up to `MAX_REPEAT_DAYS`, default 10 — e.g. an intensive run before a test). The availability shown always reflects the chosen duration, and for a multi-day request the script checks **every** day is free before creating any events — if one day in the run is unavailable, nothing gets booked and the customer is told which day to adjust. No extra setup needed for this; it's built into `Code.gs`.

## 2. Hosting — already done

The site is live at **rv2learners.au**, deployed on Vercel and wired to a GitHub repo (`rv2learners-site`) so that any commit pushed to `main` auto-deploys. To make future edits: update the files in that repo (via GitHub's web UI or `git push`), and Vercel rebuilds automatically within a minute or two. The domain, HTTPS, and DNS are all already configured — nothing to do here.

## 3. Swap in real details before launch

- [x] Replace `OWNER_EMAIL` placeholder in `google-apps-script/Code.gs` with the real owner/business email (`rv2learners@gmail.com`).
- [ ] Replace `BOOKING_ENDPOINT` placeholder in `js/script.js` with the deployed Apps Script URL (see section 1).
- [x] Real photo of the school vehicle added to the About section.
- [x] Real logo added to the header and site favicon.
- [ ] Double-check phone number, address, and hours in `index.html` match the current Google Business listing.
- [ ] Add an `og-image.jpg` (1200×630px works well) to the project root for social share previews — referenced in `index.html`'s Open Graph tags but not yet created.
- [ ] Optional: swap the embedded Google Map for one using a Google Maps API key if you want custom styling (the current embed needs no API key and works out of the box).

## Where the content came from

Business details (address, phone, hours, 5.0★ rating, 112 reviews) and the testimonials on the site were pulled from the school's live Google Business listing. Testimonials use real reviewer names and (lightly trimmed) review text — worth periodically refreshing with newer reviews as they come in.
