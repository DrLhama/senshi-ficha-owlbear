import { OBR, CHAVE, LOCAL, CANAL_AJUSTE, CHAVE_INI, LOCAL_INI, publicarFicha, cabecalhoDe, lerFicha, guardar, ler, aplicarExpressao, lerCombo } from "./shared.js";

const params = new URLSearchParams(location.search);
const JANELA = params.get("janela");        // null = painel com abas; senão: ficha | iniciativa | mesa | jogador
const ID_POP = params.get("id");
const ALVO = params.get("jogador");         // janela que mostra a ficha de um jogador (só mestre)

/** Cria elemento sem innerHTML: texto vindo de arquivo ou de outro jogador nunca vira HTML. */
function h(tag, props = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "style") Object.assign(el.style, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const f of filhos.flat(Infinity)) if (f != null && f !== false) el.append(f.nodeType ? f : document.createTextNode(String(f)));
  return el;
}

// ── estado ────────────────────────────────────────────────────
const estado = {
  souGM: false, meuId: "",
  ficha: null,            // ficha do próprio jogador (cópia local)
  jogadores: [],          // outros jogadores da sala
  iniPublica: null,       // parte pública da iniciativa (todos leem)
  iniMestre: null,        // iniciativa completa (só o mestre grava)
  publicacao: "",         // resultado da última publicação da ficha
};
const abertos = new Set();                      // <details> abertos, para não fechar a cada atualização
const rascunho = {};                            // texto digitado e ainda não enviado
const cacheFichas = new Map();                  // jogador -> { t, ficha }
let abaAtual = ler("senshi/aba") || "ficha";

const INI_VAZIA = () => ({ ativo: false, combatentes: [], vez: null, turnosPorCiclo: 3, turno: 1, ciclo: 1 });

// ── abrir janelas separadas ───────────────────────────────────
const JANELAS = {
  ficha: { titulo: "Ficha", w: 360, h: 400 },
  recursos: { titulo: "Recursos", w: 320, h: 200 },
  skills: { titulo: "Skills", w: 420, h: 640 },
  iniciativa: { titulo: "Iniciativa", w: 360, h: 560 },
  mesa: { titulo: "Mesa", w: 420, h: 660 },
  jogador: { titulo: "Ficha do jogador", w: 420, h: 660 },
};
// Posição e tamanho de cada janela ficam salvos: o jogador arruma uma vez e a janela abre sempre ali.
const CHAVE_GEOM = "senshi/janelas";
if (ler("senshi/geom-v") !== 2) { const g = ler("senshi/janelas") || {}; delete g.recursos; guardar("senshi/janelas", g); guardar("senshi/geom-v", 2); }
const geomSalva = nome => (ler(CHAVE_GEOM) || {})[nome];
const guardarGeom = (nome, g) => guardar(CHAVE_GEOM, { ...(ler(CHAVE_GEOM) || {}), [nome]: { ...geomSalva(nome), ...g } });
const limitar = (v, min, max) => Math.max(min, Math.min(max, v));

async function abrirJanela(nome, extra = {}) {
  const cfg = JANELAS[nome];
  const largura = await OBR.viewport.getWidth();
  const padrao = { left: { ficha: 16, recursos: 16, skills: 372, iniciativa: Math.max(16, (largura - cfg.w) / 2), mesa: Math.max(16, largura - cfg.w - 16), jogador: Math.max(16, largura - cfg.w - 60) }[nome], top: 70, w: cfg.w, h: nome === "recursos" ? Math.max(120, 56 + 46 * (estado.ficha?.recursos?.length || 3)) : cfg.h };
  const g = { ...padrao, ...geomSalva(nome), ...extra.geom };
  guardarGeom(nome, g);
  const id = `senshi-${nome}${extra.jogador ? "-" + extra.jogador : ""}`;
  const url = new URL("app.html", location.href);
  url.searchParams.set("janela", nome);
  url.searchParams.set("id", id);
  if (extra.jogador) url.searchParams.set("jogador", extra.jogador);
  await OBR.popover.open({
    id, url: url.toString(), width: g.w, height: g.h,
    anchorReference: "POSITION", anchorPosition: { left: g.left, top: g.top },
    anchorOrigin: { horizontal: "LEFT", vertical: "TOP" }, transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
    disableClickAway: true,
  });
}

/** Alça no canto: arrastar muda a largura e a altura da janela ao vivo. */
async function aplicarTamanho(w, hh) {
  if (JANELA) { await OBR.popover.setWidth(ID_POP, w); await OBR.popover.setHeight(ID_POP, hh); guardarGeom(JANELA, { w, h: hh }); }
  else { await OBR.action.setWidth(w); await OBR.action.setHeight(hh); }
}
function instalarAlca() {
  const alca = h("div", { class: "alca", title: "Arraste para aumentar ou diminuir" });
  document.body.append(alca);
  alca.addEventListener("pointerdown", e => {
    e.preventDefault();
    alca.setPointerCapture(e.pointerId);
    const x0 = e.screenX, y0 = e.screenY, w0 = window.innerWidth, h0 = window.innerHeight;
    let quadro = 0;
    const mexer = ev => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => aplicarTamanho(limitar(w0 + ev.screenX - x0, 300, 1100), limitar(h0 + ev.screenY - y0, 240, 1100)));
    };
    const soltar = () => { alca.removeEventListener("pointermove", mexer); alca.removeEventListener("pointerup", soltar); };
    alca.addEventListener("pointermove", mexer);
    alca.addEventListener("pointerup", soltar);
  });
}

const ARRASTO = params.get("arrasto") === "1";
const CHAVE_FALHAS_ARRASTO = "senshi/arrasto-falhas";
const arrastoAoVivoFalhou = () => (ler(CHAVE_FALHAS_ARRASTO) || 0) >= 2;

/** O Owlbear não move janelas de extensão. Então, ao começar a arrastar, a janela dá lugar a uma moldura
 *  transparente do tamanho da tela, onde um contorno acompanha o mouse ao vivo; ao soltar, a janela reabre ali. */
async function iniciarArrasto(g, cx, cy) {
  const largura = await OBR.viewport.getWidth(), altura = await OBR.viewport.getHeight();
  const url = new URL("app.html", location.href);
  const dados = { arrasto: "1", janela: JANELA, id: ID_POP, jogador: ALVO || "", left: g.left, top: g.top, w: window.innerWidth, h: window.innerHeight, ox: cx, oy: cy };
  for (const [k, v] of Object.entries(dados)) if (v !== "") url.searchParams.set(k, v);
  await OBR.popover.close(ID_POP);
  await OBR.popover.open({
    id: ID_POP + "-arrasto", url: url.toString(), width: largura, height: altura,
    anchorReference: "POSITION", anchorPosition: { left: 0, top: 0 },
    anchorOrigin: { horizontal: "LEFT", vertical: "TOP" }, transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
    hidePaper: true, disableClickAway: true, marginThreshold: 0,
  });
}

function instalarArraste() {
  const barra = $("#topo");
  barra.style.cursor = "move";
  barra.title = "Arraste para mover a janela";
  barra.addEventListener("pointerdown", e => {
    if (e.target.closest("button") || e.button !== 0) return;
    const g = geomSalva(JANELA);
    if (typeof g?.left !== "number" || typeof g?.top !== "number") return;
    const x0 = e.clientX, y0 = e.clientY, sx0 = e.screenX, sy0 = e.screenY;
    barra.setPointerCapture(e.pointerId);
    let comecou = false;
    const limpar = () => { barra.removeEventListener("pointermove", mexer); barra.removeEventListener("pointerup", soltar); };
    function mexer(ev) {
      if (comecou || Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 6) return;
      comecou = true;
      if (arrastoAoVivoFalhou()) return;                 // plano B: move só ao soltar
      limpar();
      iniciarArrasto(g, ev.clientX, ev.clientY);
    }
    async function soltar(ev) {
      limpar();
      const dx = ev.screenX - sx0, dy = ev.screenY - sy0;
      if (Math.abs(dx) + Math.abs(dy) < 6) return;
      const largura = await OBR.viewport.getWidth(), altura = await OBR.viewport.getHeight();
      const geom = { left: limitar(g.left + dx, 0, largura - 80), top: limitar(g.top + dy, 0, altura - 60), w: window.innerWidth, h: window.innerHeight };
      await OBR.popover.close(ID_POP);
      await abrirJanela(JANELA, { jogador: ALVO || undefined, geom });
    }
    barra.addEventListener("pointermove", mexer);
    barra.addEventListener("pointerup", soltar);
  });
}

/** A moldura do arrasto: um contorno segue o mouse ao vivo e, ao soltar, a janela real reabre no lugar. */
function modoArrasto() {
  const n = k => Number(params.get(k)) || 0;
  const g = { left: n("left"), top: n("top"), w: n("w"), h: n("h") }, ox = n("ox"), oy = n("oy");
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
  $("#topo").remove(); $("#main").remove();
  const fantasma = h("div", { class: "fantasma", style: { left: g.left + "px", top: g.top + "px", width: g.w + "px", height: g.h + "px" } }, h("span", {}, JANELAS[JANELA]?.titulo || ""));
  fantasma.style.setProperty("--tema", ler(LOCAL)?.cores?.tema || "#9a9aa4");
  document.body.append(fantasma);
  let movido = false, acabou = false, atual = { left: g.left, top: g.top };
  async function terminar(cancelar) {
    if (acabou) return;
    acabou = true;
    if (movido) guardar(CHAVE_FALHAS_ARRASTO, 0);
    else if (!cancelar) guardar(CHAVE_FALHAS_ARRASTO, (ler(CHAVE_FALHAS_ARRASTO) || 0) + 1);   // o mouse não chegou aqui: depois de 2 vezes, usa o arrasto simples
    const final = cancelar ? { left: g.left, top: g.top } : atual;
    await OBR.popover.close(ID_POP + "-arrasto");
    await abrirJanela(JANELA, { jogador: params.get("jogador") || undefined, geom: { left: final.left, top: final.top, w: g.w, h: g.h } });
  }
  window.addEventListener("pointermove", e => {
    if (acabou) return;
    if (e.buttons & 1) {
      movido = true;
      atual = { left: limitar(e.clientX - ox, 0, window.innerWidth - 80), top: limitar(e.clientY - oy, 0, window.innerHeight - 60) };
      fantasma.style.left = atual.left + "px";
      fantasma.style.top = atual.top + "px";
    } else if (movido) terminar(false);                 // soltou o botão
  });
  window.addEventListener("pointerup", () => terminar(false));
  window.addEventListener("keydown", e => { if (e.key === "Escape") terminar(true); });
  setTimeout(() => { if (!movido) terminar(false); }, 1800);   // rede de segurança: a moldura nunca fica presa na tela
}

// Letra maior ou menor, só neste navegador.
const CHAVE_ZOOM = "senshi/zoom";
const aplicarZoom = z => { document.body.style.zoom = String(z); };
const botoesZoom = () => [
  h("button", { title: "Letra menor", "aria-label": "Letra menor", onclick: () => mudarZoom(-0.1) }, "A−"),
  h("button", { title: "Letra maior", "aria-label": "Letra maior", onclick: () => mudarZoom(0.1) }, "A+"),
];
function mudarZoom(delta) {
  const z = limitar(Math.round(((ler(CHAVE_ZOOM) || 1) + delta) * 100) / 100, 0.7, 1.8);
  guardar(CHAVE_ZOOM, z);
  aplicarZoom(z);
}

// ── peças de interface ────────────────────────────────────────
function details(chave, resumo, corpo, classe) {
  const d = h("details", { class: classe });
  d.append(h("summary", {}, resumo), corpo);
  d.open = abertos.has(chave);
  d.addEventListener("toggle", () => {
    if (d.open === abertos.has(chave)) return;        // o próprio redesenho também dispara "toggle"
    if (d.open) abertos.add(chave); else abertos.delete(chave);
    if (chave.startsWith("j:")) redesenhar();         // na Mesa, abrir carrega a ficha inteira
  });
  return d;
}
const chip = (rotulo, valor, custo) => h("span", { class: "chip" + (custo ? " custo" : "") }, rotulo ? rotulo + ": " : "", h("b", {}, valor));

/** Campo de texto cujo conteúdo sobrevive às atualizações automáticas da tela. */
function campo(chave, props = {}) {
  const el = h("input", { type: "text", "data-foco": chave, autocomplete: "off", ...props });
  el.value = rascunho[chave] ?? "";
  el.addEventListener("input", () => { rascunho[chave] = el.value; });
  return el;
}

// ── skills ────────────────────────────────────────────────────
/** Cada linha do combo vira um botão para rolar só ela (sem pagar custo). O botão Usar rola o combo inteiro. */
function linhasDoCombo(m, chave) {
  const linhas = lerCombo(m.rolagem);
  if (linhas.length < 2) return null;
  return h("div", { class: "combo" }, linhas.map(l => h("button", {
    class: "rolar", title: `Rolar só esta linha: ${l.notacao}`,
    onclick: () => rolarSkill(l.rotulo ? `${l.notacao} #${l.rotulo}` : l.notacao, chave),
  }, h("b", {}, l.rotulo || "Dado"), " ", l.notacao)));
}

function blocoModo(m, descSkill, jaNoResumo, rolar) {
  const extra = [m.resumo, m.desc].find(t => t && t !== descSkill);
  return [
    rolar ? h("div", { class: "linha", style: { margin: "6px 0" } }, botaoUsar(rolar.f, rolar.s, rolar.i, rolar.chave)) : null,
    rolar ? linhasDoCombo(m, rolar.chave) : null,
    rolar ? resultadoRolagem(rolar.chave) : null,
    (!jaNoResumo && (m.acoes?.length || m.custos?.length) || m.pecas?.length) ? h("div", { class: "chips", style: { margin: "4px 0" } },
      !jaNoResumo && (m.acoes || []).map(a => chip("", a)),
      !jaNoResumo && (m.custos || []).map(c => chip("", c, true)),
      (m.pecas || []).map(p => chip(p.rotulo, p.valor))) : null,
    extra ? h("div", { class: "desc" }, extra) : null,
    m.efeitos?.length ? h("ul", {}, m.efeitos.map(e => h("li", {}, e))) : null,
    m.reservas?.length ? h("ul", {}, m.reservas.map(e => h("li", {}, e))) : null,
  ];
}

// ── rolagens pelo Dice+ ───────────────────────────────────────
// Protocolo do Dice+ (https://dice-plus.missinglinkdev.com/learn-more): pedido em "dice-plus/roll-request",
// resultado em "<source>/roll-result" e erro em "<source>/roll-error".
const SOURCE = "senshi-ficha-owlbear";
const LINK_DICE_PLUS = "https://dice-plus.missinglinkdev.com/manifest.json";
const ALVOS_ROLAGEM = [["everyone", "Todos veem"], ["dm", "Mestre e eu"], ["self", "Só eu"], ["gm_only", "Só o mestre"]];
const CHAVE_ALVO = "senshi/alvo-rolagem";
const pendentes = new Map();        // rollId -> chave da skill que pediu
const ultimas = new Map();          // chave -> { texto, erro }; "<skill>:ult" guarda a mais recente de qualquer modo
const gravarResultado = (chave, valor) => {
  // o texto de "o que foi gasto" sobrevive ao "Rolando…" e ao resultado dos dados que vêm depois
  const uso = ultimas.get(chave)?.uso;
  const v = { ...(uso && !("uso" in valor) ? { uso } : {}), ...valor };
  ultimas.set(chave, v);
  ultimas.set(chave.slice(0, chave.lastIndexOf(":m")) + ":ult", v);
};

function dicePlusPronto() {
  const requestId = crypto.randomUUID();
  return new Promise(resolve => {
    const parar = OBR.broadcast.onMessage("dice-plus/isReady", ({ data }) => {
      if (data && "ready" in data && data.requestId === requestId) { parar(); resolve(true); }
    });
    OBR.broadcast.sendMessage("dice-plus/isReady", { requestId, timestamp: Date.now() }, { destination: "ALL" });
    setTimeout(() => { parar(); resolve(false); }, 1000);
  });
}

async function rolarSkill(notacao, chave) {
  gravarResultado(chave, { texto: "Rolando…" });
  redesenhar();
  if (!(await dicePlusPronto())) {
    gravarResultado(chave, { erro: "O Dice+ não respondeu. Adicione a extensão no Owlbear (Perfil → Extensions → Add Custom Extension) com o link " + LINK_DICE_PLUS });
    return redesenhar();
  }
  const rollId = "r_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  pendentes.set(rollId, chave);
  await OBR.broadcast.sendMessage("dice-plus/roll-request", {
    rollId, playerId: OBR.player.id, playerName: await OBR.player.getName(),
    rollTarget: ler(CHAVE_ALVO) || "everyone", diceNotation: notacao, showResults: true, timestamp: Date.now(), source: SOURCE,
    dice: { default: estiloDados() },                      // visual dos dados (vale onde o saco do jogador não tem dado daquele tipo)
  }, { destination: "ALL" });
}

function escutarDicePlus() {
  OBR.broadcast.onMessage(SOURCE + "/roll-result", ({ data }) => {
    const chave = pendentes.get(data?.rollId);
    if (!chave) return;
    pendentes.delete(data.rollId);
    gravarResultado(chave, { texto: `${data.result.totalValue} · ${data.result.rollSummary}` });
    redesenhar();
  });
  OBR.broadcast.onMessage(SOURCE + "/roll-error", ({ data }) => {
    const chave = pendentes.get(data?.rollId);
    if (!chave || data.warning) return;
    pendentes.delete(data.rollId);
    gravarResultado(chave, { erro: "Notação inválida no Dice+: " + (data.error?.message || data.error || "erro") });
    redesenhar();
  });
}

// ── usar a skill: liga, paga o custo e rola ────────────────────
const fmtDelta = d => `${d.nome} ${d.delta >= 0 ? "+" : "−"}${Math.abs(d.delta)}`;
const modoLigadoDe = s => s.modoLigado ?? 0;
const estaLigada = (s, i) => s.tipo === "ativa" && !!s.ligada && !s.modos?.[i]?.uso?.unico && modoLigadoDe(s) === i;

/** Recursos que não aguentam o custo (a ficha local é quem manda). */
const faltaRecurso = (f, deltas) => deltas
  .filter(d => { const rc = f.recursos.find(r => r.id === d.id); return rc && rc.atual + d.delta < 0; })
  .map(d => d.nome);

async function usarSkill(f, s, i, chave, forcar) {
  const m = s.modos?.[i];
  let uso = "";
  if (s.tipo === "ativa") {
    if (estaLigada(s, i)) {
      uso = "já ligada";                                   // reusar uma skill sustentada não cobra de novo
    } else {
      const deltas = m?.uso?.deltas || [];
      const faltando = [...new Set([...faltaRecurso(f, deltas), ...(m?.uso?.faltas || [])])];
      if (faltando.length && !forcar) {
        gravarResultado(chave, { uso: undefined, aviso: `Faltam recursos: ${faltando.join(", ")}.`, confirmar: () => usarSkill(f, s, i, chave, true) });
        return redesenhar();
      }
      for (const d of deltas) {
        const rc = f.recursos.find(r => r.id === d.id);
        if (rc) rc.atual = Math.max(0, Math.min(rc.max, rc.atual + d.delta));
      }
      if (!m?.uso?.unico) { s.ligada = true; s.modoLigado = i; }
      uso = deltas.map(fmtDelta).join(" · ") || (m?.uso?.unico ? "usada" : "ligada");
      await aplicarMinhaFicha(f);                          // grava, publica para o mestre e redesenha
    }
  }
  gravarResultado(chave, { uso });
  if (m?.rolagem) await rolarSkill(m.rolagem, chave); else redesenhar();
}

function desligarSkill(f, s) {
  s.ligada = false;
  delete s.modoLigado;
  aplicarMinhaFicha(f);
}

/** O botão da skill: ativa = Usar (liga, paga, rola); passiva com dados = só rola. */
function botaoUsar(f, s, i, chave) {
  const m = s.modos?.[i];
  const dado = m?.rolagem;
  if (s.tipo !== "ativa" && !dado) return null;
  const ligada = estaLigada(s, i);
  if (ligada && !dado) return null;                        // nada a fazer: só dá para desligar
  const custo = (m?.uso?.deltas || []).filter(d => d.delta < 0).map(fmtDelta).join(", ");
  const rotulo = s.tipo !== "ativa" ? `🎲 ${dado}` : ligada ? "🎲 Rolar" : dado ? "🎲 Usar" : "▶ Usar";
  const dica = [
    s.tipo !== "ativa" ? "Rola os dados" : ligada ? "Já ligada: só rola os dados" : "Liga a skill" + (custo ? ` e paga ${custo}` : ""),
    dado ? `dados: ${dado}` : null,
  ].filter(Boolean).join(" · ");
  return h("button", { class: "rolar", title: dica, "aria-label": dica, onclick: e => { e.preventDefault(); e.stopPropagation(); usarSkill(f, s, i, chave); } }, rotulo);
}

const resultadoRolagem = chave => {
  const r = ultimas.get(chave);
  if (!r || !(r.uso || r.aviso || r.erro || r.texto)) return null;
  return h("div", { class: "resultado" + (r.erro || r.aviso ? " erro" : "") },
    r.uso ? h("div", {}, h("b", {}, "Gasto: "), r.uso) : null,
    r.aviso ? h("div", {}, r.aviso) : null,
    r.aviso ? h("div", { class: "linha", style: { marginTop: "5px" } },
      h("button", { onclick: () => r.confirmar() }, "Usar mesmo assim"),
      h("button", { onclick: () => { gravarResultado(chave, { uso: undefined }); ultimas.set(chave, {}); redesenhar(); } }, "Cancelar")) : null,
    r.erro || r.texto ? h("div", {}, r.erro || r.texto) : null);
};

// Texto que o jogador reescreveu (só no navegador dele, por nome de skill). Sobrevive a importar a ficha de novo.
const CHAVE_EDICOES = "senshi/edicoes";
const editando = new Set();

/** Descrição da skill: a do jogador, se ele editou, ou a original. No próprio painel dá para editar. */
function blocoDescricao(s, chave, original, editavel) {
  const edicoes = ler(CHAVE_EDICOES) || {};
  const propria = editavel ? edicoes[s.nome] : undefined;
  const texto = propria ?? original;
  const gravar = valor => {
    const todas = ler(CHAVE_EDICOES) || {};
    if (valor == null) delete todas[s.nome]; else todas[s.nome] = valor;
    guardar(CHAVE_EDICOES, todas);
    editando.delete(chave); delete rascunho["ed:" + chave];
    redesenhar();
  };
  if (editando.has(chave)) {
    const area = h("textarea", { "data-foco": "ed:" + chave, rows: 8, "aria-label": `Texto de ${s.nome}` });
    area.value = rascunho["ed:" + chave] ?? texto;
    area.addEventListener("input", () => { rascunho["ed:" + chave] = area.value; });
    return h("div", {}, area,
      h("div", { class: "linha", style: { marginTop: "6px" } },
        h("button", { onclick: () => gravar(area.value.trim() && area.value.trim() !== original ? area.value.trim() : null) }, "Salvar"),
        h("button", { onclick: () => { editando.delete(chave); delete rascunho["ed:" + chave]; redesenhar(); } }, "Cancelar"),
        propria != null ? h("button", { onclick: () => gravar(null) }, "Voltar ao original") : null));
  }
  return h("div", {},
    texto ? h("div", { class: "desc" }, texto) : null,
    editavel ? h("div", { class: "linha", style: { margin: "0 0 6px" } },
      h("button", { onclick: () => { editando.add(chave); redesenhar(); } }, texto ? "✎ Editar texto" : "✎ Escrever texto"),
      propria != null ? h("span", { class: "mudo" }, "(texto seu)") : null) : null);
}

// ── skills do jogador: tirar da lista, criar e editar ──────────
// O que o jogador tira da lista fica guardado por nome (sobrevive a importar a ficha de novo).
// As skills criadas por ele ficam na própria ficha, marcadas com `propria`, e são levadas junto ao importar.
const CHAVE_OCULTAS = "senshi/skills-ocultas";
const ocultasDoJogador = () => new Set(ler(CHAVE_OCULTAS) || []);
const confirmando = new Set();        // skills com o pedido "tem certeza?" aberto
const formAberto = new Set();         // formulários de skill abertos: "nova" ou o nome da skill

function tirarDaLista(nome) {
  const t = ocultasDoJogador(); t.add(nome);
  guardar(CHAVE_OCULTAS, [...t]);
  redesenhar();
}
const restaurarOcultas = () => { guardar(CHAVE_OCULTAS, []); redesenhar(); };

function abrirFormSkill(f, original) {
  const k = original?.nome || "nova";
  const m = original?.modos?.[0];
  const d = m?.uso?.deltas?.[0];
  Object.assign(rascunho, {
    [`sk:${k}:nome`]: original?.nome || "", [`sk:${k}:tipo`]: original?.tipo || "ativa", [`sk:${k}:desc`]: original?.desc || "",
    [`sk:${k}:dados`]: m?.rolagem || "", [`sk:${k}:rec`]: d?.id || "", [`sk:${k}:custo`]: d ? String(Math.abs(d.delta)) : "", [`sk:${k}:erro`]: "",
  });
  formAberto.add(k);
  redesenhar();
}
function fecharFormSkill(k) {
  formAberto.delete(k);
  for (const c of ["nome", "tipo", "desc", "dados", "rec", "custo", "erro"]) delete rascunho[`sk:${k}:${c}`];
  redesenhar();
}

function salvarSkill(f, original) {
  const k = original?.nome || "nova";
  const r = c => rascunho[`sk:${k}:${c}`] ?? "";
  const nome = r("nome").trim();
  if (!nome) { rascunho[`sk:${k}:erro`] = "Dê um nome para a skill."; return redesenhar(); }
  if (f.skills.some(x => x.nome === nome && x !== original)) { rascunho[`sk:${k}:erro`] = "Já existe uma skill com esse nome."; return redesenhar(); }
  const valor = Math.max(0, Math.floor(Number(r("custo")) || 0));
  const recurso = f.recursos.find(x => x.id === r("rec"));
  const deltas = recurso && valor ? [{ id: recurso.id, nome: recurso.nome, delta: -valor }] : [];
  const nova = {
    propria: true, nome, tipo: r("tipo") === "passiva" ? "passiva" : "ativa", ligada: original?.ligada || false,
    custo: "", cd: "", acoes: [], desc: r("desc").trim(),
    modos: [{ nome: "", acoes: [], resumo: "", desc: "", rolagem: r("dados").trim(), uso: { deltas, faltas: [], unico: false }, custos: deltas.map(d => `${d.nome} ${d.delta}`), pecas: [], efeitos: [], reservas: [] }],
  };
  if (original?.modoLigado != null) nova.modoLigado = original.modoLigado;
  if (original) f.skills[f.skills.indexOf(original)] = nova; else f.skills.push(nova);
  fecharFormSkill(k);
  aplicarMinhaFicha(f);
}

function formularioSkill(f, original) {
  const k = original?.nome || "nova";
  const sel = (campo, opcoes) => Object.assign(h("select", { onchange: e => { rascunho[`sk:${k}:${campo}`] = e.target.value; } }, opcoes.map(([v, t]) => h("option", { value: v }, t))), { value: rascunho[`sk:${k}:${campo}`] ?? "" });
  const area = h("textarea", { "data-foco": `sk:${k}:desc`, rows: 3, placeholder: "O que ela faz (um lembrete curto basta)" });
  area.value = rascunho[`sk:${k}:desc`] ?? "";
  area.addEventListener("input", () => { rascunho[`sk:${k}:desc`] = area.value; });
  const erro = rascunho[`sk:${k}:erro`];
  return h("div", { class: "form-skill" },
    h("strong", {}, original ? "Editar skill" : "Nova skill"),
    campo(`sk:${k}:nome`, { placeholder: "Nome", "aria-label": "Nome da skill" }),
    h("div", { class: "grade2" },
      sel("tipo", [["ativa", "Ativa"], ["passiva", "Passiva"]]),
      campo(`sk:${k}:dados`, { placeholder: "Dados · ex.: 1d20+5, 2d8", "aria-label": "Dados da skill", spellcheck: "false" })),
    area,
    h("div", { class: "grade2" },
      sel("rec", [["", "Sem custo"], ...f.recursos.map(x => [x.id, `Custa ${x.nome}`])]),
      campo(`sk:${k}:custo`, { placeholder: "Quanto custa", inputmode: "numeric", "aria-label": "Valor do custo" })),
    erro ? h("p", { class: "nota alerta" }, erro) : null,
    h("div", { class: "linha" }, h("button", { class: "rolar", onclick: () => salvarSkill(f, original) }, "Salvar"), h("button", { onclick: () => fecharFormSkill(k) }, "Cancelar")));
}

/** Botões no fim da skill: editar/excluir (as do jogador) ou tirar da lista (as da ficha), sempre com confirmação. */
function acoesDaSkill(f, s, chave) {
  const confirma = confirmando.has(chave);
  const pergunta = (rotulo, aoConfirmar) => confirma
    ? h("span", { class: "linha" }, h("button", { class: "perigo", onclick: aoConfirmar }, "Confirmar"), h("button", { onclick: () => { confirmando.delete(chave); redesenhar(); } }, "Cancelar"))
    : h("button", { onclick: () => { confirmando.add(chave); redesenhar(); } }, rotulo);
  return h("div", { class: "linha acoes-skill" },
    s.propria ? h("button", { onclick: () => abrirFormSkill(f, s) }, "✎ Editar skill") : null,
    s.propria
      ? pergunta("Excluir", () => { confirmando.delete(chave); f.skills.splice(f.skills.indexOf(s), 1); aplicarMinhaFicha(f); })
      : pergunta("Tirar da lista", () => { confirmando.delete(chave); tirarDaLista(s.nome); }));
}

function skillEl(s, chave, editavel, f) {
  const desc = s.desc ?? s.texto ?? "";             // v1 só tinha "texto"
  const modos = s.modos || [];
  const custosDosModos = [...new Set(modos.flatMap(m => m.custos || []))];
  const chips = [
    s.custo ? chip("Custo", s.custo, true) : null,
    s.cd ? chip("Recarga", s.cd.replace(/^recarga:?\s*/i, "")) : null,
    (s.acoes || []).map(a => chip("", a)),
    custosDosModos.map(c => chip("", c, true)),
  ];
  const corpo = h("div", { class: "corpo" },
    editavel && formAberto.has(s.nome) ? formularioSkill(f, s) : null,
    blocoDescricao(s, chave, desc, editavel),
    modos.length === 1 && !modos[0].nome
      ? blocoModo(modos[0], desc, true, editavel ? { f, s, i: 0, chave: `${chave}:m0` } : null)
      : modos.map((m, i) => h("div", { class: "modo" }, m.nome ? h("h3", {}, m.nome) : null, blocoModo(m, desc, false, editavel ? { f, s, i, chave: `${chave}:m${i}` } : null))),
    !desc && !modos.length ? h("p", { class: "mudo" }, "Sem descrição.") : null,
    editavel ? acoesDaSkill(f, s, chave) : null);
  // botão do resumo: o modo que está ligado, ou o primeiro com dados ou custo (ou o primeiro)
  const iResumo = !editavel || !modos.length ? -1
    : s.ligada ? Math.min(modoLigadoDe(s), modos.length - 1)
    : Math.max(0, modos.findIndex(m => m.rolagem || m.uso?.deltas?.length));
  const estaLigadaNaLista = s.tipo === "ativa" && !!s.ligada;
  const podeDesligar = editavel && s.tipo === "ativa" && s.ligada && !modos[iResumo]?.uso?.unico;
  const resumo = h("div", {},
    h("div", { class: "res" }, h("span", { class: "nome-skill" }, s.nome),
      h("span", { class: "linha" },
        iResumo >= 0 ? botaoUsar(f, s, iResumo, `${chave}:m${iResumo}`) : null,
        podeDesligar ? h("button", { class: "rolar", title: "Desliga a skill (o custo já pago não volta)", onclick: e => { e.preventDefault(); e.stopPropagation(); desligarSkill(f, s); } }, "Desligar") : null,
        estaLigadaNaLista ? h("span", { class: "selo-ligada" }, "LIGADA") : null)),
    iResumo >= 0 ? resultadoRolagem(`${chave}:ult`) : null,
    chips.flat(Infinity).some(Boolean) ? h("div", { class: "chips" }, chips) : null);
  const el = details(chave, resumo, corpo, "skill");
  if (estaLigadaNaLista) el.dataset.ligada = "";
  return el;
}

// ── ficha ─────────────────────────────────────────────────────
/** modo: "proprio" (ajusta a ficha local) | "mestre" (pede ao jogador) | "leitura". */
const ultimoValor = new Map();      // recurso -> valor da última tela, para perceber o que mudou
const mudancas = new Map();         // recurso -> { delta, desde }: o aviso de "−20" dura ~2 s mesmo que a tela redesenhe
const DURACAO_AVISO = 2200;

function barra(rc, modo, aoMudar, id) {
  const pct = rc.max > 0 ? Math.max(0, Math.min(100, (rc.atual / rc.max) * 100)) : 0;
  const antes = ultimoValor.get(id);
  ultimoValor.set(id, rc.atual);
  if (antes !== undefined && antes !== rc.atual) mudancas.set(id, { delta: rc.atual - antes, desde: Date.now() });
  const mudou = mudancas.get(id);
  const passou = mudou ? Date.now() - mudou.desde : Infinity;
  const aviso = mudou && passou < DURACAO_AVISO ? mudou : null;
  const sentido = aviso ? (aviso.delta < 0 ? "perde" : "ganha") : null;
  // aoMudar recebe o texto digitado (25, +25, -25, -50%…): quem interpreta é aplicarExpressao
  const passo = (e, sinal) => aoMudar(rc, (sinal < 0 ? "-" : "+") + (e.shiftKey ? 10 : 1));
  const aplicar = campo => { const t = campo.value.trim(); if (t && t !== String(rc.atual)) aoMudar(rc, t); else campo.value = rc.atual; };
  const num = modo !== "leitura" ? h("input", {
    type: "text", inputmode: "text", class: "valor", value: rc.atual, autocomplete: "off", spellcheck: "false",
    "aria-label": `${rc.nome} atual`,
    title: "Digite 25 para definir, +25 ou -25 para somar ou tirar, 50% para definir em metade do máximo, -50% para tirar metade do máximo. Enter aplica.",
    onfocus: e => e.target.select(),
    onkeydown: e => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { e.target.value = rc.atual; e.target.blur(); } },
    onblur: e => aplicar(e.target),
  }) : null;
  if (num && sentido) num.classList.add("mudou-" + sentido);
  // o aviso entra já no ponto da animação em que estava, para não recomeçar a cada redesenho
  const atraso = aviso ? { animationDelay: `-${passou}ms` } : {};
  return h("div", { class: "barra" },
    h("div", { class: "topo2" },
      h("span", {}, rc.nome),
      h("span", { class: "ajuste" },
        aviso ? h("span", { class: "delta " + sentido, style: atraso }, `${aviso.delta > 0 ? "+" : "−"}${Math.abs(aviso.delta)}`) : null,
        modo !== "leitura" && h("button", { onclick: e => passo(e, -1), "aria-label": `Diminuir ${rc.nome}` }, "−"),
        num || h("b", {}, rc.atual), h("span", { class: "mudo" }, `/ ${rc.max}`),
        modo !== "leitura" && h("button", { onclick: e => passo(e, 1), "aria-label": `Aumentar ${rc.nome}` }, "+"))),
    h("div", { class: "trilho" }, h("div", { class: "enche " + (sentido || ""), style: { width: pct + "%", background: rc.cor || "var(--tema)", ...atraso } })));
}

/** Recipiente com as cores da ficha como variáveis (o tema do jogador vale em cada janela). */
function comTema(f, ...filhos) {
  const raiz = h("div", {}, ...filhos);
  raiz.style.setProperty("--tema", f.cores.tema);
  raiz.style.setProperty("--sec", f.cores.secundaria);
  raiz.style.setProperty("--ter", f.cores.terciaria);
  return raiz;
}

const secaoRecursos = (f, modo, chave, aoMudar) => f.recursos.map(rc => barra(rc, modo, aoMudar, `${chave}:${rc.id}`));

/** As skills ficam na ordem da ficha: ligar uma não a muda de lugar. A chave usa o nome, não a posição. */
const skillsVisiveis = (f, modo) => modo === "proprio" ? (f.skills || []).filter(s => !ocultasDoJogador().has(s.nome)) : (f.skills || []);

function listaSkills(f, modo, chave) {
  const vistos = {};
  return skillsVisiveis(f, modo).map(s => skillEl(s, `${chave}:s:${s.nome}${(vistos[s.nome] = (vistos[s.nome] || 0) + 1) > 1 ? "#" + vistos[s.nome] : ""}`, modo === "proprio", f));
}

const cabecalhoFicha = f => h("div", { class: "cab" }, h("strong", {}, f.nome), h("span", { class: "mudo" }, `Nível ${f.nivel}${f.origem ? " · " + f.origem : ""}`));
const blocoAtributos = f => [
  h("div", { class: "attrs" }, f.atributos.map(a => h("div", { class: "attr", style: { borderLeftColor: a.cor } }, h("small", {}, `${a.nome} · ${a.dado}`), h("b", {}, a.valor)))),
  f.secundarios?.length ? [h("h2", {}, "Secundários"), h("div", { class: "chips" }, f.secundarios.map(s => chip(s.nome, s.valor)))] : null,
];

function fichaView(f, modo, chave, aoMudar) {
  return comTema(f,
    cabecalhoFicha(f),
    secaoRecursos(f, modo, chave, aoMudar),
    h("h2", {}, "Atributos"),
    blocoAtributos(f),
    h("h2", {}, `Skills (${skillsVisiveis(f, modo).length})`),
    listaSkills(f, modo, chave));
}

async function aplicarMinhaFicha(f) {
  estado.ficha = f;
  guardar(LOCAL, f);
  const r = await publicarFicha(f);
  estado.publicacao = r.ok ? `Publicada para a mesa (${(r.bytes / 1024).toFixed(1)} KB comprimidos).` : `Não consegui publicar para a mesa: ${r.erro}`;
  redesenhar();
}

function importarArquivo(arquivo) {
  const leitor = new FileReader();
  leitor.onload = () => {
    try {
      const dados = JSON.parse(String(leitor.result));
      if (dados?.formato !== "senshi-owlbear") throw new Error("Esse não é o arquivo do Owlbear. No site, use o botão Owlbear nos controles da ficha (não o botão JSON).");
      const novas = dados.skills || (dados.skills = []);
      for (const propria of (estado.ficha?.skills || []).filter(s => s.propria)) if (!novas.some(x => x.nome === propria.nome)) novas.push(propria);
      aplicarMinhaFicha(dados);
    } catch (e) { alert(e instanceof Error ? e.message : "Arquivo inválido."); }
  };
  leitor.readAsText(arquivo);
}

async function retirarFicha() {
  const meta = await OBR.player.getMetadata();
  const limpa = { [CHAVE]: undefined };
  for (let i = 0; i < (cabecalhoDe(meta)?.n || 0); i++) limpa[CHAVE + i] = undefined;
  estado.ficha = null;
  try { localStorage.removeItem(LOCAL); } catch { /* ignora */ }
  try { await OBR.player.setMetadata(limpa); } catch { /* ignora */ }
  estado.publicacao = "";
  redesenhar();
}

const novaEntradaArquivo = () => h("input", { type: "file", accept: ".json,application/json", class: "oculto", onchange: e => { if (e.target.files[0]) importarArquivo(e.target.files[0]); } });

function painelSemFicha() {
  const entrada = novaEntradaArquivo();
  const caixa = h("div", { class: "vazio" },
    h("p", {}, "Nenhuma ficha importada."),
    h("p", { class: "mudo" }, "No site, abra sua ficha e toque em ", h("b", {}, "Owlbear"), " para baixar o arquivo. Depois solte aqui ou escolha o arquivo."),
    h("button", { onclick: () => entrada.click() }, "Importar ficha"));
  caixa.addEventListener("dragover", e => { e.preventDefault(); caixa.classList.add("arrasta"); });
  caixa.addEventListener("dragleave", () => caixa.classList.remove("arrasta"));
  caixa.addEventListener("drop", e => { e.preventDefault(); caixa.classList.remove("arrasta"); if (e.dataTransfer.files[0]) importarArquivo(e.dataTransfer.files[0]); });
  return h("div", {}, caixa, entrada);
}

/** Ajusta um recurso da ficha do próprio jogador (texto digitado ou botões) e publica para a mesa. */
const mudarRecurso = f => (rc, expr) => {
  const novo = aplicarExpressao(rc.atual, rc.max, expr);
  if (novo == null) return redesenhar();
  rc.atual = novo;
  aplicarMinhaFicha(f);
};

// ── quem vê as rolagens (Dice+) ───────────────────────────────
const seletorQuemVe = () => h("label", { class: "linha mudo", style: { margin: "0 0 8px" } }, "Quem vê as rolagens",
  Object.assign(h("select", { "aria-label": "Quem vê as rolagens", onchange: e => guardar(CHAVE_ALVO, e.target.value) },
    ALVOS_ROLAGEM.map(([v, t]) => h("option", { value: v }, t))), { value: ler(CHAVE_ALVO) || "everyone" }));

const luz = hex => { const n = parseInt(String(hex).replace("#", "").padEnd(6, "0").slice(0, 6), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };

/** Visual dos dados enviado ao Dice+: a cor da ficha. (O saco de dados do próprio jogador no Dice+ vale mais.) */
function estiloDados() {
  const tema = estado.ficha?.cores?.tema || "#9a9aa4";
  return { color: tema, numberColor: luz(tema) > 0.55 ? "#10101a" : "#ffffff", metalness: 0.5, roughness: 0.3, sheen: 0.4 };
}

// ── janelas separadas: só recursos e só skills ────────────────
/** Janela pequena e fixa: só as barras. */
function painelRecursos() {
  const f = estado.ficha;
  if (!f) return painelSemFicha();
  return comTema(f, secaoRecursos(f, "proprio", "rc", mudarRecurso(f)));
}

function painelSkills() {
  const f = estado.ficha;
  if (!f) return painelSemFicha();
  const fora = (f.skills || []).length - skillsVisiveis(f, "proprio").length;
  return comTema(f,
    seletorQuemVe(),
    formAberto.has("nova") ? formularioSkill(f, null) : h("button", { onclick: () => abrirFormSkill(f, null) }, "＋ Nova skill"),
    h("div", { style: { height: "10px" } }),
    listaSkills(f, "proprio", "eu"),
    fora ? h("p", { class: "nota" }, `${fora} skill${fora > 1 ? "s" : ""} fora da lista. `, h("button", { class: "link", onclick: restaurarOcultas }, "Mostrar de novo")) : null);
}

/** A janela da Ficha: só os atributos. */
function painelAtributos() {
  const f = estado.ficha;
  if (!f) return painelSemFicha();
  return comTema(f, cabecalhoFicha(f), blocoAtributos(f));
}

/** O painel do botão da barra lateral: abre cada parte numa janela fixa na tela e cuida do arquivo da ficha. */
function painelHub() {
  const f = estado.ficha;
  const entrada = novaEntradaArquivo();
  const lanca = (nome, rotulo, dica) => h("button", { class: "lanca", title: "Abre uma janela fixa na tela", onclick: () => abrirJanela(nome) }, h("b", {}, rotulo), h("small", {}, dica));
  return h("div", {},
    f ? comTema(f, cabecalhoFicha(f)) : null,
    h("div", { class: "lancador" },
      lanca("ficha", "Ficha", "Atributos"),
      lanca("recursos", "Recursos", "Vida, mana…"),
      lanca("skills", "Skills", "Usar e rolar"),
      lanca("iniciativa", "Iniciativa", "Turnos e ciclos"),
      estado.souGM ? lanca("mesa", "Mesa", "Fichas dos jogadores") : null),
    f ? null : h("div", { style: { marginTop: "12px" } }, painelSemFicha()),
    f && (f.v || 1) < 3 ? h("p", { class: "nota alerta" }, "Esta ficha foi baixada numa versão antiga: faltam descrições inteiras, dados ou o custo automático das skills. Baixe de novo no site (botão Owlbear) e use Atualizar abaixo.") : null,
    estado.publicacao.startsWith("Não") ? h("p", { class: "nota alerta" }, estado.publicacao) : null,   // só avisa quando falha
    f ? h("div", { class: "linha", style: { marginTop: "12px" } },
      h("button", { onclick: () => entrada.click() }, "Atualizar ficha"),
      h("button", { onclick: retirarFicha }, "Remover")) : null,
    entrada);
}

// ── mesa (mestre) ─────────────────────────────────────────────
function pedirAjuste(jogador, rc, expr) {
  const novo = aplicarExpressao(rc.atual, rc.max, expr);
  if (novo == null) return redesenhar();              // texto que não faz sentido: só volta ao valor
  rc.atual = novo;                                    // mostra já; o valor real chega pela atualização do jogador
  OBR.broadcast.sendMessage(CANAL_AJUSTE, { para: jogador.id, recurso: rc.id, expr }, { destination: "REMOTE" });
  redesenhar();
}

async function fichaDe(p) {
  const cab = cabecalhoDe(p.metadata);
  if (!cab) return null;
  const guardada = cacheFichas.get(p.id);
  if (guardada?.t === cab.t) return guardada.ficha;
  const ficha = await lerFicha(p.metadata);
  if (ficha) cacheFichas.set(p.id, { t: cab.t, ficha });
  return ficha;
}

async function painelMesa() {
  const raiz = h("div", {}, h("h2", {}, "Fichas da mesa"));
  if (!estado.jogadores.length) raiz.append(h("p", { class: "nota" }, "Ninguém mais na sala."));
  for (const p of estado.jogadores) {
    const cab = cabecalhoDe(p.metadata);
    const chave = `j:${p.id}`;
    const aberto = abertos.has(chave);
    const ficha = aberto ? await fichaDe(p) : null;
    const corpo = h("div", { class: "interno" },
      cab ? null : h("p", { class: "mudo" }, "Esse jogador ainda não importou a ficha."),
      cab && !ficha ? h("p", { class: "mudo" }, "Carregando a ficha…") : null,
      ficha ? fichaView(ficha, "mestre", chave, (rc, novo) => pedirAjuste(p, rc, novo)) : null,
      cab ? h("div", { class: "linha", style: { marginTop: "10px" } }, h("button", { onclick: () => abrirJanela("jogador", { jogador: p.id }) }, "↗ Abrir em janela")) : null);
    const resumo = h("div", { class: "linha", style: { justifyContent: "space-between", width: "100%" } },
      h("span", {}, h("b", {}, p.name || "Jogador"), cab ? h("span", { class: "mudo" }, " · " + cab.nome) : h("span", { class: "mudo" }, " · sem ficha")),
      cab ? h("span", { class: "chips" }, cab.recursos.slice(0, 3).map(r => chip(r.nome, `${r.atual}/${r.max}`))) : null);
    raiz.append(details(chave, resumo, corpo, "jogador"));
  }
  return raiz;
}

async function painelJogador() {
  const p = estado.jogadores.find(x => x.id === ALVO);
  if (!p) return h("p", { class: "nota" }, "Esse jogador não está mais na sala.");
  const ficha = await fichaDe(p);
  if (!ficha) return h("p", { class: "nota" }, `${p.name || "Jogador"} ainda não importou a ficha.`);
  return fichaView(ficha, "mestre", `jj:${p.id}`, (rc, novo) => pedirAjuste(p, rc, novo));
}

// ── iniciativa ────────────────────────────────────────────────
const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));

async function salvarIni(ini) {
  estado.iniMestre = ini;
  guardar(LOCAL_INI, ini);
  const visiveis = ini.combatentes.filter(c => c.visivel);
  const vez = ini.combatentes.find(c => c.id === ini.vez);
  const publica = {
    ativo: ini.ativo, turnosPorCiclo: ini.turnosPorCiclo, turno: ini.turno, ciclo: ini.ciclo,
    vez: vez ? (vez.visivel ? vez.id : "?") : null,                       // quem está oculto não aparece pelo nome
    combatentes: visiveis.map(({ id, nome, jogador }) => ({ id, nome, jogador })),
  };
  estado.iniPublica = publica;
  try { await OBR.room.setMetadata({ [CHAVE_INI]: publica }); } catch { /* sem permissão: segue local */ }
  redesenhar();
}

function avancar(ini, sentido) {
  const n = ini.combatentes.length;
  if (!n) return ini;
  const i = Math.max(0, ini.combatentes.findIndex(c => c.id === ini.vez));
  const prox = { ...ini, vez: ini.combatentes[(i + sentido + n) % n].id };
  prox.turno += sentido;
  if (prox.turno > prox.turnosPorCiclo) { prox.turno = 1; prox.ciclo += 1; }
  if (prox.turno < 1) { prox.turno = prox.turnosPorCiclo; prox.ciclo = Math.max(1, prox.ciclo - 1); }
  return prox;
}

function contador(ini) {
  return h("div", { class: "ini-contador" },
    h("div", {}, h("span", { class: "mudo" }, "Ciclo"), h("b", {}, ini.ciclo)),
    h("div", {}, h("span", { class: "mudo" }, "Turno"), h("b", {}, `${ini.turno}/${ini.turnosPorCiclo}`)));
}

function painelIniciativaMestre() {
  const ini = estado.iniMestre || INI_VAZIA();
  const mudar = alteracao => salvarIni({ ...ini, ...alteracao });
  const lista = ini.combatentes;
  const mover = (i, d) => { const c = [...lista]; const j = i + d; if (j < 0 || j >= c.length) return; [c[i], c[j]] = [c[j], c[i]]; mudar({ combatentes: c }); };
  const jogadoresOpcoes = estado.jogadores;

  const adicionar = () => {
    const nome = (rascunho["ini-nome"] || "").trim();
    if (!nome) return;
    const jogador = rascunho["ini-jogador"] || undefined;
    rascunho["ini-nome"] = ""; rascunho["ini-jogador"] = "";
    const combatentes = [...lista, { id: novoId(), nome, visivel: rascunho["ini-visivel"] !== "0", jogador }];
    mudar({ combatentes, vez: ini.vez ?? combatentes[0].id });
  };
  const nomeEl = campo("ini-nome", { placeholder: "Nome do combatente", "aria-label": "Nome do combatente", onkeydown: e => { if (e.key === "Enter") adicionar(); } });
  const sel = h("select", { "aria-label": "Vincular a um jogador", onchange: e => { rascunho["ini-jogador"] = e.target.value; } },
    h("option", { value: "" }, "Sem ficha vinculada"),
    jogadoresOpcoes.map(p => h("option", { value: p.id }, `Ficha de ${p.name || "jogador"}`)));
  sel.value = rascunho["ini-jogador"] || "";
  const visivel = h("input", { type: "checkbox", onchange: e => { rascunho["ini-visivel"] = e.target.checked ? "1" : "0"; } });
  visivel.checked = rascunho["ini-visivel"] !== "0";

  return h("div", {},
    contador(ini),
    h("div", { class: "linha", style: { margin: "8px 0" } },
      ini.ativo
        ? [h("button", { onclick: () => mudar(avancar(ini, -1)) }, "◀ Anterior"), h("button", { onclick: () => mudar(avancar(ini, 1)), style: { flex: 1, borderColor: "var(--tema)" } }, "Próximo turno ▶"), h("button", { onclick: () => mudar({ ativo: false }) }, "Encerrar")]
        : [h("button", { onclick: () => mudar({ ativo: true, ciclo: 1, turno: 1, vez: lista[0]?.id ?? null }), disabled: !lista.length, style: { flex: 1 } }, "Iniciar combate"),]),
    h("label", { class: "linha mudo" }, "Turnos por ciclo",
      h("input", { type: "number", min: 1, max: 99, value: ini.turnosPorCiclo, style: { width: "70px" }, onchange: e => mudar({ turnosPorCiclo: Math.max(1, Math.floor(Number(e.target.value)) || 1) }) })),
    h("p", { class: "nota" }, "Cada clique em Próximo turno passa a vez ao combatente seguinte e conta 1 turno. Ao completar os turnos do ciclo, começa o ciclo seguinte."),
    h("h2", {}, "Combatentes"),
    h("ul", { class: "ini-lista" }, lista.length ? lista.map((c, i) => h("li", { "data-vez": ini.ativo && c.id === ini.vez, "data-oculto": !c.visivel },
      h("button", { title: "Dar a vez a este combatente", onclick: () => mudar({ vez: c.id }), "aria-label": `Dar a vez a ${c.nome}` }, c.id === ini.vez ? "▶" : "·"),
      h("span", { class: "nome", title: c.nome }, c.nome),
      c.jogador && estado.jogadores.some(p => p.id === c.jogador) ? h("button", { title: "Abrir a ficha", onclick: () => abrirJanela("jogador", { jogador: c.jogador }) }, "ficha") : null,
      h("button", { title: c.visivel ? "Visível para os jogadores. Clique para ocultar." : "Oculto dos jogadores. Clique para mostrar.", onclick: () => mudar({ combatentes: lista.map(x => x.id === c.id ? { ...x, visivel: !x.visivel } : x) }) }, c.visivel ? "👁" : "—"),
      h("button", { onclick: () => mover(i, -1), "aria-label": "Subir", disabled: i === 0 }, "↑"),
      h("button", { onclick: () => mover(i, 1), "aria-label": "Descer", disabled: i === lista.length - 1 }, "↓"),
      h("button", { onclick: () => { const combatentes = lista.filter(x => x.id !== c.id); mudar({ combatentes, vez: ini.vez === c.id ? (combatentes[Math.min(i, combatentes.length - 1)]?.id ?? null) : ini.vez }); }, "aria-label": `Remover ${c.nome}` }, "×")))
      : [h("li", { class: "mudo" }, "Nenhum combatente ainda.")]),
    h("h2", {}, "Adicionar"),
    nomeEl,
    h("div", { class: "grade2", style: { marginTop: "6px" } }, sel, h("label", { class: "linha mudo" }, visivel, "visível aos jogadores")),
    h("button", { onclick: adicionar, style: { marginTop: "6px", width: "100%" } }, "Adicionar combatente"),
    lista.length ? h("button", { style: { marginTop: "12px" }, onclick: () => { if (confirm("Limpar toda a lista de combatentes?")) mudar({ ...INI_VAZIA(), turnosPorCiclo: ini.turnosPorCiclo }); } }, "Limpar lista") : null);
}

function painelIniciativaJogador() {
  const ini = estado.iniPublica;
  if (!ini?.ativo) return h("div", { class: "vazio" }, "Nenhum combate em andamento.");
  const vezOculta = ini.vez === "?";
  return h("div", {},
    contador(ini),
    vezOculta ? h("p", { class: "nota" }, "Agora é a vez de alguém que você ainda não percebeu…") : null,
    h("ul", { class: "ini-lista" }, ini.combatentes.map(c => h("li", { "data-vez": c.id === ini.vez },
      h("span", {}, c.id === ini.vez ? "▶" : "·"),
      h("span", { class: "nome" }, c.nome),
      c.jogador === estado.meuId ? h("span", { class: "voce" }, "você") : null))));
}

const painelIniciativa = () => estado.souGM ? painelIniciativaMestre() : painelIniciativaJogador();

// ── montagem da tela ──────────────────────────────────────────
const PAINEIS = { hub: painelHub, ficha: painelAtributos, recursos: painelRecursos, skills: painelSkills, iniciativa: painelIniciativa, mesa: painelMesa, jogador: painelJogador };
let desenhando = false, pendente = false;

async function desenhar() {
  if (desenhando) { pendente = true; return; }
  desenhando = true;
  try {
    const atual = JANELA || "hub";
    const main = $("#main");
    const foco = document.activeElement?.dataset?.foco;
    const sel = foco ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    const rolagem = main.scrollTop;
    const conteudo = await PAINEIS[atual]();
    const topo = $("#topo");
    topo.replaceChildren(...(JANELA ? [
      h("span", { class: "titulo" }, JANELAS[JANELA].titulo),
      h("div", { class: "fim" }, botoesZoom(), h("button", { title: "Fechar esta janela", onclick: () => OBR.popover.close(ID_POP) }, "×")),
    ] : [
      h("span", { class: "titulo" }, "Senshi"),
      h("div", { class: "fim" }, botoesZoom()),
    ]));
    main.replaceChildren(conteudo);
    main.scrollTop = rolagem;
    if (foco) {
      const novo = document.querySelector(`[data-foco="${foco}"]`);
      if (novo) { novo.focus(); try { novo.setSelectionRange(...sel); } catch { /* campo sem seleção */ } }
    }
  } finally {
    desenhando = false;
    if (pendente) { pendente = false; redesenhar(); }
  }
}
let temporizador;
function redesenhar() { clearTimeout(temporizador); temporizador = setTimeout(desenhar, 40); }
function $(sel) { return document.querySelector(sel); }

// ── início ────────────────────────────────────────────────────
OBR.onReady(async () => {
  if (ARRASTO) return modoArrasto();
  estado.meuId = OBR.player.id;
  estado.souGM = (await OBR.player.getRole()) === "GM";
  const meta = await OBR.player.getMetadata();
  estado.ficha = ler(LOCAL) || await lerFicha(meta);
  if (estado.ficha && !cabecalhoDe(meta)) aplicarMinhaFicha(estado.ficha);

  const sala = await OBR.room.getMetadata();
  estado.iniPublica = sala[CHAVE_INI] || null;
  estado.iniMestre = estado.souGM ? (ler(LOCAL_INI) || INI_VAZIA()) : null;
  estado.jogadores = await OBR.party.getPlayers();

  OBR.party.onChange(jogadores => { estado.jogadores = jogadores; redesenhar(); });
  OBR.room.onMetadataChange(m => { estado.iniPublica = m[CHAVE_INI] || null; redesenhar(); });
  // o fundo muda a ficha quando o mestre ajusta um recurso: acompanha a cópia local
  window.addEventListener("storage", e => { if (e.key === LOCAL) { estado.ficha = ler(LOCAL); redesenhar(); } });

  if (!JANELA) OBR.action.setHeight(estado.souGM ? 470 : 410).catch(() => {});
  escutarDicePlus();
  aplicarZoom(ler(CHAVE_ZOOM) || 1);
  instalarAlca();
  if (JANELA) instalarArraste();
  desenhar();
});
