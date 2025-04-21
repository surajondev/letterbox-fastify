// routes/api/index.js

const letterboxd = require("./letterboxd");
const model1 = require("./model1");
const model2 = require("./model2");
const model3 = require("./model3");

module.exports = async function (fastify, opts) {
  fastify.register(letterboxd, { prefix: "/letterboxd" });
  fastify.register(model1, { prefix: "/model1" });
  fastify.register(model2, { prefix: "/model2" });
  fastify.register(model3, { prefix: "/model3" });

  // Root API route
  fastify.get("/", async (request, reply) => {
    return { message: "API is running" };
  });
};
