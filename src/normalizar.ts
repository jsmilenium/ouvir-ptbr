// ouvir-ptbr: normalizador de texto pt-BR para leitura em voz alta.
// Regra central: só EXPANDE número, símbolo e abreviação; nunca apaga nem troca palavra do autor.
// Toda expansão vira um trecho com a posição no original, e concatenar os originais reconstrói o texto byte a byte.

import { cardinal, digitos, nomeDaLetra, ordinal, parteDecimal, romanoParaNumero, VOCABULARIO_NUMEROS } from "./numeros.ts";

export type Confianca = "alta" | "ambigua";

export interface Trecho {
  inicio: number;
  fim: number;
  original: string;
  falado: string;
  /** null = texto do autor, copiado como está. */
  regra: string | null;
  confianca: Confianca;
}

export interface Resultado {
  falado: string;
  trechos: Trecho[];
}

export interface Opcoes {
  /** Pronúncias locais (sigla ou palavra inteira -> como falar). Ex.: { "SAAE": "sáe" }. */
  lexico?: Record<string, string>;
}

interface Contexto {
  texto: string;
  inicio: number;
  anterior: string; // palavra anterior, minúscula, sem pontuação
  anteriorOriginal: string; // palavra anterior como escrita
  anterior2: string; // a de antes dela, minúscula
  proxima: string; // próxima palavra depois do casamento, como escrita
  depoisDaProxima: string;
}

interface Saida {
  falado: string;
  confianca?: Confianca;
}

interface Regra {
  nome: string;
  re: RegExp; // sempre com flags "yu"
  aplicar: (m: RegExpExecArray, ctx: Contexto) => Saida | null;
}

// ---------------------------------------------------------------- utilidades

const N = "\\p{N}";
const L = "\\p{L}";

function plural(qtd: bigint | number, singular: string, pluralForma: string): string {
  return BigInt(qtd) === 1n ? singular : pluralForma;
}

/** Inteiro de "1.234.567" ou "1234". */
function inteiro(s: string): bigint {
  return BigInt(s.replace(/\./gu, ""));
}

/** Dígitos agrupados como escritos (separadores viram pausa). "123.456.789-09" -> "um dois três, quatro ...". */
function grupos(s: string): string {
  return s.split(/[^0-9A-Za-z]+/u).filter(Boolean).map(digitos).join(", ");
}

/** Número com vírgula decimal ("4,5" -> "quatro vírgula cinco"). */
function numeroDecimal(int: string, frac: string | undefined, fem = false): string {
  const base = cardinal(inteiro(int), fem && !frac);
  return frac ? `${base} vírgula ${parteDecimal(frac)}` : base;
}

/** Valor < 2 pede singular na unidade ("1,5 litro", "0,5 miligrama"); de 2 em diante, plural. */
function valorMenorQueDois(int: string, _frac: string | undefined): boolean {
  return inteiro(int) < 2n;
}

const FEM_EXPLICITO = new Set(["vez", "vezes", "mulher", "mulheres", "mãe", "mães", "noite", "noites", "tarde",
  "tardes", "parte", "partes", "chave", "chaves", "árvore", "árvores", "cidade", "cidades", "rede", "redes", "sede",
  "fonte", "fontes", "classe", "classes", "frase", "frases", "fase", "fases", "base", "bases", "série", "séries",
  "espécie", "espécies", "unidade", "unidades", "mil-pessoas", "flor", "flores", "dor", "dores", "cor", "cores",
  "colher", "colheres", "lei", "leis", "nuvem", "nuvens", "imagem", "imagens", "viagem", "viagens", "ordem", "ordens"]);
const MASC_EXPLICITO = new Set(["dia", "dias", "mapa", "mapas", "problema", "problemas", "programa", "programas",
  "sistema", "sistemas", "tema", "temas", "clima", "climas", "idioma", "idiomas", "poema", "poemas", "planeta",
  "planetas", "telefonema", "telefonemas", "cometa", "cometas", "dilema", "dilemas", "esquema", "esquemas", "drama",
  "dramas", "diploma", "diplomas", "pijama", "pijamas", "sofá", "sofás", "papa", "papas", "guarda", "guardas",
  "atleta", "atletas", "jornalista", "jornalistas", "motorista", "motoristas", "artista", "artistas", "pirata",
  "piratas", "profeta", "profetas", "teorema", "teoremas", "lema", "lemas", "trema", "cinema", "cinemas", "fantasma",
  "fantasmas", "carisma", "aroma", "aromas", "enigma", "enigmas", "estigma", "dogma", "dogmas", "gorila", "gorilas"]);

// Verbos e palavras comuns depois de número que NÃO são substantivo ("2026 começa", "os 2 são", "página 2 mostra").
const NAO_SUBSTANTIVO = new Set(["são", "está", "estão", "era", "eram", "foi", "foram", "será", "serão", "seria",
  "tinha", "tinham", "fica", "ficam", "começa", "começam", "mostra", "mostram", "chega", "chegam", "acaba", "acabam",
  "termina", "terminam", "passa", "passam", "entra", "entram", "fala", "falam", "pega", "pegam", "deixa", "deixam",
  "ganha", "ganham", "custa", "custam", "paga", "pagam", "marca", "marcam", "trata", "tratam", "usa", "usam",
  "agora", "ainda", "nunca", "sempre", "lá", "cá", "já", "mais", "menos", "apenas", "quase", "hora"]);

/** Gênero do substantivo que vem depois do número (heurística; na dúvida, masculino).
 *  O "-a" singular só vale para o 1 ("1 casa"); de 2 em diante o substantivo vem no plural ("2 casas"),
 *  então "-as" é o sinal, e verbo terminado em "-a" ("2026 começa") não flexiona. */
function substantivoFeminino(palavra: string, valor: bigint): boolean {
  const p = palavra.toLowerCase();
  if (!p || PALAVRAS_CURTAS.has(p) || NAO_SUBSTANTIVO.has(p)) return false;
  if (FEM_EXPLICITO.has(p)) return true;
  if (MASC_EXPLICITO.has(p)) return false;
  if (/(ção|ções|dade|dades|gem|gens|eza|ezas)$/u.test(p)) return true;
  return valor === 1n ? /[^aeiou]a$/u.test(p) && !/ma$/u.test(p) : /as$/u.test(p);
}

function generoDepois(ctx: Contexto, valor: bigint): boolean {
  const p = ctx.proxima.toLowerCase();
  if (p === "mil" || p === "milhões" || p === "milhão" || p === "bilhões" || p === "bilhão") {
    return p === "mil" ? substantivoFeminino(ctx.depoisDaProxima, 2n) : false;
  }
  // Número com cara de ano ("2026 **Duração", "Em 1988 Começou"): só flexiona se vier substantivo em minúscula.
  if (valor >= 1000n && valor <= 2100n && !/^\p{Ll}/u.test(ctx.proxima)) return false;
  return substantivoFeminino(ctx.proxima, valor);
}

// ---------------------------------------------------------------- Bíblia

const LIVROS: Record<string, { nome: string; masc?: boolean; pessoa?: boolean; salmo?: boolean }> = {
  "Gênesis": { nome: "Gênesis" }, "Êxodo": { nome: "Êxodo" }, "Levítico": { nome: "Levítico" },
  "Números": { nome: "Números" }, "Deuteronômio": { nome: "Deuteronômio" }, "Josué": { nome: "Josué", pessoa: true },
  "Juízes": { nome: "Juízes" }, "Rute": { nome: "Rute", pessoa: true }, "Samuel": { nome: "Samuel", masc: true, pessoa: true },
  "Reis": { nome: "Reis", masc: true }, "Crônicas": { nome: "Crônicas", masc: true }, "Esdras": { nome: "Esdras", pessoa: true },
  "Neemias": { nome: "Neemias", pessoa: true }, "Ester": { nome: "Ester", pessoa: true }, "Jó": { nome: "Jó", pessoa: true },
  "Salmos": { nome: "Salmos", salmo: true }, "Salmo": { nome: "Salmo", salmo: true }, "Provérbios": { nome: "Provérbios" },
  "Eclesiastes": { nome: "Eclesiastes" }, "Cânticos": { nome: "Cânticos" }, "Cantares": { nome: "Cantares" },
  "Isaías": { nome: "Isaías", pessoa: true }, "Jeremias": { nome: "Jeremias", pessoa: true },
  "Lamentações": { nome: "Lamentações" }, "Ezequiel": { nome: "Ezequiel", pessoa: true },
  "Daniel": { nome: "Daniel", pessoa: true }, "Oseias": { nome: "Oseias", pessoa: true }, "Joel": { nome: "Joel", pessoa: true },
  "Amós": { nome: "Amós", pessoa: true }, "Obadias": { nome: "Obadias", pessoa: true }, "Jonas": { nome: "Jonas", pessoa: true },
  "Miqueias": { nome: "Miqueias", pessoa: true }, "Naum": { nome: "Naum", pessoa: true },
  "Habacuque": { nome: "Habacuque", pessoa: true }, "Sofonias": { nome: "Sofonias", pessoa: true },
  "Ageu": { nome: "Ageu", pessoa: true }, "Zacarias": { nome: "Zacarias", pessoa: true },
  "Malaquias": { nome: "Malaquias", pessoa: true }, "Mateus": { nome: "Mateus", pessoa: true },
  "Marcos": { nome: "Marcos", pessoa: true }, "Lucas": { nome: "Lucas", pessoa: true }, "João": { nome: "João", pessoa: true },
  "Atos": { nome: "Atos" }, "Romanos": { nome: "Romanos" }, "Coríntios": { nome: "Coríntios" },
  "Gálatas": { nome: "Gálatas" }, "Efésios": { nome: "Efésios" }, "Filipenses": { nome: "Filipenses" },
  "Colossenses": { nome: "Colossenses" }, "Tessalonicenses": { nome: "Tessalonicenses" },
  "Timóteo": { nome: "Timóteo", pessoa: true }, "Tito": { nome: "Tito", pessoa: true },
  "Filemom": { nome: "Filemom", pessoa: true }, "Hebreus": { nome: "Hebreus" }, "Tiago": { nome: "Tiago", pessoa: true },
  "Pedro": { nome: "Pedro", pessoa: true }, "Judas": { nome: "Judas", pessoa: true }, "Apocalipse": { nome: "Apocalipse" },
};
// Abreviações só valem com capítulo:versículo (evita "Jo" ou "At" soltos).
const ABREV_LIVROS: Record<string, string> = {
  Gn: "Gênesis", Ex: "Êxodo", Lv: "Levítico", Nm: "Números", Dt: "Deuteronômio", Js: "Josué", Jz: "Juízes",
  Rt: "Rute", Sm: "Samuel", Rs: "Reis", Cr: "Crônicas", Ed: "Esdras", Ne: "Neemias", Et: "Ester", "Jó": "Jó",
  Sl: "Salmo", Pv: "Provérbios", Ec: "Eclesiastes", Ct: "Cânticos", Is: "Isaías", Jr: "Jeremias", Lm: "Lamentações",
  Ez: "Ezequiel", Dn: "Daniel", Jl: "Joel", Am: "Amós", Ob: "Obadias", Jn: "Jonas", Mq: "Miqueias", Hc: "Habacuque", Sf: "Sofonias", Ag: "Ageu", Zc: "Zacarias", Ml: "Malaquias", Mt: "Mateus",
  Mc: "Marcos", Lc: "Lucas", Jo: "João", At: "Atos", Rm: "Romanos", Co: "Coríntios", Gl: "Gálatas", Ef: "Efésios",
  Fp: "Filipenses", Cl: "Colossenses", Ts: "Tessalonicenses", Tm: "Timóteo", Tt: "Tito", Fm: "Filemom",
  Hb: "Hebreus", Tg: "Tiago", Pe: "Pedro", Jd: "Judas", Ap: "Apocalipse",
};
const alternativa = (lista: string[]) => lista.sort((a, b) => b.length - a.length).join("|");
const RE_LIVRO_NOME = alternativa(Object.keys(LIVROS));
const RE_LIVRO_ABREV = alternativa(Object.keys(ABREV_LIVROS));

function referenciaBiblica(prefixo: string | undefined, livroEscrito: string, nome: string, cap: string,
  v1: string | undefined, v2: string | undefined): string {
  const info = LIVROS[nome];
  const partes: string[] = [];
  if (prefixo) partes.push(ordinal(Number(prefixo), !info?.masc));
  partes.push(livroEscrito === nome || !ABREV_LIVROS[livroEscrito] ? livroEscrito : nome);
  const capitulo = cardinal(Number(cap));
  partes.push(info?.salmo ? capitulo : `capítulo ${capitulo}`);
  let s = partes.join(" ");
  if (v1) {
    s += v2 ? `, versículos ${cardinal(Number(v1))} a ${cardinal(Number(v2))}` : `, versículo ${cardinal(Number(v1))}`;
  }
  return s;
}

// ---------------------------------------------------------------- dicionários

const MOEDAS: Record<string, [string, string]> = {
  "R$": ["real", "reais"], "US$": ["dólar", "dólares"], "U$": ["dólar", "dólares"], "€": ["euro", "euros"],
};
const ESCALA_DINHEIRO: Record<string, bigint> = {
  mil: 1000n, "milhão": 1_000_000n, "milhões": 1_000_000n, mi: 1_000_000n, "bilhão": 1_000_000_000n,
  "bilhões": 1_000_000_000n, bi: 1_000_000_000n, "trilhão": 1_000_000_000_000n, "trilhões": 1_000_000_000_000n,
  tri: 1_000_000_000_000n,
};

// [regex da unidade, singular, plural, feminina?]
const UNIDADES_MEDIDA: Array<[string, string, string, boolean]> = [
  ["km/h", "quilômetro por hora", "quilômetros por hora", false],
  ["km²|km2", "quilômetro quadrado", "quilômetros quadrados", false],
  ["m²|m2", "metro quadrado", "metros quadrados", false],
  ["m³|m3", "metro cúbico", "metros cúbicos", false],
  ["°C|ºC|° C|º C", "grau Celsius", "graus Celsius", false],
  ["°F|ºF", "grau Fahrenheit", "graus Fahrenheit", false],
  ["km", "quilômetro", "quilômetros", false],
  ["cm", "centímetro", "centímetros", false],
  ["mm", "milímetro", "milímetros", false],
  ["mcg|µg", "micrograma", "microgramas", false],
  ["mg", "miligrama", "miligramas", false],
  ["kg", "quilo", "quilos", false],
  ["ml|mL", "mililitro", "mililitros", false],
  ["ha", "hectare", "hectares", false],
  ["gts|gotas?", "gota", "gotas", true],
  ["comp\\.|cp\\.", "comprimido", "comprimidos", false],
  ["g", "grama", "gramas", false],
  ["L", "litro", "litros", false],
  ["m", "metro", "metros", false],
  ["%", "por cento", "por cento", false],
];
const RE_UNIDADE = UNIDADES_MEDIDA.map(([r]) => `(?:${r})`).join("|");

const ABREVIACOES: Record<string, string> = {
  "Sr.": "senhor", "Sra.": "senhora", "Srta.": "senhorita", "Srs.": "senhores", "Sras.": "senhoras",
  "Dr.": "doutor", "Dra.": "doutora", "Drs.": "doutores", "Dras.": "doutoras", "Prof.": "professor",
  "Profa.": "professora", "Pr.": "pastor", "Pra.": "pastora", "Rev.": "reverendo", "Revda.": "reverenda",
  "Av.": "avenida", "Tel.": "telefone", "tel.": "telefone", "pág.": "página", "págs.": "páginas", "Pág.": "página",
  "Ltda.": "limitada", "etc.": "etcétera", "Exmo.": "excelentíssimo", "Exma.": "excelentíssima",
  "Sto.": "santo", "Sta.": "santa", "Cia.": "companhia", "Dep.": "deputado", "Vol.": "volume", "vol.": "volume",
  "cap.": "capítulo", "Cap.": "capítulo",
};
const RE_ABREV = alternativa(Object.keys(ABREVIACOES).map((k) => k.replace(".", "\\.")));

// Sem "bloco", "quadra", "lote", "sala": ali "C" e "D" costumam ser LETRA, não romano.
const SECAO_ROMANO = new Set(["capítulo", "cap", "inciso", "incisos", "título", "volume", "vol", "parte", "livro",
  "seção", "fase", "etapa", "ato", "cena", "anexo", "item", "tomo", "módulo", "unidade", "edição"]);
const EVENTO_MASC = new Set(["Congresso", "Encontro", "Festival", "Simpósio", "Seminário", "Concílio", "Fórum",
  "Salão", "Acampamento", "Retiro", "Torneio", "Campeonato"]);
const EVENTO_FEM = new Set(["Conferência", "Bienal", "Jornada", "Semana", "Feira", "Mostra", "Olimpíada", "Copa",
  "Assembleia", "Plenária", "Convenção", "Cruzada", "Maratona", "Corrida"]);
const TITULO_REAL = new Set(["dom", "papa", "rei", "rainha", "imperador", "imperatriz", "príncipe", "princesa",
  "são", "santo", "santa", "dona"]);
const TITULO_REAL_FEM = new Set(["rainha", "imperatriz", "princesa", "santa", "dona"]);
const NOMES_REGNAIS = new Set(["Pedro", "João", "Bento", "Pio", "Leão", "Luís", "Luiz", "Henrique", "Carlos", "Filipe",
  "Felipe", "Jorge", "Eduardo", "Ricardo", "Guilherme", "Francisco", "Gregório", "Paulo", "Clemente", "Inocêncio",
  "Bonifácio", "Urbano", "Alexandre", "Afonso", "Fernando", "Manuel", "José", "Napoleão", "Frederico", "Constantino",
  "Justiniano", "Teodósio", "Ramsés", "Sancho", "Dinis", "Sebastião", "Vítor", "Humberto", "Nicolau", "Ivan",
  "Elizabeth", "Isabel", "Maria", "Catarina", "Ana", "Vitória", "Leopoldo", "Rodolfo", "Otto", "Sisto", "Estêvão"]);
const NOMES_REGNAIS_FEM = new Set(["Elizabeth", "Isabel", "Maria", "Catarina", "Ana", "Vitória"]);
const TITULO_PESSOA = new Set(["pr", "pra", "pastor", "pastora", "sr", "sra", "srta", "dr", "dra", "irmão", "irmã",
  "prof", "profa", "professor", "professora", "missionário", "missionária", "rev", "bispo", "apóstolo", "diácono",
  "presbítero", "seu", "dona"]);
const PALAVRAS_CURTAS = new Set(["o", "a", "os", "as", "e", "é", "do", "da", "de", "no", "na", "em", "um", "uma",
  "ao", "à", "eu", "ele", "ela", "se", "que", "por", "para", "com"]);

const GATILHO_DATA = new Set(["em", "até", "dia", "desde", "vence", "vencimento", "data", "prazo", "partir", "após",
  "antes", "para", "no", "na", "entre", "domingo", "segunda", "terça", "quarta", "quinta",
  "sexta", "sábado", "feira", "hoje", "amanhã"]);
const GATILHO_HORA = new Set(["às", "as", "das", "até", "entre", "partir", "horário", "hora", "horas", "abre",
  "fecha", "desde", "a", "começa", "inicia", "termina"]); // sem "e": "Hebreus 12:6 e 12:11" é versículo
const DENOMINADOR: Record<number, [string, string]> = {
  2: ["meio", "meios"], 3: ["terço", "terços"], 4: ["quarto", "quartos"], 5: ["quinto", "quintos"],
  6: ["sexto", "sextos"], 7: ["sétimo", "sétimos"], 8: ["oitavo", "oitavos"], 9: ["nono", "nonos"],
  10: ["décimo", "décimos"],
};

function hora(h: number, m: number): string | null {
  if (h > 23 || m > 59) return null;
  const hs = `${cardinal(h, true)} ${h === 1 || h === 0 ? "hora" : "horas"}`;
  return m === 0 ? hs : `${hs} e ${cardinal(m)} ${m === 1 ? "minuto" : "minutos"}`;
}

function dataPorExtenso(d: number, m: number, ano?: string): string | null {
  const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro",
    "outubro", "novembro", "dezembro"];
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  let s = `${d === 1 ? "primeiro" : cardinal(d)} de ${MESES[m - 1]}`;
  if (ano !== undefined) s += ` de ${cardinal(BigInt(ano))}`; // ano de 2 dígitos: lido como escrito, sem inventar século
  return s;
}

// ---------------------------------------------------------------- regras (ordem = prioridade)

const REGRAS: Regra[] = [
  {
    nome: "url",
    re: new RegExp(`(?<![${L}${N}@.])(?:https?:\\/\\/)?(?:www\\.)?(?:[a-z0-9-]+\\.)+(?:br|com|org|net|gov|edu|io|app|dev|info|leg|jus|mil)(?:\\.[a-z]{2})?(?:\\/[^\\s]*[^\\s.,;:!?)])?(?![${L}${N}])`, "yu"),
    aplicar: (m) => {
      const sem = m[0].replace(/^https?:\/\//u, "");
      return {
        falado: sem.replace(/\./gu, " ponto ").replace(/\//gu, " barra ").replace(/-/gu, " hífen ")
          .replace(/_/gu, " sublinhado ").replace(/\s+/gu, " ").trim(),
      };
    },
  },
  {
    nome: "email",
    re: new RegExp(`(?<![${L}${N}.])[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+`, "yu"),
    aplicar: (m) => ({ falado: m[0].replace("@", " arroba ").replace(/\./gu, " ponto ").replace(/\s+/gu, " ") }),
  },
  {
    nome: "processo_cnj",
    re: new RegExp(`(?<![${N}])\\d{7}-\\d{2}\\.\\d{4}\\.\\d\\.\\d{2}\\.\\d{4}(?![${N}])`, "yu"),
    aplicar: (m) => ({ falado: grupos(m[0]) }),
  },
  {
    nome: "cnpj",
    re: new RegExp(`(?<![${L}${N}])[0-9A-Z]{2}\\.[0-9A-Z]{3}\\.[0-9A-Z]{3}\\/[0-9A-Z]{4}-\\d{2}(?![${N}])`, "yu"),
    aplicar: (m) => ({ falado: grupos(m[0]) }),
  },
  {
    nome: "cpf",
    re: new RegExp(`(?<![${N}])\\d{3}\\.\\d{3}\\.\\d{3}-\\d{2}(?![${N}])`, "yu"),
    aplicar: (m) => ({ falado: grupos(m[0]) }),
  },
  {
    // Palavra-gatilho de documento seguida de identificador: lê dígito a dígito, mantendo a palavra do autor.
    nome: "documento",
    re: new RegExp(`(?<![${L}])(CPF|CNPJ|CEP|RG|CNH|NIS|PIS|[Mm]atrícula|[Pp]rotocolo|[Ii]nscrição|[Cc]ódigo|[Cc]hamado)(:?\\s+)(\\d[\\d./-]*\\d|\\d)(?![${N}]|[./-]?[${L}${N}])`, "yu"),
    aplicar: (m) => ({ falado: `${m[1]}${m[2]}${grupos(m[3])}` }),
  },
  {
    nome: "cep",
    re: new RegExp(`(?<![${N}.])\\d{5}-\\d{3}(?![${N}])`, "yu"),
    aplicar: (m) => ({ falado: grupos(m[0]) }),
  },
  {
    nome: "telefone_0800",
    re: new RegExp(`(?<![${N}])0[3589]00[\\s-]?\\d{3}[\\s-]?\\d{4}(?![${N}])`, "yu"),
    aplicar: (m) => ({ falado: `${digitos(m[0].slice(0, 4))}, ${grupos(m[0].slice(4))}` }),
  },
  {
    nome: "telefone",
    re: new RegExp(`(?<![${N}])(\\+55\\s?)?(\\(\\d{2}\\)\\s?|\\d{2}\\s)?(9?\\d{4})[-\\s](\\d{4})(?![${N}])`, "yu"),
    aplicar: (m) => {
      // dois anos ("1834-1892", "2020-2024") sem DDD nem +55: é intervalo, não telefone
      if (!m[1] && !m[2] && /^(1\d|20)\d\d$/u.test(m[3]) && /^(1\d|20)\d\d$/u.test(m[4]) && m[3] < m[4]) return null;
      const partes: string[] = [];
      if (m[1]) partes.push("mais cinquenta e cinco");
      if (m[2]) partes.push(digitos(m[2]));
      partes.push(digitos(m[3]), digitos(m[4]));
      return { falado: partes.join(", ") };
    },
  },
  {
    nome: "biblia",
    re: new RegExp(`(?<![${L}${N}])(?:([123])\\s?[ªº]?\\s+)?(${RE_LIVRO_NOME}|${RE_LIVRO_ABREV})\\.?\\s+(\\d{1,3})(?:\\s*[:.]\\s*(\\d{1,3})(?:\\s*[-–]\\s*(\\d{1,3}))?)?(?![${N}])`, "yu"),
    aplicar: (m, ctx) => {
      const [, prefixo, escrito, cap, v1, v2] = m;
      const abreviado = !LIVROS[escrito];
      const nome = abreviado ? ABREV_LIVROS[escrito] : escrito;
      if (!nome) return null;
      if (abreviado && !v1) return null; // "Jo 3" solto não é referência segura
      if (!v1 && !prefixo && LIVROS[nome]?.pessoa) return null; // "João 3 anos"
      if (!prefixo && LIVROS[nome]?.pessoa && TITULO_PESSOA.has(ctx.anterior)) return null; // "Pr. Marcos 19:30"
      return { falado: referenciaBiblica(prefixo, escrito, nome, cap, v1, v2) };
    },
  },
  {
    nome: "lei",
    re: new RegExp(`(?<![${L}])((?:[Ll]ei [Cc]omplementar|[Dd]ecreto-[Ll]ei|[Ll]ei|[Dd]ecreto|[Pp]ortaria|[Rr]esolução|[Ii]nstrução [Nn]ormativa|[Mm]edida [Pp]rovisória|[Ee]menda [Cc]onstitucional|LC))(\\s+(?:n\\.?\\s?[º°o]\\.?|N[º°]\\.?)\\s*|\\s+)(\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:\\/(\\d{4}|\\d{2}))?(?![${N}])`, "yu"),
    aplicar: (m) => {
      const numero = /[º°o]/u.test(m[2]) ? " número " : " ";
      const ano = m[4] ? `, de ${cardinal(BigInt(m[4]))}` : "";
      return { falado: `${m[1]}${numero}${cardinal(inteiro(m[3]))}${ano}` };
    },
  },
  {
    nome: "numero_ano",
    re: new RegExp(`(?<![${L}])(n\\.?\\s?[º°]|N\\.?\\s?[º°])\\.?\\s*(\\d{1,3}(?:\\.\\d{3})+|\\d+)\\/(\\d{4})(?![${N}])`, "yu"),
    aplicar: (m) => ({ falado: `número ${cardinal(inteiro(m[2]))}, de ${cardinal(BigInt(m[3]))}` }),
  },
  {
    nome: "artigo",
    re: new RegExp(`(?<![${L}])([Aa]rts?\\.)\\s*(\\d{1,4})(º|°|o)?(?:-([A-Z]))?(?![${N}${L}])`, "yu"),
    aplicar: (m) => {
      const n = Number(m[2]);
      const nome = m[1].toLowerCase().startsWith("arts") ? "artigos" : "artigo";
      const num = n <= 9 ? ordinal(n) : cardinal(n);
      return { falado: `${nome} ${num}${m[4] ? " " + nomeDaLetra(m[4]) : ""}` };
    },
  },
  {
    nome: "paragrafo",
    re: new RegExp(`(§§?)\\s*(\\d{1,4})(º|°)?(?![${N}])`, "yu"),
    aplicar: (m) => {
      const n = Number(m[2]);
      return { falado: `${m[1] === "§§" ? "parágrafos" : "parágrafo"} ${n <= 9 ? ordinal(n) : cardinal(n)}` };
    },
  },
  {
    nome: "romano",
    re: new RegExp(`(?<![${L}${N}])([IVXLCDM]{1,7})(?![${L}${N}])`, "yu"),
    aplicar: (m, ctx) => {
      const n = romanoParaNumero(m[1]);
      if (n === null) return null;
      if (SECAO_ROMANO.has(ctx.anterior)) {
        if (m[1].length === 1 && !"IVX".includes(m[1])) return null; // "anexo C" é letra
        return n <= 200 ? { falado: cardinal(n) } : null;
      }
      if (ctx.anterior === "século") return n <= 30 ? { falado: n <= 10 ? ordinal(n) : cardinal(n) } : null;
      if (n > 39) return null;
      if (EVENTO_MASC.has(ctx.proxima)) return { falado: ordinal(n) };
      if (EVENTO_FEM.has(ctx.proxima)) return { falado: ordinal(n, true) };
      const nome = ctx.anteriorOriginal;
      const ehNome = /^\p{Lu}\p{Ll}+$/u.test(nome) && !PALAVRAS_CURTAS.has(nome.toLowerCase());
      const titulo = TITULO_REAL.has(ctx.anterior2);
      // Ordinal só para nome de rei/papa ("Pedro II" = segundo); outro nome com romano é cardinal ("Nível II" = dois).
      if (ehNome && (titulo || NOMES_REGNAIS.has(nome))) {
        const fem = TITULO_REAL_FEM.has(ctx.anterior2) || NOMES_REGNAIS_FEM.has(nome);
        return { falado: n <= 10 ? ordinal(n, fem) : cardinal(n, fem) };
      }
      if (ehNome && m[1].length >= 2) return { falado: cardinal(n) };
      return null;
    },
  },
  {
    nome: "dinheiro",
    re: new RegExp(`(?<![${L}${N}])(R\\$|US\\$|U\\$|€)\\s*(\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:,(\\d{1,2}))?(?:\\s+(mil|milhão|milhões|mi|bilhão|bilhões|bi|trilhão|trilhões|tri)(?![${L}]))?`, "yu"),
    aplicar: (m) => {
      const [singular, pluralForma] = MOEDAS[m[1]];
      let reais: bigint;
      let centavos = 0n;
      if (m[4]) {
        const frac = m[3] ?? "";
        const base = 10n ** BigInt(frac.length);
        const total = (inteiro(m[2]) * base + BigInt(frac || "0")) * ESCALA_DINHEIRO[m[4]];
        if (total % base !== 0n) return null;
        reais = total / base;
      } else {
        reais = inteiro(m[2]);
        if (m[3]) centavos = BigInt(m[3].padEnd(2, "0"));
      }
      const textoCentavos = centavos > 0n ? `${cardinal(centavos)} ${plural(centavos, "centavo", "centavos")}` : "";
      if (reais === 0n) return { falado: textoCentavos || `zero ${pluralForma}` };
      const de = reais >= 1_000_000n && reais % 1_000_000n === 0n ? " de " : " ";
      const textoReais = `${cardinal(reais)}${de}${plural(reais, singular, pluralForma)}`;
      return { falado: textoCentavos ? `${textoReais} e ${textoCentavos}` : textoReais };
    },
  },
  {
    nome: "data_iso",
    re: new RegExp(`(?<![${N}])(\\d{4})-(\\d{2})-(\\d{2})(?![${N}])`, "yu"),
    aplicar: (m) => {
      const s = dataPorExtenso(Number(m[3]), Number(m[2]), m[1]);
      return s ? { falado: s } : null;
    },
  },
  {
    nome: "data",
    re: new RegExp(`(?<![${N}\\/])(\\d{1,2})\\/(\\d{1,2})\\/(\\d{4}|\\d{2})(?![${N}\\/])`, "yu"),
    aplicar: (m) => {
      const s = dataPorExtenso(Number(m[1]), Number(m[2]), m[3]);
      return s ? { falado: s, confianca: m[3].length === 2 ? "ambigua" : "alta" } : null;
    },
  },
  {
    nome: "posologia",
    re: new RegExp(`(?<![${N}\\/])(\\d{1,2})\\/(\\d{1,2})\\s?(?:horas|hs|h)(?![${L}${N}])`, "yu"),
    aplicar: (m, ctx) => {
      if (m[1] !== m[2]) return null;
      const n = cardinal(Number(m[1]), true);
      return { falado: `${ctx.anterior === "de" ? "" : "de "}${n} em ${n} horas` };
    },
  },
  {
    nome: "data_curta_ou_fracao",
    re: new RegExp(`(?<![${N}\\/])(\\d{1,2})\\/(\\d{1,2})(?![${N}\\/])`, "yu"),
    aplicar: (m, ctx) => {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const proxima = ctx.proxima.toLowerCase();
      if (["de", "da", "do", "das", "dos"].includes(proxima) && DENOMINADOR[b] && a >= 1 && a < b) {
        const [s, p] = DENOMINADOR[b];
        return { falado: `${cardinal(a)} ${a === 1 ? s : p}` };
      }
      // Mês com 2 dígitos ("20/11", "09/09") é data em pt-BR; com 1 dígito ("2/7", "3/4"), só com gatilho.
      if ((GATILHO_DATA.has(ctx.anterior) || m[2].length === 2) && b >= 1 && b <= 12 && a >= 1 && a <= 31) {
        const s = dataPorExtenso(a, b);
        if (s) return { falado: s };
      }
      return null; // cai na leitura genérica "N barra M"
    },
  },
  {
    nome: "hora_minuto",
    re: new RegExp(`(?<![${N}])(\\d{1,2})h(\\d{2})(?:min)?(?![${L}${N}])`, "yu"),
    aplicar: (m) => {
      const s = hora(Number(m[1]), Number(m[2]));
      return s ? { falado: s } : null;
    },
  },
  {
    nome: "hora",
    re: new RegExp(`(?<![${N}])(\\d{1,2})\\s?h(?![${L}${N}])`, "yu"),
    aplicar: (m) => {
      const s = hora(Number(m[1]), 0);
      return s ? { falado: s } : null;
    },
  },
  {
    nome: "duracao",
    re: new RegExp(`(?<![${N}])(\\d{1,3})m\\s?(\\d{1,2})s(?![${L}${N}])`, "yu"),
    aplicar: (m) => {
      const a = Number(m[1]);
      const b = Number(m[2]);
      return { falado: `${cardinal(a)} ${a === 1 ? "minuto" : "minutos"} e ${cardinal(b)} ${b === 1 ? "segundo" : "segundos"}` };
    },
  },
  {
    nome: "minutos",
    re: new RegExp(`(?<![${N}])(\\d{1,3})\\s?min(?![${L}${N}])`, "yu"),
    aplicar: (m) => ({ falado: `${cardinal(Number(m[1]))} ${Number(m[1]) === 1 ? "minuto" : "minutos"}` }),
  },
  {
    nome: "hora_dois_pontos",
    re: new RegExp(`(?<![${N}:])(\\d{1,2}):(\\d{2})(?![${N}:])`, "yu"),
    aplicar: (m, ctx) => {
      const h = Number(m[1]);
      const min = Number(m[2]);
      const depoisDeAno = /^(19|20)\d\d$/u.test(ctx.anterior); // "05/11/2026 00:33"
      if (!GATILHO_HORA.has(ctx.anterior) && !depoisDeAno && min !== 0) {
        return { falado: `${cardinal(h)}, ${parteDecimal(m[2])}`, confianca: "ambigua" };
      }
      const s = hora(h, min);
      return s ? { falado: s } : null;
    },
  },
  {
    nome: "vezes",
    re: new RegExp(`(?<![${L}${N}])(\\d{1,3})\\s?x(?![${L}${N}])`, "yu"),
    aplicar: (m) => {
      const n = Number(m[1]);
      return { falado: `${cardinal(n, true)} ${n === 1 ? "vez" : "vezes"}` };
    },
  },
  {
    nome: "unidade",
    re: new RegExp(`(?<![${L}${N}])(\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:,(\\d+))?\\s?(${RE_UNIDADE})(?![${L}${N}²³])`, "yu"),
    aplicar: (m) => {
      const escrito = m[3];
      const def = UNIDADES_MEDIDA.find(([r]) => new RegExp(`^(?:${r})$`, "u").test(escrito));
      if (!def) return null;
      const [, singular, pluralForma, fem] = def;
      const numero = numeroDecimal(m[1], m[2], fem);
      if (escrito === "%") return { falado: `${numero} por cento` };
      // "14m" colado e inteiro é ambíguo (minutos? metros?): só vira metro com espaço ou decimal ("5 m", "1,69m")
      if (escrito === "m" && !m[2] && !/\s/u.test(m[0])) return null;
      return { falado: `${numero} ${valorMenorQueDois(m[1], m[2]) ? singular : pluralForma}` };
    },
  },
  {
    nome: "ordinal",
    re: new RegExp(`(?<![${L}${N}])(\\d{1,4})(º|ª|°(?!\\s?[CF]))(?![${L}${N}])`, "yu"),
    aplicar: (m) => {
      const n = Number(m[1]);
      return n >= 1 ? { falado: ordinal(n, m[2] === "ª") } : null;
    },
  },
  {
    nome: "numero_simbolo",
    re: new RegExp(`(?<![${L}])(?:n\\.?\\s?[º°]|N\\.?\\s?[º°])\\.?(?=\\s*\\d)`, "yu"),
    aplicar: () => ({ falado: "número" }),
  },
  {
    nome: "sociedade_anonima",
    re: new RegExp(`(?<![${L}])S\\.\\s?A\\.(?![${L}])`, "yu"),
    aplicar: () => ({ falado: "esse a" }),
  },
  {
    nome: "abreviacao",
    re: new RegExp(`(?<![${L}${N}])(${RE_ABREV})(?![${L}])`, "yu"),
    aplicar: (m, ctx) => {
      const fim = ctx.inicio + m[0].length;
      const final = fim >= ctx.texto.length || /^\s*\n/u.test(ctx.texto.slice(fim));
      return { falado: ABREVIACOES[m[1]] + (final ? "." : "") };
    },
  },
  {
    nome: "e_comercial",
    re: /(?<=\s)&(?=\s)/yu,
    aplicar: () => ({ falado: "e" }),
  },
  {
    nome: "intervalo",
    re: new RegExp(`(?<![${L}${N}\\-./])(\\d{1,3}(?:\\.\\d{3})+|\\d{1,4})-(\\d{1,3}(?:\\.\\d{3})+|\\d{1,4})(?![${N}\\-./])`, "yu"),
    aplicar: (m) => {
      if (m[1].includes(".") || m[2].includes(".")) { // "2.000-4.000"
        const x = inteiro(m[1]);
        const y = inteiro(m[2]);
        return x < y ? { falado: `${cardinal(x)} a ${cardinal(y)}` } : null;
      }
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (a < b && !/^0\d/u.test(m[1]) && !/^0\d/u.test(m[2])) return { falado: `${cardinal(a)} a ${cardinal(b)}` };
      return { falado: grupos(m[0]), confianca: "ambigua" };
    },
  },
  {
    // Sequência com barra ("3/4", "32/13/2026") que nenhuma regra acima reconheceu: lê literal.
    nome: "barra",
    re: new RegExp(`(?<![${L}${N}])(\\d+)(?:\\/(\\d+))+(?![${N}])`, "yu"),
    aplicar: (m) => ({
      falado: m[0].split("/").map((p) => (/^0\d/u.test(p) ? digitos(p) : cardinal(BigInt(p)))).join(" barra "),
      confianca: "ambigua",
    }),
  },
  {
    // Versão ou IP ("3.5.16", "127.0.0.1"): grupos curtos sem zero à esquerda -> "três ponto cinco ponto dezesseis".
    nome: "versao",
    re: new RegExp(`(?<![${L}${N}.])\\d{1,3}(?:\\.\\d{1,3}){2,}(?![${N}]|\\.\\d)`, "yu"),
    aplicar: (m) => {
      const g = m[0].split(".");
      if (g.some((x) => /^0\d/u.test(x)) || /^\d{1,3}(?:\.\d{3})+$/u.test(m[0])) return null;
      return { falado: g.map((x) => cardinal(Number(x))).join(" ponto "), confianca: "ambigua" };
    },
  },
  {
    nome: "identificador",
    re: new RegExp(`(?<![${L}${N}])\\d+(?:[.\\-]\\d+){2,}(?![${N}])`, "yu"),
    // "1.000.000" é milhar, não código: deixa para a regra de número.
    aplicar: (m) => (/^\d{1,3}(?:\.\d{3})+$/u.test(m[0]) ? null : { falado: grupos(m[0]), confianca: "ambigua" }),
  },
  {
    nome: "decimal_ponto",
    re: new RegExp(`(?<![${L}${N}.,])(\\d+)\\.(\\d{1,2})(?![${N}.])`, "yu"),
    aplicar: (m) => ({ falado: `${cardinal(BigInt(m[1]))} ponto ${parteDecimal(m[2])}`, confianca: "ambigua" }),
  },
  {
    nome: "numero",
    re: new RegExp(`(?<![${L}${N}])(\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:,(\\d+))?(?![${N}])`, "yu"),
    aplicar: (m, ctx) => {
      const int = m[1];
      if (/^0\d/u.test(int)) return { falado: digitos(int) }; // "007": zeros à esquerda são parte do código
      const soDigitos = int.replace(/\./gu, "");
      if (!int.includes(".") && soDigitos.length >= 10) return { falado: digitos(int), confianca: "ambigua" };
      return { falado: numeroDecimal(int, m[2], generoDepois(ctx, inteiro(int))) };
    },
  },
];

// ---------------------------------------------------------------- motor

const RE_PALAVRA = /[\p{L}\p{N}.ºª°]+/gu;

function palavras(texto: string): string[] {
  return texto.match(RE_PALAVRA) ?? [];
}

function limpa(p: string | undefined): string {
  return (p ?? "").replace(/[.,;:!?()"']+$/u, "").replace(/^[("']+/u, "");
}

function contexto(texto: string, inicio: number, fim: number): Contexto {
  const antes = palavras(texto.slice(Math.max(0, inicio - 80), inicio));
  const depois = (texto.slice(fim, fim + 80).match(/[\p{L}\p{N}]+/gu) ?? []);
  const ant = limpa(antes[antes.length - 1]);
  return {
    texto,
    inicio,
    anterior: ant.toLowerCase(),
    anteriorOriginal: ant,
    anterior2: limpa(antes[antes.length - 2]).toLowerCase(),
    proxima: depois[0] ?? "",
    depoisDaProxima: depois[1] ?? "",
  };
}

/** Início do texto, ou depois de . ! ? ou de quebra de linha (ignorando espaços). */
function comecoDeFrase(texto: string, i: number): boolean {
  let j = i - 1;
  while (j >= 0 && (texto[j] === " " || texto[j] === "\t")) j--;
  if (j < 0) return true;
  if (texto[j] === "\n") return true;
  if (!(/[.!?]/u.test(texto[j]) && j < i - 1)) return false;
  // ponto de abreviação ("pág. 3", "art. 5º", "Sr. João") não termina a frase
  const palavra = texto.slice(Math.max(0, j - 12), j + 1).match(/\S+$/u)?.[0] ?? "";
  return !(palavra in ABREVIACOES) && !/^(?:n|nº|n\.º|arts?|cap|vol|p|pp|fls?|inc|al)\.$/iu.test(palavra);
}

/** Normaliza o texto e devolve o texto para falar mais o mapa de trechos. */
export function normalizar(texto: string, opcoes: Opcoes = {}): Resultado {
  const trechos: Trecho[] = [];
  let literalInicio = 0;
  let i = 0;
  const lexico = opcoes.lexico ?? {};
  const chavesLexico = Object.keys(lexico).sort((a, b) => b.length - a.length);
  const reLexico = chavesLexico.length
    ? new RegExp(`(?<![${L}${N}])(${chavesLexico.map((k) => k.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|")})(?![${L}${N}])`, "yu")
    : null;

  const fechaLiteral = (ate: number) => {
    if (ate > literalInicio) {
      const original = texto.slice(literalInicio, ate);
      trechos.push({ inicio: literalInicio, fim: ate, original, falado: original, regra: null, confianca: "alta" });
    }
  };

  while (i < texto.length) {
    let casou = false;
    if (reLexico) {
      reLexico.lastIndex = i;
      const m = reLexico.exec(texto);
      if (m) {
        fechaLiteral(i);
        trechos.push({ inicio: i, fim: i + m[0].length, original: m[0], falado: lexico[m[1]], regra: "lexico", confianca: "alta" });
        i += m[0].length;
        literalInicio = i;
        casou = true;
      }
    }
    if (!casou) {
      for (const regra of REGRAS) {
        regra.re.lastIndex = i;
        const m = regra.re.exec(texto);
        if (!m || m[0].length === 0) continue;
        const saida = regra.aplicar(m, contexto(texto, i, i + m[0].length));
        if (!saida) continue;
        if (comecoDeFrase(texto, i)) saida.falado = saida.falado.charAt(0).toUpperCase() + saida.falado.slice(1);
        // "14m" -> "quatorze m", não "quatorzem": separa da letra que vem colada depois
        const seguinte = texto.charAt(i + m[0].length);
        if (/\p{L}$/u.test(saida.falado) && /\p{L}/u.test(seguinte)) saida.falado += " ";
        fechaLiteral(i);
        trechos.push({
          inicio: i, fim: i + m[0].length, original: m[0], falado: saida.falado, regra: regra.nome,
          confianca: saida.confianca ?? "alta",
        });
        i += m[0].length;
        literalInicio = i;
        casou = true;
        break;
      }
    }
    if (!casou) i += 1;
  }
  fechaLiteral(texto.length);
  return { falado: trechos.map((t) => t.falado).join(""), trechos };
}

/** Atalho: só o texto para falar. */
export function paraFala(texto: string, opcoes?: Opcoes): string {
  return normalizar(texto, opcoes).falado;
}

/** Palavras que as regras podem acrescentar (além das palavras do próprio trecho original). */
export const VOCABULARIO: ReadonlySet<string> = new Set([
  ...VOCABULARIO_NUMEROS,
  "vírgula", "ponto", "barra", "hífen", "sublinhado", "arroba", "mais", "de", "a", "em", "por", "cento",
  "hora", "horas", "minuto", "minutos", "segundo", "segundos", "vez", "vezes", "número", "artigo", "artigos", "parágrafo", "parágrafos",
  "capítulo", "versículo", "versículos", "esse",
  ...Object.values(MOEDAS).flat(), "centavo", "centavos",
  ...UNIDADES_MEDIDA.flatMap(([, s, p]) => [...s.split(" "), ...p.split(" ")]),
  ...Object.values(ABREVIACOES),
  ...Object.values(LIVROS).map((l) => l.nome),
  ...Object.values(DENOMINADOR).flat(),
  "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro",
  "dezembro",
]);
