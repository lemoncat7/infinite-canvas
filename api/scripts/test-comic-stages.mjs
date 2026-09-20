import test from 'node:test';
import assert from 'node:assert/strict';
import { generateComicFoundation } from '../dist/comic/foundation-stage.js';
import { auditComicContinuity } from '../dist/comic/audit-stage.js';
import { normalizeComicResult } from '../dist/comic/result-normalizer.js';
import { ComicStreamState } from '../dist/comic/stream-state.js';

const log = { info() {}, warn() {} };
test('extracted foundation stage restores checkpoints without calling the upstream', async () => {
  const checkpoint = {
    fingerprint: 'test',
    story: { title: '旅程', outline: [{ act: '开场', content: '林夜进入大厅' }] },
    assets: { characters: [{ name: '林夜', imagePrompt: '青年旅人' }], props: [] },
    sceneBible: { scenes: [{ sceneId: 'hall', name: '大厅', imagePrompt: '宽敞的大厅' }] },
    shotPlan: { plannedShots: [] }, shots: [{ number: 1 }],
  };
  const events = [];
  const result = await generateComicFoundation({
    checkpoint, readStage: async () => { throw new Error('restored stages must not call upstream'); },
    content: '', saveCheckpoint: () => assert.fail('already restored'), emit: event => events.push(event),
    streamState: new ComicStreamState('test'), text: '', rewriteUntilValid: async (_stage, value) => value,
  });
  assert.equal(result.foundation.title, '旅程');
  assert.equal(result.outlineParts.length, 1);
  assert.deepEqual(result.allShots, checkpoint.shots);
  assert.notEqual(result.allShots, checkpoint.shots);
  assert.equal(events.filter(event => event.resumed).length, 3);
  assert.deepEqual(result.foundation.scenes[0].views.map(view => view.id), ['main', 'reverse', 'top']);
});
test('extracted audit stage only finishes when the audit actually accepts', async () => {
  const context = {
    allShots: [{ number: 1 }], shotBatchSize: 3, outlineParts: [], log, emit() {},
    streamState: new ComicStreamState('test'), saveCheckpoint() {}, shotPlan: {}, batchCount: 1,
  };
  await auditComicContinuity({ ...context, readStage: async () => ({ valid: true, issues: [] }) });
  await assert.rejects(() => auditComicContinuity({ ...context, readStage: async () => ({ valid: false, issues: ['冲突'], repairs: [] }) }), /未返回可执行修复/);
});
test('result normalization remains independent of HTTP and rejects missing shots', () => {
  const context = {
    foundation: { title: '草稿', characters: [], props: [], scenes: [], outline: [] },
    allShots: [{ number: 1, title: '开场', duration: 5, imagePrompt: '安静的大厅', videoPrompt: '镜头缓慢推进', dialogue: '无对白', frames: [{ title: '主画面', imagePrompt: '大厅全景' }] }],
    log, streamState: new ComicStreamState('test'), model: 'test', visualInputs: [], confirmedBriefTitle: '已确认标题', duration: '由对话内容推断', aspectRatio: '16:9',
  };
  const result = normalizeComicResult(context);
  assert.equal(result.title, '已确认标题');
  assert.equal(result.aspectRatio, '16:9');
  assert.equal(result.shots.length, 1);
  assert.ok(result.shots[0].frames.length);
  assert.throws(() => normalizeComicResult({ ...context, allShots: [] }), /missing shots/);
});
