import { describe, expect, it, vi } from 'vitest';
import { deployRender } from '../.github/scripts/deploy-render.mjs';

const args = { serviceId: 'srv-dbrvu9ifngtc73bb5q10', ownerId: 'tea-dbrkuj9srm7s73ectr70', image: `ghcr.io/avilaops/tms@sha256:${'a'.repeat(64)}`, apiKey: 'test-token' };
describe('promoção do artefato CI no Render', () => {
  it('recusa tags mutáveis e serviços fora do TMS antes de tocar no servidor', async () => {
    const request = vi.fn();
    await expect(deployRender({ ...args, image: 'ghcr.io/avilaops/tms:latest', request })).rejects.toThrow();
    await expect(deployRender({ ...args, serviceId: 'srv-outro', request })).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it('promove apenas a imagem por digest e não altera o banco ou segredos', async () => {
    const calls: { url: string; body: unknown; method: string }[] = [];
    const request = vi.fn<typeof fetch>(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)), method: init!.method! });
      return new Response(JSON.stringify({ id: 'dep-test', status: 'created' }), { status: 201 });
    });
    expect(await deployRender({ ...args, request })).toMatchObject({ id: 'dep-test' });
    expect(calls).toEqual([
      { url: `https://api.render.com/v1/services/${args.serviceId}`, method: 'PATCH', body: { autoDeploy: 'no', image: { ownerId: args.ownerId, imagePath: args.image } } },
      { url: `https://api.render.com/v1/services/${args.serviceId}/deploys`, method: 'POST', body: { imageUrl: args.image } },
    ]);
  });
  it('uma rejeição da configuração impede o deploy e não expõe o token', async () => {
    const request = vi.fn(async () => new Response('untrusted error includes test-token', { status: 403 }));
    await expect(deployRender({ ...args, request })).rejects.toThrow('Render PATCH recusado (403).');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
