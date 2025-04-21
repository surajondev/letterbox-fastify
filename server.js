// server.js
// Load environment variables
require("dotenv").config();

const path = require("path");
const fastify = require("fastify")({
  logger: {
    level: process.env.LOG_LEVEL || "info",
    transport: {
      target: "pino-pretty",
      options: {
        translateTime: "HH:MM:ss Z",
        ignore: "pid,hostname",
      },
    },
  },
});

// CORS setup
fastify.register(require("@fastify/cors"), {
  // Configure your CORS settings
  origin: process.env.ALLOWED_ORIGINS?.split(",") || [
    "http://localhost:3000",
    "https://letterboxd.surajon.dev",
  ],
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  credentials: true,
});

// Serve static files
fastify.register(require("@fastify/static"), {
  root: path.join(__dirname, "public"),
  prefix: "/",
});

// Add JSON support
fastify.register(require("@fastify/swagger"), {
  routePrefix: "/documentation",
  swagger: {
    info: {
      title: "API Documentation",
      description: "API Documentation",
      version: "0.1.0",
    },
    host: "localhost",
    schemes: ["http"],
    consumes: ["application/json"],
    produces: ["application/json"],
  },
  exposeRoute: true,
});

// Register routes
fastify.register(require("./routes/api"), {
  prefix: `/api/${process.env.API_VERSION || "v1"}`,
});

// Health check route
fastify.get("/health", async (request, reply) => {
  return { status: "ok" };
});

// Default route to serve the HTML test page
fastify.get("/", async (request, reply) => {
  return reply.sendFile("index.html");
});

// Routes to serve the Model test pages
fastify.get("/model1", async (request, reply) => {
  return reply.sendFile("model1.html");
});

fastify.get("/model2", async (request, reply) => {
  return reply.sendFile("model2.html");
});

fastify.get("/model3", async (request, reply) => {
  return reply.sendFile("model3.html");
});

// Run the server
const start = async () => {
  try {
    await fastify.listen({
      port: process.env.PORT || 8000,
      host: "0.0.0.0", // Listen on all network interfaces
    });
    console.log(`Server listening on ${fastify.server.address().port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
