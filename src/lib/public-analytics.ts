import { getPublicPage, publicUrl } from './public-site';

export const CONSENT_KEY = 'tms.public.consent.v1';
export const CONSENT_DURATION = 180 * 24 * 60 * 60 * 1000;
export type PublicEvent = 'page_view' | 'contact_click' | 'login_click' | 'article_read';

export function consentChoice(raw: string | null, now = Date.now()): boolean | null {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (value?.version !== 1 || typeof value.statistics !== 'boolean' || !Number.isFinite(value.expiresAt) || value.expiresAt <= now || value.expiresAt > now + CONSENT_DURATION) return null;
    return value.statistics;
  } catch { return null; }
}

export function analyticsEvent(path: string, name: PublicEvent) {
  const page = getPublicPage(path);
  if (!page) return null;
  return { event: `tms_${name}`, tms_page_location: publicUrl(page.path), tms_page_title: page.title };
}

export function analyticsCookies(cookie: string, measurementId?: string): string[] {
  const legacy = /^G-[A-Z0-9]+$/.test(measurementId ?? '') ? ['_ga', `_ga_${measurementId!.slice(2)}`] : [];
  return cookie.split(';').map(item => item.trim().split('=')[0]).filter(name => /^tms_ga(?:_[A-Z0-9]+)?$/.test(name) || legacy.includes(name));
}
