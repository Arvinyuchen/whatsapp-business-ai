const defaultBodyLimit = 1024 * 1024;

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Request body is too large.'), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks)));
    request.on('error', reject);
  });
}

function toHeaders(nodeHeaders) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(nodeHeaders)) {
    if (Array.isArray(value)) {
      value.forEach((item) => headers.append(name, item));
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }
  return headers;
}

export function createNodeHandler(app, { bodyLimit = defaultBodyLimit } = {}) {
  return async function nodeHandler(request, response) {
    try {
      const method = request.method || 'GET';
      const origin = `http://${request.headers.host || 'localhost'}`;
      const body = ['GET', 'HEAD'].includes(method)
        ? undefined
        : await readBody(request, bodyLimit);
      const webRequest = new Request(new URL(request.url || '/', origin), {
        method,
        headers: toHeaders(request.headers),
        body
      });
      const webResponse = await app.handle(webRequest);
      const responseHeaders = Object.fromEntries(webResponse.headers.entries());
      response.writeHead(webResponse.status, responseHeaders);
      response.end(Buffer.from(await webResponse.arrayBuffer()));
    } catch (error) {
      if (response.headersSent) {
        response.end();
        return;
      }

      const status = error.status || 500;
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: status === 500 ? 'Internal server error' : error.message }));
    }
  };
}
