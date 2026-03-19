/**
 * crypto-worker.js — Offloads PBKDF2 hashing to a Web Worker
 * so the main thread stays responsive during password verification.
 *
 * Messages: { password: string, saltHex: string, iterations: number }
 * Returns:  { hash: string } or { error: string }
 */
self.addEventListener('message', async (e) => {
  try {
    const { password, saltHex, iterations } = e.data;
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const saltBytes = new Uint8Array(saltHex.match(/.{2}/g).map(h => parseInt(h, 16)));
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
      keyMaterial, 256
    );
    const hashHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
    self.postMessage({ hash: 'pbkdf2:' + saltHex + ':' + hashHex });
  } catch (err) {
    self.postMessage({ error: err.message });
  }
});
