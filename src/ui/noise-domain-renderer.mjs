import { noisePhases, noiseRectAt } from '../core/noise-domain.mjs';

const fract = value => value - Math.floor(value);
const hash = (x, y, frame) => fract(Math.sin(x * 127.1 + y * 311.7 + frame * 74.7) * 43758.5453123);

/** Canvas approximation of Phigros' block-area compositor.
 * The scene copy, red body, fog, speckles and pixel edge all share one animated
 * displacement field, so the edge cannot visually detach from the distortion.
 */
export class NoiseDomainRenderer {
  constructor() {
    this.source = null;
    this.selected = -1;
  }

  draw(context, areas, seconds, viewport) {
    if (!Array.isArray(areas) || !areas.some(area => noisePhases(area, seconds).visible) || typeof document === 'undefined') return;
    const canvas = context.canvas;
    if (!this.source) this.source = document.createElement('canvas');
    if (this.source.width !== canvas.width || this.source.height !== canvas.height) { this.source.width = canvas.width; this.source.height = canvas.height; }
    const source = this.source.getContext('2d'); source.setTransform(1, 0, 0, 1, 0, 0); source.clearRect(0, 0, this.source.width, this.source.height); source.drawImage(canvas, 0, 0);
    const ratio = globalThis.devicePixelRatio || 1;
    const frame = Math.floor(seconds * 48);
    for (const [index, area] of areas.entries()) {
      const phases = noisePhases(area, seconds); if (!phases.visible) continue;
      const rect = noiseRectAt(area, seconds);
      const centerX = viewport.left + rect.center.x * viewport.width;
      const centerY = viewport.top + rect.center.y * viewport.height;
      const width = Math.max(0.5, rect.width * viewport.width);
      const height = Math.max(0.5, rect.height * viewport.height);
      context.save(); context.translate(centerX, centerY); context.rotate(rect.rotation * Math.PI / 180);
      context.beginPath(); context.rect(-width / 2, -height / 2, width, height); context.clip(); context.rotate(-rect.rotation * Math.PI / 180); context.translate(-centerX, -centerY);

      const strength = phases.active ? 15 : 5;
      const strip = Math.max(2, Math.round(3 * ratio));
      const top = Math.max(viewport.top, centerY - height * 0.75); const bottom = Math.min(viewport.top + viewport.height, centerY + height * 0.75);
      context.globalAlpha = phases.active ? 0.82 : 0.45;
      for (let y = top; y < bottom; y += strip) {
        const displacement = (hash(Math.floor(y / strip), index, frame) - 0.5) * strength * 2 + Math.sin(y * 0.071 + seconds * 29 + index) * strength * 0.45;
        const vertical = (hash(Math.floor(y / strip) + 41, index + 17, frame) - 0.5) * strength * 1.35;
        const sourceY = Math.max(0, Math.min(this.source.height - strip * ratio, (y + vertical) * ratio));
        context.drawImage(this.source, 0, sourceY, this.source.width, strip * ratio, displacement, y, canvas.width / ratio, strip);
      }

      context.globalCompositeOperation = 'source-over';
      const pulse = 0.5 + 0.5 * Math.sin(seconds * 31 + index * 2.7);
      context.globalAlpha = phases.active ? 0.22 + pulse * 0.07 : 0.12;
      context.fillStyle = phases.active ? '#ad101c' : '#d87b82';
      context.fillRect(viewport.left, viewport.top, viewport.width, viewport.height);
      const fog = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.max(width, height) * 0.72);
      fog.addColorStop(0, phases.active ? 'rgba(155,15,25,.34)' : 'rgba(205,105,115,.17)'); fog.addColorStop(1, 'rgba(90,0,8,0)');
      context.globalAlpha = 1; context.fillStyle = fog; context.fillRect(viewport.left, viewport.top, viewport.width, viewport.height);

      const cell = Math.max(3, Math.round(4 * ratio));
      context.fillStyle = phases.active ? '#f04450' : '#e8a4a8';
      for (let y = Math.floor(top / cell) * cell; y < bottom; y += cell) for (let x = Math.floor((centerX - width) / cell) * cell; x < centerX + width; x += cell) {
        const value = hash(x / cell, y / cell, frame + index * 17);
        if (value > (phases.active ? 0.86 : 0.94)) { context.globalAlpha = (value - 0.84) * (phases.active ? 2.9 : 1.5); context.fillRect(x, y, cell * (value > 0.96 ? 1.7 : 0.8), cell * 0.65); }
      }
      if (phases.ready) {
        context.globalAlpha = 0.08 + 0.08 * (0.5 + 0.5 * Math.sin(seconds * 55)); context.fillStyle = '#fff'; context.fillRect(viewport.left, viewport.top, viewport.width, viewport.height);
      }
      context.restore();

      // Pixel edge uses the same frame/hash displacement as the body. No glow.
      context.save(); context.translate(centerX, centerY); context.rotate(rect.rotation * Math.PI / 180);
      context.strokeStyle = phases.active ? 'rgba(214,34,46,.92)' : 'rgba(219,118,126,.72)';
      context.lineWidth = Math.max(1, 1.25 * ratio); context.lineJoin = 'miter';
      context.setLineDash([]);
      const segment = Math.max(3, 4 * ratio); const jitter = Math.min(4.5, strength * 0.32);
      const edge = (x1, y1, x2, y2, edgeIndex) => {
        const length = Math.hypot(x2 - x1, y2 - y1); const count = Math.max(1, Math.ceil(length / segment));
        context.beginPath();
        for (let part = 0; part <= count; part++) {
          const amount = part / count; const baseX = x1 + (x2 - x1) * amount; const baseY = y1 + (y2 - y1) * amount;
          const amountJitter = (hash(part + edgeIndex * 137, index, frame) - 0.5) * 2 * jitter;
          const x = baseX + (y2 === y1 ? 0 : amountJitter); const y = baseY + (x2 === x1 ? 0 : amountJitter);
          if (!part) context.moveTo(x, y); else context.lineTo(x, y);
        }
        context.stroke();
      };
      edge(-width / 2, -height / 2, width / 2, -height / 2, 0);
      edge(width / 2, -height / 2, width / 2, height / 2, 1);
      edge(width / 2, height / 2, -width / 2, height / 2, 2);
      edge(-width / 2, height / 2, -width / 2, -height / 2, 3);
      if (index === this.selected) {
        context.setLineDash([]); context.strokeStyle = '#ffd45c'; context.lineWidth = 1;
        context.strokeRect(-width / 2 - 3, -height / 2 - 3, width + 6, height + 6);
      }
      context.restore();
    }
    context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
  }
}
