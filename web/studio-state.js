// Presentation only: all workflow and review decisions remain server-owned.
export const stageNames = { input: 'Input', concept: 'Base concept', views: 'Multi-view', model: '3D model' };
export function currentConcept(p, c) { return c.prompt === p.prompt && c.profile === p.profile; }
export function consistencyAllowsModeling(set) {
  return set.consistency.status === 'passed'
    || (set.consistency.status === 'failed' && set.consistencySettings?.enabled && set.consistencySettings.onFailure === 'continue')
    || (set.consistency.status === 'skipped' && set.consistencySettings?.enabled === false);
}
export function studioState(p) {
  const concept = p.concepts.at(-1), views = p.referenceSets.at(-1), model = p.versions.at(-1);
  const pendingInput = ((p.checkpoints.input || p.inputCheckpoint) && p.inputReview !== 'approved') || p.inputReview === 'rejected';
  const pendingConcept = p.concepts.find(c => currentConcept(p, c) && c.status === 'ready' && c.review === 'pending');
  const pendingViews = p.referenceSets.find(s => s.conceptId === p.selectedConceptId && s.status === 'ready' && s.review === 'pending');
  const pendingModel = p.versions.find(v => v.status === 'ready' && v.checkpoints?.preview && v.review === 'pending');
  const pendingReference = p.references.some(r => r.review === 'pending') || p.modelReferences?.some(r => r.review === 'pending');
  const running = [['concept', p.concepts], ['views', p.referenceSets], ['model', p.versions]].find(([, items]) => items.some(a => a.status === 'running'))?.[0];
  function artifactState(a) {
    if (!a) return 'Future';
    if (a.status === 'running') return 'Running';
    if (a.status === 'failed' || a.consistency?.outcome === 'blocked') return 'Failed';
    if (a.review === 'rejected' || a.warning || a.continuedDespiteInconsistency || a.consistency?.status === 'skipped') return 'Warning';
    return a.status === 'ready' ? 'Completed' : 'Future';
  }
  const states = { input: pendingInput ? p.inputReview === 'rejected' ? 'Warning' : 'Needs review' : 'Completed', concept: artifactState(concept), views: artifactState(views), model: artifactState(model) };
  if (pendingConcept) states.concept = 'Needs review';
  if (pendingViews) states.views = pendingViews.consistency?.outcome === 'blocked' ? 'Failed' : 'Needs review';
  if (pendingModel) states.model = 'Needs review';
  const freshInput = p.inputReview === 'pending' && !pendingInput;
  if (freshInput && !running && !pendingConcept && !pendingViews && !pendingModel) {
    states.concept = 'Future'; states.views = 'Future';
    if (model) states.model = 'Warning';
  }
  let next;
  if (running) next = { stage: running, label: 'View progress', message: `${stageNames[running]} is running. Artifacts appear here as they become available.` };
  else if (pendingInput) next = { stage: 'input', label: 'Review input', message: 'Accept or edit the input before continuing.' };
  else if (pendingConcept) next = { stage: 'concept', id: pendingConcept.id, label: 'Review concept', message: 'Choose whether to accept, reject or regenerate the concept.' };
  else if (pendingViews) next = { stage: 'views', id: pendingViews.id, label: states.views === 'Failed' ? 'Inspect blocked views' : 'Review views', message: states.views === 'Failed' ? 'Consistency blocked this set. Inspect the report and regenerate the views.' : 'Compare the views, then explicitly accept, reject or regenerate the set.' };
  else if (pendingModel) next = { stage: 'model', id: pendingModel.id, label: 'Review model', message: 'Inspect the model and render. Approve the preview to unlock export.' };
  else if (pendingReference) next = { stage: 'input', label: 'Review references', message: 'Review the pending supplementary images and 3D model permissions before modeling.' };
  else {
    const failure = ['concept', 'views', 'model'].find(key => states[key] === 'Failed');
    if (freshInput) next = { stage: 'input', label: 'Start workflow', message: 'Your input is ready. Start a new candidate; earlier artifacts remain available.', start: true };
    else if (failure) next = { stage: failure, label: failure === 'model' ? 'Retry model' : `Regenerate ${failure === 'concept' ? 'concept' : 'views'}`, message: 'The latest attempt failed. Its error and saved artifacts are available below.' };
    else if (concept?.review === 'rejected' && currentConcept(p, concept)) next = { stage: 'concept', label: 'Regenerate concept', message: 'Concept rejected. Regenerate it or explicitly accept a candidate.' };
    else if (views?.review === 'rejected') next = { stage: 'views', label: 'Regenerate views', message: 'View set rejected. Regenerate it or explicitly accept an eligible set.' };
    else if (model?.status === 'ready') next = { stage: 'model', label: 'Explore model', message: model.review === 'rejected' ? 'Model rejected. Request a revision or retry from input.' : 'Explore, revise or export your model. Earlier stages remain available.' };
    else next = { stage: 'input', label: 'Start workflow', message: 'Your input is ready. Start creating your first candidate.', start: true };
  }
  return { states, next, running, pendingInput, pendingConcept, pendingViews, pendingModel, pendingReference };
}
