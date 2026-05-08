---
name: "jupyter-notebook"
description: "Use this skill only when the user asks to create, scaffold, convert, or edit a Jupyter `.ipynb` notebook for experiments, data analysis, research exploration, tutorials, or teaching walkthroughs. Scaffold new notebooks with `new_notebook.py` and validate runnable top-to-bottom flow. Do not use for plain Python scripts or production app code."
---

# Jupyter Notebook Skill

Create clean, reproducible Jupyter notebooks in two modes:

- Experiments and exploratory analysis
- Tutorials and teaching-oriented walkthroughs

Always prefer the bundled templates and helper script for new notebooks. Hand-edit raw notebook JSON only for targeted edits.

## Gotchas

- Do not hand-author a full notebook JSON file when the template helper is available.
- Do not leave hidden state: cells must run in order from a clean kernel.
- Do not store secrets, machine-specific absolute paths, or large raw outputs in committed notebooks.
- Keep notebooks for exploration or teaching. Move reusable production logic into normal modules when needed.

## When to use

- The requested artifact is a `.ipynb` notebook.
- The user asks to convert notes, scripts, or analysis into a structured notebook.
- The user asks to refactor an existing notebook for reproducibility, readability, or teaching flow.
- The output will be read, taught from, or re-run by other people.

## When NOT to use

- Do not use for plain scripts, services, CLIs, frontend components, or production application logic.
- Do not use when the user only asks to explain notebooks without creating or editing one.

## Decision tree

- If the request is exploratory, analytical, or hypothesis-driven, choose `experiment`.
- If the request is instructional, step-by-step, or audience-specific, choose `tutorial`.
- If editing an existing notebook, treat it as a refactor: preserve intent and improve structure.

## Resolve skill path

Before running the helper script, resolve the installed skill directory:

1. Prefer the project-local path when present: `.pi/skills/jupyter-notebook`.
2. Otherwise use `$PI_AGENT_HOME/skills/jupyter-notebook`.
3. If neither exists, locate the current `jupyter-notebook/SKILL.md` path and use its directory.

The helper is `scripts/new_notebook.py` inside that directory.

## Workflow

1. Lock the outcome.
   Identify the notebook kind: `experiment` or `tutorial`.
   Capture the objective, audience, required inputs, and the observable result that means the notebook works.

2. Scaffold from the template.
   Use the helper script to avoid hand-authoring raw notebook JSON.

```bash
uv run --python 3.12 python "$SKILL_DIR/scripts/new_notebook.py" \
  --kind experiment \
  --title "Compare prompt variants" \
  --out output/jupyter-notebook/compare-prompt-variants.ipynb
```

```bash
uv run --python 3.12 python "$SKILL_DIR/scripts/new_notebook.py" \
  --kind tutorial \
  --title "Intro to embeddings" \
  --out output/jupyter-notebook/intro-to-embeddings.ipynb
```

3. Fill the notebook with small, runnable steps.
   Keep each code cell focused on one step.
   Add short markdown cells that explain the purpose and expected result.
   Avoid large, noisy outputs when a short summary works.

4. Load only the needed pattern reference.
   For experiments, read `references/experiment-patterns.md`.
   For tutorials, read `references/tutorial-patterns.md`.

5. Edit safely when working with existing notebooks.
   Preserve the notebook structure; avoid reordering cells unless it improves the top-to-bottom story.
   Prefer targeted edits over full rewrites.
   If you must edit raw JSON, review `references/notebook-structure.md` first.

6. Validate the result.
   Run the notebook top-to-bottom when the environment allows.
   If execution is not possible, say so explicitly and call out how to validate locally.
   Use the final pass checklist in `references/quality-checklist.md`.

## Outcome checks

- A new notebook opens as valid JSON and uses the requested title.
- Early cells define all state needed by later cells.
- Code cells are small, deterministic, and runnable in order.
- Markdown explains purpose and result, not obvious code mechanics.
- Outputs are concise and do not contain secrets, absolute local paths, or noisy dumps.

## Templates and helper

- Templates live in `assets/experiment-template.ipynb` and `assets/tutorial-template.ipynb`.
- The helper script loads a template, updates the title cell, and writes a notebook.

## Temp and output conventions

- Use `tmp/jupyter-notebook/` for intermediate files; delete when done.
- Write final artifacts under `output/jupyter-notebook/` when working in this repo.
- Use stable, descriptive filenames (for example, `ablation-temperature.ipynb`).

## Dependencies

Prefer `uv` for dependency management.

Optional Python packages for local notebook execution:

```bash
uv pip install jupyterlab ipykernel
```

The scaffold script uses only the Python standard library. Install notebook packages only when execution requires them.

## Environment

No required environment variables.

## Reference map

- `references/experiment-patterns.md`: experiment structure and heuristics.
- `references/tutorial-patterns.md`: tutorial structure and teaching flow.
- `references/notebook-structure.md`: notebook JSON shape and safe editing rules.
- `references/quality-checklist.md`: final validation checklist.
