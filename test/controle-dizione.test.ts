// Controle positivo do INSTRUMENTO: o mesmo comparador do corpus, aplicado às saídas reais do normalizador
// do dizione-ptbr (medidas em 19/11/2026, fixture), tem de reprovar os casos que sabidamente saem errados.
// Se este teste passar a aprovar tudo, quem quebrou foi o comparador, não o normalizador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizar } from "../src/normalizar.ts";
import { carregarCorpus, paraComparar } from "./apoio.ts";

interface ItemDizione { texto: string; cat: string; dizione: string; dizione_ok_no_lab: boolean }
const fixture: ItemDizione[] = JSON.parse(readFileSync(new URL("./fixtures/dizione-6a3baa3.json", import.meta.url), "utf8")).itens;
const aceitas = new Map(carregarCorpus().map((i) => [i.texto, i.aceitas.map(paraComparar)]));

test("controle: o comparador reprova as 38 leituras que o dizione erra (medidas no laboratório)", () => {
  const erradas = fixture.filter((i) => !i.dizione_ok_no_lab);
  assert.equal(erradas.length, 38);
  for (const i of erradas) {
    assert.ok(!aceitas.get(i.texto)!.includes(paraComparar(i.dizione)), `o comparador aceitou o erro: "${i.dizione}"`);
  }
});

test("antes x depois no mesmo corpus: o ouvir-ptbr não perde nenhum acerto do dizione", () => {
  for (const i of fixture) {
    const nosso = aceitas.get(i.texto)!.includes(paraComparar(normalizar(i.texto).falado));
    assert.ok(nosso, `o ouvir-ptbr erra onde o dizione ${i.dizione_ok_no_lab ? "acertava" : "também errava"}: ${i.texto}`);
  }
});
