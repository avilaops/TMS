# Documentação do TMS

## Referências principais

| Documento | Conteúdo |
| --- | --- |
| [README](../README.md) | Uso, perfis, regras funcionais, ambiente e operação |
| [Arquitetura](../ARCHITECTURE.md) | Componentes, responsabilidades de cada módulo, dados e integrações |
| [Monitor de Notas](MONITOR-NOTAS.md) | Importação NF-e, CT-e para Lojas, contratos e avaliação de extração |
| [Roadmap](ROADMAP.md) | Planejamento e histórico de evolução do produto |
| [Contexto da equipe](../.agents/equipe/CONTEXTO.md) | Fontes e scripts de verificação |

O roadmap fica em `docs/`; requisitos de produto não devem ser confundidos com
a arquitetura implementada. O README mantém suas seções funcionais e os links
existentes para o código.

## Planos de entregas

- [Integração logística com Lojas](superpowers/plans/2026-10-18-avl-248-lojas-logistica.md).
- [Contrato e desenho da integração](superpowers/specs/2026-10-18-avl-248-lojas-logistica-design.md).
- [Dimensões dos volumes](superpowers/plans/2026-10-18-dimensoes-volumes.md).
- [Proposta comercial da cotação](superpowers/plans/2026-10-18-proposta-comercial-cotacao.md).
- [Empresa e proposta comercial](superpowers/plans/2026-10-18-ux-empresa-proposta.md).

Esses documentos registram decisões de entregas específicas. Para descobrir o
comportamento atual, confira os arquivos vinculados na arquitetura, seus testes
e a revisão do GitHub correspondente.

## Verificação e publicação

O workflow [Build e deploy](../.github/workflows/deploy-production.yml) executa
typecheck, testes com PostgreSQL e build da imagem. Build de aplicação somente
no GitHub CI; o servidor `applications` recebe a imagem pronta. Uma alteração
de documentação não exige iniciar a aplicação ou consultar dados de produção.
