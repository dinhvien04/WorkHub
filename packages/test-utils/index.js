"use strict";

/**
 * Mock RabbitMQ amqplib implementation for in-memory messaging tests.
 */
class MockChannel {
  constructor() {
    this.queues = {};
    this.exchanges = {};
    this.bindings = [];
    this.published = [];
    this.consumers = {};
    this.acked = [];
    this.nacked = [];
  }

  async assertQueue(queue, options = {}) {
    this.queues[queue] = { options, messages: [] };
    return { queue, messageCount: 0, consumerCount: 0 };
  }

  async assertExchange(exchange, type, options = {}) {
    this.exchanges[exchange] = { type, options };
    return { exchange };
  }

  async bindQueue(queue, exchange, pattern) {
    this.bindings.push({ queue, exchange, pattern });
  }

  publish(exchange, routingKey, content, options = {}) {
    const payload = JSON.parse(content.toString());
    this.published.push({ exchange, routingKey, payload, options });
    return true;
  }

  async consume(queue, callback, options = {}) {
    const consumerTag = `mock-tag-${Math.random().toString(36).slice(2, 9)}`;
    this.consumers[queue] = { callback, options, consumerTag };
    return { consumerTag };
  }

  ack(message) {
    this.acked.push(message);
  }

  nack(message, allUpTo = false, requeue = true) {
    this.nacked.push({ message, allUpTo, requeue });
  }

  async close() {
    return true;
  }
}

class MockConnection {
  constructor() {
    this.channels = [];
  }

  async createChannel() {
    const channel = new MockChannel();
    this.channels.push(channel);
    return channel;
  }

  async createConfirmChannel() {
    return this.createChannel();
  }

  async close() {
    return true;
  }
}

const mockAmqp = {
  connect: async (_url) => {
    return new MockConnection();
  },
};

module.exports = {
  MockChannel,
  MockConnection,
  mockAmqp,
};
