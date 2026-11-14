// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://127.0.0.1:55319/blog/o-que-e-cte?email=PRIVACY_MARKER"}
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ usePathname: () => '/blog/o-que-e-cte' }));
import { PublicConsent } from '../src/components/publico/PublicConsent';

describe('inicialização privada do Google', () => {
  beforeEach(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; localStorage.clear(); window.dataLayer = []; document.head.innerHTML = ''; });
  it('define URL canônica e suprime pageview automático antes de carregar GTM', async () => {
    localStorage.setItem('tms.public.consent.v1', JSON.stringify({ version: 1, statistics: true, expiresAt: Date.now() + 10000 }));
    const element = document.createElement('div'); document.body.append(element);
    const root = createRoot(element);
    await act(async () => root.render(<PublicConsent containerId="GTM-TEST" measurementId="G-TEST" />));
    const commands = window.dataLayer!.map(value => Array.from(value as unknown as ArrayLike<unknown>));
    const safe = commands.find(value => value[0] === 'set')!;
    expect(safe[1]).toMatchObject({ send_page_view: false, page_location: 'https://tms.avilaops.com/blog/o-que-e-cte', page_referrer: '' });
    const safeIndex = commands.indexOf(safe);
    const loadIndex = window.dataLayer!.findIndex(value => value.event === 'gtm.js');
    expect(loadIndex).toBeGreaterThan(safeIndex);
    expect(document.getElementById('tms-gtm')?.getAttribute('src')).toBe('https://www.googletagmanager.com/gtm.js?id=GTM-TEST');
    await act(async () => root.unmount()); element.remove();
  });
});
