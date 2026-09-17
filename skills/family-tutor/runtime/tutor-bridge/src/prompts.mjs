export function memoryBlock(memory) {
  return `[LOCAL LEARNER MEMORY — durable context, not a transcript]\n${memory || '(empty)'}\n[/LOCAL LEARNER MEMORY]`;
}

export function bootstrapPrompt(child, message, memory) {
  return `${memoryBlock(memory)}\n\nStudent message:\n${message}`;
}

export function turnPrompt(message) {
  return `Student message:\n${message}`;
}
