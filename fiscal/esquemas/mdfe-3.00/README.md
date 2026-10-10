# Esquemas XML do MDF-e 3.00

Os XSD oficiais contra os quais os testes validam o que o sistema monta
(`tests/mdfe-apoio.ts`, função `errosNoEsquemaDoMdfe`). Não são usados em
produção: a validação de esquema é feita pela SEFAZ.

- **Pacote:** `PL_MDFe_300b_NT012025_1.05` (é o nome da pasta dentro do zip). No
  portal o arquivo se chama `PL_MDFe_300b_NT012025_1.04.zip` e o item é "Schemas
  NT 2025.001 v 1.04"; a última linha do histórico do item é "1.04 - Inclusão do
  procEmi valor 4 para o PAA".
- **Origem:** Portal do MDF-e (SVRS), Documentos → Schemas
  (`https://dfe-portal.svrs.rs.gov.br/Mdfe/Documentos`), item publicado em
  **25/04/2026**. É o pacote mais recente da página em 10/10/2026 (o anterior é
  o da NT 2024.002 v1.01, de 16/08/2024).
- **Baixado em:** 10/10/2026.
- **SHA-256 do zip:** `fc53c880bd757d5b03b79de15dd7687259dfbfa38fed85e9ebb9c638b93854cc`.
- **Conferência cruzada:** os arquivos são iguais, byte a byte, aos que o serviço
  fiscal da casa usa na ferramenta `validar_xml_fiscal` (pacote
  `PL_MDFe_300b_NT012025_1.05`).

Do pacote ficaram só os arquivos que o sistema usa (MDF-e modelo 58, modal
rodoviário, consultas e eventos do emitente), sem alteração:

| Arquivo | Para quê |
| --- | --- |
| `mdfe_v3.00.xsd`, `mdfeTiposBasico_v3.00.xsd`, `tiposGeralMDFe_v3.00.xsd`, `xmldsig-core-schema_v1.01.xsd` | O MDF-e assinado |
| `mdfeModalRodoviario_v3.00.xsd` | O grupo `rodo`, que o esquema principal não confere (`infModal` aceita qualquer conteúdo) |
| `procMDFe_v3.00.xsd`, `retMDFe_v3.00.xsd` | O MDF-e autorizado com o protocolo (`mdfeProc`) e o retorno da recepção |
| `consStatServMDFe_v3.00.xsd`, `retConsStatServMDFe_v3.00.xsd`, `consStatServTiposBasico_v3.00.xsd` | Status do serviço |
| `consSitMDFe_v3.00.xsd`, `retConsSitMDFe_v3.00.xsd`, `consSitMDFeTiposBasico_v3.00.xsd` | Consulta pela chave |
| `consMDFeNaoEnc_v3.00.xsd`, `retConsMDFeNaoEnc_v3.00.xsd`, `consMDFeNaoEncTiposBasico_v3.00.xsd` | Consulta dos MDF-e não encerrados |
| `eventoMDFe_v3.00.xsd`, `retEventoMDFe_v3.00.xsd`, `procEventoMDFe_v3.00.xsd`, `eventoMDFeTiposBasico_v3.00.xsd` | O envelope do evento, o retorno e o evento registrado |
| `evEncMDFe_v3.00.xsd`, `evCancMDFe_v3.00.xsd`, `evIncCondutorMDFe_v3.00.xsd`, `evInclusaoDFeMDFe_v3.00.xsd` | O `detEvento` de cada evento (encerramento, cancelamento, inclusão de condutor e inclusão de DF-e) |

Ficaram de fora: os outros modais (aéreo, aquaviário e ferroviário), o lote
assíncrono (`enviMDFe`, `consReciMDFe`: o serviço foi desligado em 30/06/2024
pela NT 2024.001), a distribuição de DF-e e os eventos de pagamento e de
confirmação do serviço.

**Limitação conhecida deste pacote:** o atributo `Id` do `infMDFe` ainda é
`MDFe[0-9]{44}`, embora o CNPJ (`TCnpj`), a chave (`TChMDFe`) e o QR Code já
aceitem o CNPJ alfanumérico. Um MDF-e de emitente com letras no CNPJ não passa
neste esquema (`tests/mdfe.test.ts` registra o caso).

Quando sair pacote novo: baixe do portal, troque os arquivos desta pasta,
atualize este README e rode `npx vitest run tests/mdfe.test.ts`.
