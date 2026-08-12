/**
 * Right Vehicle To Learners Driving School — Booking Backend
 * -----------------------------------------------------------
 * Deploy this as a Google Apps Script Web App (see SETUP-GUIDE.md).
 * It receives booking form submissions from the website, creates
 * an event on the school's Google Calendar, and emails a
 * confirmation to both the customer and the owner.
 *
 * SETUP: fill in the constants below before deploying.
 */

// ---- CONFIG: update these before deploying ----------------------------

// The Google Calendar to book lessons into.
// Use "primary" to use the calendar of the Google account that owns
// this script, or paste a specific Calendar ID (Calendar Settings ->
// "Integrate calendar" -> Calendar ID) if using a dedicated booking calendar.
const CALENDAR_ID = "primary";

// Where booking notifications are sent (the school owner's inbox).
const OWNER_EMAIL = "rv2learners@gmail.com";

// Default lesson length, in minutes, used to size the calendar event.
const LESSON_DURATION_MINUTES = 60;

// Minimum gap, in minutes, required between the end of one lesson and the
// start of the next (e.g. for driving/setup time between students).
// Set to 0 to allow lessons booked back-to-back with no gap. Kept at 0 so
// hourly slots (6-7, 7-8, 8-9...) are independent — booking one only blocks
// that exact slot instead of bleeding into its neighbours.
const BUFFER_MINUTES = 0;

// How long (in seconds) a booking request will wait for other simultaneous
// bookings to finish before giving up. Prevents two customers who submit at
// the same moment from both grabbing the same time slot.
const LOCK_TIMEOUT_SECONDS = 15;

// Business name shown in emails / event titles.
const BUSINESS_NAME = "Right Vehicle To Learners Driving School";

// Phone number shown to customers when they should call instead of booking online.
const BUSINESS_PHONE = "0420 655 620";

// How many days ahead customers can see availability / book online.
const BOOKING_WINDOW_DAYS = 28;

// Minimum notice (in hours) required before a lesson's start time — stops
// someone booking a slot 10 minutes from now with no time to prepare.
const MIN_NOTICE_HOURS = 2;

// Spacing between the time slots offered to customers, in minutes. Should
// divide evenly into the business hours below for clean slot boundaries.
// Note: since lessons run LESSON_DURATION_MINUTES long, any interval
// shorter than that means booking one start time can also grey out a
// couple of neighbouring ones (their windows overlap) — that's expected.
const SLOT_INTERVAL_MINUTES = 15;

// Business hours by day of week (0 = Sunday ... 6 = Saturday), as
// [openHour, closeHour] in 24-hour time. Keep in sync with the hours shown
// on the website and in the structured data in index.html.
const BUSINESS_HOURS = {
  0: [8, 18], // Sunday
  1: [8, 18], // Monday
  2: [8, 18], // Tuesday
  3: [8, 18], // Wednesday
  4: [8, 18], // Thursday
  5: [8, 18], // Friday
  6: [8, 18], // Saturday
};

// How far ahead (in days) the periodic scanner looks for newly-added
// calendar events that still need a confirmation email — e.g. lessons
// Vijay booked by phone and added to the calendar manually.
const CONFIRMATION_SCAN_WINDOW_DAYS = 90;

// How many days before a lesson to email the customer a reminder.
const REMINDER_DAYS_BEFORE = 1;

// Tags stamped onto calendar events so the confirmation/reminder scanners
// never process (or email) the same event twice.
const CONFIRMATION_SENT_TAG = "rv2ConfirmationSent";
const REMINDER_SENT_TAG = "rv2ReminderSent";

// Lesson durations customers can choose from online, in minutes. The first
// value is the default used if an invalid/missing duration is sent.
const ALLOWED_DURATIONS_MINUTES = [60, 120];

// Safety cap on how many consecutive days a single "repeat this booking"
// request can create in one go.
const MAX_REPEAT_DAYS = 10;

// Google Sheet used as a simple customer log — name, contact details,
// lesson type, and test date if given — for every booking (website and
// phone/manual). Paste the Sheet ID from its URL
// (https://docs.google.com/spreadsheets/d/THIS_PART/edit) once you've
// created a blank sheet for it. Leave as the placeholder to skip logging
// without affecting bookings — see SETUP-GUIDE.md.
const CUSTOMER_LOG_SHEET_ID = "PASTE_YOUR_GOOGLE_SHEET_ID_HERE";
const CUSTOMER_LOG_SHEET_TAB_NAME = "Bookings";

// -------------------------------------------------------------------------

/**
 * Handles POST requests from the website's booking form.
 * Expected JSON body:
 * {
 *   fullName, email, phone, lessonType, date ("YYYY-MM-DD"),
 *   time ("HH:MM"), message
 * }
 */
function doPost(e) {
  // Serialize booking requests so two people submitting at nearly the same
  // instant can't both pass the conflict check before either event exists.
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_TIMEOUT_SECONDS * 1000);
  } catch (err) {
    return jsonResponse({
      status: "error",
      message: "We're processing another booking right now — please try again in a few seconds.",
    });
  }

  try {
    const data = JSON.parse(e.postData.contents);

    const required = ["fullName", "email", "phone", "lessonType", "date", "time"];
    for (const field of required) {
      if (!data[field]) {
        return jsonResponse({ status: "error", message: `Missing field: ${field}` });
      }
    }

    const duration = ALLOWED_DURATIONS_MINUTES.includes(parseInt(data.duration, 10))
      ? parseInt(data.duration, 10)
      : LESSON_DURATION_MINUTES;

    // 1 = a single booking. Anything higher creates that many consecutive
    // days at the same time (e.g. an intensive run before a test).
    const repeatDays = Math.min(Math.max(parseInt(data.repeatDays, 10) || 1, 1), MAX_REPEAT_DAYS);

    const firstStart = new Date(`${data.date}T${data.time}:00`);
    if (isNaN(firstStart.getTime())) {
      return jsonResponse({ status: "error", message: "Invalid date/time." });
    }

    const calendar = CalendarApp.getCalendarById(CALENDAR_ID === "primary" ? CalendarApp.getDefaultCalendar().getId() : CALENDAR_ID);

    // Validate + conflict-check every day in the run BEFORE creating any
    // events, so a multi-day request never ends up half-booked — if day 4
    // of 5 is taken, nothing gets created and the customer is told why.
    const bookings = [];
    for (let i = 0; i < repeatDays; i++) {
      const startTime = new Date(firstStart);
      startTime.setDate(startTime.getDate() + i);
      const endTime = new Date(startTime.getTime() + duration * 60000);

      const validationError = validateBookableTime(startTime, endTime);
      if (validationError) {
        return jsonResponse({ status: "conflict", message: validationError });
      }

      if (hasConflict(calendar, startTime, endTime)) {
        const message =
          repeatDays > 1
            ? `Sorry, ${formatDate(startTime)} at ${formatTime(startTime)} isn't available, so this ${repeatDays}-day run couldn't be booked (nothing has been added to the calendar). Please adjust the dates or time, or call us on ${BUSINESS_PHONE}.`
            : `Sorry, that time was just booked by someone else. Please choose another slot above, or call us on ${BUSINESS_PHONE} — Vijay may be able to fit you in.`;
        return jsonResponse({ status: "conflict", message: message });
      }

      bookings.push({ startTime: startTime, endTime: endTime });
    }

    const eventTitle = `${data.lessonType} — ${data.fullName}`;
    const eventDescription = [
      `Lesson type: ${data.lessonType}`,
      `Duration: ${duration} minutes`,
      `Student: ${data.fullName}`,
      `Email: ${data.email}`,
      `Phone: ${data.phone}`,
      data.testDate ? `Test date: ${data.testDate}` : null,
      data.message ? `Notes: ${data.message}` : null,
      repeatDays > 1 ? `Part of a ${repeatDays}-day booking run.` : null,
      "",
      "Booked automatically via the website booking form.",
    ]
      .filter(Boolean)
      .join("\n");

    const eventIds = bookings.map(({ startTime, endTime }) => {
      const event = calendar.createEvent(eventTitle, startTime, endTime, {
        description: eventDescription,
        guests: data.email,
        sendInvite: true,
      });
      // Mark as already handled so the periodic scanner (which catches
      // manually-added bookings) doesn't also send this one a confirmation.
      event.setTag(CONFIRMATION_SENT_TAG, "true");

      logBookingToSheet({
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        lessonType: data.lessonType,
        testDate: data.testDate || "",
        lessonDate: formatDate(startTime),
        lessonTime: formatTime(startTime),
        duration: duration,
        notes: data.message || "",
        source: "Website",
      });

      return event.getId();
    });

    sendCustomerConfirmation(data, bookings, duration);
    sendOwnerNotification(data, bookings, duration, eventIds);

    return jsonResponse({ status: "success", eventIds: eventIds });
  } catch (err) {
    return jsonResponse({ status: "error", message: err.message });
  } finally {
    lock.releaseLock();
  }
}

/**
 * Checks a single booking window against the booking window, minimum
 * notice, and business hours rules. Returns null if it's bookable, or a
 * customer-facing message explaining why it isn't. The website's dropdowns
 * normally keep customers from hitting these, but a multi-day "repeat"
 * request can easily push a later day past the booking window or into
 * closed hours without the frontend ever seeing that specific day.
 */
function validateBookableTime(startTime, endTime) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maxDate = new Date(today.getTime() + BOOKING_WINDOW_DAYS * 86400000);
  const dayStart = new Date(startTime);
  dayStart.setHours(0, 0, 0, 0);
  if (dayStart < today || dayStart > maxDate) {
    return `Sorry, ${formatDate(startTime)} is outside our ${BOOKING_WINDOW_DAYS}-day booking window. Please call ${BUSINESS_PHONE} to check availability further out.`;
  }

  const earliestStart = new Date(Date.now() + MIN_NOTICE_HOURS * 3600000);
  if (startTime < earliestStart) {
    return `Sorry, ${formatDate(startTime)} at ${formatTime(startTime)} doesn't leave enough notice (at least ${MIN_NOTICE_HOURS} hours). Please choose a later time, or call ${BUSINESS_PHONE}.`;
  }

  const hours = BUSINESS_HOURS[startTime.getDay()];
  if (!hours) {
    return `Sorry, we're closed on ${formatDate(startTime)}. Please choose another date.`;
  }
  const [openHour, closeHour] = hours;
  const startMinutes = startTime.getHours() * 60 + startTime.getMinutes();
  const endMinutes = startMinutes + (endTime.getTime() - startTime.getTime()) / 60000;
  if (startMinutes < openHour * 60 || endMinutes > closeHour * 60) {
    return `Sorry, ${formatDate(startTime)} at ${formatTime(startTime)} doesn't fit within our opening hours for that lesson length. Please choose another time, or call ${BUSINESS_PHONE}.`;
  }

  return null;
}

/**
 * Returns true if the calendar already has an event overlapping the
 * requested window (expanded by BUFFER_MINUTES on each side).
 */
function hasConflict(calendar, startTime, endTime) {
  const bufferedStart = new Date(startTime.getTime() - BUFFER_MINUTES * 60000);
  const bufferedEnd = new Date(endTime.getTime() + BUFFER_MINUTES * 60000);
  const existingEvents = calendar.getEvents(bufferedStart, bufferedEnd);
  return existingEvents.length > 0;
}

/**
 * Handles GET requests. With no query params, acts as a simple health
 * check. With ?date=YYYY-MM-DD, returns that day's available time slots
 * for the website's booking calendar to render.
 */
function doGet(e) {
  const dateParam = e && e.parameter && e.parameter.date;
  if (dateParam) {
    const durationParam = e.parameter.duration ? parseInt(e.parameter.duration, 10) : LESSON_DURATION_MINUTES;
    return jsonResponse(getAvailability(dateParam, durationParam));
  }
  return ContentService.createTextOutput(
    `${BUSINESS_NAME} booking endpoint is running.`
  ).setMimeType(ContentService.MimeType.TEXT);
}

/**
 * Returns the list of bookable time slots for a given date and lesson
 * duration, each flagged available or not, based on business hours and
 * existing calendar events. A longer duration means fewer slots fit before
 * closing, and a single existing booking blocks a wider range of start
 * times (their windows overlap more).
 */
function getAvailability(dateStr, durationMinutes) {
  const duration = ALLOWED_DURATIONS_MINUTES.includes(durationMinutes) ? durationMinutes : LESSON_DURATION_MINUTES;

  const date = new Date(`${dateStr}T00:00:00`);
  if (isNaN(date.getTime())) {
    return { status: "error", message: "Invalid date." };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const maxDate = new Date(today.getTime() + BOOKING_WINDOW_DAYS * 86400000);
  if (date < today || date > maxDate) {
    return { status: "success", date: dateStr, duration: duration, slots: [] };
  }

  const hours = BUSINESS_HOURS[date.getDay()];
  if (!hours) {
    return { status: "success", date: dateStr, duration: duration, slots: [] };
  }

  const calendar = CalendarApp.getCalendarById(
    CALENDAR_ID === "primary" ? CalendarApp.getDefaultCalendar().getId() : CALENDAR_ID
  );
  const earliestStart = new Date(Date.now() + MIN_NOTICE_HOURS * 3600000);
  const [openHour, closeHour] = hours;
  const slots = [];

  for (
    let minutes = openHour * 60;
    minutes + duration <= closeHour * 60;
    minutes += SLOT_INTERVAL_MINUTES
  ) {
    const slotStart = new Date(date);
    slotStart.setHours(0, minutes, 0, 0);
    if (slotStart < earliestStart) continue;

    const slotEnd = new Date(slotStart.getTime() + duration * 60000);
    slots.push({
      time: Utilities.formatDate(slotStart, Session.getScriptTimeZone(), "HH:mm"),
      label: formatTime(slotStart),
      available: !hasConflict(calendar, slotStart, slotEnd),
    });
  }

  return { status: "success", date: dateStr, duration: duration, slots: slots };
}

/**
 * Appends one row to the customer log spreadsheet, if configured. Never
 * throws — a logging problem should never stop a booking or confirmation
 * email from going through. Creates the tab and header row on first use.
 */
function logBookingToSheet(row) {
  if (!CUSTOMER_LOG_SHEET_ID || CUSTOMER_LOG_SHEET_ID === "PASTE_YOUR_GOOGLE_SHEET_ID_HERE") return;

  try {
    const spreadsheet = SpreadsheetApp.openById(CUSTOMER_LOG_SHEET_ID);
    let sheet = spreadsheet.getSheetByName(CUSTOMER_LOG_SHEET_TAB_NAME);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(CUSTOMER_LOG_SHEET_TAB_NAME);
    }
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        "Logged At",
        "Full Name",
        "Email",
        "Phone",
        "Lesson Type",
        "Test Date",
        "Lesson Date",
        "Lesson Time",
        "Duration (min)",
        "Notes",
        "Source",
      ]);
    }
    sheet.appendRow([
      new Date(),
      row.fullName || "",
      row.email || "",
      row.phone || "",
      row.lessonType || "",
      row.testDate || "",
      row.lessonDate || "",
      row.lessonTime || "",
      row.duration || "",
      row.notes || "",
      row.source || "",
    ]);
  } catch (err) {
    // Never let a spreadsheet hiccup surface to the customer or block a
    // booking — but do log it, so the cause is visible in Apps Script's
    // Executions view (left sidebar → clock icon) instead of failing silently.
    console.error("logBookingToSheet failed: " + err.message);
  }
}

function sendCustomerConfirmation(data, bookings, duration) {
  const multi = bookings.length > 1;
  const subject = multi
    ? `${bookings.length} bookings received — ${BUSINESS_NAME}`
    : `Booking received — ${BUSINESS_NAME}`;

  const scheduleLines = bookings
    .map(({ startTime, endTime }) => `  ${formatDate(startTime)}: ${formatTime(startTime)} – ${formatTime(endTime)}`)
    .join("\n");

  const body = `Hi ${data.fullName},

Thanks for booking with ${BUSINESS_NAME}!

Here's what we've got:
  Lesson type: ${data.lessonType}
  Duration: ${duration} minutes${multi ? ` (${bookings.length} lessons)` : ""}${data.testDate ? `\n  Test date: ${data.testDate}` : ""}
${scheduleLines}

We'll be in touch if we need to adjust anything. If you need to reschedule
or cancel, just call us on 0420 655 620.

See you then!
${BUSINESS_NAME}`;

  MailApp.sendEmail(data.email, subject, body);
}

function sendOwnerNotification(data, bookings, duration, eventIds) {
  const multi = bookings.length > 1;
  const first = bookings[0];
  const subject = multi
    ? `New bookings: ${data.fullName} — ${bookings.length} days from ${formatDate(first.startTime)}`
    : `New booking: ${data.fullName} — ${formatDate(first.startTime)}`;

  const scheduleLines = bookings
    .map(({ startTime, endTime }) => `  ${formatDate(startTime)}: ${formatTime(startTime)} – ${formatTime(endTime)}`)
    .join("\n");

  const body = `New booking request received from the website:

  Name: ${data.fullName}
  Email: ${data.email}
  Phone: ${data.phone}
  Lesson type: ${data.lessonType}
  Duration: ${duration} minutes${data.testDate ? `\n  Test date: ${data.testDate}` : ""}
${scheduleLines}
  Notes: ${data.message || "—"}

This has been added to the calendar automatically (event ID${eventIds.length > 1 ? "s" : ""}: ${eventIds.join(", ")}).`;

  MailApp.sendEmail(OWNER_EMAIL, subject, body);
}

/**
 * Run automatically every 15 minutes (see setupTriggers). Scans upcoming
 * calendar events for any that haven't been confirmation-emailed yet —
 * this is how a lesson Vijay books by phone and types straight into the
 * calendar still gets the customer a "Thanks for booking" email, without
 * him having to do anything extra.
 */
function sendConfirmationsForNewBookings() {
  const calendar = CalendarApp.getCalendarById(
    CALENDAR_ID === "primary" ? CalendarApp.getDefaultCalendar().getId() : CALENDAR_ID
  );
  const start = new Date();
  const end = new Date(Date.now() + CONFIRMATION_SCAN_WINDOW_DAYS * 86400000);
  const events = calendar.getEvents(start, end);

  events.forEach((event) => {
    if (event.getTag(CONFIRMATION_SENT_TAG) === "true") return;

    getCustomerGuests(event).forEach((guest) => {
      sendManualBookingConfirmation(guest, event);
      logBookingToSheet({
        fullName: guest.getName() || "",
        email: guest.getEmail() || "",
        phone: "",
        lessonType: event.getTitle() || "",
        testDate: "",
        lessonDate: formatDate(event.getStartTime()),
        lessonTime: formatTime(event.getStartTime()),
        duration: Math.round((event.getEndTime().getTime() - event.getStartTime().getTime()) / 60000),
        notes: event.getDescription() || "",
        source: "Phone/Manual",
      });
    });
    // Tag every scanned event (even ones with no guest, e.g. Vijay
    // blocking out personal time) so it's never re-checked again.
    event.setTag(CONFIRMATION_SENT_TAG, "true");
  });
}

/**
 * Run automatically once a day (see setupTriggers). Emails a reminder to
 * anyone with a lesson exactly REMINDER_DAYS_BEFORE days from now —
 * covers both website and manually-added bookings, since it just reads
 * whatever is on the calendar.
 */
function sendUpcomingReminders() {
  const calendar = CalendarApp.getCalendarById(
    CALENDAR_ID === "primary" ? CalendarApp.getDefaultCalendar().getId() : CALENDAR_ID
  );
  const targetDate = new Date(Date.now() + REMINDER_DAYS_BEFORE * 86400000);
  const events = calendar.getEventsForDay(targetDate);

  events.forEach((event) => {
    if (event.getTag(REMINDER_SENT_TAG) === "true") return;

    const guests = getCustomerGuests(event);
    guests.forEach((guest) => sendReminderEmail(guest, event));
    if (guests.length > 0) event.setTag(REMINDER_SENT_TAG, "true");
  });
}

/** Returns the event's guests, excluding the business's own account. */
function getCustomerGuests(event) {
  const ownerEmail = OWNER_EMAIL.toLowerCase();
  return event.getGuestList().filter((guest) => guest.getEmail().toLowerCase() !== ownerEmail);
}

/** First name from a Calendar guest, falling back to a generic greeting. */
function guestFirstName(guest) {
  const name = guest.getName();
  return name ? name.split(" ")[0] : "there";
}

function sendManualBookingConfirmation(guest, event) {
  const subject = `Booking confirmed — ${BUSINESS_NAME}`;
  const title = event.getTitle();
  const body = `Hi ${guestFirstName(guest)},

Thanks for booking with ${BUSINESS_NAME}!

Here's what we've got:
${title ? `  Booking: ${title}\n` : ""}  Date: ${formatDate(event.getStartTime())}
  Time: ${formatTime(event.getStartTime())} – ${formatTime(event.getEndTime())}

We'll be in touch if we need to adjust anything. If you need to reschedule
or cancel, just call us on ${BUSINESS_PHONE}.

See you then!
${BUSINESS_NAME}`;

  MailApp.sendEmail(guest.getEmail(), subject, body);
}

function sendReminderEmail(guest, event) {
  const subject = `Reminder: your lesson is coming up — ${BUSINESS_NAME}`;
  const body = `Hi ${guestFirstName(guest)},

Just a reminder that your driving lesson with ${BUSINESS_NAME} is coming up:

  Date: ${formatDate(event.getStartTime())}
  Time: ${formatTime(event.getStartTime())} – ${formatTime(event.getEndTime())}

If you need to reschedule or cancel, please call us on ${BUSINESS_PHONE}.

See you then!
${BUSINESS_NAME}`;

  MailApp.sendEmail(guest.getEmail(), subject, body);
}

/**
 * ONE-TIME SETUP: run this function once from the Apps Script editor
 * (select "setupTriggers" from the function dropdown next to the Run
 * button, then click Run) to schedule the two functions above. Safe to
 * run again later — it clears any existing triggers for them first, so
 * it never creates duplicates.
 */
function setupTriggers() {
  ScriptApp.getProjectTriggers().forEach((trigger) => {
    const handler = trigger.getHandlerFunction();
    if (handler === "sendConfirmationsForNewBookings" || handler === "sendUpcomingReminders") {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger("sendConfirmationsForNewBookings").timeBased().everyMinutes(15).create();
  // Runs hourly rather than once a day so a same-day booking for tomorrow
  // still gets caught soon after it's made, instead of only being checked
  // once at a fixed time (which could miss it if booked after that check).
  ScriptApp.newTrigger("sendUpcomingReminders").timeBased().everyHours(1).create();
}

function formatDate(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "EEEE, d MMMM yyyy");
}

function formatTime(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "h:mm a");
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
