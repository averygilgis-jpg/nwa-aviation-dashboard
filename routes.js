const ROUTE_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const UNKNOWN_CACHE_TTL_MS = 30 * 60 * 1000;

const cache = new Map();

function airportCode(airport) {
  if (!airport) return "UNK";
  if (airport.iata_code) return airport.iata_code;
  if (airport.icao_code) {
    const icao = airport.icao_code;
    if (icao.length === 4 && icao.startsWith("K")) return icao.slice(1);
    return icao;
  }
  return "UNK";
}

async function lookupRoute(callsign) {
  const key = callsign.trim().toUpperCase();
  if (!key || key === "N/A") return null;

  const cached = cache.get(key);
  if (cached) {
    const ttl = cached.unknown ? UNKNOWN_CACHE_TTL_MS : ROUTE_CACHE_TTL_MS;
    if (Date.now() - cached.at < ttl) return cached;
  }

  try {
    const res = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(key)}`, {
      headers: { Accept: "application/json", "User-Agent": "nwa-aviation-dashboard/1.0" },
    });
    if (!res.ok) return null;

    const data = await res.json();
    const fr = data?.response?.flightroute;
    if (!fr) {
      const miss = { origin: "UNK", destination: "UNK", airline: null, unknown: true, at: Date.now() };
      cache.set(key, miss);
      return miss;
    }

    const entry = {
      origin: airportCode(fr.origin),
      destination: airportCode(fr.destination),
      airline: fr.airline?.name || null,
      unknown: false,
      at: Date.now(),
    };
    cache.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

function applyRoute(ac, route) {
  if (!route) return;
  if (route.origin && route.origin !== "UNK") ac.origin = route.origin;
  if (route.destination && route.destination !== "UNK") ac.destination = route.destination;
  if (route.airline) ac.airline = route.airline;
}

function applyCachedRoute(ac) {
  const cached = cache.get(ac.callsign.trim().toUpperCase());
  if (cached) applyRoute(ac, cached);
}

async function poolMap(items, limit, fn) {
  const executing = new Set();
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    executing.add(p);
    p.finally(() => executing.delete(p));
    if (executing.size >= limit) await Promise.race(executing);
  }
  await Promise.all(executing);
}

async function enrichRoutes(aircraft, { concurrency = 10, timeoutMs = 20000 } = {}) {
  for (const ac of aircraft) applyCachedRoute(ac);

  const needsLookup = [
    ...new Set(
      aircraft
        .map((a) => a.callsign)
        .filter((c) => c && c !== "N/A")
        .map((c) => c.trim().toUpperCase())
        .filter((key) => {
          const cached = cache.get(key);
          if (!cached) return true;
          const ttl = cached.unknown ? UNKNOWN_CACHE_TTL_MS : ROUTE_CACHE_TTL_MS;
          return Date.now() - cached.at >= ttl;
        })
    ),
  ];

  if (needsLookup.length === 0) return;

  const deadline = Date.now() + timeoutMs;

  await poolMap(needsLookup, concurrency, async (callsign) => {
    if (Date.now() > deadline) return;
    const route = await lookupRoute(callsign);
    if (!route) return;
    for (const ac of aircraft) {
      if (ac.callsign.trim().toUpperCase() === callsign) applyRoute(ac, route);
    }
  });
}

module.exports = { enrichRoutes, applyCachedRoute };
