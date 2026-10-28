# AVL-371 — Capacidade na sugestão do roteiro

## Escopo

Exibir ocupação atual das cargas a entregar e saldo após cada entrega na ordem
sugerida. A ordem continua otimizada por distância. Excesso inicial permanece
visível mesmo quando o saldo de uma parada posterior cabe no veículo.

## Implementação

- [ ] Testes de regressão na rota e na tela, com excesso, entregues e cubagem ausente.
- [ ] Função pura em `ocupacao.ts`, usando `ocupacaoDaViagem` em cada saldo.
- [ ] Resposta de roteiro inclui `ocupacao: { inicial, aposEntrega }`, calculada
  com peso/cubagem das cargas do manifesto e capacidade do veículo autorizado.
- [ ] Sugestão mostra ocupação inicial, avisos e saldo após cada parada pendente.
- [ ] Testes puros de arredondamento e ausência de capacidade/medidas.
- [ ] README e roadmap registram escopo implementado e limitações.
- [ ] CI GitHub: regressão vermelha, suíte final, typecheck e build.
- [ ] PR e Linear em In Review com evidências; sem merge/deploy.

## Limites

Não há coletas intermediárias no roteiro atual; a simulação considera somente
descargas completas. Carga sem medida não representa zero conhecido. Não muda a
liberação de saída, não fraciona cargas e não seleciona veículos automaticamente.
