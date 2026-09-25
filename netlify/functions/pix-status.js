const crypto = require("node:crypto");

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

function normalizeStatus(value) {
  const status = String(value || "UNKNOWN").trim().toUpperCase();
  if (["PAID", "APPROVED", "COMPLETED", "CONFIRMED", "SUCCEEDED"].includes(status)) return "PAID";
  if (["PENDING", "WAITING_PAYMENT", "WAITING", "PROCESSING", "CREATED"].includes(status)) return "PENDING";
  if (["CANCELLED", "CANCELED", "EXPIRED", "FAILED", "DECLINED"].includes(status)) return "CANCELLED";
  if (["REFUNDED", "CHARGEBACK"].includes(status)) return "REFUNDED";
  return status;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifyProofToken(token, secret, transactionId) {
  const [payloadPart, signaturePart] = String(token || "").split(".");
  if (!payloadPart || !signaturePart) return false;
  const expected = crypto.createHmac("sha256", secret).update(payloadPart).digest("base64url");
  if (!safeEqual(signaturePart, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8"));
    return payload.transactionId === transactionId;
  } catch {
    return false;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") return json(405, { error: "method_not_allowed" });

  const transactionId = String(event.queryStringParameters?.transaction_id || "").trim();
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(transactionId)) {
    return json(400, { error: "invalid_transaction_id" });
  }

  const apiKey = process.env.BLACKCAT_API_KEY || "";
  if (!apiKey) return json(500, { error: "blackcat_credentials_missing" });
  const proofToken = event.headers?.["x-proof-token"] || event.headers?.["X-Proof-Token"] || "";
  const signingSecret = process.env.PROOF_UPLOAD_SECRET || apiKey;
  if (!verifyProofToken(proofToken, signingSecret, transactionId)) {
    return json(401, { error: "invalid_proof_token" });
  }

  const baseUrl = (process.env.BLACKCAT_BASE_URL || "https://api.blackcatoficial.com/api").replace(/\/$/, "");

  try {
    const response = await fetch(`${baseUrl}/sales/${encodeURIComponent(transactionId)}/status`, {
      method: "GET",
      headers: { "X-API-Key": apiKey, Accept: "application/json" }
    });
    const text = await response.text();
    let decoded;
    try {
      decoded = JSON.parse(text);
    } catch {
      return json(502, { error: "invalid_upstream_response" });
    }

    if (!response.ok) {
      return json(response.status || 502, {
        error: "status_lookup_failed",
        message: decoded?.message || decoded?.error || "Falha ao consultar o pagamento."
      });
    }

    const source = decoded?.data && typeof decoded.data === "object" ? decoded.data : decoded;
    const status = normalizeStatus(source?.status || source?.paymentStatus || decoded?.status);

    return json(200, {
      transaction_id: source?.transactionId || source?.transaction_id || transactionId,
      status,
      paid: status === "PAID",
      paid_at: source?.paidAt || source?.paid_at || null,
      checked_at: new Date().toISOString()
    });
  } catch (error) {
    return json(502, { error: "upstream_unreachable", detail: String(error) });
  }
};
