# AVL-371 — Capacidade na sugestão do roteiro

## Escopo

Exibir ocupação atual das cargas a entregar e saldo após cada entrega na ordem
sugerida. A ordem continua otimizada por distância. Excesso inicial permanece
visível mesmo quando o saldo de uma parada posterior cabe no veículo.

## Implementação

- [x] Testes de regressão na rota e na tela, com excesso, entregues e cubagem ausente.
- [x] Função pura em `ocupacao.ts`, usando `ocupacaoDaViagem` em cada saldo.
- [x] Resposta de roteiro inclui `ocupacao: { inicial, aposEntrega }`, calculada
  com peso/cubagem das cargas do manifesto e capacidade do veículo autorizado.
- [x] Sugestão mostra ocupação inicial, avisos e saldo após cada parada pendente.
- [x] Testes puros de arredondamento e ausência de capacidade/medidas.
- [x] README e roadmap registram escopo implementado e limitações.
- [x] CI GitHub: regressão vermelha, suíte final, typecheck e build.
- [x] PR e Linear em In Review com evidências; sem merge/deploy.

## Limites

Não há coletas intermediárias no roteiro atual; a simulação considera somente
descargas completas. Carga sem medida não representa zero conhecido. Não muda a
liberação de saída, não fraciona cargas e não seleciona veículos automaticamente.

## Evidências

- [Baseline](https://github.com/avilaops/TMS/actions/runs/40647574350): typecheck
  aprovado e falhas esperadas nos dois testes novos de API e tela.
- [CI do código bb6f70d](https://github.com/avilaops/TMS/actions/runs/40648354236):
  2.512 testes aprovados em 96 arquivos, typecheck e build Docker aprovados.
- Revisão independente somente por leitura sem achados bloqueantes.
- [PR 33](https://github.com/avilaops/TMS/pull/33) e
  [AVL-371](https://linear.app/avilaops/issue/AVL-371) em revisão.
