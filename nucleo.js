import { ler, guardar } from "./shared.js?v=18";

export const ID = new URLSearchParams(location.search).get("id") || "";
export const $ = sel => document.querySelector(sel);

/** Cria elemento sem innerHTML: texto vindo de arquivo ou de outro jogador nunca vira HTML. */
export function h(tag, props = {}, ...filhos) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "style") for (const [c, x] of Object.entries(v)) c.startsWith("--") ? el.style.setProperty(c, x) : (el.style[c] = x);
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const f of filhos.flat(Infinity)) if (f != null && f !== false) el.append(f.nodeType ? f : document.createTextNode(String(f)));
  return el;
}

const TRACOS = {
  ficha: "M6.5 3h11A1.5 1.5 0 0 1 19 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19.5v-15A1.5 1.5 0 0 1 6.5 3zM12 7a2 2 0 1 0 .01 0M8.5 14.5c.5-2 1.8-3 3.5-3s3 1 3.5 3M8 18h8",
  recursos: "M12 20.5C5 15.5 3 12 3 8.8A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 9 1.8c0 3.2-2 6.7-9 11.7z",
  skills: "M13 2.5 5 13.5h6l-1 8 8-11h-6z",
  dados: "M12 2.5 20.5 7.5v9L12 21.5 3.5 16.5v-9zM12 12l8.5-4.5M12 12 3.5 7.5M12 12v9.5",
  iniciativa: "M12 5a8 8 0 1 0 .01 0M12 9v4.5l3 2M9.5 2.5h5",
  notas: "M5 20l1-4L16.5 5.5a2 2 0 0 1 3 3L9 19zM14 8l3 3M13 20.5h7",
  mesa: "M8.5 11a3 3 0 1 0-.01 0M2.5 19c.6-3.4 3-5 6-5s5.4 1.6 6 5M16 11.2a2.6 2.6 0 1 0-1-5M17 14.2c2.5.3 4 1.9 4.5 4.3",
  jogador: "M12 11a3.5 3.5 0 1 0-.01 0M5 20c.8-4 3.5-6 7-6s6.2 2 7 6",
  mais: "M12 5v14M5 12h14", menos: "M6 12h12", fechar: "M6 6l12 12M18 6 6 18", menu: "M12 5.5v.01M12 12v.01M12 18.5v.01",
  estrela: "M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z",
  desfazer: "M8 5 4 9l4 4M4 9h9.5a5.5 5.5 0 0 1 0 11H9", janela: "M8 4.5h11.5V16H8zM4.5 8v11.5H16", abrir: "M6 9.5l6 6 6-6",
};
export function icone(nome, tam = 18) {
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), p = document.createElementNS(ns, "path");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: tam, height: tam, fill: "none", stroke: "currentColor", "stroke-width": nome === "menu" ? 3.6 : 1.7, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(k, v);
  p.setAttribute("d", TRACOS[nome] || "");
  svg.append(p);
  return svg;
}
export const botaoIcone = (nome, rotulo, onclick, props = {}) => h("button", { class: "ico", title: rotulo, "aria-label": rotulo, onclick, ...props }, icone(nome, 16));

// ── estado ────────────────────────────────────────────────────
export const estado = {
  souGM: false, meuId: "",
  ficha: null,            // ficha do próprio jogador (cópia local)
  jogadores: [],          // outros jogadores da sala
  iniPublica: null,       // parte pública da iniciativa (todos leem)
  meuPronto: null,        // o dado de iniciativa na mão do próprio jogador
  iniMestre: null,        // iniciativa completa (só o mestre grava)
  publicacao: "",         // resultado da última publicação da ficha
  aba: "ficha", alvo: "",
};

// O que o jogador via em cada janela sobrevive a mover, minimizar e recarregar.
const UI = "senshi/ui:" + ID;
const salvo = ler(UI) || {};
export const abertos = new Set(salvo.abertos || []);       // blocos abertos, para não fechar a cada atualização
export const rascunho = salvo.rascunho || {};              // texto digitado e ainda não enviado
export const rolagens = salvo.rolagens || {};              // posição da rolagem de cada aba
export const ui = salvo.ui || {};                          // busca, filtro…
export const salvarUi = () => ID && guardar(UI, { abertos: [...abertos], rascunho, rolagens, ui });

let pintar = () => {}, temporizador;
export const definirPintura = f => { pintar = f; };
export function redesenhar() { clearTimeout(temporizador); temporizador = setTimeout(() => { salvarUi(); pintar(); }, 30); }

// ── peças ─────────────────────────────────────────────────────
export function details(chave, resumo, corpo, classe) {
  const d = h("details", { class: classe });
  d.append(h("summary", {}, resumo), corpo);
  d.open = abertos.has(chave);
  d.addEventListener("toggle", () => {
    if (d.open === abertos.has(chave)) return;             // o próprio redesenho também dispara "toggle"
    if (d.open) abertos.add(chave); else abertos.delete(chave);
    if (chave.startsWith("j:")) redesenhar(); else salvarUi();   // na Mesa, abrir carrega a ficha inteira
  });
  return d;
}
export const chip = (rotulo, valor, custo) => h("span", { class: "chip" + (custo ? " custo" : "") }, rotulo ? rotulo + ": " : "", h("b", {}, valor));
export const titulo = (texto, ...fim) => h("h2", {}, h("span", {}, texto), fim.length ? h("span", { class: "linha" }, fim) : null);

/** Campo de texto cujo conteúdo sobrevive às atualizações automáticas da tela. */
export function campo(chave, props = {}) {
  const el = h("input", { type: "text", "data-foco": chave, autocomplete: "off", ...props });
  el.value = rascunho[chave] ?? "";
  el.addEventListener("input", () => { rascunho[chave] = el.value; });
  return el;
}
export function area(chave, inicial, props = {}) {
  const el = h("textarea", { "data-foco": chave, ...props });
  el.value = rascunho[chave] ?? inicial ?? "";
  el.addEventListener("input", () => { rascunho[chave] = el.value; });
  return el;
}
export const seletor = (opcoes, valor, aoMudar, props = {}) =>
  Object.assign(h("select", { onchange: e => aoMudar(e.target.value), ...props }, opcoes.map(([v, t]) => h("option", { value: v }, t))), { value: valor });

/** Botão que pede confirmação no próprio lugar (o navegador bloqueia confirm() dentro do Owlbear). */
const confirmando = new Set();
export function confirmar(chave, rotulo, aoConfirmar, classe = "") {
  const fim = () => { confirmando.delete(chave); redesenhar(); };
  return confirmando.has(chave)
    ? h("span", { class: "linha" }, h("button", { class: "perigo", onclick: () => { confirmando.delete(chave); aoConfirmar(); redesenhar(); } }, "Confirmar"), h("button", { onclick: fim }, "Cancelar"))
    : h("button", { class: classe, onclick: () => { confirmando.add(chave); redesenhar(); } }, rotulo);
}
