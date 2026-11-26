#!/usr/bin/env node
import {createEventsBusCore} from '../core/events-core.mjs';
const [,,type,dataJson='{}']=process.argv;
const source=process.env.EVENTS_BUS_EVENT_SOURCE;
if(!type||!source){console.error('usage: EVENTS_BUS_EVENT_SOURCE=source emit.mjs <type> [data-json]');process.exit(2)}
let bus;
try {
  bus=await createEventsBusCore({name:'events-bus-emit'});
  const receipt=await bus.publish({type,source,data:JSON.parse(dataJson)});
  process.stdout.write(JSON.stringify(receipt.event)+'\n');
} catch(error){console.error(error.message);process.exitCode=1}
finally{await bus?.close()}
