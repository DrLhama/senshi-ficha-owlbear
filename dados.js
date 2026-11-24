import { OBR, ler, guardar, corSegura, lerCombo } from "./shared.js?v=10";
import { estado, redesenhar } from "./nucleo.js?v=10";

// ── rolagens pelos Senshi Dados ───────────────────────────────
// A outra extensão recebe o pedido, abre com os dados prontos e devolve um resultado por linha.
const PEDIDO = "senshi.dados/pedido", RECEBIDO = "senshi.dados/recebido";
export const RESULTADO = "senshi.dados/resultado";
export const CHAVE_SISTEMA = "senshi/sistema-dados";
export const SISTEMAS = [["senshi", "Senshi Dados"], ["diceplus", "Dice+"]];
const LINK_SENSHI_DADOS = "https://drlhama.github.io/senshi-dados/manifest.json";
const pedidos = new Map();                 // id do pedido -> { chave, partes }

/** O que os Senshi Dados sabem rolar: dados e números somados (as mesmas regras de lá). */
export function suportada(formula) {
  const s = String(formula).toLowerCase().replace(/\s+/g, "");
  if (!/^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/.test(s) || /-\d*d/.test(s)) return false;
  const dados = [...s.matchAll(/(\d*)d(\d+)/g)].map(m => [Number(m[1] || 1), Number(m[2])]);
  const soma = l => l.reduce((n, [q]) => n + q, 0);
  return dados.length > 0 && dados.every(([q, f]) => q >= 1 && q <= 50 && f >= 2 && f <= 100000) && soma(dados) <= 60 && soma(dados.filter(([, f]) => f === 100 || f >= 1000)) <= 6;
}

async function pedirSenshiDados(notacao, chave, nome) {
  const linhas = lerCombo(notacao).map(l => ({ formula: l.notacao, rotulo: [nome, l.rotulo].filter((x, i, a) => x && a.indexOf(x) === i).join(" · ") }));
  if (!linhas.length || !linhas.every(l => suportada(l.formula))) return false;
  const id = "f" + crypto.randomUUID();
  const aceitou = new Promise(resolve => {
    const parar = OBR.broadcast.onMessage(RECEBIDO, ({ data }) => { if (data?.id === id) { parar(); resolve(true); } });
    setTimeout(() => { parar(); resolve(false); }, 1200);
  });
  pedidos.set(id, { chave, partes: [], total: linhas.length });
  await OBR.broadcast.sendMessage(PEDIDO, { id, linhas, hidden: (ler(CHAVE_ALVO) || "everyone") !== "everyone" }, { destination: "LOCAL" });
  if (await aceitou) return true;
  pedidos.delete(id);
  return false;
}

function escutarSenshiDados() {
  OBR.broadcast.onMessage(RESULTADO, ({ data }) => {
    const corte = String(data?.id || "").lastIndexOf(":"), p = pedidos.get(String(data?.id || "").slice(0, corte));
    if (!p) return;                                       // só a janela que pediu mostra; quem anota é o fundo
    if (data.erro) gravarResultado(p.chave, { total: undefined, texto: undefined, erro: String(data.erro) });
    else {
      p.partes[Number(String(data.id).slice(corte + 1))] = { rotulo: data.rotulo, total: data.total, texto: data.texto };
      const feitas = p.partes.filter(Boolean), uma = p.total === 1;
      gravarResultado(p.chave, { erro: undefined, total: uma ? feitas[0].total : undefined, texto: uma ? feitas[0].texto : feitas.map(x => `${x.rotulo || "Dado"}: ${x.total}`).join(" · ") });
    }
    redesenhar();
  });
}

// ── rolagens pelo Dice+ ───────────────────────────────────────
// Protocolo do Dice+ (https://dice-plus.missinglinkdev.com/learn-more): pedido em "dice-plus/roll-request",
// resultado em "<source>/roll-result" e erro em "<source>/roll-error".
const SOURCE = "senshi-ficha-owlbear";
const LINK_DICE_PLUS = "https://dice-plus.missinglinkdev.com/manifest.json";
export const ALVOS_ROLAGEM = [["everyone", "Todos veem"], ["dm", "Mestre e eu"], ["self", "Só eu"], ["gm_only", "Só o mestre"]];
export const CHAVE_ALVO = "senshi/alvo-rolagem";
export const CHAVE_ROLAGENS = "senshi/rolagens";
const pendentes = new Map();               // rollId -> { chave, nome, notacao }
export const ultimas = new Map();          // chave -> { texto, erro }; "<skill>:ult" guarda a mais recente de qualquer modo

export const gravarResultado = (chave, valor) => {
  // o texto de "o que foi gasto" sobrevive ao "Rolando…" e ao resultado dos dados que vêm depois
  const uso = ultimas.get(chave)?.uso;
  const v = { ...(uso && !("uso" in valor) ? { uso } : {}), ...valor };
  ultimas.set(chave, v);
  const i = chave.lastIndexOf(":m");
  if (i > 0) ultimas.set(chave.slice(0, i) + ":ult", v);
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

const luz = hex => { const n = parseInt(String(hex).replace("#", "").padEnd(6, "0").slice(0, 6), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; };
/** Visual dos dados enviado ao Dice+: a cor da ficha. (O saco de dados do próprio jogador no Dice+ vale mais.) */
function estiloDados() {
  const tema = corSegura(estado.ficha?.cores?.tema);
  return { color: tema, numberColor: luz(tema) > 0.55 ? "#10101a" : "#ffffff", metalness: 0.5, roughness: 0.3, sheen: 0.4 };
}

export async function rolar(notacao, chave, nome = "") {
  gravarResultado(chave, { texto: "Abrindo os dados…", total: undefined, erro: undefined });
  redesenhar();
  if ((ler(CHAVE_SISTEMA) || "senshi") === "senshi" && await pedirSenshiDados(notacao, chave, nome)) {
    gravarResultado(chave, { texto: "Dados prontos: role na janela de dados." });
    return redesenhar();
  }
  if (!(await dicePlusPronto())) {
    gravarResultado(chave, { texto: undefined, erro: `Nenhuma extensão de dados respondeu. Adicione no Owlbear (Perfil → Extensions → Add Custom Extension) os Senshi Dados: ${LINK_SENSHI_DADOS} ou o Dice+: ${LINK_DICE_PLUS}` });
    return redesenhar();
  }
  const rollId = "r_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  pendentes.set(rollId, { chave, nome, notacao });
  await OBR.broadcast.sendMessage("dice-plus/roll-request", {
    rollId, playerId: OBR.player.id, playerName: await OBR.player.getName(),
    rollTarget: ler(CHAVE_ALVO) || "everyone", diceNotation: notacao, showResults: true, timestamp: Date.now(), source: SOURCE,
    dice: { default: estiloDados() },
  }, { destination: "ALL" });
}

export function escutarDados() {
  escutarSenshiDados();
  OBR.broadcast.onMessage(SOURCE + "/roll-result", ({ data }) => {
    const p = pendentes.get(data?.rollId);
    if (!p) return;                                       // a janela que pediu é quem anota
    pendentes.delete(data.rollId);
    gravarResultado(p.chave, { total: data.result.totalValue, texto: data.result.rollSummary, erro: undefined });
    guardar(CHAVE_ROLAGENS, [{ t: Date.now(), nome: p.nome, notacao: p.notacao, total: data.result.totalValue, texto: data.result.rollSummary }, ...(ler(CHAVE_ROLAGENS) || [])].slice(0, 40));
    redesenhar();
  });
  OBR.broadcast.onMessage(SOURCE + "/roll-error", ({ data }) => {
    const p = pendentes.get(data?.rollId);
    if (!p || data.warning) return;
    pendentes.delete(data.rollId);
    gravarResultado(p.chave, { texto: undefined, erro: "Notação inválida no Dice+: " + (data.error?.message || data.error || "erro") });
    redesenhar();
  });
}

/** "D200" da ficha vira "1d200"; dados que não são dN (entidades) não rolam. */
export const notacaoDoAtributo = dado => { const m = /^(\d*)\s*d(\d+)$/i.exec(String(dado).trim()); return m ? `${m[1] || 1}d${m[2]}` : null; };
