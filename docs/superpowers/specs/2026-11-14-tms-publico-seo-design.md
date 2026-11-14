# TMS • Site público, conteúdo fiscal e descoberta

Data: 14/11/2026
Estado: aprovado pelo usuário em 14/11/2026 • implementação autorizada

## Objetivo e decisões do usuário

O usuário pediu aplicar ao TMS a preparação para SEO, buscas por IA, previews, favicons, sitemap, robots, llms.txt, arquivos MDX em todas as páginas, GA4, Tag Manager, consentimento e Search Console. Ao esclarecer o conteúdo público, escolheu landing page, Sobre, Blog e Já sou cliente. Acrescentou Universo Fiscal e os temas MDF-e, CT-e, CT-e OS e NF-e.

A área pública apresenta o produto e ajuda visitantes a entender documentos fiscais. A aplicação operacional continua exigindo login e suas permissões por empresa. Previews e conteúdo serão preparados para aquisição; ganho de conversão e citações por IA dependerão de medição posterior.

## Situação conferida

- A raiz atualmente redireciona para o login. Há 66 padrões de páginas: 63 protegidos, raiz, login e rastreio.
- O layout usa `noindex, nofollow`, e `public/robots.txt` bloqueia todo o domínio. `/sitemap.xml` e `/llms.txt` retornam 404.
- O código explica que o TMS era exclusivamente aplicativo; a nova landing altera essa decisão apenas para visitantes sem sessão.
- Os favicons locais já têm a marca Ávila Ops e estão modificados, junto com o layout, antes desta demanda. Essas alterações relacionadas serão reaproveitadas; exclusão local de `.env.example` e outros trabalhos não serão incorporados automaticamente.
- A conta de serviço Google acessa a conta GA4 `accounts/398473876` e a conta GTM `accounts/6362126826`. Não foi encontrada propriedade ou contêiner específico do TMS na consulta inicial.
- `sc-domain:tms.avilaops.com` já está verificado com permissão de proprietário; a lista de sitemaps está vazia.
- O contato institucional público confirmado é `https://avilaops.com/contato/`.
- A aplicação está no Render, serviço `srv-dbrvu9ifngtc73bb5q10`, com imagem/codebase do commit `c207efdbced1d3f97ac9506024897eb350572c8f` na auditoria inicial.

## Abordagem

Foi escolhida uma área pública dentro do próprio TMS. Ela evita mandar visitantes diretamente para autenticação e permite conteúdo próprio no domínio solicitado. Somente liberar os robôs deixaria o buscador diante de formulários e login; manter todo o conteúdo comercial em `avilaops.com/tms/` não atenderia à área pública pedida neste domínio.

A implementação preserva Next.js 16.2.12, React, Tailwind, NextAuth, Prisma e as regras de acesso existentes. Não haverá alteração de dados operacionais, permissões, cobrança nem chave de criptografia do Auth nesta entrega.

## Páginas e navegação

| Endereço | Conteúdo e comportamento |
| --- | --- |
| `/` | Landing pública para visitante anônimo. Usuários autenticados continuam seguindo para sua área ou escolha de empresa, como hoje. |
| `/sobre` | TMS da Ávila Ops, público atendido, organização do produto e ligação com o ecossistema. |
| `/blog` | Blog com seção Universo Fiscal e quatro artigos iniciais. |
| `/blog/o-que-e-mdfe` | O que é o MDF-e, sua relação com uma viagem e os demais documentos. |
| `/blog/o-que-e-cte` | O que é o CT-e e como se distingue de NF-e e MDF-e. |
| `/blog/o-que-e-cte-os` | O que é o CT-e OS e a diferença para transporte de cargas. |
| `/blog/o-que-e-nfe` | O que é a NF-e e a diferença entre documento eletrônico e DANFE. |
| `/privacidade` | Política das páginas públicas e explicação dos papéis da Ávila Ops e dos clientes no uso operacional. |
| `/cookies` | Cookies necessários, estatísticas opcionais e acesso às preferências. |

O menu terá Início, Sobre, Blog e o botão Já sou cliente, levando a `/login`. O rodapé liga políticas e contato institucional. O rastreio continua funcionando sem entrar no sitemap ou receber analytics.

### Estrutura da landing

1. Cabeçalho com marca, navegação e Já sou cliente.
2. Hero com promessa concreta de centralizar coletas, cargas, frota e financeiro; CTA Solicitar demonstração para o contato institucional e acesso às funcionalidades.
3. Visão ilustrativa do fluxo operacional, claramente identificada como exemplo e sem dados reais de empresas.
4. Funcionalidades verificadas: coletas e manifestos, frota e motoristas, atendimento ao cliente, financeiro e acompanhamento fiscal.
5. Papéis de operação, motorista e cliente, sem apresentar como públicas suas telas internas.
6. Perguntas frequentes sobre o produto e os acessos.
7. Artigos de Universo Fiscal e CTA final.

O visual usará o símbolo Ávila Ops existente, fundo claro, azul e tons escuros da identidade atual, tipografia do projeto e boa leitura em celular. Não serão inventados preços, depoimentos, indicadores, clientes ou certificações. CT-e OS será assunto educativo, sem prometer emissão nativa inexistente; NF-e será descrita conforme leitura/importação de XML e capacidades verificadas no código.

## Conteúdo, MDX e autoria

Os artigos serão conteúdo original em MDX, renderizado no servidor para HTML legível sem JavaScript. Cada um terá definição direta, aplicação prática, comparação com os outros documentos, perguntas úteis, data real e links para CONFAZ e portais oficiais. A autoria será Equipe Ávila Ops, sem inventar credenciais profissionais. Não haverá orientação tributária específica para uma empresa nem promessa de homologação fiscal.

Haverá um arquivo MDX significativo por página e subpágina. Artigos públicos terão arquivos individuais; rotas dinâmicas operacionais terão documentação por padrão de rota, sem gerar arquivos por registro de cliente. Os MDX internos ficam fora de `public/` e não terão endpoint de leitura pública. Um inventário e uma verificação automatizada cobrarão cobertura de todos os `page.tsx` e de todos os artigos públicos.

Os MDX públicos terão alternativa de leitura em texto por uma rota de conteúdo com lista explícita de documentos permitidos. Ela não poderá receber um caminho arbitrário do sistema de arquivos. A alternativa textual apontará a canonical HTML e não será listada como uma segunda página indexável no sitemap.

## SEO e buscas por IA

- Somente páginas públicas entram em uma lista explícita de indexação, com títulos, descrições, canonical absoluta e previews por página.
- Páginas protegidas, login, rastreio e APIs mantêm `noindex`, com cabeçalhos de robôs coerentes. Autenticação e autorização continuam sendo a proteção efetiva.
- O sitemap XML será gerado do catálogo público, usando apenas `https://tms.avilaops.com`, sem queries, aliases Render, rotas de login ou registros operacionais. `lastmod` só será usado com uma data real de revisão de conteúdo, nunca com o horário de cada build.
- O robots permitirá páginas públicas e bloqueará os prefixos operacionais e rastreio. Regras específicas de robôs, se necessárias, repetirão as restrições de áreas privadas.
- O llms.txt apresentará o produto e links para o conteúdo público, sem dados internos, contatos de clientes ou promessas de citação. MDX e llms.txt são complementos, não exigências do Google para IA.
- Dados estruturados: Organization/WebSite, WebApplication sem preço ou avaliação inventada, BreadcrumbList e BlogPosting nos artigos.
- Favicons e manifests terão a marca existente. As imagens de compartilhamento ficarão sob controle do TMS e terão textos legíveis e dimensões adequadas. O retorno real de conversão será medido.
- A validação testará HTML e cabeçalhos com Googlebot, Bingbot e robôs de busca de IA, sem desativar proteções gerais da zona Cloudflare que atendem outros sistemas.

## Analytics, consentimento e conversão

Criar ou reutilizar recursos exclusivos do TMS nas contas Google já acessíveis: propriedade GA4 em português, fuso America/Sao_Paulo e moeda BRL, fluxo web do domínio canônico e contêiner web GTM. Nenhum recurso pago será contratado. Se uma permissão de escrita falhar, registrar o erro e os passos necessários, sem declarar a integração ativa.

O GTM será o único carregador do GA4, evitando duplicação. Eventos explícitos: visualização pública, clique em Solicitar demonstração/contato, clique em Já sou cliente e leitura de artigo. Cliques de contato não serão apresentados como leads efetivamente gerados. Haverá prova de disparo e tentativa de confirmação de recebimento nas APIs/relatórios; publicação de tags e ingestão são estados distintos.

Os identificadores serão passados do servidor em variáveis de runtime validadas, adequadas ao container standalone, sem colocar credenciais Google no frontend ou no repositório. Tracking só nas páginas da lista pública, com URL sem query/hash, sem CPF/CNPJ, e-mail, códigos de rastreio, valores de frete, conteúdo de formulários ou identificadores operacionais. Desativar coleta automática que possa escapar desse escopo.

Consentimento básico: necessários sempre ativos; estatísticas opcionais desativadas até escolha explícita. Aceitar estatísticas e continuar somente com necessários terão acesso e destaque equivalentes. As preferências poderão ser revistas no rodapé. Nenhum script/request Google de analytics antes do aceite; revogação interrompe os eventos e remove apenas cookies de mensuração deste TMS. Não serão instaladas tags de publicidade ou consentimentos de publicidade predefinidos.

## Publicação e Search Console

O trabalho de código será isolado das alterações locais existentes. Reaproveitar os assets de marca relacionados sem sobrescrever ou publicar modificações alheias. Aplicar mudanças em revisão única, com testes relevantes, tipos, lint, prints e build no GitHub CI.

A publicação utilizará o serviço Render já autorizado. A imagem deve ser construída no GitHub CI e promovida ao Render por digest, ajustando a automação de deploy do TMS se necessário para não usar o destino SSH antigo. Não serão tocados os serviços Conta/Auth, nem serão feitas migrações de banco nesta tarefa.

Após a publicação e validação do XML e das canonicals, enviar `https://tms.avilaops.com/sitemap.xml` à propriedade existente `sc-domain:tms.avilaops.com` e confirmar sua presença. Envio/aceite, processamento, indexação e posicionamento serão relatados como resultados distintos.

## Critérios de aceite

- Landing anônima, Sobre, Blog, artigos e políticas acessíveis com HTML completo, sem quebrar o redirecionamento de usuários autenticados e o login existente.
- MDX cobrindo todos os padrões de página; documentos internos inacessíveis pela rota pública de conteúdo.
- Sitemap e robots válidos, llms.txt publicado, metadados e imagens canônicas coerentes, 404s desconhecidos sem indexação.
- Áreas privadas permanecem autenticadas e não aparecem no sitemap, nos documentos públicos ou na mensuração.
- Consentimento testado em aceitar, rejeitar, revogar e trocar de página; nenhum parâmetro pessoal ou dado operacional enviado ao Google.
- GA4 e GTM com recursos reais, estado da publicação e evidência de eventos apresentados sem afirmar conversão ainda não observada.
- Navegação e consentimento conferidos em 1440 px e 390 px, com teclado, sem erro de página ou rolagem horizontal.
- Testes executados exclusivamente em banco local de teste, nunca na base restaurada de produção. Build e publicação confirmados por CI e HTTP de produção.
- Sitemap enviado ao Search Console, com resposta da API registrada e pendências de processamento claramente separadas.

## Fontes iniciais verificadas

- Google • IA e sites: https://developers.google.com/search/docs/appearance/ai-features
- Google • sitemap: https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
- Google • Consent Mode: https://developers.google.com/tag-platform/security/guides/consent
- CONFAZ • MDF-e: https://www.confaz.fazenda.gov.br/legislacao/ajustes/2010/AJ_021_10
- CONFAZ • CT-e e CT-e OS: https://www.confaz.fazenda.gov.br/legislacao/ajustes/2007/AJ_009_07
- Portal Nacional da NF-e: https://www.nfe.fazenda.gov.br/portal/
- ANPD • Guia orientativo Cookies e Proteção de Dados Pessoais.

## Escolhas deixadas ao implementador

Composição visual exata, componentes reutilizáveis, organização dos arquivos, biblioteca MDX compatível com a versão fixada do Next, nomes internos dos eventos e método de validação de ingestão podem ser decididos durante o plano. Devem respeitar integralmente as rotas, a proteção operacional, o consentimento e os critérios acima.
