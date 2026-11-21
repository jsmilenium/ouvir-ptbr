# ouvir-ptbr

> **In English:** pt-BR text normalizer for text-to-speech (money, CPF/CNPJ, dates, laws, units, Roman numerals, Bible references), with a char-level map back to the original text. Docs in Portuguese.

Prepara texto em português do Brasil para ser lido em voz alta: valores, CPF, CNPJ, datas, horas, leis, unidades, números romanos e referências bíblicas viram palavras, do jeito que se fala. Nenhuma palavra do autor é apagada, e cada trecho preparado aponta para o pedaço exato do texto original.

**[Experimente no navegador](https://jsmilenium.github.io/ouvir-ptbr/)** · sem instalar nada; o texto é preparado no seu aparelho (a voz escolhida pode usar a internet, e a página avisa quando usa)

```
Pague R$ 1,5 bi até 31/12/2026 às 18h. CPF 123.456.789-09. Leia João 3:16.
```
vira
```
Pague um bilhão e quinhentos milhões de reais até trinta e um de dezembro de dois mil e vinte e seis
às dezoito horas. CPF um dois três, quatro cinco seis, sete oito nove, zero nove.
Leia João capítulo três, versículo dezesseis.
```

## Por que existe

Antes de falar, toda voz sintética precisa transformar número, símbolo e abreviação em palavras. Esse passo costuma ser o elo fraco: `R$ 1,5 bi`, um CPF, `art. 10` ou `João 3:16` têm leituras que dependem do contexto, e um erro ali muda o valor, o documento ou o prazo que a pessoa ouve, sem nenhum aviso.

Como foi medido: 86 frases administrativas (valores, documentos, datas, leis, contatos, versículos), com a leitura esperada escrita à mão antes do teste, comparadas nos fonemas de um modelo de voz aberto para pt-BR. Com o normalizador que acompanha o fonemizador desse modelo, 48 frases saíram como esperado; com o ouvir-ptbr preparando o texto antes, 83. As 3 que faltaram são leituras corretas que não estavam na lista escrita antes do teste (`um bilhão e quinhentos milhões`, `Romanos capítulo oito, versículo vinte e oito`, `Primeira Coríntios capítulo treze`); a lista não foi alterada depois.

A preparação não depende de uma voz específica: serve para a voz do navegador, para leitores de tela, para serviços pagos e para modelos que rodam no próprio aparelho.

## Voz offline (opcional, na demonstração)

Além das vozes do navegador, a página oferece uma voz que roda inteira no aparelho: o modelo aberto [tiny-voca-ptbr](https://huggingface.co/semfence/tiny-voca-ptbr) (SemFence, CC BY 4.0) no ONNX Runtime Web, em WebAssembly. Baixa cerca de 33 MB uma vez; depois disso o texto não sai do aparelho. Soa mais robótica que as vozes comerciais. Créditos e versões em [AVISOS-TERCEIROS.md](AVISOS-TERCEIROS.md).

## Uso

```js
import { normalizar, paraFala } from "ouvir-ptbr";

paraFala("Valor: R$ 2,35 milhões.");
// "Valor: dois milhões trezentos e cinquenta mil reais."

const { falado, trechos } = normalizar("CEP 59600-000");
// trechos = [{ inicio: 0, fim: 13, original: "CEP 59600-000",
//              falado: "CEP cinco nove seis zero zero, zero zero zero", regra: "documento", confianca: "alta" }]
```

Cada `trecho` cobre um pedaço do texto: `regra: null` é texto do autor, copiado como está. Concatenar os `original` reconstrói o texto byte a byte. `confianca: "ambigua"` marca o que foi lido ao pé da letra por falta de contexto.

Pronúncias locais (siglas de secretarias, nomes de bairros) entram pelo léxico:

```js
paraFala("Ligue para o SAAE.", { lexico: { SAAE: "sáe" } });
```

## O que cobre

| Tipo | Exemplo | Leitura |
|---|---|---|
| Dinheiro | `R$ 1.250,50`, `R$ 1,5 bi`, `US$ 3`, `€ 200` | mil duzentos e cinquenta reais e cinquenta centavos |
| Documento | CPF, CNPJ (inclusive alfanumérico), CEP, processo do CNJ, protocolo | dígito a dígito, com pausa nos grupos; zeros preservados |
| Telefone | `(41) 99999-1234`, `0800 123 4567`, `+55` | dígito a dígito, com pausa nos grupos |
| Lei | `Lei 14.133/2021`, `Lei nº 8.666/93`, `art. 5º`, `art. 10`, `§ 2º`, `inciso II` | artigo quinto, artigo dez (ordinal até o nono, cardinal depois) |
| Data e hora | `14/03/2026`, `2026-11-19`, `1º de maio`, `15h30`, `19:00`, `1h30min` | quatorze de março de dois mil e vinte e seis |
| Unidades | `km`, `m²`, `kg`, `mL`, `°C`, `km/h`, `%`, `ha` | quilômetros, metros quadrados, por cento |
| Saúde | `0,5 mg`, `8/8h`, `1x ao dia`, `10 gts` | zero vírgula cinco miligrama, de oito em oito horas |
| Romanos | `século XX`, `Pedro II`, `XXI Congresso`, `capítulo IV` | só com contexto: `MIX`, `CIVIL` e `I Love You` ficam como estão |
| Bíblia | `João 3:16`, `1 Coríntios 13:4-7`, `Sl 23:4` | João capítulo três, versículo dezesseis |
| Abreviações | `Sr.`, `Dra.`, `Pr.`, `Av.`, `nº`, `pág.`, `Ltda.`, `etc.` | senhor, doutora, pastor, avenida |
| Contato | `www.prefeitura.rn.gov.br`, `contato@igreja.org` | www ponto prefeitura ponto rn ponto gov ponto br |
| Números | `21 pessoas`, `200 famílias`, `1.234.567`, `0,75`, `007` | vinte e uma pessoas (concordância de gênero) |

## Convenções (decisões do projeto)

Não há norma brasileira de como ler documento em voz alta. Estas são escolhas do projeto, pensadas para quem precisa anotar o que ouviu:

- **CPF, CNPJ, CEP, telefone, protocolo:** dígito a dígito, com pausa onde o texto tem separador. Nunca como quantia.
- **Na dúvida, não adivinha:** `3/4` sem contexto vira "três barra quatro"; com "da área" depois, vira "três quartos". `3:16` sem contexto não vira hora.
- **Ano com dois dígitos:** lido como escrito ("de vinte e seis"); o século não é inventado.
- **Siglas:** ficam como estão (a voz decide). Para forçar uma pronúncia, use o `lexico`.

## O que não faz

- Não garante leitura de dose de remédio nem de prazo legal: confira sempre no documento original.
- Não substitui um site acessível (HTML bem feito, leitor de tela) e não é, por si, exigência legal.
- A voz é de quem lê: na página de demonstração, a voz é a do navegador, e algumas usam a internet (a página mostra qual é qual e avisa quando o texto tem documento ou telefone).

## Como os testes provam alguma coisa

- **Corpus** (`corpus/corpus.json`): 219 frases. Dessas, 196 foram escritas antes das regras (40 devem sair idênticas) e 23 são regressão: casos achados ao rodar o normalizador sobre texto real. A contagem é fixa: apagar uma frase deixa o teste vermelho.
- **Invariantes em qualquer texto:**
  - reconstrução byte a byte;
  - texto do autor intocado fora dos trechos;
  - toda palavra acrescentada vem de uma lista fechada;
  - dígitos de documento lidos de volta iguais ao original;
  - valor em dinheiro lido de volta igual ao escrito;
  - idempotência;
  - nenhum dígito sobrando;
  - tempo limite para entradas patológicas.
- **Controle do instrumento:** o comparador tem de reprovar as 38 leituras erradas do normalizador de outro projeto, medidas antes.
- **Sabotagem** (`npm run sabotagem`): 15 defeitos plantados de propósito, como apagar a palavra "não", ler CPF como quantia, trocar "mil" por "milhão", desligar uma regra, ou fazer o comparador aceitar tudo. Cada um tem de deixar vermelho o teste certo, e hoje todos deixam.
- **Navegador** (`npm run test:navegador`):
  - a página entrega à voz o texto preparado, e o texto cru quando a preparação está desligada;
  - nenhuma requisição sai da página;
  - nenhuma rolagem horizontal em 5 tamanhos de tela;
  - alvos de toque de 44 px;
  - botão principal visível sem rolar;
  - voz offline: o modelo roda de verdade no Chromium e o áudio tem energia (um worker sabotado para gerar silêncio deixa o teste vermelho).

```
npm test               # tipos + 232 testes
npm run sabotagem      # 15/15 mutantes pegos
node scripts/preparar-voz-offline.ts   # opcional: baixa e confere a voz offline
npm run demo           # gera a página em demo/
npm run test:navegador # precisa de Python com Playwright
```

Sem dependências em tempo de execução. Node 22.18 ou mais novo para rodar os testes direto do TypeScript.

## Licença

O código do ouvir-ptbr é MIT.

Exceções na pasta `demo/`: `voz-offline.worker.js` (adaptado) e `voz-offline-tokens.js` (copiado) vêm do tiny-voca-ptbr, sob Apache-2.0; a licença e o aviso do autor estão em `demo/LICENSE-tiny-voca-ptbr.txt` e `demo/NOTICE-tiny-voca-ptbr.txt`. Modelo, fonemizador e runtime da voz offline não ficam neste repositório; versões, licenças e créditos em [AVISOS-TERCEIROS.md](AVISOS-TERCEIROS.md).
