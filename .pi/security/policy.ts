// The machine-wide security rules, as data. guard-core.ts evaluates them; the
// PI extension, the Claude hook CLI, and the git pre-commit hook all load this
// one file, so a rule changes in one place for every adapter.

export type PatternMode = "block" | "warn";

export interface SecretPattern {
	name: string;
	source: string;
	flags?: string;
	mode: PatternMode;
}

export interface CommandRule {
	name: string;
	source: string;
	flags?: string;
}

export interface Policy {
	envAllowedSuffixes: string[];
	credentialHomeDirs: string[];
	credentialHomeFiles: string[];
	credentialExtensions: string[];
	credentialDirNames: string[];
	protectedBranches: string[];
	rmFlag: string;
	rmDangerousTarget: string;
	commandRules: CommandRule[];
	secretPatterns: SecretPattern[];
	maxScanChars: number;
	rotateSentence: string;
}

export const policy: Policy = {
	envAllowedSuffixes: ["example", "sample", "template", "dist", "defaults", "vault"],
	credentialHomeDirs: [".ssh", ".aws", ".gnupg", ".kube"],
	credentialHomeFiles: [".npmrc"],
	credentialExtensions: [".pem", ".key"],
	credentialDirNames: ["secrets"],
	protectedBranches: ["main", "master", "production", "release/*"],
	rmFlag: String.raw`^(?:-[a-zA-Z]*[rRf][a-zA-Z]*|--recursive|--force)$`,
	// Matched after normalization: quotes stripped, $HOME and the literal home path
	// rewritten to "~", trailing slashes removed.
	rmDangerousTarget: String.raw`^(?:/|/\*|/[^/*]+|~|~/\*|~/[^/*]+)$`,
	commandRules: [
		{
			name: "pipe-to-shell",
			source: String.raw`\b(?:curl|wget)\b[^|]*\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b|curl.*-o\s*/tmp.*&&.*bash`,
			flags: "i",
		},
		{
			name: "data exfiltration host",
			source: String.raw`\b(?:curl|wget|nc|ncat)\b.*\b(?:ngrok|burp|requestbin|pipedream|webhook\.site|hookbin|canarytokens)\b`,
			flags: "i",
		},
		{
			name: "permission escalation flag",
			source: String.raw`--dangerously-skip-permissions|--bypass-permissions`,
			flags: "i",
		},
	],
	secretPatterns: [
		{ name: "AWS access key ID", source: String.raw`\bAKIA[0-9A-Z]{16}\b`, mode: "block" },
		{
			name: "GitHub token (PAT / OAuth / server-to-server / user / refresh)",
			source: String.raw`\bgh[pousr]_[A-Za-z0-9_]{36,}\b`,
			mode: "block",
		},
		{ name: "Anthropic API key", source: String.raw`\bsk-ant-[A-Za-z0-9\-_]{50,}\b`, mode: "block" },
		{ name: "OpenAI API key", source: String.raw`\bsk-(proj-)?[A-Za-z0-9\-_]{40,}\b`, mode: "block" },
		{ name: "Google API key", source: String.raw`\bAIza[0-9A-Za-z\-_]{35}\b`, mode: "block" },
		{ name: "Slack token", source: String.raw`\bxox[abprs]-[A-Za-z0-9\-]{10,}\b`, mode: "block" },
		{ name: "Stripe key", source: String.raw`\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{24,}\b`, mode: "block" },
		{ name: "1Password service account token", source: String.raw`\bops_[A-Za-z0-9+/=]{40,}\b`, mode: "block" },
		{
			name: "PEM private-key block header",
			source: String.raw`-----BEGIN\s+(RSA|DSA|EC|OPENSSH|PGP|ENCRYPTED|PRIVATE)(\s+PRIVATE)?\s+KEY-----`,
			mode: "block",
		},
		// Warn only: SHA-256 digests (Docker @sha256:, lockfile hashes) look the same.
		{
			name: "Hex private key (64 hex chars)",
			source: String.raw`(?<![a-fA-F0-9])(0x)?[a-fA-F0-9]{64}(?![a-fA-F0-9])`,
			mode: "warn",
		},
		// Warn only: too many config reads look like assignments.
		{
			name: "Secret-like variable assignment",
			source: String.raw`\b(api[_-]?key|api[_-]?secret|auth[_-]?token|access[_-]?token|secret[_-]?key|private[_-]?key|passphrase|mnemonic|seed[_-]?phrase)\s*[=:]\s*["` + "`" + String.raw`']?[A-Za-z0-9+/=_\-]{16,}["` + "`" + String.raw`']?`,
			flags: "i",
			mode: "warn",
		},
	],
	maxScanChars: 1_000_000,
	rotateSentence: "If this was a real key, rotate it now.",
};
