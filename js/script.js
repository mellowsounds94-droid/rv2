/* =========================================================
   CONFIG — update these two values when you deploy
   ========================================================= */
// Paste the Web App URL you get after deploying the Google Apps
// Script (see google-apps-script/Code.gs + SETUP-GUIDE.md).
const BOOKING_ENDPOINT = "https://script.google.com/macros/s/AKfycbwQM1O71dI7eHFTEgLh0XL-CMViZKrlpgt_wQdGnlpgjbj44hP79YQaN2rneN6fipSt/exec";

// Placeholder owner email — swap for the real school owner email.
const OWNER_EMAIL = "rv2learners@gmail.com";

/* ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  setYear();
  setupMobileNav();
  setupTestimonialScroller();
  setupBookingForm();
  setMinBookingDate();
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
  const today = new Date().toISOString().split("T")[0];
  dateInput.setAttribute("min", today);
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
        "Booking system isn't connected yet. Once the Google Apps Script Web App URL is added in js/script.js, this form will book directly into the calendar. For now, please call 0420 655 620.",
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
      } else if (result.status === "conflict") {
        showStatus(
          result.message || "That time is already booked. Please choose a different time.",
          "error"
        );
      } else {
        showStatus(
          result.message || "Something went wrong sending your request. Please call 0420 655 620 or try again.",
          "error"
        );
      }
    } catch (err) {
      console.error(err);
      showStatus(
        "Couldn't confirm your booking — this can happen if the browser blocks reading the response. Please call 0420 655 620 to confirm, or try again.",
        "error"
      );
    } finally {
      submitBtn.disabled = false;
    }
  });

  function showStatus(message, type) {
    status.textContent = message;
    status.className = `form-status ${type}`;
  }
}
