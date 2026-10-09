import test from 'node:test';
import assert from 'node:assert/strict';
import { studioState } from '../web/studio-state.js';
const base = () => ({ mode: 'text', prompt: 'Robot', profile: 'object', checkpoints: { input: false }, inputReview: 'approved', concepts: [], referenceSets: [], versions: [], references: [] });
const concept = (extra = {}) => ({ id: 'c1', prompt: 'Robot', profile: 'object', status: 'ready', review: 'approved', ...extra });
const set = (extra = {}) => ({ id: 's1', conceptId: 'c1', status: 'ready', review: 'approved', consistency: { status: 'passed', outcome: 'allowed' }, ...extra });
test('automatic workflow leaves completed intermediate stages navigable', () => {
  const p = base(); p.concepts = [concept()]; p.referenceSets = [set()]; p.versions = [{ status: 'ready', review: 'approved' }];
  assert.deepEqual(studioState(p).states, { input: 'Completed', concept: 'Completed', views: 'Completed', model: 'Completed' });
  assert.equal(studioState(p).next.stage, 'model');
});
test('enabled or retained pending input and rejected input require a decision', () => {
  const p = base(); p.inputReview = 'pending'; p.inputCheckpoint = true;
  assert.equal(studioState(p).next.label, 'Review input');
  p.inputCheckpoint = false; p.inputReview = 'rejected';
  assert.equal(studioState(p).states.input, 'Warning');
  assert.equal(studioState(p).next.stage, 'input');
});
test('pending human reviews take priority over future stages and older ready models', () => {
  const p = base(); p.concepts = [concept({ review: 'pending' })]; p.versions = [{ status: 'ready', review: 'approved' }];
  assert.equal(studioState(p).next.id, 'c1');
  assert.equal(studioState(p).states.concept, 'Needs review');
  p.concepts[0].review = 'approved'; p.selectedConceptId = 'c1'; p.referenceSets = [set({ review: 'pending' })];
  assert.equal(studioState(p).next.id, 's1');
  p.referenceSets[0].review = 'approved'; p.versions.push({ id: 'v2', status: 'ready', review: 'pending', checkpoints: { preview: true } });
  assert.equal(studioState(p).next.id, 'v2');
});
test('running, failed, blocked, continued and skipped inspection remain distinguishable', () => {
  const p = base(); p.concepts = [concept({ status: 'running' })];
  assert.equal(studioState(p).states.concept, 'Running');
  p.concepts[0].status = 'failed'; assert.equal(studioState(p).next.label, 'Regenerate concept');
  p.concepts[0].status = 'ready'; p.selectedConceptId = 'c1';
  p.referenceSets = [set({ review: 'pending', consistency: { status: 'failed', outcome: 'blocked' } })];
  assert.equal(studioState(p).states.views, 'Failed');
  assert.equal(studioState(p).next.label, 'Inspect blocked views');
  p.referenceSets = [set({ warning: 'Continued', consistency: { status: 'failed', outcome: 'allowed' } })];
  assert.equal(studioState(p).states.views, 'Warning');
  p.referenceSets = [set({ consistency: { status: 'skipped', outcome: 'allowed' } })];
  assert.equal(studioState(p).states.views, 'Warning');
});
test('image projects start naturally at input and supplementary reviews remain visible', () => {
  const p = base(); p.mode = 'image'; assert.equal(studioState(p).next.start, true);
  p.references.push({ review: 'pending' }); assert.equal(studioState(p).next.label, 'Review references');
});
test('old prompt concepts do not block a new input and revision sets retain review', () => {
  const p = base(); p.concepts = [concept({ prompt: 'Previous', review: 'pending' })];
  assert.equal(studioState(p).next.start, true);
  p.concepts[0] = concept();
  p.versions = [{ id: 'v1', conceptId: 'c1', prompt: 'Robot', status: 'ready', review: 'approved' }];
  p.referenceSets = [];
  p.referenceSets = [set({ review: 'pending', prompt: 'Robot', profile: 'object', request: { kind: 'revision', sourceVersionId: 'v1' } })];
  assert.equal(studioState(p).next.id, 's1');
});

test('edited input starts a new candidate while retaining earlier artifacts', () => {
  const p = base(); p.inputReview = 'pending'; p.prompt = 'A new design'; p.concepts = [concept()]; p.referenceSets = [set()]; p.versions = [{ status: 'ready', review: 'approved' }];
  const state = studioState(p); assert.equal(state.next.start, true); assert.equal(state.states.concept, 'Future'); assert.equal(state.states.model, 'Warning');
});
test('rejected new concept takes priority over an earlier completed model', () => {
  const p = base(); p.concepts = [concept({ review: 'rejected' })]; p.versions = [{ status: 'ready', review: 'approved' }];
  assert.equal(studioState(p).next.label, 'Regenerate concept');
});
