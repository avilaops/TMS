# TMS — integração e publicação autorizadas

Pedido do usuário: integrar todas as branches e PRs do TMS, publicar e limpar
as branches incorporadas. Registro da execução em 12/11/2026 (São Paulo).

## Integração e banco

- Única PR aberta: [#35](https://github.com/avilaops/TMS/pull/35), integrada
  em `d7c1a4526c26d59772c33cb1902845cc3f3a3e6b` após conferir o HEAD validado
  `36c6eaeae491167858a82f3d9b6b1bfbdb3fadf1`.
- SQL 043 aplicado duas vezes pelo cliente local com túnel SSH, antes do merge.
  Banco e role `tms_avilaops_com` conferidos. Nove colunas presentes;
  `sefazRevision` inteiro, não nulo, default 0. SQL 010 de RLS reaplicado;
  RLS ativo e política de tenant presente. Sem build/código de aplicação no
  servidor ou operação real na SEFAZ.
- CI da PR: 2.613 casos distintos em 101 arquivos, tipos, build e imagem
  aprovados no [run 43314036543](https://github.com/avilaops/TMS/actions/runs/43314036543).

## Publicação em avaliação

[Run da main 43343859324](https://github.com/avilaops/TMS/actions/runs/43343859324):
um grupo excedeu o limite na preparação do runner; a reexecução pontual no
mesmo SHA aprovou testes e checks. O timeout original continua no histórico.

A imagem foi construída, testada com Sharp/PostgreSQL e enviada ao GHCR.
O job falhou ao validar o endereço obtido de `RepoDigests[0]`; o deploy não
executou. Metadados do registro confirmaram o índice publicado no digest
`sha256:44fc6f8c231ac8edb67ea5240b30c947d677a4108f3687c555a5d89d5ed7fbc2`.

A correção obtém o digest do registro com `buildx imagetools inspect` e mantém
a validação do endereço e todos os gates. A consulta ao registro foi conferida
por `imagetools` e pelo cabeçalho HTTP `Docker-Content-Digest`. Ver
[documentação oficial de inspect](https://docs.docker.com/reference/cli/docker/buildx/imagetools/inspect/).

Publicação final e limpeza serão confirmadas pelo run da correção e pela
saúde/commit de produção. Nenhuma aprovação de publicação é inferida do push
da imagem ou do merge.

## Inventário de branches

| Branch | Prova de incorporação na main |
| --- | --- |
| `codex/avl-371-capacidade-roteiro` | Ancestral; PR #33 integrada em 01/11 |
| `codex/avl-412-xml-subcontratadas` | Ancestral após PR #35 |
| `codex/fiscal-tms-ci-fix` | Patch equivalente ao squash da PR #30; `git cherry` sem conteúdo inédito |
| `codex/langfuse-fiscal-tools` | Ancestral; PR #32 |
| `docs/avl-322-arquitetura-monitor-notas` | Ancestral; PR #31 |
| `feat/client-document-notification-preferences` | Ancestral |
| `feat/cotacao-busca-clientes` | Ancestral |
| `feat/cotacao-dimensoes-volumes` | Ancestral |
| `feat/cotacao-proposta-comercial` | Ancestral |
| `feat/frete-capacidade-veiculo` | Ancestral |
| `feat/ux-empresa-proposta` | Ancestral |

São 11 branches além da main, todas com conteúdo incorporado. A exclusão
confere o SHA de cada referência e preserva a main. PRs antigas fechadas e
superadas não são reabertas para reintroduzir funcionalidades removidas.
