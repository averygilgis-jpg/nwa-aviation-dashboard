const express = require("express");
const path = require("path");
const { enrichRoutes } = require("./routes");

const app = express();

const PORT = process.env.PORT || 3000;

const CENTER = { lat: 36.332, lon: -94.118, zip: "72758" };
const RADIUS_MILES = 150;
const RADIUS_KM = RADIUS_MILES * 1.60934;
const REFRESH_MS = 60_000;

const COLORS = ["#00E5FF", "#76FF03", "#FFEA00", "#FF9100", "#E040FB", "#FF4081"];

const AIRLINE_PREFIXES = {
  AAL: "American Airlines",
  DAL: "Delta Air Lines",
  SWA: "Southwest Airlines",
  UAL: "United Airlines",
  ASA: "Alaska Airlines",
  JBU: "JetBlue Airways",
  FFT: "Frontier Airlines",
  NKS: "Spirit Airlines",
  SKW: "SkyWest Airlines",
  RPA: "Republic Airways",
  EDV: "Endeavor Air",
  ENY: "Envoy Air",
  GJS: "GoJet Airlines",
  FDX: "FedEx",
  UPS: "UPS Airlines",
  AAY: "Allegiant Air",
};

let cache = { updatedAt: null, aircraft: [], error: null };

function hashColor(icao24) {
  let hash = 0;
  for (let i = 0; i < icao24.length; i++) {
    hash = (hash * 31 + icao24.charCodeAt(i)) >>> 0;
  }
  return COLORS[hash % COLORS.length];
}

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeCallsign(raw) {
  if (!raw || typeof raw !== "string") return "N/A";
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : "N/A";
}

function parseAirline(callsign) {
  if (!callsign || callsign === "N/A") return "Unknown";
  const prefix = callsign.replace(/[^A-Za-z].*$/, "").toUpperCase();
  return AIRLINE_PREFIXES[prefix.slice(0, 3)] || "Unknown";
}

function mapCategory(rawCategory) {
  const cat = Number(rawCategory);
  if (cat === 8) return "rotorcraft";
  if (cat === 9) return "glider";
  if (cat === 10) return "lighter-than-air";
  return "fixed-wing";
}

function knotsToMph(knots) {
  return Math.round(knots * 1.15078);
}

function isOnGround(ac) {
  return ac.alt_baro === "ground" || ac.ground === true || ac.on_ground === true;
}

function speedMphFromAdsb(ac) {
  if (isOnGround(ac)) return 0;
  if (Number.isFinite(ac.gs)) return knotsToMph(ac.gs);
  if (Number.isFinite(ac.speed)) return knotsToMph(ac.speed);
  return 0;
}

function hasValidPosition(ac) {
  return Number.isFinite(Number(ac.lat)) && Number.isFinite(Number(ac.lon));
}

function transformAdsbAircraft(ac) {
  if (!hasValidPosition(ac)) return null;

  const lat = Number(ac.lat);
  const lon = Number(ac.lon);

  const distanceMi = haversineMiles(CENTER.lat, CENTER.lon, lat, lon);
  if (distanceMi > RADIUS_MILES) return null;

  const icao24 = (ac.hex || ac.icao24 || "").toLowerCase();
  if (!icao24) return null;

  return {
    icao24,
    callsign: normalizeCallsign(ac.flight || ac.callsign),
    airline: parseAirline(ac.flight || ac.callsign),
    origin: "UNK",
    destination: "UNK",
    type: (ac.t || ac.type || "").trim() || "Unknown",
    speedMph: speedMphFromAdsb(ac),
    lat,
    lon,
    distanceMi: Math.round(distanceMi * 10) / 10,
    category: mapCategory(ac.category),
    color: hashColor(icao24),
    heading: Number.isFinite(ac.track) ? ac.track : 0,
  };
}

async function fetchFromAdsbLol() {
  const url = `https://api.adsb.lol/v2/lat/${CENTER.lat}/lon/${CENTER.lon}/dist/${Math.round(
    RADIUS_KM
  )}`;

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "nwa-aviation-dashboard/1.0",
    },
  });

  if (!res.ok) throw new Error("adsb.lol failed");

  const data = await res.json();
  const list = data?.ac || data?.aircraft || [];

  return list.map(transformAdsbAircraft).filter(Boolean);
}

async function refreshAircraft() {
  try {
    let aircraft = await fetchFromAdsbLol();

    await enrichRoutes(aircraft);

    aircraft.sort((a, b) => a.distanceMi - b.distanceMi);

    cache = {
      updatedAt: new Date().toISOString(),
      aircraft,
      error: null,
    };

    console.log(`[${cache.updatedAt}] ${aircraft.length} aircraft loaded`);
  } catch (err) {
    cache.error = err.message;
    console.error("Refresh failed:", err.message);
  }
}

/* =========================
   STATIC FILE SERVING
========================= */

app.use(express.static(path.join(__dirname, "public")));

/* =========================
   API
========================= */

app.get("/api/aircraft", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json(cache);
});

/* =========================
   START SERVER
========================= */

app.listen(PORT, () => {
  console.log(`NWA Aviation Dashboard running on port ${PORT}`);
  console.log(
    `Center: ${CENTER.zip} (${CENTER.lat}, ${CENTER.lon}) radius ${RADIUS_MILES} mi`
  );
});

/* =========================
   BACKGROUND REFRESH
========================= */

refreshAircraft();
setInterval(refreshAircraft, REFRESH_MS);
