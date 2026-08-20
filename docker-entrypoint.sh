#!/bin/sh
set -eu

MODE="${MEDUSA_WORKER_MODE:-shared}"
MEDUSA="./node_modules/.bin/medusa"

log() { echo "[medusa-railway] $*"; }

log "boot: worker_mode=${MODE} port=${PORT:-9000} node=$(node -v)"

if [ "${MODE}" = "worker" ]; then
  node ./bin/wait-for-schema.js
else
  log "applying database migrations and migration scripts"
  attempt=1
  max="${MIGRATE_MAX_ATTEMPTS:-20}"
  until "${MEDUSA}" db:migrate; do
    if [ "${attempt}" -ge "${max}" ]; then
      log "ERROR: db:migrate failed ${attempt} times — giving up"
      exit 1
    fi
    log "db:migrate attempt ${attempt}/${max} failed — retrying in 10s"
    attempt=$((attempt + 1))
    sleep 10
  done
  log "migrations complete"

  if [ -n "${MEDUSA_ADMIN_EMAIL:-}" ] && [ -n "${MEDUSA_ADMIN_PASSWORD:-}" ]; then
    log "ensuring the admin user ${MEDUSA_ADMIN_EMAIL} exists"
    if out=$("${MEDUSA}" user -e "${MEDUSA_ADMIN_EMAIL}" -p "${MEDUSA_ADMIN_PASSWORD}" 2>&1); then
      log "admin user ${MEDUSA_ADMIN_EMAIL} created"
    else
      case "${out}" in
        *"already exists"*|*"duplicate"*|*"unique"*|*"Identity with email"*)
          log "admin user ${MEDUSA_ADMIN_EMAIL} already exists — leaving it untouched"
          ;;
        *)
          log "WARN: could not create the admin user:"
          printf '%s\n' "${out}" | head -n 5 | sed "s|${MEDUSA_ADMIN_PASSWORD}|***|g"
          ;;
      esac
    fi
  else
    log "MEDUSA_ADMIN_EMAIL / MEDUSA_ADMIN_PASSWORD unset — no admin user bootstrapped"
  fi
fi

# The app never reads it, and Medusa logs nothing containing it — but there is no
# reason for the running process to carry the bootstrap password at all.
unset MEDUSA_ADMIN_PASSWORD

log "starting Medusa in ${MODE} mode"
exec "${MEDUSA}" start
