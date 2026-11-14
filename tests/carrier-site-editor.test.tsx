// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { montar, desmontarTudo, clicar, porTexto, ate } from './tela';
import { emptySiteDraft } from '../src/lib/carrier-site';
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { role: 'ADMIN' } } }) }));
import Editor from '../src/app/dashboard/site/page';

describe('retirada do site sem perda de edição', () => {
  afterEach(async () => { await desmontarTudo(); vi.unstubAllGlobals(); });
  it('mantém o texto ainda não salvo ao retirar a publicação do ar', async () => {
    const draft = { ...emptySiteDraft('Empresa exemplo'), about: 'Apresentação que está salva.' };
    const state = { draft, revision: 2, slug: 'exemplo', publishedAt: '2026-11-14T10:00:00Z' };
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => new Response(JSON.stringify(options?.method === 'DELETE' ? { ...state, revision: 3, publishedAt: null } : state), { status: 200 })));
    const view = await montar(<Editor />);
    await ate(() => expect(view.querySelector('textarea')).not.toBe(null));
    const about = [...view.querySelectorAll('label')].find(label => label.textContent?.startsWith('Sobre a empresa'))!.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(about, 'Minha edição local ainda não salva.');
      about.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await clicar(porTexto(view, 'button', 'Retirar site do ar')[0]);
    await ate(() => expect(view.textContent).toContain('Site retirado do ar.'));
    expect(about.value).toBe('Minha edição local ainda não salva.');
    expect(view.textContent).toContain('alterações não salvas');
  });
});
