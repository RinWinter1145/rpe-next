import { formatBeat, parseBeat } from '../core/beat.mjs';
import { NOISE_EASING_NAMES, createNoiseArea, noiseContains, noisePhases, noiseRectAt, normalizeNoiseArea } from '../core/noise-domain.mjs';

const close = (left, right) => Math.abs(left - right) < 1e-7;
const number = (value, name) => { const result = Number(value); if (!Number.isFinite(result)) throw new Error(`${name} 必须为有限数字`); return result; };

export class NoiseDomainPanel {
  constructor(host, context, options = {}) {
    this.host = host; this.context = context; this.options = options; this.selected = 0; this.autoKey = false; this.drag = null;
  }

  get state() { return this.context(); }
  get areas() { return this.state.session.chart.blockAreaList ?? []; }
  get area() { return this.areas[this.selected]; }
  commit(label, transform) {
    try {
      const { session } = this.state; const list = structuredClone(session.chart.blockAreaList ?? []);
      const next = transform(list) ?? list;
      session.commit(label, { ...session.chart, blockAreaList: next });
      this.selected = Math.max(0, Math.min(this.selected, next.length - 1));
      this.syncSelection(); this.options.invalidate?.();
    } catch (error) { this.options.reportError?.(error); }
  }
  syncSelection() {
    const value = this.areas.length ? this.selected : -1;
    this.state.preview.noiseSelection = value; this.state.realtimePreview.noiseSelection = value;
  }

  render() {
    this.host.replaceChildren(); this.syncSelection();
    const heading = document.createElement('div'); heading.className = 'noise-panel-heading';
    const select = document.createElement('select'); select.setAttribute('aria-label', '选择噪域');
    for (const [index, area] of this.areas.entries()) select.append(new Option(`#${index + 1} · ${area.isSubtract ? '扣除' : noisePhases(area, area.enableTime).visualOnly ? '假红区' : '阻断'}`, index));
    select.value = String(this.selected); select.onchange = () => { this.selected = Number(select.value); this.render(); this.options.invalidate?.(); };
    const add = button('新建', () => { const seconds = Math.max(0, this.state.seconds()); this.commit('新建噪域', list => [...list, createNoiseArea(seconds, 2)]); this.selected = this.areas.length - 1; this.render(); });
    heading.append(select, add); this.host.append(heading);
    if (!this.area) { const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = '还没有噪域。新建后可编辑可见/生效区间、矩形与三类官方关键帧。'; this.host.append(hint); return; }

    const canvas = document.createElement('canvas'); canvas.className = 'noise-geometry-canvas'; canvas.tabIndex = 0; this.host.append(canvas);
    this.bindCanvas(canvas); requestAnimationFrame(() => this.drawCanvas(canvas));
    const canvasHint = document.createElement('p'); canvasHint.className = 'hint'; canvasHint.textContent = 'Shift+拖动移动；Ctrl+拖动调整基础大小；Alt+拖动会显式写入当前拍旋转关键帧。自动关键帧默认关闭。'; this.host.append(canvasHint);

    const actions = document.createElement('div'); actions.className = 'noise-actions';
    actions.append(button('绘制矩形', () => { this.drawMode = !this.drawMode; this.render(); }), button('复制', () => { const copy = structuredClone(this.area); this.commit('复制噪域', list => [...list.slice(0, this.selected + 1), copy, ...list.slice(this.selected + 1)]); this.selected++; this.render(); }),
      button('删除', () => { this.commit('删除噪域', list => list.filter((unused, index) => index !== this.selected)); this.render(); }));
    if (this.drawMode) actions.firstElementChild.classList.add('active');
    const autoKey = document.createElement('label'); const autoInput = document.createElement('input'); autoInput.type = 'checkbox'; autoInput.checked = this.autoKey; autoInput.onchange = () => { this.autoKey = autoInput.checked; }; autoKey.append(autoInput, '自动关键帧'); actions.append(autoKey); this.host.append(actions);

    const phase = section('时间与类型');
    const fake = document.createElement('input'); fake.type = 'checkbox'; fake.checked = close(this.area.enableTime, this.area.disableTime);
    fake.onchange = () => this.edit('切换假红区', area => { area.disableTime = fake.checked ? area.enableTime : Math.max(area.enableTime + 0.001, area.disappearTime); if (area.disappearTime < area.disableTime) area.disappearTime = area.disableTime; });
    phase.append(field('假红区（仅视觉，不断触）', fake));
    const subtract = document.createElement('input'); subtract.type = 'checkbox'; subtract.checked = this.area.isSubtract; subtract.onchange = () => this.edit('修改噪域类型', area => { area.isSubtract = subtract.checked; });
    phase.append(field('扣除型噪域', subtract));
    for (const [key, title] of [['appearTime', '出现拍'], ['enableTime', '生效拍'], ['disableTime', '失效拍'], ['disappearTime', '消失拍']]) phase.append(this.beatField(title, this.area[key], value => this.edit(`修改${title}`, area => { area[key] = value; })));
    this.host.append(phase);

    const geometry = section('基础矩形（官方百分比坐标）');
    const presets = document.createElement('div'); presets.className = 'noise-actions';
    for (const [title, corners] of [['全屏', [0, 0, 1, 1]], ['左半', [0, 0, .5, 1]], ['右半', [.5, 0, 1, 1]], ['上半', [0, 0, 1, .5]], ['下半', [0, .5, 1, 1]]]) presets.append(button(title, () => this.edit('应用噪域预设', area => setBounds(area, ...corners))));
    geometry.append(presets);
    for (const [objectKey, title] of [['topRightPercentage', '右上'], ['bottomLeftPercentage', '左下']]) for (const axis of ['x', 'y']) geometry.append(this.numberField(`${title} ${axis.toUpperCase()}`, this.area[objectKey][axis], value => this.edit('修改噪域矩形', area => { area[objectKey][axis] = value; }), 0.01));
    this.host.append(geometry);

    this.host.append(this.eventSection('移动事件', 'moveEvents'), this.eventSection('缩放事件', 'scaleEvents'), this.eventSection('旋转事件', 'rotateEvents'));
    const back = button('返回谱面工具', () => this.options.close?.()); back.className = 'wide-button'; this.host.append(back);
  }

  edit(label, transform) { this.commit(label, list => { const area = normalizeNoiseArea(list[this.selected]); transform(area); list[this.selected] = area; return list; }); this.render(); }
  beatField(title, seconds, apply) {
    const input = document.createElement('input'); input.value = formatBeatFromSeconds(this.state.tempo, seconds);
    input.onchange = () => { try { apply(this.state.tempo.seconds(parseBeat(input.value))); } catch (error) { this.options.reportError?.(error); } };
    return field(title, input);
  }
  numberField(title, value, apply, step = 0.1) {
    const input = document.createElement('input'); input.type = 'number'; input.step = String(step); input.value = String(value);
    input.onchange = () => { try { apply(number(input.value, title)); } catch (error) { this.options.reportError?.(error); } };
    return field(title, input);
  }

  eventSection(title, key) {
    const root = document.createElement('details'); root.className = 'noise-event-section'; root.open = this.openSection === key;
    root.ontoggle = () => { if (root.open) this.openSection = key; };
    const summary = document.createElement('summary'); summary.textContent = `${title}（${this.area[key].length}）`; root.append(summary);
    for (const [index, event] of this.area[key].entries()) {
      const card = document.createElement('div'); card.className = 'noise-event-card';
      card.append(this.beatField('拍', event.time, value => this.edit(`修改${title}`, area => { area[key][index].time = value; sortStable(area[key]); })));
      if (key === 'moveEvents') {
        card.append(this.numberField('目标 X', event.endPosition.x, value => this.eventValue(key, index, item => { item.endPosition.x = value; }), .01), this.numberField('目标 Y', event.endPosition.y, value => this.eventValue(key, index, item => { item.endPosition.y = value; }), .01));
        card.append(this.easeField('X 缓动', event.easeTypeX, value => this.eventValue(key, index, item => { item.easeTypeX = value; })), this.easeField('Y 缓动', event.easeTypeY, value => this.eventValue(key, index, item => { item.easeTypeY = value; })));
      } else if (key === 'scaleEvents') {
        for (const [objectKey, label] of [['anchor', '锚点'], ['scale', '缩放']]) for (const axis of ['x', 'y']) card.append(this.numberField(`${label} ${axis.toUpperCase()}`, event[objectKey][axis], value => this.eventValue(key, index, item => { item[objectKey][axis] = value; }), .01));
        card.append(this.easeField('X 缓动', event.easeTypeX, value => this.eventValue(key, index, item => { item.easeTypeX = value; })), this.easeField('Y 缓动', event.easeTypeY, value => this.eventValue(key, index, item => { item.easeTypeY = value; })));
      } else {
        for (const axis of ['x', 'y']) card.append(this.numberField(`锚点 ${axis.toUpperCase()}`, event.anchor[axis], value => this.eventValue(key, index, item => { item.anchor[axis] = value; }), .01));
        card.append(this.numberField('旋转角度', event.rotation, value => this.eventValue(key, index, item => { item.rotation = value; }), 1), this.easeField('缓动', event.easeType, value => this.eventValue(key, index, item => { item.easeType = value; })));
      }
      card.append(button('删除关键帧', () => this.edit(`删除${title}`, area => { area[key].splice(index, 1); }))); root.append(card);
    }
    root.append(button(`在当前拍添加${title.replace('事件', '关键帧')}`, () => {
      const seconds = this.state.seconds(); const rect = noiseRectAt(this.area, seconds);
      const event = key === 'moveEvents' ? { time: seconds, endPosition: { ...rect.center }, easeTypeX: 0, easeTypeY: 0 }
        : key === 'scaleEvents' ? { time: seconds, anchor: { ...rect.center }, scale: { x: 1, y: 1 }, easeTypeX: 0, easeTypeY: 0 }
          : { time: seconds, anchor: { ...rect.center }, rotation: rect.rotation, easeType: 0 };
      this.edit(`添加${title}`, area => { area[key].push(event); sortStable(area[key]); }); this.openSection = key;
    }));
    return root;
  }
  eventValue(key, index, transform) { this.edit('修改噪域关键帧', area => transform(area[key][index])); }
  easeField(title, value, apply) {
    const select = document.createElement('select'); NOISE_EASING_NAMES.forEach((name, index) => select.append(new Option(name, index))); select.value = String(value); select.onchange = () => apply(Number(select.value)); return field(title, select);
  }

  bindCanvas(canvas) {
    const position = event => { const bounds = canvas.getBoundingClientRect(); return { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height }; };
    canvas.onpointerdown = event => {
      const start = position(event);
      if (this.drawMode) { this.drag = { start, current: start, original: structuredClone(this.area), mode: 'draw' }; canvas.setPointerCapture(event.pointerId); event.preventDefault(); return; }
      const rect = noiseRectAt(this.area, this.state.seconds());
      if (!noiseContains(rect, start)) return;
      this.drag = { start, original: structuredClone(this.area), mode: event.altKey ? 'rotate' : event.ctrlKey ? 'scale' : event.shiftKey ? 'move' : 'select' }; canvas.setPointerCapture(event.pointerId); event.preventDefault();
    };
    canvas.onpointermove = event => {
      if (!this.drag || !['move', 'scale', 'rotate', 'draw'].includes(this.drag.mode)) return;
      this.drag.current = position(event); this.drawCanvas(canvas); event.preventDefault();
    };
    canvas.onpointerup = event => {
      if (['move', 'scale', 'rotate', 'draw'].includes(this.drag?.mode) && this.drag.current) {
        const moved = this.draggedArea();
        this.commit(this.drag.mode === 'move' ? '移动噪域' : this.drag.mode === 'scale' ? '缩放噪域' : this.drag.mode === 'rotate' ? '旋转噪域' : '绘制噪域', list => { list[this.selected] = moved; return list; });
      }
      if (this.drag?.mode === 'draw') this.drawMode = false;
      this.drag = null; this.render(); event.preventDefault();
    };
    canvas.onpointercancel = () => { this.drag = null; this.render(); };
  }
  draggedArea() {
    const area = normalizeNoiseArea(this.drag?.original ?? this.area); if (!this.drag?.current) return area;
    const dx = this.drag.current.x - this.drag.start.x; const dy = this.drag.current.y - this.drag.start.y; const seconds = this.state.seconds();
    if (this.drag.mode === 'draw') { setBounds(area, Math.min(this.drag.start.x, this.drag.current.x), Math.min(this.drag.start.y, this.drag.current.y), Math.max(this.drag.start.x, this.drag.current.x), Math.max(this.drag.start.y, this.drag.current.y)); return area; }
    if (this.drag.mode === 'scale') {
      area.topRightPercentage.x += dx; area.topRightPercentage.y -= dy;
      area.bottomLeftPercentage.x -= dx; area.bottomLeftPercentage.y += dy;
      return area;
    }
    if (this.drag.mode === 'rotate') {
      const rect = noiseRectAt(area, seconds); const angle = point => Math.atan2(point.y - rect.center.y, point.x - rect.center.x) * 180 / Math.PI;
      const delta = angle(this.drag.current) - angle(this.drag.start);
      const exact = [...area.rotateEvents.keys()].reverse().find(index => close(area.rotateEvents[index].time, seconds));
      if (exact !== undefined) area.rotateEvents[exact].rotation += delta;
      else { area.rotateEvents.push({ time: seconds, anchor: { ...rect.center }, rotation: rect.rotation + delta, easeType: 0 }); sortStable(area.rotateEvents); }
      return area;
    }
    const exact = [...area.moveEvents.keys()].reverse().find(index => close(area.moveEvents[index].time, seconds));
    if (exact !== undefined) { area.moveEvents[exact].endPosition.x += dx; area.moveEvents[exact].endPosition.y += dy; }
    else if (this.autoKey) { const rect = noiseRectAt(area, seconds); area.moveEvents.push({ time: seconds, endPosition: { x: rect.center.x + dx, y: rect.center.y + dy }, easeTypeX: 0, easeTypeY: 0 }); sortStable(area.moveEvents); }
    else for (const key of ['topRightPercentage', 'bottomLeftPercentage']) { area[key].x += dx; area[key].y += dy; }
    return area;
  }
  drawCanvas(canvas) {
    if (!canvas.isConnected || !this.area) return;
    const bounds = canvas.getBoundingClientRect(); const ratio = globalThis.devicePixelRatio || 1; canvas.width = Math.max(1, Math.round(bounds.width * ratio)); canvas.height = Math.max(1, Math.round(bounds.width * 9 / 16 * ratio));
    const context = canvas.getContext('2d'); context.setTransform(ratio, 0, 0, ratio, 0, 0); const width = bounds.width; const height = width * 9 / 16;
    context.fillStyle = '#11151b'; context.fillRect(0, 0, width, height); context.strokeStyle = '#29313c'; context.lineWidth = 1;
    for (let index = 1; index < 4; index++) { context.beginPath(); context.moveTo(width * index / 4, 0); context.lineTo(width * index / 4, height); context.stroke(); }
    for (let index = 1; index < 4; index++) { context.beginPath(); context.moveTo(0, height * index / 4); context.lineTo(width, height * index / 4); context.stroke(); }
    const displayArea = ['move', 'scale', 'rotate', 'draw'].includes(this.drag?.mode) && this.drag.current ? this.draggedArea() : this.area;
    const rect = noiseRectAt(displayArea, this.state.seconds()); const phase = noisePhases(displayArea, this.state.seconds());
    context.save(); context.translate(rect.center.x * width, rect.center.y * height); context.rotate(rect.rotation * Math.PI / 180);
    context.fillStyle = phase.active ? 'rgba(185,25,38,.42)' : 'rgba(210,100,108,.22)'; context.strokeStyle = '#ef4b57'; context.lineWidth = 1.5; context.setLineDash([4, 2]);
    context.fillRect(-rect.width * width / 2, -rect.height * height / 2, rect.width * width, rect.height * height); context.strokeRect(-rect.width * width / 2, -rect.height * height / 2, rect.width * width, rect.height * height); context.restore();
    context.fillStyle = '#f7c95c'; context.beginPath(); context.arc(rect.center.x * width, rect.center.y * height, 3, 0, Math.PI * 2); context.fill();
  }
}

function button(title, onclick) { const result = document.createElement('button'); result.type = 'button'; result.textContent = title; result.onclick = onclick; return result; }
function field(title, control) { const label = document.createElement('label'); label.className = 'field'; label.append(title, control); control.setAttribute('aria-label', title); return label; }
function section(title) { const root = document.createElement('section'); root.className = 'noise-section'; const heading = document.createElement('h3'); heading.textContent = title; root.append(heading); return root; }
function setBounds(area, left, top, right, bottom) { area.topRightPercentage = { x: right, y: top }; area.bottomLeftPercentage = { x: left, y: bottom }; }
function sortStable(events) { events.forEach((event, index) => { event.__sortIndex = index; }); events.sort((left, right) => left.time - right.time || left.__sortIndex - right.__sortIndex); events.forEach(event => { delete event.__sortIndex; }); }
function formatBeatFromSeconds(tempo, seconds) { return formatBeat(parseBeat(tempo.beat(seconds))); }
