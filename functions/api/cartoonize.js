const PROMPT = [
  "Transform the uploaded photo into a simple flat-colour cartoon illustration for a children's colour-by-number puzzle.",
  "Preserve the main subject and composition.",
  "Use clean black outlines, large simple shapes, flat colours, and minimal shading.",
  "Remove visual clutter, tiny texture, glare, noise, and unnecessary background detail.",
  "Do not add text, labels, numbers, watermarks, or decorative borders.",
].join(" ");

export async function onRequestPost(context) {
  const apiKey = context.env.OPENAI_API_KEY;

  if (!apiKey) {
    return jsonResponse(
      {
        error: "AI drawing mode is not configured yet. Add OPENAI_API_KEY in Cloudflare Pages environment variables.",
      },
      501,
    );
  }

  const body = await context.request.formData();
  const image = body.get("image");

  if (!(image instanceof File)) {
    return jsonResponse({ error: "No image file was uploaded." }, 400);
  }

  const form = new FormData();
  form.append("model", context.env.OPENAI_IMAGE_MODEL || "gpt-image-1-mini");
  form.append("prompt", PROMPT);
  form.append("image", image, image.name || "photo.jpg");
  form.append("size", "1024x1024");
  form.append("quality", "low");

  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  const payload = await response.json();

  if (!response.ok) {
    return jsonResponse(
      {
        error: payload.error?.message || "The AI drawing step failed.",
      },
      response.status,
    );
  }

  const imageBase64 = payload.data?.[0]?.b64_json;

  if (!imageBase64) {
    return jsonResponse({ error: "The AI response did not include an image." }, 502);
  }

  return jsonResponse({
    imageDataUrl: `data:image/png;base64,${imageBase64}`,
  });
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}

