import { createHash } from "node:crypto";
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
 * Os dados são os da empresa cadastrada em Empresa → Fiscal (decisão do dono
 * do sistema, 12/10/2026): o CNPJ e o telefone do emitente, mais o nome da
 * pessoa de contato e o e-mail da mesma tela. Faltando qualquer um, ou com
 * valor fora do formato do esquema, o grupo NÃO é montado e a conferência
 * avisa que a UF pode rejeitar. Nada é inventado.
 *
 * CÓDIGO DE SEGURANÇA (`idCSRT` e `hashCSRT`): opcional. Quando o fisco fornece
 * o CSRT, ele entra pelas variáveis `RESPTEC_CSRT_ID` e
 * `RESPTEC_CSRT`, e os dois campos fecham o grupo. A conta do hash é a do MOC
 * do CT-e 4.00 (Anexo I, campo 394) e do MOC do MDF-e 3.00b (Anexo I, campo
 * 170), com o mesmo texto: "O hashCSRT é o resultado das funções SHA-1 e base64
 * do token CSRT fornecido pelo fisco + chave de acesso do DF-e" (28 letras, que
 * o esquema representa como 20 bytes em `base64Binary`). As regras que exigem
 * os campos (CT-e G211, rejeição 868; MDF-e F122, rejeição 721) são
 * facultativas e estão como "implementação futura" nos dois manuais: sem as
 * variáveis, o grupo vai sem os dois campos.
 *
 * O CSRT é segredo: não vai para o XML, para a tela nem para o log. Só o hash
 * sai daqui, e quem o calcula é uma função que guarda o segredo dentro dela (o
 * objeto do responsável técnico pode ser impresso ou virar JSON sem o expor).
 */

export type CodigoDeSeguranca = {
  /** `idCSRT`: o identificador do CSRT, com 3 dígitos. */
  id: string;
  /** `hashCSRT` para a chave de acesso do documento. */
  hash: (chave: string) => string;
};

export type ResponsavelTecnico = {
  /** CNPJ da empresa, 14 posições, sem pontuação. */
  cnpj: string;
  /** Nome da pessoa de contato, de 2 a 60 letras. */
  contato: string;
  email: string;
  /** DDD + número, de 7 a 12 dígitos. */
  telefone: string;
  /** O código de segurança, quando o servidor o tem. Ausente: o grupo vai sem `idCSRT` e `hashCSRT`. */
  csrt?: CodigoDeSeguranca;
};

/** O que o cadastro da empresa (Empresa → Fiscal) dá ao responsável técnico. */
export type EmpresaDoResponsavelTecnico = { cnpj: string; contato?: string | null; email?: string | null; telefone?: string | null };

/** As duas variáveis, opcionais, do código de segurança: valem juntas ou nenhuma vale. */
export const VARIAVEIS_DO_CSRT = ["RESPTEC_CSRT_ID", "RESPTEC_CSRT"] as const;

/** A rejeição de cada documento para a falta do grupo: 867 no CT-e (regra G209), 720 no MDF-e (regra F120). */
export const REJEICAO_SEM_RESPONSAVEL_TECNICO = { cte: 867, mdfe: 720 } as const;

/** O aviso da conferência quando o cadastro da empresa não fecha o grupo: não impede a emissão. */
export const semResponsavelTecnico = (documento: keyof typeof REJEICAO_SEM_RESPONSAVEL_TECNICO) =>
  `Faltam o contato, o e-mail ou o telefone da empresa em Empresa → Fiscal: o documento vai sem o responsável técnico (infRespTec), e a SEFAZ de algumas UF rejeita (${REJEICAO_SEM_RESPONSAVEL_TECNICO[documento]}).`;

type Ambiente = Record<string, string | undefined>;

/** `hashCSRT`: Base64 do SHA-1 de (CSRT + chave de acesso), como os dois MOC definem. */
export const hashDoCsrt = (csrt: string, chave: string) => createHash("sha1").update(`${csrt}${chave}`, "utf8").digest("base64");

/**
 * O código de segurança configurado, ou `undefined` quando falta uma das duas
 * variáveis ou o identificador não é um número de até 3 dígitos (o esquema
 * pede exatamente 3: `7` vira `007`).
 */
export function codigoDeSeguranca(ambiente: Ambiente = process.env): CodigoDeSeguranca | undefined {
  const id = (ambiente.RESPTEC_CSRT_ID ?? "").trim();
  const csrt = (ambiente.RESPTEC_CSRT ?? "").trim();
  if (!/^[0-9]{1,3}$/.test(id) || csrt === "") return undefined;
  return { id: id.padStart(3, "0"), hash: (chave) => hashDoCsrt(csrt, chave) };
}

/**
 * O responsável técnico tirado do cadastro da empresa, ou `null` quando não há
 * empresa, falta algum dado ou algum valor não cabe no esquema (`TRespTec`:
 * CNPJ válido, contato de 2 a 60 letras, e-mail de até 60 letras, telefone de
 * 7 a 12 dígitos). O código de segurança continua vindo do servidor.
 */
export function responsavelTecnico(empresa: EmpresaDoResponsavelTecnico | null | undefined, ambiente: Ambiente = process.env): ResponsavelTecnico | null {
  if (!empresa) return null;
  const cnpj = limparCnpj(empresa.cnpj);
  const contato = textoDoXml(empresa.contato, 60);
  const email = (empresa.email ?? "").trim();
  const telefone = digitos(empresa.telefone);
  if (!cnpjValido(cnpj)) return null;
  if (contato.length < 2) return null;
  if (email.length > 60 || !/^[^@\s]+@[^.\s]+\.\S+$/.test(email)) return null;
  if (!/^[0-9]{7,12}$/.test(telefone)) return null;
  const csrt = codigoDeSeguranca(ambiente);
  return { cnpj, contato, email, telefone, ...(csrt && { csrt }) };
}

/**
 * O grupo `infRespTec`, ou nada quando a empresa não tem os dados. `chave` é a
 * chave de acesso do documento em que o grupo vai: o `hashCSRT` é dela.
 */
export function responsavelTecnicoDoXml(responsavel: ResponsavelTecnico | null | undefined, chave: string): string {
  if (!responsavel) return "";
  const seguranca = responsavel.csrt ? tag("idCSRT", responsavel.csrt.id) + tag("hashCSRT", responsavel.csrt.hash(chave)) : "";
  return grupo("infRespTec", tag("CNPJ", responsavel.cnpj) + tag("xContato", responsavel.contato) + tag("email", responsavel.email) + tag("fone", responsavel.telefone) + seguranca);
}
