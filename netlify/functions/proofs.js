const crypto = require("node:crypto");

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MIN_UPLOAD_AGE_MS = 2 * 60 * 1000;
const ACCEPTED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

function json(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

function decodeBody(event) {
  const body = event.body || "";
  return event.isBase64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyUploadToken(token, secret) {
  const [payloadPart, signaturePart] = String(token || "").split(".");
  if (!payloadPart || !signaturePart) return null;
  const expected = crypto.createHmac("sha256", secret).update(payloadPart).digest("base64url");
  if (!safeEqual(signaturePart, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function detectContentType(buffer) {
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength);
}

function cleanFileName(value, contentType) {
  const extensions = { "application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
  const cleaned = cleanText(value, 120).replace(/[\\/<>:"|?*]+/g, "-") || `comprovante${extensions[contentType]}`;
  return cleaned;
}

async function readPaymentStatus(transactionId) {
  const apiKey = process.env.BLACKCAT_API_KEY || "";
  if (!apiKey) return null;
  const baseUrl = (process.env.BLACKCAT_BASE_URL || "https://api.blackcatoficial.com/api").replace(/\/$/, "");
  try {
    const response = await fetch(`${baseUrl}/sales/${encodeURIComponent(transactionId)}/status`, {
      headers: { "X-API-Key": apiKey, Accept: "application/json" }
    });
    if (!response.ok) return null;
    const decoded = await response.json();
    const source = decoded?.data && typeof decoded.data === "object" ? decoded.data : decoded;
    return String(source?.status || source?.paymentStatus || "").toUpperCase();
  } catch {
    return null;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "method_not_allowed" });

  let data;
  try {
    data = JSON.parse(decodeBody(event) || "{}");
  } catch {
    return json(400, { error: "invalid_json" });
  }

  const transactionId = cleanText(data.transaction_id, 160);
  const signingSecret = process.env.PROOF_UPLOAD_SECRET || process.env.BLACKCAT_API_KEY || "";
  if (!signingSecret) return json(500, { error: "proof_signing_secret_missing" });

  const tokenData = verifyUploadToken(data.proof_token, signingSecret);
  if (!tokenData || tokenData.transactionId !== transactionId || !Number.isFinite(Number(tokenData.createdAt))) {
    return json(401, { error: "invalid_proof_token" });
  }

  const createdAt = Number(tokenData.createdAt);
  if (createdAt > Date.now() + 60_000 || Date.now() - createdAt < MIN_UPLOAD_AGE_MS) {
    return json(403, { error: "upload_not_available_yet" });
  }

  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(transactionId)) {
    return json(422, { error: "invalid_transaction_id" });
  }

  const declaredType = cleanText(data.content_type, 80).toLowerCase();
  const base64 = String(data.file_base64 || "").replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!ACCEPTED_TYPES.has(declaredType) || !base64) return json(422, { error: "invalid_file_type" });
  if (base64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 + 8) return json(413, { error: "file_too_large" });

  const file = Buffer.from(base64, "base64");
  if (!file.length || file.length > MAX_FILE_BYTES) return json(413, { error: "file_too_large" });
  const detectedType = detectContentType(file);
  if (!detectedType || detectedType !== declaredType) return json(422, { error: "file_content_mismatch" });

  const paymentStatus = await readPaymentStatus(transactionId);
  if (["PAID", "APPROVED", "COMPLETED", "CONFIRMED", "SUCCEEDED"].includes(paymentStatus)) {
    return json(409, { error: "payment_already_confirmed" });
  }

  const id = crypto.randomUUID();
  const uploadedAt = new Date().toISOString();
  const metadata = {
    id,
    transactionId,
    reference: cleanText(tokenData.reference, 160),
    customerName: cleanText(data.customer_name, 160),
    cpf: cleanText(data.cpf, 24),
    ticket: cleanText(data.ticket, 80),
    originalName: cleanFileName(data.file_name, detectedType),
    contentType: detectedType,
    size: file.length,
    uploadedAt,
    checkoutCreatedAt: new Date(createdAt).toISOString(),
    paymentStatusAtUpload: paymentStatus || "UNAVAILABLE"
  };

  try {
    const { getStore } = await import("@netlify/blobs");
    const store = getStore({ name: "payment-proofs", consistency: "strong" });
    await store.set(`proofs/${id}`, file, { metadata, onlyIfNew: true });
    return json(201, { ok: true, id, uploaded_at: uploadedAt });
  } catch (error) {
    console.error("proof_upload_failed", error);
    return json(500, { error: "proof_storage_failed" });
  }
};
