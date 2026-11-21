// O tsc reescreve ".ts" -> ".js" nos .js do build, mas não nos .d.ts. Sem isto, quem instala o pacote recebe
// `export ... from "./normalizar.ts"` e o TypeScript dele não resolve. Uso: parte de `npm run build`.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dist = join(import.meta.dirname, "..", "dist");
let trocas = 0;
for (const f of readdirSync(dist).filter((x) => x.endsWith(".d.ts"))) {
  const caminho = join(dist, f);
  const antes = readFileSync(caminho, "utf8");
  const depois = antes.replace(/(from\s+["']\.{1,2}\/[^"']+)\.ts(["'])/gu, "$1.js$2");
  if (depois !== antes) { writeFileSync(caminho, depois); trocas++; }
}
const resto = readdirSync(dist).filter((x) => x.endsWith(".d.ts")).filter((f) => /from\s+["']\.[^"']+\.ts["']/u.test(readFileSync(join(dist, f), "utf8")));
if (resto.length) { console.error("ainda há import .ts em:", resto); process.exit(1); }
console.log(`.d.ts ajustados: ${trocas}`);
