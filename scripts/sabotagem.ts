// Prova de que os testes enxergam o defeito: cada mutante é aplicado numa CÓPIA do projeto e tem de deixar
// vermelho o teste esperado. Uso: node scripts/sabotagem.ts
// Regras: a árvore limpa roda primeiro e tem de passar; mutante que não compila é INCONCLUSIVO (não conta como pego);
// o trecho a trocar tem de existir exatamente 1 vez (senão o próprio script está errado).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

interface Mutante { nome: string; arquivo: string; de: string; para: string; testeQueFalha: string }

const MUTANTES: Mutante[] = [
  { nome: "apaga a 1ª palavra de todo trecho do autor", arquivo: "src/normalizar.ts",
    de: "falado: original, regra: null", para: "falado: original.replace(/^\\s*\\S+/u, \"\"), regra: null",
    testeQueFalha: "fora dos trechos com regra" },
  { nome: "engole a palavra \"não\"", arquivo: "src/normalizar.ts",
    de: "falado: original, regra: null", para: "falado: original.replace(/não/u, \"\"), regra: null",
    testeQueFalha: "fora dos trechos com regra" },
  { nome: "troca a ordem dos trechos na saída", arquivo: "src/normalizar.ts",
    de: "return { falado: trechos.map((t) => t.falado).join(\"\"), trechos };",
    para: "return { falado: trechos.map((t) => t.falado).reverse().join(\"\"), trechos };",
    testeQueFalha: "fora dos trechos com regra" },
  { nome: "lê CPF como quantia", arquivo: "src/normalizar.ts",
    de: "    nome: \"cpf\",\n    re: new RegExp(`(?<![${N}])\\\\d{3}\\\\.\\\\d{3}\\\\.\\\\d{3}-\\\\d{2}(?![${N}])`, \"yu\"),\n    aplicar: (m) => ({ falado: grupos(m[0]) }),",
    para: "    nome: \"cpf\",\n    re: new RegExp(`(?<![${N}])\\\\d{3}\\\\.\\\\d{3}\\\\.\\\\d{3}-\\\\d{2}(?![${N}])`, \"yu\"),\n    aplicar: (m) => ({ falado: cardinal(BigInt(m[0].replace(/\\D/gu, \"\"))) }),",
    testeQueFalha: "documentos: os dígitos falados" },
  { nome: "\"0,5\" vira \"cinco\" (vírgula some)", arquivo: "src/normalizar.ts",
    de: "return frac ? `${base} vírgula ${parteDecimal(frac)}` : base;",
    para: "return frac ? cardinal(BigInt(frac)) : base;",
    testeQueFalha: "[saude] Tomar 0,5 mg" },
  { nome: "\"art. 10\" lido como ordinal", arquivo: "src/normalizar.ts",
    de: "const num = n <= 9 ? ordinal(n) : cardinal(n);", para: "const num = n <= 99 ? ordinal(n) : cardinal(n);",
    testeQueFalha: "Conforme o art. 10" },
  { nome: "escala do dinheiro mil vezes menor (milhão vira mil)", arquivo: "src/normalizar.ts",
    de: "* ESCALA_DINHEIRO[m[4]];", para: "* ESCALA_DINHEIRO[m[4]] / 1000n;",
    testeQueFalha: "dinheiro: o valor falado" },
  { nome: "perde o último dígito do documento", arquivo: "src/normalizar.ts",
    de: "aplicar: (m) => ({ falado: `${m[1]}${m[2]}${grupos(m[3])}` }),",
    para: "aplicar: (m) => ({ falado: `${m[1]}${m[2]}${grupos(m[3].slice(0, -1))}` }),",
    testeQueFalha: "documentos: os dígitos falados" },
  { nome: "trechos sobrepostos (trecho declara começar 1 antes)", arquivo: "src/normalizar.ts",
    de: "          inicio: i, fim: i + m[0].length, original: m[0], falado: saida.falado, regra: regra.nome,",
    para: "          inicio: Math.max(0, i - 1), fim: i + m[0].length, original: m[0], falado: saida.falado, regra: regra.nome,",
    testeQueFalha: "reconstrução" },
  { nome: "desliga a regra da Bíblia", arquivo: "src/normalizar.ts",
    de: "      if (!nome) return null;", para: "      return null;",
    testeQueFalha: "[biblia]" },
  { nome: "insere palavra fora da lista branca", arquivo: "src/normalizar.ts",
    de: "const hs = `${cardinal(h, true)} ${h === 1 || h === 0 ? \"hora\" : \"horas\"}`;",
    para: "const hs = `${cardinal(h, true)} ${h === 1 || h === 0 ? \"hora\" : \"horinhas\"}`;",
    testeQueFalha: "lista branca" },
  { nome: "\"mil\" vira \"um mil\"", arquivo: "src/numeros.ts",
    de: "else if (i === 1) texto = g === 1 ? \"mil\" :", para: "else if (i === 1) texto = g === 1 ? \"um mil\" :",
    testeQueFalha: "[dinheiro] O boleto" },
  { nome: "concordância desligada (21 pessoas = vinte e um)", arquivo: "src/normalizar.ts",
    de: "  if (!p || PALAVRAS_CURTAS.has(p) || NAO_SUBSTANTIVO.has(p)) return false;", para: "  return false;",
    testeQueFalha: "São 21 pessoas" },
  { nome: "INSTRUMENTO: comparador que aceita tudo", arquivo: "test/apoio.ts",
    de: "return s.toLowerCase().replace(/[^\\p{L}\\p{N}]+/gu, \" \").trim();", para: "return \"\";",
    testeQueFalha: "controle: o comparador reprova" },
  { nome: "INSTRUMENTO: corpus encolhe (item apagado)", arquivo: "corpus/corpus.json",
    de: "  {\n   \"cat\": \"negativo\",\n   \"texto\": \"Fim.\",\n   \"aceitas\": [\n    \"Fim.\"\n   ]\n  },\n", para: "",
    testeQueFalha: "corpus: tamanho fixado" },
];

const RAIZ = join(import.meta.dirname, "..");
const COPIA = join(RAIZ, ".tmp", "sabotagem");

function preparaCopia(): void {
  rmSync(COPIA, { recursive: true, force: true });
  mkdirSync(COPIA, { recursive: true });
  for (const d of ["src", "test", "corpus"]) cpSync(join(RAIZ, d), join(COPIA, d), { recursive: true });
}

function rodaTestes(): { codigo: number; saida: string } {
  const r = spawnSync(process.execPath, ["--test", "test/*.test.ts"], { cwd: COPIA, encoding: "utf8" });
  return { codigo: r.status ?? -1, saida: (r.stdout ?? "") + (r.stderr ?? "") };
}

preparaCopia();
const limpo = rodaTestes();
if (limpo.codigo !== 0) {
  console.error("ÁRVORE LIMPA VERMELHA: a sabotagem não vale nada assim.\n" + limpo.saida.slice(-3000));
  process.exit(2);
}
console.log("árvore limpa: verde");

let pegos = 0;
const problemas: string[] = [];
for (const mt of MUTANTES) {
  preparaCopia();
  const caminho = join(COPIA, mt.arquivo);
  const conteudo = readFileSync(caminho, "utf8");
  const vezes = conteudo.split(mt.de).length - 1;
  if (vezes !== 1) { problemas.push(`SCRIPT: "${mt.nome}" achou o trecho ${vezes} vez(es)`); continue; }
  writeFileSync(caminho, conteudo.replace(mt.de, mt.para));
  const r = rodaTestes();
  const naoCompilou = /SyntaxError|ERR_INVALID_TYPESCRIPT_SYNTAX|Cannot find module/u.test(r.saida);
  const linhasNotOk = r.saida.split("\n").filter((l) => l.startsWith("not ok"));
  const acertouAlvo = linhasNotOk.some((l) => l.includes(mt.testeQueFalha));
  if (r.codigo === 0) problemas.push(`VIVO: "${mt.nome}" passou em todos os testes`);
  else if (naoCompilou) problemas.push(`INCONCLUSIVO: "${mt.nome}" não compilou`);
  else if (!acertouAlvo) problemas.push(`ALVO ERRADO: "${mt.nome}" caiu, mas não em "${mt.testeQueFalha}" (${linhasNotOk.slice(0, 3).join(" | ")})`);
  else { pegos++; console.log(`pego: ${mt.nome} (${linhasNotOk.length} teste(s) vermelho(s))`); }
}
rmSync(COPIA, { recursive: true, force: true });
console.log(`\n${pegos}/${MUTANTES.length} mutantes pegos no teste esperado`);
for (const p of problemas) console.log(p);
process.exit(problemas.length ? 1 : 0);
