# Mello Transportes Rio Preto

Landing page comercial em React, TypeScript e Vite para consulta de cidades atendidas, prazos, frota, cotação rápida e solicitação de coleta pelo WhatsApp.

## Central de Coletas

A rota `#/coleta` funciona como um painel WhatsApp-first:

- Nova coleta em etapas, com barra de progresso e resumo lateral.
- Rascunho salvo automaticamente em `localStorage`.
- Perfil opcional do solicitante salvo somente no dispositivo.
- Consulta de CEP por ViaCEP, com preenchimento manual como fallback.
- Consulta automática da cidade de destino na área atendida.
- Cálculo de quantidade de volumes, peso informado e cubagem estimada.
- Protocolo local no formato `MEL-AAAAMMDD-HHMM-XXXX`.
- Prévia, cópia e impressão do resumo da mensagem.
- Histórico local em “Meus pedidos neste dispositivo”.
- Repetição de pedido anterior.
- Mensagens específicas para cotação, consulta de cidade, alteração, cancelamento, acompanhamento, envio de documentos, comprovante e atendimento direto.

A confirmação da coleta é sempre humana, pela conversa no WhatsApp. O site não confirma coleta, não rastreia entrega e não envia documentos sozinho.

## Dados Preservados

- Telefone: `(17) 3308-0878`
- WhatsApp: `(17) 99714-9702`
- E-mail: `comercial@mellotransportesriopreto.com.br`
- Endereço: `Rua Bonsucesso, nº 695 - Quinta das Paineiras - São José do Rio Preto/SP`
- Cobertura: 138 cidades cadastradas em `src/data/serviceAreas.csv`
- Frota: Fiat Strada, Van de Carga e Caminhão VUC (Até 3,7m)
- Prazos: `Até 24h` e `Até 48h`

## Como Atualizar

- Dados da empresa: `src/config/company.ts`
- Cidades, polos, prazos e veículos de rota: `src/data/serviceAreas.csv`
- Frota resumida: `src/data/fleet.ts`
- Serviços: `src/data/services.ts`
- FAQ: `src/data/faq.ts`
- Depoimentos reais: `src/data/testimonials.ts`
- Mensagens, protocolos, histórico local e futura troca por API: `src/services/collectionService.ts`
- Matérias do blog: `src/content/blog.ts`
- Identidade visual, paleta e kit de marca: `src/data/brand.ts`
- Manual editável de marca: `docs/manual-marca-mello.md`
- Manual PDF publicado: `public/manual-marca-mello.pdf`

Não adicione depoimentos, números de entregas, clientes ou anos de mercado sem confirmação comercial.

## Blog

As matérias ficam em `src/content/blog.ts`, como blocos tipados. Para publicar
uma matéria nova, acrescente um objeto em `posts` com `slug`, `title`,
`description`, `excerpt`, `category`, `publishedAt`, `readingMinutes` e `body`.

O resto se ajusta sozinho: a matéria entra no índice `/blog`, ganha a página
`/blog/<slug>` pré-renderizada, entra no `sitemap.xml` gerado pela aplicação e
recebe os dados estruturados de `Article`.

Blocos aceitos no `body`: `p`, `h2`, `h3`, `ul`, `ol`, `note` e `table`. Dentro
dos textos, `**assim**` vira negrito.

Não publique número de entregas, nome de cliente ou tempo de mercado sem
confirmação comercial.

## Identidade Visual

A rota `#/marca` apresenta o kit comercial da Mello Transportes:

- Logo principal.
- Paleta oficial.
- Tipografias sugeridas.
- Regras rápidas de uso.
- Entregas recomendadas para cliente.
- Templates simples para status, cartão digital e assinatura.

O PDF público fica disponível em:

```text
https://avilaops.github.io/Mello/manual-marca-mello.pdf
```

## Limitações GitHub Pages

Esta versão é estática:

- O histórico fica somente no navegador do cliente.
- O WhatsApp é o canal oficial de envio.
- Arquivos e fotos devem ser anexados diretamente na conversa do WhatsApp.
- Status operacionais reais não são atualizados automaticamente.
- Para futura integração com API, Odoo ou WhatsApp Business API, implemente um `ApiCollectionService` com os mesmos métodos do `LocalCollectionService`.

## Comandos

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm run build
```

## Deploy (Hetzner)

O site roda em container no Hetzner `178.105.82.48` (`/opt/mello`), atrás do Caddy,
em `127.0.0.1:3060`. A imagem é buildada **localmente** (o servidor não tem RAM nem
disco para `next build`) e enviada com `docker save | docker load`:

```bash
docker build --platform linux/amd64 -t mello-app:latest .
docker save mello-app:latest | gzip -1 | ssh -i ~/.ssh/hetzner_avilaops root@178.105.82.48 'gunzip | docker load'
ssh -i ~/.ssh/hetzner_avilaops root@178.105.82.48 'cd /opt/mello && docker compose up -d app'
```

- Banco: container `mello-db` (Postgres 16, volume `mello-pgdata`), exposto só em
  `127.0.0.1:5436` para `prisma db push` via túnel SSH
  (`ssh -L 5436:127.0.0.1:5436 ...` e `npx prisma db push --url postgresql://mello:<senha>@127.0.0.1:5436/mello`).
- Variáveis em `/opt/mello/.env` - ver `.env.production.example`.
- DNS: `mello.avilaops.com` → A `178.105.82.48` (DNS-only). O domínio do cliente fica
  na Redehost (e-mail é Redehost, MX/SPF intocados): `www` CNAME `mello.avilaops.com`
  e apex A `178.105.82.48`.
- Caddy: `mello.avilaops.com` e `mellotransportesriopreto.com.br` → 3060; `www`
  redireciona 301 para o apex. Quando o DNS do cliente virar, trocar `NEXTAUTH_URL`
  para `https://mellotransportesriopreto.com.br` e rodar `docker compose up -d app`.

## Conteúdo e distribuição (banco)

O texto da matéria continua em `src/content/blog.ts`, que é quem gera a página,
o sitemap e os dados estruturados. O banco não guarda o texto: guarda o que
acontece **depois** de publicada.

Três tabelas:

- `Article` - espelho das matérias do arquivo (slug, título, categoria, data).
  Serve para um post apontar para a matéria e para a medição ter onde pendurar
  o número. A página do site nunca lê daqui.
- `SocialPost` - um post por canal (`BLOG`, `INSTAGRAM`, `GOOGLE_BUSINESS`,
  `FACEBOOK`, `LINKEDIN`, `WHATSAPP_STATUS`), com texto próprio, arte, link,
  agendamento, o id devolvido pela rede e o motivo da falha quando dá errado.
  Uma tabela só, com canal como campo, porque o ciclo de vida é o mesmo em
  todos: rascunho, aprovado, agendado, publicado.
- `ContentMetric` - impressões, cliques, posição e CTR por matéria e por dia de
  medição, no formato que o Search Console devolve.

Duas restrições valem citar, porque foram testadas e são o que impede erro
silencioso:

- `SocialPost` é único por (canal, id externo): o fluxo repetir a chamada não
  publica o mesmo post duas vezes. Post ainda sem id externo (rascunho) pode
  repetir à vontade.
- `ContentMetric` é único por (matéria, data): rodar a medição duas vezes na
  mesma terça não dobra o número.

Para espelhar as matérias do arquivo no banco:

```bash
npx tsx prisma/sincronizar-artigos.ts             # ensaio, não grava
npx tsx prisma/sincronizar-artigos.ts --aplicar   # grava
```

Matéria com o mesmo slug é atualizada, nunca duplicada. Matéria que sumiu do
arquivo não é apagada, só reportada: ela pode ter post publicado apontando para
ela, e apagar levaria o histórico junto.

## Blog e Instagram automáticos (n8n)

O fluxo `Mello - Blog automático (escreve, revisa, entrega para colar)`
(`WR18HLwdT9NDuPFd`) roda toda quinta às 08:00 e entrega matéria pronta para
revisão. Ele **não publica nada**: a matéria mora neste repositório, e publicar
é colar o bloco em `src/content/blog.ts` e commitar.

O caminho, em ordem:

1. Lê a pauta na data table `mello_blog_pauta` (`HKHTICCIOB3v5Oqu`).
2. Descarta tema já escrito, lendo `mello_blog_temas_feitos` (`ugifbPq6Bv0ivIvm`).
   As 5 matérias que já estão no site também entram na lista de bloqueio.
3. Escreve com a OpenAI, um tema por vez, no máximo 3 por rodada.
4. Um segundo agente revisa contra 8 critérios e dá nota de 0 a 100.
5. Nota abaixo de 85 ganha **uma** reescrita com o parecer em mãos.
6. Monta o bloco TypeScript e manda por e-mail, pronto para colar.

### A capa da matéria

A capa é uma **foto gerada por IA**, não um card com texto. Um agente escreve o
prompt a partir do tema (o que uma câmera veria: caixas, paletes, doca, baú) e o
`gpt-image-2` gera a foto. O prompt proíbe texto, letra, logotipo e rosto
identificável: texto dentro de imagem gerada sai errado e não há como corrigir
depois.

Sobre a foto entra a **assinatura da marca**, seguindo `brandRules`: fio
laranja, barra escura de contraste (a regra proíbe aplicar a marca sobre foto
poluída sem faixa) e a logo na **versão branca**, que é a indicada para fundo
escuro. A logo branca é um asset do site (`/logo-mello-branca.png`), gerada uma
vez: o `logo-mello.png` é RGB sem canal alpha e, aplicado direto, aparece dentro
de um quadrado branco.

A imagem chega **anexada no e-mail**, com o nome do arquivo pronto. Para
publicar: salve o PNG em `public/blog-capas/` com o nome que ele já tem e cole o
bloco, que já vem com `coverImage` e `coverImageAlt`.

Matéria sem capa continua válida: o índice e a página caem no layout tipográfico
e o OpenGraph usa a imagem padrão do site. Quando a geração falha, o e-mail diz o
motivo em vez de omitir.

Três decisões que valem saber:

- **O slug vem da pauta, nunca da IA.** Ele é a URL e a chave contra matéria
  duplicada, então não pode ser inventado a cada rodada.
- **Travessão reprova sozinho**, e é conferido por regex depois da IA. O
  revisor também passa a mão, e travessão é marca de texto gerado.
- **A IA devolve `Block[]` tipado**, não markdown. O que não couber nos tipos
  aceitos (`p`, `h2`, `h3`, `ul`, `ol`, `note`, `table`) é descartado antes de
  virar código, para o bloco sempre compilar.

### O post do Instagram

A mesma foto vira a arte do feed, em 1080x1350. Ela sobe ao Google Drive como
link público (o Todoist não hospeda imagem) e abre uma tarefa com a legenda e as
hashtags prontas para copiar. Postar continua manual: você abre a tarefa, salva
a imagem e publica.

**A ordem da arte importa:** recorta primeiro, assina depois. Assinar e então
cortar parte a barra ao meio, sobra "SPORTES" e a logo some. Cada formato recebe
a assinatura inteira, com medidas próprias.

Para acrescentar um tema, insira uma linha em `mello_blog_pauta` com `slug`,
`titulo`, `categoria` (uma das quatro do blog), `angulo` e `ativo`.

### Duas armadilhas que custaram caro

**O Code lê os dois nós pelo nome, nunca por `$input`.** O predecessor imediato
do Code é `Ler temas ja escritos`. Com a tabela vazia e `alwaysOutputData`
ligado, esse nó devolvia um único item `{}`, e era ele que chegava no `$input`:
a pauta inteira ficava de fora e a fila saía vazia com a pauta cheia.

**A ordem da cadeia importa:** temas primeiro, pauta depois. Tentar ler os temas
num ramo paralelo saído do gatilho quebra com `Node hasn't been executed`,
porque o Code roda antes do ramo. E tirar o `alwaysOutputData` faz a cadeia
parar no nó quando a tabela está vazia, que é o estado em que ela nasce.

O filtro de `ativo` também saiu do nó Data Table para o Code: lá a coluna
booleana era comparada com a string `"true"` e nunca casava.

**Binário se perde de várias formas, e todas dão o mesmo sintoma: e-mail sem
anexo ou arte sem marca.**

1. Code node não repassa binário: tem que devolver `{ json, binary }`.
2. Ler o binário de outro nó pelo nome **apaga** o que o item já carregava. Use
   `$input.item.binary` quando quiser preservar o que veio.
3. Mas leia pelo nome quando o predecessor trocou o item: depois do Todoist, o
   item que chega é a tarefa criada, não a matéria.
4. Subir ao Drive o binário do nó errado publica a arte **sem** assinatura: a
   marca é desenhada e descartada em seguida, sem erro nenhum.
5. O nó de compartilhar do Drive devolve o id da **permissão**, não do arquivo.
   O id do arquivo vem do nó de upload.
6. A lista de anexos do e-mail tem que ser montada a partir do que existe de
   fato, porque nome fixo derruba o envio.

Os três sintomas eram o mesmo: rodada terminando **em sucesso**, em menos de um
segundo, sem escrever nada e sem erro nenhum. Por isso o Code agora emite um
item de diagnóstico quando a fila fica vazia, dizendo quantas linhas entraram e
por que cada tema saiu, e esse texto vai no e-mail. Falha silenciosa é a que
ninguém conserta.
