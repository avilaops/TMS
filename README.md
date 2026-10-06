# TMS

Sistema de gestão de transportes para operação terrestre, de carga fracionada e dedicada: coletas, manifestos, motoristas, veículos, financeiro, fiscal/CT-e, app do motorista e portal do cliente.

Nasceu como o sistema da Mello Transportes Rio Preto (este repositório se chamava `Mello`) e ainda roda a operação dela. Em 06/10/2026 o site institucional saiu daqui para [avilaops/mellotransportesriopreto.com.br](https://github.com/avilaops/mellotransportesriopreto.com.br); o que ficou é só o sistema.

- Endereço: https://tms.avilaops.com
- Site da Mello (consome a API pública): https://mellotransportesriopreto.com.br
- Roadmap: [ROADMAP.md](ROADMAP.md)

## O que tem aqui

| Área | Rota | Quem acessa | O que faz |
| --- | --- | --- | --- |
| Gestão | `/dashboard` | `ADMIN`, `OPERATION` | Clientes, CRM, coletas, manifestos, motoristas, veículos e manutenção, financeiro, fiscal/CT-e, mensagens, usuários |
| Motorista | `/driver` | `DRIVER` | PWA com viagens, mapa, baixa de entrega com comprovante e fila offline |
| Cliente | `/portal` | `CLIENT` | Coletas, faturas e minutas da própria empresa |
| API pública | `/api/cotacoes`, `/api/leads`, `/api/rastreio` | Site do transportador | Recebe cotação e lead, responde o rastreio por CNPJ/CPF + código |

Não há página pública: a raiz `/` leva quem já entrou para a própria área e todo o resto para `/login`.

O controle de acesso por perfil fica em [src/proxy.ts](src/proxy.ts) e é conferido de novo no servidor em cada rota interna. Perfis são estritos: um `ADMIN` não entra em `/driver` nem em `/portal`, porque não tem motorista nem empresa vinculados.

### Quem consome a API pública

O site do transportador não chama o TMS do navegador: o servidor do site repassa as três rotas acima (rewrite), então não há CORS. O limite de tentativas do rastreio usa o `x-forwarded-for`, que precisa chegar até aqui com o IP do visitante.

## Stack

- **Next.js 16** (App Router, `output: "standalone"`), **React 19**, **TypeScript**
- **Tailwind CSS 4** e componentes shadcn/Base UI
- **Prisma 7** com `@prisma/adapter-pg` e **PostgreSQL 18**
- **NextAuth 4** com login por e-mail e senha (bcrypt) e sessão JWT
- **Vitest** contra Postgres real
- Docker, GitHub Actions (GHCR) e Caddy no Hetzner

> Esta versão do Next.js tem mudanças de API em relação a versões anteriores (por exemplo, `middleware.ts` virou `proxy.ts`). Antes de mexer, consulte `node_modules/next/dist/docs/`.

## Rodando localmente

Requisitos: Node 22+ e um Postgres acessível. Tudo aqui precisa do banco.

```bash
npm install
cp .env.example .env          # preencha DATABASE_URL e NEXTAUTH_SECRET
npx prisma generate
npx prisma db push            # cria as tabelas
ADMIN_EMAIL=voce@exemplo.com ADMIN_PASSWORD=troque npx tsx prisma/seed.ts
npm run dev
```

Para subir só o banco com Docker:

```bash
docker compose -f docker-compose.dev.yml up -d   # expõe em 127.0.0.1:5436 (usuário, senha e banco: tms)
```

### Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção (standalone) |
| `npm start` | Sobe o build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest; exige `DATABASE_URL` apontando para um Postgres de teste |

### Variáveis de ambiente

Todas estão documentadas em [.env.example](.env.example). As essenciais:

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Conexão Postgres |
| `NEXTAUTH_URL` | URL pública do sistema (`https://tms.avilaops.com` em produção) |
| `NEXTAUTH_SECRET` | Assinatura do JWT de sessão |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Seed do administrador |

## Estrutura

```text
src/
  app/            rotas (dashboard, driver, portal, login, api)
  components/     UI, motorista, provedores
  data/           cidades atendidas (mapa do motorista)
  lib/            auth, prisma, permissões, cadastros, coletas, rastreio, fila offline
prisma/           schema, seed e migrações pontuais
tests/            suíte Vitest contra Postgres
public/           ícones, manifesto do PWA do motorista, service worker
```

## O que ainda é da Mello aqui dentro

A separação tirou o site, não a marca. Para virar produto de mercado ainda falta decidir:

- **Nomes e ícones:** telas, manifesto do PWA e mensagens dizem "Mello".
- **Cidades atendidas:** [src/data/serviceAreas.csv](src/data/serviceAreas.csv) é a malha da Mello, usada no mapa do motorista. Existe uma cópia no repositório do site.
- **Tabelas `Article`, `SocialPost` e `ContentMetric`:** guardam a distribuição do blog da Mello. Continuam no schema para não mexer em dado; o script que as alimentava (`prisma/sincronizar-artigos.ts`) saiu junto com as matérias.
- **Material comercial:** `TABELA FRETES 2026 A ABRIL 2027.xlsx`, `tabela_frete_serilon*.csv`, `regras_frete_serilon.txt`, `Cidades.pdf` e [pdf-generator/](pdf-generator/README.md) são da operação da Mello e ficaram aqui porque o repositório do site é público.
- **Um banco, um transportador:** não há separação por empresa (multi-tenant).

## Deploy

O sistema roda no servidor `applications`, em `/opt/tms-avilaops-com`, atrás do Caddy, e segue a Norma de Plataforma da Ávila Ops (`avilaops/infra`, `NORMA-PLATAFORMA.md`): todo nome sai do domínio e nenhuma porta é publicada no host.

| Recurso | Nome |
| --- | --- |
| Diretório | `/opt/tms-avilaops-com` |
| Projeto compose | `tms-avilaops-com` |
| Container | `tms-avilaops-com-web` (rede `edge`, `172.31.0.11:3000`) |
| Banco e role | `tms_avilaops_com`, no PostgreSQL compartilhado do servidor |
| Imagem | `ghcr.io/avilaops/tms`, por digest |
| Saúde | `GET /api/health` (consulta o banco e devolve o commit em execução) |

O banco não é um container deste projeto: é o PostgreSQL do próprio servidor, o mesmo dos outros sistemas, coberto pelo backup diário de lá. O container o alcança por `host.docker.internal`.

### Automático (GitHub Actions)

[.github/workflows/deploy-production.yml](.github/workflows/deploy-production.yml):

- Todo push e PR em `main` roda typecheck e testes contra um Postgres real; se passarem, a imagem Docker é construída. Fora de PR, ela é publicada no GHCR.
- O deploy por SSH só roda na `main`, com a variável `DEPLOY_ENABLED` do repositório em `true` e os segredos `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` e `DEPLOY_KNOWN_HOSTS`. A chave só tem permissão para publicar a aplicação `tms.avilaops.com`.
- No servidor, o deploy baixa a imagem pelo digest, troca o container e confere `/api/health`; se a versão nova não responder, volta para a anterior.

Os jobs de imagem e deploy são cópia dos de `avilaops/infra` porque este repositório é público e aquele é privado: o GitHub não deixa repositório público chamar workflow reutilizável de repositório privado.

### Banco em produção

Não há migrações versionadas: o schema é aplicado com `prisma db push`, da sua máquina, por túnel SSH. O deploy **não** faz isso sozinho, então mudança de schema precisa ser aplicada antes de o código que depende dela chegar à `main`.

```bash
ssh -N -L 5433:127.0.0.1:5432 applications &
DATABASE_URL="postgresql://tms_avilaops_com:<senha>@127.0.0.1:5433/tms_avilaops_com?schema=public" npx prisma db push
```

- **Variáveis:** `/opt/tms-avilaops-com/.env` (modo 600), a partir de [.env.example](.env.example).
- **Voltar versão:** republicar o commit anterior pela `main`. Não há cópia de código nem de build guardada no servidor.

---

Desenvolvido e mantido por [Ávila Ops](https://avilaops.com).
