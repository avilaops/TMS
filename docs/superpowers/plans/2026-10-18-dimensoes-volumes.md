# Dimensões por volume — plano de implementação

**Objetivo:** calcular automaticamente quantidade, cubagem e peso detalhado a partir das dimensões de cada tipo de volume nas telas de cotação.

**Arquitetura:** uma função pura converte centímetros ou metros e consolida as linhas. Um componente controlado reutiliza essa função no portal e no simulador, entregando os totais aos campos já aceitos pelas APIs. O banco continua armazenando a cubagem total da coleta.

**Tecnologias:** TypeScript, React, Next.js, Vitest.

## Restrições

- Nenhuma dependência nova.
- Nenhum servidor ou deploy.
- Um único commit e push somente após testes e prints.
- Linhas incompletas não podem ser enviadas silenciosamente.

## Tarefas

- [x] Testar e implementar o cálculo por linha e consolidado em cm e m.
- [x] Testar e implementar o editor reutilizável de dimensões.
- [x] Integrar ao portal, preenchendo volumes e cubagem do pedido de coleta.
- [x] Integrar ao simulador interno e à adequação de veículos.
- [x] Reproduzir por teste a tentativa de envio após uma dimensão válida virar inválida.
- [x] Bloquear o envio no portal e no simulador enquanto o editor aberto estiver incompleto ou inválido.
- [x] Executar testes direcionados, suíte completa, lint, typecheck e build local.
- [x] Gerar e revisar prints desktop e mobile.
- [x] Consolidar o único commit do módulo e atualizar a PR empilhada.
