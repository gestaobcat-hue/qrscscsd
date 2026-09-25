# Protótipo visual e fluxo API

Cópia local para experimentar mudanças visuais com fluxo completo:

- Consulta CPF (Snoop)
- Geração PIX de regularização (BlackCat)
- Verificação automática do status PIX a cada 30 segundos
- Envio de comprovantes para Netlify Blobs após 2 minutos
- Painel administrativo protegido em `/admin.html`

## Rodar local com APIs

Para testar fluxo completo (HTML + Functions) igual ao deploy, use Netlify CLI:

```bash
npm install -g netlify-cli
netlify dev
```

Abra a URL mostrada pelo comando (geralmente `http://localhost:8888/cnh/home.html`).

## Deploy na Netlify

Arquivos preparados:

- `netlify.toml`
- `netlify/functions/cpf.js`
- `netlify/functions/pix.js`

### Variáveis de ambiente

Use `.env.netlify.example` como referência e configure no painel da Netlify:

- `SNOOP_API_TOKENS`
- `BLACKCAT_BASE_URL`
- `BLACKCAT_API_KEY`
- `ADMIN_PASSWORD` (senha de acesso ao painel de comprovantes)
- `ADMIN_SESSION_SECRET` (opcional, recomendado para assinar sessões administrativas)
- `PROOF_UPLOAD_SECRET` (opcional, recomendado para assinar permissões de upload)
- `NETLIFY_BLOBS_TOKEN` (necessário somente quando o contexto automático do Blobs não estiver disponível; use um Personal Access Token da Netlify)
- `NETLIFY_SITE_ID` (normalmente já é fornecido pela Netlify; corresponde ao Project ID)

Configure as variáveis no painel da Netlify em **Project configuration > Environment variables**, com escopo de Functions. Não coloque senhas reais no `netlify.toml` ou no repositório.

### Build/Publish

- Publish directory: `site`
- Functions directory: `netlify/functions`

As rotas `/api/cpf`, `/api/pix`, `/api/pix-status`, `/api/proofs` e `/api/proof-admin` são redirecionadas para Netlify Functions.

Os comprovantes são salvos no store persistente `payment-proofs` do Netlify Blobs. O painel permite listar e baixar os arquivos sem expor URLs públicas dos blobs.

Se o painel informar que o storage não está configurado, defina `NETLIFY_BLOBS_TOKEN` no escopo de Functions e publique novamente. A Function combina esse token com o `NETLIFY_SITE_ID` fornecido pelo projeto.

### Verificação PIX

A cobrança retorna o `transaction_id`, que é consultado no endpoint oficial da BlackCat `GET /sales/{transactionId}/status`. A tela consulta ao abrir, repete a consulta a cada 30 segundos e também permite verificação manual. Quando o status retornado é `PAID`, a tela muda para “Pago” e interrompe as consultas.

## Observação

No ambiente Netlify, o fluxo principal é 100% em `*.html` dentro de `site/cnh/`.
As APIs rodam em Netlify Functions (`/api/cpf` e `/api/pix`).
