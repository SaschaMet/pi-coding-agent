# Trusted Directories (`.pi/trust.json`)

## Purpose

The read boundary guard blocks access to paths outside the current working directory by default. Use `.pi/trust.json` to declare additional directories that the agent can access without interactive approval.

## Schema

```json
{
  "trustedDirectories": ["/absolute/path/to/dir", "~/home/path"]
}
```

- `trustedDirectories`: array of absolute paths (supports `~` expansion)
- Empty array or missing key: no trusted directories
- Relative paths are silently skipped

## Behavior

- Paths under trusted directories bypass the "outside working directory" block
- Applies to all guarded tools: `read`, `write`, `edit`, `grep`, `find`, `ls`
- Global `~/.pi` read-only rule still applies (trusted directories don't override it)
- Symlink escape detection still works (resolved real paths are checked)

## Location

Place `.pi/trust.json` at the project root. The loader walks up the directory tree from `cwd` to find it, so it works even when the agent operates in a subdirectory.

## Example

```json
{
  "trustedDirectories": [
    "/Users/sascha/Documents",
    "~/shared-configs"
  ]
}
```

## Security Considerations

- Trust is broad: any path under a trusted directory is accessible
- Avoid trusting overly broad paths (e.g., `/`)
- The file is gitignored by default (`.pi/trust.json` in `.gitignore`)
- Malformed or missing `trust.json` is handled gracefully (no access granted)
