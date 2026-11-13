# Clientes conforme as capacidades do Financeiro — 13/11/2026

Implementação local T-0013, acompanhada na [AVL-412](https://linear.app/avilaops/issue/AVL-412/novembro-entregar-tms-ate-3011). Workflow Debug, mesmo checkout, sem agentes adicionais.

## Correção

A tela oferecia cadastro novo, edição completa, consulta de CNPJ e ativação/desativação ao Financeiro, embora o PATCH permita a esse perfil somente `paymentCondition` e `creditLimit`. A interface agora usa a matriz e `CAMPOS_DE_CONDICAO` canônicos, sem mudar API, autorização ou banco.

O Financeiro abre “Editar condições” na aba Comercial; cadastro, tabela de frete e notificações ficam consultáveis com os campos bloqueados. Somente condições alteradas entram no PATCH. A seleção dos campos é refeita ao salvar, incluindo quando o editor já estava aberto antes de uma troca de perfil. Cadastro novo e edição sem capacidade deixam de ser exibidos. Condições de cadastro legado com CNPJ vazio continuam editáveis pelo Financeiro.

Administrador, Diretoria, Operação e Comercial preservam cadastro, edição completa e ativação/desativação. O carregamento assíncrono foi colocado antes do efeito que o usa; estado de carregamento da atualização fica nos handlers. Isso resolve o apontamento preexistente do lint no arquivo original, sem desabilitar regras.

## Evidência local

- Regressão inicial antes da correção: **7 falhas esperadas e 8 casos aprovados**. Botões indevidos, ausência de editor restrito e campos ainda editáveis após troca de perfil reproduziram a lacuna.
- Verificação após correção e novamente na retomada: `npm test -- tests/clientes-tela.test.tsx tests/financeiro-tela.test.tsx` — **32 testes aprovados em 2 arquivos**, sem skips.
- **19 novos cenários** em Clientes: consulta e limites do Financeiro, payload mínimo, cadastro legado, limpeza de condições, cancelamento/ausência de alterações, sessão sem capacidade, recusas 401/403, mudanças de perfil e operações dos quatro perfis de cadastro.
- `npm run typecheck`: aprovado. ESLint dos dois TSX alterados, com `--max-warnings 0`: aprovado. `git diff --check`: aprovado.
- Chromium com componente real, CSS do projeto e respostas fictícias: Financeiro em **1440×1000 e 390×844**, sem rolagem horizontal no documento ou nas três seções do modal, apenas as duas condições gravadas; cadastro pelos quatro perfis completos verificado. Nenhum erro de página.
- Capturas conferidas visualmente: [desktop](clientes-financeiro-desktop.png) e [celular](clientes-financeiro-mobile.png). Animação finalizada na captura; fonte substituta Arial e sem layout autenticado do Next.

Revisão pelo próprio agente, sem revisão independente: conferidos matriz, allowlist de campos, guardas dos handlers, modal aberto durante troca de perfil, dados bloqueados para consulta e preservação dos fluxos de cadastro. Sem achados bloqueantes.

## Integração e publicação

Este arquivo comprova a implementação e a verificação local. **Não comprova CI, merge ou publicação.** Os resultados dessas etapas, os SHAs, as URLs das execuções, a saúde publicada e a exclusão da branch serão registrados na AVL-412, que acompanha a entrega completa. T-0013 tem escopo explícito de implementação local; a issue mensal permanece In Progress.

Não houve build de produção local, teste pesado no servidor, migração ou operação financeira real. Suíte integral com PostgreSQL, tipos gerados, build e imagem devem passar nos runners GitHub, com timeout nativo de um minuto por job, antes da integração/publicação conforme os gates do projeto.
