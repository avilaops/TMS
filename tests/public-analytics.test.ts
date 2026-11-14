import { describe, expect, it } from 'vitest';
import { consentChoice, analyticsEvent, analyticsCookies } from '../src/lib/public-analytics';

describe('estatísticas públicas com consentimento', () => {
  it('nega por padrão e exige versão e prazo válidos', () => {
    const now = Date.now();
    expect(consentChoice(null, now)).toBe(null);
    expect(consentChoice('inválido', now)).toBe(null);
    expect(consentChoice(JSON.stringify({ version: 1, statistics: true, expiresAt: now - 1 }), now)).toBe(null);
    expect(consentChoice(JSON.stringify({ version: 1, statistics: false, expiresAt: now + 1000 }), now)).toBe(false);
  });
  it('nunca usa parâmetros, fragmentos nem referência de origem privada', () => {
    const event = analyticsEvent('/blog/o-que-e-cte?email=alguem#cpf', 'page_view');
    expect(event).toBe(null);
    expect(analyticsEvent('/blog/o-que-e-cte', 'page_view')).toEqual({ event: 'tms_page_view', tms_page_location: 'https://tms.avilaops.com/blog/o-que-e-cte', tms_page_title: 'O que é CT-e? • Universo Fiscal' });
  });
  it.each(['/dashboard', '/login', '/rastreio', '/transportadoras/teste', '/api/health'])('não emite em %s', path => {
    expect(analyticsEvent(path, 'contact_click')).toBe(null);
  });
  it('remove somente os cookies de estatísticas do TMS', () => {
    expect(analyticsCookies('tms_ga=1; next-auth.session-token=2; _ga_outro=3; tms_ga_ABC=4')).toEqual(['tms_ga', 'tms_ga_ABC']);
  });
  it('remove também os cookies padrão dessa propriedade deixados pelo Google', () => {
    expect(analyticsCookies('_ga=1; _ga_HNFLJYF5CE=2; _ga_OUTRO=3; next-auth.session-token=4; tms_ga=5', 'G-HNFLJYF5CE')).toEqual(['_ga', '_ga_HNFLJYF5CE', 'tms_ga']);
  });
});
