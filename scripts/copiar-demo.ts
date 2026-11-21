// Copia o build (dist/) para demo/lib, que é o que a página carrega. Uso: npm run demo
import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";

const raiz = join(import.meta.dirname, "..");
rmSync(join(raiz, "demo", "lib"), { recursive: true, force: true });
cpSync(join(raiz, "dist"), join(raiz, "demo", "lib"), { recursive: true, filter: (f) => !f.endsWith(".d.ts") });
console.log("demo/lib atualizado");
