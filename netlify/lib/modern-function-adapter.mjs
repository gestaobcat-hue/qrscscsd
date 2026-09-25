function headersToObject(headers) {
  return Object.fromEntries(headers.entries());
}

function queryToObject(url) {
  const result = {};
  for (const [key, value] of url.searchParams.entries()) result[key] = value;
  return result;
}

export async function runLambdaHandler(request, handler) {
  const url = new URL(request.url);
  const hasBody = !["GET", "HEAD"].includes(request.method);
  const event = {
    httpMethod: request.method,
    headers: headersToObject(request.headers),
    queryStringParameters: queryToObject(url),
    body: hasBody ? await request.text() : null,
    isBase64Encoded: false
  };

  const result = await handler(event);
  const body = result.isBase64Encoded
    ? Uint8Array.from(Buffer.from(result.body || "", "base64"))
    : result.body ?? null;

  return new Response(body, {
    status: result.statusCode || 200,
    headers: result.headers || {}
  });
}
