const AircraftIcons = {
  svgs: {
    "fixed-wing": `<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>
    </svg>`,
    rotorcraft: `<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 6h18v2H3V6zm2 4h14l-1 8H6l-1-8zm7-8 2 3h-4l2-3z"/>
      <rect x="10" y="10" width="4" height="6" rx="1"/>
    </svg>`,
    glider: `<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 14l10-4 10 4-10 2-10-2zm10-6 8 3-8 3-8-3 8-3z"/>
      <path d="M12 8v8" stroke="currentColor" stroke-width="1.5"/>
    </svg>`,
    "lighter-than-air": `<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
      <ellipse cx="12" cy="10" rx="8" ry="10"/>
      <path d="M12 20v3M9 23h6" stroke="currentColor" stroke-width="1.5" fill="none"/>
    </svg>`,
  },

  createIcon(category, color, heading, selected) {
    const svg = this.svgs[category] || this.svgs["fixed-wing"];
    const size = selected ? 36 : 28;
    const rotation = Number.isFinite(heading) ? heading : 0;

    return L.divIcon({
      className: `aircraft-marker${selected ? " selected" : ""}`,
      html: `<div style="color:${color};transform:rotate(${rotation}deg);width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;">${svg.replace(/width="28" height="28"/, `width="${size}" height="${size}"`)}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  },
};
