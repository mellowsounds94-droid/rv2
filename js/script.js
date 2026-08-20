/* =========================================================
   CONFIG — update these two values when you deploy
   ========================================================= */
// Paste the Web App URL you get after deploying the Google Apps
// Script (see google-apps-script/Code.gs + SETUP-GUIDE.md).
const BOOKING_ENDPOINT = "https://script.google.com/macros/s/AKfycbwQM1O71dI7eHFTEgLh0XL-CMViZKrlpgt_wQdGnlpgjbj44hP79YQaN2rneN6fipSt/exec";

// Placeholder owner email — swap for the real school owner email.
const OWNER_EMAIL = "rv2learners@gmail.com";

// How many days ahead the date picker allows — keep in sync with
// BOOKING_WINDOW_DAYS in google-apps-script/Code.gs.
const BOOKING_WINDOW_DAYS = 28;

// Phone number shown when customers should call instead of booking online.
const BUSINESS_PHONE = "0420 655 620";

/* ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  setYear();
  setupMobileNav();
    setupTestimonialScroller();
  setupBookingForm();
  setMinBookingDate();
  setupSlotPicker();
  setupRepeatToggle();
  setupTestDateToggle();
  setupServiceCards();
});

function setYear() {
  const el = document.getElementById("year");
  if (el) el.textContent = new Date().getFullYear();
}

function setupMobileNav() {
  const header = document.getElementById("header");
  const toggle = document.getElementById("navToggle");
  const nav = document.getElementById("nav");
  if (!toggle || !nav || !header) return;

  toggle.addEventListener("click", () => {
    header.classList.toggle("nav-open");
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => header.classList.remove("nav-open"));
  });
}

/**
 * Turns the site into a single-section "slide" experience: only one
 * page (home / about / services / testimonials / booking /
 * contact) is visible at a time, and clicking a nav link cross-fades
 * from the current page to the next instead of scrolling there.
 * Elements opt in via a shared data-page="..." attribute; some pages
 * are made of more than one element (e.g. "about" bundles the About Us
 * section together with Meet Your Instructor).
 */
/**
 * Makes each service card in the Services section expandable — clicking
 * (or pressing Enter/Space) reveals who the course is for, what's covered,
 * and how long it typically takes.
 */
function setupServiceCards() {
  document.querySelectorAll(".service-card").forEach((card) => {
    card.addEventListener("click", () => toggleServiceCard(card));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleServiceCard(card);
      }
    });
  });

  function toggleServiceCard(card) {
    const isOpen = card.classList.toggle("open");
    card.setAttribute("aria-expanded", isOpen ? "true" : "false");
  }
}

function setupTestimonialScroller() {
  const track = document.getElementById("testimonialTrack");
  const prev = document.getElementById("testimonialPrev");
  const next = document.getElementById("testimonialNext");
  if (!track || !prev || !next) return;

  const scrollAmount = () => track.clientWidth * 0.8;

  prev.addEventListener("click", () => {
    track.scrollBy({ left: -scrollAmount(), behavior: "smooth" });
  });
  next.addEventListener("click", () => {
    track.scrollBy({ left: scrollAmount(), behavior: "smooth" });
  });
}

function setMinBookingDate() {
  const dateInput = document.getElementById("date");
  if (!dateInput) return;
  const today = new Date();
  const max = new Date(today.getTime() + BOOKING_WINDOW_DAYS * 86400000);
  dateInput.setAttribute("min", today.toISOString().split("T")[0]);
  dateInput.setAttribute("max", max.toISOString().split("T")[0]);
}

/**
 * Wires up the date input so that choosing a date fetches that day's
 * availability from the Apps Script backend and populates the time
 * dropdown — booked times are shown but disabled, so customers can't
 * accidentally pick one, instead of finding out only at submit time.
 */
function setupSlotPicker() {
  const dateInput = document.getElementById("date");
  const timeSelect = document.getElementById("time");
  const durationSelect = document.getElementById("duration");
  if (!dateInput || !timeSelect) return;

  dateInput.addEventListener("change", () => loadSlots(dateInput.value));

  // Availability depends on lesson length too — a 2-hour lesson needs a
  // bigger free window than a 1-hour one — so switching duration re-checks.
  if (durationSelect) {
    durationSelect.addEventListener("change", () => loadSlots(dateInput.value));
  }

  // Exposed so the booking form handler can refresh the dropdown after a
  // successful booking or a last-second conflict (the slot just changed).
  timeSelect.reload = () => loadSlots(dateInput.value);

  async function loadSlots(dateStr) {
    if (!dateStr) {
      setPlaceholder("Choose a date first");
      return;
    }

    if (BOOKING_ENDPOINT === "YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE") {
      setPlaceholder(`Call ${BUSINESS_PHONE} to book — online booking isn't connected yet`);
      return;
    }

    setPlaceholder("Loading available times…");

    const duration = durationSelect ? durationSelect.value : "60";

    try {
      const response = await fetch(
        `${BOOKING_ENDPOINT}?date=${encodeURIComponent(dateStr)}&duration=${encodeURIComponent(duration)}`
      );
      const result = await response.json();

      if (result.status !== "success") {
        throw new Error(result.message || "Failed to load availability.");
      }
      renderSlots(result.slots || []);
    } catch (err) {
      console.error(err);
      setPlaceholder(`Couldn't load availability — call ${BUSINESS_PHONE} or try again`);
    }
  }

  function setPlaceholder(text) {
    timeSelect.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "";
    opt.disabled = true;
    opt.selected = true;
    opt.textContent = text;
    timeSelect.appendChild(opt);
    timeSelect.disabled = true;
  }

  function renderSlots(slots) {
    if (slots.length === 0) {
      setPlaceholder("No lessons run on this day — choose another date");
      return;
    }

    const anyAvailable = slots.some((slot) => slot.available);

    timeSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.textContent = anyAvailable
      ? "Select a time"
      : `No availability on this date — please call ${BUSINESS_PHONE}`;
    timeSelect.appendChild(placeholder);

    slots.forEach((slot) => {
      const opt = document.createElement("option");
      opt.value = slot.time;
      opt.textContent = slot.available ? slot.label : `${slot.label} — booked`;
      opt.disabled = !slot.available;
      timeSelect.appendChild(opt);
    });

    timeSelect.disabled = !anyAvailable;
  }
}

/**
 * Shows/hides the "how many days" selector based on the repeat checkbox,
 * so it stays out of the way unless someone actually wants a multi-day run.
 */
function setupRepeatToggle() {
  const checkbox = document.getElementById("repeatBooking");
  const row = document.getElementById("repeatDaysRow");
  if (!checkbox || !row) return;

  checkbox.addEventListener("change", () => {
    row.hidden = !checkbox.checked;
  });
}

/**
 * Shows the optional "when is your test?" field only for Test Day Support
 * bookings, since it's irrelevant for every other lesson type.
 */
function setupTestDateToggle() {
  const lessonType = document.getElementById("lessonType");
  const row = document.getElementById("testDateRow");
  if (!lessonType || !row) return;

  const sync = () => {
    row.hidden = lessonType.value !== "Test Day Support";
  };
  lessonType.addEventListener("change", sync);
  sync();
}

function setupBookingForm() {
  const form = document.getElementById("bookingForm");
  const status = document.getElementById("formStatus");
  const submitBtn = document.getElementById("bookingSubmit");
  if (!form || !status) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const repeatChecked = form.repeatBooking && form.repeatBooking.checked;

    const data = {
      fullName: form.fullName.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      address: form.address ? form.address.value.trim() : '',
      lessonType: form.lessonType.value,
      duration: form.duration ? form.duration.value : "60",
      testDate: form.testDate ? form.testDate.value : "",
      date: form.date.value,
      time: form.time.value,
      message: form.message.value.trim(),
      repeatDays: repeatChecked ? form.repeatDays.value : "1",
    };

    if (!data.fullName || !data.email || !data.phone || !data.lessonType || !data.date || !data.time) {
      showStatus("Please fill in all required fields.", "error");
      return;
    }

    if (BOOKING_ENDPOINT === "YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE") {
      showStatus(
        `Booking system isn't connected yet. Once the Google Apps Script Web App URL is added in js/script.js, this form will book directly into the calendar. For now, please call ${BUSINESS_PHONE}.`,
        "error"
      );
      return;
    }

    submitBtn.disabled = true;
    showStatus("Sending your booking request…", "loading");

    try {
      // Content-Type "text/plain" keeps this a CORS "simple request" (no
      // preflight), and Apps Script web apps deployed with "Anyone" access
      // return a readable response for simple requests — so we can read
      // the JSON body back and tell success apart from a booking conflict.
      const response = await fetch(BOOKING_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(data),
      });
      const result = await response.json();

      if (result.status === "success") {
        const days = parseInt(data.repeatDays, 10) || 1;
        const summary = days > 1 ? `All ${days} lessons are confirmed` : "Your booking is confirmed";
        showStatus(
          `Thanks ${data.fullName.split(" ")[0]}! ${summary}. You'll get an email confirmation at ${data.email} shortly.`,
          "success"
        );
        form.reset();
        setMinBookingDate();
        const repeatDaysRow = document.getElementById("repeatDaysRow");
        if (repeatDaysRow) repeatDaysRow.hidden = true;
        const testDateRow = document.getElementById("testDateRow");
        if (testDateRow) testDateRow.hidden = true;
        refreshSlotPicker();
      } else if (result.status === "conflict") {
        showStatus(
          result.message || `That time is already booked. Please choose a different time, or call us on ${BUSINESS_PHONE}.`,
          "error"
        );
        // Someone else just took this slot — refresh so it shows as taken
        // and the customer can't submit it again.
        refreshSlotPicker();
      } else {
        showStatus(
          result.message || `Something went wrong sending your request. Please call ${BUSINESS_PHONE} or try again.`,
          "error"
        );
      }
    } catch (err) {
      console.error(err);
      showStatus(
        `Couldn't confirm your booking — this can happen if the browser blocks reading the response. Please call ${BUSINESS_PHONE} to confirm, or try again.`,
        "error"
      );
    } finally {
      submitBtn.disabled = false;
    }
  });

  function refreshSlotPicker() {
    const timeSelect = document.getElementById("time");
    if (timeSelect && typeof timeSelect.reload === "function") timeSelect.reload();
  }

  function showStatus(message, type) {
    status.textContent = message;
    status.className = `form-status ${type}`;
  }
}
