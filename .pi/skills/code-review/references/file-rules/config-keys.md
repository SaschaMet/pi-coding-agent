# JSON and YAML Config Rules

Applies to `**/*.{json,json5,yml,yaml}` that no earlier row matched. Judge keys and structure; judge values
only where an item says so. The tag names the owning lens.

- [qa] A misspelled key: most tools ignore unknown keys silently, so the setting never applies. Compare it
  with the tool's schema or with the same key elsewhere in the repo.
- [qa] A key renamed or removed while code, docs, or other config still read the old name.
- [qa] A value of the wrong type for its key: `"false"` where a boolean is read, a list where a map is read.
- [qa] YAML indentation that moves a key under the wrong parent, or unquoted values YAML reinterprets
  (`no`, `on`, `off`, `08`, `1e3`, a `: ` inside a value).
- [qa] A duplicate key: most parsers keep the last one silently.
- [qa] Comments or trailing commas in a file the consumer parses as strict JSON.
- [security] A weakened security default: TLS or certificate checks off, auth disabled, CORS `*`, debug on
  in production config, broader permissions.
- [security] A credential, token, or URL with an embedded password in a config value.
