#!/usr/bin/env bash
# Nettoie uniquement les cinq conteneurs temporaires de LobeHub, une fois
# leur execution reussie et les cinq services permanents healthy.
# Aucun volume, image ou donnees d'application n'est supprime.
set -euo pipefail

PROJECT="lobehub_appstore-ajilis"
APP_URN="lobehub:appstore-ajilis"
PERMANENT=(lobehub postgresql redis rustfs lobehub-s3-gateway)
INITIALIZERS=(lobehub-init rustfs-init lobehub-admin-precheck lobehub-admin-register lobehub-admin-promote)

log() { printf '[lobehub-init-cleanup] %s\n' "$*"; }

if ! command -v docker >/dev/null 2>&1; then
  log "Docker indisponible : aucune suppression."
  exit 0
fi

# Ne jamais supprimer un conteneur homonyme hors du projet Compose exact.
find_id() {
  local service="$1" ids
  ids="$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=$service")" || return 2
  if [[ -z "$ids" ]]; then return 1; fi
  if [[ "$ids" == *$'\n'* ]]; then
    log "Plusieurs conteneurs pour $service : aucune suppression."
    return 2
  fi
  printf '%s\n' "$ids"
}

# Exige que les identifiants Compose et Runtipi correspondent exactement.
inspect_id() {
  local id="$1" service="$2" record
  record="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}|{{index .Config.Labels "com.docker.compose.service"}}|{{index .Config.Labels "runtipi.appurn"}}|{{.State.Status}}|{{.State.ExitCode}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id")" || return 1
  local project_label service_label urn_label
  IFS='|' read -r project_label service_label urn_label STATUS EXIT_CODE HEALTH <<< "$record"
  [[ "$project_label" == "$PROJECT" && "$service_label" == "$service" && "$urn_label" == "$APP_URN" ]]
}

# 1. Tous les services permanents doivent etre effectivement sains.
for service in "${PERMANENT[@]}"; do
  if ! id="$(find_id "$service")"; then
    log "$service absent ou ambigu : initialisation pas encore terminee."
    exit 0
  fi
  if ! inspect_id "$id" "$service"; then
    log "$service non verifiable : aucune suppression."
    exit 0
  fi
  if [[ "$STATUS" != "running" || "$HEALTH" != "healthy" ]]; then
    log "$service non sain ($STATUS/$HEALTH) : aucune suppression."
    exit 0
  fi
done

# 2. Chaque initialisateur encore present doit avoir reussi (Exited 0).
init_ids=()
for service in "${INITIALIZERS[@]}"; do
  if ! id="$(find_id "$service")"; then
    # Deja supprime au passage precedent : comportement attendu.
    continue
  fi
  if ! inspect_id "$id" "$service"; then
    log "$service non verifiable : aucune suppression."
    exit 0
  fi
  if [[ "$STATUS" != "exited" || "$EXIT_CODE" != "0" ]]; then
    log "$service non termine avec succes ($STATUS/code $EXIT_CODE) : aucune suppression."
    exit 0
  fi
  init_ids+=("$id")
done

if (( ${#init_ids[@]} == 0 )); then
  exit 0
fi

# 3. Revalider avant l'effacement ; docker rm agit par ID, sans -v ni -f.
# Les services redemarreront leurs etapes init lors du prochain docker compose up.
for id in "${init_ids[@]}"; do
  if ! inspect_id "$id" "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$id")"; then
    log "Identite du conteneur modifiee : aucune suppression supplementaire."
    exit 0
  fi
  if [[ "$STATUS" != "exited" || "$EXIT_CODE" != "0" ]]; then
    log "Etat du conteneur modifie : aucune suppression supplementaire."
    exit 0
  fi
  docker rm "$id" >/dev/null
  log "Conteneur temporaire retire sans supprimer de volume : $id"
done

log "Initialisation terminee : seuls les cinq services permanents sont suivis par Runtipi."
