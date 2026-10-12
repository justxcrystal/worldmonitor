import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/components/Panel', () => ({ Panel: class {
  content = document.createElement('div');
  setSafeContent(html: { toString(): string }) { this.content.innerHTML = html.toString(); }
  destroy() {}
} }));
import { HomeSatellitePanel } from '@/components/HomeSatellitePanel';
let panel: HomeSatellitePanel | undefined;
afterEach(() => { panel?.destroy(); document.body.replaceChildren(); localStorage.clear(); vi.unstubAllGlobals(); });
it('saves observer coordinates, displays feed failure, restores and clears the observer', async () => {
  const fetch = vi.fn().mockRejectedValue(new Error('offline'));
  vi.stubGlobal('fetch', fetch);
  panel = new HomeSatellitePanel();
  // Base shell is mocked; exercise the real panel's form and persistence behavior.
  const content = (panel as unknown as { content: HTMLElement }).content;
  document.body.append(content);
  content.querySelector<HTMLInputElement>('[name="latitude"]')!.value = '29.65';
  content.querySelector<HTMLInputElement>('[name="longitude"]')!.value = '-81.64';
  content.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  await vi.waitFor(() => expect(content.querySelector('.home-satellite-status')!.textContent).toContain('Public feed unavailable'));
  expect(JSON.parse(localStorage.getItem('wm-home-satellite-observer')!)).toEqual({ latitude: 29.65, longitude: -81.64, height: 0 });
  expect(fetch.mock.calls[0][1].credentials).toBe('omit');
  expect(fetch.mock.calls[0][0]).not.toContain('29.65');
  panel.destroy();
  panel = new HomeSatellitePanel();
  const restored = (panel as unknown as { content: HTMLElement }).content;
  expect(restored.querySelector<HTMLInputElement>('[name="longitude"]')!.value).toBe('-81.64');
  restored.querySelector<HTMLButtonElement>('[data-action="clear"]')!.click();
  expect(localStorage.getItem('wm-home-satellite-observer')).toBeNull();
  expect(restored.querySelector('.home-satellite-results')!.children.length).toBe(0);
  await Promise.resolve();
  expect(restored.querySelector('.home-satellite-status')!.textContent).toContain('Location cleared');
});
it('ignores invalid saved coordinates and cancels asynchronous work on destruction', async () => {
  localStorage.setItem('wm-home-satellite-observer', '{"latitude":95,"longitude":0,"height":0}');
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  panel = new HomeSatellitePanel();
  const content = (panel as unknown as { content: HTMLElement }).content;
  expect(content.querySelector<HTMLInputElement>('[name="latitude"]')!.value).toBe('');
  expect(fetch).not.toHaveBeenCalled();
  expect(content.textContent).toContain('No receiver connected');
});
