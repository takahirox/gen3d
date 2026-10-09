// Read-only check in the exact Blender process running the gen3d bridge.
import { blenderCall } from '../src/blender.js';
import { mpfbCode, mpfbResult } from '../src/mpfb.js';
try {
  console.log(JSON.stringify(mpfbResult(await blenderCall('execute_code', { code: mpfbCode('status') })), null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
