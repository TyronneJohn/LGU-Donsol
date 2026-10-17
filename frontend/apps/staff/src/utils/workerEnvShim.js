// Must be imported before OpenCV in beforeAfterMatching.worker.js. OpenCV.js
// (Emscripten) decides it runs in a worker by checking for importScripts(),
// which module workers don't have; without it, it falls back to "shell" mode
// and breaks. OpenCV's WebAssembly is inlined, so this stub is never called.
if (typeof self.importScripts !== 'function') {
  self.importScripts = () => {
    throw new Error('importScripts is not available in this worker.')
  }
}
