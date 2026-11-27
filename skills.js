import { ler, guardar, lerCombo, registrar } from "./shared.js?v=19";
import { h, icone, rascunho, ui, redesenhar, details, chip, campo, area, seletor, confirmar } from "./nucleo.js?v=19";
import { rolar, ultimas, gravarResultado } from "./dados.js?v=19";
import { aplicarMinhaFicha } from "./minha.js?v=19";

// ── skills ────────────────────────────────────────────────────
/** Cada linha do combo vira um botão para rolar só ela (sem pagar custo). O botão Usar rola o combo inteiro. */
function linhasDoCombo(m, chave) {
  const linhas = lerCombo(m.rolagem);
  if (linhas.length < 2) return null;
  return h("div", { class: "combo" }, linhas.map(l => h("button", {
    class: "rolar", title: `Rolar só esta linha: ${l.notacao}`,
    onclick: () => rolar(l.rotulo ? `${l.notacao} #${l.rotulo}` : l.notacao, chave, l.rotulo),
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
        if (!rc) continue;
        const novo = Math.max(0, Math.min(rc.max, rc.atual + d.delta));
        registrar(rc, rc.atual, novo, s.nome);
        rc.atual = novo;
      }
      if (!m?.uso?.unico) { s.ligada = true; s.modoLigado = i; }
      uso = deltas.map(fmtDelta).join(" · ") || (m?.uso?.unico ? "usada" : "ligada");
      await aplicarMinhaFicha(f);                          // grava, publica para o mestre e redesenha
    }
  }
  gravarResultado(chave, { uso });
  if (m?.rolagem) await rolar(m.rolagem, chave, s.nome); else redesenhar();
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
  return h("button", { class: "rolar usar", title: dica, "aria-label": dica, onclick: e => { e.preventDefault(); e.stopPropagation(); usarSkill(f, s, i, chave); } }, rotulo);
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
    r.erro ? h("div", {}, r.erro) : r.texto ? h("div", { class: "rolou" }, r.total != null ? h("b", {}, r.total) : null, h("span", {}, r.texto)) : null);
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
    const caixa = area("ed:" + chave, texto, { rows: 8, "aria-label": `Texto de ${s.nome}` });
    return h("div", {}, caixa,
      h("div", { class: "linha", style: { marginTop: "6px" } },
        h("button", { onclick: () => gravar(caixa.value.trim() && caixa.value.trim() !== original ? caixa.value.trim() : null) }, "Salvar"),
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
export const formAberto = new Set();         // formulários de skill abertos: "nova" ou o nome da skill

function tirarDaLista(nome) {
  const t = ocultasDoJogador(); t.add(nome);
  guardar(CHAVE_OCULTAS, [...t]);
  redesenhar();
}
export const restaurarOcultas = () => { guardar(CHAVE_OCULTAS, []); redesenhar(); };

export function abrirFormSkill(f, original) {
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

export function formularioSkill(f, original) {
  const k = original?.nome || "nova";
  const sel = (c, opcoes) => seletor(opcoes, rascunho[`sk:${k}:${c}`] ?? "", x => { rascunho[`sk:${k}:${c}`] = x; });
  const erro = rascunho[`sk:${k}:erro`];
  return h("div", { class: "form-skill" },
    h("strong", {}, original ? "Editar skill" : "Nova skill"),
    campo(`sk:${k}:nome`, { placeholder: "Nome", "aria-label": "Nome da skill" }),
    h("div", { class: "grade2" },
      sel("tipo", [["ativa", "Ativa"], ["passiva", "Passiva"]]),
      campo(`sk:${k}:dados`, { placeholder: "Dados · ex.: 1d20+5, 2d8", "aria-label": "Dados da skill", spellcheck: "false" })),
    area(`sk:${k}:desc`, "", { rows: 3, placeholder: "O que ela faz (um lembrete curto basta)" }),
    h("div", { class: "grade2" },
      sel("rec", [["", "Sem custo"], ...f.recursos.map(x => [x.id, `Custa ${x.nome}`])]),
      campo(`sk:${k}:custo`, { placeholder: "Quanto custa", inputmode: "numeric", "aria-label": "Valor do custo" })),
    erro ? h("p", { class: "nota alerta" }, erro) : null,
    h("div", { class: "linha" }, h("button", { class: "rolar", onclick: () => salvarSkill(f, original) }, "Salvar"), h("button", { onclick: () => fecharFormSkill(k) }, "Cancelar")));
}

/** Botões no fim da skill: editar/excluir (as do jogador) ou tirar da lista (as da ficha), sempre com confirmação. */
const acoesDaSkill = (f, s, chave) => h("div", { class: "linha acoes-skill" },
  s.propria ? h("button", { onclick: () => abrirFormSkill(f, s) }, "✎ Editar skill") : null,
  s.propria
    ? confirmar("ex:" + chave, "Excluir", () => { f.skills.splice(f.skills.indexOf(s), 1); aplicarMinhaFicha(f); })
    : confirmar("ex:" + chave, "Tirar da lista", () => tirarDaLista(s.nome)));

// ── favoritas ─────────────────────────────────────────────────
const CHAVE_FAVORITAS = "senshi/skills-favoritas";
const favoritas = () => new Set(ler(CHAVE_FAVORITAS) || []);
function botaoFavorita(s) {
  const tem = favoritas().has(s.nome), dica = tem ? `Tirar ${s.nome} das favoritas` : `Favoritar ${s.nome}: fica no topo da lista`;
  return h("button", { class: "estrela", "aria-pressed": String(tem), "aria-label": dica, title: dica, onclick: e => {
    e.preventDefault(); e.stopPropagation();
    const t = favoritas();
    tem ? t.delete(s.nome) : t.add(s.nome);
    guardar(CHAVE_FAVORITAS, [...t]);
    redesenhar();
  } }, icone("estrela", 14));
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
    h("div", { class: "res" }, h("span", { class: "nome-skill" }, editavel ? botaoFavorita(s) : null, h("i", { class: "bola " + (s.tipo === "ativa" ? "ativa" : "passiva"), title: s.tipo === "ativa" ? "Ativa" : "Passiva" }), s.nome),
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

export const skillsVisiveis = (f, modo) => modo === "proprio" ? (f.skills || []).filter(s => !ocultasDoJogador().has(s.nome)) : (f.skills || []);

/** A chave usa o nome, não a posição: ligar, favoritar ou filtrar não fecha o que estava aberto. */
export function listaSkills(f, modo, chave, skills = skillsVisiveis(f, modo)) {
  const vistos = {};
  return skills.map(s => skillEl(s, `${chave}:s:${s.nome}${(vistos[s.nome] = (vistos[s.nome] || 0) + 1) > 1 ? "#" + vistos[s.nome] : ""}`, modo === "proprio", f));
}

const semAcento = t => String(t).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const FILTROS = [["todas", "Todas"], ["ativas", "Ativas"], ["passivas", "Passivas"], ["ligadas", "Ligadas"], ["favoritas", "★"]];
/** Busca e filtro da aba Skills; as favoritas vêm primeiro, sem mudar a ordem do resto. */
export function skillsFiltradas(f) {
  const busca = semAcento(ui.busca || "").trim(), fav = favoritas(), filtro = ui.filtro || "todas";
  const texto = s => semAcento([s.nome, s.desc, ...(s.modos || []).flatMap(m => [m.nome, m.resumo, m.desc])].join(" "));
  const passa = { todas: () => true, ativas: s => s.tipo === "ativa", passivas: s => s.tipo !== "ativa", ligadas: s => s.tipo === "ativa" && s.ligada, favoritas: s => fav.has(s.nome) }[filtro] || (() => true);
  const lista = skillsVisiveis(f, "proprio").filter(s => passa(s) && (!busca || texto(s).includes(busca)));
  return [...lista.filter(s => fav.has(s.nome)), ...lista.filter(s => !fav.has(s.nome))];
}
