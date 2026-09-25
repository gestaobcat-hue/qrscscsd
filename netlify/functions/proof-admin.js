const crypto = require("node:crypto");

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function json(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

function safeEqual(a, b) {
  const left = crypto.createHash("sha256").update(String(a)).digest();
  const right = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(left, right);
}

function signSession(secret) {
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + SESSION_TTL_MS, role: "proof-admin" })).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return { token: `${payload}.${signature}`, expiresAt: now + SESSION_TTL_MS };
}

function verifySession(token, secret) {
  const [payloadPart, signaturePart] = String(token || "").split(".");
  if (!payloadPart || !signaturePart) return false;
  const expected = crypto.createHmac("sha256", secret).update(payloadPart).digest("base64url");
  if (!safeEqual(signaturePart, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    return payload.role === "proof-admin" && Number(payload.exp) > Date.now();
  } catch {
    return false;
  }
}

function bearerToken(event) {
  const header = event.headers?.authorization || event.headers?.Authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

function safeDownloadName(value) {
  return String(value || "comprovante")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "-")
    .replace(/[\r\n"\\/]/g, "-")
    .slice(0, 120);
}

exports.handler = async (event) => {
  const password = process.env.ADMIN_PASSWORD || "";
  const sessionSecret = process.env.ADMIN_SESSION_SECRET || password;
  if (!password) return json(503, { error: "admin_password_missing" });

  if (event.httpMethod === "POST") {
    let data;
    try {
      const raw = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body;
      data = JSON.parse(raw || "{}");
    } catch {
      return json(400, { error: "invalid_json" });
    }
    if (!safeEqual(data.password || "", password)) return json(401, { error: "invalid_password" });
    const session = signSession(sessionSecret);
    return json(200, { token: session.token, expires_at: new Date(session.expiresAt).toISOString() });
  }

  if (event.httpMethod !== "GET") return json(405, { error: "method_not_allowed" });
  if (!verifySession(bearerToken(event), sessionSecret)) return json(401, { error: "invalid_session" });

  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore({ name: "payment-proofs", consistency: "strong" });
    const requestedId = String(event.queryStringParameters?.file || "").trim();

    if (requestedId) {
      if (!/^[0-9a-f-]{36}$/i.test(requestedId)) return json(400, { error: "invalid_file_id" });
      const entry = await store.getWithMetadata(`proofs/${requestedId}`, { type: "arrayBuffer", consistency: "strong" });
      if (!entry) return json(404, { error: "proof_not_found" });
      const contentType = entry.metadata?.contentType || "application/octet-stream";
      const fileName = safeDownloadName(entry.metadata?.originalName);
      return {
        statusCode: 200,
        isBase64Encoded: true,
        headers: {
          "content-type": contentType,
          "content-disposition": `attachment; filename="${fileName}"`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff"
        },
        body: Buffer.from(entry.data).toString("base64")
      };
    }

    const { blobs } = await store.list({ prefix: "proofs/" });
    const proofs = (await Promise.all(blobs.map(async (blob) => {
      const entry = await store.getMetadata(blob.key, { consistency: "strong" });
      if (!entry?.metadata) return null;
      return { ...entry.metadata, etag: entry.etag };
    }))).filter(Boolean).sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));

    return json(200, { proofs, total: proofs.length });
  } catch (error) {
    console.error("proof_admin_failed", error);
    return json(500, { error: "proof_storage_failed" });
  }
};
