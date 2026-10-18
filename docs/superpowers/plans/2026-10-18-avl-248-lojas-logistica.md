# AVL-248 Lojas Logistics Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar o contrato logístico versionado entre Lojas e TMS, da cotação multi-origem ao rastreio e à reversa.

**Architecture:** A API pública autentica o tenant por slug e chave hash, entra no contexto RLS desse tenant e reaproveita `Collection`, ocorrências e comprovantes. Novas tabelas guardam ordem, remessas e idempotência; a fila transacional existente devolve mudanças ao consumidor.

**Tech Stack:** Next.js 16, TypeScript, Zod, Prisma 7, PostgreSQL, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-18-avl-248-lojas-logistica-design.md`

## Global Constraints

- Linear `AVL-248` é a fonte do escopo.
- Toda tabela de negócio tem `tenantId`, RLS e vínculo coberto por `tms_mesmo_tenant`.
- Toda rota interna nova exige capacidade e cobertura em `tests/perfis.test.ts`.
- Credencial só é devolvida na rotação e nunca é persistida em texto aberto.
- Sem commit ou push antes dos testes completos e prints desktop/mobile.
- Build, testes pesados e imagem rodam no GitHub Actions; servidor recebe somente a imagem pronta.

## Review Focus

- Mesma chave idempotente com corpo diferente retorna `409` sem executar efeito.
- Ordem de outro tenant não pode ser inferida por status, tempo ou mensagem.
- Cancelamento parcial não altera nenhuma carga quando uma delas já saiu.
- Reversa repetida não cria segunda carga nem segunda inspeção.
- Comprovante com foto não vaza `dataUrl` na API nem no webhook.

---

### Task 1: Persistência multi-tenant

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/sql/040-lojas-logistica.sql`
- Modify: `prisma/sql/010-rls.sql`
- Test: `tests/lojas-logistica.test.ts`

**Interfaces:**
- Produces: credencial, ordem, remessa e requisição idempotente relacionadas ao tenant.

- [ ] Escrever testes de schema, RLS, chaves únicas e gatilho entre tenants.
- [ ] Executar os testes e confirmar falha pela ausência das tabelas.
- [ ] Adicionar os modelos e SQL idempotente, incluindo índices e constraints.
- [ ] Gerar o Prisma Client e executar os testes até passarem.

### Task 2: Contrato, autenticação e idempotência

**Files:**
- Create: `src/lib/lojas-logistica.ts`
- Create: `src/lib/lojas-logistica-auth.ts`
- Create: `src/lib/lojas-logistica-db.ts`
- Test: `tests/lojas-logistica.test.ts`

**Interfaces:**
- Produces: schemas Zod, `autenticarLojas(request, slug)`, executor idempotente e serializadores sem segredos.

- [ ] Testar limites, modalidades e normalização do contrato.
- [ ] Testar hash, comparação constante e erros genéricos da autenticação.
- [ ] Testar repetição idêntica, conflito de corpo e retomada após falha transitória.
- [ ] Implementar somente as funções necessárias para os testes.

### Task 3: Cotação e confirmação multi-origem

**Files:**
- Create: `src/app/api/integracoes/lojas/v1/empresas/[empresa]/cotacoes/route.ts`
- Create: `src/app/api/integracoes/lojas/v1/empresas/[empresa]/ordens/route.ts`
- Modify: `src/lib/lojas-logistica-db.ts`
- Test: `tests/lojas-logistica-rotas.test.ts`

**Interfaces:**
- Consumes: autenticação, idempotência e cálculo de frete.
- Produces: uma ordem cotada e zero ou uma remessa por origem ao confirmar.

- [ ] Testar CIF, FOB, retirada, transportadora própria, pallets e falta de tabela.
- [ ] Testar duas origens gerando duas `Collection` sem duplicar cobrança.
- [ ] Implementar as rotas e a transação atômica de confirmação.
- [ ] Verificar respostas e estado persistido em PostgreSQL real.

### Task 4: Consulta, cancelamento e retorno operacional

**Files:**
- Create: `src/app/api/integracoes/lojas/v1/empresas/[empresa]/ordens/[externalId]/route.ts`
- Create: `src/app/api/integracoes/lojas/v1/empresas/[empresa]/ordens/[externalId]/cancelamento/route.ts`
- Modify: `src/lib/lojas-logistica-db.ts`
- Modify: `src/lib/eventos.ts`
- Test: `tests/lojas-logistica-rotas.test.ts`

**Interfaces:**
- Produces: fotografia da ordem com remessas, rastreio, ocorrências, comprovantes e SLA; cancelamento atômico; eventos de outbox.

- [ ] Testar fotografia sem conteúdo binário do comprovante.
- [ ] Testar SLA dentro/fora do prazo e estado agregado de múltiplas remessas.
- [ ] Testar cancelamento permitido, tardio e repetido.
- [ ] Implementar leitura, cancelamento e eventos com `dedupeKey`.

### Task 5: Logística reversa e inspeção

**Files:**
- Create: `src/app/api/integracoes/lojas/v1/empresas/[empresa]/reversas/route.ts`
- Create: `src/app/api/integracoes/lojas/v1/empresas/[empresa]/reversas/[externalId]/inspecao/route.ts`
- Modify: `src/lib/lojas-logistica-db.ts`
- Test: `tests/lojas-logistica-rotas.test.ts`

**Interfaces:**
- Produces: ordem reversa ligada ao RMA, remessa de retorno e decisão de inspeção única.

- [ ] Testar RMA obrigatório, direção invertida e reenvio idempotente.
- [ ] Testar decisões finais válidas, decisão duplicada e isolamento por tenant.
- [ ] Implementar criação e inspeção em transações atômicas.

### Task 6: Administração da integração

**Files:**
- Create: `src/app/api/empresa/integracoes/lojas/route.ts`
- Modify: `src/app/dashboard/empresa/page.tsx`
- Modify: `src/lib/permissoes.ts`
- Modify: `tests/perfis.test.ts`
- Create: `tests/lojas-logistica-tela.test.tsx`

**Interfaces:**
- Produces: leitura do estado, rotação de chave e lista recente; seção “Integração Lojas”.

- [ ] Testar autorização administrativa, exibição única e ausência posterior da chave.
- [ ] Testar tela desktop/mobile logicamente: estado, rotação e ordens.
- [ ] Implementar API, capacidade e seção administrativa acessível.

### Task 7: Evidências e gate final

**Files:**
- Modify: `README.md`
- Modify: `.agents/equipe/controle.json`
- Create: `artifacts/avl-248-lojas-desktop.png`
- Create: `artifacts/avl-248-lojas-mobile.png`

**Interfaces:**
- Consumes: módulo completo.
- Produces: documentação, prints e evidências para Linear/GitHub.

- [ ] Rodar testes direcionados com PostgreSQL real.
- [ ] Rodar `npm run typecheck`, lint do escopo, `npm test` e `npm run build`.
- [ ] Capturar e inspecionar desktop e mobile antes do commit.
- [ ] Fazer o único commit/push, abrir PR, aguardar CI e revisar o diff.
- [ ] Mesclar somente com todos os gates verdes e atualizar `AVL-248` com evidências.
