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
 * availability from the Apps Script backend and renders it as clickable
 * time slots, instead of making customers guess a time and find out at
 * submit time whether it's taken.
 */
function setupSlotPicker() {
  const dateInput = document.getElementById("date");
  const picker = document.getElementById("slotPicker");
  const timeInput = document.getElementById("time");
  if (!dateInput || !picker || !timeInput) return;

  dateInput.addEventListener("change", () => loadSlots(dateInput.value));

  // Exposed so the booking form handler can refresh the picker after a
  // successful booking or a last-second conflict (the slot just changed).
  picker.reload = () => loadSlots(dateInput.value);

  async function loadSlots(dateStr) {
    timeInput.value = "";

    if (!dateStr) {
      picker.innerHTML = '<p class="slot-picker-hint">Choose a date above to see available times.</p>';
      return;
    }

    if (BOOKING_ENDPOINT === "YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE") {
      picker.innerHTML = `<p class="slot-picker-hint">Online availability isn't connected yet — please call ${BUSINESS_PHONE} to book.</p>`;
      return;
    }

    picker.innerHTML = '<p class="slot-picker-hint">Loading available times…</p>';

    try {
      const response = await fetch(`${BOOKING_ENDPOINT}?date=${encodeURIComponent(dateStr)}`);
      const result = await response.json();

      if (result.status !== "success") {
        throw new Error(result.message || "Failed to load availability.");
      }
      renderSlots(result.slots || []);
    } catch (err) {
      console.error(err);
      picker.innerHTML = `<p class="slot-picker-hint">Couldn't load availability. Please call ${BUSINESS_PHONE} to book, or try again.</p>`;
    }
  }

  function renderSlots(slots) {
    if (slots.length === 0) {
      picker.innerHTML = '<p class="slot-picker-hint">No lessons run on this day. Please choose another date.</p>';
      return;
    }

    const anyAvailable = slots.some((slot) => slot.available);
    if (!anyAvailable) {
      picker.innerHTML = `<p class="slot-picker-empty">Fully booked on this day. Please choose another date, or <a href="tel:${BUSINESS_PHONE.replace(/\s/g, "")}">call us on ${BUSINESS_PHONE}</a> — Vijay may be able to fit you in.</p>`;
      return;
    }

    picker.innerHTML = "";
    slots.forEach((slot) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "slot-btn";
      btn.textContent = slot.label;
      btn.disabled = !slot.available;
      btn.setAttribute("aria-pressed", "false");
      btn.addEventListener("click", () => {
        picker.querySelectorAll(".slot-btn").forEach((b) => {
          b.classList.remove("selected");
          b.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("selected");
        btn.setAttribute("aria-pressed", "true");
        timeInput.value = slot.time;
      });
      picker.appendChild(btn);
    });
  }
}

function setupBookingForm() {
  const form = document.getElementById("bookingForm");
  const status = document.getElementById("formStatus");
  const submitBtn = document.getElementById("bookingSubmit");
  if (!form || !status) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const data = {
      fullName: form.fullName.value.trim(),
      email: form.email.value.trim(),
      phone: form.phone.value.trim(),
      lessonType: form.lessonType.value,
      date: form.date.value,
      time: form.time.value,
      message: form.message.value.trim(),
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
        showStatus(
          `Thanks ${data.fullName.split(" ")[0]}! Your booking is confirmed. You'll get an email confirmation at ${data.email} shortly.`,
          "success"
        );
        form.reset();
        setMinBookingDate();
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
    const picker = document.getElementById("slotPicker");
    if (picker && typeof picker.reload === "function") picker.reload();
  }

  function showStatus(message, type) {
    status.textContent = message;
    status.className = `form-status ${type}`;
  }
}
