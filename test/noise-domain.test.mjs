import test from 'node:test';
import assert from 'node:assert/strict';
import { createChart, parseChart, serializeChart } from '../src/core/chart.mjs';
import { createNoiseArea, noiseMoveTargetForCenter, noisePhases, noiseRectAt, phigrosNoiseEase, resizeNoiseAreaFromCorner, translateNoiseArea } from '../src/core/noise-domain.mjs';
import { parseOfficialChart } from '../src/core/official-chart.mjs';

test('噪域官方字段在 RPE JSON 中原样往返', () => {
  const chart = createChart(); const area = createNoiseArea(1, 3);
  area.isSubtract = true;
  area.moveEvents.push({ time: 1, endPosition: { x: 0.8, y: 0.2 }, easeTypeX: 0, easeTypeY: 14 });
  area.scaleEvents.push({ time: 1, anchor: { x: 0.5, y: 0.5 }, scale: { x: 2, y: 0.1 }, easeTypeX: 13, easeTypeY: 0 });
  area.rotateEvents.push({ time: 1, anchor: { x: 0.5, y: 0.5 }, rotation: -45, easeType: 0 });
  chart.blockAreaList.push(area);
  assert.deepEqual(parseChart(serializeChart(chart)).blockAreaList, [area]);
});

test('官方谱面导入会保留 blockAreaList', () => {
  const area = createNoiseArea();
  const chart = parseOfficialChart({ formatVersion: 3, offset: 0, blockAreaList: [area], judgeLineList: [{ bpm: 120, notesAbove: [], notesBelow: [], speedEvents: [], judgeLineMoveEvents: [], judgeLineRotateEvents: [], judgeLineDisappearEvents: [] }] });
  assert.deepEqual(chart.blockAreaList, [area]);
});

test('噪域按官方 scale rotate move 顺序求值且无半拍偏移', () => {
  const area = createNoiseArea(0, 4);
  area.moveEvents = [
    { time: 0, endPosition: { x: 1.2, y: 1.2 }, easeTypeX: 0, easeTypeY: 0 },
    { time: 2, endPosition: { x: -1.2, y: -1.2 }, easeTypeX: 0, easeTypeY: 0 },
  ];
  area.scaleEvents = [{ time: 0, anchor: { x: 0.5, y: 0.5 }, scale: { x: 2, y: 0.1 }, easeTypeX: 0, easeTypeY: 0 }];
  area.rotateEvents = [{ time: 0, anchor: { x: 0.5, y: 0.5 }, rotation: -45, easeType: 0 }];
  const start = noiseRectAt(area, 0); const middle = noiseRectAt(area, 1); const end = noiseRectAt(area, 2);
  assert.deepEqual(start.center, { x: 1.2, y: 1.2 });
  assert.ok(Math.abs(middle.center.x) < 1e-12 && Math.abs(middle.center.y) < 1e-12);
  assert.deepEqual(end.center, { x: -1.2, y: -1.2 });
  assert.equal(start.width, 1); assert.ok(Math.abs(start.height - 0.05) < 1e-12); assert.equal(start.rotation, -45);
});

test('假噪域可见但永不生效，13/14 是保持与瞬变', () => {
  const area = createNoiseArea(0, 2); area.disableTime = area.enableTime;
  assert.deepEqual(noisePhases(area, 0.25), { visible: true, active: false, ready: false, visualOnly: true });
  assert.equal(phigrosNoiseEase(0.5, 13), 0);
  assert.equal(phigrosNoiseEase(0.01, 14), 1);
});

test('带偏心缩放旋转时，画面拖动会换算成正确的官方移动目标', () => {
  const area = createNoiseArea(0, 4);
  area.scaleEvents = [{ time: 0, anchor: { x: 0, y: 0 }, scale: { x: 2, y: 1 }, easeTypeX: 0, easeTypeY: 0 }];
  const target = noiseMoveTargetForCenter(area, 0, { x: 0.8, y: 0.5 });
  area.moveEvents = [{ time: 0, endPosition: target, easeTypeX: 0, easeTypeY: 0 }];
  assert.deepEqual(noiseRectAt(area, 0).center, { x: 0.8, y: 0.5 });
});

test('全局拖动会同步平移关键帧和锚点并保持相对动画', () => {
  const area = createNoiseArea(0, 4);
  area.moveEvents = [{ time: 0, endPosition: { x: 0.8, y: 0.2 }, easeTypeX: 0, easeTypeY: 0 }];
  area.scaleEvents = [{ time: 0, anchor: { x: 0.1, y: 0.2 }, scale: { x: 2, y: 1 }, easeTypeX: 0, easeTypeY: 0 }];
  area.rotateEvents = [{ time: 0, anchor: { x: 0.3, y: 0.4 }, rotation: 30, easeType: 0 }];
  const before = noiseRectAt(area, 0); const moved = translateNoiseArea(area, { x: 0.1, y: -0.2 }); const after = noiseRectAt(moved, 0);
  assert.ok(Math.abs(after.center.x - before.center.x - 0.1) < 1e-12);
  assert.ok(Math.abs(after.center.y - before.center.y + 0.2) < 1e-12);
  assert.deepEqual(moved.scaleEvents[0].anchor, { x: 0.2, y: 0 });
  assert.deepEqual(moved.rotateEvents[0].anchor, { x: 0.4, y: 0.2 });
});

test('拖动单角缩放时固定对角而不是从中心对称缩放', () => {
  const area = createNoiseArea(0, 4);
  const moved = resizeNoiseAreaFromCorner(area, 0, 1, { x: 0.9, y: 0.1 });
  const rect = noiseRectAt(moved, 0);
  assert.ok(Math.abs(rect.center.x - 0.575) < 1e-12);
  assert.ok(Math.abs(rect.center.y - 0.425) < 1e-12);
  assert.ok(Math.abs(rect.width - 0.65) < 1e-12);
  assert.ok(Math.abs(rect.height - 0.65) < 1e-12);
  assert.ok(Math.abs(rect.center.x - rect.width / 2 - 0.25) < 1e-12);
  assert.ok(Math.abs(rect.center.y + rect.height / 2 - 0.75) < 1e-12);
});
