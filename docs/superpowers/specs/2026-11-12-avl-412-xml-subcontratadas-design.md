# AVL-412 — XML de subcontratadas e consulta à SEFAZ

## Objetivo e decisão de escopo

Importar CT-e e MDF-e da transportadora subcontratada na viagem e consultar
a situação deles na SEFAZ. Escopo escolhido por Nicolas em 12/11/2026, a partir
da próxima entrega recomendada no documento de pendências do projeto TMS no
Linear. A entrega mensal continua acompanhada pela AVL-412.

O Linear recusou criar uma subtarefa técnica por limite do plano gratuito.
Esta especificação e o registro local identificam a entrega dentro da issue
existente; isso não conclui o marco mensal nem comprova publicação.

## Alternativas consideradas

1. Importar XML e consultar a situação na SEFAZ: opção escolhida pelo usuário.
   Acrescenta persistência privada e consulta autenticada, com evidências
   distintas para o arquivo recebido e para a resposta da SEFAZ.
2. Importar primeiro e deixar a consulta para outra entrega: menor escopo,
   mas mantém a situação atual do documento sem conferência externa.

## Estado atual e abordagem

`SubcontractDocument` guarda chave, dia de emissão e vínculo ao contrato,
à carga ou à UF de descarga. As rotas e a tela de subcontratação já usam
as capacidades `fiscal` e `fiscalVer`. O banco isola a empresa por RLS.

A implementação reutilizará o leitor restritivo de XML em `nfe.ts`, as
validações de chave de `subcontratacao.ts`, o A1 cifrado de `cte-db.ts` e
as consultas de `cte/sefaz.ts` e `mdfe/sefaz.ts`. São decisões técnicas
propostas para manter o fluxo existente e evitar outra integração fiscal.

## Comportamento esperado

- A tela permite escolher XML de CT-e 4.00 ou MDF-e 3.00 com protocolo de
  autorização. CT-e exige selecionar uma carga da viagem. O MDF-e traz a
  UF de descarregamento do XML, sem digitação divergente.
- O servidor confere modelo, chave e dígito, CNPJ da parceira, série,
  número, UF, emissão, ambiente e protocolo correspondente à chave.
  Documento ambíguo, resumo, evento isolado ou sem protocolo é recusado.
- O arquivo tem limite de 1 MiB; DOCTYPE, entidades externas e XML
  malformado são recusados pelo leitor existente. Não haverá nova
  dependência para analisar XML.
- O XML original fica privado. A lista devolve somente metadados; o
  download exige `fiscalVer`, vínculo à viagem e empresa da sessão,
  com anexo, `nosniff` e cache privado desabilitado.
- Um documento registrado manualmente pode receber o XML correspondente,
  preservando o vínculo e sem criar duplicata. Reimportação divergente é
  recusada; a importação nunca troca o parceiro do contrato.
- “Consultar na SEFAZ” é uma ação explícita de quem tem `fiscal`. Usa o
  certificado da própria empresa, o ambiente do documento, a UF da chave
  e a SVC quando a chave de CT-e a indicar. Sem certificado ou acesso,
  mostra a falha sem inventar consulta bem-sucedida.
- A consulta roda fora da transação do banco. Ao gravar, a transação
  reconfere documento, contrato e viagem para não registrar resposta
  em vínculo excluído ou alterado durante a chamada.
- A tela distingue “protocolo no XML”, “não consultado”, “autorizado”,
  “cancelado”, “encerrado”, “não consta” e resposta inconclusiva. Exibe
  ambiente, código, motivo e instante da última consulta válida.
- Autorizado exige protocolo coerente com chave e ambiente. Resposta
  malformada ou de outro documento não substitui a evidência anterior.
  Falha de transporte também não transforma o documento em autorizado.
- MDF-e importado em homologação não cobre saída em produção. Documento
  com consulta conclusiva de cancelamento, encerramento ou inexistência
  deixa de cobrir a saída. As chaves manuais antigas mantêm o tratamento
  atual enquanto não houver uma evidência de consulta que as invalide.
- Importação e consulta registram ator e resumo na auditoria; XML,
  certificado e senha não entram em respostas de lista ou auditoria.

## Persistência e interfaces

Adicionar campos opcionais de XML, ambiente, protocolo recebido e última
consulta ao modelo existente, com SQL idempotente em
`prisma/sql/043-subcontratacao-xml.sql`. Sem tabela ou FK nova.

Interfaces propostas:

- `POST /api/manifestos/[id]/subcontratacao/importar`: recebe XML e carga
  quando CT-e; responde os metadados registrados.
- `GET /api/manifestos/[id]/subcontratacao/[documentoId]/xml`: download
  privado do arquivo original, 404 quando não houver XML.
- `POST /api/manifestos/[id]/subcontratacao/[documentoId]/consultar`:
  consulta explícita e grava evidência conferida na empresa da sessão.

## Validação e critérios de entrega

Testes devem cobrir CT-e e MDF-e, namespaces, caracteres especiais,
duplicidade de nós, inconsistência de chave/protocolo/ambiente/emissão,
arquivo excessivo e entidades. API deve provar deduplicação, auditoria,
isolamento entre empresas, perfis e revalidação após a chamada externa.
Consultas usam serviço de teste, incluindo autorização, cancelamento,
encerramento, inexistência, timeout e resposta incoerente.

Tela deve permitir importar, baixar e consultar, com erros recuperáveis,
sem gravação acidental ao selecionar arquivo e sem ações de escrita para
perfil de leitura. Registrar verificação visual desktop e celular.

Typecheck, testes de integração e build de imagem devem ser validados no
GitHub CI. A política atual exige limite de até 90 segundos por job;
o workflow existente ainda declara 15/45/15 minutos. A divergência deve
ser registrada e resolvida no fluxo de validação, sem remover testes ou
declarar aprovação quando houver timeout. Sem acompanhamento contínuo.

## Limites e aprovação

Esta entrega não emite documentos da parceira, não cria consumidor NSU,
não verifica cadeia ICP-Brasil localmente e não substitui consulta à SEFAZ
por protocolo trazido no arquivo. Sem emissão, migração, homologação real
ou deploy em produção durante a implementação. Essas operações exigem
evidência e contexto próprios.

Abordagem e desenho aprovados pelo usuário em 12/11/2026, com execução neste
checkout. Não criar agentes adicionais nem outro worktree.

## Autorização posterior de integração e publicação

Após a implementação e revisão, o usuário pediu integrar todas as branches
e PRs do TMS. A sequência já apresentada foi executada: SQL 043 e RLS por
túnel local antes do código, merge da PR #35, CI/deploy e conferência de saúde,
seguidos da limpeza das branches incorporadas. Essa autorização posterior
amplia o limite da implementação acima; não autoriza emissão ou consulta
fiscal real. Evidências em
[integração e publicação](../../../artifacts/tms-merge-publicacao-2026-11-12.md).
