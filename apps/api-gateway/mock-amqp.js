"use strict";

const Module = require("module");
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
  if (id === "amqplib") {
    return {
      connect: async () => ({
        connection: {},
        createConfirmChannel: async () => ({
          assertExchange: async () => {},
          assertQueue: async () => ({ queue: "mock-queue" }),
          bindQueue: async () => {},
          consume: async () => {},
          prefetch: async () => {},
          publish: () => true,
          on: () => {},
          close: async () => {},
        }),
        on: () => {},
        close: async () => {},
      }),
    };
  }
  return originalRequire.apply(this, arguments);
};
