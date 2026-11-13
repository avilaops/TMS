# Faturamento conforme as capacidades — 13/11/2026

Implementação local T-0014, acompanhada na [AVL-412](https://linear.app/avilaops/issue/AVL-412/novembro-entregar-tms-ate-3011). Workflow Debug, sem agentes adicionais.

## Correção

A lista e o detalhe ofereciam emissão, baixa, reabertura/cancelamento e geração/atualização de cobrança à Diretoria, embora ela tenha `faturamentoVer` e não `faturamento`. As páginas agora consultam a matriz da sessão, retiram comandos e a baixa aberta quando o perfil perde a capacidade, e conferem a capacidade também nos handlers de gravação.

A Diretoria continua consultando cargas e faturas, imprimindo, lendo recibos e usando Pix/boleto existentes. Informar valores de frete usa `coletasFrete`, uma capacidade independente que permanece habilitada à Diretoria. Administrador e Financeiro preservam as operações de faturamento e cobrança. API, matriz e schema inalterados.

O carregamento da lista usa callbacks da promessa para aplicar resultados assíncronos, sem suprimir a regra de lint. O teste existente de gateway passa a declarar a sessão Administrador que representa suas ações.

## Verificação local

- Regressão inicial antes da implementação: **14 casos, com 7 falhas esperadas e 7 aprovados**.
- `npm test -- tests/faturamento-tela.test.tsx tests/gateway-tela.test.tsx tests/cobranca-tela.test.tsx tests/portal-cliente-tela.test.tsx`: **54 testes aprovados em 4 arquivos**, sem skips. Inclui os 14 novos cenários das duas páginas.
- Cobertura: leitura da Diretoria, frete autorizado separadamente, impressão/recibo, boleto/Pix existentes, sessão sem capacidade, recusas 401/403, mudança de perfil com baixa aberta e operações de Administrador/Financeiro.
- `npm run typecheck`, ESLint dos quatro TSX alterados com `--max-warnings 0` e `git diff --check`: aprovados.
- Chromium com componentes reais e API de fixture: lista e detalhe em **1440×1000 e 390×844**; sem comandos indevidos ou rolagem horizontal do documento. A tabela do detalhe conserva sua rolagem interna existente. Diretoria informa frete sem emitir fatura; detalhe preserva boleto/Pix e o disparo de impressão. Administrador/Financeiro emitem e geram Pix. Nenhum erro de página.
- Capturas: [lista desktop](faturamento-diretoria-lista-desktop.png), [lista celular](faturamento-diretoria-lista-mobile.png), [detalhe desktop](faturamento-diretoria-detalhe-desktop.png) e [detalhe celular](faturamento-diretoria-detalhe-mobile.png). Fonte Arial de fixture, sem layout autenticado do Next. Impressão conferida pelo acionamento de `window.print`, sem imprimir documento empresarial real.

Revisão pelo próprio agente, sem revisão independente: conferidos capacidades e rotas, separação de frete/faturamento, documentos de leitura, estados das faturas e troca de perfil. Sem achados bloqueantes. Nenhuma migração ou operação financeira real foi executada.

## Limites e publicação

Este registro conclui a **implementação local**, sem presumir CI ou publicação. Os SHAs, resultados da suíte integral com PostgreSQL, tipos gerados, build/imagem/deploy, saúde publicada e limpeza serão comprovados na AVL-412. Todos os jobs seguem o timeout nativo de um minuto e a validação pesada permanece nos runners GitHub.

A solicitação adicional de percorrer cadastro/login/primeiro acesso/logout está sendo acompanhada separadamente na mesma issue. Sua verificação autenticada depende do e-mail de teste e da regra de entrada para contas novas, solicitados ao usuário. Esta entrega não altera autenticação, cadastro público nem concessão de acesso.
