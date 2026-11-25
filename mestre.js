import { OBR, CANAL_AJUSTE, cabecalhoDe, corSegura, lerFicha, aplicarExpressao } from "./shared.js?v=18";
import { INI_VAZIA, avancar, alternarPronto, combatenteDe, coresDaFicha, corDoNome, dadoDaFicha, entrarNoMeio, escreverDado, faltaAnimacao, iniciarIniciativa, iniciarSemRolar, lerDado, lerPronto, novoId, ordenar, publicarIni } from "./iniciativa.js?v=18";
import { h, botaoIcone, estado, abertos, rascunho, ui, redesenhar, details, titulo, campo, seletor, confirmar } from "./nucleo.js?v=18";
import { barra, fichaView } from "./paineis.js?v=18";
import { novaJanela } from "./janelas.js?v=18";

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
async function salvarIni(ini) {
  estado.iniMestre = ini;
  redesenhar();
  try { estado.iniPublica = await publicarIni(ini); } catch { OBR.notification.show("O Owlbear não aceitou publicar a iniciativa.", "ERROR"); }
}

function contador(ciclo, turno, total) {
  return h("div", { class: "ini-contador" },
    h("div", {}, h("span", { class: "mudo" }, "Ciclo"), h("b", {}, ciclo)),
    h("div", {}, h("span", { class: "mudo" }, "Turno"), h("b", {}, turno, h("small", {}, `/${total}`)),
      h("div", { class: "pontos" }, Array.from({ length: Math.min(16, total) }, (_, i) => h("i", { "data-cheio": i < turno })))));
}
/** A roleta na mão de quem está pronto. */
const roletinha = (nome, cor, dado) => h("div", { class: "roletinha", style: { "--cor": corSegura(cor) } }, h("i", {}, h("b", {}, "d" + dado.f)), h("span", {}, nome), h("small", {}, dado.b ? (dado.b > 0 ? "+" : "") + dado.b : ""));

/** O nome do personagem de jogador leva as cores da ficha dele. */
const nomeDe = c => c.cor2 ? h("span", { class: "nome-ficha", style: { "--cor": corSegura(c.cor), "--cor2": corSegura(c.cor2) } }, c.nome) : c.nome;

let arrastando = null;
function painelMestre() {
  const ini = { ...INI_VAZIA(), ...estado.iniMestre };
  const mudar = alteracao => salvarIni({ ...ini, ...alteracao });
  const lista = ini.combatentes;
  const por = (c, patch) => mudar({ combatentes: lista.map(x => x.id === c.id ? { ...x, ...patch } : x) });
  const mover = (de, para) => { if (para < 0 || para >= lista.length || de === para) return; const c = [...lista]; c.splice(para, 0, ...c.splice(de, 1)); mudar({ combatentes: c }); };
  // com o combate andando, quem chega já rola e entra no lugar dele
  const juntar = novos => { if (novos.length) ini.ativo ? salvarIni(entrarNoMeio(ini, novos)) : mudar({ combatentes: [...lista, ...novos] }); };

  const adicionar = () => {
    const texto = (rascunho["ini-nome"] || "").trim(), bruto = (rascunho["ini-dado"] || "").trim(), dado = lerDado(bruto || "d100");
    if (!texto) return;
    if (!dado) return OBR.notification.show("Dado não entendido. Use d200+150, +50 ou 50.", "WARNING");
    const visivel = rascunho["ini-visivel"] !== "0", oculta = rascunho["ini-oculta"] === "1";
    // "Goblin x3" cria Goblin 1, Goblin 2 e Goblin 3
    const m = /^(.+?)\s+x(\d{1,2})$/i.exec(texto), novo = nome => ({ id: novoId(), nome, cor: corDoNome(nome), visivel, oculta, dado });
    rascunho["ini-nome"] = "";
    juntar(m ? Array.from({ length: Math.max(1, Math.min(20, Number(m[2]))) }, (_, i) => novo(`${m[1]} ${i + 1}`)) : [novo(texto)]);
  };
  const prontos = estado.jogadores.map(p => [p, lerPronto(p.metadata)]).filter(([, x]) => x), esperando = prontos.filter(([p]) => !lista.some(c => c.jogador === p.id));
  const semClicar = estado.jogadores.filter(p => cabecalhoDe(p.metadata) && !prontos.some(([x]) => x.id === p.id) && !lista.some(c => c.jogador === p.id));
  // o mestre pode pôr quem não clicou, lendo a Agilidade da ficha
  const porTodos = async () => {
    const novos = [];
    for (const p of semClicar) {
      const f = await fichaDe(p), d = dadoDaFicha(f);
      if (d) novos.push(combatenteDe(p, { nome: f.nome, ...d, ...coresDaFicha(f) }));
    }
    if (novos.length < semClicar.length) OBR.notification.show("Há ficha sem Agilidade: peça para o jogador rolar.", "WARNING");
    juntar(novos);
  };
  const iniciar = async () => {
    try {
      const nova = await iniciarIniciativa(ini, estado.jogadores);
      if (nova) { estado.iniMestre = nova; redesenhar(); }
    } catch { OBR.notification.show("O Owlbear não aceitou publicar a iniciativa.", "ERROR"); }
  };
  const comecar = async () => {
    try {
      const nova = await iniciarSemRolar(ini, estado.jogadores);
      if (nova) { estado.iniMestre = nova; redesenhar(); }
    } catch { OBR.notification.show("O Owlbear não aceitou publicar a iniciativa.", "ERROR"); }
  };
  const marca = (chave, padrao, rotulo, dica) => {
    const el = h("input", { type: "checkbox", onchange: e => { rascunho[chave] = e.target.checked ? "1" : "0"; } });
    el.checked = (rascunho[chave] ?? padrao) === "1";
    return h("label", { class: "linha mudo", title: dica }, el, rotulo);
  };

  const linha = (c, i) => {
    const p = c.jogador && estado.jogadores.find(x => x.id === c.jogador), cab = p && cabecalhoDe(p.metadata), vida = cab?.recursos?.[0];
    const valor = h("input", { type: "number", class: "ini-valor", placeholder: "–", title: "Resultado da iniciativa. Mude aqui e clique em Ordenar.", "aria-label": `Iniciativa de ${c.nome}`, "data-foco": "iv:" + c.id, onchange: e => por(c, { valor: e.target.value === "" ? undefined : Number(e.target.value) }) });
    valor.value = c.valor ?? "";
    const dado = h("input", { class: "ini-dado", title: "Dado e bônus", "aria-label": `Dado de ${c.nome}`, "data-foco": "id:" + c.id, onchange: e => { const d = lerDado(e.target.value); d ? por(c, { dado: d, valor: undefined, fixo: false }) : redesenhar(); } });
    const fixo = h("input", { type: "number", class: "ini-valor", placeholder: "fixo", title: "Valor fixo: entra com este número, sem rolar. Apague para voltar a rolar o dado.", "aria-label": `Valor fixo de ${c.nome}`, "data-foco": "if:" + c.id, onchange: e => por(c, e.target.value === "" ? { fixo: false, valor: undefined } : { fixo: true, valor: Number(e.target.value) }) });
    fixo.value = c.fixo ? c.valor ?? "" : "";
    dado.value = c.dado ? escreverDado(c.dado) : "";
    return h("li", {
      draggable: "true", "data-vez": ini.ativo && c.id === ini.vez, "data-oculto": !c.visivel, style: { "--cor": corSegura(c.cor) },
      ondragstart: e => { arrastando = i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.nome); },
      ondragover: e => { if (arrastando != null) e.preventDefault(); },
      ondrop: e => { if (arrastando != null) { e.preventDefault(); e.stopPropagation(); mover(arrastando, i); } arrastando = null; },
      ondragend: () => { arrastando = null; },
    },
    h("button", { class: "marca", title: "Dar a vez a este combatente", onclick: () => mudar({ vez: c.id }), "aria-label": `Dar a vez a ${c.nome}` }, ini.ativo && c.id === ini.vez ? "▶" : i + 1),
    ini.ativo ? valor : [dado, fixo],
    h("span", { class: "nome", title: c.nome }, nomeDe(c), vida ? h("span", { class: "fio", style: { "--p": (vida.max > 0 ? Math.max(0, Math.min(100, vida.atual / vida.max * 100)) : 0) + "%", "--cor": corSegura(vida.cor) }, title: `${vida.nome} ${vida.atual}/${vida.max}` }) : null),
    p && cab ? botaoIcone("jogador", "Abrir a ficha", () => abrirFicha(p.id)) : null,
    c.jogador ? null : h("button", { class: "ico", title: c.oculta ? "Bônus escondido: os jogadores veem só o número do dado. Clique para mostrar." : "Bônus à mostra. Clique para esconder.", "aria-label": c.oculta ? `Mostrar o bônus de ${c.nome}` : `Esconder o bônus de ${c.nome}`, onclick: () => por(c, { oculta: !c.oculta }) }, c.oculta ? "🙈" : "±"),
    h("button", { class: "ico", title: c.visivel ? "Visível para os jogadores. Clique para ocultar." : "Oculto dos jogadores. Clique para mostrar.", "aria-label": c.visivel ? `Ocultar ${c.nome}` : `Mostrar ${c.nome}`, onclick: () => por(c, { visivel: !c.visivel }) }, c.visivel ? "👁" : "—"),
    h("span", { class: "sobe" }, h("button", { onclick: () => mover(i, i - 1), "aria-label": `Subir ${c.nome}`, disabled: i === 0 }, "▴"), h("button", { onclick: () => mover(i, i + 1), "aria-label": `Descer ${c.nome}`, disabled: i === lista.length - 1 }, "▾")),
    botaoIcone("fechar", `Remover ${c.nome}`, () => { const combatentes = lista.filter(x => x.id !== c.id); mudar({ combatentes, vez: ini.vez === c.id ? (combatentes[Math.min(i, combatentes.length - 1)]?.id ?? null) : ini.vez }); }));
  };

  return h("div", {},
    ini.ativo
      ? [contador(ini.ciclo, Math.max(0, lista.findIndex(c => c.id === ini.vez)) + 1, lista.length),
        h("div", { class: "linha", style: { margin: "10px 0" } },
          h("button", { onclick: () => mudar(avancar(ini, -1)), "aria-label": "Turno anterior" }, "◀"), h("button", { class: "forte cresce", onclick: () => mudar(avancar(ini, 1)) }, "Próximo turno ▶"),
          // os jogadores rolam de novo no próximo combate; os mobs ficam para reaproveitar
          confirmar("ini-fim", "Encerrar", () => salvarIni({ ...INI_VAZIA(), combatentes: lista.filter(c => !c.jogador).map(({ valor, base, ...c }) => c) })))]
      : h("div", { class: "ini-sala" },
        prontos.length ? h("div", { class: "roletinhas" }, prontos.map(([p, x]) => roletinha(x.nome || p.name, x.cor || p.color, x.dado))) : h("p", { class: "mudo" }, "Ninguém está com o dado na mão ainda."),
        h("div", { class: "linha" },
          h("button", { "aria-pressed": String(!!ini.chamada), title: "Mostra o botão de rolar no alto da tela de todos", onclick: () => mudar({ chamada: !ini.chamada }) }, ini.chamada ? "Chamando…" : "Chamar jogadores"),
          h("button", { class: "forte cresce", onclick: iniciar, disabled: !prontos.length && !lista.length }, `Iniciar iniciativa (${lista.length + esperando.length})`)),
        h("button", { class: "cresce", title: "Começa já, na ordem da lista e com os valores que você pôs: sem rolar e sem animação. Mude a ordem com ▴ ▾ ou arrastando.", onclick: comecar, disabled: !prontos.length && !lista.length }, "Começar sem rolar")),
    ini.ativo && esperando.length ? h("div", { class: "nota linha" }, h("span", { class: "cresce" }, `${esperando.map(([p, x]) => x.nome || p.name).join(", ")} quer entrar.`), h("button", { onclick: () => juntar(esperando.map(([p, x]) => combatenteDe(p, x))) }, "Deixar entrar")) : null,
    titulo("Combatentes", ini.ativo ? h("button", { class: "link", title: "Do maior valor para o menor", onclick: () => mudar({ combatentes: ordenar(lista) }) }, "Ordenar") : esperando.length ? h("button", { class: "link", title: "Põe na lista quem está com o dado na mão, para você mudar a ordem ou fixar o valor", onclick: () => juntar(esperando.map(([p, x]) => combatenteDe(p, x))) }, `Pôr os prontos (${esperando.length})`) : null),
    h("ul", { class: "ini-lista" }, lista.length ? lista.map(linha) : h("li", { class: "mudo" }, "Só os jogadores prontos, por enquanto.")),
    titulo("Adicionar", semClicar.length ? h("button", { class: "link", title: "Usa a Agilidade da ficha de quem não clicou", onclick: porTodos }, `Jogadores que faltam (${semClicar.length})`) : null),
    h("div", { class: "linha" }, campo("ini-nome", { placeholder: "Nome, ou Goblin x3", "aria-label": "Nome do combatente", onkeydown: e => { if (e.key === "Enter") adicionar(); } }),
      campo("ini-dado", { placeholder: "d100+50", class: "ini-dado", "aria-label": "Dado e bônus", onkeydown: e => { if (e.key === "Enter") adicionar(); } }), h("button", { class: "forte", onclick: adicionar, "aria-label": "Adicionar" }, "＋")),
    h("div", { class: "linha", style: { marginTop: "6px" } }, marca("ini-visivel", "1", "visível aos jogadores", "Desligado, o combatente não aparece para eles"), marca("ini-oculta", "0", "esconder o bônus", "Os jogadores veem só o número do dado")),
    lista.length ? h("div", { class: "linha rodape" }, confirmar("ini-limpar", "Limpar lista", () => salvarIni(INI_VAZIA()))) : null);
}

export const minhaVez = () => { const i = estado.iniPublica; return !!i?.ativo && !faltaAnimacao(i) && !!i.combatentes?.some(c => c.id === i.vez && c.jogador === estado.meuId); };

function painelDoJogador() {
  const ini = estado.iniPublica, meu = estado.meuPronto, dado = meu?.dado || dadoDaFicha(estado.ficha)?.dado;
  const jaEstou = ini?.ativo && ini.combatentes?.some(c => c.jogador === estado.meuId);
  const rolar = jaEstou ? null : h("div", { class: "ini-sala" },
    meu ? h("div", { class: "roletinhas" }, roletinha(meu.nome, estado.ficha?.cores?.tema, meu.dado)) : null,
    h("button", { class: meu ? "" : "forte", "aria-pressed": String(!!meu), onclick: async () => { const erro = await alternarPronto(meu); if (erro) OBR.notification.show(erro, "WARNING"); } }, meu ? "Largar o dado" : `Rolar iniciativa${dado ? ` · ${escreverDado(dado)}` : ""}`),
    meu ? h("p", { class: "mudo" }, ini?.ativo ? "Esperando o mestre deixar você entrar." : "Dado na mão. Esperando o mestre iniciar.") : null);
  const falta = faltaAnimacao(ini);
  if (falta) setTimeout(redesenhar, falta + 60);
  if (!ini?.ativo || falta) {
    const outros = estado.jogadores.map(p => [p, lerPronto(p.metadata)]).filter(([, x]) => x);
    return h("div", {}, falta ? h("p", { class: "vazio mudo" }, "Rolando a iniciativa…") : [rolar, outros.length ? [titulo("Prontos"), h("div", { class: "roletinhas" }, outros.map(([p, x]) => roletinha(x.nome || p.name, x.cor || p.color, x.dado)))] : null]);
  }
  const i = ini.combatentes.findIndex(c => c.id === ini.vez), eu = ini.combatentes.findIndex(c => c.jogador === estado.meuId);
  const ate = i >= 0 && eu >= 0 ? (eu - i + ini.combatentes.length) % ini.combatentes.length : -1;
  return h("div", {},
    minhaVez() ? h("div", { class: "sua-vez" }, "É a sua vez") : null,
    contador(ini.ciclo, ini.turno, ini.total),
    rolar,
    ini.vez === "?" ? h("p", { class: "nota" }, "Agora é a vez de alguém que você ainda não percebeu…") : ate > 0 ? h("p", { class: "nota" }, ate === 1 ? "Você é o próximo da lista." : `Faltam ${ate} até a sua vez, contando só quem você vê.`) : null,
    h("ul", { class: "ini-lista" }, ini.combatentes.map((c, k) => h("li", { "data-vez": c.id === ini.vez, style: { "--cor": corSegura(c.cor) } },
      h("span", { class: "marca" }, c.id === ini.vez ? "▶" : k + 1),
      h("span", { class: "nome" }, nomeDe(c)),
      c.valor != null ? h("b", { class: "mudo" }, c.valor) : null,
      c.jogador === estado.meuId ? h("span", { class: "voce" }, "você") : null))));
}

export const painelIniciativa = () => estado.souGM ? painelMestre() : painelDoJogador();
