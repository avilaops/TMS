import { cnpjValido, limparCnpj } from "@/lib/cte";
import { digitos, grupo, tag, textoDoXml } from "@/lib/cte/texto";

/**
 * O responsável técnico (`infRespTec`): a empresa que desenvolve o sistema
 * emissor. É o mesmo grupo (tipo `TRespTec`) no CT-e 4.00 e no MDF-e 3.00.
 *
 * O grupo é opcional no esquema, mas a UF pode exigi-lo: MOC do CT-e 4.00,
 * Anexo I, regra G209 ("Não informado o grupo de informações do responsável
 * técnico", rejeição 867, "implementação a critério da UF"), e a regra
 * equivalente do MOC do MDF-e. Por isso o grupo vai sempre que o servidor tem
 * os dados.
 *
 * Os dados são da plataforma (quem desenvolve o TMS), não de cada
 * transportadora: vêm de variáveis de ambiente (`.env.example`). Faltando
 * qualquer uma, ou com valor fora do formato do esquema, o grupo NÃO é montado
 * e a conferência avisa que a UF pode rejeitar. Nada é inventado.
 *
 * O que não vai: `idCSRT` e `hashCSRT` (o código de segurança do responsável
 * técnico). A regra G211 do MOC é "implementação futura", e o hash depende de
 * um token que cada SEFAZ fornece.
 */

export type ResponsavelTecnico = {
  /** CNPJ da desenvolvedora, 14 posições, sem pontuação. */
  cnpj: string;
  /** Nome da pessoa de contato, de 2 a 60 letras. */
  contato: string;
  email: string;
  /** DDD + número, de 7 a 12 dígitos. */
  telefone: string;
};

export const VARIAVEIS_DO_RESPONSAVEL_TECNICO = ["RESPTEC_CNPJ", "RESPTEC_CONTATO", "RESPTEC_EMAIL", "RESPTEC_FONE"] as const;

/** A rejeição de cada documento para a falta do grupo: 867 no CT-e (regra G209), 720 no MDF-e (regra F120). */
export const REJEICAO_SEM_RESPONSAVEL_TECNICO = { cte: 867, mdfe: 720 } as const;

/** O aviso da conferência quando o servidor não tem os dados: não impede a emissão. */
export const semResponsavelTecnico = (documento: keyof typeof REJEICAO_SEM_RESPONSAVEL_TECNICO) =>
  `O servidor não tem os dados do responsável técnico (variáveis RESPTEC_*): o documento vai sem o grupo infRespTec, e a SEFAZ de algumas UF rejeita (${REJEICAO_SEM_RESPONSAVEL_TECNICO[documento]}). Avise o suporte do sistema.`;

type Ambiente = Record<string, string | undefined>;

/**
 * O responsável técnico configurado no servidor, ou `null` quando falta alguma
 * variável ou algum valor não cabe no esquema (`TRespTec`: CNPJ válido, contato
 * de 2 a 60 letras, e-mail de até 60 letras, telefone de 7 a 12 dígitos).
 */
export function responsavelTecnico(ambiente: Ambiente = process.env): ResponsavelTecnico | null {
  const cnpj = limparCnpj(ambiente.RESPTEC_CNPJ ?? "");
  const contato = textoDoXml(ambiente.RESPTEC_CONTATO, 60);
  const email = (ambiente.RESPTEC_EMAIL ?? "").trim();
  const telefone = digitos(ambiente.RESPTEC_FONE);
  if (!cnpjValido(cnpj)) return null;
  if (contato.length < 2) return null;
  if (email.length > 60 || !/^[^@\s]+@[^.\s]+\.\S+$/.test(email)) return null;
  if (!/^[0-9]{7,12}$/.test(telefone)) return null;
  return { cnpj, contato, email, telefone };
}

/** O grupo `infRespTec`, ou nada quando o servidor não tem os dados. */
export function responsavelTecnicoDoXml(responsavel: ResponsavelTecnico | null | undefined): string {
  if (!responsavel) return "";
  return grupo("infRespTec", tag("CNPJ", responsavel.cnpj) + tag("xContato", responsavel.contato) + tag("email", responsavel.email) + tag("fone", responsavel.telefone));
}
