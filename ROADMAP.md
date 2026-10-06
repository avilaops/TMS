# Mello Gestão - Sistema Central da Mello Transportes

A Mello Transportes necessita de um **sistema central completo**, não apenas de um aplicativo operacional isolado. O sistema deve gerenciar toda a empresa e transformar em operação prática o posicionamento da marca: prazo, confiança, comunicação e compromisso com coleta e entrega.

O sistema deverá concentrar:
- Operação logística (coletas e entregas)
- Aplicativo do motorista
- Área do cliente
- Comprovantes de entrega
- Rastreamento
- Financeiro (faturamento, contas a pagar e receber)
- Manutenção da frota
- Documentos
- Usuários e permissões
- Relatórios gerenciais
- Notificações
- Auditoria

A operação inteira da transportadora passará a acontecer dentro desta plataforma.

---

## 1. Módulos do Sistema

### 1.1 CRM e gestão de clientes
Cadastro completo de cada cliente contendo razão social, nome fantasia, CNPJ, IE, contatos, endereços, responsáveis, condição de pagamento, limite de crédito, tabela de frete, cidades atendidas, documentos e histórico.
- **Automação e Validação:** Integração com a **Brasil API** para busca e preenchimento automático dos dados a partir do CNPJ. O sistema deve bloquear o cadastro de CNPJs duplicados.
Gestão comercial: leads, propostas, negociações, contratos e reajustes.

### 1.2 Cotação de frete
Cálculo de frete considerando peso real, peso cubado, quantidade de volumes, origem, destino, valor da mercadoria, frete mínimo, coleta urbana, redespacho, seguro, prazo e tabela do cliente.
A cotação aprovada vira uma ordem operacional automaticamente.

### 1.3 Solicitações de coleta
Podem ser criadas pelo cliente, comercial, operador ou integração.
Campos principais: remetente, destinatário, origem, destino, volumes, peso, cubagem, NF, chave da NF-e, valor da mercadoria, janela de horário, motorista, veículo, prioridade.

### 1.4 Recebimento e conferência
Leitura de código de barras ao chegar na unidade, conferência de volumes, peso conferido, registro de avarias e fotos, vinculação à NF-e, impressão de etiqueta interna e alocação.

### 1.5 Gestão do depósito
Visibilidade da localização no depósito (unidade, setor, corredor, posição), data de entrada, e situação. 
Alertas de: mercadorias paradas, entregas atrasadas, volumes sem rota, e divergências de quantidade.

### 1.6 Manifestos, cargas e rotas
Agrupamento de entregas.
Cada manifesto contém: motorista, ajudante, veículo, rota, cidades, entregas, coletas, peso/volume total, quilometragem, despesas previstas, previsão de saída e retorno, e etapas de conferência.
Fluxo: `Em montagem → Em conferência → Liberado → Em rota → Em retorno → Finalizado`

### 1.7 Aplicativo do motorista
Ambiente próprio (inicialmente PWA, depois Nativo).
Funcionalidades: jornada, entregas e coletas do dia, navegação, atualização de status, registro de fotos, coleta de assinaturas, identificação do recebedor, registro de ocorrências (com áudio e localização), finalização de entrega, registro de despesas, abastecimento e checklist do veículo.
Deve funcionar temporariamente sem internet e sincronizar.

### 1.8 Comprovante digital de entrega
Geração de comprovante com: NF, destinatário, data, hora, motorista, veículo, recebedor (nome/doc), assinatura, fotos, localização e observações.
Controle e aprovação: `Entregue → Comprovante enviado → Em conferência → Aprovado → Cliente notificado`

### 1.9 Área do cliente
Ambiente restrito onde o cliente (vendo apenas dados da sua empresa) pode: solicitar coleta, pedir cotação, rastrear entregas, baixar comprovantes, faturas e relatórios, consultar tabelas, abrir atendimentos e cadastrar destinatários.

### 1.10 Rastreamento público
Página pública (sem necessidade de login) para acompanhamento.
Busca por código de rastreamento, NF, CPF/CNPJ ou protocolo. Exibe apenas informações seguras sobre o andamento.

### 1.11 Notificações
Avisos via Push, WhatsApp, E-mail (e futuramente SMS) sobre: coleta confirmada, motorista a caminho, mercadorias recebidas, saiu para entrega, aproximação do local, entrega realizada, ocorrências e cobranças.

### 1.12 Financeiro completo
Módulo integrado para dispensar o uso de ERPs terceiros (como Odoo).
- **Contas a receber:** faturas, parcelas, baixas, juros, descontos, inadimplência, acordos.
- **Contas a pagar:** fornecedores, combustível, manutenção, pedágio, aluguel, folha, viagens.
- **Fluxo de caixa:** saldo, entradas, saídas, previsto vs realizado, centro de custo e conciliação.
- **Cobrança:** emissão de boleto, Pix, recibo, avisos de vencimento e atraso.

### 1.13 Faturamento do transporte
Usa os dados reais operacionais: peso real/cubado, frete mínimo, pedágio, coleta, reentrega, devolução, etc.
Faturamento pode ser gerado por entrega, período, manifesto ou cliente.

### 1.14 Documentos fiscais
Cadastro de NF-e, leitura e armazenamento de XML/PDF.
Futuramente: emissão fiscal (CT-e) própria, como módulo específico com certificados e integrações contábeis.

### 1.15 Frota
Cadastro e controle de veículos, motoristas, documentação, pneus, abastecimentos, manutenções, multas, seguros, licenciamento e checklists.
Alertas de vencimento e manutenção preventiva.

### 1.16 Recursos humanos operacional
Controle de funcionários (motoristas, ajudantes), jornada, férias, ausências, adiantamentos, comissões e produtividade.

### 1.17 Atendimento e ocorrências
Gestão de chamados de clientes ou internos (atraso, avaria, extravio, cobrança, reentrega).
Fluxo: `Aberto → Em análise → Em tratamento → Resolvido → Encerrado`

### 1.18 Relatórios e indicadores
- **Operacionais:** entregas no prazo, ocorrências, desempenho por motorista/veículo, tempo médio.
- **Comerciais:** conversão de cotações, receita por cliente, novos/inativos.
- **Financeiros:** inadimplência, DRE básico, receita, custos, margem por rota/cliente.

### 1.19 Usuários, permissões e auditoria
Perfis de acesso: Administrador, Diretoria, Operação, Expedição, Conferência, Comercial, Financeiro, Motorista, Cliente.
Auditoria rigorosa: Toda mudança de status e ação importante registra usuário, data, hora, IP, dispositivo, valor antigo e novo valor.

---

## 2. Arquitetura Técnica Recomendada

O ecossistema é dividido em quatro interfaces principais:
1. **Mello Gestão:** Painel administrativo completo.
2. **Mello Motorista:** Aplicativo ou PWA para motoristas e ajudantes.
3. **Mello Cliente:** Portal empresarial para clientes da transportadora.
4. **Mello Rastreio:** Consulta pública de entregas.

### 2.1 Stack Tecnológica
- **Front-end:** Next.js com TypeScript; interfaces responsivas e modernas.
- **App do Motorista:** PWA (Progressive Web App) para facilitar instalação imediata, migrando para Nativo se houver necessidade.
- **Back-end:** API própria em Node.js com TypeScript.
- **Banco de Dados:** PostgreSQL próprio em nuvem.
- **Infraestrutura:** Armazenamento seguro de arquivos e fotos, filas para envio de notificações, e sistema de logs e auditoria.

### 2.2 Estrutura do Banco de Dados (Entidades Principais)
- `usuarios`, `perfis`
- `clientes`, `enderecos`, `destinatarios`
- `motoristas`, `veiculos`
- `coletas`, `coleta_volumes`
- `entregas`, `entrega_volumes`
- `manifestos`, `manifesto_entregas`
- `rotas`, `ocorrencias`
- `comprovantes`, `assinaturas`, `arquivos`
- `notificacoes`, `historico_status`
- `tabelas_frete`, `faturas`, `despesas_viagem`
- `logs_auditoria`

---

## 3. Fases e Ordem de Desenvolvimento

O sistema deve nascer preparado na sua arquitetura para abranger toda a empresa, mas não deve ser desenvolvido inteiro de uma única vez. 

O primeiro produto utilizável (MVP) deve fechar o fluxo central:
`Cotação → Coleta → Recebimento → Rota → Entrega → Comprovante → Faturamento → Cobrança`

### Fase 1: Núcleo Operacional (Obrigatório Inicial)
- [x] Login, usuários e permissões.
- [x] Cadastros de clientes, motoristas e veículos.
- [x] Gestão de coletas e entregas.
- [ ] Status, manifestos e rastreamento.
- [ ] Aplicativo do motorista (PWA).
- [ ] Geração e aprovação de comprovantes (fotos e assinaturas).
- [ ] Área básica do cliente.

### Fase 2: Financeiro e Comercial
- [ ] CRM e cotações.
- [ ] Tabelas de frete.
- [ ] Faturamento do transporte.
- [ ] Contas a pagar e receber, e fluxo de caixa.
- [ ] Cobranças e relatórios básicos.

### Fase 3: Frota e Depósito
- [ ] Conferência via bipagem e localização de volumes.
- [ ] Controle de manutenção, abastecimento, pneus e documentos.
- [ ] Custos detalhados de frota e checklists.

### Fase 4: Fiscal e Automações
- [ ] Leitura de XML e documentos fiscais.
- [ ] Emissão fiscal (CT-e).
- [ ] Notificações avançadas (Push, WhatsApp).
- [ ] Integrações bancárias automatizadas e roteirização avançada com geolocalização.
