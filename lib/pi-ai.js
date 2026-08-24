let cached;

/**
 * Lazy-load the Pi-provided peer. The CLI never needs this package.
 * @returns {Promise<typeof import('@earendil-works/pi-ai')>}
 */
export async function loadPiAi() {
  if (!cached) {
    try {
      cached = await import('@earendil-works/pi-ai');
    } catch (error) {
      if (error?.code === 'ERR_MODULE_NOT_FOUND') {
        const err = new Error(
          'The Pi Fusion extension requires @earendil-works/pi-ai (peer dependency). Install Pi, or run: npm install @earendil-works/pi-ai'
        );
        err.cause = error;
        throw err;
      }
      throw error;
    }
  }
  return cached;
}
