import test from 'node:test';
import assert from 'node:assert/strict';
import { parseHomeTLE, validObserver, homeLook, predictHomePasses, freshHomeOrbits } from '../src/services/home-satellites.ts';
const text = 'ISS\n1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992\n2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442';
const observer = { latitude: 29.65, longitude: -81.64, height: 0 };
test('rejects invalid observers, malformed TLEs, and duplicate records', () => {
  assert.equal(validObserver(observer), true);
  assert.equal(validObserver({ ...observer, latitude: 91 }), false);
  assert.equal(validObserver({ ...observer, longitude: NaN }), false);
  assert.equal(parseHomeTLE('bad data').length, 0);
  assert.equal(parseHomeTLE(text.replace('9992', '9993')).length, 0);
  assert.equal(parseHomeTLE(`${text}\n${text}`).length, 1);
});
test('look angle places a satellite overhead at its ground position', async () => {
  const { propagate, gstime, eciToGeodetic } = await import('satellite.js');
  const orbit = parseHomeTLE(text)[0]!;
  const position = propagate(orbit.satrec, orbit.epoch)!.position;
  assert.ok(position && typeof position !== 'boolean');
  const geo = eciToGeodetic(position, gstime(orbit.epoch));
  const look = homeLook(orbit, { latitude: geo.latitude * 180 / Math.PI, longitude: geo.longitude * 180 / Math.PI, height: 0 }, orbit.epoch)!;
  assert.ok(Math.abs(look.elevation - 90) < 0.01);
  assert.ok(Math.abs(look.range - geo.height) < 0.01);
});
test('predicts ordered above-threshold passes and excludes stale epochs', async () => {
  const orbit = parseHomeTLE(text)[0]!;
  assert.equal(freshHomeOrbits([orbit], new Date('2026-10-12')).length, 0);
  assert.equal(freshHomeOrbits([orbit], new Date('2018-01-01')).length, 0);
  const passes = await predictHomePasses([orbit], observer, orbit.epoch);
  assert.ok(passes.length > 0);
  for (const pass of passes) {
    assert.ok(pass.peak >= 10 && pass.peak <= 90);
    assert.ok(pass.end > pass.start);
    assert.ok(homeLook(orbit, observer, pass.start)!.elevation >= 10);
  }
  assert.deepEqual(await predictHomePasses([orbit], observer, orbit.epoch, () => true), []);
});
