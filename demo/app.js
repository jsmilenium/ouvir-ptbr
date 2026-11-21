// Página de demonstração do ouvir-ptbr. Sem dependências; o normalizador vem de ./lib (build do src/).
import { normalizar } from "./lib/index.js";

const EXEMPLOS = {
  contrato: "EXTRATO DE CONTRATO nº 045/2026. Contratada: Empresa Exemplo Ltda., CNPJ 12.345.678/0001-95. Objeto: reforma da UBS do bairro Centro. Valor global: R$ 1.250.000,00. Vigência: de 01/12/2026 a 30/11/2027. Fundamento: Lei 14.133/2021, art. 75, inciso II.",
  saude: "A UBS Vila Nova atende de segunda a sexta, das 7h às 19h. Vacina da gripe: dose única de 0,5 mL. Dúvidas: (84) 3315-0000 ou saude@prefeitura.exemplo.gov.br. Paracetamol 500 mg: tomar de 8/8h, no máximo 4x ao dia.",
  igreja: "Culto de domingo, 22/11, às 18h30. Leitura: 1 Coríntios 13:4-7 e Salmo 23. Oferta missionária: meta de R$ 15 mil. XXI Congresso de Jovens: inscrições até 05/12, no valor de R$ 80,00. Fale com o Pr. Arthur: (41) 99999-1234.",
};
const REGRAS_SENSIVEIS = new Set(["cpf", "cnpj", "documento", "telefone", "telefone_0800", "processo_cnj", "email"]);

const $ = (id) => document.getElementById(id);
const campo = $("texto");
const corrigir = $("corrigir");
const seletorVoz = $("voz");
const sobreVoz = $("sobre-voz");
const velocidade = $("velocidade");
const velValor = $("vel-valor");
const leitura = $("leitura");
const resumo = $("resumo");
const alerta = $("alerta");
const agora = $("agora");
const btOuvir = $("ouvir");
const btPausar = $("pausar");
const btParar = $("parar");

const temVoz = "speechSynthesis" in window;
let vozes = [];
let fila = [];
let atual = -1;

// ---------------------------------------------------------------- vozes

// Vozes offline (modelo aberto tiny-voca-ptbr rodando na página): sempre disponíveis, baixadas só se escolhidas.
const VOZES_OFFLINE = [
  { offline: true, indice: 0, name: "Voz offline feminina", localService: true },
  { offline: true, indice: 1, name: "Voz offline masculina", localService: true },
];

function carregarVozes() {
  const anterior = seletorVoz.value;
  const doNavegador = temVoz ? speechSynthesis.getVoices()
    .filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith("pt"))
    .sort((a, b) => peso(b) - peso(a)) : [];
  vozes = [...doNavegador, ...VOZES_OFFLINE];
  seletorVoz.innerHTML = "";
  vozes.forEach((v, i) => {
    const op = document.createElement("option");
    op.value = String(i);
    op.textContent = v.offline ? `${v.name} (baixa 33 MB uma vez, o texto não sai daqui)`
      : `${v.name} (${v.localService ? "neste aparelho" : "pela internet"})`;
    seletorVoz.append(op);
  });
  if (anterior && Number(anterior) < vozes.length) seletorVoz.value = anterior;
  seletorVoz.disabled = false;
  btOuvir.disabled = false;
  atualizarSelo();
}
function peso(v) {
  const br = /pt[-_]br/i.test(v.lang) ? 2 : 0;
  return br + (v.localService ? 1 : 0);
}
function vozEscolhida() {
  return vozes[Number(seletorVoz.value)] ?? null;
}
function atualizarSelo() {
  const v = vozEscolhida();
  if (!v) return;
  if (v.offline) {
    sobreVoz.textContent = "Voz aberta que roda nesta página: o texto não sai do aparelho. Soa mais robótica.";
    sobreVoz.className = "selo local";
  } else if (v.localService) {
    sobreVoz.textContent = "Esta voz funciona neste aparelho.";
    sobreVoz.className = "selo local";
  } else {
    sobreVoz.textContent = "Esta voz usa a internet: o texto é enviado ao serviço de voz do navegador.";
    sobreVoz.className = "selo online";
  }
  atualizarAlerta();
}

// ---------------------------------------------------------------- texto preparado

let ultimo = { falado: "", trechos: [] };

function atualizarLeitura() {
  const texto = campo.value;
  ultimo = normalizar(texto);
  leitura.replaceChildren();
  if (!texto.trim()) {
    resumo.textContent = "";
    leitura.textContent = "O texto preparado aparece aqui.";
    atualizarAlerta();
    return;
  }
  const ajustados = ultimo.trechos.filter((t) => t.regra);
  if (!corrigir.checked) {
    leitura.textContent = texto;
    resumo.textContent = "Preparação desligada: a voz vai ler o texto como está.";
  } else {
    for (const t of ultimo.trechos) {
      if (!t.regra) { leitura.append(document.createTextNode(t.falado)); continue; }
      const m = document.createElement("mark");
      m.className = t.confianca === "ambigua" ? "duvida" : "ajustado";
      m.textContent = t.falado;
      m.title = `Escrito: ${t.original}`;
      leitura.append(m);
    }
    const duvidas = ajustados.filter((t) => t.confianca === "ambigua").length;
    resumo.textContent = `${ajustados.length} ${ajustados.length === 1 ? "trecho preparado" : "trechos preparados"}`
      + (duvidas ? `, ${duvidas} lido${duvidas === 1 ? "" : "s"} ao pé da letra` : "")
      + ". Nenhuma palavra do seu texto foi apagada.";
  }
  atualizarAlerta();
}

function atualizarAlerta() {
  const v = vozEscolhida();
  const sensivel = ultimo.trechos.some((t) => t.regra && REGRAS_SENSIVEIS.has(t.regra));
  if (v && !v.localService && sensivel) {
    alerta.textContent = "Atenção: o texto tem documento, telefone ou e-mail, e a voz escolhida usa a internet. Se for dado de uma pessoa real, escolha uma voz \"neste aparelho\".";
    alerta.hidden = false;
  } else {
    alerta.hidden = true;
  }
}

// ---------------------------------------------------------------- fala

/** Frases curtas: o Chrome corta falas longas (cerca de 15 s), então a leitura vai frase a frase. */
function frases(texto) {
  const partes = texto.split(/(?<=[.!?;:])\s+|\n+/u).map((s) => s.trim()).filter(Boolean);
  const saida = [];
  for (const p of partes) {
    if (p.length <= 220) { saida.push(p); continue; }
    let resto = p;
    while (resto.length > 220) {
      let corte = resto.lastIndexOf(", ", 220);
      if (corte < 80) corte = resto.lastIndexOf(" ", 220);
      saida.push(resto.slice(0, corte + 1).trim());
      resto = resto.slice(corte + 1);
    }
    if (resto.trim()) saida.push(resto.trim());
  }
  return saida;
}

// ---------------------------------------------------------------- voz offline

let worker = null;
let prontoOffline = null;
let contexto = null;
let fimAgendado = 0;
let fontes = [];
let idFala = 0;

function garantirOffline() {
  if (prontoOffline) return prontoOffline;
  prontoOffline = new Promise((resolve, reject) => {
    worker = new Worker(new URL("./voz-offline.worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }) => {
      if (data.tipo === "estado") {
        agora.textContent = data.progresso ? `${data.texto}: ${Math.round(data.progresso * 100)}%` : `${data.texto}...`;
      } else if (data.tipo === "pronto") { agora.textContent = ""; resolve(); }
      else if (data.tipo === "frase") tocarFrase(data);
      else if (data.tipo === "fim" && data.id === idFala) {
        const resta = Math.max(0, fimAgendado - contexto.currentTime);
        setTimeout(() => { if (data.id === idFala) terminar(); }, resta * 1000 + 50);
      } else if (data.tipo === "erro") {
        agora.textContent = `A voz offline não funcionou: ${data.mensagem}`;
        if (!data.id) { prontoOffline = null; reject(new Error(data.mensagem)); } else terminar();
      }
    };
    worker.onerror = (e) => {
      agora.textContent = "A voz offline não carregou neste navegador.";
      console.error("voz offline:", e.message || e);
      prontoOffline = null;
      reject(new Error(e.message || "erro no worker"));
    };
    worker.postMessage({ tipo: "carregar" });
  });
  return prontoOffline;
}

function tocarFrase(d) {
  if (d.id !== idFala) return; // fala cancelada
  let soma = 0;
  for (let i = 0; i < d.audio.length; i++) soma += d.audio[i] * d.audio[i];
  window.__ultimoAudioOffline = { amostras: d.audio.length, rms: Math.sqrt(soma / d.audio.length), taxa: d.taxa };
  const buffer = contexto.createBuffer(1, d.audio.length, d.taxa);
  buffer.copyToChannel(d.audio, 0);
  const fonte = contexto.createBufferSource();
  fonte.buffer = buffer;
  fonte.connect(contexto.destination);
  const inicio = Math.max(contexto.currentTime + 0.05, fimAgendado);
  fonte.start(inicio);
  fimAgendado = inicio + buffer.duration;
  fontes.push(fonte);
  setTimeout(() => { if (d.id === idFala) agora.textContent = `Lendo: ${d.texto}`; }, Math.max(0, (inicio - contexto.currentTime) * 1000));
}

async function ouvirOffline(texto, v) {
  contexto = contexto || new AudioContext();
  if (contexto.state === "suspended") await contexto.resume();
  btParar.disabled = false;
  const id = ++idFala;
  try { await garantirOffline(); } catch { terminar(); return; }
  if (id !== idFala) return;
  fimAgendado = 0;
  btPausar.disabled = false;
  worker.postMessage({ tipo: "falar", id, texto, voz: v.indice, velocidade: Number(velocidade.value) });
}

function ouvir() {
  parar();
  const texto = corrigir.checked ? ultimo.falado : campo.value;
  const v = vozEscolhida();
  if (v && v.offline) { ouvirOffline(texto, v); return; }
  if (!temVoz) return;
  fila = frases(texto);
  if (!fila.length) return;
  atual = 0;
  falarAtual();
  btPausar.disabled = false;
  btParar.disabled = false;
}

function falarAtual() {
  if (atual < 0 || atual >= fila.length) { terminar(); return; }
  const u = new SpeechSynthesisUtterance(fila[atual]);
  const v = vozEscolhida();
  if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = "pt-BR"; }
  u.rate = Number(velocidade.value);
  u.onstart = () => { agora.textContent = `Lendo: ${fila[atual]}`; };
  u.onend = () => { if (atual >= 0) { atual++; falarAtual(); } };
  u.onerror = (e) => {
    if (e.error === "interrupted" || e.error === "canceled") return;
    agora.textContent = "A voz parou com erro. Tente outra voz.";
    terminar();
  };
  speechSynthesis.speak(u);
}

function terminar() {
  atual = -1;
  agora.textContent = "";
  btPausar.disabled = true;
  btParar.disabled = true;
  btPausar.textContent = "Pausar";
}

function parar() {
  atual = -1;
  idFala++;
  for (const f of fontes) { try { f.stop(); } catch { /* já terminou */ } }
  fontes = [];
  fimAgendado = 0;
  if (contexto && contexto.state === "suspended") contexto.resume();
  if (temVoz) speechSynthesis.cancel();
  terminar();
}

function pausar() {
  const v = vozEscolhida();
  if (v && v.offline && contexto) {
    if (contexto.state === "running") { contexto.suspend(); btPausar.textContent = "Continuar"; }
    else { contexto.resume(); btPausar.textContent = "Pausar"; }
    return;
  }
  if (speechSynthesis.paused) { speechSynthesis.resume(); btPausar.textContent = "Pausar"; }
  else { speechSynthesis.pause(); btPausar.textContent = "Continuar"; }
}

// ---------------------------------------------------------------- eventos

document.querySelectorAll("[data-exemplo]").forEach((b) => {
  b.addEventListener("click", () => {
    campo.value = EXEMPLOS[b.dataset.exemplo];
    atualizarLeitura();
  });
});
campo.addEventListener("input", atualizarLeitura);
corrigir.addEventListener("change", atualizarLeitura);
seletorVoz.addEventListener("change", atualizarSelo);
velocidade.addEventListener("input", () => { velValor.textContent = Number(velocidade.value).toFixed(1).replace(".", ","); });
btOuvir.addEventListener("click", ouvir);
btPausar.addEventListener("click", pausar);
btParar.addEventListener("click", parar);

carregarVozes();
if (temVoz) speechSynthesis.addEventListener("voiceschanged", carregarVozes);
campo.value = EXEMPLOS.contrato;
atualizarLeitura();
