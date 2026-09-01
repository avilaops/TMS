# Mello Transportes Rio Preto

Landing page comercial em React, TypeScript e Vite para consulta de cidades atendidas, prazos, frota, cotação rápida e solicitação de coleta pelo WhatsApp.

## Central de Coletas

A rota `#/coleta` funciona como um painel WhatsApp-first:

- Nova coleta em etapas, com barra de progresso e resumo lateral.
- Rascunho salvo automaticamente em `localStorage`.
- Perfil opcional do solicitante salvo somente no dispositivo.
- Consulta de CEP por ViaCEP, com preenchimento manual como fallback.
- Consulta automática da cidade de destino na área atendida.
- Cálculo de quantidade de volumes, peso informado e cubagem estimada.
- Protocolo local no formato `MEL-AAAAMMDD-HHMM-XXXX`.
- Prévia, cópia e impressão do resumo da mensagem.
- Histórico local em “Meus pedidos neste dispositivo”.
- Repetição de pedido anterior.
- Mensagens específicas para cotação, consulta de cidade, alteração, cancelamento, acompanhamento, envio de documentos, comprovante e atendimento direto.

A confirmação da coleta é sempre humana, pela conversa no WhatsApp. O site não confirma coleta, não rastreia entrega e não envia documentos sozinho.

## Dados Preservados

- Telefone: `(17) 3308-0878`
- WhatsApp: `(17) 99714-9702`
- E-mail: `comercial@mellotransportesriopreto.com.br`
- Endereço: `Rua Bonsucesso, nº 695 - Quinta das Paineiras - São José do Rio Preto/SP`
- Cobertura: 138 cidades cadastradas em `src/data/serviceAreas.csv`
- Frota: Fiat Strada, Van de Carga e Caminhão VUC (Até 3,7m)
- Prazos: `Até 24h` e `Até 48h`

## Como Atualizar

- Dados da empresa: `src/config/company.ts`
- Cidades, polos, prazos e veículos de rota: `src/data/serviceAreas.csv`
- Frota resumida: `src/data/fleet.ts`
- Serviços: `src/data/services.ts`
- FAQ: `src/data/faq.ts`
- Depoimentos reais: `src/data/testimonials.ts`
- Mensagens, protocolos, histórico local e futura troca por API: `src/services/collectionService.ts`
- Matérias do blog: `src/content/blog.ts`
- Identidade visual, paleta e kit de marca: `src/data/brand.ts`
- Manual editável de marca: `docs/manual-marca-mello.md`
- Manual PDF publicado: `public/manual-marca-mello.pdf`

Não adicione depoimentos, números de entregas, clientes ou anos de mercado sem confirmação comercial.

## Blog

As matérias ficam em `src/content/blog.ts`, como blocos tipados. Para publicar
uma matéria nova, acrescente um objeto em `posts` com `slug`, `title`,
`description`, `excerpt`, `category`, `publishedAt`, `readingMinutes` e `body`.

O resto se ajusta sozinho: a matéria entra no índice `/blog`, ganha a página
`/blog/<slug>` pré-renderizada, entra no `sitemap.xml` gerado pela aplicação e
recebe os dados estruturados de `Article`.

Blocos aceitos no `body`: `p`, `h2`, `h3`, `ul`, `ol`, `note` e `table`. Dentro
dos textos, `**assim**` vira negrito.

Não publique número de entregas, nome de cliente ou tempo de mercado sem
confirmação comercial.

## Identidade Visual

A rota `#/marca` apresenta o kit comercial da Mello Transportes:

- Logo principal.
- Paleta oficial.
- Tipografias sugeridas.
- Regras rápidas de uso.
- Entregas recomendadas para cliente.
- Templates simples para status, cartão digital e assinatura.

O PDF público fica disponível em:

```text
https://avilaops.github.io/Mello/manual-marca-mello.pdf
```

## Limitações GitHub Pages

Esta versão é estática:

- O histórico fica somente no navegador do cliente.
- O WhatsApp é o canal oficial de envio.
- Arquivos e fotos devem ser anexados diretamente na conversa do WhatsApp.
- Status operacionais reais não são atualizados automaticamente.
- Para futura integração com API, Odoo ou WhatsApp Business API, implemente um `ApiCollectionService` com os mesmos métodos do `LocalCollectionService`.

## Comandos

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm run build
```

## Deploy (Hetzner)

O site roda em container no Hetzner `178.105.82.48` (`/opt/mello`), atrás do Caddy,
em `127.0.0.1:3060`. A imagem é buildada **localmente** (o servidor não tem RAM nem
disco para `next build`) e enviada com `docker save | docker load`:

```bash
docker build --platform linux/amd64 -t mello-app:latest .
docker save mello-app:latest | gzip -1 | ssh -i ~/.ssh/hetzner_avilaops root@178.105.82.48 'gunzip | docker load'
ssh -i ~/.ssh/hetzner_avilaops root@178.105.82.48 'cd /opt/mello && docker compose up -d app'
```

- Banco: container `mello-db` (Postgres 16, volume `mello-pgdata`), exposto só em
  `127.0.0.1:5436` para `prisma db push` via túnel SSH
  (`ssh -L 5436:127.0.0.1:5436 ...` e `npx prisma db push --url postgresql://mello:<senha>@127.0.0.1:5436/mello`).
- Variáveis em `/opt/mello/.env` - ver `.env.production.example`.
- DNS: `mello.avilaops.com` → A `178.105.82.48` (DNS-only). O domínio do cliente fica
  na Redehost (e-mail é Redehost, MX/SPF intocados): `www` CNAME `mello.avilaops.com`
  e apex A `178.105.82.48`.
- Caddy: `mello.avilaops.com` e `mellotransportesriopreto.com.br` → 3060; `www`
  redireciona 301 para o apex. Quando o DNS do cliente virar, trocar `NEXTAUTH_URL`
  para `https://mellotransportesriopreto.com.br` e rodar `docker compose up -d app`.
