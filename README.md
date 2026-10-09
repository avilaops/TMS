# TMS

Sistema de gestão de transportes para operação terrestre, de carga fracionada e dedicada: coletas, manifestos, motoristas, veículos, financeiro, fiscal/CT-e, app do motorista e portal do cliente.

Nasceu como o sistema da Mello Transportes Rio Preto (este repositório se chamava `Mello`) e ainda roda a operação dela. Em 06/10/2026 o site institucional saiu daqui para [avilaops/mellotransportesriopreto.com.br](https://github.com/avilaops/mellotransportesriopreto.com.br); o que ficou é só o sistema.

- Endereço: https://tms.avilaops.com
- Site da Mello (consome a API pública): https://mellotransportesriopreto.com.br
- Roadmap: [ROADMAP.md](ROADMAP.md)

## O que tem aqui

| Área | Rota | Quem acessa | O que faz |
| --- | --- | --- | --- |
| Gestão | `/dashboard` | `ADMIN`, `OPERATION` | Clientes, CRM, coletas, manifestos, motoristas, veículos e manutenção, financeiro, fiscal/CT-e, mensagens, usuários |
| Motorista | `/driver` | `DRIVER` | PWA com viagens, mapa, baixa de entrega com comprovante e fila offline |
| Cliente | `/portal` | `CLIENT` | Coletas (pedido, acompanhamento com rastreio e comprovante de entrega), faturas e minutas da própria empresa |
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
- **Unicidade por empresa:** CNPJ do cliente, CPF do motorista, placa e e-mail do usuário são únicos dentro da empresa. Código de rastreio e chave de CT-e continuam únicos no sistema inteiro.

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
- **Pagar, reabrir, cancelar** (`PATCH /api/faturas/[id]`): o lançamento acompanha a fatura na mesma transação. Cancelar solta as cargas, que voltam a ser faturáveis; o número cancelado não é reaproveitado, e fatura paga precisa ser reaberta antes de cancelar.
- **Depois de faturada**, a carga não muda mais de frete: a fatura já saiu com ele.
- `/dashboard/faturamento/[id]` é a fatura pronta para imprimir ou salvar em PDF.

Ainda não há boleto, Pix nem envio automático do aviso de cobrança: a baixa é manual. A posição do que está em aberto, o aviso para copiar e o recibo ficam em [Cobrança](#cobrança).

## Financeiro: contas a pagar, a receber e fluxo de caixa

Em `/dashboard/financeiro`, só para o administrador. As regras e as contas ficam em [src/lib/financeiro.ts](src/lib/financeiro.ts).

- **Lançamento** (`FinancialTransaction`): receita ou despesa, valor, vencimento, cliente ou fornecedor, categoria e observação. Quando é pago guarda a data (`paidAt`) e a forma de pagamento.
- **Situação** é calculada: pago, em aberto ou vencido. Vence no fim do dia do vencimento, no relógio do Brasil; o vencimento em si é um dia do calendário e é lido em UTC, para não aparecer um dia antes.
- **Rotas:** `GET /api/financeiro` (filtros `tipo`, `situacao`, `de`, `ate`), `POST` com validação, `PATCH /api/financeiro/[id]` (editar, `action: "pagar"` ou `"reabrir"`) e `DELETE`.
- **Lançamento que veio de fatura** não é pago, editado nem excluído por aqui: responde 409 e manda para o Faturamento, que mantém fatura e lançamento em sincronia. Pagar a fatura grava o `paidAt` do lançamento.
- **Fluxo de caixa** (`GET /api/financeiro/fluxo?de=AAAA-MM&ate=AAAA-MM`, padrão de três meses para trás e três para a frente, no máximo 36): por mês, o **previsto** (o que vence no mês) e o **realizado** (o que foi pago ou recebido no mês), com saldo e acumulado. O resumo dos cartões é sempre de todos os lançamentos: conta vencida há um ano continua vencida.

Ainda não há conciliação bancária, centro de custo nem lançamento recorrente.

## Cobrança

Em `/dashboard/cobranca`, só para o administrador. As contas ficam em [src/lib/cobranca.ts](src/lib/cobranca.ts) e não mudam o banco: a tela só lê.

- **Posição por cliente** (`GET /api/financeiro/cobranca`): os lançamentos a receber em aberto, agrupados por quem deve (o cliente; sem cliente, o pagador digitado; sem nenhum, "Sem cliente informado"), com total, vencido e o maior atraso em dias. Quem mais deve em atraso aparece primeiro.
- **Faixas de atraso:** a vencer, 1 a 30, 31 a 60, 61 a 90 e mais de 90 dias, contados do vencimento até hoje no relógio do Brasil. Título sem vencimento conta em "a vencer".
- **Aviso de cobrança:** o texto já redigido com os títulos do cliente (lembrete quando nada venceu, atraso quando algo venceu), para copiar e mandar pelo canal de costume. O sistema não envia nada e o texto não traz dado de pagamento.
- **Recibo** (`GET /api/financeiro/[id]/recibo`, tela `/dashboard/financeiro/recibo/[id]`): só de receita já recebida, para imprimir ou salvar em PDF. Chega-se a ele pelo link "Recibo" no Financeiro e na fatura paga.

A baixa continua no Faturamento e no Financeiro; título pago sai da posição. Juros, multa, parcelas e o registro de que o aviso foi mandado não existem.

## Relatórios

Em `/dashboard/relatorios`, só para o administrador. Um período em meses (`GET /api/relatorios?de=AAAA-MM&ate=AAAA-MM`, padrão do mês corrente e os dois anteriores, no máximo 36), no relógio do Brasil. As contas ficam em [src/lib/relatorios.ts](src/lib/relatorios.ts) e não mudam o banco: a tela só lê.

- **Operação:** cargas criadas no período, por status; e as entregas feitas no período, com quantas chegaram no prazo, o tempo médio e a conta por motorista. O prazo é o da tabela de frete e corre de "Coletado" a "Entregue" no histórico da carga. Entrega sem prazo ou sem as duas datas fica como "sem medição", fora da taxa.
- **Comercial:** cotações recebidas no período por status, a conversão (as que viraram coleta sobre todas) e o frete das cargas criadas no período, por cliente. Carga cancelada ou recusada não entra no frete; carga a cotar conta à parte.
- **Financeiro:** recebido, pago e resultado pela data do pagamento, despesas pagas por categoria, e a inadimplência (quanto do que há a receber em aberto já venceu), que é a posição de hoje e não a do período.

Ainda não há exportação para planilha ou PDF, DRE, nem margem por rota ou por veículo.

## Empresa

Em `/dashboard/empresa`, só para o administrador: o **nome** e o **símbolo** que aparecem no topo do painel, do portal do cliente e do app do motorista (`GET` e `PATCH /api/empresa`). O símbolo é uma imagem PNG, JPEG ou WebP, reduzida no navegador para 192 pixels antes de enviar e guardada no cadastro da empresa (`Tenant.logo`); sem símbolo, aparece o caminhão. As regras ficam em [src/lib/empresa.ts](src/lib/empresa.ts).

A aplicação só lê a tabela de empresas; a gravação vai pelo dono do banco, presa ao id da empresa da sessão. O portal do cliente e o app do motorista mostram o mesmo nome e símbolo (a leitura é liberada a todo perfil da empresa).

## Integração (eventos para n8n e outros sistemas)

Em `/dashboard/empresa`, o administrador cadastra um **endereço** (um Webhook do n8n, por exemplo). A partir daí, cada troca de status de carga (inclusive a criação), cada fatura emitida, paga, reaberta ou cancelada e cada título que vence é avisado nesse endereço por `POST`, em até 15 segundos. Empresa sem endereço não gera evento.

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
- **Garantia de entrega:** o evento é gravado pelo banco na mesma transação da troca de status (gatilho em [prisma/sql/010-rls.sql](prisma/sql/010-rls.sql), tabela `OutboxEvent`). Resposta fora de 2xx ou sem resposta em 8 segundos é tentada de novo em 1, 2, 4… minutos, até 8 vezes. O mesmo evento pode chegar mais de uma vez; use o id.
- **Endereço:** só `https` e só endereço público. O servidor recusa IP interno ao salvar e de novo a cada entrega ([src/lib/url-publica.ts](src/lib/url-publica.ts)).
- **Quem entrega:** o próprio servidor, a cada 15 segundos ([src/instrumentation.ts](src/instrumentation.ts), [src/lib/eventos.ts](src/lib/eventos.ts)). `TMS_EVENTOS=off` desliga.
- **Rotas:** `GET`/`PUT /api/empresa/webhook` e `POST /api/empresa/webhook/teste`, só para o administrador.

**Tipos de aviso** (o `tipo` do corpo e o cabeçalho `X-TMS-Evento`):

| Tipo | Quando | `dados` |
| --- | --- | --- |
| `coleta.status` | Carga criada ou com status trocado | `de`, `para`, `coleta` |
| `fatura.emitida`, `fatura.paga`, `fatura.reaberta`, `fatura.cancelada` | Fatura criada ou com status trocado | `fatura` (número, total, vencimento, cliente, link do portal) |
| `cobranca.vencida` | Título a receber venceu e segue em aberto | `titulo` (valor, vencimento, dias de atraso, cliente ou pagador, fatura) |
| `teste` | Botão "Enviar teste" | mensagem fixa |

O aviso de título vencido sai uma vez por título e por vencimento; a procura roda a cada 10 minutos. Ao cadastrar o endereço, os títulos que já estavam vencidos são avisados nessa primeira procura.

**Exemplo de destino:** [n8n/avisos-por-whatsapp.js](n8n/avisos-por-whatsapp.js) é o fluxo do n8n em uso na Mello, que transforma cada aviso num resumo de WhatsApp para o responsável.

Ainda não há escolha de quais tipos receber, nem repetição do aviso de título vencido (o lembrete periódico fica por conta do fluxo no destino).

## Portal do cliente

Quem tem perfil `CLIENT` entra em `/portal` e vê só os dados da empresa a que o cadastro dele está vinculado: pede coleta, acompanha as que pediu e consulta faturas. Em `/portal/coletas/[id]` ficam o andamento com a hora de cada etapa, o link público de rastreio pronto para mandar a quem vai receber, e o comprovante de entrega (recebedor, foto e assinatura), que dá para imprimir ou salvar em PDF. O comprovante só aparece depois de **aprovado** na conferência da transportadora; em conferência ou recusado, o cliente só vê que ainda não há comprovante liberado.

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
