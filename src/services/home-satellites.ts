import { twoline2satrec, propagate, gstime, eciToEcf, ecfToLookAngles } from 'satellite.js';
import type { SatRec } from 'satellite.js';

export interface HomeObserver { latitude: number; longitude: number; height: number }
export interface HomeOrbit { name: string; id: string; satrec: SatRec; epoch: Date }
export interface HomeLook { azimuth: number; elevation: number; range: number }
export interface HomePass { orbit: HomeOrbit; start: Date; end: Date; peak: number; ongoing: boolean; clipped: boolean }
const RAD = Math.PI / 180;

export function validObserver(o: HomeObserver): boolean {
  return Number.isFinite(o.latitude) && Math.abs(o.latitude) <= 90
    && Number.isFinite(o.longitude) && Math.abs(o.longitude) <= 180
    && Number.isFinite(o.height) && o.height >= -500 && o.height <= 10000;
}

/** Standard two- or three-line TLE text. Retain at most 100 objects to bound browser work. */
function validTLELine(line: string): boolean {
  if (line.length !== 69 || !/^[12] [A-Z0-9 ]{5}/.test(line) || !/\d$/.test(line)) return false;
  const checksum = [...line.slice(0, 68)].reduce((sum, c) => sum + (/\d/.test(c) ? Number(c) : c === '-' ? 1 : 0), 0) % 10;
  return checksum === Number(line[68]);
}

export function parseHomeTLE(text: string): HomeOrbit[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const orbits: HomeOrbit[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length - 1 && orbits.length < 100; i++) {
    const l1 = lines[i]!;
    const l2 = lines[i + 1]!;
    if (!l1.startsWith('1 ') || !l2.startsWith('2 ') || !validTLELine(l1) || !validTLELine(l2)) continue;
    const id = l1.slice(2, 7).trim();
    if (id !== l2.slice(2, 7).trim() || seen.has(id)) continue;
    try {
      const satrec = twoline2satrec(l1, l2);
      const epoch = new Date((satrec.jdsatepoch - 2440587.5) * 86400000);
      if (!Number.isFinite(epoch.getTime()) || !Number.isFinite(satrec.no) || satrec.no <= 0 || satrec.error) continue;
      const previous = lines[i - 1];
      const name = previous && !/^[12] /.test(previous) ? previous.replace(/^0 /, '') : `NORAD ${id}`;
      orbits.push({ name, id, satrec, epoch });
      seen.add(id);
      i++;
    } catch { /* Malformed objects never produce predictions. */ }
  }
  return orbits;
}

export function homeLook(orbit: HomeOrbit, observer: HomeObserver, date: Date): HomeLook | null {
  if (!validObserver(observer)) return null;
  try {
    const pv = propagate(orbit.satrec, date);
    if (!pv || !pv.position || typeof pv.position === 'boolean') return null;
    const look = ecfToLookAngles({ latitude: observer.latitude * RAD, longitude: observer.longitude * RAD, height: observer.height / 1000 }, eciToEcf(pv.position, gstime(date)));
    const result = { azimuth: (look.azimuth / RAD + 360) % 360, elevation: look.elevation / RAD, range: look.rangeSat };
    return Object.values(result).every(Number.isFinite) ? result : null;
  } catch { return null; }
}

export function freshHomeOrbits(orbits: HomeOrbit[], now: Date): HomeOrbit[] {
  return orbits.filter(o => now.getTime() - o.epoch.getTime() <= 14 * 86400000 && o.epoch.getTime() <= now.getTime() + 86400000);
}

/** Approximate above-10-degree windows, sampled each 30 s over 24 h. */
export async function predictHomePasses(orbits: HomeOrbit[], observer: HomeObserver, now: Date, cancelled: () => boolean = () => false): Promise<HomePass[]> {
  const passes: HomePass[] = [];
  for (const orbit of freshHomeOrbits(orbits, now)) {
    if (cancelled()) return [];
    let active: HomePass | null = null;
    for (let step = 0; step <= 2880; step++) {
      const date = new Date(now.getTime() + step * 30000);
      const look = homeLook(orbit, observer, date);
      if (look && look.elevation >= 10) {
        if (!active) active = { orbit, start: date, end: date, peak: look.elevation, ongoing: step === 0, clipped: false };
        active.end = date;
        active.peak = Math.max(active.peak, look.elevation);
      } else if (active) {
        active.end = date;
        passes.push(active);
        active = null;
      }
    }
    if (active) { active.clipped = true; passes.push(active); }
    // Yield between objects so editing the location and leaving the panel remain responsive.
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return passes.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export async function fetchHomeTLE(signal: AbortSignal): Promise<HomeOrbit[]> {
  // A small public catalog also works without WorldMonitor's Redis/API credentials.
  const response = await fetch('https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle', { signal, credentials: 'omit' });
  if (!response.ok) throw new Error('Orbit feed unavailable');
  const orbits = parseHomeTLE(await response.text());
  if (!orbits.length) throw new Error('No valid orbital data returned');
  return orbits;
}
