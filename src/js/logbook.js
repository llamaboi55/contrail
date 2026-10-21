// The logbook and the flight in progress, kept in local storage on this computer.
const KEY = 'contrail:log';
const ACTIVE = 'contrail:active';
const PREFS = 'contrail:prefs';

const read = (k, d) => {
  try {
    return JSON.parse(localStorage.getItem(k)) ?? d;
  } catch {
    return d;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

export const DEFAULT_PREFS = { home: null, name: '', seat: 'window', sound: true, volume: 0.5, announce: true, notify: true };
export const prefs = () => ({ ...DEFAULT_PREFS, ...read(PREFS, {}) });
export const savePrefs = (p) => write(PREFS, p);

export const flights = () => read(KEY, []);
export function record(f) {
  const all = flights();
  all.unshift(f);
  write(KEY, all.slice(0, 2000));
}
export const clearLog = () => write(KEY, []);

export const active = () => read(ACTIVE, null);
export const setActive = (f) => (f ? write(ACTIVE, f) : localStorage.removeItem(ACTIVE));

/** Totals for the logbook header. Pure, so it's tested. */
export function stats(list, now = new Date()) {
  const landed = list.filter((f) => f.status === 'landed');
  const minutes = list.reduce((s, f) => s + (f.flownMin || 0), 0);
  const km = list.reduce((s, f) => s + (f.flownKm || 0), 0);
  const countries = new Set(landed.map((f) => f.to.country));
  const cities = new Set(landed.map((f) => f.to.iata));
  // Streak: consecutive days, ending today or yesterday, with at least one landed flight.
  const days = new Set(landed.map((f) => new Date(f.end).toDateString()));
  let streak = 0;
  const d = new Date(now);
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
  while (days.has(d.toDateString())) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return { flights: landed.length, diverted: list.length - landed.length, minutes, km, countries: countries.size, cities: cities.size, streak };
}
