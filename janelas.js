import { OBR, VERSAO, ler, guardar } from "./shared.js?v=17";

/** Janelas livres: cada uma é um popover do Owlbear com abas. O registro guarda onde estão, para reabrir no mesmo lugar. */
const REGISTRO = "senshi/janelas-v9";
export const ALTURA_MIN = 46;         // janela minimizada: só a barra de título
export const MAX_JANELAS = 8;
export const CONFIG = "senshi/config";

export const ABAS = {
  ficha: { titulo: "Ficha", w: 400, h: 560 },
  recursos: { titulo: "Recursos", w: 380, h: 400 },
  skills: { titulo: "Skills", w: 430, h: 640 },
  dados: { titulo: "Dados", w: 380, h: 480 },
  iniciativa: { titulo: "Iniciativa", w: 380, h: 580 },
  notas: { titulo: "Notas", w: 380, h: 460 },
  mesa: { titulo: "Mesa", w: 440, h: 660, mestre: true },
  jogador: { titulo: "Ficha do jogador", w: 430, h: 640, mestre: true },
};
export const abasDe = (souGM, alvo) => Object.keys(ABAS).filter(a => a === "jogador" ? souGM && alvo : souGM || !ABAS[a].mestre);

export const lerJanelas = () => ler(REGISTRO) || {};
export function mudarJanela(id, patch) {
  const todas = lerJanelas();
  todas[id] = { ...todas[id], ...patch };
  guardar(REGISTRO, todas);
}
export function tirarJanela(id) {
  const todas = lerJanelas();
  delete todas[id];
  guardar(REGISTRO, todas);
  try { localStorage.removeItem("senshi/ui:" + id); } catch { /* sem armazenamento */ }
}
export const limparJanelas = () => Object.keys(lerJanelas()).forEach(tirarJanela);

export const limitar = (v, min, max) => Math.max(min, Math.min(Math.max(min, max), v));
export const tela = async () => ({ w: await OBR.viewport.getWidth(), h: await OBR.viewport.getHeight() });
const alturaDe = j => (j.min ? ALTURA_MIN : j.h);

export function endereco(pagina, dados) {
  const url = new URL(pagina, location.href);
  url.search = "";
  for (const [k, v] of Object.entries({ v: VERSAO, ...dados })) if (v !== "" && v != null) url.searchParams.set(k, v);
  return url.toString();
}

export async function abrirPopover(id) {
  const j = lerJanelas()[id];
  if (!j) return;
  const t = await tela();
  // a tela pode ter mudado de tamanho desde a última vez
  const w = limitar(j.w, 240, t.w - 8), h = limitar(j.h, 160, t.h - 8);
  const left = limitar(j.left, 0, t.w - Math.min(w, 120)), top = limitar(j.top, 0, t.h - ALTURA_MIN);
  mudarJanela(id, { w, h, left, top, z: Date.now() });      // a última aberta fica por cima
  await OBR.popover.open({
    id, url: endereco("app.html", { id }), width: w, height: j.min ? ALTURA_MIN : h,
    anchorReference: "POSITION", anchorPosition: { left, top },
    anchorOrigin: { horizontal: "LEFT", vertical: "TOP" }, transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
    disableClickAway: true, marginThreshold: 0,
  });
}

/** A bússola da iniciativa, no centro do alto da tela. */
export const BUSSOLA = "senshi-bussola";
export async function abrirBussola() {
  const t = await tela(), w = Math.min(860, t.w - 16);
  await OBR.popover.open({
    id: BUSSOLA, url: endereco("bussola.html", {}), width: w, height: 104,
    anchorReference: "POSITION", anchorPosition: { left: Math.round((t.w - w) / 2), top: ler("senshi/bussola-top") ?? 8 },
    anchorOrigin: { horizontal: "LEFT", vertical: "TOP" }, transformOrigin: { horizontal: "LEFT", vertical: "TOP" },
    disableClickAway: true, hidePaper: true, marginThreshold: 0,
  });
  return t.w;
}

/** Há uma janela mais nova por cima desta? */
export function coberta(id) {
  const todas = lerJanelas(), j = todas[id];
  return !!j && Object.entries(todas).some(([k, o]) => k !== id && (o.z || 0) > (j.z || 0) && o.left < j.left + j.w && o.left + o.w > j.left && o.top < j.top + alturaDe(j) && o.top + alturaDe(o) > j.top);
}

/** Primeiro espaço livre da tela; se não houver, em cascata sobre a última. */
export function lugarLivre(outras, w, h, t, inteira = h) {
  const bate = (l, tp) => outras.some(o => l < o.left + o.w + 10 && l + w + 10 > o.left && tp < o.top + alturaDe(o) + 10 && tp + h + 10 > o.top);
  const maxL = t.w - w - 16, maxT = t.h - h - 16;
  // colado nas janelas que já existem, depois numa grade
  const ls = [16, ...outras.map(o => o.left + o.w + 10), ...Array.from({ length: 60 }, (_, i) => 16 + i * 40)];
  const ts = [70, ...outras.map(o => o.top + alturaDe(o) + 10), ...Array.from({ length: 20 }, (_, i) => 70 + i * 40)];
  for (const l of ls) for (const tp of ts) if (l <= Math.max(16, maxL) && tp <= Math.max(70, maxT) && !bate(l, tp)) return { left: l, top: tp, h };
  // não coube: tenta uma janela mais baixa antes de sobrepor
  if (h > 320 && outras.length) return lugarLivre(outras, w, Math.max(320, Math.round(h * 0.8)), t, inteira);
  const n = outras.length;
  return { left: limitar(16 + n * 30, 0, Math.max(0, maxL)), top: limitar(70 + n * 30, 0, Math.max(0, t.h - inteira - 16)), h: inteira };
}

/** Abre mais uma janela. Sem aba escolhida, mostra a primeira que ainda não está aberta em nenhuma outra. */
export async function novaJanela({ aba, alvo, souGM } = {}) {
  const todas = lerJanelas(), lista = Object.values(todas);
  if (aba === "jogador") {
    const ja = Object.keys(todas).find(id => todas[id].aba === "jogador" && todas[id].alvo === alvo);
    if (ja) { mudarJanela(ja, { min: false }); await OBR.popover.close(ja); return abrirPopover(ja); }
  }
  if (lista.length >= MAX_JANELAS) {
    await OBR.notification.show(`Você já tem ${MAX_JANELAS} janelas abertas. Feche uma no × para abrir outra.`, "WARNING");
    return;
  }
  const t = await tela();
  const ordem = souGM ? ["mesa", "iniciativa", "ficha", "skills", "recursos", "dados", "notas"] : ["ficha", "skills", "recursos", "iniciativa", "dados", "notas"];
  aba ||= ordem.find(a => !lista.some(j => j.aba === a)) || ordem[0];
  const w = Math.min(ABAS[aba].w, t.w - 16), h = Math.min(ABAS[aba].h, t.h - 90);
  const id = "senshi-j-" + Math.random().toString(36).slice(2, 9);
  mudarJanela(id, { aba, alvo, w, h, ...lugarLivre(lista, w, h, t) });
  await abrirPopover(id);
}

/** Põe todas as janelas lado a lado, sem sobreposição quando couber. */
export async function organizar() {
  const t = await tela(), todas = lerJanelas(), postas = [];
  for (const id of Object.keys(todas).sort((a, b) => todas[a].left - todas[b].left || todas[a].top - todas[b].top)) {
    const j = { ...todas[id], h: Math.min(todas[id].h, t.h - 90) };
    const { left, top, h } = lugarLivre(postas, j.w, alturaDe(j), t);
    Object.assign(j, { left, top }, !j.min && h ? { h } : null);
    postas.push(j);
    mudarJanela(id, j);
    await OBR.popover.close(id);
    await abrirPopover(id);
  }
}

export async function fecharOutras(menos) {
  for (const id of Object.keys(lerJanelas())) if (id !== menos) { tirarJanela(id); await OBR.popover.close(id); }
}

/** Pedidos para o fundo da extensão, que continua vivo quando a própria janela precisa fechar e reabrir. */
export const canal = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("senshi/janelas");
