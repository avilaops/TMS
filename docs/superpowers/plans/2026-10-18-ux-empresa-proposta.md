# UX de Empresa e Proposta — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar as configurações da empresa utilizáveis no desktop e transformar a proposta da cotação em um resumo comercial responsivo e compartilhável.

**Architecture:** Manter as rotas e modelos existentes. A página Empresa passa a usar a mesma navegação por seção em todos os tamanhos, com integrações agrupadas em uma grade operacional; o diálogo da proposta continua isolado, mas ganha resumo estruturado, atalhos de validade e ações de WhatsApp e cópia.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS 4 e Vitest/jsdom.

**Spec:** Aprovação no chat das melhorias propostas para as duas telas enviadas pelo usuário.

## Global Constraints

- Nenhuma alteração de banco, dependência, servidor ou produção.
- Nenhum commit ou push antes de testes completos e prints desktop/mobile revisados.
- Segredos e chaves completas aparecem apenas na resposta que os cria.
- O envio ao WhatsApp abre uma mensagem para revisão; não envia automaticamente.
- Manter todas as ações e permissões atuais.

## Review Focus

- A troca de aba deve esconder as demais seções também no desktop.
- Telas estreitas devem manter cabeçalho e ações acessíveis sem rolagem horizontal.
- Cotação sem telefone deve abrir o compartilhamento do WhatsApp sem destinatário fixo.
- Cotação sem valor deve continuar bloqueando cópia e WhatsApp.
- Troca de chave deve exigir confirmação sem afetar a primeira criação.

---

### Task 1: Navegação e integrações da empresa

**Files:**
- Modify: `tests/lojas-logistica-tela.test.tsx`
- Modify: `src/app/dashboard/empresa/page.tsx`

**Interfaces:**
- Consumes: respostas atuais de `/api/empresa/webhook` e `/api/empresa/integracoes/lojas`.
- Produces: abas responsivas, estados operacionais e ações seguras sem mudar contratos HTTP.

- [x] Escrever testes que exijam navegação desktop por aba, estado vazio orientado e confirmação ao trocar a chave.
- [x] Executar os testes direcionados e confirmar falha pela ausência dos novos comportamentos.
- [x] Implementar layout largo, visibilidade por aba em todos os tamanhos e cartões operacionais de integração.
- [x] Executar os testes direcionados até passarem.

### Task 2: Proposta comercial responsiva

**Files:**
- Modify: `tests/crm-tela.test.tsx`
- Modify: `src/app/dashboard/crm/page.tsx`
- Modify: `src/components/cotacao/PropostaDaCotacao.tsx`

**Interfaces:**
- Consumes: dados existentes do lead, incluindo telefone, rota, volumes, peso e valor.
- Produces: resumo comercial, atalhos de validade, link seguro do WhatsApp e cópia com retorno visível.

- [x] Escrever testes para resumo, validade rápida, WhatsApp com e sem telefone e bloqueio sem valor.
- [x] Executar os testes direcionados e confirmar falha pelos elementos ausentes.
- [x] Implementar o diálogo em tela cheia no mobile e duas colunas no desktop, sem alterar a cotação.
- [x] Executar os testes direcionados até passarem.

### Task 3: Verificação visual e regressão

**Files:**
- Create: `artifacts/empresa-integracoes-desktop.png`
- Create: `artifacts/empresa-integracoes-mobile.png`
- Create: `artifacts/cotacao-proposta-ux-desktop.png`
- Create: `artifacts/cotacao-proposta-ux-mobile.png`

**Interfaces:**
- Consumes: Tasks 1 e 2 concluídas.
- Produces: evidência visual revisada e resultados de lint, tipos e testes.

- [x] Executar testes direcionados, suíte completa, lint do escopo, typecheck e `git diff --check`.
- [x] Gerar e revisar os quatro prints em desktop e mobile.
- [x] Corrigir qualquer regressão encontrada e repetir as verificações afetadas.
- [x] Parar antes de commit, push ou merge e apresentar o resultado ao usuário.
