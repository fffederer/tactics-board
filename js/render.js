// フォーメーション図 (SVG) の描画と PNG 書き出し。
// 単位はメートル (コート 105 x 68)。画像化したときにも同じ見た目になるよう、
// 見た目はすべて SVG の属性で指定し、CSS には頼らない。
import { PITCH_LENGTH as L, PITCH_WIDTH as W } from './logic.js';

const NS = 'http://www.w3.org/2000/svg';
const FONT = "'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic UI','Yu Gothic',Meiryo,sans-serif";
const LINE = '#111';
const LINE_W = 0.25;
const ICON_R = 2.2;

// 名前がコートの外にはみ出しても切れないよう、周囲に余白を取る。
export const VIEW = { x: -6, y: -3.5, w: L + 12, h: W + 10 };
const TITLE_BAND = 7;

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (parent) parent.appendChild(node);
  return node;
}

export function setupSvg(svg) {
  svg.setAttribute('viewBox', `${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`);
  svg.replaceChildren();
  drawPitch(el('g', { 'data-layer': 'pitch' }, svg));
  return el('g', { 'data-layer': 'icons' }, svg);
}

function drawPitch(g) {
  el('rect', { x: VIEW.x, y: VIEW.y - TITLE_BAND, width: VIEW.w, height: VIEW.h + TITLE_BAND, fill: '#fff' }, g);
  const stroke = { fill: 'none', stroke: LINE, 'stroke-width': LINE_W };
  const guide = { stroke: '#d9d9d9', 'stroke-width': LINE_W };

  // レーンの目安線 (参考画像のペナルティエリア幅・ゴールエリア幅の延長線)
  for (const y of [W / 2 - 20.16, W / 2 - 9.16, W / 2 + 9.16, W / 2 + 20.16]) {
    el('line', { x1: 0, y1: y, x2: L, y2: y, ...guide }, g);
  }

  el('rect', { x: 0, y: 0, width: L, height: W, ...stroke }, g);
  el('line', { x1: L / 2, y1: 0, x2: L / 2, y2: W, ...stroke }, g);
  el('circle', { cx: L / 2, cy: W / 2, r: 9.15, ...stroke }, g);
  el('circle', { cx: L / 2, cy: W / 2, r: 0.35, fill: LINE }, g);

  const arcDy = Math.sqrt(9.15 ** 2 - 5.5 ** 2);
  for (const [goalX, dir] of [[0, 1], [L, -1]]) {
    const box = (depth, width) =>
      el('rect', {
        x: dir === 1 ? goalX : goalX - depth,
        y: W / 2 - width / 2,
        width: depth,
        height: width,
        fill: '#fff',
        stroke: LINE,
        'stroke-width': LINE_W,
      }, g);
    box(16.5, 40.32);
    box(5.5, 18.32);
    const penX = goalX + dir * 11;
    el('circle', { cx: penX, cy: W / 2, r: 0.3, fill: LINE }, g);
    const edgeX = goalX + dir * 16.5;
    el('path', {
      d: `M ${edgeX} ${W / 2 - arcDy} A 9.15 9.15 0 0 ${dir === 1 ? 1 : 0} ${edgeX} ${W / 2 + arcDy}`,
      ...stroke,
    }, g);
    el('rect', {
      x: dir === 1 ? goalX - 1.2 : goalX,
      y: W / 2 - 3.66,
      width: 1.2,
      height: 7.32,
      fill: LINE,
    }, g);
  }

  // コーナーアーク
  for (const [cx, cy] of [[0, 0], [L, 0], [0, W], [L, W]]) {
    const sx = cx === 0 ? 1 : -1;
    const sy = cy === 0 ? 1 : -1;
    el('path', {
      d: `M ${cx + sx} ${cy} A 1 1 0 0 ${sx * sy > 0 ? 1 : 0} ${cx} ${cy + sy}`,
      ...stroke,
    }, g);
  }
}

// アイコン: 背番号入りの円、進行方向を示す小さな三角、下に略称。
export function renderIcons(layer, sides) {
  layer.replaceChildren();
  for (const { side, icons, iconColor, numberColor } of sides) {
    const dir = side === 'home' ? 1 : -1;
    for (const icon of icons) {
      const g = el('g', {
        class: 'icon',
        'data-side': side,
        'data-row': icon.row,
        transform: `translate(${icon.x * L} ${icon.y * W})`,
      }, layer);
      el('polygon', {
        points: `${dir * 2.55},-1.05 ${dir * 3.55},0 ${dir * 2.55},1.05`,
        fill: iconColor,
        stroke: '#00000055',
        'stroke-width': 0.12,
      }, g);
      el('circle', { r: ICON_R, fill: iconColor, stroke: '#00000055', 'stroke-width': 0.15 }, g);
      if (icon.number != null) {
        const num = el('text', {
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          y: -0.16,
          'font-size': String(icon.number).length > 2 ? 1.7 : 2.3,
          'font-weight': 700,
          'font-family': FONT,
          fill: numberColor,
        }, g);
        num.textContent = icon.number;
      }
      const name = el('text', {
        'text-anchor': 'middle',
        y: ICON_R + 2.4,
        'font-size': 2,
        'font-family': FONT,
        fill: '#111',
        stroke: '#fff',
        'stroke-width': 0.6,
        'paint-order': 'stroke',
        'stroke-linejoin': 'round',
      }, g);
      name.textContent = icon.short;
    }
  }
}

// フォーメーション図を PNG にする。画面の2倍の解像度で、上にチーム名とフォーメーション名を入れる。
export async function renderPng(svg, titles) {
  const rect = svg.getBoundingClientRect();
  // 画面に出ていない (iPhone で別タブを表示中) ときは、PC で一般的な表示サイズ相当にする。
  const onScreen = Math.min(rect.width / VIEW.w, rect.height / VIEW.h) || 8;
  const pxPerUnit = onScreen * 2;
  const vb = { x: VIEW.x, y: VIEW.y - TITLE_BAND, w: VIEW.w, h: VIEW.h + TITLE_BAND };
  const width = Math.round(vb.w * pxPerUnit);
  const height = Math.round(vb.h * pxPerUnit);

  const clone = svg.cloneNode(true);
  clone.setAttribute('xmlns', NS);
  clone.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  clone.setAttribute('width', width);
  clone.setAttribute('height', height);
  clone.removeAttribute('class');
  const titleAttrs = { y: -4.2, 'font-size': 2.8, 'font-weight': 700, 'font-family': FONT, fill: '#111' };
  el('text', { ...titleAttrs, x: 0, 'text-anchor': 'start' }, clone).textContent = titles.home;
  el('text', { ...titleAttrs, x: L, 'text-anchor': 'end' }, clone).textContent = titles.away;

  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
  const img = new Image();
  img.src = url;
  await img.decode();

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG を作れませんでした'))), 'image/png'),
  );
}
