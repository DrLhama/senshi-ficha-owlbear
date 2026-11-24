import { HISTORICO, VERSAO, guardar, ler, corSegura } from "./shared.js?v=10";
import { h, icone, botaoIcone, estado, rascunho, ui, redesenhar, details, chip, titulo, campo, seletor, confirmar } from "./nucleo.js?v=10";
import { ALVOS_ROLAGEM, CHAVE_ALVO, CHAVE_ROLAGENS, CHAVE_SISTEMA, SISTEMAS, rolar, ultimas, notacaoDoAtributo } from "./dados.js?v=10";
import { mudarRecurso, desfazer, retirarFicha, novaEntradaArquivo, semFicha, retrato, trocarRetrato } from "./minha.js?v=10";
import { FILTROS, formAberto, abrirFormSkill, formularioSkill, restaurarOcultas, skillsVisiveis, skillsFiltradas, listaSkills } from "./skills.js?v=10";

// ── recursos ──────────────────────────────────────────────────
const ultimoValor = new Map();      // recurso -> valor da última tela, para perceber o que mudou
const mudancas = new Map();         // recurso -> { delta, desde }: o aviso de "−20" dura ~2 s mesmo que a tela redesenhe
const DURACAO_AVISO = 2200;
const PASSOS = ["-25", "-10", "-5", "+5", "+10", "+25"];

/** modo: "proprio" (ajusta a ficha local) | "mestre" (pede ao jogador) | "leitura". aoMudar recebe o texto digitado. */
export function barra(rc, modo, aoMudar, id, rapido) {
  const pct = rc.max > 0 ? Math.max(0, Math.min(100, (rc.atual / rc.max) * 100)) : 0;
  const antes = ultimoValor.get(id);
  ultimoValor.set(id, rc.atual);
  if (antes !== undefined && antes !== rc.atual) mudancas.set(id, { delta: rc.atual - antes, desde: Date.now() });
  const mudou = mudancas.get(id);
  const passou = mudou ? Date.now() - mudou.desde : Infinity;
  const aviso = mudou && passou < DURACAO_AVISO ? mudou : null;
  const sentido = aviso ? (aviso.delta < 0 ? "perde" : "ganha") : null;
  const passo = (e, sinal) => aoMudar(rc, (sinal < 0 ? "-" : "+") + (e.shiftKey ? 10 : 1));
  const aplicar = c => { const t = c.value.trim(); if (t && t !== String(rc.atual)) aoMudar(rc, t); else c.value = rc.atual; };
  const num = modo !== "leitura" ? h("input", {
    type: "text", inputmode: "text", class: "valor", value: rc.atual, autocomplete: "off", spellcheck: "false", "data-foco": "rc:" + id,
    "aria-label": `${rc.nome} atual`,
    title: "Digite 25 para definir, +25 ou -25 para somar ou tirar, 50% para definir em metade do máximo, -50% para tirar metade do máximo. Enter aplica.",
    onfocus: e => e.target.select(),
    onkeydown: e => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") { e.target.value = rc.atual; e.target.blur(); } },
    onblur: e => { if (!estado.pintando) aplicar(e.target); },
  }) : null;
  if (num && sentido) num.classList.add("mudou-" + sentido);
  // o aviso entra já no ponto da animação em que estava, para não recomeçar a cada redesenho
  const atraso = aviso ? { animationDelay: `-${passou}ms` } : {};
  return h("div", { class: "barra" + (pct <= 25 ? " baixo" : ""), style: { "--cor": corSegura(rc.cor, "var(--tema)") } },
    h("div", { class: "topo2" },
      h("span", { class: "rotulo" }, rc.nome),
      h("span", { class: "ajuste" },
        aviso ? h("span", { class: "delta " + sentido, style: atraso }, `${aviso.delta > 0 ? "+" : "−"}${Math.abs(aviso.delta)}`) : null,
        modo !== "leitura" && h("button", { class: "redondo", title: "−1 (com Shift, −10)", onclick: e => passo(e, -1), "aria-label": `Diminuir ${rc.nome}` }, "−"),
        num || h("b", {}, rc.atual), h("span", { class: "mudo" }, `/ ${rc.max}`),
        modo !== "leitura" && h("button", { class: "redondo", title: "+1 (com Shift, +10)", onclick: e => passo(e, 1), "aria-label": `Aumentar ${rc.nome}` }, "+"))),
    h("div", { class: "trilho" }, h("div", { class: "enche " + (sentido || ""), style: { width: pct + "%", ...atraso } })),
    rapido ? h("div", { class: "rapidos" }, PASSOS.map(p => h("button", { class: p[0] === "-" ? "perde" : "ganha", onclick: () => aoMudar(rc, p) }, p.replace("-", "−"))), h("button", { onclick: () => aoMudar(rc, "100%") }, "Cheio")) : null);
}

/** Recipiente com as cores da ficha como variáveis (o tema do jogador vale em cada janela). */
export const comTema = (f, ...filhos) => h("div", { style: { "--tema": corSegura(f.cores?.tema), "--sec": corSegura(f.cores?.secundaria), "--ter": corSegura(f.cores?.terciaria, "#e1e1e7") } }, ...filhos);
export const secaoRecursos = (f, modo, chave, aoMudar, rapido) => f.recursos.map(rc => barra(rc, modo, aoMudar, `${chave}:${rc.id}`, rapido));

const hora = t => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function painelRecursos() {
  const f = estado.ficha;
  if (!f) return semFicha();
  const hist = ler(HISTORICO) || [];
  return comTema(f,
    secaoRecursos(f, "proprio", "rc", mudarRecurso(f), ui.rapidos !== false),
    h("div", { class: "linha", style: { marginTop: "12px" } },
      h("button", { disabled: !hist.length, title: hist[0] ? `Desfaz ${hist[0].nome}: ${hist[0].de} → ${hist[0].para}` : "Nada para desfazer", onclick: desfazer }, icone("desfazer", 14), " Desfazer"),
      h("button", { "aria-pressed": String(ui.rapidos !== false), onclick: () => { ui.rapidos = ui.rapidos === false; redesenhar(); } }, "Botões rápidos")),
    hist.length ? details("historico", h("span", { class: "mudo" }, `Histórico (${hist.length})`), h("ul", { class: "historico" }, hist.map(x => h("li", {},
      h("time", {}, hora(x.t)), h("span", { class: "nome" }, x.nome, x.origem ? h("small", {}, " · " + x.origem) : null),
      h("b", { class: x.para < x.de ? "perde" : "ganha" }, `${x.para < x.de ? "−" : "+"}${Math.abs(x.para - x.de)}`)))), "bloco") : null);
}

// ── ficha ─────────────────────────────────────────────────────
const brasao = (f, editavel) => {
  const img = editavel ? retrato() : null;
  return h(editavel ? "button" : "span", { class: "brasao", title: editavel ? "Trocar o retrato (fica só no seu navegador)" : null, "aria-label": editavel ? "Trocar o retrato" : null, onclick: editavel ? trocarRetrato : null },
    img ? h("img", { src: img, alt: "" }) : h("span", {}, (f.nome || "?").trim()[0] || "?"));
};
export const cabecalhoFicha = (f, editavel, resumo) => h("div", { class: "cab" }, brasao(f, editavel),
  h("div", { class: "quem" }, h("strong", {}, f.nome), h("span", { class: "mudo" }, f.origem || ""),
    resumo ? h("div", { class: "mini" }, f.recursos.map(rc => h("span", { title: `${rc.nome}: ${rc.atual}/${rc.max}`, style: { "--cor": corSegura(rc.cor, "var(--tema)"), "--p": (rc.max > 0 ? Math.max(0, Math.min(100, rc.atual / rc.max * 100)) : 0) + "%" } }))) : null),
  h("span", { class: "nivel" }, h("small", {}, "nível"), f.nivel));

function resultadoLivre(chave) {
  const r = ultimas.get(chave);
  return r && (r.texto || r.erro) ? h("div", { class: "resultado" + (r.erro ? " erro" : "") }, r.erro || h("div", { class: "rolou" }, r.total != null ? h("b", {}, r.total) : null, h("span", {}, r.texto))) : null;
}

export const blocoAtributos = (f, rola) => [
  h("div", { class: "attrs" }, f.atributos.map(a => {
    const nota = rola && notacaoDoAtributo(a.dado), chave = "attr:" + a.key;
    const miolo = [h("small", {}, a.nome), h("b", {}, a.valor), h("i", {}, a.dado)];
    const estilo = { "--cor": corSegura(a.cor, "var(--tema)") };
    return nota
      ? h("button", { class: "attr", style: estilo, title: `Rolar ${nota} de ${a.nome}`, onclick: () => { ui.ultAttr = chave; rolar(nota, chave, a.nome); } }, miolo)
      : h("div", { class: "attr", style: estilo }, miolo);
  })),
  rola && ui.ultAttr ? resultadoLivre(ui.ultAttr) : null,
  f.secundarios?.length ? [titulo("Secundários"), h("div", { class: "chips" }, f.secundarios.map(s => chip(s.nome, s.valor)))] : null,
];

export function painelAtributos() {
  const f = estado.ficha;
  if (!f) return semFicha();
  const entrada = novaEntradaArquivo();
  return comTema(f,
    cabecalhoFicha(f, true, true),
    (f.v || 1) < 4 ? h("p", { class: "nota alerta" }, "Este arquivo foi gerado por uma versão antiga do site e pode trazer skills sem custo automático ou cortadas. Baixe a ficha de novo pelo botão Owlbear e use Atualizar ficha.") : null,
    estado.publicacao ? h("p", { class: "nota alerta" }, estado.publicacao) : null,
    titulo("Atributos"),
    blocoAtributos(f, true),
    h("div", { class: "linha rodape" },
      h("button", { title: "Carrega de novo o arquivo baixado do site (também dá para soltar o arquivo na janela)", onclick: () => entrada.click() }, "Atualizar ficha"),
      confirmar("remover-ficha", "Remover", retirarFicha),
      h("span", { class: "mudo fim" }, `versão ${VERSAO}`)),
    entrada);
}

/** A ficha de outro jogador, inteira (só o mestre). */
export const fichaView = (f, modo, chave, aoMudar) => comTema(f,
  cabecalhoFicha(f), secaoRecursos(f, modo, chave, aoMudar),
  titulo("Atributos"), blocoAtributos(f),
  titulo(`Skills (${skillsVisiveis(f, modo).length})`), listaSkills(f, modo, chave));

// ── skills ────────────────────────────────────────────────────
const seletorQuemVe = () => seletor(ALVOS_ROLAGEM, ler(CHAVE_ALVO) || "everyone", v => { guardar(CHAVE_ALVO, v); redesenhar(); }, { "aria-label": "Quem vê as rolagens", title: "Quem vê as rolagens" });

export function painelSkills() {
  const f = estado.ficha;
  if (!f) return semFicha();
  const total = skillsVisiveis(f, "proprio").length, fora = (f.skills || []).length - total, lista = skillsFiltradas(f);
  const busca = h("input", { type: "search", placeholder: `Buscar em ${total} skills…`, "aria-label": "Buscar skill", "data-foco": "busca", autocomplete: "off" });
  busca.value = ui.busca || "";
  busca.addEventListener("input", () => { ui.busca = busca.value; redesenhar(); });
  return comTema(f,
    h("div", { class: "fixo" },
      h("div", { class: "linha" }, busca, h("button", { class: "forte", title: "Criar uma skill", onclick: () => abrirFormSkill(f, null) }, "＋ Nova")),
      h("div", { class: "filtros" }, FILTROS.map(([v, t]) => h("button", { "aria-pressed": String((ui.filtro || "todas") === v), "aria-label": v === "favoritas" ? "Favoritas" : null, onclick: () => { ui.filtro = v; redesenhar(); } }, t)), seletorQuemVe())),
    formAberto.has("nova") ? formularioSkill(f, null) : null,
    lista.length ? listaSkills(f, "proprio", "eu", lista) : h("p", { class: "vazio mudo" }, total ? "Nenhuma skill com esse filtro." : "Nenhuma skill na ficha."),
    fora ? h("p", { class: "nota" }, `${fora} skill${fora > 1 ? "s" : ""} fora da lista. `, h("button", { class: "link", onclick: restaurarOcultas }, "Mostrar de novo")) : null);
}

// ── dados ─────────────────────────────────────────────────────
const RAPIDOS = ["1d4", "1d6", "1d8", "1d10", "1d12", "1d20", "1d100", "1d1000", "1d10000"];
export function painelDados() {
  const f = estado.ficha, hist = ler(CHAVE_ROLAGENS) || [];
  const rolarTexto = (nota, nome) => rolar(nota, "livre", nome);
  const enviar = () => { const t = (rascunho["dados"] || "").trim(); if (t) rolarTexto(t, ""); };
  const attrs = (f?.atributos || []).map(a => [a, notacaoDoAtributo(a.dado)]).filter(([, n]) => n);
  const corpo = [
    h("div", { class: "linha" }, campo("dados", { placeholder: "1d20+5 #Ataque, 2d8 #Dano", "aria-label": "Fórmula de dados", spellcheck: "false", onkeydown: e => { if (e.key === "Enter") enviar(); } }), h("button", { class: "forte", onclick: enviar }, "Rolar")),
    h("div", { class: "filtros" }, RAPIDOS.map(d => h("button", { onclick: () => rolarTexto(d, d.slice(1)) }, d.slice(1))), seletorQuemVe()),
    attrs.length ? h("div", { class: "chips" }, attrs.map(([a, n]) => h("button", { class: "chip", style: { "--cor": corSegura(a.cor) }, title: `Rolar ${n}`, onclick: () => rolarTexto(n, a.nome) }, a.nome, " ", h("b", {}, a.dado)))) : null,
    resultadoLivre("livre"),
    titulo("Últimas rolagens", hist.length ? h("button", { class: "link", onclick: () => { guardar(CHAVE_ROLAGENS, []); redesenhar(); } }, "Limpar") : null),
    hist.length ? h("ul", { class: "historico rolagens" }, hist.map(x => h("li", {}, h("b", {}, x.total),
      h("span", { class: "nome" }, x.nome || x.notacao, h("small", { title: x.texto }, x.texto)),
      botaoIcone("dados", `Rolar de novo: ${x.notacao}`, () => rolarTexto(x.notacao, x.nome)), h("time", {}, hora(x.t)))))
      : h("p", { class: "vazio mudo" }, "As suas rolagens aparecem aqui. Clicar num atributo ou skill abre os Senshi Dados com os dados prontos."),
  ];
  corpo.push(h("label", { class: "linha mudo rodape" }, "Rolar com", seletor(SISTEMAS, ler(CHAVE_SISTEMA) || "senshi", v => { guardar(CHAVE_SISTEMA, v); redesenhar(); }, { "aria-label": "Extensão de dados" })));
  return f ? comTema(f, corpo) : h("div", {}, corpo);
}

// ── notas ─────────────────────────────────────────────────────
const NOTAS = "senshi/notas";
export function painelNotas() {
  const notas = ler(NOTAS) || [];
  const gravar = lista => guardar(NOTAS, lista);
  const mudar = (id, patch) => gravar((ler(NOTAS) || []).map(n => n.id === id ? { ...n, ...patch } : n));
  return h("div", {},
    h("button", { class: "forte larga", onclick: () => { gravar([{ id: Date.now().toString(36), titulo: "", texto: "" }, ...notas]); redesenhar(); } }, "＋ Nova nota"),
    notas.length ? notas.map(n => {
      const t = h("input", { type: "text", class: "nota-titulo", placeholder: "Título", "aria-label": "Título da nota", "data-foco": "nt:" + n.id });
      t.value = n.titulo;
      t.addEventListener("input", () => mudar(n.id, { titulo: t.value }));
      const x = h("textarea", { placeholder: "Escreva aqui…", "aria-label": "Texto da nota", rows: Math.min(14, Math.max(3, n.texto.split("\n").length + 1)), "data-foco": "nx:" + n.id });
      x.value = n.texto;
      x.addEventListener("input", () => mudar(n.id, { texto: x.value }));
      return h("div", { class: "cartao" }, h("div", { class: "linha" }, t, confirmar("nota:" + n.id, "Apagar", () => gravar((ler(NOTAS) || []).filter(y => y.id !== n.id)), "link")), x);
    }) : h("p", { class: "vazio mudo" }, "Anote pistas, nomes e planos. Só você vê, e fica salvo neste navegador."));
}
