# Fixture Patterns

Conventions for organizing test fixture files used by integration tests.

## Directory Structure

Use the project's existing convention. If none exists, default to:

```
tests/
├── fixtures/                    # Shared test fixtures
│   ├── <feature>/
│   │   ├── case_1_input.json
│   │   ├── case_1_expected.json
│   │   ├── case_2_input.csv
│   │   └── case_2_expected.csv
│   └── ...
├── unit/                        # Unit tests
└── integration/                 # Integration tests
```

## Naming Conventions

- `<feature>_<case>_input.<ext>` — input data for the test.
- `<feature>_<case>_expected.<ext>` — expected output for comparison.
- Use snake_case. Keep names short but descriptive.
- Group related fixtures under a feature subdirectory.

## Format Selection

| Format | When to Use                                       |
| ------ | ------------------------------------------------- |
| JSON   | Structured data, API payloads, config objects     |
| CSV    | Tabular data, data pipelines                      |
| YAML   | Configuration, nested structures                  |
| Text   | Plain text, CLI output, log files                 |
| Binary | Binary file processing (images, PDFs) — sparingly |

## Rules

- Fixtures must be deterministic: no timestamps, random UUIDs, or environment-dependent values.
- Keep fixtures minimal — only include data relevant to the test case.
- Commit fixture files alongside their tests.
- Never include secrets, credentials, or PII in fixtures.
- Use relative paths when loading fixtures in tests.

## Loading Patterns

### Python

```python
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"

def load_fixture(name: str) -> str:
    return (FIXTURES / name).read_text()
```

### JavaScript / TypeScript

```javascript
import { readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES = join(__dirname, 'fixtures');

function loadFixture(name) {
  return readFileSync(join(FIXTURES, name), 'utf-8');
}
```

## Parameterized Tests

When multiple input/output pairs share the same test logic, use parameterized tests.

**Python (pytest)**:

```python
import pytest, json

@pytest.mark.integration
@pytest.mark.parametrize("input_file,expected_file", [
    ("case_1_input.json", "case_1_expected.json"),
    ("case_2_input.json", "case_2_expected.json"),
])
def test_process(input_file, expected_file):
    input_data = load_fixture(f"feature/{input_file}")
    expected = load_fixture(f"feature/{expected_file}")
    result = process(json.loads(input_data))
    assert result == json.loads(expected)
```

**JavaScript (Jest / Vitest)**:

```javascript
describe.each([
  ['case_1_input.json', 'case_1_expected.json'],
  ['case_2_input.json', 'case_2_expected.json'],
])('process(%s)', (inputFile, expectedFile) => {
  it(`should produce ${expectedFile}`, () => {
    const input = JSON.parse(loadFixture(`feature/${inputFile}`));
    const expected = JSON.parse(loadFixture(`feature/${expectedFile}`));
    expect(process(input)).toEqual(expected);
  });
});
```
