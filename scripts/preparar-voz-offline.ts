// Monta a voz offline opcional da demo (modelo tiny-voca-ptbr + fonemizador dizione-ptbr-js + ONNX Runtime Web),
// tudo servido pela própria página, sem CDN. Cada peça é fixada e conferida por hash antes de ser copiada:
//   - fonemizador: git fetch do commit exato (o SHA é a prova de integridade), transpilado com o tsc do projeto
//   - runtime: tarball do npm conferido pelo sha512 publicado no registro
//   - modelo e licenças: arquivos do Hugging Face numa revisão fixa, conferidos por sha256
// Uso: node scripts/preparar-voz-offline.ts      (depois: npm run demo)
// Saída em demo/vendor/ e demo/modelo/ (fora do git; o workflow da página roda este script).
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const RAIZ = join(import.meta.dirname, "..");
const TMP = join(RAIZ, ".tmp", "voz-offline");
const VENDOR = join(RAIZ, "demo", "vendor");
const MODELO = join(RAIZ, "demo", "modelo");

const DIZIONE_REPO = "https://github.com/SemFence/dizione-ptbr-js";
const DIZIONE_SHA = "8fbb77e579fe684f3afd9cb2a801d0adce8c89cf";
const ORT_VERSAO = "1.22.0";
const ORT_SHA512 = "sha512-Ud/+EBo6mhuaQWt/OjaOk0iNWjXqJoeeMFr6xQEERZdIZH2OWpGzuujz7lfuOBjUa6TEE/sc4nb7Da5dNL34fg==";
const HF_REV = "f231cbe318c9f972e27fd8dad5d8ebcfb40a672f";
const HF_BASE = `https://huggingface.co/semfence/tiny-voca-ptbr/resolve/${HF_REV}`;
const ARQUIVOS_HF: Array<[string, string, string]> = [
  ["onnx/model.onnx", "model.onnx", "0ac1ffc83e508973513182ed79d4626556e35bcffcccd99ee066dde6d2c77e5b"],
  ["onnx/model.json", "model.json", "0cef74c03aa5b4d705c8ea9810ec71b053da9b33a40925dbdf880ed471120060"],
  ["LICENSE", "LICENSE", "9ba9550ad48438d0836ddab3da480b3b69ffa0aac7b7878b5a0039e7ab429411"],
  ["NOTICE", "NOTICE", "649ab8215fe655f00f87ac46f1f67b0f3c315f97baf56a45b9e8af1642720c94"],
];

function roda(cmd: string, args: string[], cwd = TMP): string {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}\n${r.stderr || r.stdout}`);
  return r.stdout;
}

// curl em vez de fetch: em máquinas com antivírus que intercepta TLS, o fetch do Node recusa o certificado.
function baixa(url: string, destino: string): void {
  roda("curl", ["-sSfL", "--retry", "2", "-o", destino, url]);
}

function sha256(caminho: string): string {
  return createHash("sha256").update(readFileSync(caminho)).digest("hex");
}

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
rmSync(VENDOR, { recursive: true, force: true });
mkdirSync(join(VENDOR, "dizione", "data"), { recursive: true });
mkdirSync(join(VENDOR, "ort"), { recursive: true });
mkdirSync(MODELO, { recursive: true });

// 1. fonemizador
const dz = join(TMP, "dizione");
mkdirSync(dz);
roda("git", ["init", "-q"], dz);
roda("git", ["fetch", "-q", "--depth", "1", DIZIONE_REPO, DIZIONE_SHA], dz);
roda("git", ["-c", "advice.detachedHead=false", "checkout", "-q", "FETCH_HEAD"], dz);
const head = roda("git", ["rev-parse", "HEAD"], dz).trim();
if (head !== DIZIONE_SHA) throw new Error(`commit do fonemizador diferente: ${head}`);
const tsc = join(RAIZ, "node_modules", "typescript", "bin", "tsc");
roda(process.execPath, [tsc, "--ignoreConfig", "--outDir", join(VENDOR, "dizione"), "--target", "es2022", "--module", "esnext",
  "--moduleResolution", "bundler", "--rewriteRelativeImportExtensions", "--noCheck", "--skipLibCheck",
  join(dz, "src", "index.ts")], dz);
for (const f of ["lexicon.tsv", "open_table.json", "LICENSE.mfa-dictionary.md"]) {
  cpSync(join(dz, "data", f), join(VENDOR, "dizione", "data", f));
}
cpSync(join(dz, "LICENSE"), join(VENDOR, "dizione", "LICENSE"));
cpSync(join(dz, "NOTICE"), join(VENDOR, "dizione", "NOTICE"));
console.log(`fonemizador ${DIZIONE_SHA.slice(0, 7)} transpilado`);

// 2. runtime
const ortTgz = join(TMP, "ort.tgz");
baixa(`https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-${ORT_VERSAO}.tgz`, ortTgz);
const integridade = "sha512-" + createHash("sha512").update(readFileSync(ortTgz)).digest("base64");
if (integridade !== ORT_SHA512) throw new Error("onnxruntime-web: integridade não confere");
roda("tar", ["-xzf", "ort.tgz"]);
for (const f of ["ort.wasm.min.mjs", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"]) {
  cpSync(join(TMP, "package", "dist", f), join(VENDOR, "ort", f));
}
// O tarball não traz arquivo de licença; o package.json declara MIT. Registramos o aviso.
writeFileSync(join(VENDOR, "ort", "LICENSE"),
  `onnxruntime-web ${ORT_VERSAO} - Copyright (c) Microsoft Corporation - MIT License\n` +
  `https://github.com/microsoft/onnxruntime (licença declarada em package.json do pacote npm)\n\n` +
  readFileSync(join(RAIZ, "LICENSE"), "utf8").split("\n").slice(4).join("\n"));
console.log(`onnxruntime-web ${ORT_VERSAO} conferido`);

// 3. modelo
for (const [origem, destino, hash] of ARQUIVOS_HF) {
  const alvo = join(MODELO, destino);
  if (!existsSync(alvo) || sha256(alvo) !== hash) baixa(`${HF_BASE}/${origem}`, alvo);
  if (sha256(alvo) !== hash) throw new Error(`${destino}: sha256 não confere`);
}
writeFileSync(join(MODELO, "ORIGEM.txt"),
  `tiny-voca-ptbr, by SemFence (Gustavo Toledo), CC BY 4.0, https://huggingface.co/semfence/tiny-voca-ptbr\n` +
  `Revisão ${HF_REV}; arquivos sem alteração (sha256 conferido).\n`);
console.log("modelo conferido");
rmSync(TMP, { recursive: true, force: true });
