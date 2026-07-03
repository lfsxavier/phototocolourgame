# phototocolourgame
A simple game that turns a photo into a colour by number game

## Local development

```bash
npm install
npm run dev
```

## Cloudflare Pages

- Build command: `npm run build`
- Output directory: `dist`

## Optional AI drawing mode

AI drawing mode uses a Cloudflare Pages Function at `/api/cartoonize`, so the OpenAI API key is never exposed in the browser.

In Cloudflare Pages, add:

- `OPENAI_API_KEY`: your OpenAI API key
- `OPENAI_IMAGE_MODEL`: optional, defaults to `gpt-image-1-mini`

After saving environment variables, redeploy the Pages project.
