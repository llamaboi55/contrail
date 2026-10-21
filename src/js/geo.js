// Great-circle maths for flights, plus the map projection. Pure functions, tested.

const R = 6371; // km
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Distance in km along the earth's surface. */
export function distanceKm(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The point a fraction t (0..1) of the way along the great circle from a to b. */
export function along(a, b, t) {
  const φ1 = rad(a.lat), λ1 = rad(a.lon), φ2 = rad(b.lat), λ2 = rad(b.lon);
  const d = distanceKm(a, b) / R;
  if (d < 1e-9) return { lat: a.lat, lon: a.lon };
  const A = Math.sin((1 - t) * d) / Math.sin(d);
  const B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return { lat: deg(Math.atan2(z, Math.hypot(x, y))), lon: deg(Math.atan2(y, x)) };
}

/** Compass heading in degrees (0 = north) when leaving a for b. */
export function bearing(a, b) {
  const φ1 = rad(a.lat), φ2 = rad(b.lat), Δλ = rad(b.lon - a.lon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

/** Points along the route, longitudes kept continuous so lines never jump across the map. */
export function routePoints(a, b, n = 96) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(along(a, b, i / n));
  for (let i = 1; i < pts.length; i++) {
    while (pts[i].lon - pts[i - 1].lon > 180) pts[i].lon -= 360;
    while (pts[i].lon - pts[i - 1].lon < -180) pts[i].lon += 360;
  }
  return pts;
}

export const CRUISE_KMH = 820;
export const TAXI_MIN = 10;

/** Roughly how long a real airliner takes, in whole minutes. */
export function flightMinutes(km) {
  return Math.max(TAXI_MIN, Math.round((km / CRUISE_KMH) * 60 + TAXI_MIN));
}

/**
 * Destinations whose flight time is close to the minutes you want to focus, best
 * matches first. `rand` picks among near-equal options so the board changes.
 */
export function destinationsFor(home, airports, minutes, count = 8, rand = Math.random) {
  const all = airports
    .filter((a) => a.iata !== home.iata && a.country)
    .map((a) => ({ a, m: flightMinutes(distanceKm(home, a)) }))
    .map((x) => ({ ...x, off: Math.abs(x.m - minutes) / minutes }));
  // Widen the window until there's a decent choice (short hops from remote places are rare).
  let scored = [];
  for (const tol of [0.12, 0.25, 0.4, 0.7]) {
    scored = all.filter((x) => x.off <= tol);
    if (scored.length >= count) break;
  }
  scored = scored.map((x) => ({ ...x, key: x.off + rand() * 0.06 })).sort((p, q) => p.key - q.key);
  // Prefer variety: at most two per country on one board.
  const per = {};
  const out = [];
  for (const x of scored) {
    per[x.a.country] = (per[x.a.country] || 0) + 1;
    if (per[x.a.country] <= 2) out.push(x.a);
    if (out.length === count) return out;
  }
  // Not enough variety nearby: fill up with the next best anyway.
  for (const x of scored) {
    if (out.length === count) break;
    if (!out.includes(x.a)) out.push(x.a);
  }
  return out;
}

/** The airport nearest a point, for an early landing. */
export function nearestAirport(p, airports) {
  let best = null;
  let bestD = Infinity;
  for (const a of airports) {
    const d = distanceKm(p, a);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

/**
 * Equirectangular view that fits the given points with a margin, centred on them.
 * Returns project(lat, lon) -> [x, y] in pixels and the longitude centre used.
 */
export function fitView(points, w, h, margin = 0.18, minSpanDeg = 30) {
  const lons = points.map((p) => p.lon);
  const lats = points.map((p) => p.lat);
  let lon0 = Math.min(...lons), lon1 = Math.max(...lons);
  let lat0 = Math.min(...lats), lat1 = Math.max(...lats);
  const cx = (lon0 + lon1) / 2;
  const cy = (lat0 + lat1) / 2;
  let spanX = Math.max(minSpanDeg, (lon1 - lon0) * (1 + margin * 2));
  let spanY = Math.max(minSpanDeg * (h / w), (lat1 - lat0) * (1 + margin * 2));
  // Keep the shape: degrees per pixel the same both ways.
  const k = Math.max(spanX / w, spanY / h);
  spanX = k * w;
  spanY = k * h;
  const project = (lat, lon) => {
    let L = lon;
    while (L - cx > 180) L -= 360;
    while (L - cx < -180) L += 360;
    return [((L - cx) / spanX + 0.5) * w, ((cy - lat) / spanY + 0.5) * h];
  };
  return { project, cx, cy, k };
}

/** Flight number from the route, stable for the same pair: "CT 0412". */
export function flightNumber(from, to) {
  let h = 7;
  for (const c of from + to) h = (h * 31 + c.charCodeAt(0)) % 9973;
  return `CT ${String(h % 1000).padStart(3, '0')}`;
}

/** Formats minutes as "1 h 25 min" / "45 min". */
export function fmtDuration(min) {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}
