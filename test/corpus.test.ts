import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizar } from "../src/normalizar.ts";
import { carregarCorpus, paraComparar } from "./apoio.ts";

const corpus = carregarCorpus();
// Contagem FIXADA: se o corpus encolher (item apagado para o teste passar), o CI fica vermelho.
const TOTAL_ESPERADO = 219;

test("corpus: tamanho fixado", () => {
  assert.equal(corpus.length, TOTAL_ESPERADO);
  assert.ok(corpus.filter((i) => i.cat === "negativo").length >= 40, "pelo menos 40 negativos");
});

for (const [n, item] of corpus.entries()) {
  test(`corpus ${String(n).padStart(3, "0")} [${item.cat}] ${item.texto.replace(/\n/gu, "\\n")}`, () => {
    const { falado } = normalizar(item.texto);
    const aceitas = item.aceitas.map(paraComparar);
    assert.ok(aceitas.includes(paraComparar(falado)), `saiu: "${falado}"\naceitas: ${JSON.stringify(item.aceitas)}`);
  });
}

test("negativos: texto sem número nem abreviação sai IDÊNTICO, byte a byte", () => {
  for (const item of corpus.filter((i) => i.cat === "negativo" && i.aceitas[0] === i.texto)) {
    assert.equal(normalizar(item.texto).falado, item.texto, item.texto);
  }
});
