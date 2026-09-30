// フォーメーション図のアイコンをドラッグで動かす (マウス・タッチ共通)。
// 動かしている間は SVG を直接動かし、離したときだけ onDrop で状態に反映する。
import { PITCH_LENGTH as L, PITCH_WIDTH as W, clampRatio } from './logic.js';

export function enableDrag(svg, layer, { getPosition, onDrop }) {
  const toPitch = (clientX, clientY) =>
    new DOMPoint(clientX, clientY).matrixTransform(svg.getScreenCTM().inverse());

  svg.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('.icon');
    if (!g || e.button > 0) return;
    e.preventDefault();
    const side = g.dataset.side;
    const row = Number(g.dataset.row);
    const start = getPosition(side, row);
    const grab = toPitch(e.clientX, e.clientY);
    const offset = { x: start.x * L - grab.x, y: start.y * W - grab.y };
    layer.appendChild(g); // 掴んだアイコンを最前面へ (離すと描き直される)
    g.setPointerCapture(e.pointerId);
    let last = null;

    const move = (ev) => {
      const p = toPitch(ev.clientX, ev.clientY);
      last = { x: clampRatio((p.x + offset.x) / L), y: clampRatio((p.y + offset.y) / W) };
      g.setAttribute('transform', `translate(${last.x * L} ${last.y * W})`);
    };
    const end = () => {
      g.removeEventListener('pointermove', move);
      g.removeEventListener('pointerup', end);
      g.removeEventListener('pointercancel', end);
      if (last) onDrop(side, row, last);
    };
    g.addEventListener('pointermove', move);
    g.addEventListener('pointerup', end);
    g.addEventListener('pointercancel', end);
  });
}
