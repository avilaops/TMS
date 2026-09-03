# Capas das matérias

As capas são geradas pelo fluxo `Mello - Blog automático` no n8n e chegam
anexadas no e-mail de revisão, já com o nome do arquivo certo.

Para publicar uma matéria com capa: salve o PNG anexo aqui com o nome que ele
já tem, cole o bloco em `src/content/blog.ts` e commite. O bloco já vem com
`coverImage` e `coverImageAlt` preenchidos.

Matéria sem capa continua funcionando: o índice e a página caem no layout
tipográfico e o OpenGraph usa `/preview-whatsapp-v1.png`.
