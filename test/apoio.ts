// Apoio dos testes. Escrito à parte do código de produção de propósito: o leitor inverso de números
// e o mapa de letras NÃO reaproveitam src/, senão um erro no código passaria igual nos dois lados.
import { readFileSync } from "node:fs";

export interface ItemCorpus {
  cat: string;
  texto: string;
  aceitas: string[];
}

export function carregarCorpus(): ItemCorpus[] {
  const bruto = JSON.parse(readFileSync(new URL("../corpus/corpus.json", import.meta.url), "utf8"));
  return bruto.itens as ItemCorpus[];
}

/** Forma de comparação: minúsculas, pontuação vira espaço, espaços colapsados. */
export function paraComparar(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const VALOR: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, três: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9,
  dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17,
  dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70,
  oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300,
  quatrocentos: 400, quatrocentas: 400, quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600,
  setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
};
const ESCALA: Record<string, bigint> = {
  mil: 1000n, milhão: 1_000_000n, milhões: 1_000_000n, bilhão: 1_000_000_000n, bilhões: 1_000_000_000n,
  trilhão: 1_000_000_000_000n, trilhões: 1_000_000_000_000n,
};

/** Leitor inverso de cardinal ("mil duzentos e cinquenta" -> 1250n). null se aparecer palavra estranha. */
export function palavrasParaNumero(palavras: string[]): bigint | null {
  let total = 0n;
  let grupo = 0n;
  let viu = false;
  for (const p of palavras) {
    if (p === "e") continue;
    if (p in VALOR) { grupo += BigInt(VALOR[p]); viu = true; continue; }
    if (p in ESCALA) {
      const e = ESCALA[p];
      if (e === 1000n) total += (grupo === 0n ? 1n : grupo) * e;
      else total += grupo * e;
      grupo = 0n;
      viu = true;
      continue;
    }
    return null;
  }
  return viu ? total + grupo : null;
}

const DIGITO: Record<string, string> = {
  zero: "0", um: "1", dois: "2", três: "3", quatro: "4", cinco: "5", seis: "6", sete: "7", oito: "8", nove: "9",
};
const LETRA: Record<string, string> = {
  a: "A", bê: "B", cê: "C", dê: "D", é: "E", éfe: "F", gê: "G", agá: "H", i: "I", jota: "J", cá: "K", éle: "L",
  ême: "M", ene: "N", ó: "O", pê: "P", quê: "Q", erre: "R", esse: "S", tê: "T", u: "U", vê: "V", dáblio: "W",
  xis: "X", ípsilon: "Y", zê: "Z",
};

/** Lê de volta uma leitura dígito a dígito ("um dois, a bê") -> "12AB". Palavras fora do mapa são ignoradas
 *  só ANTES do primeiro dígito (a palavra-gatilho do autor, como "CPF"); depois disso, qualquer estranha = null. */
export function lerDigitos(falado: string): string | null {
  const palavras = falado.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  let saida = "";
  let comecou = false;
  for (const p of palavras) {
    const d = DIGITO[p] ?? LETRA[p];
    if (d !== undefined) { saida += d; comecou = true; continue; }
    if (comecou) return null;
  }
  return saida;
}

/** Valor em centavos lido do ORIGINAL, por regra independente ("R$ 1,5 bi" -> 150000000000n). */
export function centavosDoOriginal(original: string): bigint {
  const m = /([\d.]+)(?:,(\d{1,2}))?(?:\s+(\S+))?/u.exec(original.replace(/^\D+/u, ""));
  if (!m) throw new Error("sem número: " + original);
  const inteiro = BigInt(m[1].replace(/\./gu, ""));
  const frac = m[2] ?? "";
  const escalas: Record<string, bigint> = {
    mil: 1000n, milhão: 1_000_000n, milhões: 1_000_000n, mi: 1_000_000n, bilhão: 1_000_000_000n,
    bilhões: 1_000_000_000n, bi: 1_000_000_000n,
  };
  const escala = m[3] ? escalas[m[3]] : undefined;
  if (escala) {
    const base = 10n ** BigInt(frac.length);
    return ((inteiro * base + BigInt(frac || "0")) * escala * 100n) / base;
  }
  return inteiro * 100n + BigInt((frac || "0").padEnd(2, "0"));
}

/** Valor em centavos lido do FALADO ("mil reais e dez centavos" -> 100010n). */
export function centavosDoFalado(falado: string): bigint | null {
  const p = falado.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  const moeda = p.findIndex((x) => /^(real|reais|dólar|dólares|euro|euros)$/u.test(x));
  const centavo = p.findIndex((x) => x === "centavo" || x === "centavos");
  let total = 0n;
  if (moeda >= 0) {
    const antes = p.slice(0, moeda).filter((x) => x !== "de");
    const v = palavrasParaNumero(antes);
    if (v === null) return null;
    total += v * 100n;
  }
  if (centavo >= 0) {
    const ini = moeda >= 0 ? moeda + 1 : 0;
    const v = palavrasParaNumero(p.slice(ini, centavo).filter((x, i) => !(i === 0 && x === "e")));
    if (v === null) return null;
    total += v;
  }
  return moeda < 0 && centavo < 0 ? null : total;
}
