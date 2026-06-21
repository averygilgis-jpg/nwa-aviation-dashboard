const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { enrichRoutes } = require("./routes");

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");

const CENTER = { lat: 36.332, lon: -94.118, zip: "72758" };
const RADIUS_MILES = 150;
const RADIUS_KM = RADIUS_MILES * 1.60934;
const REFRESH_MS = 60_000;

const COLORS = ["#00E5FF", "#76FF03", "#FFEA00", "#FF9100", "#E040FB", "#FF4081"];

const AIRLINE_PREFIXES = {
  AAL: "American Airlines",
  AAW: "American Airlines",
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
  CPZ: "Compass Airlines",
  FDX: "FedEx",
  UPS: "UPS Airlines",
  ATN: "Air Transport International",
  AAY: "Allegiant Air",
  HAL: "Hawaiian Airlines",
  BAW: "British Airways",
  AFR: "Air France",
  DLH: "Lufthansa",
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
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseAirline(callsign) {
  if (!callsign || callsign === "N/A") return "Unknown";
  const prefix = callsign.replace(/[^A-Za-z].*$/, "").toUpperCase();
  if (prefix.length >= 3 && AIRLINE_PREFIXES[prefix.slice(0, 3)]) {
    return AIRLINE_PREFIXES[prefix.slice(0, 3)];
  }
  return "Unknown";
}

function normalizeCallsign(raw) {
  if (!raw || typeof raw !== "string") return "N/A";
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : "N/A";
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

function msToMph(ms) {
  return Math.round(ms * 2.23694);
}

function isOnGround(ac) {
  if (ac.alt_baro === "ground") return true;
  if (ac.ground === true) return true;
  if (ac.on_ground === true) return true;
  return false;
}

function hasValidPosition(ac) {
  const lat = Number(ac.lat);
  const lon = Number(ac.lon);
  return Number.isFinite(lat) && Number.isFinite(lon);
}

function speedMphFromAdsb(ac) {
  if (isOnGround(ac)) return 0;
  if (Number.isFinite(ac.gs)) return knotsToMph(ac.gs);
  if (Number.isFinite(ac.speed)) return knotsToMph(ac.speed);
  return 0;
}

function speedMphFromOpenSky(state) {
  const onGround = state[8];
  if (onGround) return 0;
  const velocity = state[9];
  if (Number.isFinite(velocity)) return msToMph(velocity);
  return 0;
}

function transformAdsbAircraft(ac) {
  if (!hasValidPosition(ac)) return null;

  const lat = Number(ac.lat);
  const lon = Number(ac.lon);
  const distanceMi = haversineMiles(CENTER.lat, CENTER.lon, lat, lon);
  if (distanceMi > RADIUS_MILES) return null;

  const icao24 = (ac.hex || ac.icao24 || "").toLowerCase();
  if (!icao24) return null;

  const callsign = normalizeCallsign(ac.flight || ac.callsign);
  const type = (ac.t || ac.type || "").trim() || "Unknown";

  return {
    icao24,
    callsign,
    airline: parseAirline(callsign),
    origin: "UNK",
    destination: "UNK",
    type,
    speedMph: speedMphFromAdsb(ac),
    lat,
    lon,
    distanceMi: Math.round(distanceMi * 10) / 10,
    category: mapCategory(ac.category),
    color: hashColor(icao24),
    heading: Number.isFinite(ac.track) ? ac.track : Number.isFinite(ac.true_track) ? ac.true_track : 0,
  };
}

function transformOpenSkyState(state) {
  const lat = state[6];
  const lon = state[5];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const distanceMi = haversineMiles(CENTER.lat, CENTER.lon, lat, lon);
  if (distanceMi > RADIUS_MILES) return null;

  const icao24 = (state[0] || "").toLowerCase();
  if (!icao24) return null;

  const callsign = normalizeCallsign(state[1]);
  const category = state.length > 17 ? mapCategory(state[17]) : "fixed-wing";

  return {
    icao24,
    callsign,
    airline: parseAirline(callsign),
    origin: "UNK",
    destination: "UNK",
    type: "Unknown",
    speedMph: speedMphFromOpenSky(state),
    lat,
    lon,
    distanceMi: Math.round(distanceMi * 10) / 10,
    category,
    color: hashColor(icao24),
    heading: Number.isFinite(state[10]) ? state[10] : 0,
  };
}

async function fetchFromAdsbLol() {
  const url = `https://api.adsb.lol/v2/lat/${CENTER.lat}/lon/${CENTER.lon}/dist/${Math.round(RADIUS_KM)}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "nwa-aviation-dashboard/1.0" },
  });
  if (!res.ok) throw new Error(`adsb.lol responded with ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : data.ac || data.aircraft || [];
  return list.map(transformAdsbAircraft).filter(Boolean);
}

async function fetchFromOpenSky() {
  const latDelta = RADIUS_MILES / 69;
  const lonDelta = RADIUS_MILES / (69 * Math.cos((CENTER.lat * Math.PI) / 180));
  const params = new URLSearchParams({
    lamin: String(CENTER.lat - latDelta),
    lomin: String(CENTER.lon - lonDelta),
    lamax: String(CENTER.lat + latDelta),
    lomax: String(CENTER.lon + lonDelta),
  });

  const headers = { Accept: "application/json", "User-Agent": "nwa-aviation-dashboard/1.0" };
  if (process.env.OPENSKY_USERNAME && process.env.OPENSKY_PASSWORD) {
    const token = Buffer.from(
      `${process.env.OPENSKY_USERNAME}:${process.env.OPENSKY_PASSWORD}`
    ).toString("base64");
    headers.Authorization = `Basic ${token}`;
  }

  const res = await fetch(`https://opensky-network.org/api/states/all?${params}`, { headers });
  if (!res.ok) throw new Error(`OpenSky responded with ${res.status}`);
  const data = await res.json();
  return (data.states || []).map(transformOpenSkyState).filter(Boolean);
}

async function refreshAircraft() {
  try {
    let aircraft;
    try {
      aircraft = await fetchFromAdsbLol();
    } catch (adsbErr) {
      console.warn("adsb.lol unavailable, falling back to OpenSky:", adsbErr.message);
      aircraft = await fetchFromOpenSky();
    }

    await enrichRoutes(aircraft);

    aircraft.sort((a, b) => a.distanceMi - b.distanceMi);
    cache = { updatedAt: new Date().toISOString(), aircraft, error: null };
    const routed = aircraft.filter((a) => a.origin !== "UNK" || a.destination !== "UNK").length;
    console.log(
      `[${cache.updatedAt}] ${aircraft.length} aircraft (${routed} with routes) within ${RADIUS_MILES} mi`
    );
  } catch (err) {
    cache.error = err.message;
    console.error("Refresh failed:", err.message);
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function serveStatic(req, res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === "ENOENT" ? 404 : 500);
      res.end(err.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/api/aircraft") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(cache));
    return;
  }

  let filePath = path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  serveStatic(req, res, filePath);
});

refreshAircraft();
setInterval(refreshAircraft, REFRESH_MS);

server.listen(PORT, () => {
  console.log(`NWA Aviation Dashboard running at http://localhost:${PORT}`);
  console.log(`Center: ${CENTER.zip} (${CENTER.lat}, ${CENTER.lon}), radius: ${RADIUS_MILES} mi`);
});
