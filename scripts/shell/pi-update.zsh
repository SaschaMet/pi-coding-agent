# pi only updates project packages (.pi/npm) for the cwd it runs in, so
# always update from this repo: one run then covers global and project.
PI_CODING_AGENT_REPO="${${(%):-%x}:A:h:h:h}"

piupdate() {
  local pi_bin="${PI_REAL_BIN:-$(npm prefix -g)/bin/pi}"
  (cd "$PI_CODING_AGENT_REPO" && "$pi_bin" update "$@")
}
