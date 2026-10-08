import net from 'node:net';

export function blenderCall(type, params = {}, { port = Number(process.env.GEN3D_BLENDER_PORT || 9877), timeout = 180000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let data = ''; let done = false;
    function finish(error, result) {
      if (done) return; done = true; socket.destroy();
      if (error) reject(error); else resolve(result);
    }
    socket.setTimeout(timeout, () => finish(new Error('Blender request timed out')));
    socket.on('connect', () => socket.write(JSON.stringify({ type, params }) + '\n'));
    socket.on('error', e => finish(new Error(`Blender bridge unavailable: ${e.message}. Start the supplied Blender bridge.`)));
    socket.on('data', chunk => {
      data += chunk.toString();
      if (data.length > 4_000_000) return finish(new Error('Blender response too large'));
      if (!data.includes('\n')) return;
      try {
        const result = JSON.parse(data.split('\n')[0]);
        if (result.status !== 'success') finish(new Error(result.message || 'Blender execution failed'));
        else finish(null, result.result);
      } catch (e) { finish(e); }
    });
    socket.on('end', () => { if (!done) finish(new Error('Blender closed the connection without a response')); });
  });
}
