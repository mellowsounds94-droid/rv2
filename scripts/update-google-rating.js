#!/usr/bin/env node
// Fetches the current Google rating + review count for the business via the
// Places API (New) Text Search endpoint, and updates the numbers baked into
// index.html (JSON-LD AggregateRating + the two visible rating badges +
// the trust-strip badge).
//
// Requires a GOOGLE_PLACES_API_KEY env var, with "Places API (New)" enabled
// on that key in Google Cloud Console.

const fs = require('fs');
const path = require('path');

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const BUSINESS_QUERY = 'Right Vehicle To Learners Driving School, 77 Narrami Rd, Austral NSW 2179';
const INDEX_PATH = path.join(__dirname, '..', 'index.html');

async function fetchRating() {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.rating,places.userRatingCount',
    },
    body: JSON.stringify({ textQuery: BUSINESS_QUERY }),
  });

  if (!res.ok) {
    throw new Error(`Places API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const place = data.places && data.places[0];
  if (!place || typeof place.rating !== 'number' || typeof place.userRatingCount !== 'number') {
    throw new Error(`Unexpected Places API response: ${JSON.stringify(data)}`);
  }

  return { rating: place.rating.toFixed(1), count: String(place.userRatingCount) };
}

function updateIndexHtml(rating, count) {
  let html = fs.readFileSync(INDEX_PATH, 'utf8');
  let changed = false;

  const replacements = [
    [/"ratingValue":\s*"[\d.]+"/, `"ratingValue": "${rating}"`],
    [/"reviewCount":\s*"\d+"/, `"reviewCount": "${count}"`],
    [/(<span><strong>)[\d.]+(<\/strong> average rating on Google<\/span>)/, `$1${rating}$2`],
    [/(<div class="contact-detail"><span>★<\/span><p>)[\d.]+( average rating on Google<\/p><\/div>)/, `$1${rating}$2`],
    [/(<div class="trust-item"><strong>)[\d.]+(★<\/strong><span>Average Rating<\/span><\/div>)/, `$1${rating}$2`],
  ];

  for (const [pattern, replacement] of replacements) {
    if (!pattern.test(html)) {
      throw new Error(`Pattern not found in index.html: ${pattern}`);
    }
    const next = html.replace(pattern, replacement);
    if (next !== html) changed = true;
    html = next;
  }

  fs.writeFileSync(INDEX_PATH, html);
  return changed;
}

(async () => {
  if (!API_KEY) {
    console.error('GOOGLE_PLACES_API_KEY is not set.');
    process.exit(1);
  }

  const { rating, count } = await fetchRating();
  console.log(`Fetched rating=${rating} reviewCount=${count}`);

  const changed = updateIndexHtml(rating, count);
  console.log(changed ? 'index.html updated.' : 'No change - already up to date.');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
