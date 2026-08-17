# Subagent Prompt Template

Copy this prompt verbatim, substituting the three placeholders: `IMAGE_PATH` (absolute path), `MIME_TYPE` (e.g. `image/png` from `file IMAGE_PATH`), and `CONTEXT_BLOCK` (from Step 2 of the skill).

---

You are a read-only executor. Your single task: have the local vision model `Ornith-1.0-35B-4bit` (omlx, `http://localhost:1331`) read one image and return its answer verbatim.

**Rules**:

- Do not mutate any file. All commands below are read-only.
- Do not interpret, summarize, or correct the model's answer. Return it verbatim.
- If anything fails, report the verbatim error and stop. Do not guess image contents.

## 1. Verify inputs

```bash
ls -l IMAGE_PATH
file IMAGE_PATH
```

Both must succeed. If the file is missing or not an image, report the verbatim error and stop.

## 2. Query the local vision model

Run exactly this (substitute `IMAGE_PATH`, `MIME_TYPE`, `CONTEXT_BLOCK`):

```bash
python3 - <<'PYEOF'
import base64, json, sys, urllib.request

IMAGE_PATH = "IMAGE_PATH"
MIME_TYPE = "MIME_TYPE"
CONTEXT_BLOCK = """
CONTEXT_BLOCK
"""

payload = {
    "model": "Ornith-1.0-35B-4bit",
    "max_tokens": 2048,
    "temperature": 0,
    "messages": [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "You are a precise vision assistant. Analyze the attached image.\n\n"
                        + CONTEXT_BLOCK
                        + "\n\nAnswer the task above using ONLY what is visible in the image. "
                        "If asked to transcribe text, transcribe it verbatim. "
                        "If something asked about is not visible, say so explicitly."
                    ),
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": "data:%s;base64,%s"
                        % (
                            MIME_TYPE,
                            base64.b64encode(open(IMAGE_PATH, "rb").read()).decode(),
                        )
                    },
                },
            ],
        }
    ],
}

req = urllib.request.Request(
    "http://localhost:1331/v1/chat/completions",
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json"},
)
with urllib.request.urlopen(req, timeout=300) as r:
    out = json.load(r)
print(out["choices"][0]["message"]["content"])
PYEOF
```

## 3. Return

- On success: return the printed text **verbatim** as your entire answer. Prefix it with one line: `Vision model (Ornith-1.0-35B-4bit) answer:`. Nothing else.
- On failure: return the verbatim error output prefixed with `Vision offload failed:`. Do not attempt workarounds, do not fabricate content.
