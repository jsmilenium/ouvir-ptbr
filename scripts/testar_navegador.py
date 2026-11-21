"""Teste da demo em navegador real (Chromium do Playwright).

Uso: python scripts/testar_navegador.py   (depois de `npm run demo`)

A voz do navegador não pode ser gravada; o teste troca speechSynthesis por um espião e confere o que a
página ENTREGARIA à voz. Também confere: nenhuma requisição para fora do próprio servidor, nenhum erro no
console, nenhuma rolagem horizontal, e grava prints em 4 tamanhos de tela (pasta .tmp/prints).
Sai com código 1 se algo falhar.
"""
import functools
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

RAIZ = Path(__file__).resolve().parent.parent
DEMO = RAIZ / "demo"
PRINTS = RAIZ / ".tmp" / "prints"
PRINTS.mkdir(parents=True, exist_ok=True)

ESPIAO = """
window.__falas = [];
const vozFalsa = (nome, local) => ({ name: nome, lang: 'pt-BR', localService: local, default: false, voiceURI: nome });
const vozes = [vozFalsa('Voz de teste local', true), vozFalsa('Voz de teste online', false)];
const ouvintes = {};
const falso = {
  speaking: false, paused: false, pending: false,
  getVoices: () => vozes,
  speak: (u) => { window.__falas.push({ texto: u.text, voz: u.voice && u.voice.name, rate: u.rate });
                  setTimeout(() => { u.onstart && u.onstart(); setTimeout(() => u.onend && u.onend(), 5); }, 5); },
  cancel: () => {}, pause: () => {}, resume: () => {},
  addEventListener: (t, f) => { ouvintes[t] = f; }, removeEventListener: () => {},
};
Object.defineProperty(window, 'speechSynthesis', { value: falso, configurable: true });
window.SpeechSynthesisUtterance = function (t) { this.text = t; };
"""

falhas = []


def confere(cond, msg):
    print(("OK   " if cond else "FALHA ") + msg)
    if not cond:
        falhas.append(msg)


class Silencioso(http.server.SimpleHTTPRequestHandler):
    # mesmos tipos que o GitHub Pages entrega; sem isso o Windows pode servir .mjs como binário e o módulo é recusado
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, ".mjs": "text/javascript",
                      ".js": "text/javascript", ".wasm": "application/wasm", ".json": "application/json"}

    def log_message(self, *a):
        pass


def main():
    servidor = socketserver.TCPServer(("127.0.0.1", 0), functools.partial(Silencioso, directory=str(DEMO)))
    porta = servidor.server_address[1]
    threading.Thread(target=servidor.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{porta}/"
    externas, erros = [], []

    with sync_playwright() as p:
        nav = p.chromium.launch()
        pagina = nav.new_page()
        pagina.add_init_script(ESPIAO)
        pagina.on("request", lambda r: externas.append(r.url) if not r.url.startswith(base) and not r.url.startswith("data:") else None)
        pagina.on("console", lambda m: erros.append(m.text) if m.type == "error" else None)
        pagina.on("pageerror", lambda e: erros.append(str(e)))
        pagina.goto(base)

        # 1. exemplo do contrato, preparação ligada
        pagina.click("text=Extrato de contrato")
        texto_leitura = pagina.inner_text("#leitura")
        confere("um milhão duzentos e cinquenta mil reais" in texto_leitura, "leitura mostra o valor por extenso")
        confere(pagina.locator("mark.ajustado").count() >= 8, f"trechos destacados: {pagina.locator('mark.ajustado').count()}")
        confere("Nenhuma palavra do seu texto foi apagada" in pagina.inner_text("#resumo"), "resumo honesto aparece")
        pagina.click("#ouvir")
        pagina.wait_for_timeout(400)
        falas = pagina.evaluate("window.__falas")
        tudo = " ".join(f["texto"] for f in falas)
        confere(len(falas) >= 5, f"leitura dividida em frases ({len(falas)})")
        confere(all(len(f["texto"]) <= 230 for f in falas), "nenhuma frase longa demais para o Chrome")
        confere("R$" not in tudo and "um milhão duzentos e cinquenta mil reais" in tudo, "a voz recebe o texto preparado")
        confere(falas[0]["voz"] == "Voz de teste local", "voz local vem primeiro na lista")
        confere(pagina.is_hidden("#alerta"), "sem alerta com voz local")

        # 2. voz online + documento = alerta
        pagina.select_option("#voz", "1")
        confere(pagina.is_visible("#alerta"), "alerta aparece: voz online + CNPJ")
        confere("usa a internet" in pagina.inner_text("#sobre-voz"), "selo diz que a voz usa a internet")

        # 3. preparação desligada: a voz recebe o texto cru
        pagina.evaluate("window.__falas = []")
        pagina.click("text=Preparar números e siglas antes de ler")
        pagina.click("#ouvir")
        pagina.wait_for_timeout(400)
        cru = " ".join(f["texto"] for f in pagina.evaluate("window.__falas"))
        confere("R$ 1.250.000,00" in cru, "desligado: a voz recebe o texto como está")

        # 4. dúvida marcada
        pagina.click("text=Preparar números e siglas antes de ler")
        pagina.fill("#texto", "Placar 3/4 no jogo e use 3/4 da área.")
        confere(pagina.locator("mark.duvida").count() == 1, "'3/4' sem contexto aparece como leitura literal")

        # 4b. voz offline de verdade (modelo rodando na página, sem espião)
        if (DEMO / "modelo" / "model.onnx").exists():
            pagina.click("text=Aviso da Saúde")
            opcoes = pagina.eval_on_selector_all("#voz option", "os => os.map(o => o.textContent)")
            indice = next(i for i, t in enumerate(opcoes) if t.startswith("Voz offline feminina"))
            pagina.select_option("#voz", str(indice))
            confere(pagina.is_hidden("#alerta"), "voz offline não dispara o alerta de internet")
            pagina.click("#ouvir")
            # a CSP da página proíbe eval, então wait_for_function não serve: espera por evaluate
            a = None
            for _ in range(240):
                a = pagina.evaluate("window.__ultimoAudioOffline || null")
                if a:
                    break
                pagina.wait_for_timeout(500)
            if not a:
                print("estado na tela:", pagina.inner_text("#agora"))
                a = {"amostras": 0, "rms": 0.0, "taxa": 24000}
            confere(a["amostras"] > a["taxa"] * 0.5 and a["rms"] > 0.01,
                    f"voz offline gerou som: {a['amostras']} amostras, rms {a['rms']:.3f}")
            pagina.click("#parar")
            pagina.select_option("#voz", "0")
        else:
            print("AVISO: voz offline não testada (rode node scripts/preparar-voz-offline.ts)")

        confere(not externas, f"nenhuma requisição para fora: {externas[:3]}")
        confere(not erros, f"sem erro no console: {erros[:3]}")

        # 5. tamanhos de tela
        for nome, (w, h) in {"1440p": (2560, 1440), "1080p": (1920, 1080), "768": (1366, 768), "celular": (390, 844),
                             "celular360": (360, 740)}.items():
            pagina.set_viewport_size({"width": w, "height": h})
            pagina.click("text=Boletim da igreja")
            largura = pagina.evaluate("document.documentElement.scrollWidth")
            confere(largura <= w, f"{nome}: sem rolagem horizontal ({largura} <= {w})")
            alvos = pagina.evaluate("""[...document.querySelectorAll('button, select, .chave')]
                .filter(e => e.offsetParent).map(e => Math.round(e.getBoundingClientRect().height))""")
            confere(min(alvos) >= 44, f"{nome}: alvos de toque >= 44 px (menor {min(alvos)})")
            if h >= 1000:
                fundo = pagina.evaluate("document.getElementById('ouvir').getBoundingClientRect().bottom")
                confere(fundo <= h, f"{nome}: botão Ouvir visível sem rolar (fim em {round(fundo)} px)")
            pagina.screenshot(path=str(PRINTS / f"{nome}.png"), full_page=True)

        # 6. escuro
        pagina.emulate_media(color_scheme="dark")
        pagina.set_viewport_size({"width": 1366, "height": 768})
        pagina.wait_for_timeout(400)  # transições de cor (0,15 s) terminam antes do print
        fundo_botao = pagina.evaluate("getComputedStyle(document.querySelector('.exemplo')).backgroundColor")
        confere(fundo_botao == "rgb(17, 24, 39)", f"escuro: botão com fundo escuro ({fundo_botao})")
        pagina.screenshot(path=str(PRINTS / "escuro-768.png"), full_page=True)
        nav.close()
    servidor.shutdown()
    print(f"\n{len(falhas)} falha(s)")
    return 1 if falhas else 0


if __name__ == "__main__":
    sys.exit(main())
