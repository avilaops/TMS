# Gerador de PDF: Regras de Frete (Mello Transportes Rio Preto)

Gera um PDF com a tabela de tarifas, regras gerais de frete, frota por polo e a
lista completa de cidades atendidas (lida direto de `tabela_frete_serilon.csv`).

## Uso

```bash
npm install
npm run generate
```

O PDF é salvo em `output/Mello-Transportes-Regras-de-Frete.pdf`.

## Estrutura

- `src/data.ts` - dados da empresa, regras de frete e leitura/agrupamento do CSV de cidades.
- `src/template.ts` - monta o HTML/CSS do documento.
- `src/generate.ts` - abre o HTML com Puppeteer e exporta o PDF (A4, com rodapé numerado).

## Atualizando o conteúdo

- Para mudar tarifas, prazos ou dados da empresa: edite as constantes em `src/data.ts`.
- Para mudar cidades atendidas: edite `tabela_frete_serilon.csv` na raiz do projeto (o script lê esse arquivo automaticamente).
- Para mudar o layout/estilo: edite `src/template.ts`.
