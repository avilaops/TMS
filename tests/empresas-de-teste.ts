// As duas empresas (tenants) que os testes usam. Ids fixos para o
// vitest.config.ts e as suites falarem da mesma coisa sem consultar o banco.
//
// A PADRAO e onde cai toda consulta de teste que nao diz empresa
// (TMS_TENANT_TESTE): os testes que ja existiam continuam valendo como estao.
// A OUTRA existe para provar o isolamento.
export const EMPRESA_PADRAO = {
  id: "11111111-1111-4111-8111-111111111111",
  slug: "teste-padrao",
  name: "Transportadora de teste",
};

export const EMPRESA_OUTRA = {
  id: "22222222-2222-4222-8222-222222222222",
  slug: "teste-outra",
  name: "Outra transportadora de teste",
};
