# Sourced by the shell profile and by engine-offline. Every remote endpoint points at a closed local port.
_imp_local="${IMPECCABLE_LOCAL_DIR:-$HOME/.pi/agent/skill-library/impeccable/local}"
export IMPECCABLE_BIN="$_imp_local/engine-offline"
export IMPECCABLE_BROWSER="$_imp_local/chrome-offline"
export IMPECCABLE_API_URL=http://127.0.0.1:9/api
export IMPECCABLE_UPDATE_HOST=http://127.0.0.1:9
export IMPECCABLE_CARD_BASE=http://127.0.0.1:9/cards
export IMPECCABLE_DOWNLOAD_BASE=http://127.0.0.1:9
export IMPECCABLE_NO_UPDATE_CHECK=1
export IMPECCABLE_NO_TELEMETRY=1
export DO_NOT_TRACK=1
export IMPECCABLE_LIVE_COPY_AGENT=off
unset _imp_local
