// Single durable episode Task; graph stages are agents, not sibling Jobs.
export const EPISODE_STAGES = Object.freeze([
  'vlog-route-researcher',
  'vlog-location-researcher',
  'vlog-editor',
  'vlog-music-supervisor',
  'vlog-producer',
]);
export const VLOG_EPISODE_AGENT_GRAPH = [
  'flowchart LR',
  ...EPISODE_STAGES.slice(0,-1).map((name,index)=>
    `  n${index}[agent:${name}] --> n${index+1}[agent:${EPISODE_STAGES[index+1]}]`),
].join('\n');
