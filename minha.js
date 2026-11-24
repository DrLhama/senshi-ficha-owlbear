import { OBR, CHAVE, LOCAL, HISTORICO, publicarFicha, cabecalhoDe, guardar, ler, aplicarExpressao, registrar } from "./shared.js?v=10";
import { h, estado, redesenhar } from "./nucleo.js?v=10";

// ── a ficha do próprio jogador ────────────────────────────────
export async function aplicarMinhaFicha(f) {
  estado.ficha = f;
  guardar(LOCAL, f);
  redesenhar();
  const r = await publicarFicha(f);
  estado.publicacao = r.ok ? "" : `Não consegui publicar para a mesa: ${r.erro}`;
  if (!r.ok) redesenhar();
}

/** Ajusta um recurso (texto digitado ou botões), anota no histórico e publica para a mesa. */
export const mudarRecurso = f => (rc, expr) => {
  const novo = aplicarExpressao(rc.atual, rc.max, expr);
  if (novo == null) return redesenhar();
  registrar(rc, rc.atual, novo);
  rc.atual = novo;
  aplicarMinhaFicha(f);
};

/** Volta a última mudança de recurso, de onde quer que ela tenha vindo. */
export function desfazer() {
  const [ultima, ...resto] = ler(HISTORICO) || [];
  const rc = ultima && estado.ficha?.recursos.find(r => r.id === ultima.id);
  guardar(HISTORICO, resto);
  if (!rc) return redesenhar();
  // desfaz a diferença, e não o valor: o que mudou depois por outro motivo continua valendo
  rc.atual = Math.max(0, Math.min(rc.max, rc.atual + ultima.de - ultima.para));
  aplicarMinhaFicha(estado.ficha);
}

export function importarArquivo(arquivo) {
  const leitor = new FileReader();
  leitor.onload = () => {
    try {
      const dados = JSON.parse(String(leitor.result));
      if (dados?.formato !== "senshi-owlbear") throw new Error("Esse não é o arquivo do Owlbear. No site, use o botão Owlbear nos controles da ficha (não o botão JSON).");
      const novas = dados.skills || (dados.skills = []);
      for (const propria of (estado.ficha?.skills || []).filter(s => s.propria)) if (!novas.some(x => x.nome === propria.nome)) novas.push(propria);
      aplicarMinhaFicha(dados);
      OBR.notification.show(`Ficha de ${dados.nome} carregada.`, "SUCCESS");
    } catch (e) { OBR.notification.show(e instanceof Error ? e.message : "Arquivo inválido.", "ERROR"); }
  };
  leitor.readAsText(arquivo);
}

export async function retirarFicha() {
  const meta = await OBR.player.getMetadata();
  const limpa = { [CHAVE]: undefined };
  for (let i = 0; i < (cabecalhoDe(meta)?.n || 0); i++) limpa[CHAVE + i] = undefined;
  estado.ficha = null;
  estado.publicacao = "";
  try { localStorage.removeItem(LOCAL); } catch { /* ignora */ }
  try { await OBR.player.setMetadata(limpa); } catch { /* ignora */ }
  redesenhar();
}

export const novaEntradaArquivo = () => h("input", { type: "file", accept: ".json,application/json", class: "oculto", onchange: e => { if (e.target.files[0]) importarArquivo(e.target.files[0]); } });

/** Soltar o arquivo da ficha em qualquer lugar da janela importa. */
export function instalarSoltar() {
  addEventListener("dragover", e => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); document.body.classList.add("soltando"); } });
  addEventListener("dragleave", e => { if (!e.relatedTarget) document.body.classList.remove("soltando"); });
  addEventListener("drop", e => {
    document.body.classList.remove("soltando");
    if (e.dataTransfer?.files?.[0]) { e.preventDefault(); importarArquivo(e.dataTransfer.files[0]); }
  });
}

export function semFicha() {
  const entrada = novaEntradaArquivo();
  return h("div", { class: "vazio" },
    h("p", {}, h("b", {}, "Nenhuma ficha aqui ainda")),
    h("p", { class: "mudo" }, "No site, abra sua ficha e toque em ", h("b", {}, "Owlbear"), " para baixar o arquivo. Depois solte em qualquer lugar desta janela ou escolha o arquivo."),
    h("button", { class: "forte", onclick: () => entrada.click() }, "Importar ficha"), entrada);
}

// Retrato: só no navegador do jogador, pequeno.
const RETRATO = "senshi/retrato";
export const retrato = () => ler(RETRATO);
export function trocarRetrato() {
  const entrada = h("input", { type: "file", accept: "image/*" });
  entrada.onchange = async () => {
    try {
      const bmp = await createImageBitmap(entrada.files[0]), lado = Math.min(bmp.width, bmp.height), c = h("canvas", { width: 192, height: 192 });
      // pega o quadrado de cima: em retrato vertical, o rosto costuma estar lá
      c.getContext("2d").drawImage(bmp, (bmp.width - lado) / 2, (bmp.height - lado) * 0.15, lado, lado, 0, 0, 192, 192);
      guardar(RETRATO, c.toDataURL("image/webp", 0.85));
      redesenhar();
    } catch { OBR.notification.show("Não consegui abrir essa imagem.", "ERROR"); }
  };
  entrada.click();
}
