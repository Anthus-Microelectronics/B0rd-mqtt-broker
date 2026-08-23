# b0rd-mqtt-broker

Public AWS CDK stack for a **Mosquitto MQTT broker** with Let's Encrypt TLS on port
**8883** and username/password authentication. B0RD signs, host CLIs, and agent
hooks publish the same EventSet JSON over MQTT as they do over HTTP and USB.

This broker is **general Event transport infrastructure** — not tied to the agent
monitoring app. Agent hooks, MIDI bridges, and desk automation can all share one
broker.

## What it provisions

| Resource | Purpose |
| --- | --- |
| EC2 `t3.micro` (Ubuntu 22.04) | Mosquitto + certbot |
| Elastic IP | Stable public address |
| Route53 A record | `mqtt.example.com` → EIP |
| Secrets Manager | Auto-generated broker password |
| Security group | TCP 80 (ACME), 8883 (MQTT TLS) |

Firmware and host clients use **username/password + ISRG Root X1** (Let's Encrypt).
This is **not** AWS IoT Core device-certificate auth.

## Prerequisites

- AWS account with credentials configured (`aws sts get-caller-identity`)
- A **public Route53 hosted zone** for your domain
- Node.js 20+

## Deploy

```bash
git clone https://github.com/Anthus-Microelectronics/b0rd-mqtt-broker.git
cd b0rd-mqtt-broker
npm ci
npx cdk deploy \
  -c hostedZoneId=Z0123456789ABCDEFGHIJ \
  -c hostedZoneName=example.com \
  -c domainName=mqtt.example.com \
  -c certbotEmail=ops@example.com \
  -c brokerUsername=b0rd-desk \
  -c topicPrefix=b0rd
```

Optional context keys:

| Key | Default | Meaning |
| --- | --- | --- |
| `brokerUsername` | `b0rd-desk` | Mosquitto ACL user |
| `topicPrefix` | `b0rd` | ACL `readwrite {prefix}/#` |
| `passwordSecretName` | `{topicPrefix}/mqtt/broker-password` | Secrets Manager name |

First boot runs certbot (DNS-01 via Route53, HTTP-01 fallback) and starts
Mosquitto. Wait a few minutes after `CREATE_COMPLETE` before publishing.

### Read the password

```bash
aws secretsmanager get-secret-value \
  --secret-id b0rd/mqtt/broker-password \
  --query SecretString --output text
```

(Replace the secret id if you overrode `passwordSecretName`.)

## Configure a B0RD sign

```text
settings set mqtt.enabled true
settings set mqtt.host mqtt.example.com
settings set mqtt.port 8883
settings set mqtt.tls true
settings set mqtt.username b0rd-desk
settings set mqtt.password <secret>
settings save
```

Confirm: `settings get proc.mqtt.connected` → `true`.

## Configure agent hooks (Mac)

Agent hooks read YAML from `~/.config/b0rd-hooks/config.yaml`. See
[b0rd-scene-agent-monitor](https://github.com/Anthus-Microelectronics/b0rd-scene-agent-monitor)
and [B0rd-hooks](https://github.com/Anthus-Microelectronics/B0rd-hooks).

```yaml
mqtt:
  host: mqtt.example.com
  port: 8883
  tls: true
  username: b0rd-desk
  password_file: ~/.config/b0rd-hooks/mqtt-password
  broadcast: true
  topic_prefix: b0rd
```

Store the broker password once in `~/.config/b0rd-hooks/mqtt-password` — no AWS
login required at hook time.

## Publish smoke test

```bash
export B0RD_MQTT_PASSWORD="$(aws secretsmanager get-secret-value \
  --secret-id b0rd/mqtt/broker-password --query SecretString --output text)"

mosquitto_pub -h mqtt.example.com -p 8883 --tls-version tlsv1.2 \
  -u b0rd-desk -P "$B0RD_MQTT_PASSWORD" -q 1 \
  -t b0rd/v1/event \
  -m '{"name":"notify.show","source":"agent","title":"MQTT","message":"ok","duration_ms":8000}'
```

Broadcast topic `b0rd/v1/event` reaches every subscribed sign. Unicast:
`b0rd/v1/B0RD-2308/event`.

## Topics

| Kind | Topic |
| --- | --- |
| Broadcast | `{topicPrefix}/v1/event` |
| Unicast | `{topicPrefix}/v1/{device_id}/event` |

Default `topicPrefix` is `b0rd` (firmware setting `mqtt.topic_prefix`).

## Anthus desk reference deployment

The Anthus test broker at `mqtt.b0rd.info` was originally deployed from the B0RD
firmware repo; new deployments should use **this repository**:

```bash
npx cdk deploy \
  -c hostedZoneId=Z04286611KCWQ44ML6P4B \
  -c hostedZoneName=b0rd.info \
  -c domainName=mqtt.b0rd.info \
  -c certbotEmail=ops@b0rd.info \
  -c brokerUsername=b0rd-desk \
  -c passwordSecretName=b0rd/mqtt-test/broker-password
```

## Related repos

| Repo | Role |
| --- | --- |
| [B0RD](https://github.com/Anthus-Microelectronics/B0RD) | Firmware MQTT client + operator docs |
| [b0rd-scene-agent-monitor](https://github.com/Anthus-Microelectronics/b0rd-scene-agent-monitor) | Host hook companion |
| [B0rd-hooks](https://github.com/Anthus-Microelectronics/B0rd-hooks) | IDE hook installer |

## License

MIT — see [LICENSE](LICENSE).
