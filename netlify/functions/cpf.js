exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "method_not_allowed" })
    };
  }

  const cpf = (event.queryStringParameters?.cpf || "").replace(/\D/g, "");
  if (cpf.length !== 11) {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: "cpf_invalid" })
    };
  }

  const tokenList = (process.env.SNOOP_API_TOKENS || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  if (!tokenList.length) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        error: "snoop_tokens_missing",
        message: "Configure SNOOP_API_TOKENS nas variaveis da Netlify."
      })
    };
  }

  const url = `https://snoopintelligence.cloud/api/v2/generic/cpf?cpf=${encodeURIComponent(cpf)}`;

  let lastStatus = 502;
  let lastBody = "";

  for (const token of tokenList) {
    try {
      const resp = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      const text = await resp.text();
      lastStatus = resp.status;
      lastBody = text;

      if (resp.ok) {
        return {
          statusCode: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
          body: text
        };
      }
    } catch (err) {
      lastStatus = 502;
      lastBody = JSON.stringify({ error: "upstream_unreachable", detail: String(err) });
    }
  }

  return {
    statusCode: lastStatus || 502,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: lastBody || JSON.stringify({ error: "cpf_lookup_failed" })
  };
};
