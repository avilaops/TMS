# Proposta comercial da cotação — plano de implementação

**Objetivo:** preparar no CRM uma mensagem comercial copiável com os dados da cotação, prazo informado e validade escolhida.

**Arquitetura:** uma função pura monta o texto e valida os termos comerciais. Um componente isolado coleta prazo e validade, mostra a prévia e controla a área de transferência. O CRM apenas abre esse componente para a cotação selecionada; copiar não altera o lead nem registra contato.

**Tecnologias:** TypeScript, React, Next.js, Vitest e Clipboard API.

## Restrições

- Nenhuma alteração de banco ou dependência nova.
- Prazo e validade nunca são presumidos.
- O texto deixa claro que o valor é estimado e sujeito à confirmação na coleta.
- Falha ao copiar mantém a mensagem selecionável para cópia manual.
- Nenhum servidor, deploy ou envio automático de WhatsApp.
- Um único commit e push somente após testes e prints.

## Tarefas

- [x] Testar e implementar a montagem e validação da mensagem.
- [x] Testar e implementar o formulário de preparação e a cópia com sucesso/falha.
- [x] Integrar a ação no funil e na lista sem PATCH nem registro de contato.
- [x] Atualizar a documentação do módulo de cotações.
- [x] Executar testes direcionados, suíte completa, lint dos arquivos, typecheck e build local.
- [x] Gerar e revisar prints desktop e mobile.
- [x] Fazer um único commit, push e abrir PR empilhada sobre a PR #20.
