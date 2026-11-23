import { OBR, CHAVE_FICHA } from "./shared.js";

const $ = sel => document.querySelector(sel);

/** Cria elemento sem innerHTML: o texto da ficha vem de um arquivo e nunca é tratado como HTML. */
function h(tag, props = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "style") Object.assign(el.style, v);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const f of filhos.flat()) if (f != null && f !== false) el.append(f.nodeType ? f : document.createTextNode(String(f)));
  return el;
}

const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento: segue só na memória */ } };
const ler = k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };

// ── abas ──────────────────────────────────────────────────────
const abas = ["ficha", "mesa"];
function irParaAba(nome) {
  for (const a of abas) {
    $(`#aba-${a}`).classList.toggle("oculto", a !== nome);
    document.querySelector(`nav [data-aba=${a}]`).setAttribute("aria-selected", String(a === nome));
  }
  guardar("senshi/aba", nome);
}
document.querySelectorAll("nav [data-aba]").forEach(b => b.addEventListener("click", () => irParaAba(b.dataset.aba)));

// ── ficha ─────────────────────────────────────────────────────
let ficha = null;

/** O Owlbear limita o tamanho dos metadados: encolhe o texto das skills até caber. */
function paraMetadata(f) {
  const bytes = o => new TextEncoder().encode(JSON.stringify(o)).length;
  const copia = structuredClone(f);
  for (const corte of [140, 80, 0]) {
    if (bytes(copia) <= 14000) break;
    for (const s of copia.skills) s.texto = s.texto.slice(0, corte);
  }
  while (bytes(copia) > 14000 && copia.skills.length) copia.skills.pop();
  return copia;
}

async function salvarFicha(f) {
  ficha = f;
  guardar(CHAVE_FICHA, f);
  try { await OBR.player.setMetadata({ [CHAVE_FICHA]: paraMetadata(f) }); } catch { /* o painel segue com a cópia local */ }
  desenharFicha();
}

function barra(rc, editavel, aoMudar) {
  const pct = rc.max > 0 ? Math.max(0, Math.min(100, (rc.atual / rc.max) * 100)) : 0;
  const ajustar = (e, sinal) => aoMudar(rc, sinal * (e.shiftKey ? 10 : 1));
  return h("div", { class: "barra" },
    h("div", { class: "topo" },
      h("span", {}, rc.nome),
      h("span", { class: "ajuste linha" },
        editavel && h("button", { onclick: e => ajustar(e, -1), "aria-label": `Diminuir ${rc.nome}` }, "−"),
        h("b", {}, `${rc.atual} / ${rc.max}`),
        editavel && h("button", { onclick: e => ajustar(e, 1), "aria-label": `Aumentar ${rc.nome}` }, "+"))),
    h("div", { class: "trilho" }, h("div", { class: "enche", style: { width: pct + "%", background: rc.cor || "var(--tema)" } })));
}

function desenharFichaDe(f, { editavel }) {
  const raiz = h("div");
  raiz.style.setProperty("--tema", f.cores.tema);
  raiz.style.setProperty("--sec", f.cores.secundaria);
  raiz.style.setProperty("--ter", f.cores.terciaria);
  raiz.append(
    h("div", { class: "cab" }, h("strong", {}, f.nome), h("span", { class: "mudo" }, `Nível ${f.nivel}${f.origem ? " · " + f.origem : ""}`)),
    h("h2", {}, "Recursos"),
    ...f.recursos.map(rc => barra(rc, editavel, (alvo, delta) => {
      alvo.atual = Math.max(0, Math.min(alvo.max, alvo.atual + delta));
      salvarFicha(f);
    })),
    h("h2", {}, "Atributos"),
    h("div", { class: "attrs" }, ...f.atributos.map(a => h("div", { class: "attr", style: { borderLeftColor: a.cor } }, h("small", {}, `${a.nome} · ${a.dado}`), h("b", {}, a.valor)))),
    f.secundarios.length ? h("h2", {}, "Secundários") : null,
    f.secundarios.length ? h("div", { class: "chips" }, ...f.secundarios.map(s => h("span", { class: "chip" }, s.nome, " ", h("b", {}, s.valor)))) : null,
    h("h2", {}, "Skills"),
    ...[...f.skills].sort((a, b) => Number(b.ligada) - Number(a.ligada)).map(s =>
      h("details", { class: "skill" },
        h("summary", {}, h("span", { class: s.ligada ? "on" : "" }, s.nome), h("span", { class: "mudo" }, s.tipo + (s.ligada && s.tipo !== "passiva" ? " · ligada" : ""))),
        h("p", {}, s.texto || "Sem descrição."))),
  );
  return raiz;
}

function importarArquivo(arquivo) {
  const leitor = new FileReader();
  leitor.onload = () => {
    try {
      const dados = JSON.parse(String(leitor.result));
      if (dados?.formato !== "senshi-owlbear") throw new Error("Esse não é o arquivo do Owlbear. No site, use o botão Owlbear nos controles da ficha (não o botão JSON).");
      salvarFicha(dados);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Arquivo inválido.");
    }
  };
  leitor.readAsText(arquivo);
}

function desenharFicha() {
  const raiz = $("#aba-ficha");
  const entrada = h("input", { type: "file", accept: ".json,application/json", class: "oculto", onchange: e => { if (e.target.files[0]) importarArquivo(e.target.files[0]); } });
  if (!ficha) {
    const caixa = h("div", { class: "vazio" },
      h("p", {}, "Nenhuma ficha importada."),
      h("p", { class: "mudo" }, "No site, abra sua ficha e toque em ", h("b", {}, "Owlbear"), " para baixar o arquivo. Depois solte aqui ou escolha o arquivo."),
      h("button", { onclick: () => entrada.click() }, "Importar ficha"));
    caixa.addEventListener("dragover", e => { e.preventDefault(); caixa.classList.add("arrasta"); });
    caixa.addEventListener("dragleave", () => caixa.classList.remove("arrasta"));
    caixa.addEventListener("drop", e => { e.preventDefault(); caixa.classList.remove("arrasta"); if (e.dataTransfer.files[0]) importarArquivo(e.dataTransfer.files[0]); });
    raiz.replaceChildren(caixa, entrada);
    return;
  }
  const quando = ficha.geradoEm ? new Date(ficha.geradoEm).toLocaleString("pt-BR") : "";
  raiz.replaceChildren(
    desenharFichaDe(ficha, { editavel: true }),
    h("div", { class: "linha", style: { marginTop: "14px" } },
      h("button", { onclick: () => entrada.click() }, "Atualizar (importar de novo)"),
      h("button", { onclick: async () => { ficha = null; localStorage.removeItem(CHAVE_FICHA); try { await OBR.player.setMetadata({ [CHAVE_FICHA]: undefined }); } catch { /* ignora */ } desenharFicha(); } }, "Remover")),
    h("p", { class: "mudo" }, quando ? `Importada do arquivo gerado em ${quando}. Os ajustes de recurso valem só aqui, na mesa.` : ""),
    entrada);
}

// ── mesa (só mestre) ──────────────────────────────────────────
async function desenharMesa() {
  const jogadores = await OBR.party.getPlayers();
  const raiz = $("#aba-mesa");
  const itens = jogadores.map(p => {
    const f = p.metadata?.[CHAVE_FICHA];
    return h("details", { class: "jogador" },
      h("summary", {}, p.name || "Jogador", f ? ` · ${f.nome}` : " · sem ficha importada"),
      f ? desenharFichaDe(f, { editavel: false }) : h("p", { class: "mudo" }, "Esse jogador ainda não importou a ficha."));
  });
  raiz.replaceChildren(h("h2", {}, "Fichas da mesa"), ...(itens.length ? itens : [h("p", { class: "mudo" }, "Ninguém mais na sala.")]));
}

// ── início ────────────────────────────────────────────────────
OBR.onReady(async () => {
  const meta = await OBR.player.getMetadata();
  ficha = ler(CHAVE_FICHA) || meta[CHAVE_FICHA] || null;
  desenharFicha();

  if ((await OBR.player.getRole()) === "GM") {
    document.querySelector("nav [data-aba=mesa]").classList.remove("oculto");
    await desenharMesa();
    OBR.party.onChange(desenharMesa);
  }
  const ultima = ler("senshi/aba");
  irParaAba(abas.includes(ultima) && !(ultima === "mesa" && document.querySelector("nav [data-aba=mesa]").classList.contains("oculto")) ? ultima : "ficha");
});
