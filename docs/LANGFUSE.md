# Observabilidade das ferramentas fiscais

A integração fica desligada por padrão. Para habilitar, configurar no ambiente
do servidor `LANGFUSE_ENABLED=true`, `LANGFUSE_BASE_URL` (HTTPS, sem credenciais,
query ou fragmento), `LANGFUSE_PUBLIC_KEY` e `LANGFUSE_SECRET_KEY`.
Não colocar chaves no repositório ou no navegador.

Usamos `@langfuse/tracing` e `@langfuse/otel` 6.0.2, que exigem Langfuse Cloud v4
ou servidor próprio **v4.59.0 ou superior**. O OpenTelemetry Node SDK 0.223.0
mantém compatibilidade com os peers OpenTelemetry 2 do Langfuse; o Node SDK
0.300.0 usa OpenTelemetry 3 e não atende esses peers.

Cada conversa fiscal gera uma observação `tool`, identificada por
`tms.fiscal.gerar_danfe`, `tms.fiscal.gerar_dacte` ou
`tms.fiscal.gerar_damdfe`. São registrados duração, nome fixo da ferramenta e
estado de transporte/ferramenta. A entrada informa apenas `content: omitted` e
a saída apenas `status: completed/failed`. Não são registrados XML, PDF, argumentos,
resultados, identificadores de pessoas/empresas, tokens, URLs do MCP ou erros
brutos. A validação posterior do documento permanece no cliente fiscal.

O exportador aceita apenas os três nomes fiscais acima no escopo `langfuse-sdk`, sem instrumentação automática
de HTTP/banco nem detecção de recursos do servidor. Falhas na telemetria não
alteram a resposta nem repetem a ferramenta. Cada chamada descarrega o lote,
com espera limitada a três segundos; a saída natural do processo encerra o SDK.
O scheduler existente continua controlado por `TMS_EVENTOS` independentemente
da telemetria.

Validação: testes e build exclusivamente no workflow GitHub existente. A ativação
em produção e a auditoria de um trace real exigem configuração operacional
posterior; esta alteração não ativa nem implanta o recurso.

Referências oficiais:

- [SDK e compatibilidade](https://langfuse.com/docs/observability/sdk/overview)
- [Observações manuais](https://langfuse.com/docs/observability/sdk/instrumentation)
- [Filtragem e proteção de dados](https://langfuse.com/docs/observability/sdk/advanced-features)
