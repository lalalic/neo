#!/usr/bin/env node
import { connect } from "@nats-io/transport-node";

const [, , command, subject, payload] = process.argv;
const servers = process.env.NEO_NATS_URL || "nats://127.0.0.1:4222";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function usage() {
  console.error("usage: neo-nats.mjs ping | pub <subject> <payload> | sub <subject>");
  process.exit(2);
}

if (!command) usage();

const nc = await connect({ servers, name: `neo-nats-${command}` });

try {
  if (command === "ping") {
    await nc.flush();
    console.log(`ok ${nc.getServer()}`);
  } else if (command === "pub") {
    if (!subject || payload === undefined) usage();
    nc.publish(subject, encoder.encode(payload));
    await nc.flush();
    console.log(`published ${subject}`);
  } else if (command === "sub") {
    if (!subject) usage();
    const sub = nc.subscribe(subject);
    for await (const message of sub) {
      process.stdout.write(`${decoder.decode(message.data)}\n`);
    }
  } else {
    usage();
  }
} finally {
  if (command !== "sub") await nc.close();
}
