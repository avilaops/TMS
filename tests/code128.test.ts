import { describe, expect, it } from "vitest";
import {
  FIM,
  INICIO_B,
  TOTAL_DE_PADROES,
  ZONA_DE_SILENCIO,
  barrasCode128B,
  cabeNoCode128B,
  code128B,
  digitoVerificador,
  padraoDe,
  valoresCode128B,
} from "../src/lib/code128";

/**
 * Code 128 subconjunto B, contra valores conhecidos.
 *
 * Os módulos esperados abaixo ("1" barra, "0" espaço) foram gerados por outra
 * implementação, a biblioteca jsbarcode (CODE128B), e copiados para cá: o teste
 * compara o desenho inteiro, não só a conta. Os dígitos verificadores de
 * "PJJ123C" e "Wikipedia" são os exemplos clássicos da literatura do código.
 */

const INICIO_B_MODULOS = "11010010000";
const FIM_MODULOS = "1100011101011";

const CONHECIDOS: [string, string][] = [
  [
    "1234567890-01",
    "1101001000010011100110110011100101100101110011001001110110111001001100111010011101101110111010011001110010110010011101100100110111001001110110010011100110100001100101100011101011",
  ],
  ["A-01-03", "1101001000010100011000100110111001001110110010011100110100110111001001110110011001011100111011000101100011101011"],
  [
    "Wikipedia",
    "11010010000111010001101000011010011000010010100001101001010011110010110010000100001001101000011010010010110000111100100101100011101011",
  ],
  ["PJJ123C", "1101001000011101110110101101110001011011100010011100110110011100101100101110010001000110111010001101100011101011"],
];

const paraModulos = (larguras: string) => Array.from(larguras, (largura, i) => (i % 2 === 0 ? "1" : "0").repeat(Number(largura))).join("");

describe("Code 128 B", () => {
  describe("tabela de padrões", () => {
    it("tem 107 símbolos: 103 de dado, 3 de início e o de fim", () => {
      expect(TOTAL_DE_PADROES).toBe(107);
      expect(INICIO_B).toBe(104);
      expect(FIM).toBe(106);
    });

    it("cada símbolo tem 3 barras e 3 espaços em 11 módulos; o fim tem uma barra a mais, em 13", () => {
      for (let valor = 0; valor < FIM; valor += 1) {
        const larguras = padraoDe(valor);
        expect(larguras, `valor ${valor}`).toMatch(/^[1-4]{6}$/);
        expect(Array.from(larguras).reduce((soma, l) => soma + Number(l), 0), `valor ${valor}`).toBe(11);
        // Propriedade do Code 128: a soma das barras de um símbolo é sempre par.
        const barras = Number(larguras[0]) + Number(larguras[2]) + Number(larguras[4]);
        expect(barras % 2, `valor ${valor}`).toBe(0);
      }
      expect(padraoDe(FIM)).toBe("2331112");
    });

    it("não repete padrão: cada desenho é de um símbolo só", () => {
      const todos = Array.from({ length: TOTAL_DE_PADROES }, (_, valor) => padraoDe(valor));
      expect(new Set(todos).size).toBe(TOTAL_DE_PADROES);
    });

    it("início B e fim são os da norma", () => {
      expect(paraModulos(padraoDe(INICIO_B))).toBe(INICIO_B_MODULOS);
      expect(paraModulos(padraoDe(FIM))).toBe(FIM_MODULOS);
    });
  });

  describe("dígito verificador", () => {
    const valoresDe = (texto: string) => Array.from(texto, (c) => c.charCodeAt(0) - 32);

    it("confere com os exemplos conhecidos", () => {
      // 104 + 55·1 + 73·2 + 75·3 + 73·4 + 80·5 + 69·6 + 68·7 + 73·8 + 65·9 = 3281; 3281 mod 103 = 88.
      expect(digitoVerificador(valoresDe("Wikipedia"))).toBe(88);
      // 104 + 48·1 + 42·2 + 42·3 + 17·4 + 18·5 + 19·6 + 35·7 = 879; 879 mod 103 = 55.
      expect(digitoVerificador(valoresDe("PJJ123C"))).toBe(55);
      // Sem caractere nenhum sobra só o início: 104 mod 103 = 1.
      expect(digitoVerificador([])).toBe(1);
    });

    it("a ordem dos caracteres muda o dígito: troca de posição é detectada", () => {
      expect(digitoVerificador(valoresDe("1234567890-01"))).not.toBe(digitoVerificador(valoresDe("1234567890-10")));
    });
  });

  describe("símbolo inteiro", () => {
    it("é início B, um valor por caractere (ASCII menos 32), o dígito verificador e o fim", () => {
      expect(valoresCode128B("A-01")).toEqual([104, 33, 13, 16, 17, digitoVerificador([33, 13, 16, 17]), 106]);
      expect(valoresCode128B("Wikipedia")?.slice(-2)).toEqual([88, 106]);
    });

    it.each(CONHECIDOS)("desenha %s igual à implementação de referência", (texto, esperado) => {
      expect(code128B(texto)).toBe(esperado);
    });

    it("tem 11 módulos por símbolo e 13 no fim, começa pelo início B e termina no fim", () => {
      for (const [texto] of CONHECIDOS) {
        const modulos = code128B(texto)!;
        // início + caracteres + verificador = texto.length + 2 símbolos de 11, mais o fim.
        expect(modulos, texto).toHaveLength((texto.length + 2) * 11 + 13);
        expect(modulos.startsWith(INICIO_B_MODULOS), texto).toBe(true);
        expect(modulos.endsWith(FIM_MODULOS), texto).toBe(true);
      }
    });

    it("recusa texto vazio e caractere fora do subconjunto B", () => {
      expect(cabeNoCode128B("A-01-03 ~")).toBe(true);
      for (const texto of ["", "posição", "A\n01", "A\t01", "€", "\u007f"]) {
        expect(cabeNoCode128B(texto), JSON.stringify(texto)).toBe(false);
        expect(valoresCode128B(texto), JSON.stringify(texto)).toBeNull();
        expect(code128B(texto), JSON.stringify(texto)).toBeNull();
        expect(barrasCode128B(texto), JSON.stringify(texto)).toBeNull();
      }
    });
  });

  describe("barras para o desenho", () => {
    it("junta módulos vizinhos numa barra só e reserva a zona de silêncio dos dois lados", () => {
      const texto = "1234567890-01";
      const modulos = code128B(texto)!;
      const { barras, largura } = barrasCode128B(texto)!;

      expect(ZONA_DE_SILENCIO).toBe(10);
      expect(largura).toBe(modulos.length + 20);
      // Três barras por símbolo, quatro no fim.
      expect(barras).toHaveLength((texto.length + 2) * 3 + 4);
      // O início B é 2-1-1-2-1-4: barra de 2, espaço de 1, barra de 1, espaço de 2, barra de 1.
      expect(barras.slice(0, 3)).toEqual([
        { x: 10, largura: 2 },
        { x: 13, largura: 1 },
        { x: 16, largura: 1 },
      ]);

      // Redesenhar a partir das barras devolve os mesmos módulos.
      const redesenhado = Array.from({ length: modulos.length }, () => "0");
      for (const barra of barras) {
        for (let i = 0; i < barra.largura; i += 1) redesenhado[barra.x - ZONA_DE_SILENCIO + i] = "1";
      }
      expect(redesenhado.join("")).toBe(modulos);
    });
  });
});
