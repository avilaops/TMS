# Mello Transportes Rio Preto

Landing page comercial em React, TypeScript e Vite para consulta de cidades atendidas, prazos, frota, cotação rápida e solicitação de coleta pelo WhatsApp.

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

Não adicione depoimentos, números de entregas, clientes ou anos de mercado sem confirmação comercial.

## Comandos

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm run build
```

## Deploy GitHub Pages

O Vite está configurado com `base: "/Mello/"`.

O workflow `.github/workflows/deploy.yml` executa em push para `main` e por `workflow_dispatch`, usando Node.js 20, `npm ci`, lint, typecheck, build e `actions/deploy-pages`.

URL esperada:

```text
https://avilaops.github.io/Mello/
```

No GitHub, habilite Pages para publicar via GitHub Actions em `Settings > Pages`.
