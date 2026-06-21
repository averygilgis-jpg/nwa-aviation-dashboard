const CENTER = [36.332, -94.118];
const INITIAL_ZOOM = 8;
const REFRESH_MS = 60_000;

const map = L.map("map", {
  center: CENTER,
  zoom: INITIAL_ZOOM,
  zoomControl: true,
  attributionControl: true,
});

L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: "abcd",
  maxZoom: 19,
}).addTo(map);

const markers = new Map();
let aircraftData = [];
let selectedId = null;

const flightListEl = document.getElementById("flight-list");
const statusEl = document.getElementById("status");

/**
 * Safe icon helper (prevents crash if icons.js fails to load)
 */
function getIcon(ac, isSelected) {
  return (window.AircraftIcons?.createIcon
    ? window.AircraftIcons.createIcon(ac.category, ac.color, ac.heading, isSelected)
    : L.divIcon({
        html: "✈️",
        iconSize: [20, 20],
        className: "fallback-icon",
      }));
}

function setSelected(icao24) {
  selectedId = icao24;

  document.querySelectorAll(".flight-row").forEach((row) => {
    row.classList.toggle("selected", row.dataset.icao === icao24);
  });

  markers.forEach((marker, id) => {
    const ac = aircraftData.find((a) => a.icao24 === id);
    if (!ac) return;

    const isSelected = id === icao24;
    marker.setIcon(getIcon(ac, isSelected));

    marker.setZIndexOffset(isSelected ? 1000 : 0);
  });
}

function scrollToRow(icao24) {
  const row = document.querySelector(`.flight-row[data-icao="${icao24}"]`);
  if (row) row.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function selectFromMap(icao24) {
  setSelected(icao24);
  scrollToRow(icao24);
}

function selectFromSidebar(icao24) {
  const ac = aircraftData.find((a) => a.icao24 === icao24);
  if (!ac) return;

  setSelected(icao24);
  map.panTo([ac.lat, ac.lon], { animate: true, duration: 0.5 });
}

function renderSidebar(aircraft) {
  if (aircraft.length === 0) {
    flightListEl.innerHTML =
      '<p class="flight-empty">No aircraft in range</p>';
    return;
  }

  flightListEl.innerHTML = aircraft
    .map(
      (ac) => `
    <article
      class="flight-row${ac.icao24 === selectedId ? " selected" : ""}"
      data-icao="${ac.icao24}"
    >
      <div class="flight-row-color" style="background:${ac.color}"></div>
      <div class="flight-row-main">
        <div class="flight-callsign">${escapeHtml(ac.callsign)}</div>
        <div class="flight-airline">${escapeHtml(ac.airline)}</div>
        <div class="flight-route">${escapeHtml(ac.origin)} → ${escapeHtml(ac.destination)}</div>
        <div class="flight-type">${escapeHtml(ac.type)}</div>
      </div>
      <div class="flight-row-meta">
        <div class="flight-speed">${ac.speedMph} mph</div>
        <div class="flight-distance">Distance from 72758: ${ac.distanceMi} mi</div>
      </div>
    </article>`
    )
    .join("");

  flightListEl.querySelectorAll(".flight-row").forEach((row) => {
    row.addEventListener("click", () =>
      selectFromSidebar(row.dataset.icao)
    );
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function updateMarkers(aircraft) {
  const incoming = new Set(aircraft.map((a) => a.icao24));

  // remove old markers
  markers.forEach((marker, id) => {
    if (!incoming.has(id)) {
      map.removeLayer(marker);
      markers.delete(id);
    }
  });

  aircraft.forEach((ac) => {
    const isSelected = ac.icao24 === selectedId;
    const icon = getIcon(ac, isSelected);

    if (markers.has(ac.icao24)) {
      const marker = markers.get(ac.icao24);
      marker.setLatLng([ac.lat, ac.lon]);
      marker.setIcon(icon);
      marker.setZIndexOffset(isSelected ? 1000 : 0);
    } else {
      const marker = L.marker([ac.lat, ac.lon], { icon }).addTo(map);
      marker.on("click", () => selectFromMap(ac.icao24));
      markers.set(ac.icao24, marker);
    }
  });

  if (selectedId && !incoming.has(selectedId)) {
    selectedId = null;
  }
}

function formatStatus(payload) {
  const count = payload.aircraft?.length ?? 0;

  const time = payload.updatedAt
    ? new Date(payload.updatedAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

  if (payload.error) {
    return `${count} aircraft · Updated ${time} · ${payload.error}`;
  }

  return `${count} aircraft · Updated ${time}`;
}

async function refresh() {
  try {
    const res = await fetch(`/api/aircraft?t=${Date.now()}`, {
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const payload = await res.json();

    aircraftData = payload.aircraft || [];

    updateMarkers(aircraftData);
    renderSidebar(aircraftData);

    statusEl.textContent = formatStatus(payload);
  } catch (err) {
    statusEl.textContent = `Unable to load aircraft data · ${err.message}`;
  }
}

function scheduleRefresh() {
  refresh().finally(() => {
    setTimeout(scheduleRefresh, REFRESH_MS);
  });
}

scheduleRefresh();

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refresh();
});

window.addEventListener("focus", refresh);
