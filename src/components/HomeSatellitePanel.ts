import { Panel } from './Panel';
import { safeHtml } from '@/utils/sanitize';
import { fetchHomeTLE, parseHomeTLE, homeLook, predictHomePasses, freshHomeOrbits, validObserver } from '@/services/home-satellites';
import type { HomeObserver, HomeOrbit, HomePass } from '@/services/home-satellites';

const STORAGE = 'wm-home-satellite-observer';

export class HomeSatellitePanel extends Panel {
  private observer: HomeObserver | null = null;
  private orbits: HomeOrbit[] = [];
  private passes: HomePass[] = [];
  private request: AbortController | null = null;
  private generation = 0;
  private timer: ReturnType<typeof setInterval>;
  private stopped = false;
  private status!: HTMLElement;
  private results!: HTMLElement;
  private source = '';

  constructor() {
    super({ id: 'home-satellites', title: 'Satellites at Home', infoTooltip: 'Predicted orbital passes for your saved location. No radio signals are measured.' });
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE) || 'null') as HomeObserver | null;
      if (saved && validObserver(saved)) this.observer = saved;
    } catch { /* Storage unavailable or invalid. */ }
    this.setSafeContent(safeHtml`
      <div class="home-satellite-content">
        <p>Predicted satellite passes. No receiver connected; no signal measurements.</p>
        <form class="home-satellite-form">
          <label>Latitude (°)<input name="latitude" type="number" min="-90" max="90" step="any" required placeholder="29.65" value="${this.observer?.latitude ?? ''}"></label>
          <label>Longitude (°)<input name="longitude" type="number" min="-180" max="180" step="any" required placeholder="-81.64" value="${this.observer?.longitude ?? ''}"></label>
          <label>Altitude (meters)<input name="height" type="number" min="-500" max="10000" step="any" required value="${this.observer?.height ?? 0}"></label>
          <button type="submit">Save location & track</button>
          <button type="button" data-action="clear">Clear location</button>
        </form>
        <p>Coordinates stay in this browser. West longitude is negative.</p>
        <label>Import satellite orbital data (.txt / .tle)<input type="file" accept=".txt,.tle" class="home-tle-file"></label>
        <button type="button" data-action="refresh">Refresh public orbit data</button>
        <p class="home-satellite-status" role="status" aria-live="polite"></p>
        <div class="home-satellite-results"></div>
        <p>Passes use a 10° minimum elevation and 30-second sampling over the next 24 hours. Orbit data older than 14 days is excluded. A pass does not establish a transmission or its intended recipient.</p>
      </div>`);
    this.status = this.content.querySelector('.home-satellite-status')!;
    this.results = this.content.querySelector('.home-satellite-results')!;
    this.content.querySelector('form')!.addEventListener('submit', e => {
      e.preventDefault();
      const data = new FormData(e.currentTarget as HTMLFormElement);
      const observer = { latitude: Number(data.get('latitude')), longitude: Number(data.get('longitude')), height: Number(data.get('height')) };
      if (!validObserver(observer)) { this.status.textContent = 'Enter valid coordinates and altitude.'; return; }
      this.observer = observer;
      try { localStorage.setItem(STORAGE, JSON.stringify(observer)); } catch { this.status.textContent = 'Location works for this visit, but could not be saved.'; }
      if (this.orbits.length) void this.calculate(); else void this.load();
    });
    this.content.querySelector('[data-action="clear"]')!.addEventListener('click', () => {
      this.generation++;
      this.request?.abort();
      this.observer = null;
      this.passes = [];
      try { localStorage.removeItem(STORAGE); } catch { /* Ignore storage failure. */ }
      const form = this.content.querySelector('form')!;
      (form.elements.namedItem('latitude') as HTMLInputElement).value = '';
      (form.elements.namedItem('longitude') as HTMLInputElement).value = '';
      this.results.replaceChildren();
      this.status.textContent = 'Location cleared. Enter coordinates to begin.';
    });
    this.content.querySelector('[data-action="refresh"]')!.addEventListener('click', () => void this.load());
    this.content.querySelector<HTMLInputElement>('.home-tle-file')!.addEventListener('change', e => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      if (file.size > 1024 * 1024) { this.status.textContent = 'Choose a TLE text file under 1 MB.'; return; }
      this.request?.abort();
      const generation = ++this.generation;
      void file.text().then(text => {
        if (this.stopped || generation !== this.generation) return;
        const orbits = parseHomeTLE(text);
        if (!orbits.length) { this.status.textContent = 'No valid TLE records found. Previous data retained.'; return; }
        this.orbits = orbits;
        this.source = 'Imported TLE file (up to 100 unique satellites)';
        void this.calculate();
      }).catch(() => { if (!this.stopped && generation === this.generation) this.status.textContent = 'Could not read that file.'; });
    });
    this.timer = setInterval(() => this.renderResults(), 10000);
    this.status.textContent = 'Enter your location to load public space-station orbit data, or import a TLE file for other satellites.';
    if (this.observer) void this.load();
  }

  private async load(): Promise<void> {
    if (!this.observer) { this.status.textContent = 'Save a location first.'; return; }
    this.request?.abort();
    const request = this.request = new AbortController();
    const generation = ++this.generation;
    const timeout = setTimeout(() => request.abort(), 15000);
    this.status.textContent = 'Loading public orbital data…';
    try {
      const orbits = await fetchHomeTLE(request.signal);
      if (this.stopped || generation !== this.generation) return;
      this.orbits = orbits;
      this.source = 'CelesTrak space stations catalog (not all satellites)';
      await this.calculate();
    } catch {
      if (!this.stopped && generation === this.generation) this.status.textContent = 'Public feed unavailable. Import a recent TLE text file to track passes. Any previous predictions remain labeled with their source.';
    } finally { clearTimeout(timeout); }
  }

  private async calculate(): Promise<void> {
    const generation = ++this.generation;
    if (!this.observer) { this.status.textContent = 'Orbital data imported. Save a location to calculate passes.'; return; }
    this.passes = [];
    this.results.replaceChildren();
    this.status.textContent = 'Calculating the next 24 hours…';
    const now = new Date();
    const fresh = freshHomeOrbits(this.orbits, now);
    const passes = await predictHomePasses(fresh, this.observer, now, () => this.stopped || generation !== this.generation);
    if (this.stopped || generation !== this.generation) return;
    this.passes = passes;
    this.status.textContent = `${this.source}. ${fresh.length} usable objects; ${this.orbits.length - fresh.length} excluded for old or future epochs. Calculated ${now.toLocaleString()}.`;
    this.renderResults();
  }

  private renderResults(): void {
    if (!this.observer || !this.orbits.length) return;
    const now = new Date();
    const fresh = freshHomeOrbits(this.orbits, now);
    const above = fresh.map(orbit => ({ orbit, look: homeLook(orbit, this.observer!, now) })).filter(item => item.look && item.look.elevation >= 10).sort((a, b) => b.look!.elevation - a.look!.elevation);
    this.results.replaceChildren();
    const heading = document.createElement('h3');
    heading.textContent = `Above 10° now: ${above.length}`;
    this.results.append(heading);
    for (const { orbit, look } of above.slice(0, 20)) {
      const p = document.createElement('p');
      p.textContent = `${orbit.name} · NORAD ${orbit.id} · direction ${look!.azimuth.toFixed(0)}° · elevation ${look!.elevation.toFixed(0)}° · range ${look!.range.toFixed(0)} km`;
      this.results.append(p);
    }
    const title = document.createElement('h3');
    title.textContent = 'Upcoming passes · your browser’s local time';
    this.results.append(title);
    const upcoming = this.passes.filter(p => p.end > now && fresh.includes(p.orbit)).slice(0, 30);
    if (!upcoming.length) {
      const empty = document.createElement('p');
      empty.textContent = fresh.length ? 'No remaining predicted passes in the calculated window. Refresh to calculate a new 24-hour window.' : 'No recent orbital data available. Refresh or import current TLEs.';
      this.results.append(empty);
    }
    const list = document.createElement('ol');
    for (const pass of upcoming) {
      const row = document.createElement('li');
      row.textContent = `${pass.orbit.name} · ${pass.start <= now ? 'In progress' : pass.start.toLocaleString()} → ${pass.clipped ? 'continues beyond forecast' : pass.end.toLocaleTimeString()} · peak ≈${pass.peak.toFixed(0)}° · orbit epoch ${pass.orbit.epoch.toLocaleString()}`;
      list.append(row);
    }
    this.results.append(list);
  }

  public override destroy(): void {
    this.stopped = true;
    this.generation++;
    this.request?.abort();
    clearInterval(this.timer);
    super.destroy();
  }
}
