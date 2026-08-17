---
name: vision-offload
description: Use this skill when the prompt contains an image (file path, screenshot, pasted media) and the current model cannot read images (no vision capability). Delegate image reading to a local vision model (Ornith-1.0-35B-4bit via omlx on port 1331) through a read-only subagent. Do not use when the current model has vision, or when no image is involved.
---

# Vision Offload

Read an image using the local `Ornith-1.0-35B-4bit` vision model (omlx, `http://localhost:1331`) when the current model has no vision capability.

**Hard rule**: never guess or infer image contents yourself. If you cannot see the image, the answer comes from the local model — or from the user if the model is unavailable.

## Step 1 - Locate the image

1. Find the image in the prompt: a file path, an attachment path, or a pasted/saved media file.
2. Resolve it to an absolute local path. Verify it exists (`ls`) and is an image (jpg, jpeg, png, gif, webp, bmp).
3. If no concrete file path exists (e.g. the image is only an inline attachment with no path), ask the user for a file path or to save it to disk. Do not proceed without a path.

## Step 2 - Build the context block

Extract from the current conversation a compact context block for the vision model. Include:

1. **Task**: what the user actually wants to know or do (e.g. "explain this error screenshot", "describe this UI mockup").
2. **What to look for**: specific details the user asked about (error text, UI elements, diagrams, numbers).
3. **Response format**: how the answer should be shaped (e.g. "transcribe all text verbatim", "list UI elements top-to-bottom", "one-paragraph description").
4. **Repo context**: relevant file paths or code snippets the image relates to (keep short).

## Step 3 - Dispatch the subagent

1. Load [references/subagent-prompt.md](references/subagent-prompt.md).
2. Substitute `IMAGE_PATH`, `MIME_TYPE` (from `file IMAGE_PATH`), and the context block from Step 2.
3. Dispatch via the `Agent` tool: `subagent_type: generic-readonly`, with the substituted prompt as the task. Description: "Read image via local Ornith".
4. The subagent is the executor only: it encodes the image, calls the local API, and returns the model's text answer verbatim. It must not add, correct, or interpret content of its own.

## Step 4 - Relay the result

1. Present the subagent's returned answer to the user.
2. Attribute it: note that the image was read by the local Ornith model.
3. Do not re-interpret or contradict the image content with guesses. Use the answer as the source of truth for the image.

## Failure handling (fail-safe)

If any step fails (image missing, subagent error, API down, non-200, timeout, empty answer):

1. Report the verbatim error to the user.
2. For connection errors on port 1331, tell the user omlx appears to be down and ask them to start it (e.g. `omlx serve Ornith-1.0-35B-4bit --port 1331`).
3. **Never fabricate image contents.** Say you could not read the image and offer: retry once omlx is running, or have the user describe the image.
