# Financeiro de leitura para a Diretoria — 13/11/2026

Entrega acompanhada na [AVL-412](https://linear.app/avilaops/issue/AVL-412/novembro-entregar-tms-ate-3011), registro T-0012. Workflow Debug, mesmo checkout, sem agentes adicionais.

## Problema e correção

A matriz permite `financeiroVer` à Diretoria, mas somente Administrador e Financeiro têm `financeiro`. A página oferecia criação, edição, baixa, reabertura, exclusão e conciliação a todos, levando à recusa 403 das rotas. Lacuna também documentada no README.

A página usa a capacidade canônica da sessão para mostrar esses comandos e formulários. A Diretoria recebe a indicação “Somente leitura” e preserva resumos, filtros por situação/centro, abas, fluxo de caixa, recibos e links para faturas. Perder a capacidade retira formulários abertos da tela e mantém a navegação de consulta. As chamadas de gravação também conferem a capacidade no handler. A autorização no servidor permanece a autoridade.

O carregamento inicial usa callbacks da promessa para aplicar o resultado assíncrono. Isso mantém o comportamento de leitura/erro e resolve o apontamento preexistente `set-state-in-effect` do lint, confirmado também no arquivo original da main, sem desabilitar a regra.

## Verificação local

- Regressão antes de alterar a implementação: 3 falhas esperadas e 6 casos aprovados. Diretoria e sessão sem perfil recebiam comandos indevidos.
- `npm test -- tests/financeiro-tela.test.tsx tests/cobranca-tela.test.tsx tests/roteiro-conciliacao-tela.test.tsx`: **46 testes aprovados em 3 arquivos**, sem skips.
- Novo arquivo com **13 cenários**: consulta da Diretoria, sessão sem perfil/desconhecida, recusas 401/403 da API, perda de permissão com lançamento ou baixa aberta e preservação das operações de Administrador/Financeiro.
- `npm run typecheck`: aprovado. Arquivos de tipos de desenvolvimento anteriores estavam corrompidos, com trecho duplicado; cache preservado fora do projeto em diretório temporário para não entrar no glob do TypeScript. Nenhuma alteração de configuração ou arquivo gerado versionado.
- ESLint nos três arquivos TSX alterados, com `--max-warnings 0`: aprovado, sem supressão de regras.
- `git diff --check`: aprovado.
- Chromium, componente real com CSS do projeto e respostas de API de fixture: Diretoria em **1440×1000 e 390×844**, filtros e abas funcionando, recibos disponíveis, nenhum comando indevido, nenhuma gravação, nenhuma rolagem horizontal. Administrador e Financeiro criam um lançamento cada. Nenhum erro de página. Fonte substituta Arial na fixture, sem layout autenticado do Next.

Capturas: [desktop](financeiro-diretoria-desktop.png) e [celular](financeiro-diretoria-mobile.png).

Uma execução inicial incluiu `permissoes.test.ts`, que pulou 16 integrações por ausência de DATABASE_URL; esses skips não são contabilizados como aprovação. A suíte de banco completa deverá rodar nos runners GitHub conforme a política do projeto. Nenhum build de produção ou teste pesado foi executado localmente ou no servidor.

## Revisão e limites deste registro

Revisão pelo próprio agente, sem revisão independente. Conferidos a matriz, as rotas de leitura/gravação/conciliação, links de recibo, lançamentos vinculados a faturas, mudança de perfil e tratamento de sessão expirada. Sem achados bloqueantes.

Não houve mudança de esquema, regra financeira ou permissão da API. A prova no navegador usa dados fictícios; não comprova uma operação financeira com conta empresarial em produção.

## Integração, publicação e limpeza

- [PR #36](https://github.com/avilaops/TMS/pull/36) integrada por merge em **c1cb0c29759d98e7f5043a2683c5b1ae3024ecfc**, conferindo HEAD 97a068742e7bd4c464f2c5579ee486a2b9879e46 e base 4f868b45a7d40b28290f2d6f5c7e5b90a7b4cb95.
- [CI da PR 43368785831](https://github.com/avilaops/TMS/actions/runs/43368785831), tentativa 2: success, **59 jobs aprovados**, deploy pulado por ser PR. Na tentativa inicial, tests (1) excedeu o minuto no encerramento, depois de a etapa de testes passar; somente ele e os dependentes foram reexecutados no mesmo SHA. A falha original permanece registrada.
- [CI da main 43369466152](https://github.com/avilaops/TMS/actions/runs/43369466152), primeira tentativa: success, **60 jobs aprovados**, incluindo suíte PostgreSQL, tipos da fonte e gerados, build, imagem e deploy. Timeout nativo de um minuto preservado em todos os jobs.
- Saúde pública: HTTP 200, status ok e commit c1cb0c29759d98e7f5043a2683c5b1ae3024ecfc. Container `tms-avilaops-com-web` running/healthy em `ghcr.io/avilaops/tms@sha256:e3193234df7cc91c5c1917b9695c3ef1d798a9483c9271f3b86e52768cf0684f`.
- Branch remota incorporada excluída com lease do SHA 97a0687, e local removida com `git branch -d`. Conferidos somente main e zero PRs abertas. Servidor local de fixture encerrado.
- Nenhuma migração foi necessária. Nenhuma operação financeira real ou sessão empresarial foi usada como teste. As três leituras de API financeira verificadas sem sessão retornaram 401; validação autenticada de interface usa fixture e autorização com banco real é coberta pela CI.

T-0012 concluída e issue mensal AVL-412 mantida In Progress. Este registro documenta a publicação funcional c1cb0c2. O fechamento documental segue os mesmos gates da main; o SHA final e a saúde correspondente serão reconciliados na AVL-412 para não presumir a aprovação de uma nova publicação.
