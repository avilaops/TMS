'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';
import { analyticsCookies, analyticsEvent, CONSENT_DURATION, CONSENT_KEY, consentChoice, type PublicEvent } from '@/lib/public-analytics';

declare global { interface Window { dataLayer?: Record<string, unknown>[]; } }

const denied = { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' };
function subscribe(listener: () => void) {
  window.addEventListener('storage', listener); window.addEventListener('tms:consent', listener);
  return () => { window.removeEventListener('storage', listener); window.removeEventListener('tms:consent', listener); };
}
function storedChoice() { try { return localStorage.getItem(CONSENT_KEY); } catch { return null; } }
function pendingChoice() { return 'pending'; }
const gtag: (...args: unknown[]) => void = function () {
  window.dataLayer ??= [];
  // Google's documented command queue requires an IArguments object.
  // eslint-disable-next-line prefer-rest-params
  window.dataLayer.push(arguments as unknown as Record<string, unknown>);
};

function consent(statistics: boolean) {
  window.dataLayer ??= [];
  // Google consumes the arguments object used by its documented gtag wrapper.
  gtag('consent', 'update', { ...denied, analytics_storage: statistics ? 'granted' : 'denied' });
}

function removeAnalyticsCookies(measurementId?: string) {
  for (const name of analyticsCookies(document.cookie, measurementId)) {
    for (const domain of ['', '; Domain=tms.avilaops.com', '; Domain=.tms.avilaops.com']) {
      document.cookie = `${name}=; Max-Age=0; Path=/${domain}; SameSite=Lax; Secure`;
    }
  }
}

export function PublicConsent({ containerId, measurementId }: { containerId?: string; measurementId?: string }) {
  const path = usePathname();
  const stored = useSyncExternalStore(subscribe, storedChoice, pendingChoice);
  const [temporaryChoice, setTemporaryChoice] = useState<boolean | null>(null);
  const choice = temporaryChoice ?? consentChoice(stored);
  const ready = stored !== 'pending';
  const [open, setOpen] = useState(false);
  const configured = /^GTM-[A-Z0-9]+$/.test(containerId ?? '') && /^G-[A-Z0-9]+$/.test(measurementId ?? '');

  const disable = useCallback((disabled: boolean) => {
    if (measurementId) (window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`] = disabled;
  }, [measurementId]);

  useEffect(() => {
    window.dataLayer ??= [];
    gtag('consent', 'default', denied);
    disable(true);
    return () => { disable(true); consent(false); };
  }, [disable]);

  useEffect(() => {
    const event = analyticsEvent(path, 'page_view');
    if (!ready || !choice || !configured || !event || location.hostname !== 'tms.avilaops.com' && location.hostname !== '127.0.0.1') { disable(true); return; }
    disable(false);
    // Apply safe defaults before GTM or Google can initialize a session.
    gtag('set', { send_page_view: false, page_location: event.tms_page_location, page_title: event.tms_page_title, page_referrer: '', ignore_referrer: true, cookie_prefix: 'tms', cookie_domain: location.hostname, cookie_flags: 'SameSite=Lax;Secure', allow_google_signals: false, allow_ad_personalization_signals: false });
    consent(true);
    window.dataLayer ??= [];
    // A clean URL is present before GTM starts. No page/query/referrer variables are used by its tags.
    window.dataLayer.push(event);
    if (!document.getElementById('tms-gtm')) {
      window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
      const script = document.createElement('script');
      script.id = 'tms-gtm'; script.async = true;
      script.src = `https://www.googletagmanager.com/gtm.js?id=${containerId}`;
      document.head.append(script);
    }
    const send = (name: PublicEvent) => { const payload = analyticsEvent(path, name); if (payload) window.dataLayer!.push(payload); };
    const click = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('[data-public-event]') : null;
      const name = target?.getAttribute('data-public-event');
      if (name === 'contact_click' || name === 'login_click') send(name);
    };
    document.addEventListener('click', click);
    // A reading signal, not a lead: only a visible article after 30 seconds.
    const timer = path.startsWith('/blog/') ? window.setTimeout(() => { if (document.visibilityState === 'visible') send('article_read'); }, 30000) : undefined;
    return () => { document.removeEventListener('click', click); window.clearTimeout(timer); disable(true); };
  }, [choice, ready, path, configured, containerId, disable]);

  function choose(statistics: boolean) {
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ version: 1, statistics, expiresAt: Date.now() + CONSENT_DURATION })); setTemporaryChoice(null); }
    catch { setTemporaryChoice(statistics); }
    window.dispatchEvent(new Event('tms:consent'));
    setOpen(false); consent(statistics);
    if (!statistics) { disable(true); removeAnalyticsCookies(measurementId); }
  }

  return <>
    <button className="public-cookie-settings" onClick={() => setOpen(true)}>Preferências de cookies</button>
    {ready && (choice === null || open) && <section className="public-cookie-panel" role="region" aria-label="Preferências de cookies">
      <strong>Estatísticas, com sua escolha.</strong>
      <p>Cookies necessários mantêm o acesso seguro. Você pode permitir estatísticas das páginas públicas para ajudar a melhorar o TMS. Publicidade permanece desativada. <a href="/cookies">Saiba mais</a>.</p>
      <div><button onClick={() => choose(false)}>Recusar estatísticas</button><button onClick={() => choose(true)}>Aceitar estatísticas</button>{choice !== null && <button onClick={() => setOpen(false)} aria-label="Fechar preferências">Fechar</button>}</div>
      {choice !== null && <small>Estatísticas: {choice ? 'permitidas' : 'recusadas'}.</small>}
    </section>}
  </>;
}
