// Draws the world, day and night, the route and the plane on a canvas.
import { fitView, routePoints, along } from './geo.js';

let world = null;
export async function loadWorld() {
  if (!world) world = await (await fetch(new URL('../data/world.json', import.meta.url))).json();
  return world;
}

const COLORS = {
  sea0: '#0b1630',
  sea1: '#0f2142',
  land: '#1d3157',
  landEdge: 'rgba(140, 170, 220, 0.18)',
  grid: 'rgba(140, 170, 220, 0.07)',
  night: 'rgba(2, 6, 18, 0.38)',
  route: 'rgba(255, 196, 92, 0.55)',
  flown: '#ffc45c',
  city: '#ffe2a8',
};

/** Where the sun is overhead right now (degrees). */
export function subsolar(date) {
  const day = (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 864e5;
  const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (day + 10));
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60;
  return { lat: decl, lon: -(hours - 12) * 15 };
}

function setup(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}

function drawBase(g, w, h, view, date) {
  const sea = g.createLinearGradient(0, 0, 0, h);
  sea.addColorStop(0, COLORS.sea1);
  sea.addColorStop(1, COLORS.sea0);
  g.fillStyle = sea;
  g.fillRect(0, 0, w, h);

  // Graticule every 15°.
  g.strokeStyle = COLORS.grid;
  g.lineWidth = 1;
  g.beginPath();
  for (let lon = -180; lon <= 180; lon += 15) {
    for (const shift of [-360, 0, 360]) {
      const [x] = view.project(0, lon + shift);
      if (x < -2 || x > w + 2) continue;
      g.moveTo(x, 0);
      g.lineTo(x, h);
    }
  }
  for (let lat = -75; lat <= 75; lat += 15) {
    const [, y] = view.project(lat, view.cx);
    g.moveTo(0, y);
    g.lineTo(w, y);
  }
  g.stroke();

  // Countries, drawn three times across so the view can wrap anywhere.
  if (world) {
    g.fillStyle = COLORS.land;
    g.strokeStyle = COLORS.landEdge;
    g.lineWidth = 0.7;
    for (const shift of [-360, 0, 360]) {
      g.beginPath();
      for (const f of world.features) {
        const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        for (const poly of polys) {
          for (const ring of poly) {
            ring.forEach(([lon, lat], i) => {
              const L = lon + shift;
              const x = ((L - view.cx) / view.k) + w / 2;
              const y = ((view.cy - lat) / view.k) + h / 2;
              if (i === 0) g.moveTo(x, y);
              else g.lineTo(x, y);
            });
            g.closePath();
          }
        }
      }
      g.fill();
      g.stroke();
    }
  }

  // Night side: the terminator line, then everything on the dark side of it.
  const sun = subsolar(date);
  const tanD = Math.tan((sun.lat * Math.PI) / 180) || 1e-6;
  g.fillStyle = COLORS.night;
  g.beginPath();
  const nightBelow = sun.lat > 0; // in northern summer the night cap sits to the south
  for (let px = 0; px <= w; px += 4) {
    const lon = view.cx + (px - w / 2) * view.k;
    const lat = (Math.atan(-Math.cos(((lon - sun.lon) * Math.PI) / 180) / tanD) * 180) / Math.PI;
    const [, y] = view.project(lat, lon);
    if (px === 0) g.moveTo(px, y);
    else g.lineTo(px, y);
  }
  g.lineTo(w, nightBelow ? h * 4 : -h * 3);
  g.lineTo(0, nightBelow ? h * 4 : -h * 3);
  g.closePath();
  g.fill();
}

function city(g, x, y, label, align = 'left') {
  g.fillStyle = COLORS.city;
  g.beginPath();
  g.arc(x, y, 4, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255, 226, 168, 0.35)';
  g.lineWidth = 6;
  g.beginPath();
  g.arc(x, y, 9, 0, Math.PI * 2);
  g.stroke();
  g.font = '600 13px system-ui, -apple-system, "Segoe UI", sans-serif';
  g.fillStyle = 'rgba(255, 240, 210, 0.95)';
  g.textAlign = align;
  g.fillText(label, x + (align === 'left' ? 14 : -14), y + 4);
}

function plane(g, x, y, angle, size = 18) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.fillStyle = '#ffffff';
  g.shadowColor = 'rgba(255, 196, 92, 0.8)';
  g.shadowBlur = 14;
  const s = size / 18;
  g.scale(s, s);
  g.beginPath();
  // Pointing right (+x).
  g.moveTo(16, 0);
  g.quadraticCurveTo(14, -2, 9, -2);
  g.lineTo(2, -2);
  g.lineTo(-4, -12);
  g.lineTo(-7, -12);
  g.lineTo(-3, -2);
  g.lineTo(-10, -2);
  g.lineTo(-13, -6);
  g.lineTo(-15, -6);
  g.lineTo(-13, 0);
  g.lineTo(-15, 6);
  g.lineTo(-13, 6);
  g.lineTo(-10, 2);
  g.lineTo(-3, 2);
  g.lineTo(-7, 12);
  g.lineTo(-4, 12);
  g.lineTo(2, 2);
  g.lineTo(9, 2);
  g.quadraticCurveTo(14, 2, 16, 0);
  g.fill();
  g.restore();
}

/** Re-centres a view so the route sits in the part of the canvas the panels don't cover. */
function shifted(view, w, h, inset) {
  const room = Math.max(80, h - inset.top - inset.bottom);
  const cy = view.cy + view.k * (inset.top + room / 2 - h / 2);
  const project = (lat, lon) => {
    let L = lon;
    while (L - view.cx > 180) L -= 360;
    while (L - view.cx < -180) L += 360;
    return [(L - view.cx) / view.k + w / 2, (cy - lat) / view.k + h / 2];
  };
  return { ...view, cy, project };
}

/** The live flight: route, the part already flown, both cities and the plane. */
export function drawFlight(canvas, from, to, t, inset = { top: 0, bottom: 0 }, date = new Date()) {
  const { g, w, h } = setup(canvas);
  const pts = routePoints(from, to);
  const view = shifted(fitView(pts, w, Math.max(80, h - inset.top - inset.bottom), 0.22, 24), w, h, inset);
  drawBase(g, w, h, view, date);
  const xy = pts.map((p) => view.project(p.lat, p.lon));
  // Keep the projected line continuous too.
  for (let i = 1; i < xy.length; i++) {
    const span = 360 / view.k;
    while (xy[i][0] - xy[i - 1][0] > span / 2) xy[i][0] -= span;
    while (xy[i][0] - xy[i - 1][0] < -span / 2) xy[i][0] += span;
  }
  g.setLineDash([2, 7]);
  g.lineCap = 'round';
  g.strokeStyle = COLORS.route;
  g.lineWidth = 2.5;
  g.beginPath();
  xy.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.stroke();
  g.setLineDash([]);
  const upto = Math.max(1, Math.round(t * (xy.length - 1)));
  g.strokeStyle = COLORS.flown;
  g.lineWidth = 3;
  g.beginPath();
  xy.slice(0, upto + 1).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  const here = along(from, to, t);
  let [px, py] = view.project(here.lat, here.lon);
  const [lx] = xy[upto];
  const span = 360 / view.k;
  while (px - lx > span / 2) px -= span;
  while (px - lx < -span / 2) px += span;
  g.lineTo(px, py);
  g.stroke();
  const [sx, sy] = xy[0];
  const [ex, ey] = xy[xy.length - 1];
  city(g, sx, sy, from.city, sx > ex ? 'left' : 'right');
  city(g, ex, ey, to.city, sx > ex ? 'right' : 'left');
  const ahead = along(from, to, Math.min(1, t + 0.01));
  let [ax, ay] = view.project(ahead.lat, ahead.lon);
  while (ax - px > span / 2) ax -= span;
  while (ax - px < -span / 2) ax += span;
  const angle = t >= 0.999 ? Math.atan2(ey - xy[xy.length - 2][1], ex - xy[xy.length - 2][0]) : Math.atan2(ay - py, ax - px);
  plane(g, px, py, angle, Math.max(16, Math.min(26, w / 40)));
}

/** Every flight in the logbook on one world map. */
export function drawLog(canvas, flights, date = new Date()) {
  const { g, w, h } = setup(canvas);
  // Zoom to where you've flown, but never closer than a region of about 60°.
  const places = flights.flatMap((f) => routePoints(f.from, f.to, 12));
  const lons = places.map((p) => p.lon);
  const wide = !places.length || Math.max(...lons) - Math.min(...lons) > 200;
  const view = wide ? fitView([{ lat: 78, lon: -170 }, { lat: -58, lon: 190 }], w, h, 0, 30) : fitView(places, w, h, 0.25, 60);
  drawBase(g, w, h, view, date);
  g.lineCap = 'round';
  for (const f of flights) {
    const pts = routePoints(f.from, f.to, 48);
    g.strokeStyle = f.status === 'landed' ? 'rgba(255, 196, 92, 0.75)' : 'rgba(255, 140, 120, 0.7)';
    g.lineWidth = 2;
    g.beginPath();
    let last = null;
    for (const p of pts) {
      const [x, y] = view.project(p.lat, p.lon);
      if (last && Math.abs(x - last) > w / 2) g.moveTo(x, y);
      else if (last === null) g.moveTo(x, y);
      else g.lineTo(x, y);
      last = x;
    }
    g.stroke();
  }
  g.fillStyle = COLORS.city;
  const seen = new Set();
  for (const f of flights) {
    for (const a of [f.from, f.to]) {
      if (seen.has(a.iata)) continue;
      seen.add(a.iata);
      const [x, y] = view.project(a.lat, a.lon);
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fill();
    }
  }
}
