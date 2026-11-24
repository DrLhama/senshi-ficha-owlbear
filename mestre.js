import { OBR, CANAL_AJUSTE, CHAVE_INI, LOCAL_INI, cabecalhoDe, lerFicha, guardar, aplicarExpressao } from "./shared.js?v=11";
import { h, botaoIcone, estado, abertos, rascunho, ui, redesenhar, details, titulo, campo, seletor, confirmar } from "./nucleo.js?v=11";
import { barra, fichaView } from "./paineis.js?v=11";
import { novaJanela } from "./janelas.js?v=11";

// ── mesa (mestre) ─────────────────────────────────────────────
function pedirAjuste(jogador, rc, expr) {
  const novo = aplicarExpressao(rc.atual, rc.max, expr);
  if (novo == null) return redesenhar();              // texto que não faz sentido: só volta ao valor
  rc.atual = novo;                                    // mostra já; o valor real chega pela atualização do jogador
  OBR.broadcast.sendMessage(CANAL_AJUSTE, { para: jogador.id, recurso: rc.id, expr }, { destination: "REMOTE" });
  redesenhar();
}

const cacheFichas = new Map();                        // jogador -> { t, ficha }
async function fichaDe(p) {
  const cab = cabecalhoDe(p.metadata);
  if (!cab) return null;
  const guardada = cacheFichas.get(p.id);
  if (guardada?.t === cab.t) return guardada.ficha;
  const ficha = await lerFicha(p.metadata);
  if (ficha) cacheFichas.set(p.id, { t: cab.t, ficha });
  return ficha;
}
const abrirFicha = id => novaJanela({ aba: "jogador", alvo: id, souGM: true });

/** Um ajuste só para vários jogadores: escolhe quem, qual recurso e quanto. */
function areaDeEfeito(comFicha) {
  const marcados = new Set(ui.area || []);
  const nomes = [...new Set(comFicha.flatMap(p => cabecalhoDe(p.metadata).recursos.map(r => r.nome)))];
  const nome = nomes.includes(ui.areaRecurso) ? ui.areaRecurso : nomes[0];
  const alvos = comFicha.filter(p => marcados.has(p.id));
  const aplicar = () => {
    const expr = (rascunho["area"] || "").trim();
    const validos = alvos.map(p => [p, cabecalhoDe(p.metadata).recursos.find(r => r.nome === nome)]).filter(([, rc]) => rc);
    if (!validos.length || aplicarExpressao(1, 1, expr) == null) return OBR.notification.show("Marque ao menos um jogador e digite um valor, como -25 ou +50%.", "WARNING");
    for (const [p, rc] of validos) pedirAjuste(p, rc, expr);
    rascunho["area"] = "";
    OBR.notification.show(`${nome} ${expr} em ${validos.length} jogador${validos.length > 1 ? "es" : ""}.`, "SUCCESS");
  };
  return h("div", { class: "form-skill" },
    h("div", { class: "filtros" },
      h("button", { onclick: () => { ui.area = alvos.length === comFicha.length ? [] : comFicha.map(p => p.id); redesenhar(); } }, alvos.length === comFicha.length ? "Nenhum" : "Todos"),
      comFicha.map(p => h("button", { "aria-pressed": String(marcados.has(p.id)), onclick: () => { marcados.has(p.id) ? marcados.delete(p.id) : marcados.add(p.id); ui.area = [...marcados]; redesenhar(); } }, cabecalhoDe(p.metadata).nome || p.name))),
    h("div", { class: "linha" },
      seletor(nomes.map(n => [n, n]), nome, v => { ui.areaRecurso = v; redesenhar(); }, { "aria-label": "Recurso" }),
      campo("area", { placeholder: "-25, +10, -50%", "aria-label": "Quanto", onkeydown: e => { if (e.key === "Enter") aplicar(); } }),
      h("button", { class: "forte", onclick: aplicar }, "Aplicar")));
}

export async function painelMesa() {
  const raiz = h("div", {});
  const comFicha = estado.jogadores.filter(p => cabecalhoDe(p.metadata));
  if (!estado.jogadores.length) raiz.append(h("p", { class: "vazio mudo" }, "Ninguém mais na sala."));
  if (comFicha.length) raiz.append(details("j:area", h("b", {}, "Efeito em área"), areaDeEfeito(comFicha), "bloco"));
  for (const p of estado.jogadores) {
    const cab = cabecalhoDe(p.metadata), chave = `j:${p.id}`;
    const ficha = abertos.has(chave) ? await fichaDe(p) : null;
    raiz.append(h("div", { class: "cartao", style: { "--tema": /^#[0-9a-f]{3,8}$/i.test(p.color) ? p.color : "#9a9aa4" } },
      h("div", { class: "jogador-topo" }, h("i", { class: "bola" }), h("b", {}, cab?.nome || p.name || "Jogador"),
        h("span", { class: "mudo" }, cab ? p.name : "ainda sem ficha"),
        cab ? botaoIcone("janela", "Abrir a ficha numa janela", () => abrirFicha(p.id)) : null),
      cab ? cab.recursos.map(rc => barra(rc, "mestre", (r, expr) => pedirAjuste(p, r, expr), `m:${p.id}:${rc.id}`)) : null,
      cab ? details(chave, h("span", { class: "mudo" }, "Ver a ficha inteira"), ficha ? fichaView(ficha, "mestre", chave, (rc, novo) => pedirAjuste(p, rc, novo)) : h("p", { class: "mudo" }, "Carregando a ficha…"), "bloco") : null));
  }
  return raiz;
}

export async function painelJogador() {
  const p = estado.jogadores.find(x => x.id === estado.alvo);
  if (!p) return h("p", { class: "vazio mudo" }, "Esse jogador não está na sala agora.");
  const ficha = await fichaDe(p);
  if (!ficha) return h("p", { class: "vazio mudo" }, `${p.name || "Jogador"} ainda não importou a ficha.`);
  return fichaView(ficha, "mestre", `jj:${p.id}`, (rc, novo) => pedirAjuste(p, rc, novo));
}

// ── iniciativa ────────────────────────────────────────────────
const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
export const INI_VAZIA = () => ({ ativo: false, combatentes: [], vez: null, turnosPorCiclo: 3, turno: 1, ciclo: 1 });

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
  redesenhar();
  try { await OBR.room.setMetadata({ [CHAVE_INI]: publica }); } catch { OBR.notification.show("O Owlbear não aceitou publicar a iniciativa.", "ERROR"); }
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
    h("div", {}, h("span", { class: "mudo" }, "Turno"), h("b", {}, ini.turno, h("small", {}, `/${ini.turnosPorCiclo}`)),
      h("div", { class: "pontos" }, Array.from({ length: Math.min(12, ini.turnosPorCiclo) }, (_, i) => h("i", { "data-cheio": i < ini.turno })))));
}

let arrastando = null;
function painelMestre() {
  const ini = estado.iniMestre || INI_VAZIA();
  const mudar = alteracao => salvarIni({ ...ini, ...alteracao });
  const lista = ini.combatentes;
  const por = (c, patch) => mudar({ combatentes: lista.map(x => x.id === c.id ? { ...x, ...patch } : x) });
  const mover = (de, para) => { if (para < 0 || para >= lista.length || de === para) return; const c = [...lista]; c.splice(para, 0, ...c.splice(de, 1)); mudar({ combatentes: c }); };
  const juntar = novos => { if (novos.length) { const combatentes = [...lista, ...novos]; mudar({ combatentes, vez: ini.vez ?? combatentes[0].id }); } };

  const adicionar = () => {
    const texto = (rascunho["ini-nome"] || "").trim();
    if (!texto) return;
    const jogador = rascunho["ini-jogador"] || undefined, visivel = rascunho["ini-visivel"] !== "0";
    // "Goblin x3" cria Goblin 1, Goblin 2 e Goblin 3
    const m = jogador ? null : /^(.+?)\s+x(\d{1,2})$/i.exec(texto);
    rascunho["ini-nome"] = ""; rascunho["ini-jogador"] = "";
    juntar(m ? Array.from({ length: Math.max(1, Math.min(20, Number(m[2]))) }, (_, i) => ({ id: novoId(), nome: `${m[1]} ${i + 1}`, visivel })) : [{ id: novoId(), nome: texto, visivel, jogador }]);
  };
  const faltam = estado.jogadores.filter(p => cabecalhoDe(p.metadata) && !lista.some(c => c.jogador === p.id));
  const visivel = h("input", { type: "checkbox", onchange: e => { rascunho["ini-visivel"] = e.target.checked ? "1" : "0"; } });
  visivel.checked = rascunho["ini-visivel"] !== "0";

  const linha = (c, i) => {
    const p = c.jogador && estado.jogadores.find(x => x.id === c.jogador), cab = p && cabecalhoDe(p.metadata), vida = cab?.recursos?.[0];
    const valor = h("input", { type: "number", class: "ini-valor", placeholder: "–", title: "Valor da iniciativa, usado pelo botão Ordenar", "aria-label": `Iniciativa de ${c.nome}`, "data-foco": "iv:" + c.id, onchange: e => por(c, { valor: e.target.value === "" ? undefined : Number(e.target.value) }) });
    valor.value = c.valor ?? "";
    return h("li", {
      draggable: "true", "data-vez": ini.ativo && c.id === ini.vez, "data-oculto": !c.visivel,
      ondragstart: e => { arrastando = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.nome); },
      ondragover: e => { if (arrastando != null) e.preventDefault(); },
      ondrop: e => { if (arrastando != null) { e.preventDefault(); e.stopPropagation(); mover(arrastando, i); } arrastando = null; },
      ondragend: () => { arrastando = null; },
    },
    h("button", { class: "marca", title: "Dar a vez a este combatente", onclick: () => mudar({ vez: c.id }), "aria-label": `Dar a vez a ${c.nome}` }, c.id === ini.vez ? "▶" : i + 1),
    valor,
    h("span", { class: "nome", title: c.nome }, c.nome, vida ? h("span", { class: "fio", style: { "--p": (vida.max > 0 ? Math.max(0, Math.min(100, vida.atual / vida.max * 100)) : 0) + "%", "--cor": /^#[0-9a-f]{3,8}$/i.test(vida.cor) ? vida.cor : "var(--tema)" }, title: `${vida.nome} ${vida.atual}/${vida.max}` }) : null),
    p && cab ? botaoIcone("jogador", "Abrir a ficha", () => abrirFicha(p.id)) : null,
    h("button", { class: "ico", title: c.visivel ? "Visível para os jogadores. Clique para ocultar." : "Oculto dos jogadores. Clique para mostrar.", "aria-label": c.visivel ? `Ocultar ${c.nome}` : `Mostrar ${c.nome}`, onclick: () => por(c, { visivel: !c.visivel }) }, c.visivel ? "👁" : "—"),
    h("span", { class: "sobe" }, h("button", { onclick: () => mover(i, i - 1), "aria-label": `Subir ${c.nome}`, disabled: i === 0 }, "▴"), h("button", { onclick: () => mover(i, i + 1), "aria-label": `Descer ${c.nome}`, disabled: i === lista.length - 1 }, "▾")),
    botaoIcone("fechar", `Remover ${c.nome}`, () => { const combatentes = lista.filter(x => x.id !== c.id); mudar({ combatentes, vez: ini.vez === c.id ? (combatentes[Math.min(i, combatentes.length - 1)]?.id ?? null) : ini.vez }); }));
  };

  return h("div", {},
    contador(ini),
    h("div", { class: "linha", style: { margin: "10px 0" } },
      ini.ativo
        ? [h("button", { onclick: () => mudar(avancar(ini, -1)), "aria-label": "Turno anterior" }, "◀"), h("button", { class: "forte cresce", onclick: () => mudar(avancar(ini, 1)) }, "Próximo turno ▶"), confirmar("ini-fim", "Encerrar", () => mudar({ ativo: false }))]
        : h("button", { class: "forte cresce", onclick: () => mudar({ ativo: true, ciclo: 1, turno: 1, vez: lista[0]?.id ?? null }), disabled: !lista.length }, "Iniciar combate")),
    h("label", { class: "linha mudo", title: "Cada Próximo turno passa a vez e conta 1 turno. Ao completar os turnos do ciclo, começa o ciclo seguinte." }, "Turnos por ciclo",
      h("input", { type: "number", min: 1, max: 99, value: ini.turnosPorCiclo, style: { width: "70px" }, onchange: e => mudar({ turnosPorCiclo: Math.max(1, Math.floor(Number(e.target.value)) || 1) }) })),
    titulo("Combatentes", lista.some(c => c.valor != null) ? h("button", { class: "link", title: "Do maior valor para o menor", onclick: () => mudar({ combatentes: [...lista].sort((a, b) => (b.valor ?? -Infinity) - (a.valor ?? -Infinity)) }) }, "Ordenar") : null),
    h("ul", { class: "ini-lista" }, lista.length ? lista.map(linha) : h("li", { class: "mudo" }, "Nenhum combatente ainda.")),
    titulo("Adicionar", faltam.length ? h("button", { class: "link", onclick: () => juntar(faltam.map(p => ({ id: novoId(), nome: cabecalhoDe(p.metadata).nome || p.name, visivel: true, jogador: p.id }))) }, `Todos os jogadores (${faltam.length})`) : null),
    h("div", { class: "linha" }, campo("ini-nome", { placeholder: "Nome, ou Goblin x3", "aria-label": "Nome do combatente", onkeydown: e => { if (e.key === "Enter") adicionar(); } }), h("button", { class: "forte", onclick: adicionar }, "＋")),
    h("div", { class: "grade2", style: { marginTop: "6px" } },
      seletor([["", "Sem ficha vinculada"], ...estado.jogadores.map(p => [p.id, `Ficha de ${p.name || "jogador"}`])], rascunho["ini-jogador"] || "", v => { rascunho["ini-jogador"] = v; }, { "aria-label": "Vincular a um jogador" }),
      h("label", { class: "linha mudo" }, visivel, "visível aos jogadores")),
    lista.length ? h("div", { class: "linha rodape" }, confirmar("ini-limpar", "Limpar lista", () => mudar({ ...INI_VAZIA(), turnosPorCiclo: ini.turnosPorCiclo }))) : null);
}

export const minhaVez = () => { const i = estado.iniPublica; return !!i?.ativo && !!i.combatentes?.some(c => c.id === i.vez && c.jogador === estado.meuId); };

function painelDoJogador() {
  const ini = estado.iniPublica;
  if (!ini?.ativo) return h("p", { class: "vazio mudo" }, "Nenhum combate em andamento.");
  const i = ini.combatentes.findIndex(c => c.id === ini.vez), eu = ini.combatentes.findIndex(c => c.jogador === estado.meuId);
  const falta = i >= 0 && eu >= 0 ? (eu - i + ini.combatentes.length) % ini.combatentes.length : -1;
  return h("div", {},
    minhaVez() ? h("div", { class: "sua-vez" }, "É a sua vez") : null,
    contador(ini),
    ini.vez === "?" ? h("p", { class: "nota" }, "Agora é a vez de alguém que você ainda não percebeu…") : falta > 0 ? h("p", { class: "nota" }, falta === 1 ? "Você é o próximo da lista." : `Faltam ${falta} até a sua vez, contando só quem você vê.`) : null,
    h("ul", { class: "ini-lista" }, ini.combatentes.map((c, k) => h("li", { "data-vez": c.id === ini.vez },
      h("span", { class: "marca" }, c.id === ini.vez ? "▶" : k + 1),
      h("span", { class: "nome" }, c.nome),
      c.jogador === estado.meuId ? h("span", { class: "voce" }, "você") : null))));
}

export const painelIniciativa = () => estado.souGM ? painelMestre() : painelDoJogador();
