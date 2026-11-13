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

Neste snapshot: **CI integral, merge, publicação e limpeza pendentes**. Os resultados reais e endereços das execuções serão registrados na AVL-412 após os gates, sem tratar aprovação local como publicação.
