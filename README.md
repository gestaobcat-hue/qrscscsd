# Protótipo visual e fluxo API

Cópia local para experimentar mudanças visuais com fluxo completo:

- Consulta CPF (Snoop)
- Geração PIX de regularização (BlackCat)

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

### Build/Publish

- Publish directory: `site`
- Functions directory: `netlify/functions`

As rotas `/api/cpf` e `/api/pix` são redirecionadas para Netlify Functions.

## Observação

No ambiente Netlify, o fluxo principal é 100% em `*.html` dentro de `site/cnh/`.
As APIs rodam em Netlify Functions (`/api/cpf` e `/api/pix`).
