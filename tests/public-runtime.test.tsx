import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement } from 'react';
const dynamic = vi.hoisted(() => ({ connection: vi.fn(async () => {}) }));
vi.mock('next/server', () => ({ connection: dynamic.connection }));
import { PublicShell } from '../src/components/publico/PublicShell';
import { PublicConsent } from '../src/components/publico/PublicConsent';

describe('IDs do Google disponíveis em runtime', () => {
  beforeEach(() => { vi.unstubAllEnvs(); dynamic.connection.mockClear(); });
  it('aguarda a requisição antes de ler os IDs, inclusive em páginas editoriais', async () => {
    let release!: () => void;
    dynamic.connection.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const shell = PublicShell({ children: null });
    vi.stubEnv('TMS_GTM_CONTAINER_ID', 'GTM-RUNTIME'); vi.stubEnv('TMS_GA4_MEASUREMENT_ID', 'G-RUNTIME');
    release?.();
    const output = await shell as ReactElement<{ children: unknown[] }>;
    expect(dynamic.connection).toHaveBeenCalledOnce();
    const consent = output.props.children.find(child => isValidElement(child) && child.type === PublicConsent) as ReactElement<{ containerId: string; measurementId: string }>;
    expect(consent.props).toMatchObject({ containerId: 'GTM-RUNTIME', measurementId: 'G-RUNTIME' });
    vi.unstubAllEnvs();
  });
});
