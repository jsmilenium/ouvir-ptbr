// Números por extenso em pt-BR: cardinal (com gênero), ordinal, dígitos, romanos.
// Sem dependências. Inteiros em bigint para não perder precisão em valores grandes.

const UNIDADES = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez",
  "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos",
  "oitocentos", "novecentos"];
const ESCALAS: Array<[string, string]> = [["", ""], ["mil", "mil"], ["milhão", "milhões"], ["bilhão", "bilhões"],
  ["trilhão", "trilhões"], ["quatrilhão", "quatrilhões"]];

function feminino(palavra: string): string {
  if (palavra === "um") return "uma";
  if (palavra === "dois") return "duas";
  if (palavra.endsWith("entos")) return palavra.slice(0, -2) + "as"; // duzentos -> duzentas
  return palavra;
}

/** 0..999 por extenso. */
function abaixoDeMil(n: number, fem: boolean): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const partes: string[] = [];
  const c = Math.floor(n / 100);
  const resto = n % 100;
  if (c > 0) partes.push(fem ? feminino(CENTENAS[c]) : CENTENAS[c]);
  if (resto > 0) {
    if (resto < 20) partes.push(fem ? feminino(UNIDADES[resto]) : UNIDADES[resto]);
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u ? `${DEZENAS[d]} e ${fem ? feminino(UNIDADES[u]) : UNIDADES[u]}` : DEZENAS[d]);
    }
  }
  return partes.join(" e ");
}

/** Cardinal por extenso. `fem` flexiona um/dois/centenas nas unidades e nos milhares (milhões é masculino).
 *  Regra do "e" entre grupos: só antes do ÚLTIMO grupo não nulo, quando ele é < 100 ou centena redonda
 *  (mil e um, mil e quinhentos, um bilhão e quinhentos milhões; mas mil duzentos e cinquenta). */
export function cardinal(valor: bigint | number, fem = false): string {
  let n = BigInt(valor);
  if (n < 0n) return "menos " + cardinal(-n, fem);
  if (n === 0n) return "zero";
  const grupos: number[] = [];
  while (n > 0n) {
    grupos.push(Number(n % 1000n));
    n /= 1000n;
  }
  if (grupos.length > ESCALAS.length) throw new RangeError("número grande demais");
  const pedacos: Array<{ texto: string; valor: number }> = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (g === 0) continue;
    let texto: string;
    if (i === 0) texto = abaixoDeMil(g, fem);
    else if (i === 1) texto = g === 1 ? "mil" : `${abaixoDeMil(g, fem)} mil`;
    else texto = `${abaixoDeMil(g, false)} ${g === 1 ? ESCALAS[i][0] : ESCALAS[i][1]}`;
    pedacos.push({ texto, valor: g });
  }
  let saida = pedacos[0].texto;
  for (let k = 1; k < pedacos.length; k++) {
    const ultimo = k === pedacos.length - 1;
    const v = pedacos[k].valor;
    saida += ultimo && (v < 100 || v % 100 === 0) ? ` e ${pedacos[k].texto}` : ` ${pedacos[k].texto}`;
  }
  return saida;
}

const ORD_UNID = ["", "primeiro", "segundo", "terceiro", "quarto", "quinto", "sexto", "sétimo", "oitavo", "nono"];
const ORD_DEZ = ["", "décimo", "vigésimo", "trigésimo", "quadragésimo", "quinquagésimo", "sexagésimo",
  "septuagésimo", "octogésimo", "nonagésimo"];
const ORD_CENT = ["", "centésimo", "ducentésimo", "trecentésimo", "quadringentésimo", "quingentésimo",
  "sexcentésimo", "septingentésimo", "octingentésimo", "noningentésimo"];

/** Ordinal por extenso (1..9999). */
export function ordinal(n: number, fem = false): string {
  if (!Number.isInteger(n) || n < 1 || n > 9999) throw new RangeError("ordinal fora de 1..9999");
  const partes: string[] = [];
  const mil = Math.floor(n / 1000);
  if (mil > 0) partes.push(mil === 1 ? "milésimo" : `${cardinal(mil)} milésimo`);
  const c = Math.floor((n % 1000) / 100);
  const d = Math.floor((n % 100) / 10);
  const u = n % 10;
  if (c) partes.push(ORD_CENT[c]);
  if (d) partes.push(ORD_DEZ[d]);
  if (u) partes.push(ORD_UNID[u]);
  const texto = partes.join(" ");
  return fem ? texto.replace(/o\b/gu, "a") : texto;
}

/** Leitura dígito a dígito ("007" -> "zero zero sete"). Letras viram o nome da letra (CNPJ alfanumérico). */
const NOME_LETRA: Record<string, string> = {
  A: "a", B: "bê", C: "cê", D: "dê", E: "é", F: "éfe", G: "gê", H: "agá", I: "i", J: "jota", K: "cá", L: "éle",
  M: "ême", N: "ene", O: "ó", P: "pê", Q: "quê", R: "erre", S: "esse", T: "tê", U: "u", V: "vê", W: "dáblio",
  X: "xis", Y: "ípsilon", Z: "zê",
};
export function nomeDaLetra(letra: string): string {
  return NOME_LETRA[letra.toUpperCase()] ?? letra;
}
export function digitos(s: string): string {
  const saida: string[] = [];
  for (const ch of s) {
    if (ch >= "0" && ch <= "9") saida.push(UNIDADES[Number(ch)]);
    else if (/[A-Za-z]/u.test(ch)) saida.push(nomeDaLetra(ch));
  }
  return saida.join(" ");
}

/** Parte decimal: "75" -> "setenta e cinco"; "05" -> "zero cinco" (zeros à esquerda são lidos). */
export function parteDecimal(frac: string): string {
  const zeros = frac.match(/^0+/u)?.[0].length ?? 0;
  if (zeros === frac.length) return digitos(frac);
  const resto = frac.slice(zeros);
  const z = Array(zeros).fill("zero");
  return [...z, cardinal(BigInt(resto))].join(" ");
}

/** Romano canônico (I..MMMCMXCIX) para número; null se não for romano válido ("CIVIL", "MIXX"). */
export function romanoParaNumero(s: string): number | null {
  if (!/^[IVXLCDM]+$/u.test(s)) return null;
  const v: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const a = v[s[i]];
    const b = i + 1 < s.length ? v[s[i + 1]] : 0;
    total += a < b ? -a : a;
  }
  if (total < 1 || total > 3999) return null;
  return numeroParaRomano(total) === s ? total : null;
}
function numeroParaRomano(n: number): string {
  const tabela: Array<[number, string]> = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
  let s = "";
  for (const [valor, letras] of tabela) while (n >= valor) { s += letras; n -= valor; }
  return s;
}

/** Palavras que este módulo pode produzir (lista branca usada pelos testes de integridade). */
export const VOCABULARIO_NUMEROS: ReadonlySet<string> = new Set([
  ...UNIDADES, ...DEZENAS.filter(Boolean), ...CENTENAS.filter(Boolean), "cem", "e", "menos",
  ...UNIDADES.map(feminino), ...CENTENAS.filter(Boolean).map(feminino),
  ...ESCALAS.flat().filter(Boolean),
  ...ORD_UNID.filter(Boolean), ...ORD_DEZ.filter(Boolean), ...ORD_CENT.filter(Boolean), "milésimo",
  ...[...ORD_UNID, ...ORD_DEZ, ...ORD_CENT, "milésimo"].filter(Boolean).map((p) => p.replace(/o$/u, "a")),
  ...Object.values(NOME_LETRA),
]);
