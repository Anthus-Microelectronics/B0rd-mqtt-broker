#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { MqttBrokerStack } from "../lib/mqtt-broker-stack";

const app = new cdk.App();

const account =
  app.node.tryGetContext("account") ||
  process.env.CDK_DEFAULT_ACCOUNT ||
  "111111111111";
const region =
  app.node.tryGetContext("region") ||
  process.env.CDK_DEFAULT_REGION ||
  "us-east-1";

const hostedZoneId = app.node.tryGetContext("hostedZoneId") as string | undefined;
const hostedZoneName = app.node.tryGetContext("hostedZoneName") as
  | string
  | undefined;
const domainName = app.node.tryGetContext("domainName") as string | undefined;
const certbotEmail = app.node.tryGetContext("certbotEmail") as string | undefined;

if (!hostedZoneId || !hostedZoneName || !domainName || !certbotEmail) {
  throw new Error(
    "Required CDK context: hostedZoneId, hostedZoneName, domainName, certbotEmail",
  );
}

new MqttBrokerStack(app, "MqttBrokerStack", {
  env: { account, region },
  hostedZoneId,
  hostedZoneName,
  domainName,
  certbotEmail,
  brokerUsername:
    (app.node.tryGetContext("brokerUsername") as string | undefined) ||
    "b0rd-desk",
  passwordSecretName: app.node.tryGetContext("passwordSecretName") as
    | string
    | undefined,
  topicPrefix:
    (app.node.tryGetContext("topicPrefix") as string | undefined) || "b0rd",
  description: `Mosquitto MQTT broker (${domainName})`,
});

app.synth();
