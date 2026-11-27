// Bolha com o nome em cima do token selecionado. É um item local: existe só no navegador do mestre.
const MARCA = "senshi.ficha/nome";
const CAMADAS = ["CHARACTER", "MOUNT", "PROP"];

function bolha(OBR, token, nome, topo) {
  const agora = new Date().toISOString(), eu = OBR.player.id;
  return {
    id: `${MARCA}/${token.id}`, type: "LABEL", name: "Nome", layer: "TEXT", visible: true, locked: true,
    createdUserId: eu, lastModifiedUserId: eu, lastModified: agora, zIndex: Date.now(),
    position: topo, rotation: 0, scale: { x: 1, y: 1 }, metadata: { [MARCA]: nome },
    attachedTo: token.id, disableHit: true, disableAttachmentBehavior: ["SCALE", "ROTATION", "VISIBLE", "LOCKED", "COPY"],
    text: {
      type: "PLAIN", plainText: nome, richText: [{ type: "paragraph", children: [{ text: "" }] }], width: "AUTO", height: "AUTO",
      style: { padding: 8, fontFamily: "Roboto", fontSize: 24, fontWeight: 700, textAlign: "CENTER", textAlignVertical: "MIDDLE", fillColor: "#ffffff", fillOpacity: 1, strokeColor: "#ffffff", strokeOpacity: 1, strokeWidth: 0, lineHeight: 1.3 },
    },
    style: { backgroundColor: "#14121f", backgroundOpacity: 0.92, cornerRadius: 12, pointerDirection: "DOWN", pointerWidth: 12, pointerHeight: 10 },
  };
}

/** Deixa na tela uma bolha por token selecionado (e nenhuma para quem não é mestre). */
export async function atualizarNomes(OBR) {
  if (!await OBR.scene.isReady()) return;
  const mestre = await OBR.player.getRole() === "GM";
  const selecao = (mestre && await OBR.player.getSelection()) || [];
  const tokens = selecao.length ? (await OBR.scene.items.getItems(selecao)).filter(i => CAMADAS.includes(i.layer)) : [];
  const quer = new Map(tokens.map(t => [t.id, (t.text?.plainText || t.name || "Token").trim()]));
  const tem = await OBR.scene.local.getItems(i => MARCA in i.metadata);
  const sai = tem.filter(b => quer.get(b.attachedTo) !== b.metadata[MARCA]);
  if (sai.length) await OBR.scene.local.deleteItems(sai.map(b => b.id));
  const ficam = new Set(tem.filter(b => !sai.includes(b)).map(b => b.attachedTo));
  const novas = await Promise.all(tokens.filter(t => !ficam.has(t.id)).map(async t => {
    const { min, max } = await OBR.scene.items.getItemBounds([t.id]);
    return bolha(OBR, t, quer.get(t.id), { x: (min.x + max.x) / 2, y: min.y });
  }));
  if (novas.length) await OBR.scene.local.addItems(novas);
}

export function ligarNomes(OBR) {
  // um de cada vez: cliques rápidos não duplicam a bolha
  let fila = Promise.resolve();
  const ver = () => { fila = fila.then(() => atualizarNomes(OBR)).catch(console.warn); };
  OBR.player.onChange(ver);
  OBR.scene.onReadyChange(ver);
  OBR.scene.items.onChange(ver);
  ver();
}
