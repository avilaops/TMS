# Mello Transportes Rio Preto

Site institucional e sistema de gestão da **Mello Transportes Rio Preto**, transportadora de cargas fracionadas com sede em São José do Rio Preto/SP e atendimento em mais de 130 cidades da região.

- Site: https://mellotransportesriopreto.com.br
- Espelho técnico: https://mello.avilaops.com
- Roadmap do sistema: [ROADMAP.md](ROADMAP.md)

## O que tem aqui

Uma aplicação Next.js só, com quatro públicos:

| Área | Rota | Quem acessa | O que faz |
| --- | --- | --- | --- |
| Site público | `/`, `/cotacao`, `/blog`, `/rastreio` | Qualquer pessoa | Landing, cidades atendidas, frota, cotação e coleta pelo WhatsApp, blog, rastreio |
| Mello Gestão | `/dashboard` | `ADMIN`, `OPERATION` | Clientes, CRM, coletas, manifestos, motoristas, veículos e manutenção, financeiro, fiscal/CT-e, mensagens |
| Mello Motorista | `/driver` | `DRIVER` | PWA com viagens, mapa, baixa de entrega com comprovante e fila offline |
| Mello Cliente | `/portal` | `CLIENT` | Coletas, faturas e minutas da própria empresa |

O controle de acesso por perfil fica em [src/proxy.ts](src/proxy.ts). Perfis são estritos: um `ADMIN` não entra em `/driver` nem em `/portal`, porque não tem motorista nem empresa vinculados.

## Stack

- **Next.js 16** (App Router, `output: "standalone"`), **React 19**, **TypeScript**
- **Tailwind CSS 4** e componentes shadcn/Base UI
- **Prisma 7** com `@prisma/adapter-pg` e **PostgreSQL 16**
- **NextAuth 4** com login por e-mail e senha (bcrypt) e sessão JWT
- **Leaflet** para mapas, **Zod** e **React Hook Form** para formulários
- Docker, GitHub Actions (GHCR) e Caddy no Hetzner

> Esta versão do Next.js tem mudanças de API em relação a versões anteriores (por exemplo, `middleware.ts` virou `proxy.ts`). Antes de mexer, consulte `node_modules/next/dist/docs/`.

## Rodando localmente

Requisitos: Node 22+ e um Postgres acessível.

```bash
npm install
cp .env.example .env          # preencha DATABASE_URL e NEXTAUTH_SECRET
npx prisma generate
npx prisma db push            # cria as tabelas
ADMIN_EMAIL=voce@exemplo.com ADMIN_PASSWORD=troque npx tsx prisma/seed.ts
npm run dev
```

O site público abre sem banco. Login, painel, portal, motorista e as rotas `/api` precisam do Postgres.

Para subir só o banco com Docker:

```bash
DB_PASSWORD=mello docker compose up -d db   # expõe em 127.0.0.1:5436
```

### Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção (standalone) |
| `npm start` | Sobe o build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |

### Variáveis de ambiente

Todas estão documentadas em [.env.example](.env.example). As essenciais:

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Conexão Postgres |
| `NEXTAUTH_URL` | URL pública do site |
| `NEXTAUTH_SECRET` | Assinatura do JWT de sessão |
| `NEXT_PUBLIC_GTM_ID` | Google Tag Manager (opcional) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Seed do administrador |

## Estrutura

```text
src/
  app/            rotas (site, dashboard, driver, portal, blog, api)
  components/     UI, site, motorista, analytics
  config/         dados da empresa (company.ts)
  content/        matérias do blog (blog.ts)
  data/           cidades, frota, serviços, FAQ, marca
  lib/            auth, prisma, formatação, WhatsApp, Brasil API, fila offline
  services/       mensagens e protocolos da central de coletas
prisma/           schema, seed e sincronização de artigos
public/           ícones, manifestos PWA, service worker, capas do blog
pdf-generator/    gera o PDF de regras de frete e cidades atendidas
docs/             manual de marca (texto)
Criativos/        artes e vídeos de anúncio
```

## Como atualizar o conteúdo

| O quê | Onde |
| --- | --- |
| Telefone, WhatsApp, e-mail, endereço | [src/config/company.ts](src/config/company.ts) |
| Cidades, polos, prazos e veículos por rota | [src/data/serviceAreas.csv](src/data/serviceAreas.csv) |
| Frota | [src/data/fleet.ts](src/data/fleet.ts) |
| Serviços | [src/data/services.ts](src/data/services.ts) |
| FAQ | [src/data/faq.ts](src/data/faq.ts) |
| Depoimentos | [src/data/testimonials.ts](src/data/testimonials.ts) |
| Mensagens e protocolos de coleta | [src/services/collectionService.ts](src/services/collectionService.ts) |
| Identidade visual e paleta | [src/data/brand.ts](src/data/brand.ts) |
| Manual de marca | [docs/manual-marca-mello.txt](docs/manual-marca-mello.txt) e [public/manual-marca-mello.pdf](public/manual-marca-mello.pdf) |
| Tabela de fretes | `TABELA FRETES 2026 A ABRIL 2027.xlsx` e [tabela_frete_serilon.csv](tabela_frete_serilon.csv) |

**Não publique** depoimentos, número de entregas, nomes de clientes ou tempo de mercado sem confirmação comercial.

### Dados de contato

- Telefone: (17) 3308-0878
- WhatsApp: (17) 99714-9702
- E-mail: comercial@mellotransportesriopreto.com.br
- Endereço: Rua Bonsucesso, 695, Quinta das Paineiras, São José do Rio Preto/SP

## Blog

As matérias ficam em [src/content/blog.ts](src/content/blog.ts) como blocos tipados. Para publicar, acrescente um objeto em `posts` com `slug`, `title`, `description`, `excerpt`, `category`, `publishedAt`, `readingMinutes` e `body` (opcionalmente `coverImage` e `coverImageAlt`).

A matéria entra sozinha no índice `/blog`, ganha a página `/blog/<slug>` pré-renderizada, aparece no `sitemap.xml` e recebe os dados estruturados de `Article`.

Blocos aceitos no `body`: `p`, `h2`, `h3`, `ul`, `ol`, `note` e `table`. Dentro dos textos, `**assim**` vira negrito. As capas vão em [public/blog-capas/](public/blog-capas/README.md).

### Conteúdo e distribuição no banco

O texto continua no arquivo; o banco guarda o que acontece depois da publicação:

- `Article`: espelho das matérias (slug, título, categoria, data). A página nunca lê daqui.
- `SocialPost`: um post por canal (`BLOG`, `INSTAGRAM`, `GOOGLE_BUSINESS`, `FACEBOOK`, `LINKEDIN`, `WHATSAPP_STATUS`). Único por (canal, id externo), então repetir a chamada não publica duas vezes.
- `ContentMetric`: impressões, cliques, posição e CTR por matéria e dia. Único por (matéria, data).

```bash
npx tsx prisma/sincronizar-artigos.ts             # ensaio, não grava
npx tsx prisma/sincronizar-artigos.ts --aplicar   # grava
```

Matéria com o mesmo slug é atualizada. Matéria removida do arquivo só é reportada, nunca apagada, para não levar o histórico de posts junto.

### Automação no n8n

O fluxo `Mello - Blog automático` (`WR18HLwdT9NDuPFd`) roda toda quinta às 08:00 e **não publica nada**: entrega por e-mail a matéria pronta para colar em `blog.ts`.

1. Lê a pauta em `mello_blog_pauta` e descarta temas já escritos (`mello_blog_temas_feitos`).
2. Escreve com a OpenAI, no máximo 3 temas por rodada.
3. Um revisor dá nota de 0 a 100; abaixo de 85 há uma reescrita.
4. Gera a capa (foto por IA, sem texto nem logotipo) e aplica a assinatura da marca com a logo branca.
5. Monta o bloco TypeScript e envia por e-mail com a capa anexa.
6. Recorta a arte do Instagram (1080x1350), sobe na pasta "Mello Transportes - artes do blog" do Drive e abre uma tarefa no Todoist com legenda e hashtags.

Regras que evitam erro silencioso: o slug vem da pauta, nunca da IA; travessão reprova o texto; a IA devolve `Block[]` tipado; o nome da arte é determinístico e a versão anterior é substituída; quando a fila fica vazia, o e-mail traz o diagnóstico em vez de sair em branco.

## Deploy

### Automático (GitHub Actions)

[.github/workflows/deploy-production.yml](.github/workflows/deploy-production.yml) usa os workflows reutilizáveis de `avilaops/infra`:

- Todo push e PR em `main` builda a imagem Docker. Fora de PR, ela é publicada no GHCR.
- O deploy por SSH só roda quando a variável `DEPLOY_ENABLED` do repositório for `true`, com os segredos `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` e `DEPLOY_KNOWN_HOSTS`.

### Manual (Hetzner)

O app roda em `/opt/mello` atrás do Caddy, em `127.0.0.1:3060`. O servidor não tem memória para `next build`, então a imagem é gerada localmente:

```bash
docker build --platform linux/amd64 -t mello-app:latest .
docker save mello-app:latest | gzip -1 | ssh root@<servidor> 'gunzip | docker load'
ssh root@<servidor> 'cd /opt/mello && docker compose up -d app'
```

- **Banco:** container `mello-db` (Postgres 16, volume `mello-pgdata`), exposto só em `127.0.0.1:5436`. Para `prisma db push`, abra um túnel SSH para essa porta.
- **Variáveis:** `/opt/mello/.env`, a partir de [.env.example](.env.example).
- **Caddy:** `mello.avilaops.com` e `mellotransportesriopreto.com.br` apontam para a porta 3060; `www` redireciona 301 para o apex.
- **DNS:** o domínio do cliente fica na Redehost, com e-mail (MX/SPF) intocado. Ao virar o DNS, ajuste `NEXTAUTH_URL` para `https://mellotransportesriopreto.com.br` e rode `docker compose up -d app`.
- **SEO:** as URLs do site antigo (`/empresa`, `/servicos`, `/faca-um-orcamento` etc.) redirecionam com 301 em [next.config.ts](next.config.ts).

## Gerador de PDF de fretes

Projeto separado em [pdf-generator/](pdf-generator/README.md) que gera o PDF com tarifas, regras de frete, frota e cidades atendidas a partir de `tabela_frete_serilon.csv`.

```bash
cd pdf-generator && npm install && npm run generate
```

---

Desenvolvido e mantido por [Ávila Ops](https://avilaops.com).
