# Esquemas XML do CT-e 4.00

Os XSD oficiais contra os quais os testes validam o que o sistema monta
(`tests/cte-apoio.ts`, função `errosNoEsquema`). Não são usados em produção: a
validação de esquema é feita pela SEFAZ.

- **Pacote:** `PL_CTe_400_NT2026.004 RTC_1.00.zip` (Pacote de Liberação 4.00 da
  NT 2026.004 v1.00).
- **Origem:** Portal do CT-e, "Esquemas XML"
  (`https://www.cte.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=0xlG1bdBass=`),
  item "Schemas XML CT-e - NT 2026.004 - v.1.00 (Publicado em 05/10/2026)".
- **Baixado em:** 10/10/2026.
- **SHA-256 do zip:** `0baa08c97f2076bda6ec8ff4b95f36dd9c84dcf66af3a75023dfe02390a3db98`.
- **Vigência:** a NT 2026.004 entra em homologação em 13/10/2026 e em produção em
  16/11/2026. O que está em produção em 10/10/2026 é o pacote da NT 2026.002
  v1.01 (`PL_CTe_400_NT2026.002 RTC_1.01_corr_2.zip`, de 24/08/2026). O sistema
  não usa nenhum campo que exista só no pacote novo, e a suíte `tests/cte.test.ts`
  foi rodada uma vez, à mão, também contra o pacote da NT 2026.002: passou inteira.

Do pacote ficaram só os arquivos que o sistema usa (CT-e modelo 57, modal
rodoviário, consulta, status e evento de cancelamento), sem alteração:

| Arquivo | Para quê |
| --- | --- |
| `cte_v4.00.xsd`, `cteTiposBasico_v4.00.xsd`, `tiposGeralCTe_v4.00.xsd`, `DFeTiposBasicos_v1.00.xsd`, `xmldsig-core-schema_v1.01.xsd` | O CT-e assinado (com o grupo `IBSCBS` da Reforma Tributária) |
| `cteModalRodoviario_v4.00.xsd` | O grupo `rodo`, que o esquema principal não confere (`infModal` aceita qualquer conteúdo) |
| `procCTe_v4.00.xsd`, `retCTe_v4.00.xsd` | O CT-e autorizado com o protocolo (`cteProc`) e o retorno da recepção |
| `consStatServCTe_v4.00.xsd`, `retConsStatServCTe_v4.00.xsd`, `consStatServTiposBasico_v4.00.xsd` | Status do serviço |
| `consSitCTe_v4.00.xsd`, `retConsSitCTe_v4.00.xsd`, `consSitCTeTiposBasico_v4.00.xsd` | Consulta pela chave |
| `eventoCTe_v4.00.xsd`, `retEventoCTe_v4.00.xsd`, `procEventoCTe_v4.00.xsd`, `eventoCTeTiposBasico_v4.00.xsd`, `evCancCTe_v4.00.xsd` | Evento de cancelamento (o `detEvento` também tem esquema próprio) |

Quando sair pacote novo: baixe do portal, troque os arquivos desta pasta,
atualize este README e rode `npx vitest run tests/cte.test.ts`.
