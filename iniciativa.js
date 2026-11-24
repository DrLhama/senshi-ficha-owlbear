import { OBR, CHAVE_INI, LOCAL, LOCAL_INI, corSegura, guardar, ler } from "./shared.js?v=16";
import { notacaoDoAtributo } from "./dados.js?v=16";

/** As contas da iniciativa, sem desenho: usadas pela janela, pela bússola e pelo fundo. */
export const CANAL_PASSO = "senshi.ini-passo";      // alguém clicou numa seta da bússola; quem muda é o fundo do mestre
export const PRONTO = "senshi/ini-pronto";          // metadados do jogador: está com o dado na mão
const CONFRONTO = "senshi.dados/confronto";         // a animação é da extensão de dados
export const DUR_ANIMACAO = 6400;
const MAX_LADOS = 12;

export const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()));
export const INI_VAZIA = () => ({ ativo: false, chamada: false, combatentes: [], vez: null, ciclo: 1, rol: null });
const indice = ini => Math.max(0, ini.combatentes.findIndex(c => c.id === ini.vez));

/** Um ciclo tem um turno por criatura; passar do último começa o seguinte. */
export function avancar(ini, sentido) {
  const n = ini.combatentes.length;
  if (!n) return ini;
  const j = indice(ini) + sentido, ciclo = ini.ciclo + (j >= n ? 1 : j < 0 ? -1 : 0);
  return ciclo < 1 ? ini : { ...ini, ciclo, vez: ini.combatentes[(j + n) % n].id };
}

/** Guarda a lista completa no mestre e a parte pública na sala. */
export function publicarIni(ini) {
  guardar(LOCAL_INI, ini);
  const i = indice(ini), vez = ini.combatentes[i];
  const publica = {
    ativo: ini.ativo, chamada: !!ini.chamada, rol: ini.rol || null, ciclo: ini.ciclo, turno: i + 1, total: ini.combatentes.length,
    vez: vez ? (vez.visivel ? vez.id : "?") : null,             // quem está oculto não aparece pelo nome
    lugar: ini.combatentes.slice(0, i).filter(c => c.visivel).length,
    combatentes: ini.combatentes.filter(c => c.visivel).map(c => ({ id: c.id, nome: c.nome, jogador: c.jogador, cor: c.cor, valor: c.oculta ? c.base : c.valor })),
  };
  return OBR.room.setMetadata({ [CHAVE_INI]: publica }).then(() => publica);
}

/** "d200+150", "+50" ou "50" (d100). Devolve { q, f, b } ou null. */
export function lerDado(texto) {
  const s = String(texto ?? "").toLowerCase().replace(/\s+/g, "");
  if (!s) return null;
  const so = /^([+-]?\d+)$/.exec(s), m = /^(\d*)[de](\d+)([+-]\d+)?$/.exec(s);
  if (so) return { q: 1, f: 100, b: limitar(Number(so[1])) };
  if (!m) return null;
  const q = Number(m[1] || 1), f = Number(m[2]);
  return q >= 1 && q <= 20 && f >= 2 && f <= 100000 ? { q, f, b: limitar(Number(m[3] || 0)) } : null;
}
const limitar = n => Math.max(-999999, Math.min(999999, Math.round(n) || 0));
export const escreverDado = (d, semBonus) => `${d.q > 1 ? d.q : ""}d${d.f}${d.b && !semBonus ? (d.b > 0 ? "+" : "") + d.b : ""}`;

/** Iniciativa = Agilidade (odisseia-sistema.md, 6.1); Reflexo desempata. */
export function dadoDaFicha(f) {
  const a = f?.atributos?.find(x => /agil/i.test(x.key) || /agil/i.test(x.nome)) || f?.atributos?.find(x => /destreza|velocidade/i.test(x.nome));
  const dado = a && lerDado(notacaoDoAtributo(a));
  if (!dado) return null;
  return { dado, ref: Number(f.secundarios?.find(s => /reflexo/i.test(s.nome))?.valor) || Math.floor((Number(a.valor) || 0) / 2) };
}

/** Confere o "pronto" que veio de outro jogador. */
export function lerPronto(meta) {
  const p = meta?.[PRONTO], d = p?.dado;
  if (!d || ![d.q, d.f, d.b].every(Number.isInteger)) return null;
  const dado = lerDado(`${d.q}d${d.f}${d.b < 0 ? d.b : "+" + d.b}`);
  return dado && { nome: String(p.nome || "").slice(0, 40), dado, ref: Number(p.ref) || 0 };
}
/** O jogador pega (ou larga) o dado de iniciativa. Devolve o erro, se houver. */
export async function alternarPronto(pronto) {
  if (pronto) return void await OBR.player.setMetadata({ [PRONTO]: undefined });
  const ficha = ler(LOCAL), d = dadoDaFicha(ficha);
  if (!d) return ficha ? "Não achei a Agilidade na sua ficha." : "Carregue sua ficha antes.";
  await OBR.player.setMetadata({ [PRONTO]: { nome: ficha.nome, ...d } });
}

const sorte = f => {
  // sem favorecer nenhum número
  const u = new Uint32Array(1), teto = Math.floor(4294967296 / f) * f;
  do crypto.getRandomValues(u); while (u[0] >= teto);
  return (u[0] % f) + 1;
};
const rolar = c => {
  if (!c.dado) return c.valor == null ? rolar({ ...c, dado: { q: 1, f: 100, b: 0 } }) : { ...c, base: c.valor };
  let base = 0;
  for (let i = 0; i < c.dado.q; i++) base += sorte(c.dado.f);
  return { ...c, base, valor: base + c.dado.b };
};
export const ordenar = l => [...l].sort((a, b) => (b.valor ?? -Infinity) - (a.valor ?? -Infinity) || (b.ref || 0) - (a.ref || 0) || (b.jogador ? 1 : 0) - (a.jogador ? 1 : 0));

const TONS = ["#ff6b5e", "#ffb13d", "#b58cff", "#5fd0c5", "#ff7ac8", "#9ccf52", "#6fa8ff", "#e0c36a"];
export const corDoNome = nome => TONS[[...String(nome).replace(/\s*\d+$/, "")].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7) % TONS.length];
export const combatenteDe = (p, pronto) => ({ id: novoId(), nome: pronto.nome || p.name, cor: corSegura(p.color), visivel: true, jogador: p.id, dado: pronto.dado, ref: pronto.ref });

/** Junta quem está pronto, rola tudo, mostra a animação a todos e começa o combate em ordem. */
export async function iniciarIniciativa(ini, jogadores) {
  const lista = [...ini.combatentes];
  for (const p of jogadores) {
    const pronto = lerPronto(p.metadata);
    if (!pronto) continue;
    const i = lista.findIndex(c => c.jogador === p.id);
    if (i < 0) lista.push(combatenteDe(p, pronto));
    else lista[i] = { ...lista[i], dado: pronto.dado, ref: pronto.ref, cor: corSegura(p.color) };
  }
  if (!lista.length) return null;
  const combatentes = ordenar(lista.map(rolar)), rol = { id: novoId(), t: Date.now() };
  const nova = { ...ini, ativo: true, chamada: false, ciclo: 1, vez: combatentes[0].id, combatentes, rol };
  const lados = combatentes.filter(c => c.visivel).slice(0, MAX_LADOS).map(c => ({ nome: c.nome, cor: corSegura(c.cor), rotulo: "", faces: c.dado ? c.dado.q * c.dado.f : 0, base: c.base, bonus: c.oculta ? null : c.dado?.b || 0, nat: 0 }));
  await publicarIni(nova);
  if (lados.length) await OBR.broadcast.sendMessage(CONFRONTO, { id: rol.id, modo: "iniciativa", lados, rapido: false }, { destination: "ALL" });
  return nova;
}
/** Quem chega com o combate andando rola sozinho e entra no lugar dele. */
export const entrarNoMeio = (ini, novos) => ({ ...ini, combatentes: ordenar([...ini.combatentes, ...novos.map(rolar)]) });

let jaLeu = false;
const fins = new Map();
/** Quanto falta (ms) para a animação acabar neste navegador: antes disso a ordem não aparece. */
export function faltaAnimacao(publica) {
  const r = publica?.rol;
  // quem entrou depois não tem por que esperar (os relógios não batem, então vale o menor)
  if (r && !fins.has(r.id)) fins.set(r.id, jaLeu ? Date.now() + DUR_ANIMACAO : Math.min(Date.now(), Number(r.t) || 0) + DUR_ANIMACAO);
  jaLeu = true;
  return r && publica.ativo ? Math.max(0, fins.get(r.id) - Date.now()) : 0;
}
