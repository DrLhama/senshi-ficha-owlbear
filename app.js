import { OBR, CHAVE, LOCAL, CANAL_AJUSTE, CHAVE_INI, LOCAL_INI, publicarFicha, cabecalhoDe, lerFicha, guardar, ler } from "./shared.js";

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
  ficha: { titulo: "Ficha", w: 400, h: 660 },
  iniciativa: { titulo: "Iniciativa", w: 360, h: 560 },
  mesa: { titulo: "Mesa", w: 420, h: 660 },
  jogador: { titulo: "Ficha do jogador", w: 420, h: 660 },
};
async function abrirJanela(nome, extra = {}) {
  const cfg = JANELAS[nome];
  const largura = await OBR.viewport.getWidth();
  const esquerda = { ficha: 16, iniciativa: Math.max(16, (largura - cfg.w) / 2), mesa: Math.max(16, largura - cfg.w - 16), jogador: Math.max(16, largura - cfg.w - 60) }[nome];
  const id = `senshi-${nome}${extra.jogador ? "-" + extra.jogador : ""}`;
  const url = new URL("app.html", location.href);
  url.searchParams.set("janela", nome);
  url.searchParams.set("id", id);
  if (extra.jogador) url.searchParams.set("jogador", extra.jogador);
  await OBR.popover.open({
    id, url: url.toString(), width: cfg.w, height: cfg.h,
    anchorReference: "POSITION", anchorPosition: { left: esquerda, top: 70 },
    anchorOrigin: { horizontal: "LEFT", vertical: "TOP" }, transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
    disableClickAway: true,
  });
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
function blocoModo(m, descSkill, jaNoResumo) {
  const extra = [m.resumo, m.desc].find(t => t && t !== descSkill);
  return [
    (!jaNoResumo && (m.acoes?.length || m.custos?.length) || m.pecas?.length) ? h("div", { class: "chips", style: { margin: "4px 0" } },
      !jaNoResumo && (m.acoes || []).map(a => chip("", a)),
      !jaNoResumo && (m.custos || []).map(c => chip("", c, true)),
      (m.pecas || []).map(p => chip(p.rotulo, p.valor))) : null,
    extra ? h("div", { class: "desc" }, extra) : null,
    m.efeitos?.length ? h("ul", {}, m.efeitos.map(e => h("li", {}, e))) : null,
    m.reservas?.length ? h("ul", {}, m.reservas.map(e => h("li", {}, e))) : null,
  ];
}

function skillEl(s, chave) {
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
    desc ? h("div", { class: "desc" }, desc) : null,
    modos.length === 1 && !modos[0].nome
      ? blocoModo(modos[0], desc, true)
      : modos.map(m => h("div", { class: "modo" }, m.nome ? h("h3", {}, m.nome) : null, blocoModo(m, desc))),
    !desc && !modos.length ? h("p", { class: "mudo" }, "Sem descrição.") : null);
  const resumo = h("div", {},
    h("div", { class: "res" }, h("span", { class: s.ligada ? "on" : "" }, s.nome), h("span", { class: "mudo" }, s.tipo + (s.ligada && s.tipo !== "passiva" ? " · ligada" : ""))),
    chips.flat(Infinity).some(Boolean) ? h("div", { class: "chips" }, chips) : null);
  return details(chave, resumo, corpo, "skill");
}

// ── ficha ─────────────────────────────────────────────────────
/** modo: "proprio" (ajusta a ficha local) | "mestre" (pede ao jogador) | "leitura". */
function barra(rc, modo, aoMudar) {
  const pct = rc.max > 0 ? Math.max(0, Math.min(100, (rc.atual / rc.max) * 100)) : 0;
  const passo = (e, sinal) => aoMudar(rc, rc.atual + sinal * (e.shiftKey ? 10 : 1));
  const num = modo === "mestre" ? h("input", { type: "number", min: 0, max: rc.max, value: rc.atual, "aria-label": `${rc.nome} atual`, onchange: e => aoMudar(rc, Number(e.target.value)) }) : null;
  return h("div", { class: "barra" },
    h("div", { class: "topo2" },
      h("span", {}, rc.nome),
      h("span", { class: "ajuste" },
        modo !== "leitura" && h("button", { onclick: e => passo(e, -1), "aria-label": `Diminuir ${rc.nome}` }, "−"),
        num || h("b", {}, rc.atual), h("span", { class: "mudo" }, `/ ${rc.max}`),
        modo !== "leitura" && h("button", { onclick: e => passo(e, 1), "aria-label": `Aumentar ${rc.nome}` }, "+"))),
    h("div", { class: "trilho" }, h("div", { class: "enche", style: { width: pct + "%", background: rc.cor || "var(--tema)" } })));
}

function fichaView(f, modo, chave, aoMudar) {
  const raiz = h("div");
  raiz.style.setProperty("--tema", f.cores.tema);
  raiz.style.setProperty("--sec", f.cores.secundaria);
  raiz.style.setProperty("--ter", f.cores.terciaria);
  const skills = [...(f.skills || [])].sort((a, b) => Number(b.ligada) - Number(a.ligada));
  raiz.append(...[
    h("div", { class: "cab" }, h("strong", {}, f.nome), h("span", { class: "mudo" }, `Nível ${f.nivel}${f.origem ? " · " + f.origem : ""}`)),
    h("h2", {}, "Recursos"),
    f.recursos.map(rc => barra(rc, modo, aoMudar)),
    h("h2", {}, "Atributos"),
    h("div", { class: "attrs" }, f.atributos.map(a => h("div", { class: "attr", style: { borderLeftColor: a.cor } }, h("small", {}, `${a.nome} · ${a.dado}`), h("b", {}, a.valor)))),
    f.secundarios?.length ? [h("h2", {}, "Secundários"), h("div", { class: "chips" }, f.secundarios.map(s => chip(s.nome, s.valor)))] : null,
    h("h2", {}, `Skills (${skills.length})`),
    skills.map((s, i) => skillEl(s, `${chave}:s${i}:${s.nome}`)),
  ].flat(Infinity).filter(Boolean));
  return raiz;
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

function painelFicha() {
  const f = estado.ficha;
  const entrada = h("input", { type: "file", accept: ".json,application/json", class: "oculto", onchange: e => { if (e.target.files[0]) importarArquivo(e.target.files[0]); } });
  if (!f) {
    const caixa = h("div", { class: "vazio" },
      h("p", {}, "Nenhuma ficha importada."),
      h("p", { class: "mudo" }, "No site, abra sua ficha e toque em ", h("b", {}, "Owlbear"), " para baixar o arquivo. Depois solte aqui ou escolha o arquivo."),
      h("button", { onclick: () => entrada.click() }, "Importar ficha"));
    caixa.addEventListener("dragover", e => { e.preventDefault(); caixa.classList.add("arrasta"); });
    caixa.addEventListener("dragleave", () => caixa.classList.remove("arrasta"));
    caixa.addEventListener("drop", e => { e.preventDefault(); caixa.classList.remove("arrasta"); if (e.dataTransfer.files[0]) importarArquivo(e.dataTransfer.files[0]); });
    return h("div", {}, caixa, entrada);
  }
  const quando = f.geradoEm ? new Date(f.geradoEm).toLocaleString("pt-BR") : "";
  return h("div", {},
    (f.v || 1) < 2 ? h("p", { class: "nota alerta" }, "Esta ficha foi baixada numa versão antiga e está com skills cortadas e sem custos. Baixe de novo no site (botão Owlbear) e use Atualizar abaixo.") : null,
    fichaView(f, "proprio", "eu", (rc, novo) => { rc.atual = Math.max(0, Math.min(rc.max, Math.floor(novo))); aplicarMinhaFicha(f); }),
    h("div", { class: "linha", style: { marginTop: "14px" } },
      h("button", { onclick: () => entrada.click() }, "Atualizar (importar de novo)"),
      h("button", { onclick: retirarFicha }, "Remover")),
    h("p", { class: "nota" }, quando ? `Arquivo gerado em ${quando}. Os ajustes de recurso valem na mesa (o mestre também pode mexer neles).` : ""),
    estado.publicacao ? h("p", { class: "nota " + (estado.publicacao.startsWith("Não") ? "alerta" : "ok") }, estado.publicacao) : null,
    entrada);
}

// ── mesa (mestre) ─────────────────────────────────────────────
function pedirAjuste(jogador, rc, novo) {
  const atual = Math.max(0, Math.min(rc.max, Math.floor(novo)));
  rc.atual = atual;                                   // mostra já; o valor real chega pela atualização do jogador
  OBR.broadcast.sendMessage(CANAL_AJUSTE, { para: jogador.id, recurso: rc.id, atual }, { destination: "REMOTE" });
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
const PAINEIS = { ficha: painelFicha, iniciativa: painelIniciativa, mesa: painelMesa, jogador: painelJogador };
let desenhando = false, pendente = false;

async function desenhar() {
  if (desenhando) { pendente = true; return; }
  desenhando = true;
  try {
    const atual = JANELA || abaAtual;
    const main = $("#main");
    const foco = document.activeElement?.dataset?.foco;
    const sel = foco ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    const rolagem = main.scrollTop;
    const conteudo = await PAINEIS[atual]();
    const topo = $("#topo");
    topo.replaceChildren(...(JANELA ? [
      h("span", { class: "titulo" }, JANELAS[JANELA].titulo),
      h("div", { class: "fim" }, h("button", { title: "Fechar esta janela", onclick: () => OBR.popover.close(ID_POP) }, "×")),
    ] : [
      ...["ficha", "iniciativa", ...(estado.souGM ? ["mesa"] : [])].map(a => h("button", { class: "aba", role: "tab", "aria-selected": String(a === atual), onclick: () => { abaAtual = a; guardar("senshi/aba", a); redesenhar(); } }, JANELAS[a].titulo)),
      h("div", { class: "fim" }, h("button", { title: "Abrir esta aba em uma janela separada", onclick: () => abrirJanela(atual) }, "↗")),
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

  if (!estado.souGM && abaAtual === "mesa") abaAtual = "ficha";
  desenhar();
});
