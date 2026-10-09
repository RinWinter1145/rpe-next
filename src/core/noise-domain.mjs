const clamp = value => Math.max(0, Math.min(1, value));
const point = (value, fallback) => ({
  x: Number.isFinite(value?.x) ? value.x : fallback.x,
  y: Number.isFinite(value?.y) ? value.y : fallback.y,
});

export const NOISE_EASING_NAMES = [
  '0 · 线性', '1 · 二次缓入', '2 · 二次缓出', '3 · 二次缓入缓出',
  '4 · 三次缓入', '5 · 三次缓出', '6 · 三次缓入缓出',
  '7 · 四次缓入', '8 · 四次缓出', '9 · 四次缓入缓出',
  '10 · 五次缓入', '11 · 五次缓出', '12 · 五次缓入缓出',
  '13 · 保持前值', '14 · 瞬变后值',
];

export function createNoiseArea(seconds = 0, duration = 2) {
  return {
    topRightPercentage: { x: 0.75, y: 0.25 },
    bottomLeftPercentage: { x: 0.25, y: 0.75 },
    appearTime: seconds,
    enableTime: seconds,
    disableTime: seconds + duration,
    disappearTime: seconds + duration,
    isSubtract: false,
    moveEvents: [], scaleEvents: [], rotateEvents: [],
  };
}

export function normalizeNoiseArea(source = {}) {
  const area = createNoiseArea();
  return {
    ...source,
    topRightPercentage: point(source.topRightPercentage, area.topRightPercentage),
    bottomLeftPercentage: point(source.bottomLeftPercentage, area.bottomLeftPercentage),
    appearTime: finite(source.appearTime, area.appearTime),
    enableTime: finite(source.enableTime, area.enableTime),
    disableTime: finite(source.disableTime, area.disableTime),
    disappearTime: finite(source.disappearTime, area.disappearTime),
    isSubtract: Boolean(source.isSubtract),
    moveEvents: normalizeEvents(source.moveEvents, event => ({ ...event,
      time: finite(event.time, 0), endPosition: point(event.endPosition, { x: 0.5, y: 0.5 }),
      easeTypeX: ease(event.easeTypeX), easeTypeY: ease(event.easeTypeY),
    })),
    scaleEvents: normalizeEvents(source.scaleEvents, event => ({ ...event,
      time: finite(event.time, 0), anchor: point(event.anchor, { x: 0.5, y: 0.5 }),
      scale: point(event.scale, { x: 1, y: 1 }), easeTypeX: ease(event.easeTypeX), easeTypeY: ease(event.easeTypeY),
    })),
    rotateEvents: normalizeEvents(source.rotateEvents, event => ({ ...event,
      time: finite(event.time, 0), anchor: point(event.anchor, { x: 0.5, y: 0.5 }),
      rotation: finite(event.rotation, 0), easeType: ease(event.easeType),
    })),
  };
}

function finite(value, fallback) { return Number.isFinite(Number(value)) ? Number(value) : fallback; }
function ease(value) { return Math.max(0, Math.min(14, Math.trunc(finite(value, 0)))); }
function normalizeEvents(events, transform) {
  if (!Array.isArray(events)) return [];
  return events.map((event, index) => ({ event: transform(event ?? {}), index }))
    .sort((left, right) => left.event.time - right.event.time || left.index - right.index).map(entry => entry.event);
}

export function assertNoiseAreas(chart) {
  if (chart.blockAreaList == null) return;
  if (!Array.isArray(chart.blockAreaList)) throw new Error('blockAreaList 必须为数组');
  for (const [index, raw] of chart.blockAreaList.entries()) {
    const path = `blockAreaList[${index}]`;
    if (!raw || typeof raw !== 'object') throw new Error(`${path}: 无效噪域`);
    for (const key of ['topRightPercentage', 'bottomLeftPercentage']) assertPoint(raw[key], `${path}.${key}`);
    for (const key of ['appearTime', 'enableTime', 'disableTime', 'disappearTime']) if (!Number.isFinite(raw[key])) throw new Error(`${path}.${key} 必须为有限秒数`);
    if (raw.appearTime > raw.disappearTime) throw new Error(`${path}: 出现时间不能晚于消失时间`);
    if (raw.enableTime < raw.appearTime || raw.enableTime > raw.disappearTime) throw new Error(`${path}: 生效时间必须位于可见区间内`);
    if (raw.disableTime < raw.enableTime || raw.disableTime > raw.disappearTime) throw new Error(`${path}: 失效时间必须位于生效和消失时间之间`);
    validateEvents(raw.moveEvents, `${path}.moveEvents`, event => assertPoint(event.endPosition, 'endPosition'), ['easeTypeX', 'easeTypeY']);
    validateEvents(raw.scaleEvents, `${path}.scaleEvents`, event => { assertPoint(event.anchor, 'anchor'); assertPoint(event.scale, 'scale'); }, ['easeTypeX', 'easeTypeY']);
    validateEvents(raw.rotateEvents, `${path}.rotateEvents`, event => { assertPoint(event.anchor, 'anchor'); if (!Number.isFinite(event.rotation)) throw new Error('rotation 必须为有限数字'); }, ['easeType']);
  }
}

function assertPoint(value, path) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new Error(`${path}: 必须包含有限的 x、y`);
}
function validateEvents(events, path, extra, easingKeys) {
  if (events == null) return;
  if (!Array.isArray(events)) throw new Error(`${path} 必须为数组`);
  for (const [index, event] of events.entries()) {
    try {
      if (!event || !Number.isFinite(event.time)) throw new Error('time 必须为有限秒数');
      extra(event);
      for (const key of easingKeys) if (!Number.isInteger(event[key]) || event[key] < 0 || event[key] > 14) throw new Error(`${key} 必须是 0–14 的整数`);
    } catch (error) { throw new Error(`${path}[${index}].${error.message}`); }
  }
}

export function noisePhases(area, seconds) {
  return {
    visible: area.appearTime <= seconds && seconds < area.disappearTime,
    active: area.enableTime <= seconds && seconds < area.disableTime,
    ready: seconds < area.enableTime && area.enableTime - seconds <= 0.5,
    visualOnly: area.enableTime >= area.disableTime,
  };
}

export function phigrosNoiseEase(progress, type = 0) {
  progress = clamp(progress);
  if (type === 13) return 0;
  if (type === 14) return 1;
  if (!Number.isInteger(type) || type <= 0 || type > 14) return progress;
  const group = Math.floor((type - 1) / 3);
  const kind = (type - 1) % 3;
  const power = group + 2;
  const sample = index => {
    const t = index / 100;
    if (kind === 0) return t ** power;
    if (kind === 1) return 1 - (1 - t) ** power;
    if (index < 50) return 0.5 * (Math.min(100, index * 2 + 8) / 100) ** power;
    if (index < 100) {
      const shifted = Math.min(100, index * 2 - 92) / 100;
      const inside = shifted ** power;
      return 0.5 + 0.5 * (1 - (1 - inside) ** power);
    }
    return 1;
  };
  const position = progress * 100;
  const index = Math.floor(position);
  return index >= 100 ? sample(100) : mix(sample(index), sample(index + 1), position - index);
}

function mix(from, to, progress) { return from + (to - from) * progress; }
function safeDivide(numerator, denominator) { return denominator === 0 ? 0 : numerator / denominator; }
function around(pointValue, anchor, x, y = x) { return { x: anchor.x + (pointValue.x - anchor.x) * x, y: anchor.y + (pointValue.y - anchor.y) * y }; }
function rotateAround(pointValue, anchor, degrees) {
  const radians = degrees * Math.PI / 180; const cosine = Math.cos(radians); const sine = Math.sin(radians);
  const x = pointValue.x - anchor.x; const y = pointValue.y - anchor.y;
  return { x: anchor.x + x * cosine - y * sine, y: anchor.y + x * sine + y * cosine };
}
function currentIndex(events, seconds) {
  let result = -1;
  for (let index = 0; index < events.length && events[index].time <= seconds; index++) result = index;
  return result;
}
function progress(current, following, type, seconds) {
  const raw = following.time === current.time ? 1 : (seconds - current.time) / (following.time - current.time);
  return phigrosNoiseEase(raw, type);
}

/** Evaluate the official transform chain: scale, then rotation, then absolute movement. */
export function noiseRectAt(source, seconds) {
  const area = normalizeNoiseArea(source);
  const base = {
    x: (area.topRightPercentage.x + area.bottomLeftPercentage.x) / 2,
    y: (area.topRightPercentage.y + area.bottomLeftPercentage.y) / 2,
  };
  let center = { ...base };
  let width = Math.abs(area.topRightPercentage.x - area.bottomLeftPercentage.x);
  let height = Math.abs(area.topRightPercentage.y - area.bottomLeftPercentage.y);
  let rotation = 0;

  const scaleIndex = currentIndex(area.scaleEvents, seconds);
  if (scaleIndex >= 0) {
    const current = area.scaleEvents[scaleIndex];
    for (let index = 1; index <= scaleIndex; index++) {
      const previous = area.scaleEvents[index - 1]; const next = area.scaleEvents[index];
      center = around(center, previous.anchor, safeDivide(next.scale.x, previous.scale.x), safeDivide(next.scale.y, previous.scale.y));
    }
    const following = area.scaleEvents[scaleIndex + 1];
    const evaluated = following ? {
      x: mix(current.scale.x, following.scale.x, progress(current, following, current.easeTypeX, seconds)),
      y: mix(current.scale.y, following.scale.y, progress(current, following, current.easeTypeY, seconds)),
    } : current.scale;
    center = around(center, current.anchor, safeDivide(evaluated.x, current.scale.x), safeDivide(evaluated.y, current.scale.y));
    width *= Math.abs(evaluated.x); height *= Math.abs(evaluated.y);
  }

  const rotateIndex = currentIndex(area.rotateEvents, seconds);
  if (rotateIndex >= 0) {
    const current = area.rotateEvents[rotateIndex];
    for (let index = 1; index <= rotateIndex; index++) {
      const previous = area.rotateEvents[index - 1]; const next = area.rotateEvents[index];
      center = rotateAround(center, previous.anchor, next.rotation - previous.rotation);
    }
    const following = area.rotateEvents[rotateIndex + 1];
    rotation = following ? mix(current.rotation, following.rotation, progress(current, following, current.easeType, seconds)) : current.rotation;
    center = rotateAround(center, current.anchor, rotation - current.rotation);
  }

  const moveIndex = currentIndex(area.moveEvents, seconds);
  if (moveIndex >= 0) {
    const current = area.moveEvents[moveIndex]; const following = area.moveEvents[moveIndex + 1];
    const target = following ? {
      x: mix(current.endPosition.x, following.endPosition.x, progress(current, following, current.easeTypeX, seconds)),
      y: mix(current.endPosition.y, following.endPosition.y, progress(current, following, current.easeTypeY, seconds)),
    } : current.endPosition;
    center = { x: center.x + target.x - base.x, y: center.y + target.y - base.y };
  }
  return { center, width, height, rotation };
}

/** Convert a desired rendered centre into the absolute target stored by moveEvents. */
export function noiseMoveTargetForCenter(source, seconds, desiredCenter) {
  const area = normalizeNoiseArea(source);
  const base = { x: (area.topRightPercentage.x + area.bottomLeftPercentage.x) / 2, y: (area.topRightPercentage.y + area.bottomLeftPercentage.y) / 2 };
  const transformed = noiseRectAt({ ...area, moveEvents: [] }, seconds).center;
  return { x: base.x + desiredCenter.x - transformed.x, y: base.y + desiredCenter.y - transformed.y };
}

/** Translate an entire noise-domain animation without changing its relative motion. */
export function translateNoiseArea(source, delta) {
  const area = normalizeNoiseArea(source);
  for (const key of ['topRightPercentage', 'bottomLeftPercentage']) {
    area[key].x += delta.x; area[key].y += delta.y;
  }
  for (const event of area.moveEvents) {
    event.endPosition.x += delta.x; event.endPosition.y += delta.y;
  }
  for (const key of ['scaleEvents', 'rotateEvents']) for (const event of area[key]) {
    event.anchor.x += delta.x; event.anchor.y += delta.y;
  }
  return area;
}

export function noiseContains(rect, pointValue) {
  const local = rotateAround(pointValue, rect.center, -rect.rotation);
  return rect.width > 0 && rect.height > 0 && Math.abs(local.x - rect.center.x) <= rect.width / 2 && Math.abs(local.y - rect.center.y) <= rect.height / 2;
}
