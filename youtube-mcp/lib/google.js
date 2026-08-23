/**
 * Thin REST client for YouTube Data API v3 and YouTube Analytics API v2.
 *
 * Uses global fetch (Node 18+) rather than the googleapis SDK: no dependency
 * tree, far faster cold starts on serverless.
 */

const DATA = 'https://www.googleapis.com/youtube/v3';
const UPLOAD = 'https://www.googleapis.com/upload/youtube/v3';
const ANALYTICS = 'https://youtubeanalytics.googleapis.com/v2';

export class YouTubeApiError extends Error {
  constructor(status, payload) {
    const detail = payload?.error?.message || payload?.error_description || `HTTP ${status}`;
    const reason = payload?.error?.errors?.[0]?.reason;
    super(reason ? `${detail} (${reason})` : detail);
    this.status = status;
    this.reason = reason;
  }
}

async function call(token, url, { method = 'GET', body, headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(body !== undefined && !headers['content-type'] ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body),
  });

  if (res.status === 204) return {};
  const text = await res.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { error: { message: text.slice(0, 300) } };
    }
  }
  if (!res.ok) throw new YouTubeApiError(res.status, payload);
  return payload;
}

function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    u.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return u.toString();
}

/* ---------------------------- Data API ---------------------------- */

export const data = {
  get: (token, path, params) => call(token, `${DATA}/${path}?${qs(params)}`),
  post: (token, path, params, body) => call(token, `${DATA}/${path}?${qs(params)}`, { method: 'POST', body }),
  put: (token, path, params, body) => call(token, `${DATA}/${path}?${qs(params)}`, { method: 'PUT', body }),
  del: (token, path, params) => call(token, `${DATA}/${path}?${qs(params)}`, { method: 'DELETE' }),
};

export function analyticsQuery(token, params) {
  return call(token, `${ANALYTICS}/reports?${qs(params)}`);
}

/* ---------------------------- Uploads ----------------------------- */

const MAX_FETCH_BYTES = 64 * 1024 * 1024;

/** Download a public URL into memory, with a hard size ceiling. */
async function fetchBinary(url, limit = MAX_FETCH_BYTES) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Source URL is not a valid URL');
  }
  if (parsed.protocol !== 'https:') throw new Error('Source URL must use https');

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`Could not download source URL (HTTP ${res.status})`);

  const declared = Number(res.headers.get('content-length') || 0);
  if (declared && declared > limit) {
    throw new Error(`Source file is ${(declared / 1048576).toFixed(1)} MB, over the ${limit / 1048576} MB limit for this deployment`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > limit) {
    throw new Error(`Source file is ${(buf.length / 1048576).toFixed(1)} MB, over the ${limit / 1048576} MB limit for this deployment`);
  }
  return { bytes: buf, contentType: res.headers.get('content-type') || 'application/octet-stream' };
}

/** Resumable video upload: initiate, then send the bytes in one PUT. */
export async function uploadVideo(token, { sourceUrl, snippet, status }) {
  const { bytes, contentType } = await fetchBinary(sourceUrl);

  const init = await fetch(`${UPLOAD}/videos?${qs({ part: 'snippet,status', uploadType: 'resumable' })}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-upload-content-length': String(bytes.length),
      'x-upload-content-type': contentType.startsWith('video/') ? contentType : 'video/*',
    },
    body: JSON.stringify({ snippet, status }),
  });

  if (!init.ok) {
    const payload = await init.json().catch(() => ({}));
    throw new YouTubeApiError(init.status, payload);
  }
  const session = init.headers.get('location');
  if (!session) throw new Error('YouTube did not return a resumable upload session URL');

  const put = await fetch(session, {
    method: 'PUT',
    headers: { 'content-length': String(bytes.length), 'content-type': contentType },
    body: bytes,
  });
  const payload = await put.json().catch(() => ({}));
  if (!put.ok) throw new YouTubeApiError(put.status, payload);
  return payload;
}

export async function setThumbnail(token, videoId, sourceUrl) {
  const { bytes, contentType } = await fetchBinary(sourceUrl, 2 * 1024 * 1024);
  return call(token, `${UPLOAD}/thumbnails/set?${qs({ videoId, uploadType: 'media' })}`, {
    method: 'POST',
    body: bytes,
    headers: { 'content-type': contentType.startsWith('image/') ? contentType : 'image/jpeg' },
  });
}
