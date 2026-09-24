const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_RESPONSE_BYTES = 128 * 1024;
const MODELS = new Set(['qwen2.5:3b', 'qwen3.5:4b']);
const HEALTH = new Map([
  ['ready', 'Sunny is ready for local conversation.'],
  ['model-unavailable', 'Sunny needs a supported local model.'],
  ['ollama-unavailable', 'Sunny local inference is unavailable.'],
  ['local-only-unconfirmed', 'Sunny cannot chat until local-only inference is confirmed.'],
  ['stopped', 'Sunny is paused. Use the trusted launcher to manage local controls.'],
]);
const PUBLIC_ERRORS = new Map([
  [400, ['unavailable', 'Send a short message and a bounded conversation history.']],
  [401, ['denied', 'Sunny local access is unavailable. Use the trusted launcher.']],
  [403, ['denied', 'Sunny local access is unavailable. Use the trusted launcher.']],
  [409, ['busy', 'Sunny is answering another conversation. Try again after it finishes.']],
  [413, ['unavailable', 'The conversation request exceeds 8 KiB.']],
  [415, ['unavailable', 'The conversation request could not be accepted.']],
  [423, ['stopped', 'Sunny is paused. Use the trusted launcher to manage local controls.']],
  [500, ['unavailable', 'Sunny could not complete this request.']],
  [502, ['unavailable', 'Sunny could not complete this request.']],
  [503, ['unavailable', 'Sunny local inference is unavailable or not yet qualified.']],
  [504, ['unavailable', 'Sunny did not complete this request in time.']],
]);
const outcome = (statusCode, status, message) => ({ statusCode, body: { status, message } });
const invalid = () => outcome(502, 'unavailable', 'Sunny returned an incompatible response. Relaunch with the current PARADIZE launcher.');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function chatBody(input) {
  if (!record(input) || Object.keys(input).some(key => !['message', 'history'].includes(key)) ||
      typeof input.message !== 'string' || !input.message.trim() || input.message.length > 2000) return null;
  const history = input.history === undefined ? [] : input.history;
  if (!Array.isArray(history) || history.length > 8 || history.some(turn => !record(turn) ||
      Object.keys(turn).some(key => !['role', 'content'].includes(key)) || !['user', 'assistant'].includes(turn.role) ||
      typeof turn.content !== 'string' || turn.content.length > 2000)) return null;
  const body = JSON.stringify({ message: input.message, history: history.map(({ role, content }) => ({ role, content })) });
  return Buffer.byteLength(body, 'utf8') <= MAX_REQUEST_BYTES ? body : null;
}

function publicReply(data, statusCode, route) {
  if (!record(data) || data.service !== 'paradize-sunny-local' || data.protocolVersion !== 2 ||
      data.localOnlyPolicyRequired !== true || data.paidRequestsEnabled !== false || data.provider !== 'ollama') return invalid();
  // These routes have no retrieval or tools authority. A changed upstream
  // capability needs a separately qualified adapter, not wider browser access.
  for (const field of ['toolsEnabled', 'memoryConnected']) if (own(data, field) && data[field] !== false) return invalid();
  if (own(data, 'activeRequest') && typeof data.activeRequest !== 'boolean') return invalid();
  if (own(data, 'model') && data.model !== null && !MODELS.has(data.model)) return invalid();
  if (own(data, 'capabilities') && (!Array.isArray(data.capabilities) || data.capabilities.length > 1 ||
      data.capabilities.some(value => value !== 'local-chat'))) return invalid();

  if (statusCode !== 200) {
    const error = PUBLIC_ERRORS.get(statusCode);
    if (!error || data.status !== error[0]) return invalid();
    // A failed private native credential is an unavailable upstream, not a
    // reason to sign a browser into another owner or expose native diagnostics.
    return outcome([401, 403].includes(statusCode) ? 503 : statusCode, data.status, error[1]);
  }
  if (data.toolsEnabled !== false || data.memoryConnected !== false) return invalid();
  if (route === '/health') {
    if (!HEALTH.has(data.status) || !Array.isArray(data.capabilities) ||
        (data.status === 'ready' ? !MODELS.has(data.model) : data.model != null)) return invalid();
    const body = { status: data.status, message: HEALTH.get(data.status), capabilities: [...data.capabilities], toolsEnabled: false, memoryConnected: false };
    if (own(data, 'model')) body.model = data.model;
    if (own(data, 'activeRequest')) body.activeRequest = data.activeRequest;
    return { statusCode, body };
  }
  if (data.status !== 'complete' || !MODELS.has(data.model) || typeof data.message !== 'string' ||
      !data.message.trim() || data.message.length > 16000) return invalid();
  return { statusCode, body: { status: 'complete', message: data.message, model: data.model, toolsEnabled: false, memoryConnected: false } };
}

export function createSunnyAdapter({ baseUrl, token, fetcher = fetch } = {}) {
  const match = typeof baseUrl === 'string' && /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})$/.exec(baseUrl);
  if (!match || Number(match[1]) > 65535 || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token) || typeof fetcher !== 'function') {
    throw new TypeError('A trusted literal loopback endpoint and native credential are required.');
  }

  async function request(route, body, options) {
    const signal = options?.signal;
    if (!(signal instanceof AbortSignal)) return outcome(400, 'unavailable', 'A request cancellation signal is required.');
    if (signal.aborted) return outcome(499, 'cancelled', 'This conversation request was cancelled.');
    if (route === '/chat' && body === null) return outcome(400, 'unavailable', 'Send a message of at most 2000 characters and up to eight conversation turns within 8 KiB.');
    const controller = new AbortController();
    let timedOut = false, reader, response;
    const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, route === '/health' ? 8000 : 95000);
    const cancel = () => controller.abort();
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    let abort;
    const interrupted = new Promise((_, reject) => {
      abort = () => {
        // Do not await cancellation: a broken upstream stream must not hold a
        // browser request open after its lease, disconnect, or deadline.
        if (reader) void reader.cancel().catch(() => {});
        reject(new Error('request-interrupted'));
      };
      controller.signal.addEventListener('abort', abort, { once: true });
      if (controller.signal.aborted) abort();
    });
    try {
      return await Promise.race([interrupted, (async () => {
        controller.signal.throwIfAborted();
        const url = `${baseUrl}${route}`;
        response = await fetcher(url, {
          method: route === '/health' ? 'GET' : 'POST', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          ...(body === undefined ? {} : { body }),
        });
        if (controller.signal.aborted) { void response?.body?.cancel().catch(() => {}); controller.signal.throwIfAborted(); }
        if (!response || response.redirected || (response.url && response.url !== url) ||
            !Number.isInteger(response.status) || response.status < 200 || response.status >= 600 ||
            !/^application\/json(?:\s*;\s*charset\s*=\s*utf-8)?$/i.test(response.headers?.get('content-type') || '') ||
            (response.headers.get('content-encoding') && response.headers.get('content-encoding').toLowerCase() !== 'identity') ||
            !response.body?.getReader) return invalid();
        const length = response.headers.get('content-length');
        if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) { void response.body.cancel().catch(() => {}); return invalid(); }
        reader = response.body.getReader();
        let size = 0; const chunks = [];
        for (;;) {
          controller.signal.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          if (!(value instanceof Uint8Array) || (size += value.byteLength) > MAX_RESPONSE_BYTES) { void reader.cancel().catch(() => {}); return invalid(); }
          chunks.push(Buffer.from(value));
        }
        controller.signal.throwIfAborted();
        if (length !== null && Number(length) !== size) return invalid();
        let data;
        try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { return invalid(); }
        return publicReply(data, response.status, route);
      })()]);
    } catch {
      if (signal.aborted) return outcome(499, 'cancelled', 'This conversation request was cancelled.');
      if (timedOut) return outcome(504, 'unavailable', 'Sunny did not complete this request in time.');
      return outcome(503, 'unavailable', 'Sunny local service is unavailable.');
    } finally {
      clearTimeout(deadline);
      signal.removeEventListener('abort', cancel);
      controller.signal.removeEventListener('abort', abort);
      controller.abort();
      if (reader) void reader.cancel().catch(() => {});
      else if (response?.body) void response.body.cancel().catch(() => {});
    }
  }
  // No browser-provided path, headers, token, knowledge query, or global STOP.
  return Object.freeze({ health: options => request('/health', undefined, options), chat: (input, options) => request('/chat', chatBody(input), options) });
}
