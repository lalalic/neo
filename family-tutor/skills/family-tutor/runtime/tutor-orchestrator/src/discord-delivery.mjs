import { randomUUID } from 'node:crypto';

export class DiscordDeliveryRegistry {
  constructor({ ttlMs = 20 * 60 * 1000, now = Date.now } = {}) {
    this.ttlMs = ttlMs;
    this.now = now;
    this.pending = new Map();
  }

  register(reply) {
    for (const [id, entry] of this.pending) {
      if (this.now() > entry.expires) this.pending.delete(id);
    }
    if (typeof reply !== 'function') throw new Error('reply callback required');
    const correlationId = randomUUID();
    this.pending.set(correlationId, { reply, expires: this.now() + this.ttlMs, promise: null });
    return correlationId;
  }

  async deliver({ correlationId, text }) {
    const entry = this.pending.get(correlationId);
    if (!entry || this.now() > entry.expires) {
      this.pending.delete(correlationId);
      throw new Error('Unknown or expired Discord correlation');
    }
    if (typeof text !== 'string' || !text.trim() || text.length > 18000) {
      throw new Error('Discord reply text must contain 1–18000 characters');
    }
    if (!entry.promise) {
      entry.promise = Promise.resolve().then(() => entry.reply(text.trim()))
        .then(message => ({ ok: true, correlationId, messageId: String(message?.id || message?.messageId || '') }))
        .then(result => {
          if (!result.messageId) throw new Error('Discord provider did not return a message ID');
          return result;
        }).catch(error => {
          entry.promise = null; // failed sends can be retried
          throw error;
        });
    }
    return entry.promise;
  }
}
