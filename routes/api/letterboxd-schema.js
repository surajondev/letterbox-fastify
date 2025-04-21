// routes/api/letterboxd-schema.js
const startScrapingSchema = {
  body: {
    type: "object",
    required: ["username"],
    properties: {
      username: { type: "string", minLength: 1 },
    },
  },
  response: {
    200: {
      type: "object",
      properties: {
        jobId: { type: "string" },
        status: {
          type: "string",
          enum: ["pending", "in-progress", "completed", "failed"],
        },
        message: { type: "string" },
      },
    },
    400: {
      type: "object",
      properties: {
        message: { type: "string" },
      },
    },
    500: {
      type: "object",
      properties: {
        message: { type: "string" },
        error: { type: "string" },
        status: { type: "string" },
      },
    },
  },
};

const getStatusSchema = {
  querystring: {
    type: "object",
    required: ["jobId"],
    properties: {
      jobId: { type: "string", minLength: 1 },
    },
  },
  response: {
    200: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["pending", "in-progress", "completed", "failed"],
        },
        progress: { type: "number" },
        totalPages: { type: "number" },
        data: {
          type: "array",
          items: {
            type: "object",
            properties: {
              Name: { type: "string" },
              Year: { type: ["string", "null"] },
              "Letterboxd URI": { type: "string" },
              Rating: { type: "number" },
            },
          },
        },
        error: { type: ["string", "null"] },
      },
    },
    400: {
      type: "object",
      properties: {
        message: { type: "string" },
      },
    },
  },
};

module.exports = {
  startScrapingSchema,
  getStatusSchema,
};
