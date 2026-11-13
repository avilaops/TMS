# AVL-412 — evidências de implementação

Escopo e desenho aprovados em 12/11/2026: XML privado de CT-e/MDF-e da
subcontratada, consulta explícita à SEFAZ e cobertura de saída da viagem.
Branch: `codex/avl-412-xml-subcontratadas`.

## Verificações locais

- PostgreSQL 19 descartável em loopback, separado dos bancos existentes.
  Rotas, RLS, auditoria, deduplicação e transações testados com banco real.
- SQL `043-subcontratacao-xml.sql` aplicado e reaplicado, sem erro.
- Testes de chave completa, emissão, ambiente, protocolo, entidades,
  atributos e nós repetidos, tamanho UTF-8 e namespaces.
- Consultas de autorização, cancelamento, encerramento e inexistência;
  transporte falho e resposta divergente preservam o registro anterior.
- Dois casos atravessam HTTPS com certificado de teste contra os servidores
  fiscais locais. O contrato foi conferido nos XSDs oficiais versionados:
  `TRetConsSitCTe` e `TRetConsSitMDFe` não ecoam a chave fora do protocolo.
- Concorrência com relógio parado, exclusão e cancelamento do contrato
  durante a chamada; versão inteira impede sobrescrita por resposta antiga.
- Matriz de perfis e regressões de documentos fiscais e telas existentes.

Comando da rodada direcionada, com `DATABASE_URL` apontando ao banco de teste:

```powershell
npm test -- tests/subcontratacao.test.ts tests/subcontratacao-xml.test.ts tests/subcontratacao-consulta.test.ts tests/subcontratacao-xml-tela.test.tsx tests/subcontratacao-tela.test.tsx tests/fiscal.test.ts tests/perfis.test.ts
```

Resultado final em 12/11/2026: **230 testes aprovados em sete arquivos**, sem
testes pulados nessa rodada (50,44 s). `npm run typecheck`, ESLint do escopo
sem avisos e `git diff --check` aprovados. O aviso de depreciação de consultas
concorrentes no cliente `pg` já aparecia na baseline. Nenhum resultado local
substitui a CI completa.

## Capturas do componente real

Chromium headless, API de fixture local, locale pt-BR e America/Sao_Paulo.
Verificação interativa de seleção, importação e consulta; sem overflow
horizontal ou erro de página em 1440×1100 e 390×844:

- [XML no desktop](avl-412-xml-desktop.png).
- [XML no celular](avl-412-xml-mobile.png).
- [Consulta no desktop](avl-412-consulta-desktop.png).
- [Consulta no celular](avl-412-consulta-mobile.png).

As capturas não representam uma sessão autenticada completa nem uma consulta
à SEFAZ real. Nenhum certificado real, XML empresarial, emissão, migração ou
deploy em produção foi usado nesta implementação.

## Validação na CI

A continuação respeita a política de até 90 segundos do Linear: todos os
jobs declaram `timeout-minutes: 1`. Dependências/Prisma usam cache exato;
o build standalone, os tipos fonte e os tipos Next têm jobs separados.
Os testes usam bancos descartáveis com RLS e seleção exata de arquivos.
A suíte longa de MDF-e tem duas partes complementares, ambas repetindo a
conferência acumulada de segredos. Nenhum caso foi retirado da suíte.

- Run [43298174756](https://github.com/avilaops/TMS/actions/runs/43298174756):
  dependências 41 s e build 53 s; shards vazios e timeouts bloquearam checks.
- Run [43300512016](https://github.com/avilaops/TMS/actions/runs/43300512016):
  54 jobs aprovados, incluindo ambos typechecks e build. Os 57 casos do grupo
  1 passaram, mas o job excedeu o minuto e foi corretamente reprovado.
- Matriz corrigida: 101 arquivos em 52 grupos; MDF-e dividido por cenários.
  17 testes locais do planejador aprovados.
- Run [43312304738](https://github.com/avilaops/TMS/actions/runs/43312304738):
  primeira tentativa aprovou MDF-e em 49/54 s e 55 jobs. Outro grupo atingiu
  timeout após 32 s na preparação do PostgreSQL; os casos de baixa passaram,
  mas driver-shell não terminou. Jobs falhos/dependentes reexecutados no mesmo
  SHA. O timeout inicial permanece como falha observada. A tentativa 2 ficou
  **success**: 2.613 casos distintos, ambos typechecks, build e imagem.
  Foram 2.615 execuções porque dois testes de segredo se repetem; nenhum
  cenário ficou sem cobertura. Maior job aprovado: 56 s; imagem: 35 s.
  [Resultado por job](avl-412-ci-43312304738.md).

PR de revisão: [#35](https://github.com/avilaops/TMS/pull/35). O ajuste
seguinte coloca o PostgreSQL descartável em tmpfs de até 512 MiB e reaplica
duas vezes o SQL 043 no runner. A confirmação dessa revisão fica nos
[checks da PR](https://github.com/avilaops/TMS/pull/35/checks).

Revisão de código realizada pelo próprio agente com o checklist de revisão;
não houve revisão independente nem autorização para agentes adicionais.

## Publicação após autorização do usuário

O pedido posterior para integrar todas as branches/PRs autorizou a sequência
de banco, merge, publicação e limpeza já proposta. SQL 043 e RLS aplicados
em produção antes do merge da PR #35. Correção do digest em 193588d; CI da
main 43345352059 aprovada com 59 jobs, incluindo deploy. Produção e container
conferidos saudáveis no mesmo commit; novas rotas privadas respondem 401
sem sessão. Onze branches incorporadas excluídas; só main e nenhuma PR aberta.
[Detalhes e limites](tms-merge-publicacao-2026-11-12.md). Nenhuma consulta ou
emissão real na SEFAZ foi realizada.
