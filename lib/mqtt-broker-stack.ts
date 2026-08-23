import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as route53 from "aws-cdk-lib/aws-route53";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export interface MqttBrokerStackProps extends cdk.StackProps {
  /** Public hostname for the broker (DNS A → Elastic IP). */
  domainName: string;
  /** Existing public hosted zone id for the apex. */
  hostedZoneId: string;
  /** Apex zone name (must match hostedZoneId). */
  hostedZoneName: string;
  /** MQTT ACL username (password lives in Secrets Manager). */
  brokerUsername?: string;
  /** Secrets Manager secret name for the broker password. */
  passwordSecretName?: string;
  /** Let's Encrypt registration / expiry contact. */
  certbotEmail: string;
  /** Topic prefix for Mosquitto ACL (default `b0rd` → read/write `b0rd/#`). */
  topicPrefix?: string;
}

/**
 * Mosquitto MQTT broker on Ubuntu EC2 with Let's Encrypt TLS on 8883 and
 * username/password auth — matches B0rd firmware `mqtt.*` (ISRG Root X1).
 *
 * Not AWS IoT Core device-cert auth.
 */
export class MqttBrokerStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: MqttBrokerStackProps) {
    super(scope, id, props);

    const zoneName = props.hostedZoneName;
    const domainName = props.domainName;
    const username = props.brokerUsername ?? "b0rd-desk";
    const topicPrefix = props.topicPrefix ?? "b0rd";
    const secretName =
      props.passwordSecretName ?? `${topicPrefix}/mqtt/broker-password`;
    const recordName = domainName.endsWith(`.${zoneName}`)
      ? domainName.slice(0, -(zoneName.length + 1))
      : domainName;

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, "Zone", {
      hostedZoneId: props.hostedZoneId,
      zoneName,
    });

    const secret = new secretsmanager.Secret(this, "BrokerPassword", {
      secretName,
      description: `MQTT broker password for ${domainName}`,
      generateSecretString: {
        excludePunctuation: true,
        passwordLength: 32,
        includeSpace: false,
      },
    });

    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    const sg = new ec2.SecurityGroup(this, "BrokerSg", {
      vpc,
      description: `Mosquitto MQTT broker (${domainName})`,
      allowAllOutbound: true,
    });
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), "ACME HTTP-01");
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(8883), "MQTT TLS");

    const role = new iam.Role(this, "InstanceRole", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      description: `MQTT broker instance (${domainName})`,
    });
    secret.grantRead(role);
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: [
          "route53:GetChange",
          "route53:ChangeResourceRecordSets",
          "route53:ListHostedZones",
          "route53:ListHostedZonesByName",
          "route53:ListResourceRecordSets",
        ],
        resources: ["*"],
      }),
    );

    const eip = new ec2.CfnEIP(this, "Eip", {
      domain: "vpc",
      tags: [{ key: "Name", value: `${topicPrefix}-mqtt-broker` }],
    });

    const machineImage = ec2.MachineImage.fromSsmParameter(
      "/aws/service/canonical/ubuntu/server/22.04/stable/current/amd64/hvm/ebs-gp2/ami-id",
      { os: ec2.OperatingSystemType.LINUX },
    );

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      "set -euxo pipefail",
      "export DEBIAN_FRONTEND=noninteractive",
      "apt-get update -y",
      "apt-get install -y mosquitto mosquitto-clients certbot python3-certbot-dns-route53 awscli jq",
      `DOMAIN='${domainName}'`,
      `USERNAME='${username}'`,
      `TOPIC_PREFIX='${topicPrefix}'`,
      `CERTBOT_EMAIL='${props.certbotEmail}'`,
      `SECRET_ARN='${secret.secretArn}'`,
      `REGION='${this.region}'`,
      "set +x",
      'PASSWORD="$(aws secretsmanager get-secret-value --secret-id "$SECRET_ARN" --region "$REGION" --query SecretString --output text)"',
      "set -x",
      "install -d -m 0755 /etc/mosquitto",
      "touch /etc/mosquitto/passwd",
      'mosquitto_passwd -b /etc/mosquitto/passwd "$USERNAME" "$PASSWORD"',
      "unset PASSWORD",
      "chown mosquitto:mosquitto /etc/mosquitto/passwd",
      "chmod 640 /etc/mosquitto/passwd",
      'printf "user %s\\ntopic readwrite %s/#\\n" "$USERNAME" "$TOPIC_PREFIX" >/etc/mosquitto/acl.conf',
      "systemctl stop mosquitto || true",
      'if ! certbot certonly --non-interactive --agree-tos --email "$CERTBOT_EMAIL" --dns-route53 -d "$DOMAIN"; then',
      '  certbot certonly --non-interactive --agree-tos --email "$CERTBOT_EMAIL" --standalone -d "$DOMAIN"',
      "fi",
      "install -d -o mosquitto -g mosquitto -m 0750 /etc/mosquitto/certs",
      'cp "/etc/letsencrypt/live/$DOMAIN/chain.pem" /etc/mosquitto/certs/chain.pem',
      'cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" /etc/mosquitto/certs/fullchain.pem',
      'cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem" /etc/mosquitto/certs/privkey.pem',
      "chown -R mosquitto:mosquitto /etc/mosquitto/certs",
      "chmod 640 /etc/mosquitto/certs/*",
      "cat >/etc/mosquitto/conf.d/b0rd.conf <<'EOF'",
      "listener 8883",
      "protocol mqtt",
      "cafile /etc/mosquitto/certs/chain.pem",
      "certfile /etc/mosquitto/certs/fullchain.pem",
      "keyfile /etc/mosquitto/certs/privkey.pem",
      "allow_anonymous false",
      "password_file /etc/mosquitto/passwd",
      "acl_file /etc/mosquitto/acl.conf",
      "require_certificate false",
      "EOF",
      "if [ -f /etc/mosquitto/mosquitto.conf ]; then sed -i 's/^listener 1883/# listener 1883/' /etc/mosquitto/mosquitto.conf || true; fi",
      "systemctl enable mosquitto",
      "systemctl restart mosquitto",
      "install -d /etc/letsencrypt/renewal-hooks/deploy",
      "cat >/etc/letsencrypt/renewal-hooks/deploy/reload-mosquitto.sh <<'EOF'",
      "#!/bin/bash",
      "set -euo pipefail",
      `DOMAIN='${domainName}'`,
      'cp "/etc/letsencrypt/live/$DOMAIN/chain.pem" /etc/mosquitto/certs/chain.pem',
      'cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" /etc/mosquitto/certs/fullchain.pem',
      'cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem" /etc/mosquitto/certs/privkey.pem',
      "chown -R mosquitto:mosquitto /etc/mosquitto/certs",
      "systemctl reload mosquitto || systemctl restart mosquitto",
      "EOF",
      "chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-mosquitto.sh",
    );

    const instance = new ec2.Instance(this, "Broker", {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),
      machineImage,
      securityGroup: sg,
      role,
      userData,
      userDataCausesReplacement: true,
    });

    new ec2.CfnEIPAssociation(this, "EipAssoc", {
      allocationId: eip.attrAllocationId,
      instanceId: instance.instanceId,
    });

    new route53.ARecord(this, "Dns", {
      zone,
      recordName,
      target: route53.RecordTarget.fromIpAddresses(eip.ref),
      ttl: cdk.Duration.minutes(5),
      comment: `MQTT broker ${domainName}`,
    });

    new cdk.CfnOutput(this, "MqttHost", {
      value: domainName,
      description: "Broker hostname (TLS)",
    });
    new cdk.CfnOutput(this, "MqttPort", {
      value: "8883",
    });
    new cdk.CfnOutput(this, "MqttUsername", {
      value: username,
    });
    new cdk.CfnOutput(this, "MqttPasswordSecretArn", {
      value: secret.secretArn,
      description: "Secrets Manager ARN for broker password",
    });
    new cdk.CfnOutput(this, "MqttTopicPrefix", {
      value: topicPrefix,
      description: "ACL / firmware topic prefix",
    });
    new cdk.CfnOutput(this, "MqttElasticIp", {
      value: eip.ref,
    });
    new cdk.CfnOutput(this, "DeviceSettingsHint", {
      value: `mqtt.enabled=true mqtt.host=${domainName} mqtt.port=8883 mqtt.tls=true mqtt.username=${username} mqtt.password=<secret>`,
      description: "USB/SoftAP settings to subscribe a B0rd sign",
    });
  }
}
