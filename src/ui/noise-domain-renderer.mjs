import { assetUrl } from '../core/asset-url.mjs';
import { noisePhases, noiseRectAt } from '../core/noise-domain.mjs';

const clamp = value => Math.max(0, Math.min(1, value));
const fract = value => value - Math.floor(value);
const fallbackNoise = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);

/** Canvas reconstruction of Phigros 4.0.1's BlockArea compositor.
 * It follows the official low-resolution mask → displacement → edge/glow →
 * premultiplied fill structure while remaining compatible with the 2D preview.
 */
export class NoiseDomainRenderer {
  constructor() {
    this.selected = -1; this.canvases = new Map(); this.textures = new Map();
    if (typeof Image !== 'undefined') for (const name of ['BlockNoise1', 'PointNoise', 'FD_Noise', 'Block']) this.loadTexture(name);
  }

  loadTexture(name) {
    const image = new Image(); const record = { image, pixels: null, width: 0, height: 0 }; this.textures.set(name, record);
    image.src = assetUrl(`rpe/Texture/NoiseDomain/${name}.png`);
    image.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height);
      record.pixels = data.data; record.width = canvas.width; record.height = canvas.height;
    };
  }

  canvas(name, width, height) {
    if (!this.canvases.has(name)) this.canvases.set(name, document.createElement('canvas'));
    const canvas = this.canvases.get(name); if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    return canvas;
  }

  sample(name, u, v, mirror = true) {
    const texture = this.textures.get(name);
    if (!texture?.pixels) return fallbackNoise(u * 257, v * 263);
    const wrap = value => {
      if (!mirror) return fract(value + 1000);
      const period = ((value % 2) + 2) % 2; return period <= 1 ? period : 2 - period;
    };
    const x = Math.min(texture.width - 1, Math.floor(wrap(u) * texture.width));
    const y = Math.min(texture.height - 1, Math.floor(wrap(v) * texture.height));
    return texture.pixels[(y * texture.width + x) * 4] / 255;
  }

  draw(context, areas, seconds, viewport) {
    if (typeof document === 'undefined' || !Array.isArray(areas)) return;
    const visible = areas.map((area, index) => ({ area, index, phase: noisePhases(area, seconds), rect: noiseRectAt(area, seconds, viewport.width / viewport.height) })).filter(entry => entry.phase.visible);
    if (!visible.length) return;
    const ratio = globalThis.devicePixelRatio || 1; const canvas = context.canvas;
    const source = this.canvas('scene', canvas.width, canvas.height); const sourceContext = source.getContext('2d');
    sourceContext.setTransform(1, 0, 0, 1, 0, 0); sourceContext.clearRect(0, 0, source.width, source.height); sourceContext.drawImage(canvas, 0, 0);

    // Official masks are Screen/8 and point filtered.
    const maskWidth = Math.max(1, Math.ceil(viewport.width * ratio / 8)); const maskHeight = Math.max(1, Math.ceil(viewport.height * ratio / 8));
    const groups = { active: [], ready: [], disabled: [] };
    for (const entry of visible) groups[entry.phase.active ? 'active' : entry.phase.ready ? 'ready' : 'disabled'].push(entry);
    const active = this.composedMask(groups.active, maskWidth, maskHeight);
    const warped = this.displaceMask(active, maskWidth, maskHeight, seconds);
    const ready = this.composedMask(groups.ready, maskWidth, maskHeight);
    const disabled = this.composedMask(groups.disabled, maskWidth, maskHeight);

    if (hasMask(disabled)) this.drawDisabled(context, disabled, maskWidth, maskHeight, viewport, ratio, seconds, false);
    if (hasMask(ready)) this.drawDisabled(context, ready, maskWidth, maskHeight, viewport, ratio, seconds, true);
    if (hasMask(warped)) this.drawActive(context, source, warped, maskWidth, maskHeight, viewport, ratio, seconds);
    this.drawSelection(context, visible, viewport, ratio);
    context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
  }

  composedMask(entries, width, height) {
    const normal = this.rasterMask(entries.filter(entry => !entry.area.isSubtract), width, height, 'normal');
    const subtract = this.rasterMask(entries.filter(entry => entry.area.isSubtract), width, height, 'subtract');
    const result = new Uint8ClampedArray(width * height);
    for (let index = 0; index < result.length; index++) result[index] = Math.abs(normal[index] - subtract[index]);
    return result;
  }

  rasterMask(entries, width, height, key) {
    const canvas = this.canvas(`mask-${key}`, width, height); const context = canvas.getContext('2d', { willReadFrequently: true });
    context.setTransform(1, 0, 0, 1, 0, 0); context.clearRect(0, 0, width, height); context.fillStyle = '#fff';
    for (const { rect } of entries) {
      context.save(); context.translate(rect.center.x * width, (1 - rect.center.y) * height); context.rotate(-rect.rotation * Math.PI / 180);
      context.fillRect(-rect.width * width / 2, -rect.height * height / 2, rect.width * width, rect.height * height); context.restore();
    }
    const pixels = context.getImageData(0, 0, width, height).data; const result = new Uint8ClampedArray(width * height);
    for (let index = 0; index < result.length; index++) result[index] = pixels[index * 4 + 3];
    return result;
  }

  displaceMask(mask, width, height, seconds) {
    const result = new Uint8ClampedArray(mask.length); const direction = Math.SQRT1_2; const time = seconds / 20 * 2.59;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const u = (x + .5) / width; const v = (y + .5) / height;
      const d1 = this.sample('BlockNoise1', u * 2.13 + direction * time, v * 1.02 + direction * time) - .5;
      const d2 = this.sample('BlockNoise1', u * 2.13 + direction * time, v * 1.02 - direction * time) - .5;
      const sampleX = Math.round((u + direction * (d1 - d2) * .1) * width - .5);
      const sampleY = Math.round((v + direction * (d1 + d2) * .1) * height - .5);
      result[y * width + x] = sampleX >= 0 && sampleX < width && sampleY >= 0 && sampleY < height ? mask[sampleY * width + sampleX] : 0;
    }
    return result;
  }

  maskCanvas(name, mask, width, height, color = [255, 255, 255]) {
    const canvas = this.canvas(name, width, height); const context = canvas.getContext('2d'); const image = context.createImageData(width, height);
    for (let index = 0; index < mask.length; index++) {
      image.data[index * 4] = color[0]; image.data[index * 4 + 1] = color[1]; image.data[index * 4 + 2] = color[2]; image.data[index * 4 + 3] = mask[index];
    }
    context.putImageData(image, 0, 0); return canvas;
  }

  drawDisabled(context, mask, width, height, viewport, ratio, seconds, isReady) {
    const layer = this.canvas(`layer-${isReady ? 'ready' : 'disabled'}`, context.canvas.width, context.canvas.height); const layerContext = layer.getContext('2d');
    layerContext.setTransform(ratio, 0, 0, ratio, 0, 0); layerContext.clearRect(0, 0, layer.width / ratio, layer.height / ratio);
    layerContext.fillStyle = 'rgba(127,35,35,.40)'; layerContext.fillRect(viewport.left, viewport.top, viewport.width, viewport.height);
    this.drawSpark(layerContext, viewport, seconds, isReady ? .12 : .07);
    if (isReady) {
      const pulse = Math.sin(seconds * 37.9) * .5 + 1;
      layerContext.fillStyle = `rgba(255,255,255,${clamp(pulse * .12)})`; layerContext.fillRect(viewport.left, viewport.top, viewport.width, viewport.height);
    }
    layerContext.globalCompositeOperation = 'destination-in'; layerContext.imageSmoothingEnabled = false;
    layerContext.drawImage(this.maskCanvas(`mask-image-${isReady ? 'ready' : 'disabled'}`, mask, width, height), viewport.left, viewport.top, viewport.width, viewport.height);
    layerContext.globalCompositeOperation = 'source-over'; context.drawImage(layer, 0, 0, layer.width / ratio, layer.height / ratio);
  }

  drawActive(context, source, mask, width, height, viewport, ratio, seconds) {
    const layer = this.canvas('layer-active', context.canvas.width, context.canvas.height); const layerContext = layer.getContext('2d');
    layerContext.setTransform(ratio, 0, 0, ratio, 0, 0); layerContext.clearRect(0, 0, layer.width / ratio, layer.height / ratio);
    const strip = Math.max(2, 6 / ratio); const direction = Math.SQRT1_2; const time = seconds / 20 * 1.5;
    for (let y = viewport.top; y < viewport.top + viewport.height; y += strip) {
      const v = (y - viewport.top) / viewport.height; const a1 = this.sample('BlockNoise1', .4 + direction * time, v * .3 + direction * time) - .5;
      const a2 = this.sample('BlockNoise1', .4 + direction * time, v * .3 - direction * time) - .5;
      const dx = direction * (a1 - a2) * .15 * viewport.width; const dy = direction * (a1 + a2) * .15 * viewport.height;
      const sourceHeight = Math.max(1, strip * ratio); const sourceY = Math.max(0, Math.min(source.height - sourceHeight, (y + dy) * ratio));
      layerContext.drawImage(source, 0, sourceY, source.width, sourceHeight, dx, y, source.width / ratio, strip + .5);
    }
    layerContext.fillStyle = 'rgba(182,60,60,.41)'; layerContext.fillRect(viewport.left, viewport.top, viewport.width, viewport.height);
    this.drawSpark(layerContext, viewport, seconds, .24);
    layerContext.globalCompositeOperation = 'destination-in'; layerContext.imageSmoothingEnabled = false;
    layerContext.drawImage(this.maskCanvas('mask-image-active', mask, width, height), viewport.left, viewport.top, viewport.width, viewport.height);
    layerContext.globalCompositeOperation = 'source-over'; context.drawImage(layer, 0, 0, layer.width / ratio, layer.height / ratio);

    const edge = edgeMask(mask, width, height); const edgeCanvas = this.maskCanvas('mask-image-edge', edge, width, height, [255, 84, 84]);
    context.save(); context.imageSmoothingEnabled = false; context.globalAlpha = .8; context.drawImage(edgeCanvas, viewport.left, viewport.top, viewport.width, viewport.height);
    // The diffuse glow is separate from the one-pixel edge; there is no edge highlight.
    context.filter = `blur(${Math.max(1, 2 * ratio)}px)`; context.globalAlpha = .24; context.drawImage(edgeCanvas, viewport.left, viewport.top, viewport.width, viewport.height);
    context.filter = 'none'; context.restore();
  }

  drawSpark(context, viewport, seconds, alpha) {
    const image = this.textures.get('PointNoise')?.image; if (!image?.complete || !image.naturalWidth) return;
    const pattern = context.createPattern(image, 'repeat'); if (!pattern) return;
    context.save(); context.globalCompositeOperation = 'lighter'; context.globalAlpha = alpha * (.88 + .12 * Math.sin(seconds * 11)); context.fillStyle = pattern;
    context.translate(viewport.left, viewport.top); context.scale(1 / 3, 1 / 1.2); context.fillRect(0, 0, viewport.width * 3, viewport.height * 1.2); context.restore();
  }

  drawSelection(context, visible, viewport, ratio) {
    const entry = visible.find(value => value.index === this.selected); if (!entry) return; const rect = entry.rect;
    context.save(); context.translate(viewport.left + rect.center.x * viewport.width, viewport.top + (1 - rect.center.y) * viewport.height); context.rotate(-rect.rotation * Math.PI / 180);
    context.strokeStyle = '#ffd45c'; context.lineWidth = Math.max(1, ratio); context.strokeRect(-rect.width * viewport.width / 2 - 3, -rect.height * viewport.height / 2 - 3, rect.width * viewport.width + 6, rect.height * viewport.height + 6); context.restore();
  }
}

function hasMask(mask) { return mask.some(value => value > 0); }
function edgeMask(mask, width, height) {
  const result = new Uint8ClampedArray(mask.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const index = y * width + x; let maximum = mask[index];
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const nx = x + ox; const ny = y + oy; if (nx >= 0 && nx < width && ny >= 0 && ny < height) maximum = Math.max(maximum, mask[ny * width + nx]);
    }
    result[index] = Math.max(0, maximum - mask[index]);
  }
  return result;
}
