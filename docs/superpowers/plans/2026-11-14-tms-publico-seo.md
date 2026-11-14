# TMS • Site público e SEO • Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar a área comercial e o Blog do TMS, com indexação, conteúdo MDX e mensuração consentida, preservando os dados operacionais.

**Architecture:** A raiz mostra conteúdo público sem sessão e mantém o redirecionamento autenticado atual. Um catálogo explícito define as únicas páginas indexáveis e mensuráveis. MDX público é renderizado/servido pelo servidor; documentos de rotas internas não têm publicação pública. Google e Render são configurados pelas APIs autorizadas.

**Tech Stack:** Next.js 16.2.12, React 19, Tailwind 4, MDX compatível com Next, Vitest, Playwright, GA4, GTM e Render.

**Spec:** `docs/superpowers/specs/2026-11-14-tms-publico-seo-design.md`, aprovado pelo usuário em 14/11/2026.

## Global Constraints

- Só URLs canônicas de `https://tms.avilaops.com` entram no sitemap.
- Áreas protegidas, login, rastreio e APIs permanecem não indexáveis e sem mensuração.
- Nenhum dado de cliente, query, hash, CPF/CNPJ ou identificador operacional segue ao Google.
- Estatísticas dependem de aceite explícito; publicidade permanece negada.
- Não executar testes em banco de produção, nem modificar criptografia/permissões do Auth.
- Conteúdo fiscal baseado em fontes oficiais, sem prometer CT-e OS nativo ou emissão NF-e inexistente.
- Usar • nos separadores; não publicar preços ou resultados inventados.
- Preservar as alterações locais alheias no checkout original.
- Novo pedido de CMS cortesia é uma frente adicional em descoberta; não bloqueia este desenho já aprovado e não será anunciado como disponível antes da implementação.

## Review Focus

1. Sessão autenticada continua indo à área correta; visitante anônimo vê a landing.
2. Rotas desconhecidas, caminhos codificados e MDX internos não entram em indexação nem leitura pública.
3. Navegação SPA após aceite não envia dados de rotas privadas e não duplica page views.
4. Rejeição/revogação impede requests de analytics e preserva cookies necessários ao login.
5. Build no CI usa IDs de tracking em runtime e promove o digest correto ao Render.

## Task 1 • Catálogo público, metadados e descoberta

**Files:** `src/lib/public-site.ts`, `src/lib/public-seo.ts`, `src/app/sitemap.ts`, `src/app/robots.ts`, `src/app/llms.txt/route.ts`, `next.config.ts`, `public/robots.txt`, `tests/public-site.test.ts`.

**Interfaces:** `getPublicPage(path: string): PublicPage | undefined`, `PUBLIC_PAGES`, `publicMetadata(path: string): Metadata`. `PublicPage` contém path, title, description, updatedAt e tipo. Só o catálogo define as páginas indexáveis.

- [ ] Escrever e executar testes RED para allowlist, canonical, privacidade de paths/queries, sitemap e llms sem rotas operacionais.
- [ ] Implementar catálogo com raiz, Sobre, Blog, quatro artigos e políticas. Gerar robots/sitemap/llms do catálogo, remover conflito de robots estático e adicionar cabeçalhos não indexáveis de rotas internas e alias Render.
- [ ] Executar `npm test -- tests/public-site.test.ts` com Postgres exclusivamente local de teste. Expected: todos aprovados, sem fallback permissivo para rotas desconhecidas.

## Task 2 • Páginas, conteúdo fiscal e identidade

**Files:** `src/app/page.tsx`, `src/app/(publico)/layout.tsx`, páginas Sobre/Blog/artigos/privacidade/cookies, `src/components/publico/*`, `src/content/*`, `content/public/*`, `mdx-components.tsx`, `src/app/layout.tsx`, assets de marca e `tests/public-home.test.tsx`.

**Interfaces:** `PublicShell({children})`, `LandingPage()`, catálogo de artigos `getArticle(slug)` e componentes MDX server-side. O redirecionamento autenticado continua consumindo `AREA_DO_PERFIL`.

- [ ] Escrever e executar RED para raiz anônima pública, usuário sem empresa e perfis autenticados com os mesmos destinos atuais.
- [ ] Adicionar MDX compatível com a versão fixada do Next e implementar páginas SSR com layout responsivo, CTAs reais e marca existente.
- [ ] Escrever artigos com fontes CONFAZ/portais oficiais e metadados próprios; descrever somente capacidades fiscais existentes.
- [ ] Executar testes de raiz, tipos e lint do escopo. Expected: HTML público e destinos autenticados corretos, sem exposição de dados reais.

## Task 3 • Consentimento e analytics sem dados operacionais

**Files:** `src/lib/public-analytics.ts`, `src/components/publico/Consentimento.tsx`, `src/components/publico/AnalyticsPublico.tsx`, testes de helpers e consentimento.

**Interfaces:** `publicPageEvent(pathname, origin)` retorna payload sanitizado apenas para o catálogo; `readConsent`/`saveConsent` versionados; runtime `TMS_GTM_CONTAINER_ID` e `TMS_GA4_MEASUREMENT_ID` validados no servidor.

- [ ] Escrever e executar RED para default negado, aceite, rejeição, revogação, URL com query/fragmento, navegação privada e ausência de duplicação.
- [ ] Implementar preferências acessíveis e carregamento único do GTM após aceite em página pública; limpar somente cookies de analytics deste TMS ao revogar.
- [ ] Criar/reutilizar propriedade GA4 e contêiner GTM exclusivos; desativar page views/enhanced measurement automáticos e publicar tags só para eventos públicos explícitos.
- [ ] Executar testes e prova de rede no navegador. Expected: nenhum request Google sem aceite, nenhuma mensuração privada/PII, uma visualização por navegação pública.

## Task 4 • MDX para todas as páginas e previews

**Files:** `scripts/public-content.mjs`, `content/internal/**`, `src/app/conteudo/[...slug]/route.ts`, `src/app/og/[slug]/route.tsx`, `tests/public-content.test.ts`.

**Interfaces:** manifesto explícito de conteúdo público com canonical HTML; gerador documenta cada padrão `page.tsx` interno sem ler banco. O handler aceita somente documentos conhecidos, nunca um pathname de filesystem.

- [ ] Escrever e executar RED para cobertura de todas as rotas, artigos, bloqueio de MDX interno e tentativas de traversal.
- [ ] Gerar documentação interna por padrão de rota e arquivos públicos por página/artigo, preservando conteúdo útil. Alternativas textuais recebem canonical para HTML e não geram duplicação no sitemap.
- [ ] Gerar previews 1200×630 por página com marca e fallback seguro; reutilizar favicons fornecidos.
- [ ] Executar testes e conferir conteúdo/preview no navegador. Expected: cobertura completa, somente conteúdo público acessível e imagens válidas.

## Task 5 • CI, deploy e verificação em produção

**Files:** `.github/workflows/deploy-production.yml`, script de deploy Render sem segredos embutidos, documentação de operação e evidências.

- [ ] Ajustar destino antigo SSH para promoção da imagem CI por digest no serviço Render existente, usando segredo/variável próprios do repositório.
- [ ] Executar testes relevantes, `npm run typecheck`, lint e `git diff --check`; verificar navegação e consentimento em 1440/390 px. Expected: todos aprovados e sem mudanças operacionais inesperadas.
- [ ] Fazer revisão final fresca conforme Executing Plans, corrigir achados importantes com regressão e verificar CI/build.
- [ ] Publicar a revisão aprovada no Render. Expected: saúde 200 com commit correspondente, páginas públicas 200/index, privadas protegidas/noindex, sitemap/robots/llms corretos, previews e MDX funcionais.

## Task 6 • Search Console e evidência de mensuração

- [ ] Validar sitemap e URLs antes do envio; enviar à propriedade verificada `sc-domain:tms.avilaops.com`.
- [ ] Consultar presença/processamento sem confundir envio com indexação/posicionamento.
- [ ] Validar requests GA4 e tentar confirmar eventos recebidos por API/relatório, sem chamar cliques de contato de leads concluídos.
- [ ] Registrar IDs públicos, fontes fiscais, checks, capturas, limites e estado real de cada integração. Expected: relatório final separa publicado, medido e pendente.

## Task 7 • CMS cortesia por transportadora

**Spec adicional:** `docs/superpowers/specs/2026-11-14-tms-cms-cortesia-design.md`. Pedido adicional do usuário com orientação para continuar.

**Files:** `prisma/schema.prisma`, SQL aditivo versionado, `src/lib/carrier-site.ts`, `src/lib/carrier-site-store.ts`, `/api/site`, `/api/site/publicacao`, `/dashboard/site`, `/transportadoras/[empresa]/[[...pagina]]`, metadados/sitemap e testes de isolamento/publicação.

**Interfaces:** `CarrierSiteDraft` validado e limitado; `publicSiteSnapshot(draft)` exclui artigos não publicados. Store privado deriva tenant exclusivamente da sessão; leitura pública retorna somente snapshot publicado de Tenant ativo. Revisão inteira controla concorrência.

- [ ] Escrever e executar RED de snapshot/validação, colisão de revisão, papéis e duas empresas isoladas.
- [ ] Implementar rascunho/publicação e editor estruturado, com site público responsivo, marca, Sobre, Serviços, Contato e Blog.
- [ ] Incluir somente conteúdo publicado de empresas ativas no sitemap e na alternativa MDX; sites das transportadoras não usam analytics do produto.
- [ ] Executar testes locais/CI, salvar backup de produção e aplicar apenas SQL aditivo antes da publicação. Expected: dados anteriores preservados, API privada por capacidade, rascunhos invisíveis e nenhum custo de módulo criado.

## Ledger

- 14/11/2026 • CI reproduziu dependência de ordem: a verificação do SQL 044 foi executada antes da criação de tms_app. A checagem de reaplicação passa para depois de db:rls, mantendo os mesmos testes e o limite existente de cada job; o SQL não foi aplicado em produção.

- 14/11/2026 • Final review: revisor fresco `tms_final_review`, somente leitura; cinco achados importantes, zero menores e nenhum comportamento deixado sem julgamento.
- 14/11/2026 • Final: fixed cookies padrão restantes — regressão de analyticsCookies RED→GREEN; defaults globais agora incluem prefixo/domínio antes do Google. Validação de navegador reforçada para cookies reais dessa propriedade.
- 14/11/2026 • Final: fixed IDs de runtime em páginas estáticas — public-runtime exige connection() antes da leitura; RED→GREEN.
- 14/11/2026 • Final: fixed corrida entre save e resposta — integração com segunda gravação antes da resposta reproduziu revisão alheia; resposta passa a usar o resultado da própria transação, RED→GREEN.
- 14/11/2026 • Final: fixed perda de edição ao retirar do ar — teste do editor preserva o texto não salvo, RED→GREEN.
- 14/11/2026 • Final: fixed slug com hífens consecutivos — integração de empresa cliente--sul usa o normalizador existente e publica/lê corretamente, RED→GREEN. Suíte integral pós-correções será validada pelo CI.
- 14/11/2026 • Banco de produção: backup local validado e cópia R2 verificada por SHA-256 `6f0dcddcd8955c082911923f46a94a837a8a2f12cc62120bab9b26d7f26aeb76`, chave `db/tms-before-cms-2026-11-14T10-55-08-283Z.dump`. Migração ainda não aplicada. Dados observados: 2 empresas, 7 usuários, 2 clientes, 4 coletas.
- 14/11/2026 • Navegador CMS local: rascunho 404, publicado 200, retirado 404; mobile sem overflow, texto com script escapado, Markdown seguro e zero requests de analytics do produto.

- 14/11/2026 • Tasks 1 e 2: catálogo de 9 documentos, landing anônima e destinos autenticados preservados; 30 testes iniciais RED→GREEN. Sobre, Blog, quatro artigos fiscais e políticas implementados com MDX local e referências oficiais.
- 14/11/2026 • Task 3: propriedade GA4 564318824 e container GTM-56VSVMSL criados na conta Avila Ops; versão 2 publicada com quatro eventos explícitos. Mensuração automática desativada, publicidade negada, retenção de dois meses. Teste real revelou um page_view automático com URL original; defaults sanitizados antes do carregamento corrigiram o vazamento e a duplicação. Browser RED→GREEN: uma coleta canônica, zero parâmetros/fragmentos, zero requests antes do aceite, após recusa ou ao entrar no login.
- 14/11/2026 • Task 4: imagens OG por documento e marca reaproveitada. Inventário MDX cobre 73 páginas/padrões e nove exportações públicas; documentação interna permanece fora do servidor público. HTML fiscal validado com JavaScript desligado e layout sem overflow em 1440/390 px.
- 14/11/2026 • Task 7: CMS implementado com editor, rascunho separado, snapshot, revisão otimista, publicação por Administrador, sites e previews por transportadora ativa. Seis testes de validação/API/RLS passaram com duas empresas locais; matriz de permissões ampliada explicitamente e 43 testes passaram.
- 14/11/2026 • Task 5 em curso: promoção Render por digest substitui SSH legado. Nenhum teste usa banco de produção; suíte integral local em execução. Migração/publicação/GSC ainda pendentes.

- 14/11/2026 • Desenho aprovado. Execução nativa nesta sessão para manter as interfaces acopladas no mesmo contexto; revisão fresca final obrigatória. Sem nova autorização para publicar, pois o usuário aprovou implementar e publicar.
- 14/11/2026 • Worktree nativo falhou porque a raiz da tarefa não é repositório; criado checkout Git isolado em `C:/Users/nicol/source/.worktrees/tms-publico-seo`, ramo `codex/tms-publico-seo`, base `c207efdbced1d3f97ac9506024897eb350572c8f`.
- 14/11/2026 • Reaproveitados somente assets de marca relacionados; exclusão de `.env.example` e spec SaaS preexistentes permanecem no checkout original.
- 14/11/2026 • Ruling: CMS cortesia será uma primeira versão enxuta dentro do TMS. O CMS central tem funcionalidades prontas, mas está indisponível; depender de sua recuperação impediria a cortesia agora. Custo da escolha: dois editores temporariamente separados, com possível integração futura.
- 14/11/2026 • Novo CMS requer tabela aditiva; a restrição de não migrar banco do desenho público continua valendo para o site comercial, e é ampliada somente para esta tabela nova, com backup e sem alterações destrutivas.
