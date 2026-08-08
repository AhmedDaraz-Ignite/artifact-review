import http from 'node:http';

// Bypasses the session client so a scenario can omit the token or forge a header.
export function rawRequest(origin, { path = '/', method = 'GET', headers = {}, body } = {}) {
  const base = new URL(origin);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname:base.hostname,
      port:base.port,
      path,
      method,
      headers,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status:response.statusCode,
        headers:response.headers,
        body:Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}
