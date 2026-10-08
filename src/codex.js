import { spawn } from 'node:child_process';

export function subscriptionEnv(env = process.env) {
  const result = { ...env };
  delete result.OPENAI_API_KEY; delete result.CODEX_API_KEY;
  return result;
}

export function runProcess(command, args, { cwd, env, onLine = () => {}, timeout = 20 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = ''; const partial = { stdout: '', stderr: '' }; let timedOut = false; let usageLimited = false;
    const limitPattern = /usage.limit|limit.reached|out of credits|quota.exceeded|insufficient.quota|rate_limit_exceeded/i;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeout);
    let forceTimer = setTimeout(() => child.kill('SIGKILL'), timeout + 5000);
    function processLine(line, stream, terminate = true) {
      let limitEvent = false;
      try {
        const event = JSON.parse(line);
        const failedTool = event.type === 'item.completed' && (event.item?.status === 'failed'
          || (typeof event.item?.exit_code === 'number' && event.item.exit_code !== 0) || event.item?.isError === true);
        limitEvent = (['error', 'turn.failed'].includes(event.type) || failedTool) && limitPattern.test(JSON.stringify(event));
      } catch {
        // JSON events are on stdout; stderr also carries plain CLI failures.
        limitEvent = stream === 'stderr' && limitPattern.test(line) && /error|you.ve hit|insufficient|rate_limit|quota/i.test(line);
      }
      if (limitEvent) {
        usageLimited = true;
        if (terminate) {
          child.kill('SIGTERM'); clearTimeout(forceTimer);
          forceTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
        }
      }
      onLine(line);
    }
    function receive(chunk, stream) {
      const data = chunk.toString(); tail = (tail + data).slice(-4000);
      partial[stream] += data;
      const lines = partial[stream].split('\n'); partial[stream] = lines.pop().slice(-100000);
      for (const line of lines) processLine(line, stream);
    }
    child.stdout.on('data', chunk => receive(chunk, 'stdout')); child.stderr.on('data', chunk => receive(chunk, 'stderr'));
    child.on('error', e => { clearTimeout(timer); clearTimeout(forceTimer); reject(new Error(`Cannot start ${command}: ${e.message}`)); });
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(forceTimer);
      for (const stream of ['stdout', 'stderr']) if (partial[stream]) processLine(partial[stream], stream, false);
      if (usageLimited || (code !== 0 && limitPattern.test(tail))) {
        const error = new Error('Codex usage limit reached. Generation stopped; no automatic retry, reset, purchase or provider change will be attempted.');
        error.usageLimited = true; reject(error);
      } else if (timedOut) reject(new Error('Codex timed out. Retry manually after inspecting Blender.'));
      else if (code !== 0) {
        const error = new Error(
          'Codex could not complete generation. Check Codex authentication, CLI compatibility and Blender connectivity, then retry manually.');
        reject(error);
      } else resolve(tail);
    });
  });
}
