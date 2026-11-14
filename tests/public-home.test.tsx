import { beforeEach, describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({ value: null as null | { user: { tenantId?: string; role?: string } } }));
vi.mock('next-auth', () => ({ getServerSession: async () => session.value }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('next/navigation', () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));

import Home from '@/app/page';

describe('entrada pública e acesso ao sistema', () => {
  beforeEach(() => { session.value = null; });

  it('abre a apresentação para quem não tem sessão, sem mandar ao login', async () => {
    await expect(Home()).resolves.toBeTruthy();
  });

  it('preserva a escolha de empresa para uma identidade ainda sem transportadora', async () => {
    session.value = { user: {} };
    await expect(Home()).rejects.toThrow('redirect:/empresa');
  });

  it.each([
    ['ADMIN', '/dashboard'], ['DIRECTOR', '/dashboard'], ['OPERATION', '/dashboard'],
    ['FINANCE', '/dashboard'], ['COMMERCIAL', '/dashboard'], ['EXPEDITION', '/dashboard'],
    ['WAREHOUSE', '/dashboard'], ['DRIVER', '/driver'], ['CLIENT', '/portal'],
  ])('mantém o perfil %s na área %s depois do login', async (role, path) => {
    session.value = { user: { tenantId: 'empresa-de-teste', role } };
    await expect(Home()).rejects.toThrow(`redirect:${path}`);
  });
});
