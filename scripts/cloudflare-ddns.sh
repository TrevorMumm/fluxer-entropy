#!/usr/bin/env bash
# Updates Cloudflare DNS A record for throat.chat when WAN IP changes.
# Requires: CF_API_TOKEN and CF_ZONE_ID environment variables (or sourced from env file).

set -euo pipefail

DOMAINS=("throat.chat" "*.throat.chat")
ENV_FILE="/home/influx/.cloudflare-ddns.env"
IP_CACHE="/tmp/.cloudflare-ddns-last-ip"

if [[ -f "$ENV_FILE" ]]; then
    # shellcheck source=/dev/null
    source "$ENV_FILE"
fi

if [[ -z "${CF_API_TOKEN:-}" || -z "${CF_ZONE_ID:-}" ]]; then
    echo "ERROR: CF_API_TOKEN and CF_ZONE_ID must be set" >&2
    exit 1
fi

# Get current public IP (avoid 1.1.1.1/cdn-cgi/trace — returns wrong IP if WARP is active)
CURRENT_IP=$(curl -sf4 https://api.ipify.org || curl -sf4 https://ifconfig.me || curl -sf4 https://icanhazip.com)
if [[ -z "$CURRENT_IP" ]]; then
    echo "ERROR: Failed to detect public IP" >&2
    exit 1
fi

# Check if IP changed
if [[ -f "$IP_CACHE" ]] && [[ "$(cat "$IP_CACHE")" == "$CURRENT_IP" ]]; then
    exit 0
fi

update_record() {
    local domain="$1"
    local record_type="A"

    # Wildcard records need type A just like regular records
    RECORD_ID=$(curl -sf "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records?type=${record_type}&name=${domain}" \
        -H "Authorization: Bearer ${CF_API_TOKEN}" \
        -H "Content-Type: application/json" | jq -r '.result[0].id // empty')

    if [[ -z "$RECORD_ID" ]]; then
        RESPONSE=$(curl -sf "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
            -X POST \
            -H "Authorization: Bearer ${CF_API_TOKEN}" \
            -H "Content-Type: application/json" \
            --data "{\"type\":\"${record_type}\",\"name\":\"${domain}\",\"content\":\"${CURRENT_IP}\",\"ttl\":60,\"proxied\":false}")
    else
        RESPONSE=$(curl -sf "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records/${RECORD_ID}" \
            -X PUT \
            -H "Authorization: Bearer ${CF_API_TOKEN}" \
            -H "Content-Type: application/json" \
            --data "{\"type\":\"${record_type}\",\"name\":\"${domain}\",\"content\":\"${CURRENT_IP}\",\"ttl\":60,\"proxied\":false}")
    fi

    SUCCESS=$(echo "$RESPONSE" | jq -r '.success')
    if [[ "$SUCCESS" == "true" ]]; then
        echo "$(date): Updated ${domain} -> ${CURRENT_IP}"
    else
        echo "ERROR: Failed to update ${domain}:" >&2
        echo "$RESPONSE" | jq . >&2
        return 1
    fi
}

FAILED=0
for DOMAIN in "${DOMAINS[@]}"; do
    update_record "$DOMAIN" || FAILED=1
done

if [[ "$FAILED" -eq 0 ]]; then
    echo "$CURRENT_IP" > "$IP_CACHE"
else
    exit 1
fi
