export interface BrasilApiCnpjResponse {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  situacao_cadastral: number;
  descricao_situacao_cadastral: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  ddd_telefone_1: string;
  ddd_telefone_2: string;
  email: string;
  qsa: any[];
}

/**
 * Busca dados da empresa a partir do CNPJ utilizando a Brasil API.
 * @param cnpj O CNPJ apenas com números.
 * @returns Os dados da empresa ou null caso não seja encontrada.
 */
export async function getCompanyByCnpj(cnpj: string): Promise<BrasilApiCnpjResponse | null> {
  const cleanCnpj = cnpj.replace(/\D/g, '');
  
  if (cleanCnpj.length !== 14) {
    throw new Error('CNPJ inválido');
  }

  try {
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleanCnpj}`);
    
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error('Erro ao buscar CNPJ na Brasil API');
    }

    const data: BrasilApiCnpjResponse = await response.json();
    return data;
  } catch (error) {
    console.error('Brasil API CNPJ Fetch Error:', error);
    throw error;
  }
}
