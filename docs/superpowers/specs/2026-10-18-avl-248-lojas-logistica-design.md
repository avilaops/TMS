# AVL-248 — Integração logística do Lojas

## Intenção

O TMS será o proprietário da execução logística dos pedidos do Lojas. O Lojas envia a necessidade de frete e acompanha o resultado por um contrato HTTP versionado; o TMS continua proprietário de cargas, rastreio, ocorrências e comprovantes.

## Objetivos

- Cotar uma ordem com múltiplas origens, destino, volumes, dimensões, peso e pallets.
- Distinguir CIF, FOB, retirada e transportadora própria sem inferir cobrança onde ela não existe.
- Confirmar uma cotação em uma ordem logística que pode produzir várias remessas.
- Expor rastreio, ocorrências, comprovantes e cumprimento do SLA por ordem e remessa.
- Criar ordem reversa vinculada ao RMA e registrar o resultado da inspeção final.
- Tornar criação, confirmação, cancelamento e reenvio idempotentes.
- Isolar todos os dados pelo tenant do PostgreSQL e nunca persistir a chave de integração em texto aberto.

## Não objetivos

- Escolher estoque ou depósito do Lojas: o consumidor envia as origens já decididas.
- Emitir pedido comercial, nota fiscal, crédito, troca ou reembolso: esses domínios continuam no Lojas e no ERP.
- Criar outro cadastro de rastreio, ocorrência ou comprovante paralelo ao já existente no TMS.
- Executar build ou suíte pesada em servidor da Ávila Ops.

## Contrato HTTP

Base: `/api/integracoes/lojas/v1/empresas/{tenantSlug}`.

Autenticação: `Authorization: Bearer <chave>`. A chave é gerada ou rotacionada por administrador em Empresa, mostrada uma única vez e persistida como SHA-256 com os quatro últimos caracteres para identificação. Comparação em tempo constante.

Toda mutação exige `Idempotency-Key` de 8 a 120 caracteres. A resposta da primeira execução fica persistida; repetir a mesma chave e o mesmo corpo devolve a mesma resposta. Repetir a chave com corpo diferente devolve conflito `409`.

Endpoints:

- `POST /cotacoes`: cria ou recupera uma cotação para uma referência externa.
- `POST /ordens`: confirma a cotação e cria uma remessa/carga por origem.
- `GET /ordens/{externalId}`: devolve a fotografia atual da ordem, remessas, rastreio, ocorrências, comprovantes e SLA.
- `POST /ordens/{externalId}/cancelamento`: cancela uma ordem que ainda não saiu para coleta; repetição é idempotente.
- `POST /reversas`: cria uma ordem reversa ligada ao `rmaId`.
- `POST /reversas/{externalId}/inspecao`: registra uma única decisão final (`ESTOQUE`, `QUARENTENA`, `AVARIA` ou `DESCARTE`) com observação opcional.

## Dados

`LojasIntegrationCredential` guarda uma configuração por tenant: hash da chave, final visível, data de rotação e usuário responsável.

`LogisticsOrder` guarda referência externa única por tenant, direção (`DELIVERY` ou `RETURN`), modalidade, situação, destino, totais, pallets, cotação, prazo, RMA e inspeção. A carga de entrada normalizada fica em JSON para auditoria contratual.

`LogisticsShipment` liga uma origem da ordem a exatamente uma `Collection`. A `Collection` continua sendo a unidade operacional do TMS e fornece código de rastreio, histórico, ocorrências e comprovante.

`IntegrationRequest` registra chave idempotente, hash do corpo, situação HTTP e resposta JSON. A unicidade é por tenant, integração, operação e chave.

Todas as tabelas carregam `tenantId`, usam RLS e entram no gatilho `tms_mesmo_tenant` quando possuem chaves estrangeiras.

## Cálculo e modalidades

Cada origem é cotada separadamente com `calcularFrete`; o prazo da ordem é o maior prazo das remessas. Peso cubado usa as dimensões enviadas. Pallets e ausência de tabela geram avisos explícitos.

- `CIF`: o frete calculado compõe o total retornado.
- `FOB`: o valor é informativo e marcado como responsabilidade do comprador.
- `OWN_CARRIER`: o valor calculado é informativo e a execução ocorre nas cargas do TMS.
- `PICKUP`: total de frete igual a zero, sem criação de carga na confirmação; a ordem é concluída como disponível para retirada.

## Estados e cancelamento

A ordem deriva seu estado das remessas: `QUOTED`, `CONFIRMED`, `IN_PROGRESS`, `DELIVERED`, `CANCELLED` ou `PARTIAL`. O cancelamento só é aceito enquanto todas as cargas estiverem em `PENDING` ou `CONFIRMED`; depois disso devolve `409`.

## Retorno ao Lojas

O `GET` fornece a fotografia completa e estável. Além disso, eventos `lojas.ordem.criada`, `lojas.ordem.atualizada`, `lojas.ordem.cancelada` e `lojas.reversa.inspecionada` usam a fila `OutboxEvent`, com `dedupeKey`, tentativas e assinatura já existentes. Nenhuma foto ou credencial vai no evento; comprovantes retornam metadados e identificadores.

## Interface administrativa

Empresa ganha a seção “Integração Lojas” com estado da chave, rotação explícita, exibição única da nova chave e aviso de armazenamento seguro. A tela também mostra as últimas ordens recebidas e sua situação para diagnóstico operacional.

## Falhas e segurança

- Chave ausente ou inválida: `401`, sem revelar tenant ou final da chave.
- Tenant inexistente/inativo: `404` genérico.
- Corpo inválido: `400` com campos seguros; nenhum segredo aparece em log, auditoria ou resposta posterior.
- Referência externa já usada com dados incompatíveis: `409`.
- Banco indisponível: `503`; a mesma chave pode ser reenviada.
- Isolamento é comprovado com dois tenants e acesso cruzado negado.
- Limites de itens, volumes, texto e JSON evitam carga descontrolada.

## Gate de entrega

- Migração SQL idempotente, Prisma, RLS e gatilho de mesmo tenant verificados em PostgreSQL real.
- Testes de contrato, autenticação, modalidades, multi-origem, múltiplas remessas, rastreio, ocorrência, comprovante, SLA, reversa, idempotência, cancelamento, reenvio, indisponibilidade e isolamento.
- Typecheck, testes completos e build no GitHub Actions.
- Prints desktop e mobile da seção administrativa antes do único commit/push do módulo.
- Issue `AVL-248` recebe PR e evidências; só vai a Done após merge e verificação do workflow da `main`.
