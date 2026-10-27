# Monitor de Notas e fronteiras fiscais

## O que está implementado em cada aplicação

O Monitor de Notas não corresponde a uma biblioteca compartilhada já instalada
no TMS e no Lojas. O código atual possui fontes e adaptadores distintos:

| Aplicação | Responsabilidade verificada |
| --- | --- |
| TMS | Importa XML NF-e, liga a nota à carga, emite e acompanha CT-e/MDF-e e expõe CT-e ao Lojas |
| Lojas | Apresenta documentos locais e resultados de consultas fiscais ao ERP e ao TMS |
| ERP integrado | Fonte da API de notas recebidas consumida pelo adaptador do Lojas |
| MCP fiscal | Gera DANFE, DACTE e DAMDFE a partir dos XMLs enviados pelo TMS, conforme configuração |
| n8n | Destino possível dos eventos de integração; sua existência não comprova coleta fiscal ativa |

A leitura do Lojas foi conferida na revisão
`0d38de822696d8314bc86ed3e773ff9b0f317fbe`. Os links abaixo fixam essa revisão
para que a descrição possa ser reproduzida.

## NF-e dentro do TMS

A entrada é [POST /api/fiscal/notas](../src/app/api/fiscal/notas/route.ts).
`requireStaff({ pode: "fiscal" })` precede a importação. O handler limita o
corpo, valida `{ xml }`, chama `lerNfe` e preserva o XML original em
`FiscalDocument`. Conflitos de chave na mesma empresa retornam 409.

Funções centrais de [nfe.ts](../src/lib/nfe.ts):

- `lerXml`: lê a árvore XML e recusa estruturas não suportadas.
- `lerNfe`: extrai e confere os dados da NF-e; limita o XML a 1 MiB.
- `participantesDaNota`: obtém participantes a partir do XML.
- `sugerirCarga`: combina os dados da nota com os clientes disponíveis.
- `filtroDeNotas`: constrói o filtro da consulta por nota/participantes.
- `criarCargaDaNotaSchema` e `ligarNotaSchema`: validam as ações do operador.

Em [nfe-db.ts](../src/lib/nfe-db.ts), `cargaComAChave` procura a carga existente,
`sugestaoDaNota` reúne a sugestão e o vínculo possível, e `respostaComXml`
devolve o arquivo original como anexo privado, sem cache.

| Operação | Endpoint do TMS |
| --- | --- |
| Listar e importar | `GET/POST /api/fiscal/notas` |
| Abrir nota | `GET /api/fiscal/notas/[id]` |
| Download XML | `GET /api/fiscal/notas/[id]/xml` |
| Download DANFE | `GET /api/fiscal/notas/[id]/danfe` |
| Criar carga | `POST /api/fiscal/notas/[id]/carga` |
| Vincular carga | `POST /api/fiscal/notas/[id]/ligar` |

Criar/vincular carga é uma ação explícita; importar XML não cria a carga
automaticamente. O TMS não possui neste fluxo um consumidor NF-e `distNSU`.
Importar um XML também não comprova consulta à SEFAZ, manifestação aceita ou
validação da assinatura/protocolo pelo autorizador.

## CT-e canônico do TMS para o Lojas

A [rota de listagem](../src/app/api/integracoes/lojas/v1/empresas/[empresa]/documentos-fiscais/cte/route.ts)
retorna `versao: "avila.fiscal.cte.v1"`, `fonte_canonica: "TMS"`, página,
total e documentos. O limite é de 50 documentos por página.

- [autenticarLojas](../src/lib/lojas-logistica-auth.ts) verifica a credencial
  Bearer da integração, o tenant ativo e o hash armazenado. O slug informado
  no caminho não concede acesso sozinho.
- `paraEmpresa(tenantId).db` mantém a consulta no tenant autenticado.
- [cteParaLojas](../src/lib/cte-integracao-lojas.ts) projeta metadados,
  eventos e links de arquivo, sem embutir o XML bruto na listagem.
- Downloads `.../cte/[id]/xml` e `.../cte/[id]/dacte` permanecem privados.

O adaptador
[tms-fiscal.ts do Lojas](https://github.com/avilaops/lojas.avilaops.com/blob/0d38de822696d8314bc86ed3e773ff9b0f317fbe/src/lib/tms-fiscal.ts)
usa `TMS_API_URL`, `TMS_APP_URL` e `TMS_FISCAL_BY_CNPJ`. O mapa de CNPJ contém
o slug e a credencial de cada integração; seus valores não pertencem a esta
documentação. `buscarFiscalTms` confere a versão e a estrutura da resposta;
`baixarFiscalTms` busca o arquivo autenticado.

O adaptador atual consome uma chamada da listagem, sem percorrer páginas
seguintes. A presença de paginação no TMS não comprova que o monitor tenha
carregado todo o acervo de CT-e.

## Composição do monitor no Lojas

A [rota fiscal do painel](https://github.com/avilaops/lojas.avilaops.com/blob/0d38de822696d8314bc86ed3e773ff9b0f317fbe/src/app/api/painel/fiscal/route.ts)
consulta documentos locais, contagens por schema, configuração, ERP e TMS.
Resolve `tenantId` pela sessão com permissão fiscal, pagina o acervo local e
projeta os XMLs para resumos; a resposta da lista não expõe o XML bruto.

O arquivo
[fiscal-monitor.ts](https://github.com/avilaops/lojas.avilaops.com/blob/0d38de822696d8314bc86ed3e773ff9b0f317fbe/src/lib/fiscal-monitor.ts)
tem duas funções puras:

- `separarDocumentosFiscais`: separa notas, CT-e, eventos e outros por schema.
- `totalizarDocumentosFiscais`: totaliza essas categorias a partir das contagens
  do acervo; não usa o tamanho da amostra exibida como total histórico.

Essas funções não coletam documentos, não guardam certificado e não controlam
NSU. A distribuição usa outros módulos, incluindo `fiscal-distribuicao.ts`,
`fiscal-loja.ts`, `fiscal-certificado.ts`, `fiscal-documento.ts` e os modelos
Prisma do Lojas. O adaptador `erp-fiscal.ts` consulta a API de notas recebidas
do ERP; ele não é o importador NF-e do TMS.

`resNFe` é um resumo, distinto de um XML integral. O monitor deve preservar a
distinção entre resumo, arquivo completo e evento. A geração de PDF não prova
autorização fiscal nem disponibilidade de XML completo.

## MCP fiscal do TMS

[fiscal-mcp.ts](../src/lib/fiscal-mcp.ts) usa `FISCAL_MCP_URL` e um token de
serviço `FISCAL_MCP_TOKEN` no servidor. Esse é o acesso de runtime da aplicação;
o OAuth do Codex usado para manutenção é outra identidade.

`gerarDanfe`, `gerarDacte` e `gerarDamdfe` usam `initialize`,
`notifications/initialized` e `tools/call`; `respostaRpc` aceita JSON ou SSE,
`pdfDoResultado` limita e valida o PDF e o cliente encerra a sessão MCP.
As rotas traduzem falhas por configuração, timeout, serviço ou ferramenta em
respostas próprias. Os arquivos não passam a públicos por serem PDFs.

## Avaliação de repositório independente

Separar o monitor inteiro exige uma fronteira de produto e de persistência.
Copiar apenas `fiscal-monitor.ts` produziria um classificador de schemas, sem
o monitor, os adaptadores e a autorização; copiar as rotas preservaria
dependências diretas do banco e da sessão do Lojas.

Uma extração funcional deve atender estes critérios antes de substituir os
consumidores existentes:

1. Definir o núcleo de classificação/projeção e contratos de documentos sem
   imports de Next.js, sessão ou Prisma dos aplicativos.
2. Manter adaptadores de ERP e TMS e suas credenciais no servidor do consumidor.
3. Definir quem persiste XML, eventos, certificado, cursor NSU e tentativas;
   preservar uma fonte de coleta por CNPJ e o isolamento entre empresas.
4. Cobrir resumo/inteiro/evento, limites, falhas de origem, paginação,
   deduplicação e recusa de acesso a outro tenant.
5. Publicar o pacote/artefato pelo GitHub CI e migrar consumidores em mudanças
   próprias, com testes de contrato e possibilidade de reversão.

Esta entrega documenta o acoplamento e os contratos existentes. O desmembramento
do monitor completo permanece uma entrega própria, com os critérios acima;
esta revisão documental preserva as dependências de runtime do TMS e do Lojas.

## Evidência e limites

- TMS: [testes de documentos fiscais](../tests/fiscal.test.ts) e
  [testes da tela](../tests/fiscal-tela.test.tsx).
- Lojas: [classificação e contagens](https://github.com/avilaops/lojas.avilaops.com/blob/0d38de822696d8314bc86ed3e773ff9b0f317fbe/src/lib/fiscal-monitor.test.ts).
- A existência desses testes não declara que a CI de uma revisão passou.
- Nenhuma consulta real, emissão, manifestação, migration ou envio de
  documento foi realizado durante a atualização da documentação.
