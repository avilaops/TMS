# XML de subcontratadas — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> para executar as tarefas neste checkout, conforme aprovação do usuário.

**Goal:** importar XML privado de CT-e/MDF-e da subcontratada e conferir sua
situação na SEFAZ, com isolamento e auditoria.

**Architecture:** ampliar `SubcontractDocument` com campos opcionais e manter
as validações puras separadas das operações de banco e da consulta. Reutilizar
o parser fiscal, os clientes SOAP e a autenticação por empresa existentes.

**Tech Stack:** Next.js 16, TypeScript, Prisma 7, PostgreSQL, Vitest, React.

**Spec:** [desenho aprovado](../specs/2026-11-12-avl-412-xml-subcontratadas-design.md).

## Global Constraints

- XML de CT-e 4.00 ou MDF-e 3.00 com protocolo; limite de 1 MiB.
- Nenhuma dependência nova para analisar XML; usar o leitor de `nfe.ts`.
- Escrita exige `fiscal`; leitura privada exige `fiscalVer`; preservar RLS.
- Sem serviços fiscais reais, migração ou deploy em produção.
- Testes pesados e imagem no GitHub; registrar limites e timeouts da CI.
- Execução pelo agente atual neste checkout; sem outros agentes/worktree.

## Review Focus

- Documento com chave/protocolo/ambiente incompatível nunca vira autorizado.
- Importação concorrente e XML em registro manual não criam duplicatas.
- Resposta tardia não altera documento excluído ou contrato trocado.
- Homologação e documento comprovadamente inválido não cobrem saída real.
- XML, certificado e senha não aparecem em listas, auditoria ou erros.

## Task 1: leitor e classificação

**Files:** criar `src/lib/subcontratacao-xml.ts` e
`tests/subcontratacao-xml.test.ts`; ampliar regras em `subcontratacao.ts`.

**Interfaces:** `lerXmlDaSubcontratada(xml: string)` devolve resultado
discriminado com documento ou erro, incluindo chave, tipo, dia da emissão,
ambiente, protocolo e UF de descarga. `documentoCobreViagem` decide cobertura
a partir do ambiente e da situação consultada, preservando registro legado.

- [x] Testes primeiro: CT-e/MDF-e válidos, namespaces e campos especiais;
  limites, entidade, nós duplicados, emissão e protocolo divergentes.
- [x] Executar teste e observar falha pela ausência da implementação.
- [x] Implementar leitor e testes de cobertura de saída/ambiente.
- [x] Executar testes direcionados e confirmar aprovação.

## Task 2: persistência privada e API

**Files:** `prisma/schema.prisma`, `prisma/sql/043-subcontratacao-xml.sql`,
`src/lib/subcontratacao-db.ts`, novo `src/lib/subcontratacao-fiscal-db.ts`,
rotas `subcontratacao/importar`, `[documentoId]/xml` e
`[documentoId]/consultar`; `tests/subcontratacao.test.ts` e `tests/perfis.test.ts`.

**Interfaces:** operações recebem `Empresa` e ator/origem existentes.
Lista contém metadados e `hasXml`, nunca arquivo; download recebe viagem e
documento. Consulta ocorre fora da transação e revalida vínculo ao gravar.

- [x] Escrever casos de API para importar, anexar ao registro manual,
  duplicidade, download privado, tenant alheio e perfil sem escrita.
- [x] Acrescentar campos opcionais e SQL idempotente, gerar Prisma.
- [x] Implementar importação com trava da viagem e auditoria sem XML.
- [x] Implementar download e consulta com certificado e clientes existentes.
- [x] Testar consulta autorizada, cancelada, encerrada, inexistente,
  malformada e timeout; confirmar que falha não apaga evidência anterior.
- [x] Testar resposta tardia em documento excluído/contrato alterado.
- [x] Aplicar cobertura de MDF-e à saída e testar homologação/invalidação.
- [ ] Verificar SQL reaplicável e integração com PostgreSQL no GitHub.

## Task 3: tela, documentação e verificação

**Files:** `src/app/dashboard/manifestos/subcontratacao.tsx`,
`tests/subcontratacao-tela.test.tsx`, `README.md`, `docs/ROADMAP.md` e
`.agents/equipe/controle.json`.

- [x] Testar upload e erros, download, ação explícita de consulta,
  rótulos de situação e ausência de escrita para perfil de leitura.
- [x] Implementar a tela mantendo os padrões responsivos existentes.
- [x] Conferir desktop/celular e registrar evidências reproduzíveis.
- [x] Atualizar limites no README/roadmap e registrar estado local/Linear.
- [x] Executar lint do escopo, typecheck e `git diff --check`.
- [ ] Enviar branch e PR de revisão; executar testes completos e build no
  GitHub, sem polling contínuo. Registrar os resultados reais.
- [x] Revisar o diff inteiro e corrigir achados antes de concluir.

## Evidência local e continuação

Em 12/11/2026: 230 testes direcionados aprovados em sete arquivos, com banco
PostgreSQL real; typecheck, lint do escopo sem avisos e diff sem erros.
SQL aplicado e reaplicado. Capturas desktop/mobile e limites da validação em
[avl-412-verificacao.md](../../../artifacts/avl-412-verificacao.md).

Pendente: decisão do usuário sobre a CI atual exceder o limite de 90 segundos
por job. Não executar workflow, declarar CI aprovada ou encerrar a AVL-412
sem resolver essa decisão. Sem merge, migração ou deploy em produção.

O usuário aprovou implementar o desenho neste checkout. Este plano detalha a
execução já autorizada; não adiciona outra etapa de autorização.
