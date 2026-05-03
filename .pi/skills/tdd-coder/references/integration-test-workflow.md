# Integration Test Workflow

How to collect input/output pairs from the user and create integration tests.

## When to Use

Integration tests verify that given a specific input, the code produces a specific expected
output. These are black-box tests that exercise the code through its public interface without
testing internal implementation details.

## Step-by-Step

### 1. Ask if Integration Tests Are Needed

After understanding the feature/change scope, ask the user:

> "Do you want integration tests for this change? Integration tests verify that given a
> specific input, the code produces a specific expected output. They're useful for validating
> end-to-end behavior of functions, APIs, CLI commands, or data pipelines."

Use a structured question tool (e.g., `askQuestions`) when available.

### 2. Clarify Input/Output Format

If the user says yes, ask how the integration test inputs and outputs should be defined.
Offer concrete options:

- **Inline**: Small input/output pairs defined directly in the test code.
  Best for simple values, short strings, small dicts/objects.
- **Fixture files**: Larger or complex data stored in files (JSON, CSV, YAML, plain text)
  alongside the tests. Best for multi-line payloads, structured data, realistic samples.
- **Generated**: The user has a script or command that produces test data.
  Capture its output as a fixture file.
- **File-based I/O**: The code under test reads/writes files.
  Create input files and expected output files as fixtures.

### 3. Collect Input/Output Pairs

For each test case, collect from the user:

| Field               | Description                                                            |
| ------------------- | ---------------------------------------------------------------------- |
| **Input**           | Exact data, arguments, or file content provided to the code under test |
| **Expected output** | Exact return value, file content, stdout, or response expected         |
| **Description**     | Short name for the test case (e.g., "empty input returns default")     |

**If the user wants to provide a file:**


1. Ask for the file content or path.
2. If they describe the format, help generate a sample file.
3. Store the fixture in the project's test fixtures directory.


**If the user describes pairs conversationally:**

1. Capture each pair.
2. Confirm the exact values back to the user before using them.
3. Represent them as inline test parameters or fixture files based on complexity.

### 4. Create Fixture Files (When Needed)

Follow [fixture-patterns.md](fixture-patterns.md) for conventions.

- Place fixtures in the project's existing test data location, or default to
  `tests/fixtures/<feature>/`.
- Name descriptively: `<feature>_<case>_input.<ext>`, `<feature>_<case>_expected.<ext>`.
- Keep fixtures minimal — only the data needed for the test.
- Ensure fixtures are deterministic (no timestamps, random values, environment-specific paths).

### 5. Write Integration Tests

- One test per input/output pair.
- Use parameterized tests when multiple pairs share the same test logic.
- Load fixture files relative to the test file (use `pathlib` / `path.join` / framework helpers).
- Assert the EXACT expected output using appropriate comparison
  (deep equality, string matching, file diff).
- Tag or mark integration tests so they can be run separately from unit tests:
  - Python: `@pytest.mark.integration` or separate `tests/integration/` directory.
  - JavaScript: separate describe block, `--testPathPattern`, or directory convention.
  - Other: use the project's grouping mechanism.

### 6. Run and Verify

- Run only the integration tests first.
- Confirm each test fails for the expected reason (Red phase) before implementing.
- After implementation (Green phase), confirm all integration tests pass.
- Integration tests should be included in the coverage report.
