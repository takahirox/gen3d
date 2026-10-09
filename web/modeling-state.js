export function modelingLabel(mode) { return mode === 'mpfb' ? 'MPFB-assisted' : 'Existing Blender'; }
export function matchingComparison(versions, selected) {
  if (!selected?.referenceFingerprint || selected.profile !== 'character') return null;
  return versions.findLast(v => v.id !== selected.id && v.status === 'ready' && v.profile === 'character'
    && v.referenceFingerprint === selected.referenceFingerprint && (v.feedback || '') === (selected.feedback || '')
    && (v.modelingMode || 'scratch') !== (selected.modelingMode || 'scratch')) || null;
}
