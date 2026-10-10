# TMS

Sistema de gestão de transportes para operação terrestre, de carga fracionada e dedicada: coletas, manifestos, motoristas, veículos, financeiro, notas fiscais (leitura de XML de NF-e), app do motorista e portal do cliente.

Nasceu como o sistema da Mello Transportes Rio Preto (este repositório se chamava `Mello`) e ainda roda a operação dela. Em 06/10/2026 o site institucional saiu daqui para [avilaops/mellotransportesriopreto.com.br](https://github.com/avilaops/mellotransportesriopreto.com.br); o que ficou é só o sistema.

- Endereço: https://tms.avilaops.com
- Site da Mello (consome a API pública): https://mellotransportesriopreto.com.br
- Roadmap: [ROADMAP.md](ROADMAP.md)

## O que tem aqui

| Área | Rota | Quem acessa | O que faz |
| --- | --- | --- | --- |
| Gestão | `/dashboard` | Equipe interna: `ADMIN`, `DIRECTOR`, `OPERATION`, `FINANCE`, `COMMERCIAL`, `EXPEDITION`, `WAREHOUSE` (cada um vê a sua parte: [Perfis de acesso](#perfis-de-acesso)) | Clientes, CRM, coletas, manifestos, motoristas, veículos e frota (manutenção, abastecimento, documentos, pneus, checklist, custos), equipe (ajudantes, ausências, adiantamentos e produtividade), ocorrências (chamados de clientes e da equipe), financeiro, notas fiscais (importação de XML de NF-e) e CT-e (emissão pela SEFAZ, pronta para homologação, e registro manual), mensageria (histórico dos avisos para sistemas de fora), auditoria, usuários |
| Motorista | `/driver` | `DRIVER` | PWA com viagens, mapa, baixa de entrega com comprovante (fotos por tipo, ressalva) e fila offline, comprovantes devolvidos para refazer, tentativa de entrega sem sucesso, checklist do veículo da viagem e registro de ocorrência na entrega |
| Cliente | `/portal` | `CLIENT` | Coletas (pedido, acompanhamento com rastreio e comprovante de entrega), faturas, minutas e atendimento (chamados) da própria empresa |
| API pública | `/api/cotacoes`, `/api/leads`, `/api/rastreio` | Site do transportador | Recebe cotação e lead, responde o rastreio por CNPJ/CPF + código |

Não há página pública: a raiz `/` leva quem já entrou para a própria área e todo o resto para `/login`.

O controle de acesso por perfil fica em [src/proxy.ts](src/proxy.ts) e é conferido de novo no servidor em cada rota interna. Perfis são estritos: um `ADMIN` não entra em `/driver` nem em `/portal`, porque não tem motorista nem empresa vinculados.

### Perfis de acesso

São nove perfis (enum `Role`): os sete da equipe interna, que entram em `/dashboard`, mais `DRIVER` (motorista, `/driver`) e `CLIENT` (cliente, `/portal`). O que cada perfil interno pode fazer está num arquivo só, [src/lib/permissoes.ts](src/lib/permissoes.ts): uma lista de **capacidades** (`financeiro`, `clientesVer`, `deposito`…) e os perfis que têm cada uma. Cada rota interna pede uma capacidade (`requireStaff({ pode: "financeiro" })`), o menu mostra só as telas que o perfil pode abrir ([src/app/dashboard/menu.ts](src/app/dashboard/menu.ts)) e as respostas que escondem dinheiro decidem pela mesma lista. O perfil é lido do banco a cada chamada, não do token: troca de perfil vale na hora.

| Área | Administrador `ADMIN` | Diretoria `DIRECTOR` | Operação `OPERATION` | Financeiro `FINANCE` | Comercial `COMMERCIAL` | Expedição `EXPEDITION` | Conferência `WAREHOUSE` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Visão geral (contadores) | sim, com receita | sim, com receita | sim | sim, com receita | sim | sim | sim |
| Clientes | tudo | tudo | tudo | lê; altera só condição de pagamento e limite de crédito | tudo | não | não |
| CRM e cotações | tudo | tudo | tudo | não | tudo | não | não |
| Tabelas de frete | tudo | lê e calcula | lê e calcula | lê e calcula | tudo | não | não |
| Minutas (cargas) | tudo | tudo | tudo | lê; informa frete à mão | lê | lê; muda status | lê |
| Depósito, conferência e etiquetas | tudo | tudo | tudo | não | não | não | tudo |
| Manifestos e viagens | tudo | tudo | tudo | lê | não | tudo | não |
| Despesas de viagem | lança e aprova | lança | lança | lê e aprova | não | lança | não |
| Acerto e resultado da viagem | lê | lê | não | lê | não | não | não |
| Comprovantes de entrega | tudo | tudo | tudo | não | não | tudo | não |
| Ocorrências (chamados) | tudo | tudo | tudo | não | tudo | tudo | tudo |
| Notas fiscais e CT-e | tudo | tudo | tudo | lê | não | lê | não |
| Faturamento | tudo | lê | não | tudo | não | não | não |
| Cobrança (painel) | lê | lê | não | lê | não | não | não |
| Financeiro (lançamentos, fluxo, recibo) | tudo | lê | não | tudo | não | não | não |
| Conciliação bancária (extrato OFX) | tudo | não | não | tudo | não | não | não |
| Motoristas | tudo | tudo, sem alterar comissão | tudo, sem ver comissão | lê, com comissão | não | lê, sem comissão | não |
| Veículos e frota | tudo | tudo | tudo | lê | não | lê; registra checklist | não |
| Custos da frota | lê | lê | não | lê | não | não | não |
| Equipe (ajudantes, ausências, produtividade) | tudo | tudo, com valores | tudo, sem valores | lê, com valores | não | lê, sem valores | não |
| Adiantamentos da equipe | tudo | lê | não | tudo | não | não | não |
| Relatórios | lê | lê | não | lê | não | não | não |
| Mensageria | lê e reenvia | lê | não | não | não | não | não |
| Auditoria | lê | lê | não | não | não | não | não |
| Usuários | tudo | não | não | não | não | não | não |
| Empresa, integração e parâmetros de cobrança | tudo | não | não | não | não | não | não |

- **Administrador e Operação não mudaram** com a chegada dos outros cinco: toda rota que era "equipe interna" continua com os dois, e toda rota que era "só administrador" continua sem a Operação. Nas seções abaixo, "equipe interna" e "administrador" descrevem esses dois; os demais seguem a tabela.
- **Diretoria** faz tudo o que a Operação faz e **lê** o que é dinheiro; não lança, não baixa, não fatura, não mexe em preço, usuário, empresa nem integração.
- **Financeiro** não opera carga: não cria nem altera minuta, manifesto, veículo ou motorista. O percentual de comissão do motorista ele lê, mas só o administrador altera (mudar exige também o cadastro de motoristas).
- **Atribuir perfil** é do administrador, em `/dashboard/usuarios`. No celular o cadastro de usuário novo fica recolhido atrás do botão "Novo usuário", para a lista caber na primeira tela. Tela aberta por quem não tem a capacidade mostra "Seu perfil não tem acesso a esta área.", sem citar perfil. Motorista continua nascendo pelo cadastro de motoristas, e cliente continua exigindo a empresa vinculada. A trava do último administrador vale para qualquer destino, e toda troca fica na auditoria (`usuario.perfil`, com o perfil de antes e o de depois).
- **Responsável por chamado** pode ser qualquer usuário de um perfil que atende chamados (todos os internos menos o Financeiro).
- **Rota nova** precisa de uma capacidade: [tests/perfis.test.ts](tests/perfis.test.ts) lê todas as rotas de `src/app/api`, recusa `requireStaff` sem capacidade e confere, perfil por perfil, o 403 e a passagem em cada uma.

Os valores novos do enum entram por [prisma/sql/022-perfis.sql](prisma/sql/022-perfis.sql) (só `ALTER TYPE ... ADD VALUE IF NOT EXISTS`; roda em transação única, `psql -1 -f`, e pode rodar de novo). Nenhum usuário troca de perfil sozinho.

Ainda não existe: perfil sob medida por empresa (a matriz é do código, igual para todas), mais de um perfil por usuário, restrição por filial ou por cliente dentro de um perfil, e tela própria de leitura para quem só lê (a Diretoria no Financeiro e o Financeiro em Clientes veem os mesmos botões; quem recusa a gravação é a API, com 403).

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
| `FISCAL_MCP_URL` | Endereço do serviço fiscal que gera o DANFE em PDF (`https://fiscal.avilaops.com/mcp`). Opcional: sem ela o recurso fica desligado e o botão não aparece |
| `FISCAL_MCP_TOKEN` | Opcional: enviado como `Authorization: Bearer` ao serviço fiscal, para quando ele exigir autenticação |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Opcionais: chaves do push no navegador (`npx web-push generate-vapid-keys`) e o contato de quem opera (`mailto:`). Sem as três o push fica desligado e só o sininho funciona: [Notificações](#notificações-sininho-e-push) |
| `TMS_CHAVE_DE_DADOS` | Opcional: chave (32 caracteres ou mais, `openssl rand -base64 48`) que cifra as credenciais do Mercado Pago e o certificado A1 de cada empresa. Sem ela a cobrança pelo Mercado Pago e o envio do certificado (emissão de CT-e) ficam desligados: [Cobrança pelo Mercado Pago](#cobrança-pelo-mercado-pago) |
| `MERCADO_PAGO_API` | Opcional: endereço da API do Mercado Pago (padrão `https://api.mercadopago.com`). Só os testes mudam |
| `GEO_CONTATO` | Opcional: e-mail ou site de quem responde pelo uso do Nominatim (vai no `User-Agent`). **Sem ela os endereços de entrega não são localizados** e a rota segue pela cidade: [Mapa, endereço e GPS](#mapa-endereço-e-gps) |
| `GEO_URL` | Opcional: servidor do Nominatim (padrão `https://nominatim.openstreetmap.org`). Troque por uma instância própria quando o volume crescer |
| `ROTA_URL` | Opcional: servidor OSRM **próprio** para a distância por estrada na ordem sugerida. Sem ela a distância é em linha reta. O servidor de demonstração público do OSRM é recusado |
| `NEXT_PUBLIC_MAPA_TILES` | Opcional: endereço `https` dos blocos de imagem do mapa, com `{z}`, `{x}` e `{y}` (padrão `https://tile.openstreetmap.org/{z}/{x}/{y}.png`). Lida na hora do build |
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

Ainda não há boleto nem envio automático do aviso de cobrança, e o Pix é estático: a baixa é manual, ou pela [conciliação do extrato bancário](#conciliação-bancária-por-extrato-ofx). A posição do que está em aberto, o aviso para copiar e o recibo ficam em [Cobrança](#cobrança).

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

### Conciliação bancária por extrato (OFX)

Em `/dashboard/financeiro/conciliacao` (botão **Conciliação** no Financeiro), para quem lança no financeiro (`ADMIN` e `FINANCE`). **Não há ligação com banco:** o administrador exporta o extrato no site do banco, em **OFX** (o formato "Money", que todo banco brasileiro oferece), e envia o arquivo. As regras ficam em [src/lib/conciliacao.ts](src/lib/conciliacao.ts) e o leitor em [src/lib/ofx.ts](src/lib/ofx.ts), os dois em funções puras e sem dependência nova.

- **Leitor de OFX:** lê OFX 1.x (SGML, campos sem fechamento) e 2.x (XML), em UTF-8 ou Windows-1252; tira a conta (banco, agência e o número **mascarado**: só o fim, `••••1234`), o período e cada movimentação (identificador `FITID`, data, valor com sinal, tipo e descrição). Data no formato `AAAAMMDD[HHMMSS][.XXX][fuso]`, valendo o dia escrito; valor com ponto ou vírgula. Recusa, com mensagem clara, arquivo vazio, que não é OFX, sem movimentação, acima de 2 MB, ou com movimentação sem data ou valor legível. Movimentação de valor zero ("saldo anterior") é descartada.
- **O que fica guardado** (`BankStatementLine`): uma linha por movimentação, única por empresa + conta + `FITID`. **Reenviar o mesmo extrato, ou um período que se sobrepõe, não duplica:** a resposta diz quantas eram novas e quantas já estavam. O número inteiro da conta não é gravado (fica o fim e um resumo criptográfico, que é o que separa uma conta da outra). `FITID` repetido no mesmo arquivo ganha `#2`, `#3`; movimentação sem `FITID` recebe um identificador montado com dia, valor e descrição.
- **Sugestão:** cada linha pendente vem com os lançamentos candidatos e o motivo. Mesmo sinal (crédito com a receber, débito com a pagar); valor igual ao do título em aberto, ou ao valor recebido de fato no título já pago; vencimento (título em aberto) ou pagamento (título pago) a até **5 dias** da data do extrato; e identificação na descrição: o **txid do Pix** (`FAT000123`), o número da fatura ("fatura 123") ou parte do nome do cliente ou fornecedor. Candidato **forte** tem valor igual e data na janela ou identificação por txid ou fatura. A linha é **certeira** quando tem exatamente um candidato forte (o identificado passa na frente do que só casa pela data) e esse lançamento não é o certeiro de outra linha. Título em aberto de valor igual e vencimento fora da janela (cliente que pagou atrasado) e título com o txid na descrição mas valor diferente aparecem como sugestão fraca, nunca certeira.
- **Por linha** (`PATCH /api/financeiro/conciliacao/[id]`): **Conciliar** com o candidato; **Outro** (escolher outro lançamento do mesmo lado, com busca); **Criar** um lançamento já pago a partir da linha, com categoria (tarifa bancária, por exemplo); ou **Ignorar**. **Certeiros (n)** concilia em lote as linhas certeiras (`POST /api/financeiro/conciliacao/certeiros`), cada uma na sua transação. **Desfazer** devolve a linha a pendente.
- **Conciliar dá a baixa pela regra de sempre.** Lançamento em aberto recebe a baixa do Financeiro (`situacaoDaBaixa`, em [src/lib/financeiro-db.ts](src/lib/financeiro-db.ts), a mesma da tela), com a **data do extrato** e a forma de pagamento inferida da descrição (Pix, boleto, transferência, cartão, dinheiro; em branco quando o extrato não diz). Em título **a receber** de valor diferente, a diferença a mais entra como **juros** e a diferença a menos como **desconto** (o extrato não separa multa de juros; quem chama a rota pode mandar `juros`, `multa` e `desconto`, que têm de fechar com o valor do extrato). Em título **a pagar**, valor diferente é recusado: corrige-se o lançamento antes. Lançamento **já pago** só é ligado à linha, sem mexer nele.
- **Lançamento de fatura:** conciliar paga a **fatura**, pelo mesmo caminho do Faturamento (`alterarFatura`, em [src/lib/faturas-db.ts](src/lib/faturas-db.ts)), e o lançamento a acompanha; juros e desconto vão para o lançamento e o total da fatura não muda. Desfazer reabre a fatura.
- **Desfazer:** se a baixa veio da conciliação, o título (ou a fatura) é reaberto; se o lançamento já estava pago, ou nasceu da linha, ele continua pago e só perde a ligação (volta a aparecer como candidato da mesma linha). Enquanto está conciliado, o lançamento **não é reaberto nem excluído** pelo Financeiro nem pelo Faturamento (409): o caminho é desfazer a conciliação.
- **Rotas:** `GET /api/financeiro/conciliacao?situacao=pendentes|conciliadas|ignoradas` (até 300 linhas por vez, com a contagem de cada situação), `POST /api/financeiro/conciliacao` (o corpo é o arquivo, como o banco exportou), e as duas acima. Tudo fica na Auditoria (`conciliacao.importar`, `.conciliar`, `.criar`, `.ignorar`, `.desfazer`, além da baixa e da reabertura do lançamento ou da fatura). Linha e lançamento de outra empresa respondem 404, e o banco recusa ligar uma linha a lançamento de outra empresa.

A tabela é criada por [prisma/sql/024-conciliacao.sql](prisma/sql/024-conciliacao.sql); rode `npm run db:rls` depois dela.

Ainda não existe na conciliação: **ligação direta com o banco** (Open Finance, API ou arquivo de retorno CNAB: o extrato é sempre exportado e enviado à mão), extrato em CSV ou PDF, uma linha do extrato para vários lançamentos (cliente que paga três faturas num Pix só) ou vários créditos para um título (recebimento parcial), saldo da conta e conferência de saldo, cadastro de contas bancárias (a conta aparece só como veio no arquivo), regra automática por descrição ("toda TARIFA vira despesa de tarifa") e exclusão de linha importada (a que não interessa é ignorada). A janela de 5 dias é fixa no código (`JANELA_PADRAO`).

Ainda não existe: boleto, Pix dinâmico (com confirmação automática do pagamento), ligação direta com banco (a conciliação é por extrato enviado à mão), parcelamento, lançamento recorrente e acordo de dívida. A baixa é sempre do título inteiro (não há recebimento parcial), os encargos não entram no lançamento já criado como pago (só na baixa), e o centro de custo é um texto no lançamento, sem cadastro nem rateio.

## Cobrança

Em `/dashboard/cobranca`, só para o administrador. As contas ficam em [src/lib/cobranca.ts](src/lib/cobranca.ts) e não mudam o banco: a tela só lê.

- **Posição por cliente** (`GET /api/financeiro/cobranca`): os lançamentos a receber em aberto, agrupados por quem deve (o cliente; sem cliente, o pagador digitado; sem nenhum, "Sem cliente informado"), com total, vencido e o maior atraso em dias. Quem mais deve em atraso aparece primeiro.
- **Faixas de atraso:** a vencer, 1 a 30, 31 a 60, 61 a 90 e mais de 90 dias, contados do vencimento até hoje no relógio do Brasil. Título sem vencimento conta em "a vencer".
- **Aviso de cobrança:** o texto já redigido com os títulos do cliente (lembrete quando nada venceu, atraso quando algo venceu), para copiar e mandar pelo canal de costume. O sistema não envia nada. Com a chave Pix cadastrada (abaixo), o aviso leva o Pix Copia e Cola de cada título; sem chave, o texto não traz dado de pagamento.
- **Recibo** (`GET /api/financeiro/[id]/recibo`, tela `/dashboard/financeiro/recibo/[id]`): só de receita já recebida, para imprimir ou salvar em PDF. Chega-se a ele pelo link "Recibo" no Financeiro e na fatura paga.

A baixa continua no Faturamento e no Financeiro (com juros, multa e desconto); título pago sai da posição, e o recibo sai pelo valor recebido, com a composição quando houve encargo. A posição e o aviso mostram o valor original do título, sem juros nem multa. Parcelas e o registro de que o aviso foi mandado não existem.

### Cobrança por Pix (Copia e Cola estático)

O administrador cadastra em **Empresa > Cobrança** a chave Pix da transportadora (CPF, CNPJ, e-mail, telefone ou aleatória, conferida pelo formato e, em CPF e CNPJ, pelo dígito verificador), o nome do recebedor (até 25 letras) e a cidade (até 15), que são os limites do padrão. A partir daí o sistema monta o **Pix Copia e Cola** de cada título a receber em aberto, com o valor do título e um identificador (`FAT000123` para a fatura nº 123; `TIT` + o começo do id para lançamento sem fatura). O código é o BR Code do Banco Central (campos 00, 26, 52, 53, 54, 58, 59, 60, 62 e o CRC16 no 63), gerado por função pura em [src/lib/pix.ts](src/lib/pix.ts), sem banco e sem dependência; nome e cidade saem sem acento.

Onde aparece, com botão de copiar: na fatura do painel (`/dashboard/faturamento/[id]`, enquanto em aberto), nas faturas do portal do cliente ("Pagar com Pix" em cada título em aberto), no texto do aviso de cobrança, e nos avisos `fatura.emitida` e `cobranca.vencida` da integração (campo `pixCopiaECola`).

**É Pix estático: o pagamento NÃO dá baixa sozinho.** O sistema não fala com banco nenhum e não sabe se o cliente pagou; quem recebe confere o extrato (o identificador aparece nele) e dá a baixa à mão, ou envia o extrato em OFX para a [conciliação](#conciliação-bancária-por-extrato-ofx), que reconhece o identificador e sugere a fatura. As telas dizem isso ao lado do código. O valor é o original do título, sem juros nem multa.

Ainda não existe no Pix estático: **QR Code** (o projeto não tem gerador de QR e não se acrescentou dependência: sai só o código para copiar e colar) e mais de uma chave por empresa. QR Code, boleto e baixa automática existem pela cobrança do Mercado Pago, abaixo.

### Cobrança pelo Mercado Pago

Pix dinâmico (com QR Code) e boleto, com **baixa automática**: cada transportadora liga a **própria** conta do Mercado Pago, o TMS cria a cobrança lá e paga a fatura sozinho quando o Mercado Pago avisa. Regras em [src/lib/cobranca-gateway.ts](src/lib/cobranca-gateway.ts), gravação em [src/lib/cobranca-gateway-db.ts](src/lib/cobranca-gateway-db.ts), cliente HTTP (só `fetch`) em [src/lib/mercado-pago.ts](src/lib/mercado-pago.ts), cifra em [src/lib/cifra.ts](src/lib/cifra.ts).

**Passo a passo para a transportadora ligar a conta** (só o administrador):

1. No [painel de desenvolvedores do Mercado Pago](https://www.mercadopago.com.br/developers/panel/app), crie uma aplicação e copie o **Access Token de produção** (começa com `APP_USR-`).
2. No TMS, abra **Empresa > Cobrança > Mercado Pago** e copie o **endereço de webhook** mostrado ali (`<NEXTAUTH_URL>/api/pagamentos/mercado-pago/<slug da empresa>`).
3. Na aplicação do Mercado Pago, em **Webhooks**, cadastre esse endereço em modo produção, marque o evento **Pagamentos** e copie a **assinatura secreta** que o painel gera.
4. De volta ao TMS, cole o Access Token e a assinatura secreta e clique em **Ligar conta**. Depois, **Testar conexão**: a tela mostra o nome da conta.
5. Para o **boleto**, a conta precisa ter o meio de pagamento habilitado, e o cadastro do cliente precisa de e-mail, CNPJ ou CPF e o endereço escrito como `Rua, número - Bairro, Cidade - UF, CEP 00000-000` (é o formato que a busca por CNPJ preenche). O **Pix** pede só e-mail e CNPJ ou CPF. Dado que falta vira erro dizendo o que completar.

**Credenciais.** O Access Token e a assinatura secreta ficam **cifrados** no banco (AES-256-GCM, chave derivada de `TMS_CHAVE_DE_DADOS`, amarrada à empresa e ao campo) e **não voltam** para a tela, para log nem para a auditoria: a leitura devolve só "configurado" e os 4 últimos caracteres de cada um. Sem `TMS_CHAVE_DE_DADOS` o recurso fica desligado e a tela explica. Trocar a variável torna ilegível o que já foi gravado: cada empresa cadastra de novo.

**Gerar a cobrança.** Na fatura em aberto do painel, **Gerar Pix** e **Gerar boleto** (quem tem `faturamento`): o valor é o total da fatura, a referência (`external_reference`) é o id da fatura, e o vencimento é o fim do dia do vencimento da fatura, dentro do que o Mercado Pago aceita (Pix: no mínimo 1 dia; boleto: no mínimo 3; os dois: no máximo 29 dias à frente). A fatura pode ter várias cobranças (gerou de novo depois de vencer), mas **só uma em aberto por tipo**. Cada tentativa tem chave de idempotência: se o Mercado Pago não responder, a cobrança fica "em criação" e gerar de novo repete o mesmo pedido, sem nascer pagamento em dobro.

**Onde aparece.** Na fatura do painel e nas faturas do portal do cliente: o Pix Copia e Cola com botão de copiar, a **imagem do QR Code** que o Mercado Pago devolve, e o boleto com link e linha digitável (quando ele a devolve). Com Pix dinâmico em aberto, ele entra no lugar do estático. O aviso `fatura.emitida` da integração leva o copia-e-cola (em `pixCopiaECola`) e `cobranca` (`pix` e `boleto`, com `link` e `venceEm`) quando a cobrança já existe na hora da entrega.

**Baixa automática.** O webhook (`POST /api/pagamentos/mercado-pago/[empresa]`, público) acha a empresa pelo slug, confere a assinatura do aviso com o segredo **dela** (`x-signature`: HMAC-SHA256 de `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`, comparado em tempo constante; não confere, 401) e **não confia no corpo**: busca o pagamento no Mercado Pago com o token da empresa e usa o que a API responde. Aprovado, em reais, com a referência da fatura, do valor da cobrança, e a fatura em aberto: paga pelo mesmo caminho do Faturamento, com a data do pagamento do gateway e a forma Pix ou Boleto; a diferença entre o valor e o que foi pago vira juros ou desconto, como na conciliação. O ator na auditoria é "Mercado Pago", e quem tem `financeiro` recebe o aviso no sininho. Aviso repetido não paga duas vezes. Cancelado e vencido encerram a cobrança.

**Na dúvida não paga.** Pagamento de outro valor, em outra moeda, com outra referência, de fatura já paga por fora (possível recebimento em dobro) ou cancelada, estorno depois da baixa, e pagamento aprovado sem cobrança correspondente: a fatura não é mexida, a cobrança fica **"a conferir"** com o motivo, e o financeiro é avisado. Fatura paga pelo Mercado Pago **não é reaberta** pelo sistema.

**Quando o aviso não chega.** **Atualizar situação**, na cobrança, consulta o Mercado Pago na hora; e o servidor confere a cada 10 minutos as cobranças em aberto criadas nas últimas 72 horas.

Rotas: `GET`, `PUT` e `DELETE /api/empresa/gateway` e `POST /api/empresa/gateway/teste` (`empresa`); `POST /api/faturas/[id]/cobrancas` e `POST /api/faturas/[id]/cobrancas/[cobrancaId]` (`faturamento`); `GET /api/faturas/[id]` passa a trazer `cobrancas` e `gateway`; `POST /api/pagamentos/mercado-pago/[empresa]` (público, com assinatura e limite de 120 avisos por minuto por empresa). Tabelas `PaymentGateway` e `PaymentCharge`, criadas por [prisma/sql/025-gateway.sql](prisma/sql/025-gateway.sql); rode `npm run db:rls` depois dela.

**Limites.** O limite de avisos é em memória, por processo. A conferência periódica olha 50 cobranças por volta. O boleto sai como `bolbradesco`, o meio de boleto do Mercado Pago no Brasil. O endereço do pagador é lido do texto do cadastro: fora do formato, o boleto é recusado com o que falta. O `notification_url` de cada cobrança só é enviado quando `NEXTAUTH_URL` é https público; o endereço cadastrado no painel do Mercado Pago vale de qualquer forma. Nenhum teste automatizado chama o Mercado Pago: eles apontam `MERCADO_PAGO_API` para um servidor local que imita a API.

Ainda não existe: cartão, assinatura ou recorrência, split, **estorno pelo TMS**, outros gateways, cancelar no Mercado Pago a cobrança de uma fatura paga por fora ou cancelada (ela segue pagável lá até vencer; se for paga, fica "a conferir"), o cliente gerar o próprio Pix pelo portal (quem gera é a transportadora) e juros e multa embutidos na cobrança de fatura vencida (o valor é o total da fatura).

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
- **Rota** (`PUT /api/manifestos/[id]/ordem`): a ordem das entregas, com subir e descer, gravada em `Collection.manifestSequence`. É a ordem que o painel e o **app do motorista** mostram. Vale em montagem e em rota; carga sem ordem vai para o fim, pela data de criação, e a carga retirada da viagem perde a ordem. O botão **Google Maps** (no painel e no app) monta um link do Google Maps (`https://www.google.com/maps/dir/?api=1...`) com as paradas que faltam, na ordem: o endereço é o da entrega (logradouro, número, bairro, cidade e CEP) quando a carga tem, senão a cidade do destino; a origem é onde o aparelho está, e o link leva até 10 paradas (limite do Google Maps); passando disso entram as primeiras. Não usa API paga nem chave.
- **Sugerir ordem** (`POST /api/manifestos/[id]/roteiro`, corpo opcional `{ "voltar": true }`): roteirização **pelo endereço localizado de cada carga e, onde não há, pela cidade** (o endereço, o mapa e o GPS estão em [Mapa, endereço e GPS](#mapa-endereço-e-gps)). O sistema acha a cidade de cada entrega pelo texto do destino ("Mirassol - SP", "Mirassol/SP", "MIRASSOL", ou no fim de um endereço), pela mesma chave das tabelas de frete (`chaveDaCidade`), e propõe a ordem partindo da origem mais comum das cargas: vizinho mais próximo seguido de melhoria 2-opt, com a volta à origem contada (dá para desligar). Entregas na mesma cidade, sem endereço localizado, ficam juntas; carga sem endereço localizado e cuja cidade não foi reconhecida fica **sem localização**, vai para o fim na ordem atual e é avisada na tela; carga já entregue não muda de lugar, e com a viagem na rua a conta parte da cidade da última entrega feita. Nome que existe em mais de um estado, sem UF escrita, é procurado na UF da origem; se continuar ambíguo, fica sem localização. A rota **só calcula**: a tela mostra a ordem proposta e a distância de hoje e a sugerida, e o **Aplicar** grava pela rota de ordem de sempre (`PUT .../ordem`, com auditoria). A sugestão nunca é pior que a ordem atual: sem ganho, a resposta vem com `mudou: false`. As contas são funções puras em [src/lib/roteiro.ts](src/lib/roteiro.ts). **A distância é em linha reta** (haversine), entre os endereços localizados ou os centros das cidades: serve para a ordem não ir e voltar, não é o km de estrada, e a tela diz isso ao lado do número. Com `ROTA_URL` (servidor OSRM próprio) ela passa a ser por estrada.
- **Tabela dos municípios:** [src/data/municipios.json](src/data/municipios.json) traz os 5.571 municípios do Brasil que constam na fonte (com Brasília, Fernando de Noronha e Boa Esperança do Norte/MT, o mais novo), com nome, UF, latitude e longitude do centro, agrupados por UF. Fonte: [kelvins/municipios-brasileiros](https://github.com/kelvins/municipios-brasileiros) (`csv/municipios.csv`, commit `503e2f7`, de 10/12/2025), de Kelvin S. do Prado, **licença MIT**, derivado de dados públicos do IBGE. Só o servidor carrega o arquivo ([src/lib/municipios.ts](src/lib/municipios.ts)); ele não vai para o pacote do navegador.
- **Despesas** (`TripExpense`; `GET` e `POST /api/manifestos/[id]/despesas`, `PATCH` e `DELETE .../[despesaId]`): tipo (pedágio, combustível, alimentação, hospedagem, estacionamento, manutenção, outro), valor, data, observação e quem lançou. Nasce **pendente**. O **motorista** lança pelo app na viagem dele em rota (`/driver/viagem/[id]/despesas`; `GET` e `POST /api/driver/manifestos/[id]/despesas`) e vê só as que ele lançou e o total delas. **Combustível com litros e hodômetro** gera também o abastecimento da frota (`Fueling`), ligado à despesa; sem um dos dois fica só a despesa. **Só o administrador aprova ou recusa:** aprovar cria, na mesma transação, o lançamento no Financeiro (a pagar, ou já pago), com a categoria do tipo e a viagem como centro de custo; recusar desfaz o abastecimento gerado. Só a pendente pode ser excluída.
- **Acerto** (`GET /api/manifestos/[id]/acerto`, **só administrador**, só viagem finalizada): frete das cargas, despesas aprovadas, combustível, custo total, km rodados, custo por km, **resultado** (frete − despesas − combustível) e margem, mais os adiantamentos ligados à viagem e o saldo deles contra as despesas aprovadas (a devolver ou a receber). O combustível são os abastecimentos da frota feitos no veículo entre o dia da saída e o da finalização, **menos** os que nasceram de uma despesa da viagem, que já estão nas despesas. Despesa pendente fica fora do custo e aparece em aviso.

Permissão: dados, ordem, sugestão de ordem e lançamento de despesa são da equipe interna (`ADMIN` e `OPERATION`); aprovar despesa e o acerto são do administrador; o motorista só alcança a viagem dele que está em rota. Viagem de outra empresa responde 404, e o banco recusa despesa apontando para viagem, usuário, abastecimento ou lançamento de outra empresa. Tudo fica na Auditoria (dados e ordem da viagem; despesa lançada, aprovada, recusada e excluída).

As colunas e a tabela são criadas por [prisma/sql/020-viagem.sql](prisma/sql/020-viagem.sql); rode `npm run db:rls` depois dela.

Ainda não existe (o que falta em endereço, mapa e GPS está em [Mapa, endereço e GPS](#mapa-endereço-e-gps)): trânsito, janela de entrega e capacidade do veículo na ordem sugerida, apelido de cidade ("Rio Preto" não é reconhecido como São José do Rio Preto: precisa do nome oficial), **pedágio automático** (cálculo por rota ou integração com tag), etapa "Em retorno" (o fluxo continua Em montagem → Em rota → Finalizada), foto do comprovante da despesa, lançamento de despesa pelo app sem sinal (não entra na fila offline), edição de despesa já lançada (exclui e lança de novo) e despesa prevista na montagem. Duas viagens do mesmo veículo no mesmo dia dividem o abastecimento da frota desse dia: ele aparece no acerto das duas. Excluir no Financeiro o lançamento de uma despesa aprovada não a tira do custo da viagem.

## Mapa, endereço e GPS

Roteirização por endereço, mapa da viagem e posição do motorista, só com dados e serviços abertos do **OpenStreetMap**: nenhum serviço pago, nenhuma chave. O que cada parte usa, e os limites de cada uma:

- **Endereço da entrega.** A carga ganhou quatro campos opcionais além da cidade: logradouro, número, bairro e CEP ([src/lib/endereco.ts](src/lib/endereco.ts)). Entram no pedido do painel (seção "Endereço da entrega", recolhida) e do portal (o destinatário frequente preenche os campos a partir do endereço dele, para conferir), e na carga criada de uma NF-e (lidos do endereço do destinatário da nota). São editáveis enquanto a carga é editável (antes de embarcar) e entram na Auditoria. Mudar o endereço ou a cidade apaga a coordenada, que é procurada de novo.
- **Localizar o endereço (geocodificação): Nominatim.** Em segundo plano, o despachante do servidor ([src/lib/eventos.ts](src/lib/eventos.ts)) procura a coordenada das cargas com logradouro que ainda não foram procuradas, as que já estão em viagem primeiro ([src/lib/geo-db.ts](src/lib/geo-db.ts), [src/lib/geo.ts](src/lib/geo.ts)). Nunca dentro da requisição de alguém. Cumpre a [política de uso do Nominatim](https://operations.osmfoundation.org/policies/nominatim/): **no máximo uma consulta por segundo** no servidor inteiro (fila única em memória; na prática são até 2 consultas a cada 15 segundos), `User-Agent` com o nome do sistema e o contato de `GEO_CONTATO`, e **cache no banco** (`GeoCache`) pela chave do endereço normalizado, inclusive do "não achei": o mesmo endereço nunca é perguntado duas vezes. **Sem `GEO_CONTATO` o serviço não é consultado**: as cargas ficam esperando e a rota segue pela cidade. A consulta leva logradouro, número, cidade e UF (bairro e CEP ficam de fora: no OpenStreetMap do Brasil eles faltam ou divergem, e a consulta com eles volta vazia). Resultado a mais de 100 km do centro da cidade do destino é descartado. Falha do serviço não é guardada e deixa a localização em pausa por 10 minutos; a localização corre à parte no despachante, com trava e tratamento de erro próprios, e não segura nem derruba eventos, push, títulos vencidos nem a conferência de cobranças.
- **O `GeoCache` não tem `tenantId`.** É dado público (a coordenada de uma rua) e o cache é do sistema: guarda só o texto normalizado do endereço e a coordenada, nada que diga de que empresa, cliente ou carga veio a pergunta. Só o cliente `sistema` lê e grava; o papel da aplicação não tem permissão nenhuma na tabela ([prisma/sql/010-rls.sql](prisma/sql/010-rls.sql)).
- **Ordem sugerida por endereço.** `POST /api/manifestos/[id]/roteiro` usa a coordenada da carga quando houver e, senão, o centro da cidade ([src/lib/roteiro.ts](src/lib/roteiro.ts)): com endereço localizado, as entregas **dentro da mesma cidade** também entram na ordem. A resposta diz quantas entraram pelo endereço (`porEndereco`) e como a distância foi medida (`medida`).
- **Distância: linha reta por padrão; por estrada só com servidor próprio.** Sem `ROTA_URL`, a distância é em linha reta (haversine) e a tela diz isso. Com `ROTA_URL` apontando para um servidor **OSRM** (por exemplo uma instância própria, `http://osrm:5000`), a conta usa a matriz de distâncias por estrada dele (`/table/v1/driving/...?annotations=distance`, [src/lib/rota-osrm.ts](src/lib/rota-osrm.ts)), com tempo limite de 4 segundos e até 100 pontos; qualquer falha volta para a linha reta sem derrubar a sugestão. **O servidor de demonstração público do OSRM (`router.project-osrm.org`) não é padrão e é recusado mesmo se for posto na variável:** a política dele proíbe uso em produção.
- **Mapa.** Na aba **Rota** da viagem (botão **Mapa**, que troca a lista pelo mapa) e na viagem do app do motorista (botão **Ver mapa**): as paradas numeradas na ordem, a linha entre elas e a posição do motorista. Marcador cheio é endereço localizado; tracejado é o centro da cidade; verde é entrega feita. Desenhado com o **Leaflet** (única dependência nova, carregada só no navegador) sobre os blocos de imagem do OpenStreetMap, com o crédito **© OpenStreetMap** visível no canto ([src/components/mapa/mapa-da-viagem.tsx](src/components/mapa/mapa-da-viagem.tsx)). `GET /api/manifestos/[id]/mapa` (quem lê viagens) e `GET /api/driver/manifestos/[id]/mapa` (o motorista, só a viagem dele em rota) devolvem os pontos, que já estão no banco: abrir o mapa não consulta serviço de localização. A [política dos blocos do OSM](https://operations.osmfoundation.org/policies/tiles/) pede uso moderado e proíbe baixar blocos em massa: o service worker do app do motorista não guarda os blocos, e `NEXT_PUBLIC_MAPA_TILES` troca o servidor por um próprio ou contratado quando o volume crescer. A linha do mapa liga as paradas em linha reta: não é o caminho da estrada.
- **GPS do motorista.** No app, com a viagem em rota, o botão **Compartilhar localização** liga o envio. A permissão do navegador só é pedida depois do toque; enquanto ligado, a posição vai a cada 30 segundos, e também ao registrar uma entrega, para `POST /api/driver/manifestos/[id]/posicao` (só a viagem dele em rota; latitude, longitude e precisão conferidas; no máximo 12 envios por minuto por motorista, depois `429`). **Só funciona com o app aberto na tela:** navegador não rastreia em segundo plano, e a tela diz isso. A última posição fica na viagem e um histórico enxuto em `TripPosition` (um ponto novo só entra se o caminhão andou 25 m ou se passaram 5 minutos; no máximo 500 pontos por viagem, os mais antigos saem). O painel mostra a posição e "há quanto tempo" no mapa da aba Rota (relido a cada 30 segundos) e, na lista de viagens, o selo **localização há X min**. Viagem que não está em rota não mostra posição.
- **Privacidade.** A posição do motorista é só do painel (quem lê viagens). O **rastreio público** e o **portal do cliente** não recebem posição nem coordenada: só o status, como sempre. Posição não entra na Auditoria nem nos eventos enviados a sistemas de fora.
- **Trânsito não existe em fonte aberta.** Nem a ordem sugerida nem o mapa conhecem trânsito, e as telas dizem isso. O link **Google Maps** (no painel e no app) continua: é lá que o motorista vê o trânsito. Com endereço na carga, o link leva o endereço inteiro; sem ele, a cidade.

Variáveis: `GEO_CONTATO` (liga a localização por endereço), `GEO_URL` (padrão `https://nominatim.openstreetmap.org`), `ROTA_URL` (opcional, servidor OSRM próprio) e `NEXT_PUBLIC_MAPA_TILES` (opcional; é lida **na hora do build**, como toda variável `NEXT_PUBLIC_`). O projeto não define `Content-Security-Policy` (nem em `next.config.ts` nem em `src/proxy.ts`), então não houve o que liberar para os blocos; se uma política for criada, ela precisa de `img-src` para o servidor dos blocos.

Capacidades: ver o mapa e a posição é de quem lê viagens (`manifestosVer`); sugerir e alterar a ordem, de quem altera viagens (`manifestos`). Viagem de outra empresa responde 404, e o banco recusa posição apontando para viagem de outra empresa. As colunas e as tabelas são criadas por [prisma/sql/026-mapa.sql](prisma/sql/026-mapa.sql); rode `npm run db:rls` depois dela.

Ainda não existe: tempo de viagem e previsão de chegada; caminho pela estrada desenhado no mapa (a linha é reta); rastreamento com o app fechado ou a tela bloqueada (exigiria aplicativo nativo); trilha do percurso no mapa (o histórico é guardado, mas a tela mostra só a última posição); aviso quando o motorista para de compartilhar; correção manual do ponto no mapa (endereço que o OpenStreetMap não conhece fica no centro da cidade); localização do endereço de **coleta** (a origem segue pela cidade); apelido de cidade ("Rio Preto" não é reconhecido como São José do Rio Preto); janela de entrega e capacidade do veículo na ordem sugerida; pedágio. Um endereço que o serviço não achou só é procurado de novo se for alterado. Com mais de uma cópia do servidor, o limite de uma consulta por segundo vale por cópia: rode o despachante em uma só (`TMS_EVENTOS=off` nas outras).

## Comprovante de entrega

O comprovante segue o que as grandes transportadoras fazem: no e-commerce de última milha a prova é a **foto da carga no local**; na carga B2B, o **canhoto da nota assinado**. As regras ficam em [src/lib/comprovantes.ts](src/lib/comprovantes.ts) (o que a tela também usa) e [src/lib/entregas.ts](src/lib/entregas.ts) (corpo da baixa e conferência); o que grava, em [src/lib/comprovantes-db.ts](src/lib/comprovantes-db.ts); a redução da foto no aparelho, em [src/lib/foto.ts](src/lib/foto.ts).

**Perfil da empresa.** O administrador escolhe em Empresa (aba Identidade, cartão "Comprovante de entrega"; `GET` e `PATCH /api/empresa/comprovantes`, coluna `Tenant.podProfile`) o que a baixa exige:

| Perfil | A baixa exige | Tentativa sem sucesso exige |
| --- | --- | --- |
| `LIVRE` (padrão) | nada além de quem recebeu: foto e assinatura opcionais | nada: foto da fachada opcional |
| `ECOMMERCE` | pelo menos uma foto da entrega (a carga no local) | foto da fachada |
| `B2B` | pelo menos uma foto do canhoto assinado | foto da fachada |

O servidor impõe a regra (400 dizendo o que falta, por exemplo "Falta a foto do canhoto assinado."); a tela do motorista faz a mesma conta para marcar o obrigatório. A assinatura na tela é opcional em todos os perfis.

**Tela do motorista** (`/driver/entregas/[id]/baixa`), em blocos curtos, nesta ordem: quem recebeu (botões: destinatário, funcionário, portaria, familiar, vizinho, outro) → nome e documento → fotos (cartões "Foto da entrega" e "Foto do canhoto", que abrem a câmera traseira; miniatura com "Trocar" e "Remover") → "Entrega com ressalva" (recolhida) → "Colher assinatura na tela" (recolhida) → "Finalizar entrega". O botão final diz o que falta em vez de ficar desligado. O perfil da empresa é lido de `GET /api/driver/comprovantes` e lembrado no aparelho, para a tela marcar o obrigatório mesmo sem sinal.

- **Fotos por tipo** (tabela `ProofPhoto`): `ENTREGA`, `CANHOTO`, `AVARIA` e `FACHADA`. Até 6 por comprovante: no máximo 2 de entrega, 2 de canhoto, 2 de fachada e 3 de avaria. Só imagem embutida JPEG, PNG ou WebP. O servidor grava o **SHA-256 dos bytes** de cada imagem (não do texto base64).
- **Foto pequena antes de sair do aparelho:** a foto é reduzida no `canvas` para 1600 px no maior lado, em JPEG com qualidade 0,7. Foto que o navegador não consegue abrir (HEIC sem suporte) recebe a mensagem do formato. O teto por foto nova é de 1,5 milhão de caracteres. O formato antigo da baixa (`photoBase64`, sem `photos`) continua aceito com o teto antigo, sem a relação de quem recebeu: é o que está na fila offline de quem colheu a baixa antes da atualização do aplicativo; a foto dele entra como foto da entrega.
- **Fila offline:** continua valendo com várias fotos. O tamanho total da baixa é conferido antes de guardar, e se o aparelho não conseguir guardar (sem espaço, armazenamento bloqueado) o motorista é avisado de que a baixa **não** foi salva e a tela fica como está. Repetir a mesma baixa continua respondendo 200 sem duplicar comprovante nem foto.
- **Ressalva:** tipo (`AVARIA`, `FALTA`, `VIOLADA`, `OUTRA`) e descrição de 5 a 500 caracteres; avaria e embalagem violada exigem pelo menos uma foto de avaria. A entrega é concluída do mesmo jeito (a carga vira entregue); o comprovante fica marcado, e a equipe com `ocorrencias` é avisada pelo sininho.
- **Distância do endereço:** quando a baixa traz posição e a carga tem a coordenada do endereço ([Mapa, endereço e GPS](#mapa-endereço-e-gps)), a distância em linha reta fica gravada (`distanceMeters`). Não bloqueia a entrega. No painel, acima de 500 m aparece "a X m (ou km) do endereço". Não vai para o portal nem para o rastreio público.
- **Comprovante antigo** (uma foto em `photoBase64`, sem relação, sem tipo) continua aparecendo no painel e no portal, com a foto dele como foto da entrega. Baixas novas gravam só em `ProofPhoto`.

**Conferência no painel.** A fila (`/dashboard/comprovantes`, `GET /api/comprovantes`) tem os filtros Aguardando conferência, **Com ressalva** (`?ressalva=1`, em qualquer situação, a mais nova primeiro), **Devolvidos ao motorista** (`?status=REJECTED`) e Aprovado. A página do comprovante (`/dashboard/entregas/[id]/comprovante`) mostra as fotos agrupadas por tipo (o toque amplia), o SHA-256 de cada uma (o toque copia), quem recebeu com a relação, a ressalva, o aviso de distância e o histórico de devoluções com as fotos substituídas.

**Devolução ao motorista.** Aprovar é final; a recusa virou **devolução** (`POST /api/comprovantes/[id]/conferir` com `decision: "REJECTED"` e o motivo): fica registrada em `ProofRejection` (quem, quando, motivo), o motorista da viagem é avisado **pelo sininho** (o app do motorista tem sininho) e vê o comprovante em **"Comprovantes para refazer"** na tela inicial do app, com o motivo. Ele manda fotos novas e, se quiser, corrige nome e documento (`/driver/entregas/[id]/refazer`, `POST /api/driver/entregas/[id]/refazer`): o comprovante volta para "Aguardando conferência", as fotos devolvidas ficam guardadas como substituídas, a carga continua entregue. Só o motorista da viagem daquela carga refaz (viagem em rota ou finalizada). Repetir o mesmo envio responde 200 sem gravar de novo (o `rejectionId` diz a qual devolução ele responde). As fotos novas substituem todas as anteriores, então precisam atender sozinhas ao perfil e à ressalva. O SQL [028](prisma/sql/028-comprovantes.sql) cria a devolução em aberto dos comprovantes que já estavam recusados: eles passam a aparecer na lista do motorista.

**Tentativa de entrega sem sucesso.** É a ocorrência do motorista estendida, na mesma rota (`POST /api/driver/entregas/[id]/ocorrencia`): o corpo com `reason` registra a tentativa (`/driver/entregas/[id]/insucesso`, botão "Não entreguei" na parada). Motivo padronizado (`AUSENTE`, `ENDERECO_NAO_LOCALIZADO`, `RECUSADO`, `FECHADO`, `MUDOU_SE`, `AREA_DE_RISCO`, ou `OUTRO` com descrição), foto da fachada (obrigatória nos perfis `ECOMMERCE` e `B2B`) e a posição, quando houver. Cada tentativa fica em `DeliveryAttempt` (uma carga pode ter várias) e abre um chamado de reentrega para a equipe com `ocorrencias`, como toda ocorrência do motorista. **A carga não muda de status:** continua em rota, na mesma viagem; o que muda é o contador de tentativas, que aparece na parada do motorista, na lista de cargas e na aba Rota da viagem do painel, com a página `/dashboard/entregas/[id]/tentativas` (motivo, observação, foto da fachada, posição e chamado; para quem tem `comprovantes`). Só carga ainda em rota recebe tentativa. Repetir o envio com a mesma `key` não cria outra. Precisa de sinal: não entra na fila offline.

**Na viagem do motorista** cada parada mostra de relance: pendente, entregue, entregue com ressalva, N tentativa(s) sem sucesso ou comprovante para refazer.

**Portal do cliente.** A regra de quando o comprovante aparece não mudou (só depois de aprovado). Aprovado, mostra também as fotos de entrega e de canhoto que valem hoje e quem recebeu com a relação. A **ressalva** (tipo e descrição, sem foto) aparece assim que a entrega é registrada, porque é o cliente que precisa saber. Foto de avaria, foto de fachada, tentativa sem sucesso, posição, distância e o motivo de uma devolução não vão para o portal.

**O que não entra na auditoria nem nos eventos enviados para fora:** foto, assinatura, documento, posição, hash e a descrição da ressalva. A baixa registra o nome de quem recebeu e o tipo da ressalva; o reenvio, o nome; a tentativa, o motivo e o número dela.

As tabelas e colunas são criadas por [prisma/sql/028-comprovantes.sql](prisma/sql/028-comprovantes.sql); rode `npm run db:rls` depois dela.

Ainda não existe: **evento fiscal de comprovante de entrega** do CT-e ou da NF-e na SEFAZ (o SHA-256 guardado serve de base para isso depois; hoje nada é enviado); leitura automática do canhoto (OCR); código de confirmação por SMS; assinatura com certificado; fotos fora do banco (ficam embutidas na tabela); reenvio de comprovante e tentativa sem sucesso sem sinal (não entram na fila offline); mudança de status da carga depois de uma tentativa sem sucesso (retorno ao depósito, reagendamento) e limite de tentativas; aviso ao cliente sobre a tentativa sem sucesso; perfil por cliente ou por carga (é um só por empresa).

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
- **DANFE em PDF:** ao lado de "Baixar XML", na nota aberta do painel e na carga do portal, o botão "DANFE (PDF)" gera o documento na hora a partir do XML guardado (ver "DANFE em PDF" abaixo).

| Rota | Quem | O que faz |
| --- | --- | --- |
| `GET /api/fiscal/notas?busca=` | equipe | Notas importadas, sem o XML |
| `POST /api/fiscal/notas` | equipe | Importa um XML (`{ xml }`); devolve a nota, a carga sugerida e a carga que já tem a chave |
| `GET /api/fiscal/notas/[id]` | equipe | A nota e, se ainda sem carga, a sugestão |
| `GET /api/fiscal/notas/[id]/xml` | equipe | O XML original, como anexo |
| `GET /api/fiscal/notas/[id]/danfe` | quem baixa o XML (`fiscalVer`) | O DANFE em PDF, como anexo (`<chave>-danfe.pdf`) |
| `POST /api/fiscal/notas/[id]/carga` | equipe | Cria a carga sugerida e liga a nota a ela |
| `POST /api/fiscal/notas/[id]/ligar` | equipe | Liga a nota a uma carga pelo `trackingCode` |
| `GET /api/fiscal/cte` | equipe | Cargas em rota ou entregues, com os dados que um CT-e precisa e o CT-e emitido pelo sistema (`emitido`) |
| `POST /api/fiscal/cte` | equipe | Registra à mão `cteNumber` e `cteKey` de um CT-e emitido em outro sistema; os dois vazios desfazem |
| `GET /api/portal/coletas/[id]/notas/[notaId]` | cliente | O XML de uma nota de uma carga dele |
| `GET /api/portal/coletas/[id]/notas/[notaId]/danfe` | cliente | O DANFE em PDF de uma nota de uma carga dele |

A tabela é criada por [prisma/sql/017-documentos-fiscais.sql](prisma/sql/017-documentos-fiscais.sql).

### DANFE em PDF

O PDF não é montado aqui: quem o gera é o servidor fiscal da casa ("MCP Fiscal Brasil"), pela ferramenta `gerar_danfe`, que recebe o XML da NF-e e devolve o PDF em base64. O cliente fica em [src/lib/fiscal-mcp.ts](src/lib/fiscal-mcp.ts), sem dependência nova: três `POST` JSON-RPC (`initialize`, que devolve o cabeçalho `mcp-session-id`; `notifications/initialized`; `tools/call`), com a resposta lida em JSON ou em `text/event-stream`.

- **Ligar:** `FISCAL_MCP_URL=https://fiscal.avilaops.com/mcp` no ambiente (o mesmo serviço responde em `https://mcp.avilaops.com/fiscal`). Sem a variável o recurso fica **desligado**: as rotas respondem 503 e as telas não mostram o botão (a nota aberta e a carga do portal trazem `danfe: true|false`). `FISCAL_MCP_TOKEN`, opcional, vai como `Authorization: Bearer` (hoje o serviço não exige autenticação). `FISCAL_MCP_TIMEOUT_MS`, opcional, troca o tempo limite da conversa, que é de 20 segundos.
- **Acesso:** o mesmo do XML. No painel, a capacidade `fiscalVer`; no portal, só nota ligada a uma carga do cliente logado (a de outro cliente, a sem carga e a de outra transportadora respondem 404, e o serviço fiscal nem é chamado).
- **Falhas**, cada uma com a sua frase na tela: serviço desligado (503), serviço fora do ar ou resposta fora do protocolo (502), XML recusado pela ferramenta ou resposta que não é um PDF (502) e tempo esgotado (504). O texto que o serviço devolve no erro vai só para o log do servidor.
- **O que sai daqui:** o XML da nota é enviado ao serviço fiscal a cada pedido. O PDF não é guardado: é gerado de novo a cada clique, e a resposta vai como anexo, sem cache.

Ainda não existe: o botão na linha da lista de notas (só na nota aberta), guardar o PDF gerado, gerar vários de uma vez e DACTE.

### CT-e

A tela `/dashboard/fiscal/cte` lista as cargas em rota ou entregues com a situação do CT-e de cada uma. Dela se **confere e emite** o CT-e pela SEFAZ (modelo 57, modal rodoviário, leiaute 4.00), se baixa o XML autorizado e o DACTE, e se cancela. O **registro manual** do número e da chave de um CT-e emitido em outro sistema continua existindo (`cteNumber`, `cteKey` e `cteStatus` da carga; a chave é conferida, nada é enviado à SEFAZ).

**Regra da casa: nada é "autorizado" sem o protocolo da SEFAZ.** Um CT-e só fica autorizado com `cStat` 100 e número de protocolo, para a chave, o ambiente e o resumo (`digVal`) do XML que foi enviado. Resposta "autorizado" sem protocolo, de outra chave ou de outro ambiente não autoriza nada.

**O que NÃO foi provado.** Não havia certificado A1 de nenhuma transportadora nem acesso à SEFAZ: **nenhum CT-e foi autorizado de verdade, nem em homologação.** O que existe está provado até onde dá sem a SEFAZ: o XML é validado contra os esquemas oficiais, a assinatura é conferida de volta, e a conversa SOAP com autenticação mútua é exercitada contra um servidor HTTPS local que imita a SEFAZ. A primeira emissão real pode ser rejeitada por regra que só a SEFAZ aplica (cadastro do emitente, IE do tomador, tabela de classificação do IBS/CBS): a tela mostra o código e o motivo que ela devolver. Não conferido contra o serviço real: o espaço de nomes SOAP (`http://www.portalfiscal.inf.br/cte/wsdl/<serviço>V4`: o MOC traz o exemplo sem o "V4", e a SEFAZ não entrega o WSDL sem certificado) e a negociação do certificado do cliente.

**Passo a passo para a transportadora**

1. Credenciar-se como emissora de CT-e na SEFAZ do seu estado (ambiente de homologação e de produção) e ter o RNTRC.
2. Em **Empresa → Fiscal**, preencher os dados do emitente (CNPJ, IE, endereço, RNTRC, regime, série e próximo número, CFOP, ICMS, IBS/CBS) e salvar. O ambiente nasce em **homologação**.
3. Na mesma tela, enviar o **certificado digital A1** (e-CNPJ, arquivo `.pfx`/`.p12` com a senha).
4. Em **CT-e**, "Conferir e emitir" numa carga em rota ou entregue, e "Emitir em homologação". Corrigir o que a SEFAZ rejeitar.
5. Só depois de autorizar em homologação: em Empresa → Fiscal, trocar o ambiente para **produção** (a tela pede o CNPJ digitado de novo) e conferir o próximo número.

**Dados fiscais do emitente** (`FiscalIssuer`, uma linha por empresa, só o administrador): CNPJ (aceita o **CNPJ alfanumérico**), IE, razão social, endereço com o **código IBGE** do município (achado na tabela de `src/lib/municipios.ts`; cidade que não existe é recusada), RNTRC, regime (CRT), série, próximo número, ambiente, CFOP dentro e fora do estado, situação do ICMS (00, 40, 41, 90 ou Simples Nacional) e alíquota, e os parâmetros do **IBS/CBS** (CST, `cClassTrib`, alíquotas do IBS da UF, do IBS do município e da CBS, e PIS/COFINS, que só entram na base de cálculo). Passar a produção exige digitar o CNPJ de novo. O próximo número não pode ficar abaixo de um CT-e já autorizado.

**Certificado A1.** O arquivo e a senha ficam **cifrados** no banco (AES-256-GCM, chave derivada de `TMS_CHAVE_DE_DADOS`, amarrada à empresa e ao campo, como as credenciais do Mercado Pago) e **não voltam** para a tela, para log nem para a auditoria: a leitura devolve só o titular, o CNPJ, a validade e se confere com o emitente. É recusado o certificado de outro CNPJ (o de outro estabelecimento da mesma empresa, mesma raiz de 8 posições, é aceito, como o MOC permite), vencido, sem CNPJ (e-CPF) ou que não seja A1 (pela política 2.16.76.1.2.1.x). **Não é conferida** a cadeia até a ICP-Brasil nem a revogação: quem confere é a SEFAZ. Sem `TMS_CHAVE_DE_DADOS` o envio fica desligado e a tela explica.

**O documento** (`src/lib/cte/montar.ts`, função pura; `src/lib/cte/preparar.ts` decide quem é quem):

- remetente e destinatário saem da NF-e importada e ligada à carga (CNPJ/CPF, IE, endereço com código IBGE). Sem NF-e, só quando o nome é o do cliente pagador (cadastro) ou, para o destinatário, o de um destinatário frequente com CNPJ/CPF; carga interestadual sem NF-e não emite (a SEFAZ rejeita, 813);
- tomador é o cliente pagador: pelo CNPJ ele é o remetente (`toma3` 0), o destinatário (`toma3` 3) ou um terceiro (`toma4`, com o endereço do cadastro);
- início e fim da prestação são a origem e o destino da carga; valor da prestação é o frete; valor da carga é o valor da NF;
- chave de acesso com dígito verificador (com o CNPJ alfanumérico: cada caractere vale o código ASCII menos 48), `cCT` sorteado, emissão normal, QR Code em `infCTeSupl`;
- ICMS pela configuração (`ICMS00`, `ICMS45`, `ICMS90`, `ICMSSN`); CFOP 5932/6932 quando a prestação começa fora da UF do emitente (regra G051);
- **IBS e CBS**: grupo `imp/IBSCBS` e total `imp/vTotDFe`. Base = prestação menos ICMS, PIS e COFINS (LC 214/2025, art. 12). CST montados hoje: 000 (com valores), 400 e 410 (sem valores). Obrigatório para o regime normal; o Simples pode ficar sem;
- em homologação, o nome do remetente e do destinatário é a frase que a SEFAZ exige;
- veículo e motorista da viagem vão na observação (o modal rodoviário do CT-e 4.00 não tem esses grupos: são do MDF-e).

**Assinatura** (`src/lib/cte/assinar.ts`): XMLDSig "enveloped" do `infCte` (e do `infEvento`), RSA-SHA1, resumo SHA-1, C14N 1.0, transformações Enveloped e C14N: os algoritmos que o MOC 4.00 exige (item 3.2.4), os mesmos que o ERP da casa usa na NF-e.

**Transmissão** (`src/lib/cte/soap.ts`, `sefaz.ts`, `enderecos.ts`): SOAP 1.2 sobre TLS 1.2 com autenticação mútua (o certificado da empresa), para `CTeRecepcaoSincV4` (XML em GZip + Base64), `CTeStatusServicoV4`, `CTeConsultaV4` e `CTeRecepcaoEventoV4`, nos endereços que o Portal do CT-e publica para cada autorizador (MT, MS, MG, PR, RS, SP, SVRS e SVSP), em homologação e produção. O certificado do servidor da SEFAZ é sempre conferido, contra as raízes do Node mais as raízes v5 e v10 da ICP-Brasil (`src/lib/cte/raizes-icp-brasil.ts`, com a origem e as impressões digitais). Tempo limite de 30 segundos.

**Numeração** (`CteNumbering`, por empresa + ambiente + série, com a mesma trava da fatura): emissões simultâneas nunca levam o mesmo número. **Rejeição não consome o número** (a SEFAZ não grava CT-e rejeitado): o reenvio da mesma carga usa o mesmo número, com chave nova. Autorização consome, e a rejeição 539 (número usado por outro documento) também. **Envio sem resposta** não decide nada: o CT-e fica "sem resposta" com o mesmo XML, e a próxima tentativa consulta a SEFAZ pela chave antes de reenviar (se ela autorizou, grava; se não consta, reenvia o mesmo XML). Um buraco na numeração só aparece se uma carga rejeitada nunca for reenviada; o CT-e 4.00 não tem mais inutilização.

**O CT-e da carga.** Só o CT-e autorizado **em produção** preenche `cteKey`, `cteNumber` e `cteStatus` da carga. O de homologação fica só na tabela `Cte`, marcado como homologação em toda a tela: não tem valor fiscal.

**Cancelamento**: evento 110111, com justificativa de 15 a 255 letras, até 168 horas da autorização. Só fica cancelado com o evento registrado (135, com protocolo) ou quando a SEFAZ responde que já estava cancelado (218) e a consulta confirma (101).

**DACTE**: o PDF é gerado pelo serviço fiscal da casa (`FISCAL_MCP_URL`, ferramenta `gerar_dacte`, o mesmo serviço do DANFE), só para CT-e autorizado, a partir do `cteProc` guardado, e só quando o serviço confirma o protocolo. O arquivo de homologação leva `HOMOLOGACAO-SEM-VALOR-FISCAL` no nome. Sem a variável o botão não aparece.

**Normas conferidas** (Portal do CT-e, em 10/10/2026):

| Norma | Data | O que muda aqui |
| --- | --- | --- |
| MOC CT-e 4.00, Visão Geral e Anexo I | fev/2023 | Leiaute, assinatura, serviços, regras do tomador, CFOP (G051), homologação (G002/G005), duplicidade (204/539), cancelamento (168 h), QR Code (item 9) |
| NT Conjunta 2025.001 (CNPJ alfanumérico) | 25/04/2025; produção 06/07/2026 | CNPJ e chave de acesso com letras; dígito verificador com ASCII menos 48 |
| NT 2025.001 RTC v1.14b | 30/04/2026 | Grupo `IBSCBS`, `vTotDFe`, alíquotas de 2026 (0,1% / 0% / 0,9%), regras 014, 022 e 029 |
| NT 2026.001 v1.01 | 02/03/2026 | Vínculo de pagamento (`pgtoVinc`, eventos): facultativo, não usado |
| NT 2026.002 v1.01 | 04/08/2026 | Rejeição 310 (IBS/CBS obrigatório para o regime normal): em homologação desde 01/07/2026; em produção, "implementação futura" |
| NT 2026.004 v1.00 | 01/10/2026; homologação 13/10, produção 16/11/2026 | `vTotDFe` repete `vTPrest`; `vTPrestLiq` (facultativo, não usado); fim de EPEC e FS-DA (o sistema só emite em modo normal) |

**Rotas**

| Rota | Quem | O que faz |
| --- | --- | --- |
| `GET`/`PUT /api/empresa/fiscal` | administrador | Dados fiscais do emitente (a leitura traz do certificado só titular, CNPJ e validade) |
| `PUT`/`DELETE /api/empresa/fiscal/certificado` | administrador | Envia (`{ arquivo, senha }`, arquivo em base64) e remove o certificado A1 |
| `GET /api/fiscal/cte/situacao` | quem lê o fiscal | A empresa está pronta para emitir? Ambiente e o que falta |
| `GET /api/fiscal/cte/emissao?collectionId=` | quem lê o fiscal | Conferência: o que vai no documento, pendências e avisos |
| `POST /api/fiscal/cte/emissao` | quem escreve no fiscal | Monta, assina e transmite; devolve o CT-e como ficou e a mensagem da SEFAZ |
| `GET /api/fiscal/cte/emissao/[id]/xml` | quem lê o fiscal | O `cteProc` autorizado, como anexo |
| `GET /api/fiscal/cte/emissao/[id]/dacte` | quem lê o fiscal | O DACTE em PDF do CT-e autorizado |
| `POST /api/fiscal/cte/emissao/[id]/cancelar` | quem escreve no fiscal | Cancela (`{ justificativa }`) |
| `GET /api/fiscal/cte/status-servico` | quem lê o fiscal | Pergunta à SEFAZ se o serviço está em operação |

Eventos para o n8n: `cte.autorizado` e `cte.cancelado` (com número, chave, ambiente, protocolo e a carga; sem o XML). Aviso no sininho para quem lê o fiscal. Auditoria: dados fiscais, certificado (sem o conteúdo), autorização, rejeição e cancelamento. As tabelas são criadas por [prisma/sql/027-cte.sql](prisma/sql/027-cte.sql); os esquemas oficiais usados nos testes estão em [fiscal/esquemas/cte-4.00](fiscal/esquemas/cte-4.00/README.md).

**Ainda não existe no CT-e:** a primeira autorização real; MDF-e; carta de correção, CT-e complementar, de substituição e simplificado; contingência; expedidor e recebedor; redução de alíquota, diferimento e demais grupos do IBS/CBS além dos CST 000, 400 e 410; a conferência do CST e do `cClassTrib` contra a tabela oficial; cliente e destinatário frequente com CNPJ alfanumérico no cadastro (o cadastro de clientes ainda só aceita dígitos).

Ainda não existe nas notas: consulta à SEFAZ (situação da nota, download pela chave), manifestação do destinatário, leitura de XML de CT-e ou de NFC-e, importação por e-mail ou em arquivo compactado, mais de uma NF-e criando uma carga só, desfazer a ligação entre nota e carga e apagar nota importada. Anexar a nota a uma carga não muda o valor da NF nem o frete dela.

## Empresa

Em `/dashboard/empresa`, só para o administrador: o **nome** e o **símbolo** que aparecem no topo do painel, do portal do cliente e do app do motorista (`GET` e `PATCH /api/empresa`). O símbolo é uma imagem PNG, JPEG ou WebP, reduzida no navegador para 192 pixels antes de enviar e guardada no cadastro da empresa (`Tenant.logo`); sem símbolo, aparece o caminhão. As regras ficam em [src/lib/empresa.ts](src/lib/empresa.ts).

Na mesma tela, a seção **Cobrança** guarda a multa (% do valor) e os juros (% ao mês) que a baixa de um título vencido sugere (`GET` e `PATCH /api/empresa/cobranca`, só administrador; padrão de 2% e 1%, colunas `Tenant.lateFinePct` e `Tenant.lateInterestPct`). A mesma seção e a mesma rota guardam o **recebimento por Pix**: tipo da chave, chave, nome do recebedor e cidade (colunas `Tenant.pixKeyType`, `pixKey`, `pixName` e `pixCity`; no corpo, `pix` com `tipo`, `chave`, `nome` e `cidade`, `null` para remover, ausente para não mexer). Ver "Cobrança por Pix".

Na aba Identidade fica também o **perfil do comprovante de entrega** (`LIVRE`, `ECOMMERCE` ou `B2B`; `GET` e `PATCH /api/empresa/comprovantes`, coluna `Tenant.podProfile`): ver [Comprovante de entrega](#comprovante-de-entrega).

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
| `fatura.emitida`, `fatura.paga`, `fatura.reaberta`, `fatura.cancelada` | Fatura criada ou com status trocado | `fatura` (número, total, vencimento, cliente, link do portal; em `fatura.emitida`, `pixCopiaECola`) |
| `cobranca.vencida` | Título a receber venceu e segue em aberto | `titulo` (valor, vencimento, dias de atraso, cliente ou pagador, fatura, `pixCopiaECola`) |
| `ocorrencia.aberta`, `ocorrencia.status` | Chamado aberto (painel, portal ou motorista) ou com status trocado | `ocorrencia` (número, tipo, título, status, prioridade, quem abriu, cliente, carga com código e link de rastreio, link do painel) |
| `teste` | Botão "Enviar teste" | mensagem fixa |

Nos avisos de chamado, `status` é o de agora (lido na entrega, como nos de fatura), `tipo` é `DELAY`, `DAMAGE`, `LOSS`, `BILLING`, `REDELIVERY` ou `OTHER`, e `abertaPor` é `CLIENT` (portal) ou `STAFF` (equipe ou motorista). No chamado do motorista, `cliente` é o dono da carga. A descrição e a conversa não saem no aviso. Trocar prioridade ou responsável e escrever mensagem não avisam.

O campo `pixCopiaECola` (texto do Pix Copia e Cola estático, com o valor do título) só vai quando a empresa tem chave Pix cadastrada e a fatura ou o título segue em aberto na hora da entrega; sem chave, os avisos saem sem o campo. O destino pode mandá-lo ao cliente, mas pagar não dá baixa no TMS: a baixa é manual. Em `fatura.emitida`, quando a fatura já tem cobrança do Mercado Pago em aberto, `pixCopiaECola` é o do Pix dinâmico (pagar dá baixa sozinho) e vem junto `cobranca`, com `pix` (`copiaECola`, `link`, `venceEm`) e `boleto` (`link`, `linhaDigitavel`, `venceEm`): [Cobrança pelo Mercado Pago](#cobrança-pelo-mercado-pago).

O aviso de título vencido sai uma vez por título e por vencimento; a procura roda a cada 10 minutos. Ao cadastrar o endereço, os títulos que já estavam vencidos são avisados nessa primeira procura.

**Exemplo de destino:** [n8n/avisos-por-whatsapp.js](n8n/avisos-por-whatsapp.js) é o fluxo do n8n em uso na Mello, que transforma cada aviso num resumo de WhatsApp para o responsável: status de carga, fatura (na emissão, com o Pix copia e cola quando há chave cadastrada), título vencido (também com o Pix) e chamado aberto ou com status trocado. O arquivo é a referência; o fluxo publicado no n8n é atualizado à parte.

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

Ainda não existe: ver o conteúdo que foi enviado em cada aviso, reenviar vários de uma vez e apagar aviso antigo. O aviso direto do TMS para as pessoas (equipe, cliente e motorista) é o das [Notificações](#notificações-sininho-e-push), logo abaixo; ele não aparece nesta tela.

## Notificações (sininho e push)

Além de avisar sistemas de fora (Integração, acima), o TMS avisa **as pessoas dentro dele**: um sininho com a lista de avisos no painel (cabeçalho do celular e do computador), no portal do cliente e no app do motorista, e notificação push no navegador para quem ativar. As regras e os textos ficam em [src/lib/notificacoes.ts](src/lib/notificacoes.ts); o envio por push, em [src/lib/notificacoes-push.ts](src/lib/notificacoes-push.ts); a tela, em [src/components/notificacoes/Sininho.tsx](src/components/notificacoes/Sininho.tsx).

**Quem é avisado de quê.** Cada aviso é de uma pessoa, nasce na mesma transação da ação que o causou e nunca vai para quem fez a ação.

| Quem recebe | Quando | Abre |
| --- | --- | --- |
| Motorista | A viagem dele foi liberada | A viagem no app |
| Motorista | Uma carga foi retirada da viagem que ele já está fazendo | A viagem no app |
| Usuários do portal do cliente dono da carga | Pedido de coleta confirmado ou recusado; carga saiu para entrega; carga entregue | A carga no portal |
| Usuários do portal do cliente | Fatura emitida (número, quantidade de cargas e vencimento; o valor fica na tela de faturas) | Faturas |
| Usuários do portal do cliente dono do chamado | A transportadora respondeu no atendimento (nota interna não avisa) | O atendimento |
| Equipe com `coletas` | Pedido de coleta novo pelo portal | Coletas pendentes |
| Equipe com `ocorrencias` | Chamado novo aberto pelo cliente (portal) ou pelo motorista | O chamado |
| Responsável do chamado (sem responsável: equipe com `ocorrencias`) | O cliente respondeu no chamado | O chamado |
| Equipe com `comprovantes` | O motorista deu baixa e mandou o comprovante | O comprovante |
| Equipe com `comprovantes` | O motorista mandou fotos novas de um comprovante devolvido | O comprovante |
| Equipe com `ocorrencias` | A entrega foi feita com ressalva (só o tipo; a descrição fica no comprovante) | O comprovante |
| Motorista da viagem | O comprovante dele foi devolvido para refazer (com o motivo) | A tela de refazer no app |
| Equipe com `financeiro` | O motorista lançou despesa na viagem | Manifestos |

"Equipe com…" são os usuários cujo perfil tem a capacidade na [matriz](#perfis-de-acesso). O texto do aviso para o cliente só leva o que é dele (destinatário, destino e código de rastreio da carga dele; número e vencimento da fatura; número e título do chamado): nunca valor de frete, nome de outro cliente, nota interna nem o texto da mensagem.

**Sininho.** Mostra o número de não lidos e, ao tocar, os últimos 20 avisos (título, texto, há quanto tempo), com "Ver avisos mais antigos". Tocar num aviso abre a tela dele e marca como lido; "Marcar tudo como lido" marca todos. Consulta o servidor ao abrir a tela, ao abrir a lista e a cada 60 segundos (não há websocket). A lista cabe numa tela de celular: só ela rola.

**Push no navegador (Web Push).** Dentro do sininho, "Ativar notificações neste aparelho" pede a permissão do navegador (só depois do toque) e inscreve o aparelho; "Desligar" desfaz, só naquele aparelho. A preferência é por pessoa e por aparelho; não há escolha por tipo de aviso. O despachante do servidor (o mesmo dos eventos, a cada 15 segundos) manda por push os avisos ainda não enviados. É **uma tentativa por aviso e por aparelho**: se o serviço de push recusar, o aviso segue no sininho e não é repetido; resposta 404 ou 410 (inscrição que não existe mais) apaga a inscrição. Aviso já lido, ou com mais de uma hora (servidor parado), não toca o celular. Tocar na notificação foca a aba que já está naquela tela, ou abre uma, e marca o aviso como lido.

- **Um aparelho, uma pessoa.** O endereço da inscrição é do navegador: quem entrar nele depois e ativar leva a inscrição (na mesma empresa ou em outra). Ao sair do sistema, a inscrição é apagada do servidor, e volta sozinha quando a mesma pessoa entrar de novo naquele aparelho.
- **Service worker.** É o mesmo arquivo ([public/sw.js](public/sw.js)) com três registros possíveis. O da raiz é o do app do motorista e continua cuidando do modo offline. Os do painel (`/dashboard`) e do portal (`/portal`) só são criados quando a pessoa ativa as notificações, recebem push e mais nada: não interceptam requisição nem guardam página.
- **Endereços aceitos.** A inscrição só é aceita se o endereço for de um serviço de push de navegador conhecido (Chrome e derivados, Firefox, Safari, Edge), por HTTPS: o servidor faz um POST nesse endereço.

**Variáveis.** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` e `VAPID_SUBJECT` (contato de quem opera, `mailto:` ou `https://`). Gere o par uma vez com `npx web-push generate-vapid-keys` e guarde: trocar as chaves desliga o push de todos os aparelhos já inscritos (cada pessoa precisa ativar de novo). **Sem as três, o push fica desligado e nada quebra**: o botão de ativar não aparece e só o sininho funciona.

**iPhone e iPad.** O Safari só entrega push para o sistema instalado na Tela de Início (iOS 16.4 ou mais novo): Compartilhar → "Adicionar à Tela de Início", e abrir por lá. Aberto no Safari comum, o sininho explica isso em vez de mostrar o botão. Para a instalação funcionar, o painel e o portal têm manifesto próprio ([public/painel.webmanifest](public/painel.webmanifest) e [public/portal.webmanifest](public/portal.webmanifest)), como o app do motorista já tinha. O número no ícone do app (o selo) não é atualizado: o contador fica no sininho.

| Rota | Quem | O que faz |
| --- | --- | --- |
| `GET /api/notificacoes?cursor=` | qualquer usuário logado | Os avisos da própria pessoa, 20 por página, com `naoLidos` e `proximo` |
| `POST /api/notificacoes/lidas` | qualquer usuário logado | Marca como lido: `{ "ids": [...] }` ou `{ "todas": true }`; só os próprios |
| `GET /api/notificacoes/chave` | qualquer usuário logado | `{ ativo, chave }`: a chave pública do push, ou `ativo: false` com o push desligado |
| `POST /api/notificacoes/aparelho` | qualquer usuário logado | Inscreve o aparelho (corpo: a inscrição que o navegador entrega); 409 com o push desligado |
| `DELETE /api/notificacoes/aparelho` | qualquer usuário logado | Desinscreve o aparelho (`{ "endpoint": "..." }`); só a própria inscrição |

Essas rotas valem para qualquer perfil (como `GET /api/empresa`) e respondem sempre só com o que é de quem está logado: ninguém lê, marca nem recebe aviso de outra pessoa, nem o administrador. A leitura de aviso não entra na auditoria. As tabelas são criadas por [prisma/sql/023-notificacoes.sql](prisma/sql/023-notificacoes.sql); rode `npm run db:rls` depois dela.

Ainda não existe: SMS, e-mail, preferência por tipo de aviso, push nativo de loja (App Store e Google Play), apagar aviso, limpeza automática de avisos antigos e aviso ao motorista de carga acrescentada com a viagem já em rota (o sistema só deixa acrescentar carga em viagem em montagem). O WhatsApp continua saindo pelo n8n, a partir dos eventos da Integração.

## Auditoria

Toda ação importante grava uma linha em `AuditLog`: quem fez (o id e, guardados na hora, o nome e o perfil, porque o usuário pode ser apagado depois), quando, de onde (IP e um resumo do aparelho, como "Safari no iPhone"), a ação (`cliente.criar`, `fatura.pagar`, `usuario.perfil`…), o registro alterado e, quando há, o **antes** e o **depois** só dos campos que mudaram. O helper e as regras ficam em [src/lib/auditoria.ts](src/lib/auditoria.ts).

- **Só inserção.** O papel da aplicação não tem `UPDATE` nem `DELETE` na tabela ([prisma/sql/010-rls.sql](prisma/sql/010-rls.sql)): nem uma rota com defeito consegue alterar ou apagar a trilha. Não há rota de alteração.
- **Na mesma transação da mudança** quando a rota tem uma (`registrarAuditoria`): ação recusada pela regra não deixa linha, e linha que não pôde ser gravada desfaz a mudança. Rota que grava sem transação registra logo depois (`registrarAuditoriaDepois`); ali, se a linha falhar, o erro vai para o log do servidor e a resposta segue a mesma.
- **O que nunca entra** no antes e depois: senha, hash, segredo da integração, token, o símbolo da empresa, foto e assinatura de comprovante e XML de nota (lista `CAMPOS_PROIBIDOS`, que vale em qualquer profundidade). Imagem embutida é omitida mesmo num campo de outro nome, e texto longo é cortado em 500 caracteres.
- **IP:** o primeiro valor de `x-forwarded-for` (o proxy na frente do sistema precisa preenchê-lo); sem cabeçalho, fica vazio.
- **Tela** `/dashboard/auditoria` (menu Sistema, só `ADMIN`): da mais recente para a mais antiga, 30 por vez ("Carregar mais"), com filtro por período, usuário, tipo de registro, ação e id do registro. Abrir uma linha mostra antes e depois lado a lado.

**Quem assina.** A equipe assina com o usuário dela. O **motorista** (aplicativo) e o **cliente** (portal) também: `requireDriver` e `requirePortalClient` devolvem o `ator` da linha. O que vem do **cadastro de empresas da plataforma** fica na trilha da empresa afetada, sem `userId` (a conta do login único não é usuário de empresa nenhuma), com o nome e o e-mail da conta e o perfil `PLATAFORMA`.

O que é registrado: criar, alterar, desativar e reativar **cliente**, **motorista** e **ajudante**, e trocar o percentual de comissão do motorista; registrar, alterar e excluir **ausência**; registrar, acertar e reabrir **adiantamento**; os parâmetros de cobrança da empresa; criar e alterar **veículo**, e registrar abastecimento e documento dele; criar e alterar **usuário**, trocar perfil, pedir a liberação de acesso e revogar o do e-mail antigo de um motorista; criar, alterar e mudar status de **carga**, e informar frete à mão; criar, alterar, liberar, cancelar e finalizar **manifesto**, e retirar carga dele; emitir, pagar, reabrir e cancelar **fatura**; criar, alterar, pagar, reabrir e excluir **lançamento**; aprovar e devolver ao motorista o **comprovante**, e o reenvio dele pelo motorista; o perfil do comprovante de entrega da empresa; nome e símbolo da **empresa** e o endereço da **integração**; criar e alterar **tabela de frete** e trocar as cidades dela (quantas havia e quantas ficaram, não cada preço); abrir **chamado** e mudar status, prioridade ou responsável; concluir **conferência** no depósito e criar ou alterar **posição**; importar **nota fiscal**, criar carga a partir dela, ligá-la a uma carga que já existe e registrar ou desfazer **CT-e**; alterar **cotação** no funil e convertê-la em carga; registrar **manutenção**, registrar, alterar e excluir **pneu**, excluir abastecimento e alterar ou excluir documento de veículo; o que o **motorista** faz no aplicativo (baixa de entrega, só com o nome de quem recebeu e o tipo da ressalva; tentativa de entrega sem sucesso, só com o motivo; ocorrência; checklist, com os itens com problema); o que o **cliente** faz no portal (pedir coleta e abrir atendimento); criar, alterar, desativar e reativar **empresa** pela plataforma; e reenviar aviso.

| Rota | Quem | O que faz |
| --- | --- | --- |
| `GET /api/auditoria?de=&ate=&usuario=&entidade=&acao=&id=&cursor=` | administrador | A trilha da empresa; `de`/`ate` em `AAAA-MM-DD` (dias do Brasil), `id` aceita só o começo, `proximo` é o cursor da página seguinte |

A tabela é criada por [prisma/sql/018-auditoria.sql](prisma/sql/018-auditoria.sql); rode `npm run db:rls` depois dela.

Ainda não é registrado: mensagem em chamado (painel e portal); cotação e lead recebidos do site; leitura de volume e troca de posição de volume no depósito; checklist de veículo lançado pelo painel; despesa de viagem lida pelo motorista, o perfil dele e os destinatários frequentes do portal; e o teste da integração. A troca de status de carga continua também no histórico de status da carga (`CollectionStatusHistory`), com o usuário. Também não existe: entrada e saída do sistema (login), exportar a trilha e prazo de guarda com descarte.

## Portal do cliente

Quem tem perfil `CLIENT` entra em `/portal` e vê só os dados da empresa a que o cadastro dele está vinculado: pede coleta, acompanha as que pediu, consulta faturas e abre atendimento (`/portal/atendimento`, na seção Atendimento e ocorrências). Em `/portal/coletas/[id]` ficam o andamento com a hora de cada etapa, o link público de rastreio pronto para mandar a quem vai receber, o XML das notas fiscais ligadas à carga, para baixar (e o DANFE em PDF, quando o serviço fiscal está ligado), e o comprovante de entrega (recebedor, foto e assinatura), que dá para imprimir ou salvar em PDF. O comprovante só aparece depois de **aprovado** na conferência da transportadora; em conferência ou devolvido ao motorista, o cliente só vê que ainda não há comprovante liberado. A ressalva da entrega (tipo e descrição) aparece desde o registro: ver [Comprovante de entrega](#comprovante-de-entrega).

Além disso, o cliente tem (regras em [src/lib/portal-cliente.ts](src/lib/portal-cliente.ts)):

- **Cotação** (`/portal/cotacao`, `POST /api/portal/cotacao`): informa destino, peso, volumes, valor da nota e, se quiser, a cubagem em m³, e vê o **valor** e o **prazo** pela tabela de frete dele (a do cadastro; senão a padrão). É a mesma conta do simulador do painel, mas a resposta é fechada: valor, prazo e avisos, sem a composição, o nome da tabela ou os percentuais. Nada é gravado; "Pedir coleta com estes dados" abre o pedido de coleta preenchido.
- **Tabela de frete** (`/portal/tabela-frete`, `GET /api/portal/tabela-frete`): só leitura, com as cidades atendidas, o frete mínimo e o prazo de cada uma, e busca por cidade.
- **Destinatários frequentes** (`/portal/destinatarios`; `GET` e `POST /api/portal/destinatarios`, `PATCH` e `DELETE /api/portal/destinatarios/[id]`; tabela `ClientReceiver`): nome, CNPJ/CPF opcional, cidade-UF, endereço e contato, até 200 por cliente. No pedido de coleta, escolher um deles preenche o destinatário e a cidade de destino.
- **Pedido de coleta** (`POST /api/portal/coletas`): além dos dados da carga, aceita, tudo opcional, a **data** e a **janela de horário** da coleta, a **prioridade** (normal ou urgente), a **cubagem** em m³ e uma **observação**. Os mesmos campos existem na minuta do painel (criação e edição, com auditoria) e aparecem na lista de minutas, nas solicitações pendentes e na viagem do motorista. A cubagem entra no frete quando a tabela tem fator de cubagem; sem ela, a conta é a de sempre.
- **Baixar** (`GET /api/portal/coletas/exportar?de=AAAA-MM-DD&ate=AAAA-MM-DD`): as cargas pedidas no período (padrão: últimos 30 dias; no máximo 366 dias e 5.000 linhas) em CSV montado no servidor, com `;`, vírgula decimal e marca de UTF-8 para abrir no Excel: código, data, destino, destinatário, volumes, peso, frete e situação. Texto que começa com `=`, `+`, `-` ou `@` sai com apóstrofo na frente, para a planilha não o executar como fórmula.
- **Pix nas faturas**: com a chave cadastrada pela transportadora, cada título em aberto traz o Pix Copia e Cola (ver "Cobrança por Pix"). Quando a transportadora gerou a cobrança pelo Mercado Pago, a fatura traz no lugar o Pix dinâmico, com QR Code e baixa automática, e o boleto (ver "Cobrança pelo Mercado Pago").

Cada rota do portal filtra pelo cliente da sessão: destinatário, carga ou título de outro cliente da mesma transportadora responde 404 ou simplesmente não aparece, e o `clientId` que vier no corpo é ignorado. Entre transportadoras, quem separa é o banco.

Ainda não existe no portal: QR Code do Pix estático, o cliente gerar a própria cobrança do Mercado Pago, exportação em PDF ou XLSX, o cliente alterar ou cancelar um pedido já enviado, endereço e contato do destinatário gravados na carga (o destinatário frequente preenche só o nome e a cidade), cotação gravada como histórico e registro, na trilha de auditoria, das mensagens de atendimento e dos destinatários frequentes (pedir coleta e abrir atendimento já são registrados).

As colunas e a tabela deste módulo (pedido de coleta, destinatários e chave Pix) são criadas por [prisma/sql/021-portal-pix.sql](prisma/sql/021-portal-pix.sql); rode `npm run db:rls` depois dela.

## Estrutura

```text
src/
  app/            rotas (dashboard, driver, portal, login, api)
  components/     UI, motorista, provedores
  data/           cidades atendidas (mapa do motorista) e municípios do Brasil com coordenadas (roteirização)
  lib/            auth, prisma, permissões, cadastros, coletas, rastreio, fila offline
prisma/           schema, seed e migrações pontuais
tests/            suíte Vitest contra Postgres
public/           ícones, manifestos (motorista, painel e portal), service worker (offline do motorista e push)
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
