# Avisos de terceiros

O normalizador (`src/`) não tem dependência. A página de demonstração pode, opcionalmente, usar uma voz offline montada com os componentes abaixo. Nenhum deles é guardado neste repositório: o script `scripts/preparar-voz-offline.ts` baixa cada um numa versão fixa, confere o hash e copia para `demo/vendor/` e `demo/modelo/` na hora de publicar a página.

| Componente | Versão fixada | Licença | Crédito |
|---|---|---|---|
| tiny-voca-ptbr (modelo de voz, pesos) | revisão `f231cbe` no Hugging Face, sha256 do `model.onnx` `0ac1ffc8...7e5b` | CC BY 4.0 | tiny-voca-ptbr, by SemFence (Gustavo Toledo), CC BY 4.0, https://huggingface.co/semfence/tiny-voca-ptbr. Usado sem alteração. Baseado no tiny-voca de Muhammed Nazeem (Apache-2.0). |
| dizione-ptbr-js (fonemizador) | commit `8fbb77e` | Apache-2.0 (código) e CC BY 4.0 (dicionário, derivado do dicionário pt-BR do Montreal Forced Aligner) | SemFence (Gustavo Toledo); dicionário MFA de McAuliffe e Sonderegger, alterado pelo autor do dizione. |
| ONNX Runtime Web | 1.22.0 (npm, integridade sha512 conferida) | MIT | Microsoft Corporation |
| `demo/voz-offline.worker.js` e `demo/voz-offline-tokens.js` | adaptados de `web/public/` do tiny-voca-ptbr, commit `2f15310` (licença e aviso em `demo/LICENSE-tiny-voca-ptbr.txt` e `demo/NOTICE-tiny-voca-ptbr.txt`) | Apache-2.0 | SemFence (Gustavo Toledo), a partir do demo do tiny-voca de Muhammed Nazeem. O tokenizador está sem alteração; o worker foi adaptado (runtime e modelo locais, só WASM, mensagens em português). |

A voz offline é gerada por computador e o próprio autor a descreve como mais sintética que um vocoder neural.
