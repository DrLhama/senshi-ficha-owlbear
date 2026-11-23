import OBR from "https://esm.sh/@owlbear-rodeo/sdk@3.1.0";

export { OBR };
export const CHAVE = "senshi/f";                  // metadados do jogador: cabeçalho + pedaços da ficha
export const LOCAL = "senshi/ficha";              // cópia completa, só no navegador do jogador
export const CANAL_AJUSTE = "senshi.ajuste";      // o mestre pede ao jogador para mudar um recurso
export const CHAVE_INI = "senshi/ini";            // metadados da sala: a parte pública da iniciativa
export const LOCAL_INI = "senshi/ini-mestre";     // iniciativa completa (com os ocultos), só no mestre
const PEDACO = 6000;

const paraB64 = bytes => { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const deB64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

async function comprimir(texto) {
  if (typeof CompressionStream === "undefined") return { z: 0, s: texto };
  const cs = new CompressionStream("gzip");
  const w = cs.writable.getWriter();
  w.write(new TextEncoder().encode(texto));
  w.close();
  return { z: 1, s: paraB64(new Uint8Array(await new Response(cs.readable).arrayBuffer())) };
}
async function descomprimir(z, s) {
  if (!z) return s;
  const ds = new DecompressionStream("gzip");
  const w = ds.writable.getWriter();
  w.write(deB64(s));
  w.close();
  return new TextDecoder().decode(await new Response(ds.readable).arrayBuffer());
}

/** Guarda a ficha inteira nos metadados do jogador (comprimida e em pedaços),
 * para o mestre ver tudo sem o Supabase. Devolve { ok, erro? }. */
export async function publicarFicha(ficha) {
  try {
    const { z, s } = await comprimir(JSON.stringify(ficha));
    const n = Math.ceil(s.length / PEDACO);
    const antigo = (await OBR.player.getMetadata())[CHAVE];
    const meta = { [CHAVE]: { n, z, t: Date.now(), nome: ficha.nome, recursos: ficha.recursos.map(({ id, nome, atual, max, cor }) => ({ id, nome, atual, max, cor })) } };
    for (let i = 0; i < n; i++) meta[CHAVE + i] = s.slice(i * PEDACO, (i + 1) * PEDACO);
    for (let i = n; i < (antigo?.n || 0); i++) meta[CHAVE + i] = undefined;
    await OBR.player.setMetadata(meta);
    return { ok: true, bytes: s.length };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

/** Digitar num recurso, igual ao site e um pouco além:
 *  25 define em 25 · +25 soma · -25 tira · 50% define em 50% do máximo · +10% / -50% somam/tiram essa parte do máximo.
 *  Devolve o novo valor (entre 0 e o máximo) ou null se o texto não for entendido. */
export function aplicarExpressao(atual, max, texto) {
  const s = String(texto ?? "").trim().replace(",", ".").replace(/\s+/g, "");
  const m = /^([+-]?)(\d+(?:\.\d+)?)(%?)$/.exec(s);
  if (!m) return null;
  const [, sinal, num, pct] = m;
  const n = Number(num);
  const parte = pct ? (max * n) / 100 : n;
  const novo = sinal === "+" ? atual + parte : sinal === "-" ? atual - parte : parte;
  return Math.max(0, Math.min(max, Math.round(novo)));
}

/** Combo de dados da skill: "1d20+5 #Ataque, 2d8 #Dano" -> [{ notacao, rotulo }] (mesma regra do editor no site). */
export function lerCombo(texto) {
  return String(texto || "").split(",").map(p => p.trim()).filter(Boolean).map(p => {
    const m = /^(.*?)\s*#\s*(.+)$/.exec(p);
    return m ? { notacao: m[1].trim(), rotulo: m[2].trim() } : { notacao: p, rotulo: "" };
  });
}

/** Visuais prontos para os dados do Dice+ (só os campos livres do material padrão). */
export const VISUAIS_DADOS = {
  ficha: { nome: "Cor da minha ficha" },
  obsidiana: { nome: "Obsidiana", color: "#15151d", numberColor: "#e8c36a", metalness: 0.65, roughness: 0.22, sheen: 0.4 },
  ouro: { nome: "Ouro", color: "#c9a24b", numberColor: "#1a1208", metalness: 0.95, roughness: 0.18 },
  marfim: { nome: "Marfim", color: "#e9e2cf", numberColor: "#3a2d1c", metalness: 0, roughness: 0.55 },
  sangue: { nome: "Sangue", color: "#7a1620", numberColor: "#ffe9e9", metalness: 0.2, roughness: 0.3, sheen: 0.6 },
  esmeralda: { nome: "Esmeralda", color: "#1d6b4d", numberColor: "#eafff3", metalness: 0.3, roughness: 0.2, sheen: 0.5 },
  gelo: { nome: "Gelo", color: "#9fd4ff", numberColor: "#07263f", opacity: 0.78, roughness: 0.08, metalness: 0.1 },
  noite: { nome: "Noite estrelada", color: "#2b2466", numberColor: "#f6e9ff", metalness: 0.5, roughness: 0.25, sheen: 0.7, font: "aelfa" },
};

export const cabecalhoDe = meta => meta?.[CHAVE] || null;

/** Remonta a ficha completa a partir dos metadados de um jogador. */
export async function lerFicha(meta) {
  const cab = cabecalhoDe(meta);
  if (!cab) return null;
  try {
    let s = "";
    for (let i = 0; i < cab.n; i++) s += meta[CHAVE + i] ?? "";
    return JSON.parse(await descomprimir(cab.z, s));
  } catch { return null; }
}

export const guardar = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sem armazenamento: segue na memória */ } };
export const ler = k => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } };
