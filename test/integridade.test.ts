// Invariantes que valem para QUALQUER texto, não só para o corpus.
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizar, VOCABULARIO } from "../src/normalizar.ts";
import { carregarCorpus, centavosDoFalado, centavosDoOriginal, lerDigitos } from "./apoio.ts";

const corpus = carregarCorpus();

/** Textos de propriedade: corpus + combinações com palavras antes, entre e depois dos alvos. */
function textos(): string[] {
  const base = corpus.map((i) => i.texto);
  const extras: string[] = [];
  let semente = 42;
  const aleatorio = () => (semente = (semente * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const pedacos = ["não", "pague", "até", "o", "valor", "de", "e", "\n", "  ", "ação", "Ação!", "(", ")", ",", "."];
  for (let k = 0; k < 400; k++) {
    const a = base[Math.floor(aleatorio() * base.length)];
    const b = base[Math.floor(aleatorio() * base.length)];
    const p = pedacos[Math.floor(aleatorio() * pedacos.length)];
    extras.push(`${p} ${a} ${p} ${b} ${p}`);
  }
  return [...base, ...extras];
}

test("reconstrução: trechos contíguos, ordenados, cobrem o texto e o reconstroem byte a byte", () => {
  for (const t of textos()) {
    const { trechos } = normalizar(t);
    let pos = 0;
    for (const tr of trechos) {
      assert.equal(tr.inicio, pos, `buraco ou sobreposição em ${JSON.stringify(t)}`);
      assert.equal(t.slice(tr.inicio, tr.fim), tr.original);
      assert.ok(tr.fim > tr.inicio);
      pos = tr.fim;
    }
    assert.equal(pos, t.length);
    assert.equal(trechos.map((x) => x.original).join(""), t);
  }
});

test("fora dos trechos com regra, o texto do autor sai idêntico (nada apagado, nada trocado)", () => {
  for (const t of textos()) {
    const r = normalizar(t);
    for (const tr of r.trechos.filter((x) => x.regra === null)) assert.equal(tr.falado, tr.original);
    assert.equal(r.falado, r.trechos.map((x) => x.falado).join(""));
  }
});

test("lista branca: toda palavra falada vem do vocabulário das regras ou do próprio trecho original", () => {
  const vocab = new Set([...VOCABULARIO].map((p) => p.toLowerCase()));
  for (const t of textos()) {
    for (const tr of normalizar(t).trechos.filter((x) => x.regra !== null)) {
      const doOriginal = new Set(tr.original.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean));
      for (const p of tr.falado.toLowerCase().split(/[^\p{L}]+/u).filter(Boolean)) {
        assert.ok(vocab.has(p) || doOriginal.has(p), `"${p}" fora da lista branca (regra ${tr.regra}, "${tr.original}")`);
      }
    }
  }
});

test("documentos: os dígitos falados são os mesmos do original, na mesma ordem (zeros incluídos)", () => {
  const regras = new Set(["cpf", "cnpj", "cep", "processo_cnj", "documento", "telefone_0800", "identificador"]);
  let conferidos = 0;
  for (const t of textos()) {
    for (const tr of normalizar(t).trechos.filter((x) => x.regra && regras.has(x.regra))) {
      const original = tr.original.slice(tr.original.search(/\d/u)).replace(/[^0-9A-Za-z]/gu, "").toUpperCase();
      assert.equal(lerDigitos(tr.falado), original, `"${tr.original}" -> "${tr.falado}"`);
      conferidos++;
    }
  }
  assert.ok(conferidos >= 10, `poucos documentos conferidos: ${conferidos}`);
});

test("telefone: dígitos falados batem com o original", () => {
  let conferidos = 0;
  for (const t of textos()) {
    for (const tr of normalizar(t).trechos.filter((x) => x.regra === "telefone")) {
      const semPais = tr.original.replace(/^\+55\s?/u, "").replace(/\D/gu, "");
      const falado = tr.falado.replace(/^mais cinquenta e cinco,\s*/u, "");
      assert.equal(lerDigitos(falado), semPais, tr.original);
      conferidos++;
    }
  }
  assert.ok(conferidos >= 3);
});

test("dinheiro: o valor falado (lido de volta) é o mesmo valor escrito", () => {
  let conferidos = 0;
  for (const t of textos()) {
    for (const tr of normalizar(t).trechos.filter((x) => x.regra === "dinheiro")) {
      assert.equal(centavosDoFalado(tr.falado), centavosDoOriginal(tr.original), `"${tr.original}" -> "${tr.falado}"`);
      conferidos++;
    }
  }
  assert.ok(conferidos >= 15, `poucos valores conferidos: ${conferidos}`);
});

test("idempotência: normalizar o que já foi normalizado não muda nada", () => {
  for (const t of textos()) {
    const uma = normalizar(t).falado;
    assert.equal(normalizar(uma).falado, uma, t);
  }
});

test("nenhum dígito sobra na saída, exceto em trecho marcado como ambíguo", () => {
  for (const item of corpus) {
    for (const tr of normalizar(item.texto).trechos) {
      if (tr.confianca === "ambigua") continue;
      assert.ok(!/\d/u.test(tr.falado), `dígito na saída: "${tr.falado}" (${item.texto})`);
    }
  }
});

test("desempenho: texto patológico de 20 mil caracteres em menos de 2 s (sem regex catastrófica)", () => {
  const ruins = ["1".repeat(5000), "1.".repeat(2500), "R$ ".repeat(2000), "a@".repeat(3000), "I".repeat(4000),
    "www.".repeat(2000) + "x", "1/".repeat(3000), "12-".repeat(2500)];
  for (const r of ruins) {
    const t0 = performance.now();
    normalizar(r);
    assert.ok(performance.now() - t0 < 2000, `lento: ${r.slice(0, 10)}...`);
  }
});
