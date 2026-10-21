import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distanceKm, along, bearing, routePoints, flightMinutes, destinationsFor, nearestAirport, fitView, flightNumber, fmtDuration } from '../src/js/geo.js';

const JFK = { iata: 'JFK', country: 'US', lat: 40.639, lon: -73.779 };
const LHR = { iata: 'LHR', country: 'GB', lat: 51.471, lon: -0.46 };
const NRT = { iata: 'NRT', country: 'JP', lat: 35.769, lon: 140.389 };
const LAX = { iata: 'LAX', country: 'US', lat: 33.942, lon: -118.408 };

test('great-circle distances match real routes', () => {
  assert.ok(Math.abs(distanceKm(JFK, LHR) - 5540) < 40);
  assert.ok(Math.abs(distanceKm(LAX, NRT) - 8760) < 60);
  assert.equal(distanceKm(JFK, JFK), 0);
});

test('points along the route start and end at the airports', () => {
  const s = along(JFK, LHR, 0);
  const e = along(JFK, LHR, 1);
  assert.ok(Math.abs(s.lat - JFK.lat) < 1e-6 && Math.abs(e.lon - LHR.lon) < 1e-6);
  // The great circle from New York to London bulges north past 51.5°.
  assert.ok(along(JFK, LHR, 0.5).lat > 51.5);
});

test('bearings point the right way', () => {
  assert.ok(Math.abs(bearing({ lat: 0, lon: 0 }, { lat: 10, lon: 0 })) < 1e-9);
  assert.ok(Math.abs(bearing({ lat: 0, lon: 0 }, { lat: 0, lon: 10 }) - 90) < 1e-9);
  assert.ok(bearing(JFK, LHR) > 40 && bearing(JFK, LHR) < 60);
});

test('routes across the Pacific stay continuous', () => {
  const pts = routePoints(LAX, NRT, 50);
  for (let i = 1; i < pts.length; i++) assert.ok(Math.abs(pts[i].lon - pts[i - 1].lon) < 20);
});

test('flight times look like real ones', () => {
  assert.ok(Math.abs(flightMinutes(distanceKm(JFK, LHR)) - 415) < 30);
  assert.equal(flightMinutes(1), 10);
});

test('the board offers places about as far as you want to focus', () => {
  const near = (lat, lon, i, c) => ({ iata: `X${i}`, country: c, lat, lon });
  const airports = [JFK, LHR, NRT, LAX];
  for (let i = 0; i < 30; i++) airports.push(near(40.6 + i * 0.02, -73.8 + 5 + i * 0.4, i, i % 3 ? 'AA' : 'BB'));
  const d = destinationsFor(JFK, airports, 60, 8, () => 0);
  assert.ok(d.length > 0 && d.length <= 8);
  for (const a of d) assert.ok(Math.abs(flightMinutes(distanceKm(JFK, a)) - 60) <= 60 * 0.7);
  // Variety first: two countries' worth before repeats.
  assert.deepEqual(new Set(d.slice(0, 4).map((a) => a.country)), new Set(['AA', 'BB']));
  assert.ok(!d.includes(JFK));
});

test('early landing finds the nearest airport', () => {
  assert.equal(nearestAirport({ lat: 50, lon: -2 }, [JFK, LHR, NRT]).iata, 'LHR');
});

test('the map view fits the route and wraps longitudes around it', () => {
  const v = fitView(routePoints(LAX, NRT), 1000, 500);
  for (const p of routePoints(LAX, NRT)) {
    const [x, y] = v.project(p.lat, p.lon);
    assert.ok(x >= 0 && x <= 1000 && y >= 0 && y <= 500, `${x},${y}`);
  }
  const [a] = v.project(0, v.cx);
  assert.ok(Math.abs(a - 500) < 1e-6);
});

test('flight numbers are stable and formatted', () => {
  assert.equal(flightNumber('JFK', 'LHR'), flightNumber('JFK', 'LHR'));
  assert.match(flightNumber('JFK', 'LHR'), /^CT \d{3}$/);
  assert.equal(fmtDuration(45), '45 min');
  assert.equal(fmtDuration(120), '2 h');
  assert.equal(fmtDuration(85), '1 h 25 min');
});

test('logbook totals and streaks', async () => {
  const { stats } = await import('../src/js/logbook.js');
  const day = (n, h = 10) => new Date(2026, 9, 21 - n, h).getTime();
  const A = { iata: 'AAA', country: 'US' };
  const B = { iata: 'BBB', country: 'FR' };
  const C = { iata: 'CCC', country: 'JP' };
  const list = [
    { from: A, to: B, status: 'landed', end: day(0), flownMin: 60, flownKm: 500 },
    { from: B, to: C, status: 'landed', end: day(1), flownMin: 120, flownKm: 1500 },
    { from: C, to: A, status: 'diverted', end: day(2), flownMin: 30, flownKm: 200 },
    { from: A, to: C, status: 'landed', end: day(3), flownMin: 45, flownKm: 400 },
  ];
  const s = stats(list, new Date(2026, 9, 21, 18));
  assert.deepEqual(s, { flights: 3, diverted: 1, minutes: 255, km: 2600, countries: 2, cities: 2, streak: 2 });
  // Nothing today yet: the streak still counts up to yesterday.
  assert.equal(stats(list.slice(1), new Date(2026, 9, 21, 18)).streak, 1);
});
