async function getProofStore() {
  const { getStore } = await import("@netlify/blobs");
  const options = { name: "payment-proofs", consistency: "strong" };
  const siteID = process.env.NETLIFY_SITE_ID || process.env.SITE_ID || "";
  const token = process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN || process.env.NETLIFY_ACCESS_TOKEN || "";

  if (siteID && token) {
    options.siteID = siteID;
    options.token = token;
  }

  return getStore(options);
}

function storageErrorResponse(error) {
  if (error?.name === "MissingBlobsEnvironmentError") {
    return {
      statusCode: 503,
      body: {
        error: "proof_storage_not_configured",
        message: "O Netlify Blobs não recebeu as credenciais do projeto. Configure NETLIFY_BLOBS_TOKEN nas variáveis de ambiente e publique novamente."
      }
    };
  }

  return {
    statusCode: 500,
    body: {
      error: "proof_storage_failed",
      message: "Não foi possível acessar os comprovantes agora. Tente novamente em instantes."
    }
  };
}

module.exports = { getProofStore, storageErrorResponse };
