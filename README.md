# TMS

Sistema de gestão de transportes para operação terrestre, de carga fracionada e dedicada: coletas, manifestos, motoristas, veículos, financeiro, notas fiscais (leitura de XML de NF-e), app do motorista e portal do cliente.

Nasceu como o sistema da Mello Transportes Rio Preto (este repositório se chamava `Mello`) e ainda roda a operação dela. Em 06/10/2026 o site institucional saiu daqui para [avilaops/mellotransportesriopreto.com.br](https://github.com/avilaops/mellotransportesriopreto.com.br); o que ficou é só o sistema.

- Endereço: https://tms.avilaops.com
- Site da Mello (consome a API pública): https://mellotransportesriopreto.com.br
- Roadmap: [ROADMAP.md](ROADMAP.md)

## O que tem aqui

| Área | Rota | Quem acessa | O que faz |
| --- | --- | --- | --- |
| Gestão | `/dashboard` | `ADMIN`, `OPERATION` | Clientes, CRM, coletas, manifestos, motoristas, veículos e frota (manutenção, abastecimento, documentos, pneus, checklist, custos), equipe (ajudantes, ausências, adiantamentos e produtividade), ocorrências (chamados de clientes e da equipe), financeiro, notas fiscais (importação de XML de NF-e; CT-e só com registro manual, sem emissão), mensageria (histórico dos avisos para sistemas de fora), auditoria, usuários |
| Motorista | `/driver` | `DRIVER` | PWA com viagens, mapa, baixa de entrega com comprovante e fila offline, checklist do veículo da viagem e registro de ocorrência na entrega |
| Cliente | `/portal` | `CLIENT` | Coletas (pedido, acompanhamento com rastreio e comprovante de entrega), faturas, minutas e atendimento (chamados) da própria empresa |
| API pública | `/api/cotacoes`, `/api/leads`, `/api/rastreio` | Site do transportador | Recebe cotação e lead, responde o rastreio por CNPJ/CPF + código |

Não há página pública: a raiz `/` leva quem já entrou para a própria área e todo o resto para `/login`.

O controle de acesso por perfil fica em [src/proxy.ts](src/proxy.ts) e é conferido de novo no servidor em cada rota interna. Perfis são estritos: um `ADMIN` não entra em `/driver` nem em `/portal`, porque não tem motorista nem empresa vinculados.

### Quem consome a API pública

O site do transportador não chama o TMS do navegador: o servidor do site repassa as três rotas acima (rewrite), então não há CORS. O limite de tentativas do rastreio usa o `x-forwarded-for`, que precisa chegar até aqui com o IP do visitante.

## Stack

- **Next.js 16** (App Router, `output: "standalone"`), **React 19**, **TypeScript**
- **Tailwind CSS 4** e componentes shadcn/Base UI
- **Prisma 7** com `@prisma/adapter-pg` e **PostgreSQL 18**
- **NextAuth 4** com login por e-mail e senha (bcrypt) e sessão JWT
- **Vitest** contra Postgres real
- Docker, GitHub Actions (GHCR) e Caddy no Hetzner

> Esta versão do Next.js tem mudanças de API em relação a versões anteriores (por exemplo, `middleware.ts` virou `proxy.ts`). Antes de mexer, consulte `node_modules/next/dist/docs/`.

## Rodando localmente

Requisitos: Node 22+ e um Postgres acessível. Tudo aqui precisa do banco.

```bash
npm install
cp .env.example .env          # preencha DATABASE_URL e NEXTAUTH_SECRET
npx prisma generate
npm run db:push               # cria as tabelas e aplica o isolamento por empresa
TENANT_SLUG=minha-transportadora TENANT_NAME="Minha Transportadora" \
  ADMIN_EMAIL=voce@exemplo.com ADMIN_PASSWORD=troque-por-12-caracteres npx tsx prisma/seed.ts
npm run dev
```

Para subir só o banco com Docker:

```bash
docker compose -f docker-compose.dev.yml up -d   # expõe em 127.0.0.1:5436 (usuário, senha e banco: tms)
```

### Comandos

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de produção (standalone) |
| `npm start` | Sobe o build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest; exige `DATABASE_URL` apontando para um Postgres de teste |

### Variáveis de ambiente

Todas estão documentadas em [.env.example](.env.example). As essenciais:

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Conexão Postgres |
| `NEXTAUTH_URL` | URL pública do sistema (`https://tms.avilaops.com` em produção) |
| `NEXTAUTH_SECRET` | Assinatura do JWT de sessão |
| `AVILAOPS_CLIENT_ID`, `AVILAOPS_CLIENT_SECRET` | Cliente OIDC do TMS no auth (o segredo é o `OIDC_SEGREDO_TMS` de lá) |
| `TMS_EMPRESA_PADRAO` | Slug da empresa das rotas públicas de cotação e lead quando a requisição não informa `empresa` |
| `TENANT_SLUG`, `TENANT_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Seed: cria a empresa e o administrador dela |

## Várias empresas no mesmo sistema (multi-tenant)

Cada transportadora é uma linha de `Tenant`, e toda tabela de negócio tem `tenantId`. Todas dividem o mesmo banco; quem separa uma da outra é o **Postgres**, não o código de cada rota:

- **Políticas de segurança por linha** ([prisma/sql/010-rls.sql](prisma/sql/010-rls.sql)). Consulta feita em nome de uma empresa roda numa transação que troca para o papel `tms_app` e grava a empresa em `app.tenant_id`. Para esse papel, só existem as linhas daquela empresa: um `findMany` sem filtro, um `UPDATE` sem `WHERE` ou um id de outra empresa na URL não alcançam dado alheio.
- **`tenantId` preenchido pelo banco.** O valor padrão da coluna lê `app.tenant_id`. O código não informa a empresa ao gravar, e gravar fora de uma transação de empresa falha em vez de cair na empresa errada.
- **Referência entre empresas é recusada** por gatilho (`tms_mesmo_tenant`): chave estrangeira não passa por política, e sem isso daria para apontar uma coleta para o cliente de outra empresa sabendo o id.
- **Unicidade por empresa:** CNPJ do cliente, CPF do motorista, placa, e-mail do usuário e chave de NF-e importada são únicos dentro da empresa. Código de rastreio e chave de CT-e continuam únicos no sistema inteiro.

No código ([src/lib/prisma.ts](src/lib/prisma.ts)):

| Uso | O que é |
| --- | --- |
| `prisma` (export padrão) | Empresa tirada da sessão de quem fez a requisição. Sem sessão, lança erro: não há consulta sem empresa |
| `transacao(fn)` | Transação interativa na empresa da sessão. O cliente padrão não tem `$transaction` de propósito |
| `paraEmpresa(id)` | Empresa informada por quem chama: rota pública que recebe a empresa por parâmetro |
| `sistema` | Sem empresa e sem política. Só para o que acontece antes de haver empresa: login, saúde, rastreio público por código, seed |

**Login.** O TMS não tem senha própria. A tela `/login` manda direto para o login único da Ávila Ops (`auth.avilaops.com`), por **OIDC** (authorization code + PKCE; provedor `avilaops` em [src/lib/auth.ts](src/lib/auth.ts)). É o auth que autentica (senha, Google, Microsoft, Facebook), confere se a conta foi liberada para o app `tms` e cobra o segundo fator; o TMS recebe só quem passou. Por ser OIDC e não cookie de `.avilaops.com`, funciona também em domínio próprio de cliente: basta registrar o endereço de retorno do domínio novo em `src/lib/oidc.ts` do auth. Sair encerra também a sessão do auth ([src/lib/sair.ts](src/lib/sair.ts)).

**Em que empresa a pessoa entra** (`resolverEntrada`). O e-mail é único por empresa, não no sistema. Com cadastro em uma empresa só, entra direto. Com cadastro em mais de uma, escolhe em `/empresa`. Sem cadastro em nenhuma, não entra. A empresa escolhida vai no token da sessão (`tenantId`), que dura 8 horas, como a sessão do auth.

**Equipe da Ávila Ops** (papel `ADMIN` no auth). Opera a plataforma: em `/plataforma/empresas` cria empresa com o primeiro administrador, renomeia, desativa e reativa (desativar impede a entrada e as rotas públicas, sem apagar nada). Em `/empresa` entra em qualquer empresa ativa; na primeira entrada nasce um administrador "Nome (Ávila Ops)", visível na lista de usuários daquela empresa. Administrador de transportadora não é equipe e não vê outras empresas.

**Cadastrar alguém já libera o acesso** ([src/lib/acessos.ts](src/lib/acessos.ts)). Criar usuário, motorista ou empresa (com o primeiro administrador) chama a API de provisionamento do auth (`POST /api/provisionamento/acessos`, autenticada com o mesmo cliente OIDC do login), que garante a conta e libera o app `tms`. O TMS não tem caixa de e-mail: pede ao auth (`enviarConvite`) que escreva para a pessoa. Conta nova, ou que a pessoa ainda não assumiu, recebe o **convite**: endereço de uso único, válido por 7 dias, para criar a senha; ao salvar, ela já cai em `/login` do TMS, que abre a sessão. Conta que já tinha senha recebe só o endereço do sistema. O endereço da senha não passa pelo TMS; só volta na resposta (e aí a tela o mostra uma vez, com "Copiar" e "Enviar por WhatsApp") quando o e-mail não saiu. Se o auth não responder, o cadastro vale mesmo assim. "Liberar acesso" (`POST /api/usuarios/[id]/acesso`) refaz tudo e serve de "enviar convite de novo". O resultado de cada pedido fica no cadastro (`User.inviteStatus`, `inviteDetail`, `inviteAt`; script `prisma/sql/013-invite-status.sql`) e aparece na lista de usuários, sob o e-mail. Trocar o e-mail de um motorista libera o novo e revoga o antigo, se nenhum outro cadastro o usa.

Nenhuma tela pede senha. A coluna `password` do usuário continua no banco por enquanto, com um valor `sem-senha:…` que não é hash de nada e que nenhum código lê.

**Tabela nova.** Declare `tenantId` igual ao das outras (com o `@default(dbgenerated(...))` e a relação com `Tenant`), rode `npm run db:push` e, se ela referencia outra tabela, acrescente o par em `referencias`, no `010-rls.sql`. A política e as permissões são criadas sozinhas para toda tabela que tenha `tenantId`.

**Rotas públicas.** `POST /api/leads` e `POST /api/cotacoes` aceitam `empresa` (slug) no corpo; sem ele vale `TMS_EMPRESA_PADRAO`. Empresa inexistente ou desativada responde 404. `GET /api/rastreio` não precisa de empresa: o código de rastreio é único no sistema. A página pública `/rastreio` usa essa rota: pede o CNPJ ou CPF de quem contratou e o código, mostra a transportadora, a situação e a linha do tempo, e aceita link já preenchido (`/rastreio?cnpj=…&codigo=…`).

Os testes em [tests/multi-tenant.test.ts](tests/multi-tenant.test.ts) provam o isolamento contra o banco, com duas empresas.

## Tabelas de frete e cotação

O preço do frete sai de tabelas cadastradas no painel (`/dashboard/tabelas-frete`), nunca de valor fixo no código.

- **Tabela** (`FreightTable`): peso coberto pelo frete mínimo, valor do kg excedente, fator de cubagem, valor de nota coberto e percentual sobre o que passa dele, máximo de volumes, percentuais de reentrega e devolução, e validade. Uma por empresa é a **padrão**; marcar outra como padrão desmarca a anterior.
- **Cidades** (`FreightTableCity`): frete mínimo e prazo de cada cidade atendida. A tela aceita a lista colada da planilha (`Cidade;Mínimo;Prazo`, com vírgula decimal e prazos como `Até 24h`) e grava a lista inteira de uma vez.
- **Cliente**: pode ter uma tabela negociada (`Client.freightTableId`). Sem ela, vale a padrão.
- **A conta** ([src/lib/frete.ts](src/lib/frete.ts), `calcularFrete`): mínimo da cidade + excedente sobre o maior entre peso real e cubado + percentual sobre a nota acima do limite. Volumes acima do combinado, nota acima do limite sem percentual definido e cidade só com veículo dedicado saem como **aviso**, sem impedir o cálculo. O nome da cidade casa sem acento, caixa, UF ou apóstrofo.
- **Qual tabela vale** (`tabelaVigente`): a do cliente, se ativa e dentro da validade; senão a padrão; senão nenhuma.
- **Cotação do site** (`POST /api/leads` e `/api/cotacoes`, [src/lib/cotacao.ts](src/lib/cotacao.ts)): o valor estimado vem da tabela padrão da empresa. Sem tabela em vigor, ou com a cidade fora dela, o pedido é gravado sem valor para o comercial responder.
- **Permissão**: criar e alterar tabela e cidades é do administrador; a operação consulta e usa o simulador (`POST /api/tabelas-frete/calcular`).
- **Cotação aprovada vira coleta** (`/dashboard/crm`, [src/lib/crm.ts](src/lib/crm.ts)): no funil, "Converter em coleta" pede cliente, remetente e destinatário e cria a coleta confirmada, com código de rastreio e a carga do pedido (`POST /api/dashboard/crm/[id]/converter`). O lead convertido fica ligado à coleta e travado: não muda mais de status nem de valor. "Convertido" só existe pela conversão, e lead perdido precisa voltar para "Em contato" antes de converter. A coleta nasce com o frete da tabela, não com o valor estimado da cotação: quando os dois diferem, a confirmação mostra os dois, e quem quiser cobrar o valor da cotação edita o frete na coleta. O valor da nota vem do pedido; apagar o campo na conversão grava a coleta sem valor de nota.

- **Frete na coleta** ([src/lib/frete-coleta.ts](src/lib/frete-coleta.ts)): toda coleta, do painel ou do portal, nasce com o frete calculado pela tabela do cliente (ou pela padrão), o prazo e a composição da conta (`freightValue`, `freightDeadlineHours`, `freightDetails`). Mudar destino, peso, volumes ou valor da nota refaz o cálculo. O operador pode fixar o valor à mão na edição (`freightManual`); apagar o campo devolve a conta para a tabela. Sem tabela em vigor, ou com o destino fora dela, a coleta fica "a cotar". O cliente vê no portal só o valor e o prazo.

## Faturamento

Em `/dashboard/faturamento` o administrador cobra de um cliente o frete das cargas entregues.

- **Faturável** é a carga entregue, com frete definido e fora de fatura. Carga entregue "a cotar" aparece à parte, com o campo para informar o frete (`PATCH /api/coletas/[id]/frete`, que vale em qualquer status enquanto a carga não foi faturada).
- **Emitir** (`POST /api/faturas`) soma os fretes, dá o próximo número da empresa, prende as cargas na fatura e cria o lançamento a receber no financeiro. É esse lançamento que o cliente vê em "Faturas" no portal. A numeração é por empresa e uma emissão por vez (trava do Postgres), então não repete nem pula.
- **Pagar, reabrir, cancelar** (`PATCH /api/faturas/[id]`): o lançamento acompanha a fatura na mesma transação. Pagar abre a baixa e aceita `juros`, `multa` e `desconto`, que vão para o lançamento da fatura (o total da fatura é o emitido e não muda); ver [Financeiro](#financeiro-contas-a-pagar-a-receber-e-fluxo-de-caixa). Cancelar solta as cargas, que voltam a ser faturáveis; o número cancelado não é reaproveitado, e fatura paga precisa ser reaberta antes de cancelar.
- **Depois de faturada**, a carga não muda mais de frete: a fatura já saiu com ele.
- `/dashboard/faturamento/[id]` é a fatura pronta para imprimir ou salvar em PDF.

Ainda não há boleto, Pix nem envio automático do aviso de cobrança: a baixa é manual. A posição do que está em aberto, o aviso para copiar e o recibo ficam em [Cobrança](#cobrança).

## Financeiro: contas a pagar, a receber e fluxo de caixa

Em `/dashboard/financeiro`, só para o administrador. As regras e as contas ficam em [src/lib/financeiro.ts](src/lib/financeiro.ts).

- **Lançamento** (`FinancialTransaction`): receita ou despesa, valor, vencimento, cliente ou fornecedor, categoria, **centro de custo** e observação. Quando é pago guarda a data (`paidAt`) e a forma de pagamento.
- **Baixa com juros, multa e desconto:** receber um título abre a baixa, com os três campos (valores em reais, maiores ou iguais a zero). O valor original (`amount`) não muda; o que entrou de fato fica em `paidAmount` (original + juros + multa − desconto, nunca negativo), junto de `interest`, `fine` e `discount`. Baixa sem encargo, ou com os três zerados, é a de sempre e não guarda nada; reabrir apaga os quatro. Vale só para título **a receber**: despesa é paga pelo valor. O fluxo de caixa **realizado**, o "recebido no mês", os relatórios, a receita do painel e o recibo usam o valor recebido quando ele existe; o **previsto** e o que está em aberto continuam no valor original.
- **Sugestão de encargos:** título vencido abre a baixa com a multa e os juros já calculados (`encargosSugeridos` em [src/lib/cobranca.ts](src/lib/cobranca.ts)): multa é o percentual sobre o valor, uma vez; juros são simples e proporcionais aos dias de atraso (o percentual do mês dividido por 30). É só sugestão: o operador altera ou apaga. Os percentuais são da empresa (padrão de 2% e 1% ao mês) e ficam em [Empresa](#empresa), seção Cobrança.
- **Centro de custo:** texto livre e opcional (filial, rota, veículo…), com sugestão dos já usados; a lista filtra por ele (`?centro=`, sem diferenciar maiúsculas) e o relatório financeiro soma as despesas pagas no período por centro.
- **Situação** é calculada: pago, em aberto ou vencido. Vence no fim do dia do vencimento, no relógio do Brasil; o vencimento em si é um dia do calendário e é lido em UTC, para não aparecer um dia antes.
- **Rotas:** `GET /api/financeiro` (filtros `tipo`, `situacao`, `de`, `ate`, `centro`), `POST` com validação, `PATCH /api/financeiro/[id]` (editar, `action: "pagar"` — com `juros`, `multa` e `desconto` opcionais — ou `"reabrir"`) e `DELETE`.
- **Lançamento que veio de fatura** não é pago, editado nem excluído por aqui: responde 409 e manda para o Faturamento, que mantém fatura e lançamento em sincronia. Pagar a fatura grava o `paidAt` do lançamento.
- **Fluxo de caixa** (`GET /api/financeiro/fluxo?de=AAAA-MM&ate=AAAA-MM`, padrão de três meses para trás e três para a frente, no máximo 36): por mês, o **previsto** (o que vence no mês) e o **realizado** (o que foi pago ou recebido no mês), com saldo e acumulado. O resumo dos cartões é sempre de todos os lançamentos: conta vencida há um ano continua vencida.

Ainda não existe: boleto, Pix, conciliação bancária, parcelamento, lançamento recorrente e acordo de dívida. A baixa é sempre do título inteiro (não há recebimento parcial), os encargos não entram no lançamento já criado como pago (só na baixa), e o centro de custo é um texto no lançamento, sem cadastro nem rateio.

## Cobrança

Em `/dashboard/cobranca`, só para o administrador. As contas ficam em [src/lib/cobranca.ts](src/lib/cobranca.ts) e não mudam o banco: a tela só lê.

- **Posição por cliente** (`GET /api/financeiro/cobranca`): os lançamentos a receber em aberto, agrupados por quem deve (o cliente; sem cliente, o pagador digitado; sem nenhum, "Sem cliente informado"), com total, vencido e o maior atraso em dias. Quem mais deve em atraso aparece primeiro.
- **Faixas de atraso:** a vencer, 1 a 30, 31 a 60, 61 a 90 e mais de 90 dias, contados do vencimento até hoje no relógio do Brasil. Título sem vencimento conta em "a vencer".
- **Aviso de cobrança:** o texto já redigido com os títulos do cliente (lembrete quando nada venceu, atraso quando algo venceu), para copiar e mandar pelo canal de costume. O sistema não envia nada e o texto não traz dado de pagamento.
- **Recibo** (`GET /api/financeiro/[id]/recibo`, tela `/dashboard/financeiro/recibo/[id]`): só de receita já recebida, para imprimir ou salvar em PDF. Chega-se a ele pelo link "Recibo" no Financeiro e na fatura paga.

A baixa continua no Faturamento e no Financeiro (com juros, multa e desconto); título pago sai da posição, e o recibo sai pelo valor recebido, com a composição quando houve encargo. A posição e o aviso mostram o valor original do título, sem juros nem multa. Parcelas e o registro de que o aviso foi mandado não existem.

## Relatórios

Em `/dashboard/relatorios`, só para o administrador. Um período em meses (`GET /api/relatorios?de=AAAA-MM&ate=AAAA-MM`, padrão do mês corrente e os dois anteriores, no máximo 36), no relógio do Brasil. As contas ficam em [src/lib/relatorios.ts](src/lib/relatorios.ts) e não mudam o banco: a tela só lê.

- **Operação:** cargas criadas no período, por status; e as entregas feitas no período, com quantas chegaram no prazo, o tempo médio e a conta por motorista. O prazo é o da tabela de frete e corre de "Coletado" a "Entregue" no histórico da carga. Entrega sem prazo ou sem as duas datas fica como "sem medição", fora da taxa.
- **Comercial:** cotações recebidas no período por status, a conversão (as que viraram coleta sobre todas) e o frete das cargas criadas no período, por cliente. Carga cancelada ou recusada não entra no frete; carga a cotar conta à parte.
- **Financeiro:** recebido, pago e resultado pela data do pagamento (o recebido é o que entrou de fato, com juros, multa e desconto da baixa), despesas pagas por categoria e por **centro de custo**, e a inadimplência (quanto do que há a receber em aberto já venceu), que é a posição de hoje e não a do período.

- **Resultado** (campo `resultado` da mesma resposta; aba própria na tela, e o DRE também na aba Financeiro):
  - **DRE básico:** a receita recebida e as despesas pagas no período, por categoria do lançamento, e o que sobrou. É regime de caixa: vale a data do pagamento e o valor que entrou de fato; o que foi faturado e não recebido não aparece.
  - **Margem por cliente:** o frete das cargas entregues no período menos a parte do custo das viagens que as levaram. O custo da viagem (despesas aprovadas mais combustível) é **rateado pelo peso**: cada carga leva a fração do custo que o peso dela representa no peso total da viagem. Viagem sem peso divide por igual; carga entregue fora de viagem não leva custo.
  - **Resultado por viagem:** as viagens finalizadas no período, com frete, custo, resultado e margem (a mesma conta do acerto da viagem).

Ainda não há exportação para planilha ou PDF, DRE por competência (o que há é de caixa), nem margem por rota ou por veículo.

## Frota

O que se controla de cada veículo, além do cadastro. As regras e as contas ficam em [src/lib/frota.ts](src/lib/frota.ts); as contas são funções puras e não gravam nada (consumo, custo por km e situação de documento são calculados na leitura).

**Tela do veículo** (`/dashboard/veiculos/[id]`, pelo link "Manutenção e frota" da lista de veículos), com uma aba por assunto. O endereço antigo da manutenção (`/dashboard/veiculos/[id]/manutencao`) leva para lá.

- **Manutenção** (`GET` e `POST /api/veiculos/[id]/manutencao`): serviço, custo, data e, agora, **tipo** (preventiva ou corretiva) e **hodômetro**, os dois opcionais. Registrar continua lançando a despesa no Financeiro.
- **Abastecimento** (`GET` e `POST /api/veiculos/[id]/abastecimentos`, `DELETE .../[registroId]`): data, litros, valor total, hodômetro, posto e motorista (os dois últimos opcionais). O **consumo (km/l)** e o **custo por km** são medidos de um abastecimento para o seguinte, pelo hodômetro (conta do tanque cheio). Fica sem medição, em vez de sair com número errado: o primeiro abastecimento, o que tem hodômetro igual ou menor que o anterior, e o que tem litros zerados.
- **Documentos** (`GET` e `POST /api/veiculos/[id]/documentos`, `PATCH` e `DELETE .../[registroId]`): licenciamento (CRLV), seguro, ANTT, tacógrafo ou outro, com número, vencimento e observação. A **situação** é calculada: em dia, a vencer (hoje ou nos próximos 30 dias) ou vencido. Vence no fim do dia do vencimento, no relógio do Brasil; o vencimento é um dia do calendário, lido em UTC, como no financeiro. Renovar é editar o vencimento.
- **Pneus** (`GET` e `POST /api/veiculos/[id]/pneus`, `PATCH` e `DELETE .../[registroId]`): posição, marca e modelo, data e km de instalação, km de retirada (em branco enquanto está em uso) e observação. Registro simples, sem estoque.
- **Checklist** (`GET` e `POST /api/veiculos/[id]/checklists`): oito itens fixos (pneus, freios, luzes, óleo, água, documentos, limpeza, extintor), cada um OK ou com problema, mais hodômetro e observação. Guarda quem fez e quando; não se altera nem se apaga. O **motorista** registra pelo app, na viagem (`/driver/viagem/[id]/checklist`, `POST /api/driver/checklists`): o veículo não vem do aparelho, é o da viagem, que precisa ser dele e estar em rota. O checklist do motorista precisa de sinal (não entra na fila offline).
- **Custos** (`GET /api/veiculos/[id]/custos?de=AAAA-MM&ate=AAAA-MM`, **só administrador**; padrão do mês corrente e os dois anteriores, no máximo 36): manutenção **concluída**, abastecimento, total, km rodados, custo por km e consumo médio. Os km saem dos hodômetros dos abastecimentos, partindo do último abastecimento anterior ao período; sem dois abastecimentos em sequência não há km nem custo por km.

**Alertas** (`/dashboard/frota`, no menu em Frota; `GET /api/frota`): documentos de veículo e **CNHs** vencidos ou a vencer em 30 dias, numa lista só (a CNH é lida do cadastro do motorista, `Driver.cnhExpiry`; motorista desativado não entra), e os veículos com a situação "Em manutenção". Para o administrador vai também o **custo do mês** corrente (manutenção concluída e abastecimento de todos os veículos); para a operação o campo nem vai na resposta.

Permissão: tudo é da equipe interna (`ADMIN` e `OPERATION`), menos os custos, que são do administrador. Veículo de outra empresa responde 404, como um id inventado.

Ainda não existe: integração com bomba ou cartão de combustível, multas, estoque de pneus, telemetria, aviso de vencimento por mensagem (o alerta é só na tela), manutenção preventiva programada por km, e anexo do documento (PDF ou foto). O abastecimento não lança despesa no Financeiro (só a manutenção lança), e a situação de uma manutenção já registrada não é alterada pela tela.

## Equipe (recursos humanos operacional)

Em `/dashboard/equipe` (menu Frota), o controle simples de quem vai para a estrada: motoristas (os do cadastro de Motoristas) e ajudantes. Uma aba por assunto. As regras e as contas ficam em [src/lib/equipe.ts](src/lib/equipe.ts); as contas são funções puras e não gravam nada (quem está ausente num dia, a diferença do acerto e a comissão são calculados na leitura).

- **Pessoas** (`GET /api/equipe`): motoristas e ajudantes numa lista só, com quem está **ausente hoje** (o dia é o do relógio do Brasil). O **ajudante** (`Helper`: nome, CPF único por empresa, telefone, ativo) é cadastrado aqui (`GET` e `POST /api/equipe/ajudantes`, `PATCH .../[id]`); ele não tem login. O CPF é a chave do cadastro e não se altera, como no motorista.
- **Ausências** (`Absence`; `GET` e `POST /api/equipe/ausencias`, `PATCH` e `DELETE .../[id]`): de um motorista **ou** de um ajudante, com tipo (férias, folga, atestado, falta, outro), primeiro e último dia (os dois contam; são dias do calendário, gravados à meia-noite UTC) e observação. `GET ?dia=AAAA-MM-DD` devolve só as que cobrem aquele dia. Na montagem de viagem (`/dashboard/manifestos`), escolher um motorista ausente hoje mostra um **aviso**; não bloqueia.
- **Adiantamentos e acertos** (`CrewAdvance`; `GET` e `POST /api/equipe/adiantamentos`, `PATCH .../[id]`, **só administrador**): data, valor, motivo (adiantamento de viagem, vale, outro), viagem opcional e observação. Registrar lança a **despesa no Financeiro** na mesma transação (categoria "Adiantamento", em aberto, vencendo no dia), como a manutenção faz. O **acerto** (`action: "acertar"`) guarda o valor gasto comprovado e a tela mostra a diferença: a devolver (gastou menos) ou a receber (gastou mais). `action: "reabrir"` desfaz um acerto digitado errado.
- **Produtividade** (`GET /api/equipe/produtividade?de=AAAA-MM&ate=AAAA-MM`, mesmo período dos relatórios): por motorista, viagens finalizadas, entregas, entregas no prazo, peso transportado e, **só para o administrador**, o frete das cargas entregues e a **comissão** (percentual do frete entregue). O prazo é a mesma conta dos Relatórios (`desempenhoPorMotorista`). Para a operação os campos de frete e comissão nem vão na resposta.
- **Percentual de comissão** (`Driver.commissionPct`, opcional): editado no cadastro do motorista, só pelo administrador (`PATCH /api/motoristas/[id]` responde 403 se outro perfil mandar o campo). O percentual só sai em `GET /api/motoristas`, e só para o administrador; viagens, veículos e cargas devolvem o motorista sem ele.

Permissão: pessoas, ajudantes, ausências e as contagens da produtividade são da equipe interna (`ADMIN` e `OPERATION`); adiantamentos, frete e comissão são do administrador. Registro de outra empresa responde 404, como um id inventado, e o banco recusa ausência ou adiantamento apontando para motorista, ajudante ou viagem de outra empresa.

As tabelas são criadas por [prisma/sql/019-equipe-e-baixa.sql](prisma/sql/019-equipe-e-baixa.sql) (que também traz as colunas da baixa com encargos e do centro de custo); rode `npm run db:rls` depois dela.

Ainda não existe: folha de pagamento, ponto e jornada, banco de horas, saldo e período aquisitivo de férias, anexo do atestado e comissão de ajudante (o ajudante já pode ser ligado à viagem, mas não entra na produtividade). O acerto não mexe na despesa lançada no Financeiro: a sobra devolvida ou o complemento pago são lançados lá, à mão, e o adiantamento não é apagado pela tela. A viagem conta como finalizada pela data própria de finalização (`Manifest.finishedAt`); as finalizadas antes dessa coluna existir seguem contando pela data da última alteração do manifesto. A comissão é só uma conta: não vira lançamento a pagar nem tem fechamento por período.

## Viagem: dados, rota, despesas e acerto

Em `/dashboard/manifestos`, o botão **Viagem** de cada cartão abre a tela da viagem, com uma aba por assunto. As regras e as contas ficam em [src/lib/viagem.ts](src/lib/viagem.ts) (funções puras: o link da rota, a ordem das paradas e o acerto são calculados na leitura).

- **Dados** (`PATCH /api/manifestos/[id]/dados`): ajudante (do cadastro da Equipe, ativo), hodômetro de saída e de retorno, previsão de saída e de retorno e observação. Todos opcionais; campo em branco apaga. Vale com a viagem em montagem, em rota e finalizada (o hodômetro de retorno chega no fim); só a cancelada não recebe. Os mesmos campos são aceitos na montagem (`POST /api/manifestos`). Liberar a saída grava `departedAt` e finalizar grava `finishedAt`.
- **Rota** (`PUT /api/manifestos/[id]/ordem`): a ordem das entregas, com subir e descer, gravada em `Collection.manifestSequence`. É a ordem que o painel e o **app do motorista** mostram. Vale em montagem e em rota; carga sem ordem vai para o fim, pela data de criação, e a carga retirada da viagem perde a ordem. O botão **Abrir rota no mapa** (no painel e no app) monta um link do Google Maps (`https://www.google.com/maps/dir/?api=1...`) com as paradas que faltam, na ordem: o endereço é o destino da carga, a origem é onde o aparelho está, e o link leva até 10 paradas (limite do Google Maps); passando disso entram as primeiras. Não usa API paga nem chave.
- **Despesas** (`TripExpense`; `GET` e `POST /api/manifestos/[id]/despesas`, `PATCH` e `DELETE .../[despesaId]`): tipo (pedágio, combustível, alimentação, hospedagem, estacionamento, manutenção, outro), valor, data, observação e quem lançou. Nasce **pendente**. O **motorista** lança pelo app na viagem dele em rota (`/driver/viagem/[id]/despesas`; `GET` e `POST /api/driver/manifestos/[id]/despesas`) e vê só as que ele lançou e o total delas. **Combustível com litros e hodômetro** gera também o abastecimento da frota (`Fueling`), ligado à despesa; sem um dos dois fica só a despesa. **Só o administrador aprova ou recusa:** aprovar cria, na mesma transação, o lançamento no Financeiro (a pagar, ou já pago), com a categoria do tipo e a viagem como centro de custo; recusar desfaz o abastecimento gerado. Só a pendente pode ser excluída.
- **Acerto** (`GET /api/manifestos/[id]/acerto`, **só administrador**, só viagem finalizada): frete das cargas, despesas aprovadas, combustível, custo total, km rodados, custo por km, **resultado** (frete − despesas − combustível) e margem, mais os adiantamentos ligados à viagem e o saldo deles contra as despesas aprovadas (a devolver ou a receber). O combustível são os abastecimentos da frota feitos no veículo entre o dia da saída e o da finalização, **menos** os que nasceram de uma despesa da viagem, que já estão nas despesas. Despesa pendente fica fora do custo e aparece em aviso.

Permissão: dados, ordem e lançamento de despesa são da equipe interna (`ADMIN` e `OPERATION`); aprovar despesa e o acerto são do administrador; o motorista só alcança a viagem dele que está em rota. Viagem de outra empresa responde 404, e o banco recusa despesa apontando para viagem, usuário, abastecimento ou lançamento de outra empresa. Tudo fica na Auditoria (dados e ordem da viagem; despesa lançada, aprovada, recusada e excluída).

As colunas e a tabela são criadas por [prisma/sql/020-viagem.sql](prisma/sql/020-viagem.sql); rode `npm run db:rls` depois dela.

Ainda não existe: **roteirização automática** ou otimização da ordem (a ordem é a que a operação define), **rastreamento contínuo por GPS**, **pedágio automático** (cálculo por rota ou integração com tag), etapa "Em retorno" (o fluxo continua Em montagem → Em rota → Finalizada), foto do comprovante da despesa, lançamento de despesa pelo app sem sinal (não entra na fila offline), edição de despesa já lançada (exclui e lança de novo) e despesa prevista na montagem. Duas viagens do mesmo veículo no mesmo dia dividem o abastecimento da frota desse dia: ele aparece no acerto das duas. Excluir no Financeiro o lançamento de uma despesa aprovada não a tira do custo da viagem.

## Atendimento e ocorrências

Chamados de clientes ou da equipe sobre uma carga ou sobre o serviço: atraso, avaria, extravio, cobrança, reentrega ou outro. As regras ficam em [src/lib/ocorrencias.ts](src/lib/ocorrencias.ts); a abertura (número e aviso) em [src/lib/ocorrencias-db.ts](src/lib/ocorrencias-db.ts).

- **Fluxo:** `Aberto → Em análise → Em tratamento → Resolvido → Encerrado`. A equipe só anda para a frente e pode pular etapa (resolver direto um chamado aberto). O **Resolvido pode ser reaberto** e volta para Em tratamento. **Encerrado é final:** não muda de status nem recebe mensagem. Resolver, reabrir e encerrar gravam as datas (`resolvedAt`, `closedAt`).
- **Número:** sequencial por empresa, sem buraco nem repetição, com a mesma trava da emissão de fatura (uma abertura por vez na empresa).
- **Conversa:** as mensagens ficam em ordem cronológica; a descrição de quem abriu é a primeira fala. A equipe escreve uma **resposta** (o cliente lê) ou uma **nota interna** (só a equipe lê).

**Painel** (`/dashboard/ocorrencias`, no menu em Operação, `ADMIN` e `OPERATION`): os contadores por status no topo, que também filtram a lista; filtro por tipo; e "Abrir chamado", informando o **código de rastreio** da carga (o chamado fica ligado à carga e ao cliente dono dela), ou escolhendo um cliente, ou nenhum dos dois (chamado só interno). Na lista, a carga é um link para o rastreio dela. A tela do chamado (`/dashboard/ocorrencias/[id]`) tem os dados, a conversa e as trocas de status, prioridade (baixa, normal, alta) e responsável (alguém da equipe), gravadas na hora.

**Portal do cliente** (`/portal/atendimento`): "Abrir atendimento" (assunto, título, descrição e, se quiser, uma das cargas dele), a lista dos chamados da empresa dele e a conversa de cada um, onde ele responde enquanto o chamado não estiver encerrado. O cliente vê os chamados que ele abriu **e os que a transportadora abriu em nome dele** (com carga ou cliente informado), com a descrição. Não vê: nota interna, prioridade, responsável, o nome de quem respondeu pela transportadora, nem chamado só interno. Chamado de outro cliente responde 404, igual a um id inventado.

**App do motorista** (`/driver/entregas/[id]/ocorrencia`, pelo botão "Registrar ocorrência" de cada entrega da viagem): tipo e descrição. Nasce como chamado **interno**, ligado à carga e sem cliente, então não aparece no portal; a equipe decide o que dizer ao cliente. Só vale para carga de uma viagem dele em rota, e precisa de sinal (não entra na fila offline).

| Rota | Quem | O que faz |
| --- | --- | --- |
| `GET /api/ocorrencias?status=&type=` | equipe | Lista (do mais novo para o mais antigo) e contadores por status, estes sempre de todos os chamados |
| `POST /api/ocorrencias` | equipe | Abre chamado (`type`, `title`, `description`, `priority`, `trackingCode` ou `clientId`) |
| `GET /api/ocorrencias/[id]` | equipe | O chamado, a conversa inteira, os status para onde pode ir e a equipe que pode assumir |
| `PATCH /api/ocorrencias/[id]` | equipe | Troca `status`, `priority` e `assigneeId` (vazio tira o responsável); troca fora do fluxo é 409 |
| `POST /api/ocorrencias/[id]/mensagens` | equipe | Resposta ou nota interna (`body`, `internal`) |
| `GET` e `POST /api/portal/atendimento` | cliente | Lista e abre os chamados da empresa dele (`type`, `title`, `description`, `collectionId`) |
| `GET /api/portal/atendimento/[id]` | cliente | O chamado e a conversa, sem notas internas |
| `POST /api/portal/atendimento/[id]/mensagens` | cliente | Resposta do cliente (`body`); encerrado é 409 |
| `POST /api/driver/entregas/[id]/ocorrencia` | motorista | Registra ocorrência na entrega (`type`, `description`) |

Abrir um chamado e trocar o status avisam os sistemas de fora (`ocorrencia.aberta` e `ocorrencia.status`, na seção Integração).

Ainda não existe: prazo de atendimento (SLA) com relógio, anexo de arquivo ou foto no chamado, e-mail ou mensagem automática ao cliente quando a transportadora responde (ele vê ao entrar no portal; o aviso por WhatsApp pode ser montado no destino dos eventos), aviso de mensagem nova, alteração de tipo, título ou carga depois de aberto, e os chamados na tela da carga. O painel inicial não conta chamados.

## Recebimento, conferência e depósito

Conferência dos volumes quando a carga chega, etiqueta com código de barras, posição de cada volume e a visão do que está parado no depósito. As regras ficam em [src/lib/deposito.ts](src/lib/deposito.ts); o código de barras em [src/lib/code128.ts](src/lib/code128.ts). No menu em Operação, "Depósito", para `ADMIN` e `OPERATION`. Nenhuma tela ou rota daqui mostra valor de nota ou frete.

- **Volume:** a carga diz quantos volumes tem, e cada um tem um código: o de rastreio da carga mais a sequência (`1234567890-02`). O volume só ganha linha no banco (`CollectionVolume`) quando é conferido: **recebido**, **avariado** (com observação) ou **faltando**, com peso conferido opcional, posição, quem e quando. Sem linha ele está "a conferir".
- **Conferência por leitura** (`/dashboard/deposito/conferencia`): um campo só, sempre com o foco. Leitor de código de barras é um teclado: digita o código e aperta Enter. Lê-se o código de rastreio da carga (ou a etiqueta de um volume dela) e a carga abre com os volumes esperados; cada etiqueta lida marca o volume como recebido, e "Conferir" faz o mesmo sem leitor. **Leitura repetida não conta duas vezes.** Etiqueta de outra carga é recusada, e código de carga de outra transportadora responde igual a código que não existe. Em "Editar" ficam peso, avaria, faltando e posição. Só carga **confirmada** ou **coletada** é conferida.
- **Concluir:** o que não foi lido fica como faltando; a conferência (`WarehouseReceipt`) grava quem, quando e as divergências; e a carga confirmada passa para **coletada** pelo mesmo caminho do painel de minutas (`mudarStatusDaColeta`, em [src/lib/coletas-db.ts](src/lib/coletas-db.ts)), com a linha no histórico e o evento `coleta.status`. Precisa de ao menos um volume presente. Enquanto a carga estiver no depósito dá para corrigir volume (o faltante que apareceu) e concluir de novo: os números gravados acompanham.
- **Divergências:** de **quantidade** quando chegou um número de volumes diferente do declarado; de **peso** quando todos chegaram, todos foram pesados e a soma difere do declarado em mais de 2% (`TOLERANCIA_DE_PESO_PCT`).
- **Etiqueta** (`/dashboard/deposito/etiquetas/[coletaId]`, com link na lista de minutas e na conferência): uma por volume, com cliente, destino, destinatário, "Volume 2 de 3", o código legível e o código de barras **Code 128** (subconjunto B), desenhado em SVG sem biblioteca. A tabela de padrões, o dígito verificador e o desenho são testados contra valores gerados por outra implementação ([tests/code128.test.ts](tests/code128.test.ts)). Imprime pelo navegador, duas por linha numa A4; só as etiquetas saem no papel.
- **Posições** (`/dashboard/deposito/posicoes`): cadastro com código curto único por empresa (`A-01-03`: letras, números e hífen, com ao menos uma letra, gravado em maiúsculas), descrição e ativa ou não. Aloca-se lendo o código da posição na conferência (vai para os volumes conferidos ainda sem lugar) ou no "Editar" de um volume. Posição não é apagada, é desativada.
- **Visão do depósito** (`/dashboard/deposito`): as cargas **coletadas ainda sem manifesto**, da mais antiga para a mais nova, com volumes, posição, data de entrada (quando passou para coletada) e dias parada; busca por código, cliente ou posição; cartões com cargas, volumes e cada **alerta**, que também filtram: parada há mais de 3 dias (`DIAS_PARADO_ALERTA`), divergência de quantidade, volume avariado e carga sem posição (não passou pela conferência ou tem volume presente sem lugar).

| Rota | Quem | O que faz |
| --- | --- | --- |
| `GET /api/deposito` | equipe | O que está no depósito, com contadores, dias e alertas |
| `GET /api/deposito/conferencia?codigo=` | equipe | Acha a carga pelo código de rastreio ou pela etiqueta de um volume; devolve os volumes esperados |
| `GET /api/deposito/coletas/[id]` | equipe | A carga com os volumes (é o que a etiqueta imprime) |
| `POST /api/deposito/coletas/[id]/volumes` | equipe | Leitura (`codigo` ou `sequence`) ou correção (`status`, `weight`, `damageNote`) de um volume |
| `POST /api/deposito/coletas/[id]/posicao` | equipe | Põe volumes numa posição (`locationCode`, `sequences`); em branco tira |
| `POST /api/deposito/coletas/[id]/concluir` | equipe | Conclui a conferência e dá a carga como coletada |
| `GET` e `POST /api/deposito/posicoes` | equipe | Lista (com quantos volumes há em cada uma) e cadastra posição |
| `PATCH /api/deposito/posicoes/[id]` | equipe | Altera `code`, `description` e `active` |

As tabelas são criadas por [prisma/sql/016-deposito.sql](prisma/sql/016-deposito.sql).

Ainda não existe: leitura pela câmera do celular (só leitor que digita, ou digitação), impressão direta em impressora térmica (ZPL), inventário cíclico, mais de uma unidade (um depósito por empresa), foto da avaria, vínculo do volume com a NF-e, conferência de embarque no manifesto, e histórico de movimentação entre posições (fica só a posição atual). Carga com mais de 999 volumes não é conferida nem etiquetada volume a volume. O volume continua com a posição gravada depois que a carga sai para entrega; ela só deixa de contar na ocupação da posição.

## Documentos fiscais (NF-e por XML)

Importação do XML da NF-e para guardar a nota e criar a carga com os dados dela. No menu em Operação, "Notas fiscais" (`/dashboard/fiscal`), para `ADMIN` e `OPERATION`. As regras ficam em [src/lib/nfe.ts](src/lib/nfe.ts).

- **Leitor de XML** (`lerNfe`): função pura, sem biblioteca. Aceita a nota com o protocolo (`nfeProc`) ou sozinha (`NFe`), com ou sem prefixo de namespace, e tira a chave de acesso (do `Id` de `infNFe` ou de `protNFe/chNFe`), número e série, emissão, emitente e destinatário (CNPJ/CPF, razão social, município, UF, endereço), valor total (`vNF`), volumes e peso bruto (somando os blocos `transp/vol`), natureza da operação e modalidade do frete. O **dígito verificador** da chave (módulo 11) é conferido, e a chave precisa ser a daquele emitente, série e número.
- **Recusas**, cada uma com a sua frase: arquivo que não é XML ou está malformado, XML que não é de NF-e (CT-e, NFC-e modelo 65, qualquer outro), chave inválida, nota sem número, emitente ou valor, e arquivo acima de **1 MB** (resposta 413). O XML é tratado só como texto: nada é executado, só as cinco entidades do XML e as referências numéricas são expandidas, e arquivo com `DOCTYPE` é recusado.
- **Nota guardada** (`FiscalDocument`): os dados lidos, o XML original como chegou, quem importou e a carga (opcional). A chave é **única por empresa**: reimportar responde 409 com a nota que já existe e a carga a que ela está ligada.
- **Importar** (`/dashboard/fiscal`, "Importar XML", um ou vários arquivos): cada arquivo vira uma linha com o que foi lido ou o motivo da recusa. A nota abre com a **carga sugerida**: cliente pagador = o cadastro ativo cujo CNPJ é o do emitente ou o do destinatário (se os dois são clientes, decide a modalidade do frete da nota: 0 emitente, 1 destinatário; sem cliente ou sem modalidade, o operador escolhe), remetente e destinatário, origem e destino como "Cidade - UF", volumes, peso, valor e chave da NF. O que a nota não traz vem como aviso para o operador preencher.
- **Criar a carga:** confirmar cria a coleta pelo **mesmo caminho do painel de minutas** (`criarColetaConfirmada`, em [src/lib/coletas-db.ts](src/lib/coletas-db.ts): frete pela tabela do cliente, já confirmada, com código de rastreio e a primeira linha do histórico) e liga a nota a ela na mesma transação. A chave e o valor da NF da carga são os da nota, não os do formulário. Se já existe carga com a chave da nota, não cria outra: manda ligar.
- **Ligar a uma carga que já existe:** pela tela da nota, com o código de rastreio. Se a carga já tem chave de NF-e, ela precisa ser a da nota. Se não tem e ainda pode ser editada (a regra do painel, `isEditable`), a chave da nota é gravada nela; carga que já embarcou recebe só o anexo.
- **Consultar:** lista das notas (número, emitente, destinatário, valor, carga ligada, data), busca por chave, número, CNPJ/CPF ou razão social, e download do XML original.
- **Portal do cliente:** em `/portal/coletas/[id]` o cliente baixa o XML das notas ligadas às cargas dele.

| Rota | Quem | O que faz |
| --- | --- | --- |
| `GET /api/fiscal/notas?busca=` | equipe | Notas importadas, sem o XML |
| `POST /api/fiscal/notas` | equipe | Importa um XML (`{ xml }`); devolve a nota, a carga sugerida e a carga que já tem a chave |
| `GET /api/fiscal/notas/[id]` | equipe | A nota e, se ainda sem carga, a sugestão |
| `GET /api/fiscal/notas/[id]/xml` | equipe | O XML original, como anexo |
| `POST /api/fiscal/notas/[id]/carga` | equipe | Cria a carga sugerida e liga a nota a ela |
| `POST /api/fiscal/notas/[id]/ligar` | equipe | Liga a nota a uma carga pelo `trackingCode` |
| `GET /api/fiscal/cte` | equipe | Cargas em rota ou entregues, com os dados que um CT-e precisa |
| `POST /api/fiscal/cte` | equipe | Registra à mão `cteNumber` e `cteKey` de um CT-e emitido em outro sistema; os dois vazios desfazem |
| `GET /api/portal/coletas/[id]/notas/[notaId]` | cliente | O XML de uma nota de uma carga dele |

A tabela é criada por [prisma/sql/017-documentos-fiscais.sql](prisma/sql/017-documentos-fiscais.sql).

### CT-e: este sistema não emite

**Não há emissão de CT-e.** Emitir exige o certificado digital A1 da transportadora, credenciamento na SEFAZ e homologação, e nada disso existe aqui. A tela `/dashboard/fiscal/cte` diz isso no topo, lista as cargas em rota ou entregues com os dados que um CT-e precisa (todas como "não emitido", com o que falta: chave da NF-e, valor da mercadoria, frete) e deixa **registrar à mão** o número e a chave de um CT-e emitido em outro sistema, nos campos `cteNumber`, `cteKey` e `cteStatus` da carga. A chave é conferida (44 dígitos, dígito verificador, modelo 57 e o mesmo número informado), mas nada é enviado nem consultado na SEFAZ. As telas e as rotas anteriores, que simulavam a emissão com chave sorteada, foram retiradas.

Ainda não existe: emissão de CT-e e de MDF-e, consulta à SEFAZ (situação da nota, download pela chave), manifestação do destinatário, DANFE em PDF, leitura de XML de CT-e ou de NFC-e, importação por e-mail ou em arquivo compactado, mais de uma NF-e criando uma carga só, desfazer a ligação entre nota e carga e apagar nota importada. Anexar a nota a uma carga não muda o valor da NF nem o frete dela.

## Empresa

Em `/dashboard/empresa`, só para o administrador: o **nome** e o **símbolo** que aparecem no topo do painel, do portal do cliente e do app do motorista (`GET` e `PATCH /api/empresa`). O símbolo é uma imagem PNG, JPEG ou WebP, reduzida no navegador para 192 pixels antes de enviar e guardada no cadastro da empresa (`Tenant.logo`); sem símbolo, aparece o caminhão. As regras ficam em [src/lib/empresa.ts](src/lib/empresa.ts).

Na mesma tela, a seção **Cobrança** guarda a multa (% do valor) e os juros (% ao mês) que a baixa de um título vencido sugere (`GET` e `PATCH /api/empresa/cobranca`, só administrador; padrão de 2% e 1%, colunas `Tenant.lateFinePct` e `Tenant.lateInterestPct`).

A aplicação só lê a tabela de empresas; a gravação vai pelo dono do banco, presa ao id da empresa da sessão. O portal do cliente e o app do motorista mostram o mesmo nome e símbolo (a leitura é liberada a todo perfil da empresa).

## Integração (eventos para n8n e outros sistemas)

Em `/dashboard/empresa`, o administrador cadastra um **endereço** (um Webhook do n8n, por exemplo). A partir daí, cada troca de status de carga (inclusive a criação), cada fatura emitida, paga, reaberta ou cancelada, cada título que vence e cada chamado aberto ou com status trocado é avisado nesse endereço por `POST`, em até 15 segundos. Empresa sem endereço não gera evento.

```json
{
  "id": "…",
  "tipo": "coleta.status",
  "criadoEm": "2026-10-09T18:00:00.000Z",
  "empresa": { "id": "…", "slug": "mello", "nome": "Mello Transportes" },
  "dados": {
    "de": "ROUTE",
    "para": "DELIVERED",
    "coleta": {
      "id": "…", "status": "DELIVERED", "remetente": "…", "destinatario": "…", "origem": "…", "destino": "…",
      "volumes": 3, "peso": 63.5, "frete": 180,
      "rastreio": { "codigo": "1234567890", "link": "https://tms.avilaops.com/rastreio?cnpj=…&codigo=…" },
      "cliente": { "id": "…", "nome": "…", "cnpj": "…", "contato": "…", "email": "…", "telefone": "…" },
      "motorista": { "id": "…", "nome": "…", "telefone": "…" }
    }
  }
}
```

- **Cabeçalhos:** `X-TMS-Evento` (o tipo), `X-TMS-Entrega` (o id, para o destino descartar repetição) e `X-TMS-Assinatura` (`sha256=` + HMAC-SHA256 do corpo com o segredo). O segredo aparece uma vez, ao cadastrar ou trocar.
- **Garantia de entrega:** o evento é gravado na mesma transação da mudança (tabela `OutboxEvent`): os de carga e de fatura por gatilho do banco ([prisma/sql/010-rls.sql](prisma/sql/010-rls.sql)), os de chamado pela própria rota ([src/lib/ocorrencias-db.ts](src/lib/ocorrencias-db.ts)). Resposta fora de 2xx ou sem resposta em 8 segundos é tentada de novo em 1, 2, 4… minutos, até 8 vezes. O mesmo evento pode chegar mais de uma vez; use o id.
- **Endereço:** só `https` e só endereço público. O servidor recusa IP interno ao salvar e de novo a cada entrega ([src/lib/url-publica.ts](src/lib/url-publica.ts)).
- **Quem entrega:** o próprio servidor, a cada 15 segundos ([src/instrumentation.ts](src/instrumentation.ts), [src/lib/eventos.ts](src/lib/eventos.ts)). `TMS_EVENTOS=off` desliga.
- **Rotas:** `GET`/`PUT /api/empresa/webhook` e `POST /api/empresa/webhook/teste`, só para o administrador.

**Tipos de aviso** (o `tipo` do corpo e o cabeçalho `X-TMS-Evento`):

| Tipo | Quando | `dados` |
| --- | --- | --- |
| `coleta.status` | Carga criada ou com status trocado | `de`, `para`, `coleta` |
| `fatura.emitida`, `fatura.paga`, `fatura.reaberta`, `fatura.cancelada` | Fatura criada ou com status trocado | `fatura` (número, total, vencimento, cliente, link do portal) |
| `cobranca.vencida` | Título a receber venceu e segue em aberto | `titulo` (valor, vencimento, dias de atraso, cliente ou pagador, fatura) |
| `ocorrencia.aberta`, `ocorrencia.status` | Chamado aberto (painel, portal ou motorista) ou com status trocado | `ocorrencia` (número, tipo, título, status, prioridade, quem abriu, cliente, carga com código e link de rastreio, link do painel) |
| `teste` | Botão "Enviar teste" | mensagem fixa |

Nos avisos de chamado, `status` é o de agora (lido na entrega, como nos de fatura), `tipo` é `DELAY`, `DAMAGE`, `LOSS`, `BILLING`, `REDELIVERY` ou `OTHER`, e `abertaPor` é `CLIENT` (portal) ou `STAFF` (equipe ou motorista). No chamado do motorista, `cliente` é o dono da carga. A descrição e a conversa não saem no aviso. Trocar prioridade ou responsável e escrever mensagem não avisam.

O aviso de título vencido sai uma vez por título e por vencimento; a procura roda a cada 10 minutos. Ao cadastrar o endereço, os títulos que já estavam vencidos são avisados nessa primeira procura.

**Exemplo de destino:** [n8n/avisos-por-whatsapp.js](n8n/avisos-por-whatsapp.js) é o fluxo do n8n em uso na Mello, que transforma cada aviso num resumo de WhatsApp para o responsável.

Ainda não há escolha de quais tipos receber, nem repetição do aviso de título vencido (o lembrete periódico fica por conta do fluxo no destino).

## Mensageria

Em `/dashboard/mensagens` (menu Sistema, só `ADMIN`) fica o histórico dos avisos acima: o que o TMS gerou para o endereço da Integração, do mais novo para o mais antigo. Cada linha traz o tipo com rótulo em português, quando foi gerado e a situação: **entregue**, **na fila**, **falhou** (com o motivo e a próxima tentativa) ou **desistiu** (gastou as 8 tentativas). Filtros por tipo e por situação, e uma página de 30 por vez. As regras ficam em [src/lib/mensageria.ts](src/lib/mensageria.ts).

- **Tentar de novo:** no aviso que falhou ou de que o despachante desistiu, o botão zera as tentativas e marca a próxima para agora; ele sai na volta seguinte do despachante (até 15 segundos). Aviso entregue ou ainda na fila não é reenviado.
- **Sem endereço cadastrado** a tela diz isso e aponta para Empresa → Integração: sem endereço o TMS não gera aviso nenhum.
- A tela mostra se o aviso **chegou ao endereço**, não se alguém leu uma mensagem. O TMS não manda WhatsApp, SMS nem e-mail por conta própria: quem escreve para a pessoa é o sistema que recebe o aviso (o fluxo do n8n, por exemplo).

| Rota | Quem | O que faz |
| --- | --- | --- |
| `GET /api/eventos?tipo=&situacao=&cursor=` | administrador | Avisos da empresa e o endereço da integração; `proximo` é o cursor da página seguinte |
| `POST /api/eventos/[id]/reenviar` | administrador | Devolve à fila um aviso que falhou; 409 se entregue, na fila ou sem endereço cadastrado |

Ainda não existe: ver o conteúdo que foi enviado em cada aviso, reenviar vários de uma vez, apagar aviso antigo, notificação push e mensagem direta do TMS para cliente ou motorista.

## Auditoria

Toda ação importante grava uma linha em `AuditLog`: quem fez (o id e, guardados na hora, o nome e o perfil, porque o usuário pode ser apagado depois), quando, de onde (IP e um resumo do aparelho, como "Safari no iPhone"), a ação (`cliente.criar`, `fatura.pagar`, `usuario.perfil`…), o registro alterado e, quando há, o **antes** e o **depois** só dos campos que mudaram. O helper e as regras ficam em [src/lib/auditoria.ts](src/lib/auditoria.ts).

- **Só inserção.** O papel da aplicação não tem `UPDATE` nem `DELETE` na tabela ([prisma/sql/010-rls.sql](prisma/sql/010-rls.sql)): nem uma rota com defeito consegue alterar ou apagar a trilha. Não há rota de alteração.
- **Na mesma transação da mudança** quando a rota tem uma (`registrarAuditoria`): ação recusada pela regra não deixa linha, e linha que não pôde ser gravada desfaz a mudança. Rota que grava sem transação registra logo depois (`registrarAuditoriaDepois`); ali, se a linha falhar, o erro vai para o log do servidor e a resposta segue a mesma.
- **O que nunca entra** no antes e depois: senha, hash, segredo da integração, token, o símbolo da empresa, foto e assinatura de comprovante e XML de nota (lista `CAMPOS_PROIBIDOS`, que vale em qualquer profundidade). Imagem embutida é omitida mesmo num campo de outro nome, e texto longo é cortado em 500 caracteres.
- **IP:** o primeiro valor de `x-forwarded-for` (o proxy na frente do sistema precisa preenchê-lo); sem cabeçalho, fica vazio.
- **Tela** `/dashboard/auditoria` (menu Sistema, só `ADMIN`): da mais recente para a mais antiga, 30 por vez ("Carregar mais"), com filtro por período, usuário, tipo de registro, ação e id do registro. Abrir uma linha mostra antes e depois lado a lado.

O que é registrado: criar, alterar, desativar e reativar **cliente**, **motorista** e **ajudante**, e trocar o percentual de comissão do motorista; registrar, alterar e excluir **ausência**; registrar, acertar e reabrir **adiantamento**; os parâmetros de cobrança da empresa; criar e alterar **veículo**, e registrar abastecimento e documento dele; criar e alterar **usuário**, trocar perfil, pedir a liberação de acesso e revogar o do e-mail antigo de um motorista; criar, alterar e mudar status de **carga**, e informar frete à mão; criar, alterar, liberar, cancelar e finalizar **manifesto**, e retirar carga dele; emitir, pagar, reabrir e cancelar **fatura**; criar, alterar, pagar, reabrir e excluir **lançamento**; aprovar e recusar **comprovante**; nome e símbolo da **empresa** e o endereço da **integração**; criar e alterar **tabela de frete** e trocar as cidades dela (quantas havia e quantas ficaram, não cada preço); abrir **chamado** e mudar status, prioridade ou responsável; concluir **conferência** no depósito; importar **nota fiscal** e criar carga a partir dela; e reenviar aviso.

| Rota | Quem | O que faz |
| --- | --- | --- |
| `GET /api/auditoria?de=&ate=&usuario=&entidade=&acao=&id=&cursor=` | administrador | A trilha da empresa; `de`/`ate` em `AAAA-MM-DD` (dias do Brasil), `id` aceita só o começo, `proximo` é o cursor da página seguinte |

A tabela é criada por [prisma/sql/018-auditoria.sql](prisma/sql/018-auditoria.sql); rode `npm run db:rls` depois dela.

Ainda não é registrado: o que o **motorista** faz no aplicativo (baixa de entrega, ocorrência, checklist) e o que o **cliente** faz no portal (pedir coleta, abrir e responder atendimento); cotação e CRM (inclusive converter cotação em carga); mensagem em chamado; leitura de volume, posição e cadastro de posições do depósito; registrar CT-e e ligar nota a carga que já existe; manutenção, pneu e checklist de veículo, e alterar ou apagar abastecimento e documento; o teste da integração; e o cadastro de empresas da plataforma. A troca de status de carga feita por esses caminhos continua no histórico de status da carga (`CollectionStatusHistory`), com o usuário. Também não existe: entrada e saída do sistema (login), exportar a trilha, prazo de guarda com descarte e os perfis extras do item 1.19 do roteiro (Diretoria, Expedição, Conferência, Comercial, Financeiro).

## Portal do cliente

Quem tem perfil `CLIENT` entra em `/portal` e vê só os dados da empresa a que o cadastro dele está vinculado: pede coleta, acompanha as que pediu, consulta faturas e abre atendimento (`/portal/atendimento`, na seção Atendimento e ocorrências). Em `/portal/coletas/[id]` ficam o andamento com a hora de cada etapa, o link público de rastreio pronto para mandar a quem vai receber, o XML das notas fiscais ligadas à carga, para baixar, e o comprovante de entrega (recebedor, foto e assinatura), que dá para imprimir ou salvar em PDF. O comprovante só aparece depois de **aprovado** na conferência da transportadora; em conferência ou recusado, o cliente só vê que ainda não há comprovante liberado.

## Estrutura

```text
src/
  app/            rotas (dashboard, driver, portal, login, api)
  components/     UI, motorista, provedores
  data/           cidades atendidas (mapa do motorista)
  lib/            auth, prisma, permissões, cadastros, coletas, rastreio, fila offline
prisma/           schema, seed e migrações pontuais
tests/            suíte Vitest contra Postgres
public/           ícones, manifesto do PWA do motorista, service worker
```

## O que ainda é da Mello aqui dentro

A separação tirou o site, não a marca. Para virar produto de mercado ainda falta decidir:

- **Nomes e ícones:** telas, manifesto do PWA e mensagens dizem "Mello".
- **Cidades atendidas:** [src/data/serviceAreas.csv](src/data/serviceAreas.csv) é a malha da Mello, usada no mapa do motorista. Existe uma cópia no repositório do site.
- **Tabelas `Article`, `SocialPost` e `ContentMetric`:** guardam a distribuição do blog da Mello. Continuam no schema para não mexer em dado; o script que as alimentava (`prisma/sincronizar-artigos.ts`) saiu junto com as matérias.
- **Material comercial:** `TABELA FRETES 2026 A ABRIL 2027.xlsx`, `tabela_frete_serilon*.csv`, `regras_frete_serilon.txt`, `Cidades.pdf` e [pdf-generator/](pdf-generator/README.md) são da operação da Mello e ficaram aqui porque o repositório do site é público.
- **Um banco, um transportador:** não há separação por empresa (multi-tenant).

## Deploy

O sistema roda no servidor `applications`, em `/opt/tms-avilaops-com`, atrás do Caddy, e segue a Norma de Plataforma da Ávila Ops (`avilaops/infra`, `NORMA-PLATAFORMA.md`): todo nome sai do domínio e nenhuma porta é publicada no host.

| Recurso | Nome |
| --- | --- |
| Diretório | `/opt/tms-avilaops-com` |
| Projeto compose | `tms-avilaops-com` |
| Container | `tms-avilaops-com-web` (rede `edge`, `172.31.0.11:3000`) |
| Banco e role | `tms_avilaops_com`, no PostgreSQL compartilhado do servidor |
| Imagem | `ghcr.io/avilaops/tms`, por digest |
| Saúde | `GET /api/health` (consulta o banco e devolve o commit em execução) |

O banco não é um container deste projeto: é o PostgreSQL do próprio servidor, o mesmo dos outros sistemas, coberto pelo backup diário de lá. O container o alcança por `host.docker.internal`.

### Automático (GitHub Actions)

[.github/workflows/deploy-production.yml](.github/workflows/deploy-production.yml):

- Todo push e PR em `main` roda typecheck e testes contra um Postgres real; se passarem, a imagem Docker é construída. Fora de PR, ela é publicada no GHCR.
- O deploy por SSH só roda na `main`, com a variável `DEPLOY_ENABLED` do repositório em `true` e os segredos `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` e `DEPLOY_KNOWN_HOSTS`. A chave só tem permissão para publicar a aplicação `tms.avilaops.com`.
- No servidor, o deploy baixa a imagem pelo digest, troca o container e confere `/api/health`; se a versão nova não responder, volta para a anterior.

Os jobs de imagem e deploy são cópia dos de `avilaops/infra` porque este repositório é público e aquele é privado: o GitHub não deixa repositório público chamar workflow reutilizável de repositório privado.

### Banco em produção

Não há migrações versionadas: o schema é aplicado com `npm run db:push` (o `prisma db push` seguido do isolamento por empresa), da sua máquina, por túnel SSH. O deploy **não** faz isso sozinho, então mudança de schema precisa ser aplicada antes de o código que depende dela chegar à `main`.

```bash
ssh -N -L 5433:127.0.0.1:5432 applications &
DATABASE_URL="postgresql://tms_avilaops_com:<senha>@127.0.0.1:5433/tms_avilaops_com?schema=public" npm run db:push
```

O papel `tms_app` precisa existir no servidor, com o dono do banco como membro. O dono não pode criar papel, então um superusuário faz isso uma única vez: `CREATE ROLE tms_app NOLOGIN; GRANT tms_app TO tms_avilaops_com;`.

Empresa nova entra pelo seed, com a `DATABASE_URL` de produção no ambiente (`TENANT_SLUG`, `TENANT_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`).

**Coluna `tenantId` em tabela que já existe.** O Postgres calcula o valor padrão ao criar a coluna, mesmo com a tabela vazia, e sem `app.tenant_id` o `db push` para com `unrecognized configuration parameter "app.tenant_id"`. Informe a variável na própria conexão, com o id da empresa que deve ficar com as linhas existentes:

```bash
DATABASE_URL="postgresql://…/tms_avilaops_com?schema=public&options=-c%20app.tenant_id%3D<id-da-empresa>" npx prisma db push
```

Foi assim que o banco de produção, criado antes de haver empresas, recebeu o schema em 08/10/2026 (estava vazio).

- **Variáveis:** `/opt/tms-avilaops-com/.env` (modo 600), a partir de [.env.example](.env.example).
- **Voltar versão:** republicar o commit anterior pela `main`. Não há cópia de código nem de build guardada no servidor.

---

Desenvolvido e mantido por [Ávila Ops](https://avilaops.com).
