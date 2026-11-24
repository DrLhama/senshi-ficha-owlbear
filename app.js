import { OBR, LOCAL, CHAVE_INI, LOCAL_INI, guardar, ler, lerFicha, cabecalhoDe, corSegura } from "./shared.js?v=10";
import { ABAS, ALTURA_MIN, CONFIG, abasDe, lerJanelas, mudarJanela, tirarJanela, abrirPopover, novaJanela, limitar, tela, endereco, canal, coberta } from "./janelas.js?v=10";
import { ID, $, h, icone, botaoIcone, estado, rolagens, salvarUi, definirPintura, redesenhar } from "./nucleo.js?v=10";
import { escutarDados } from "./dados.js?v=10";
import { aplicarMinhaFicha, instalarSoltar } from "./minha.js?v=10";
import { painelAtributos, painelRecursos, painelSkills, painelDados, painelNotas } from "./paineis.js?v=10";
import { INI_VAZIA, painelMesa, painelJogador, painelIniciativa, minhaVez } from "./mestre.js?v=10";

const PAINEIS = { ficha: painelAtributos, recursos: painelRecursos, skills: painelSkills, dados: painelDados, iniciativa: painelIniciativa, notas: painelNotas, mesa: painelMesa, jogador: painelJogador };
const janela = () => lerJanelas()[ID] || {};

// ── a janela ──────────────────────────────────────────────────
function trocarAba(aba) {
  if (aba === estado.aba) return;
  guardarRolagem();
  estado.aba = aba;
  mudarJanela(ID, { aba });
  redesenhar();
}
const guardarRolagem = () => { rolagens[estado.aba] = $("#main").scrollTop; salvarUi(); };

async function minimizar() {
  const min = !janela().min;
  if (min) guardarRolagem();
  mudarJanela(ID, { min });
  await OBR.popover.setHeight(ID, min ? ALTURA_MIN : janela().h);
  redesenhar();
}
let fechada = false;
async function fechar() {
  fechada = true;
  tirarJanela(ID);
  await OBR.popover.close(ID);
}

/** Bordas e canto: arrastar muda o tamanho ao vivo. */
function instalarAlcas() {
  for (const lado of ["l", "b", "c"]) {
    const alca = h("div", { class: "alca " + lado, title: "Arraste para mudar o tamanho" });
    document.body.append(alca);
    alca.addEventListener("pointerdown", async e => {
      if (e.button !== 0 || janela().min) return;
      e.preventDefault();
      alca.setPointerCapture(e.pointerId);
      const x0 = e.screenX, y0 = e.screenY, w0 = innerWidth, h0 = innerHeight, j = janela();
      let quadro = 0, w = w0, hh = h0, t = { w: Infinity, h: Infinity };
      const mexer = ev => {
        if (lado !== "b") w = limitar(w0 + ev.screenX - x0, 240, t.w - j.left - 4);
        if (lado !== "l") hh = limitar(h0 + ev.screenY - y0, 160, t.h - j.top - 4);
        cancelAnimationFrame(quadro);
        quadro = requestAnimationFrame(() => { OBR.popover.setWidth(ID, w); OBR.popover.setHeight(ID, hh); });
      };
      const soltar = () => {
        for (const n of ["pointermove", "pointerup", "pointercancel"]) alca.removeEventListener(n, n === "pointermove" ? mexer : soltar);
        mudarJanela(ID, { w: Math.round(w), h: Math.round(hh) });
      };
      alca.addEventListener("pointermove", mexer);
      alca.addEventListener("pointerup", soltar);
      alca.addEventListener("pointercancel", soltar);
      t = await tela();
    });
  }
}

/** Arrastar pela barra: a janela dá lugar à moldura de arrasto.html, que segue o mouse e reabre a janela ao soltar. */
function instalarArraste() {
  const barra = $("#barra");
  let frente;
  // o Owlbear não traz janela para a frente: um clique na barra reabre a que está coberta (dois cliques minimizam)
  const trazer = () => { clearTimeout(frente); frente = setTimeout(() => { if (canal && coberta(ID)) { guardarRolagem(); canal.postMessage({ t: "reabrir", id: ID }); } }, 260); };
  barra.addEventListener("dblclick", e => { clearTimeout(frente); if (!e.target.closest("button")) minimizar(); });
  barra.addEventListener("pointerdown", e => {
    if (e.target.closest("button") || e.button !== 0) return;
    const x0 = e.clientX, y0 = e.clientY, sx0 = e.screenX, sy0 = e.screenY;
    barra.setPointerCapture(e.pointerId);
    // plano B: move só ao soltar (no toque, o dedo fica preso à janela onde começou)
    const simples = e.pointerType === "touch" || (ler("senshi/arrasto-falhas") || 0) >= 2;
    const limpar = () => { barra.removeEventListener("pointermove", mexer); barra.removeEventListener("pointerup", soltar); };
    async function mexer(ev) {
      if (simples || Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 6) return;
      limpar();
      guardarRolagem();
      const t = await tela();
      await OBR.popover.open({
        id: ID + "-mover", url: endereco("arrasto.html", { id: ID, ox: ev.clientX, oy: ev.clientY }), width: t.w, height: t.h,
        anchorReference: "POSITION", anchorPosition: { left: 0, top: 0 },
        anchorOrigin: { horizontal: "LEFT", vertical: "TOP" }, transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
        hidePaper: true, disableClickAway: true, marginThreshold: 0,
      });
      await OBR.popover.close(ID);
    }
    async function soltar(ev) {
      limpar();
      const dx = ev.screenX - sx0, dy = ev.screenY - sy0, j = janela();
      if (Math.abs(dx) + Math.abs(dy) < 6) return trazer();
      if (!simples) return;
      guardarRolagem();
      mudarJanela(ID, { left: j.left + dx, top: j.top + dy });
      // quem reabre é o fundo: esta janela deixa de existir ao fechar
      if (canal) canal.postMessage({ t: "reabrir", id: ID });
      else { OBR.popover.close(ID); abrirPopover(ID); }
    }
    barra.addEventListener("pointermove", mexer);
    barra.addEventListener("pointerup", soltar);
  });
}

// ── menu da janela ────────────────────────────────────────────
const CHAVE_ZOOM = "senshi/zoom";
const aplicarZoom = () => { $("#main").style.zoom = String(ler(CHAVE_ZOOM) || 1); };
function mudarZoom(delta) {
  guardar(CHAVE_ZOOM, limitar(Math.round(((ler(CHAVE_ZOOM) || 1) + delta) * 100) / 100, 0.7, 1.8));
  aplicarZoom();
}
function alternarMenu(e) {
  e.stopPropagation();
  const aberto = $("#menu");
  if (aberto) return aberto.remove();
  const j = janela(), cfg = ler(CONFIG) || {}, outras = Object.keys(lerJanelas()).length - 1;
  const item = (rotulo, acao, marcado) => h("button", { role: marcado == null ? "menuitem" : "menuitemcheckbox", "aria-checked": marcado == null ? null : String(marcado), onclick: () => { $("#menu")?.remove(); acao(); } }, rotulo, marcado == null ? null : h("i", {}, marcado ? "✓" : ""));
  document.body.append(h("div", { id: "menu", role: "menu" },
    h("div", { class: "linha letra" }, h("span", {}, "Letra"), h("button", { "aria-label": "Letra menor", onclick: () => mudarZoom(-0.1) }, "A−"), h("button", { "aria-label": "Letra maior", onclick: () => mudarZoom(0.1) }, "A+")),
    item("Mostrar abas", () => { mudarJanela(ID, { limpa: !j.limpa }); redesenhar(); }, !j.limpa),
    item("Reabrir janelas ao entrar na sala", () => guardar(CONFIG, { ...cfg, reabrir: cfg.reabrir === false }), cfg.reabrir !== false),
    canal && outras > 0 ? item("Organizar todas as janelas", () => canal.postMessage({ t: "organizar" })) : null,
    canal && outras > 0 ? item("Fechar as outras janelas", () => canal.postMessage({ t: "fechar-outras", menos: ID })) : null));
}
addEventListener("pointerdown", e => { const m = $("#menu"); if (m && !m.contains(e.target) && !e.target.closest("[data-menu]")) m.remove(); });
addEventListener("keydown", e => { if (e.key === "Escape") $("#menu")?.remove(); });

// ── montagem da tela ──────────────────────────────────────────
function desenharBarra() {
  const j = janela(), f = estado.ficha, abas = abasDe(estado.souGM, estado.alvo), vez = minhaVez() && !estado.souGM;
  const raiz = document.documentElement.style;
  raiz.setProperty("--tema", corSegura(f?.cores?.tema, "#a99ad6"));
  raiz.setProperty("--ter", corSegura(f?.cores?.terciaria, "#ece9f5"));
  document.body.classList.toggle("min", !!j.min);
  document.body.classList.toggle("limpa", !!j.limpa);
  document.body.classList.toggle("vez", vez);
  $("#barra").replaceChildren(
    h("span", { class: "selo" }, icone(estado.aba, 16)),
    h("span", { class: "nome-janela" }, h("b", {}, ABAS[estado.aba].titulo), estado.aba === "jogador" ? h("small", {}, cabecalhoDe(estado.jogadores.find(p => p.id === estado.alvo)?.metadata)?.nome || "") : f && estado.aba !== "mesa" ? h("small", {}, f.nome) : null),
    h("div", { class: "fim" },
      botaoIcone("mais", "Abrir outra janela", () => novaJanela({ souGM: estado.souGM })),
      botaoIcone("menu", "Opções da janela", alternarMenu, { "data-menu": "" }),
      botaoIcone(j.min ? "abrir" : "menos", j.min ? "Restaurar" : "Minimizar", minimizar),
      botaoIcone("fechar", "Fechar esta janela", fechar, { class: "ico x" })));
  $("#abas").replaceChildren(...abas.map(a => h("button", {
    role: "tab", "aria-selected": String(a === estado.aba), title: `${ABAS[a].titulo} (botão do meio abre noutra janela)`, "data-aviso": a === "iniciativa" && vez,
    onclick: () => trocarAba(a),
    onauxclick: e => { if (e.button === 1) { e.preventDefault(); novaJanela({ aba: a, alvo: a === "jogador" ? estado.alvo : undefined, souGM: estado.souGM }); } },
  }, icone(a, 17), h("span", {}, a === "jogador" ? "Jogador" : ABAS[a].titulo))));
}

let desenhando = false, pendente = false, ultimaAba = null;
async function desenhar() {
  if (desenhando) { pendente = true; return; }
  desenhando = true;
  try {
    const main = $("#main"), aba = estado.aba;
    desenharBarra();
    const conteudo = await PAINEIS[aba]();
    const ativo = document.activeElement, foco = ativo?.dataset?.foco;
    const antes = foco ? { valor: ativo.value, sel: [ativo.selectionStart, ativo.selectionEnd], mexeu: ativo.value !== ativo.defaultValue } : null;
    const topo = ultimaAba === aba ? main.scrollTop : rolagens[aba] || 0;
    estado.pintando = true;                                // trocar a tela tira o foco do campo: não é o jogador confirmando
    main.replaceChildren(conteudo);
    if (ultimaAba !== aba) { main.classList.remove("entra"); void main.offsetWidth; main.classList.add("entra"); }
    ultimaAba = aba;
    main.scrollTop = topo;
    const novo = foco && main.querySelector(`[data-foco="${CSS.escape(foco)}"]`);
    if (novo) {
      novo.focus();
      // campo de recurso com texto pela metade: continua de onde estava
      if (foco.startsWith("rc:") && antes.mexeu) novo.value = antes.valor;
      try { novo.setSelectionRange(...antes.sel); } catch { /* campo sem seleção */ }
    }
  } finally {
    estado.pintando = false;
    desenhando = false;
    if (pendente) { pendente = false; redesenhar(); }
  }
}

// ── início ────────────────────────────────────────────────────
OBR.onReady(async () => {
  estado.meuId = OBR.player.id;
  const [papel, meta, sala, jogadores] = await Promise.all([OBR.player.getRole(), OBR.player.getMetadata(), OBR.room.getMetadata(), OBR.party.getPlayers()]);
  estado.souGM = papel === "GM";
  estado.ficha = ler(LOCAL) || await lerFicha(meta);
  estado.iniPublica = sala[CHAVE_INI] || null;
  estado.iniMestre = estado.souGM ? (ler(LOCAL_INI) || INI_VAZIA()) : null;
  estado.jogadores = jogadores;
  const j = janela();
  estado.alvo = j.alvo || "";
  estado.aba = abasDe(estado.souGM, estado.alvo).includes(j.aba) ? j.aba : "ficha";

  OBR.party.onChange(lista => { estado.jogadores = lista; redesenhar(); });
  OBR.room.onMetadataChange(m => { estado.iniPublica = m[CHAVE_INI] || null; redesenhar(); });
  // tudo o que outra janela (ou o fundo) grava aparece aqui também
  addEventListener("storage", e => {
    if (!e.key?.startsWith("senshi/") || e.key.startsWith("senshi/ui:") || e.key.startsWith("senshi/janelas")) return;
    if (e.key === LOCAL) estado.ficha = ler(LOCAL);
    if (e.key === LOCAL_INI && estado.souGM) estado.iniMestre = ler(LOCAL_INI) || INI_VAZIA();
    if (e.key === CHAVE_ZOOM) aplicarZoom();
    redesenhar();
  });
  addEventListener("pagehide", () => { if (!fechada) guardarRolagem(); });
  addEventListener("wheel", e => { if (e.ctrlKey) { e.preventDefault(); mudarZoom(e.deltaY < 0 ? 0.05 : -0.05); } }, { passive: false });

  definirPintura(desenhar);
  escutarDados();
  aplicarZoom();
  instalarAlcas();
  instalarArraste();
  instalarSoltar();
  await desenhar();
  if (estado.ficha && !cabecalhoDe(meta)) aplicarMinhaFicha(estado.ficha);
});
