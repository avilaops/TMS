# Site público e CMS de cortesia

O produto tem landing page, Sobre e Universo Fiscal em `https://tms.avilaops.com`. O botão Já sou cliente mantém a entrada OIDC da Ávila Ops. Usuários autenticados preservam o encaminhamento por empresa e perfil.

## Site da transportadora

No painel, **Sistema • Meu site • cortesia** abre o editor. Administrador e Comercial editam; Diretoria consulta; apenas Administrador publica ou retira do ar. Não há cobrança de módulo. O endereço incluído é `/transportadoras/<slug-da-empresa>`; domínio próprio exige configuração adicional.

Preencha nome público, chamada, apresentação, serviços e contato. Logo e cor são próprios do site e podem diferir da identidade operacional. O logo também gera o favicon. Blog aceita texto simples, sem HTML ou JavaScript. Cada artigo tem controle de inclusão na próxima publicação.

Salvar rascunho preserva o site já publicado. Publicar cria um snapshot separado, sem os artigos não marcados. Retirar do ar preserva o rascunho. Conflitos de revisão pedem recarregamento para evitar perda silenciosa de edição. Empresas inativas e conteúdo não publicado retornam 404.

## Descoberta e documentação

`src/lib/public-site.ts` é o catálogo de páginas públicas do produto. O sitemap inclui somente essas páginas e os snapshots publicados de empresas ativas. `lastmod` usa a revisão editorial real ou a data de publicação do CMS. Login, painéis, APIs e consultas individuais ficam fora da indexação.

O blog usa MDX local compilado no servidor. `docs/paginas/inventario.json` relaciona todas as páginas e padrões de subpáginas aos seus arquivos MDX. Execute `node scripts/documentar-paginas.mjs` ao adicionar uma tela; a cobertura é verificada em teste. Documentação interna não é servida publicamente.

`/conteudo/inicio.mdx` e as alternativas públicas descritas em `src/lib/public-mdx.ts` entregam Markdown com referência canônica ao HTML e sem indexação duplicada. Sites publicados têm alternativas em `/conteudo/transportadoras/<slug>/inicio.mdx`, `sobre.mdx`, `servicos.mdx`, `contato.mdx` e `blog/<artigo>.mdx`, conforme o snapshot. Conteúdo de clientes é exportado como texto, nunca compilado como código.

`llms.txt` complementa a documentação. Acesso de rastreadores e conteúdo legível permitem descoberta; não garantem indexação, citações por IA ou aumento de conversão.

## Consentimento e eventos

IDs públicos de runtime: GA4 `G-HNFLJYF5CE` • GTM `GTM-56VSVMSL` • propriedade `564318824`. GTM é o único carregador. Estatísticas começam negadas, publicidade permanece negada, e o banner oferece aceite e recusa equivalentes. A preferência vale até 180 dias e pode ser alterada no rodapé.

Eventos explícitos: `page_view`, `contact_click`, `login_click`, `article_read` (artigo visível após 30 segundos). O clique de contato é uma microconversão, não um lead confirmado. Mensuração automática está desativada; não se enviam parâmetros de URL, fragmentos, referenciador, identificadores pessoais ou dados da operação. Sites das transportadoras não recebem o analytics do produto. Retenção de eventos configurada em dois meses, sem renovação por atividade.

## Publicação e banco

O CI continua construindo, tipando e testando o artefato com PostgreSQL real. A promoção usa a imagem GHCR por digest no serviço Render `srv-dbrvu9ifngtc73bb5q10`, sem build no servidor antigo. O segredo `RENDER_API_KEY` pertence ao workspace do serviço; não é versionado. O workflow apenas solicita a publicação. Confirme o estado live e o commit em `/api/health` antes de declarar o deploy concluído.

O CMS adiciona somente `CarrierSite`. Faça backup e aplique `prisma/sql/044-carrier-sites.sql` com o dono da base antes da nova imagem. O SQL é reaplicável e aplica RLS `tms_app`; não use `db push` em produção nesta entrega. Uma reversão de imagem pode manter a tabela aditiva sem alterar dados anteriores.

O banco gratuito recuperado tem expiração prevista para 13/12/2026. A implementação não contrata recursos pagos nem modifica segredos do Auth.
