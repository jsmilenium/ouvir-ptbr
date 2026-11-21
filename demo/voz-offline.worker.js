// Voz offline: fonemizador (dizione-ptbr-js) + modelo tiny-voca-ptbr no ONNX Runtime Web (WASM), fora da thread
// principal. Tudo vem da própria página (vendor/ e modelo/), sem CDN.
// Adaptado de tiny-voca-ptbr (SemFence, Apache-2.0), web/public/worker.js no commit 2f15310, que por sua vez
// adapta o demo do tiny-voca de Muhammed Nazeem (Apache-2.0). Mudanças: runtime e modelo locais, só WASM,
// mensagens em português, sem cache próprio (o navegador já guarda os arquivos estáticos).
// Mensagens recebidas: {tipo: "carregar"} e {tipo: "falar", id, texto, voz, velocidade}.
// Mensagens enviadas: estado, pronto, frase (áudio de cada frase), fim, erro.

import * as ort from "./vendor/ort/ort.wasm.min.mjs";
import { Dizione } from "./vendor/dizione/engine.js";
import * as symbols from "./vendor/dizione/symbols.js";
import { makeTokenizer } from "./voz-offline-tokens.js";

let dizione, tokenize, sessao, config;
const estado = (texto, progresso) => postMessage({ tipo: "estado", texto, progresso });

async function baixar(url, rotulo) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const total = Number(r.headers.get("content-length")) || 0;
  if (!r.body || !total) return new Uint8Array(await r.arrayBuffer());
  const leitor = r.body.getReader();
  const pedacos = [];
  let recebido = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    pedacos.push(value);
    recebido += value.length;
    estado(rotulo, recebido / total);
  }
  const bytes = new Uint8Array(recebido);
  let pos = 0;
  for (const p of pedacos) { bytes.set(p, pos); pos += p.length; }
  return bytes;
}

async function carregar() {
  estado("Carregando o dicionário de pronúncia");
  const [lexico, tabela] = await Promise.all([
    baixar("vendor/dizione/data/lexicon.tsv", "Carregando o dicionário de pronúncia").then((b) => new TextDecoder().decode(b)),
    fetch("vendor/dizione/data/open_table.json").then((r) => r.json()),
  ]);
  dizione = new Dizione(lexico, tabela);
  tokenize = makeTokenizer(symbols);
  config = await (await fetch("modelo/model.json")).json();
  const bytes = await baixar("modelo/model.onnx", "Baixando a voz (uma vez só)");
  estado("Preparando a voz");
  ort.env.wasm.wasmPaths = new URL("./vendor/ort/", self.location.href).href;
  ort.env.wasm.numThreads = 1;
  sessao = await ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
  await sintetizar(tokenize(dizione.pieces("Olá.")), 0, 1);
}

const ABREVIACOES = /(?:(?<![A-Za-zÀ-ÖØ-öø-ÿ0-9_])(?:dr|dra|prof|profa|sr|sra|srta|av|tel|obs|etc|ex|nº|vs)|(?<![A-Za-zÀ-ÖØ-öø-ÿ0-9_])[A-ZÀ-ÖØ-Ý])\.$/i;

// Frases, sem quebrar depois de títulos, iniciais ou dentro de números (igual ao demo original).
function frases(texto) {
  const partes = [];
  let atual = "";
  for (const p of texto.replace(/\s+/g, " ").trim().split(/(?<=[.!?…]["')\]]?)\s+(?=["'(\[]?[A-Z0-9À-ÖØ-Ý])/)) {
    atual = atual ? atual + " " + p : p;
    if (!ABREVIACOES.test(atual)) { partes.push(atual); atual = ""; }
  }
  if (atual) partes.push(atual);
  return partes.filter((p) => /[\p{L}\p{N}]/u.test(p));
}

// Sem pontuação final o modelo corta a última sílaba: acrescenta um ponto (igual ao demo original).
function terminada(texto) {
  const corpo = texto.replace(/\s+$/, "");
  return /[.!?…]["'”’)\]»]*$/.test(corpo) ? corpo : corpo + ".";
}

// Uma fala aceita até max_tokens fonemas; frases maiores são cortadas em vírgulas, depois por palavras.
function cabe(frase) {
  const r = tokenize(dizione.pieces(frase));
  if (!r) return [];
  if (r.ids.length <= config.max_tokens - 12) return [r];
  const pedacos = frase.split(/(?<=[,;:])\s+/);
  if (pedacos.length > 1) return pedacos.flatMap(cabe);
  const palavras = frase.split(" ");
  if (palavras.length < 2) return [];
  const meio = Math.ceil(palavras.length / 2);
  return [...cabe(palavras.slice(0, meio).join(" ")), ...cabe(palavras.slice(meio).join(" "))];
}

async function sintetizar(fones, voz, velocidade) {
  const n = fones.ids.length;
  const inteiros = (v) => new ort.Tensor("int64", BigInt64Array.from(v.map(BigInt)), [1, n]);
  const escalar = (v) => new ort.Tensor("float32", Float32Array.from([v]), [1]);
  const saida = await sessao.run({
    tokens: inteiros(fones.ids), stress: inteiros(fones.stress),
    voice: new ort.Tensor("int64", BigInt64Array.from([BigInt(voz)]), [1]),
    speed: escalar(velocidade), pitch_shift: escalar(0), pitch_range: escalar(1),
  });
  const audio = await saida.audio.getData();
  return audio instanceof Float32Array ? audio : Float32Array.from(audio);
}

// O modelo às vezes passa de 1,0 (o autor trata igual em infer.py, limit_peak): reduz o trecho inteiro.
function limitaPico(a) {
  let maior = 0;
  for (let i = 0; i < a.length; i++) maior = Math.max(maior, Math.abs(a[i]));
  if (maior > 0.99) for (let i = 0; i < a.length; i++) a[i] *= 0.99 / maior;
}

async function falar({ id, texto, voz, velocidade }) {
  const lista = frases(terminada(texto));
  let algum = false;
  for (let i = 0; i < lista.length; i++) {
    for (const fones of cabe(lista[i])) {
      const audio = await sintetizar(fones, voz, velocidade);
      limitaPico(audio);
      algum = true;
      postMessage({ tipo: "frase", id, indice: i, total: lista.length, texto: lista[i], audio,
                    taxa: config.sample_rate }, [audio.buffer]);
    }
  }
  postMessage(algum ? { tipo: "fim", id } : { tipo: "erro", id, mensagem: "Não há o que ler neste texto." });
}

onmessage = async ({ data }) => {
  try {
    if (data.tipo === "carregar") {
      await carregar();
      postMessage({ tipo: "pronto", vozes: config.voices, taxa: config.sample_rate });
    } else if (data.tipo === "falar") {
      await falar(data);
    }
  } catch (e) {
    postMessage({ tipo: "erro", id: data.id, mensagem: String((e && e.message) || e) });
  }
};
