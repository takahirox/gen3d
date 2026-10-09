export function modelingMode(value = 'scratch', profile) {
  if (!['scratch', 'mpfb'].includes(value)) throw Object.assign(new Error('Modeling mode must be scratch or mpfb'), { status: 400 });
  if (value === 'mpfb' && profile !== 'character') throw Object.assign(new Error('MPFB-assisted modeling requires the Humanoid / character profile. Objects and props use scratch.'), { status: 400 });
  return value;
}
