# Correções da auditoria pública — 19/09/2026

## Entrega local

- Canonical, título, descrição e compartilhamento próprios em /cotacao e /rastreio.
- JSON-LD aponta para https://mellotransportesriopreto.com.br/.
- Nova imagem OG preview-whatsapp-v2.png; v1 também atualizada para não manter o domínio antigo no arquivo público.
- Cabeçalho e rodapé compartilhados, menu mobile, identidade laranja/preta nas páginas públicas.
- Logo do cabeçalho em WebP de 96 px (2.358 bytes), com alt; versão de 480 px para a página de marca.
- Quatro imagens geradas: Strada/van, VUC de baú, preparação de volumes e conferência de carga. Os cinco artigos receberam capas; cenas identificadas como ilustrativas.
- Nicolas confirmou nesta sessão que o VUC pode ser incluído e forneceu uma referência. Ele permanece na frota e no artigo correspondente.
- Grade dos quatro serviços em duas colunas no desktop e uma no celular; contraste dos textos de marca corrigido.
- Theme color público alinhado ao laranja.

## Verificação

- npm run build: aprovado, 52 páginas geradas.
- npm run typecheck: aprovado.
- ESLint dos arquivos alterados em home, blog, cotação, rastreio, SiteChrome e dados: aprovado.
- Playwright: home, cotação, rastreio, marca, frota, blog e artigo da frota em 1440 e 390 px; sem transbordamento horizontal e sem domínio antigo no HTML.
- Imagens conferidas após carregamento; capturas em output/playwright.
- Menu mobile aberto; formulário de cotação com retorno de sucesso e rastreio vazio testados com respostas simuladas no navegador. Nenhum pedido enviado à operação; backend de produção não validado nesta rodada.

## Limites

Alterações não publicadas. Rotas por fragmento (#/cidades, #/frota etc.) continuam como navegação da home, sem páginas SEO independentes. A migração dessas rotas não foi feita nesta entrega.

## Deploy concluído — 19/09/2026

Publicado diretamente no servidor applications, /opt/mello, pelo Docker Compose, substituindo somente app (--no-deps). Imagem mello-app:site-20260919, também marcada latest. Reversão preservada em mello-app:rollback-before-site-20260919. Banco mello-db permaneceu ativo sem migração.

Domínio público: 9 URLs do sitemap e todos os novos assets conferidos com HTTP 200; canonicals de cotação e rastreio corretos. Playwright em produção, viewport de 390 px: home, cotação e rastreio sem imagens quebradas nem transbordamento horizontal. Capturas em output/playwright/producao-*.png.


## Revisão mobile e páginas independentes — 19/09/2026

Home reduzida, cards curtos e 23 novas páginas públicas: sete seções, quatro serviços, três veículos e nove polos. Canonicals próprios e sitemap com 32 URLs. Links antigos por fragmento redirecionam para as seções novas. Navegação, busca por cidade e mapa sob demanda verificados no navegador.

Strada com capota alta fechada, van e VUC receberam imagens ilustrativas com a marca Mello. A Strada segue as novas referências enviadas pelo Nicolas. Imagens geradas não representam fotografias da frota real.

Formulário de coleta preservado em página própria, com seleção compacta de modalidade. Home conferida em 320, 390 e 1440 px; sem transbordamento horizontal. Nenhum pedido real enviado.

### Publicação da revisão mobile concluída

Imagem mello-app:mobile-20260919, digest sha256:337dc2502f136bb56c80fbaeb783316a8b0e8e9c126c9cacb967bf60e22a7ad7. Publicada em applications:/opt/mello, somente serviço app. Versão anterior preservada em mello-app:rollback-before-mobile-20260919. Banco permaneceu ativo.

Verificação no domínio público: 32 URLs com HTTP 200 e canonical correspondente; quatro novos assets com HTTP 200; rota de veículo inexistente retorna 404. Playwright em 390 px: home, Strada e coleta sem transbordamento, imagens quebradas ou erros de execução. Capturas published-mobile-* em output/playwright. ESLint e build de produção aprovados; rascunho local recuperado após recarga em teste isolado. Nenhuma solicitação real enviada.

## Refinamento de cards e botões

Cards compactos com ícones por serviço/polo, setas de navegação, bordas suaves e estados de interação. Frota em três colunas no desktop e linhas com miniaturas no celular. Botões primário/secundário diferenciados; CTA de contato escuro com alto contraste. Busca com foco evidente; FAQ com indicadores de expansão; movimento reduzido respeitado.

ESLint aprovado. Home sem transbordamento em 320, 390 e 1440 px. Playwright validou abertura de serviço e retorno, busca de cidade atendida e não cadastrada e expansão de FAQ. Capturas refined-* em output/playwright.

Publicado: mello-app:cards-20260919 (sha256:b18ebfcf264eb5e6f448625ca5277deaa7b185986ce89ae2ecdfe2859a590338). Reversão: mello-app:rollback-before-cards-20260919. Produção conferida: 32 URLs e canonicals corretos; assets disponíveis; menu e card de serviço testados em 390 px, sem transbordamento ou erros de execução. Screenshot published-cards-390.png.

## Coleta compacta publicada

Imagem collection-20260919; rollback rollback-before-collection-20260919. Cabeçalho e rodapé compactos, ícones limitados a 16 px e controles de 44 px. Etapas em seletor; dados opcionais, resumo e histórico recolhidos. Campos preservados ao avançar/voltar. Oito etapas verificadas em 320/390/1440 px, sem transbordamento ou erros de execução. ESLint e build aprovados. Em produção, primeira etapa a 390 px reduziu de 2507 para 1388 px de altura (45%); navegação conferida sem envio real.
