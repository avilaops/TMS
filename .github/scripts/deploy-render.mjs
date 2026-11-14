import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** @param {{ serviceId: string, ownerId: string, image: string, apiKey: string, request?: typeof fetch }} options */
export async function deployRender({ serviceId, ownerId, image, apiKey, request = fetch }) {
  if (serviceId !== 'srv-dbrvu9ifngtc73bb5q10' || ownerId !== 'tea-dbrkuj9srm7s73ectr70' || !/^ghcr\.io\/avilaops\/tms@sha256:[a-f0-9]{64}$/.test(image) || !apiKey) throw new Error('Destino ou imagem de produção inválido.');
  async function call(url, method, body) {
    const response = await request(url, { method, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    // Never echo arbitrary provider errors, which may contain credentials.
    if (!response.ok) throw new Error(`Render ${method} recusado (${response.status}).`);
    return response.json();
  }
  const endpoint = `https://api.render.com/v1/services/${serviceId}`;
  await call(endpoint, 'PATCH', { autoDeploy: 'no', image: { ownerId, imagePath: image } });
  return call(`${endpoint}/deploys`, 'POST', { imageUrl: image });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  deployRender({ serviceId: process.env.RENDER_SERVICE_ID ?? '', ownerId: process.env.RENDER_OWNER_ID ?? '', image: process.env.IMAGE ?? '', apiKey: process.env.RENDER_API_KEY ?? '' }).then(result => {
    console.log(JSON.stringify({ deployId: result.id, status: result.status }));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
