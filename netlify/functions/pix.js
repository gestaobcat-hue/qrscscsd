const crypto = require("node:crypto");

function firstNonEmpty(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "method_not_allowed" })
    };
  }

  let data;
  try {
    data = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "invalid_json" })
    };
  }

  const name = String(data.name || "").trim();
  const cpf = String(data.cpf || "").replace(/\D/g, "");
  const email = String(data.email || "").trim();
  const amount = Number.isFinite(Number(data.amount_cents)) ? Number(data.amount_cents) : 0;
  const description = String(data.description || "body splash viriginia").trim();
  const reference = String(data.external_reference || `det-${Date.now()}`).trim();

  if (!name || cpf.length !== 11 || amount <= 0) {
    return {
      statusCode: 422,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "invalid_payload" })
    };
  }

  const apiKey = process.env.BLACKCAT_API_KEY || "";

  if (!apiKey) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        error: "blackcat_credentials_missing",
        message: "Configure BLACKCAT_API_KEY na Netlify."
      })
    };
  }

  const normalizedBaseUrl = (process.env.BLACKCAT_BASE_URL || "https://api.blackcatoficial.com/api").replace(/\/$/, "");
  const fallbackEmail = `${cpf}@email.local`;
  const fallbackPhone = "11999999999";

  const payload = {
    amount,
    currency: "BRL",
    paymentMethod: "pix",
    externalRef: reference,
    metadata: description,
    items: [
      {
        title: description,
        unitPrice: amount,
        quantity: 1,
        tangible: false
      }
    ],
    customer: {
      name,
      email: email || fallbackEmail,
      phone: fallbackPhone,
      document: {
        number: cpf,
        type: "cpf"
      }
    },
    pix: {
      expiresInDays: 2
    }
  };

  try {
    const response = await fetch(`${normalizedBaseUrl}/sales/create-sale`, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    let decoded = null;
    try {
      decoded = JSON.parse(text);
    } catch {
      decoded = null;
    }

    if (!decoded || typeof decoded !== "object") {
      return {
        statusCode: response.status || 502,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ error: "invalid_upstream_response", raw: text })
      };
    }

    const source = decoded?.data && typeof decoded.data === "object" ? decoded.data : decoded;

    const pixCode = firstNonEmpty([
      source?.paymentData?.copyPaste,
      source?.paymentData?.qrCode,
      source?.pix?.copy_paste,
      source?.pix?.payload,
      source?.pix?.code,
      source?.pix_copy_paste,
      source?.qr_code_text,
      source?.emv
    ]);

    const qrImage = firstNonEmpty([
      source?.paymentData?.qrCodeBase64,
      source?.pix?.qr_code_base64,
      source?.pix?.qr_code,
      source?.qr_code_base64,
      source?.qr_code
    ]);

    const transactionId = source?.transactionId || source?.id || source?.transaction_id || source?.data?.id || null;
    const paymentUrl = source?.invoiceUrl || source?.payment_url || source?.checkout_url || null;
    const createdAt = Date.now();
    let proofToken = null;

    if (transactionId) {
      const signingSecret = process.env.PROOF_UPLOAD_SECRET || apiKey;
      const proofPayload = Buffer.from(JSON.stringify({
        transactionId: String(transactionId),
        reference,
        createdAt
      })).toString("base64url");
      const proofSignature = crypto.createHmac("sha256", signingSecret).update(proofPayload).digest("base64url");
      proofToken = `${proofPayload}.${proofSignature}`;
    }

    return {
      statusCode: response.status || 200,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        status: response.status,
        transaction_id: transactionId,
        pix_copy_paste: pixCode,
        pix_qr_image: qrImage,
        payment_url: paymentUrl,
        created_at: new Date(createdAt).toISOString(),
        proof_token: proofToken,
        raw: decoded
      })
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "upstream_unreachable", detail: String(err) })
    };
  }
};
