import test from 'node:test';
import assert from 'node:assert/strict';
import { stats } from '../src/js/logbook.js';

const day = (d, h = 12) => new Date(2026, 9, d, h).getTime();
const f = (to, country, end, status = 'landed', flownMin = 45, flownKm = 600) => ({ to: { iata: to, country }, end, status, flownMin, flownKm });

test('stats counts landed flights, diversions, time, distance and places', () => {
  const list = [f('CDG', 'FR', day(20)), f('LYS', 'FR', day(20)), f('BCN', 'ES', day(19), 'diverted', 20, 150)];
  const s = stats(list, new Date(day(20, 18)));
  assert.equal(s.flights, 2);
  assert.equal(s.diverted, 1);
  assert.equal(s.minutes, 110);
  assert.equal(s.km, 1350);
  assert.equal(s.countries, 1, 'diverted flights do not add a country');
  assert.equal(s.cities, 2);
});

test('the streak counts back from today, or from yesterday if nothing landed yet today', () => {
  const list = [f('A', 'X', day(19)), f('B', 'X', day(18)), f('C', 'X', day(16))];
  assert.equal(stats(list, new Date(day(20, 9))).streak, 2);
  assert.equal(stats(list, new Date(day(19, 22))).streak, 2);
  assert.equal(stats(list, new Date(day(22))).streak, 0);
  assert.equal(stats([], new Date(day(20))).streak, 0);
});
