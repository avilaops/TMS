# TMS • CMS cortesia para transportadoras

O usuário pediu um módulo de site CMS gratuito para transportadoras clientes e orientou continuar a implementação. Esta frente soma-se ao site público/SEO já aprovado. As decisões técnicas abaixo são do implementador e limitam a primeira versão a uma cortesia viável na infraestrutura existente.

## Entrega

- Módulo Meu site no painel, com identidade, apresentação, Sobre, Serviços, regiões atendidas, contato e Blog.
- Um site por transportadora ativa, publicado inicialmente em `/transportadoras/<slug>`, com subpáginas Sobre, Serviços, Contato, Blog e artigos. Domínio próprio pode ser acrescentado depois; não haverá compra de domínio nem cobrança adicional automática.
- Edição de rascunho, prévia autenticada, publicação e retirada do ar. Salvar rascunho não altera a versão pública.
- Administrador e Comercial editam; Administrador publica/retira do ar; Diretoria consulta. Outros perfis não recebem acesso ao módulo.
- Só conteúdo explicitamente publicado entra em HTML, MDX público, metadados e sitemap. Rascunhos e artigos não selecionados para publicação nunca são serializados na resposta pública.
- Dados operacionais e financeiros não são conteúdo do site. O editor não aceita HTML, scripts ou MDX executável de terceiros.
- Rastreamento e acesso ao TMS são links para os fluxos existentes, preservando suas exigências de identidade/documento/código. Contato usa os dados públicos preenchidos e aprovados pela própria transportadora.
- A cortesia não cria mensalidade de CMS. A infraestrutura continua tendo os limites de seu plano; não será contratado recurso pago nesta implementação.

## Arquitetura e proteção

O CMS central Rust existente tem editor, temas e publicação, mas seus hosts não responderam durante a investigação. A primeira versão será um módulo enxuto no runtime do TMS, reaproveitando estilos e padrões de descoberta do site público, sem exigir sua recuperação.

Modelo `CarrierSite`, um para cada `Tenant`, com JSON de rascunho, JSON de publicação, data de publicação e revisão para concorrência. RLS usa o papel `tms_app`, como as outras tabelas. Mudança de rascunho/publicação exige revisão atual; uma aba antiga recebe conflito, sem sobrescrever silenciosamente outra edição.

A leitura pública busca somente o snapshot publicado de uma empresa ativa pelo slug. A aplicação não envia campos privados do Tenant. Empresa inativa, site sem publicação e artigo fora do snapshot recebem 404. URLs desconhecidas e caminhos extras também recebem 404.

O snapshot público exclui artigos não publicados e qualquer estado interno do editor. Campos de texto são escapados pelo React; cores, e-mail e WhatsApp são validados. Marca usa logo já validado da empresa, com fallback da plataforma. SEO, canonical, sitemap e MDX refletem somente o snapshot. Analytics do produto não roda nos sites das transportadoras.

O schema será aplicado por SQL aditivo versionado, após backup da base e testes locais/CI. Não usar `db push` contra a base de produção. Não alterar cobrança SaaS, dados existentes nem Auth.

## Aceite

- Duas empresas não conseguem ler, alterar ou publicar o site uma da outra, inclusive chamando a API diretamente.
- Comercial salva rascunho e não publica; Administrador publica; Diretoria só consulta.
- Rascunho novo não aparece no site já publicado, e artigo não publicado não vaza em HTML/JSON/MDX.
- Concorrência retorna 409, publicação exige dados mínimos, e retirada do ar mantém o rascunho.
- Sites ativos publicados e suas subpáginas entram no sitemap com data real de publicação; inativos e rascunhos não entram.
- Conteúdo publicado é responsivo, acessível, com marca própria, contato e navegação sem erros.
- Testes usam somente PostgreSQL local de teste; a publicação depende de verificação por CI e produção.
