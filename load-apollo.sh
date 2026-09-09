#!/bin/bash
data=$(curl -s "$apollo_domain/configfiles/json/$APP_NAME/default/application/")

keys=$(echo "$data" | jq --raw-output '. | keys[]')
for key in $keys; do
  value=$(echo "$data" | jq --raw-output .$key)
  export $key=$value
done

export NODE_ENV=production

echo "Running database migrations..."
pnpm run db:deploy

exec "$@"
