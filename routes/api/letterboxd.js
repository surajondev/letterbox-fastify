// routes/api/letterboxd.js
const puppeteer = require("puppeteer");
const cheerio = require("cheerio");

// In-memory storage for scraping jobs (replace with database in production)
const scrapingJobs = new Map();

// Define schema for the Letterboxd API
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

async function startScraping(username, jobId) {
  let browser;
  const job = scrapingJobs.get(jobId);

  try {
    job.status = "in-progress";
    const filmsUrl = `https://letterboxd.com/${username}/films/by/rated-date/`;

    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    );

    // Visit the first page to determine total pages
    await page.goto(filmsUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector("ul.poster-list", { timeout: 10000 });

    let html = await page.content();
    let $ = cheerio.load(html);
    let totalPages = 1;

    const pageItems = $(".paginate-pages li a");
    if (pageItems.length) {
      const lastPageText = pageItems.last().text().trim();
      const parsedPage = parseInt(lastPageText);
      if (!isNaN(parsedPage)) totalPages = parsedPage;
    }

    job.totalPages = totalPages;

    // Loop through all pages
    for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
      const pageUrl =
        currentPage === 1 ? filmsUrl : `${filmsUrl}page/${currentPage}/`;

      await page.goto(pageUrl, {
        waitUntil: "networkidle2",
        timeout: 60000,
      });

      await page.waitForSelector("ul.poster-list", { timeout: 10000 });

      const filmListHTML = await page.$eval(
        "ul.poster-list",
        (el) => el.outerHTML
      );

      $ = cheerio.load(filmListHTML);

      $("li.poster-container").each((index, el) => {
        const $el = $(el);
        const $poster = $el.find("[data-film-name]");

        const titleAttr = $poster.attr("data-film-name");
        const href = $poster.attr("data-film-link");
        const ratingText = $el.find(".rating").text().trim();
        const fullTitle = $el.find("a.frame").attr("data-original-title");
        const yearMatch = fullTitle?.match(/\((\d{4})\)/);
        const year = yearMatch ? yearMatch[1] : null;

        if (!titleAttr || !href) {
          console.log(`Skipping film at index ${index} on page ${currentPage}`);
          return;
        }

        let rating = "0";
        if (ratingText) {
          const stars = (ratingText.match(/★/g) || []).length;
          const halfStar = ratingText.includes("½") ? 0.5 : 0;
          rating = (stars + halfStar).toString();
        }

        const filmData = {
          Name: titleAttr.replace(/\(\d{4}\)$/, "").trim(),
          Year: year,
          "Letterboxd URI": `https://letterboxd.com${href}`,
          Rating: Number(rating),
        };

        job.data.push(filmData);
      });

      job.progress = currentPage / totalPages;

      // Throttle requests
      await new Promise((res) => setTimeout(res, 1000));
    }

    job.status = "completed";
  } catch (error) {
    job.status = "failed";
    job.error = error.message;
    console.error("Error scraping Letterboxd:", error);
  } finally {
    if (browser) await browser.close();

    // Clean up after some time (1 hour)
    setTimeout(() => {
      scrapingJobs.delete(jobId);
    }, 3600000);
  }
}

module.exports = async function (fastify, opts) {
  // Endpoint to start scraping
  fastify.post("/", { schema: startScrapingSchema }, async (request, reply) => {
    try {
      const { username } = request.body;

      if (!username) {
        return reply.code(400).send({
          message: "Username is required.",
        });
      }

      // Create a new job
      const jobId = `job_${Date.now()}`;
      scrapingJobs.set(jobId, {
        status: "pending",
        data: [],
        progress: 0,
        totalPages: 1,
      });

      // Start scraping in the background
      startScraping(username, jobId);

      return {
        jobId,
        status: "pending",
        message: "Scraping started",
      };
    } catch (error) {
      request.log.error(error);
      return reply.code(500).send({
        message: "Failed to initiate scraping",
        error: error.message,
        status: "error",
      });
    }
  });

  // Endpoint to check scraping status
  fastify.get("/", { schema: getStatusSchema }, async (request, reply) => {
    const jobId = request.query.jobId;

    if (!jobId || !scrapingJobs.has(jobId)) {
      return reply.code(400).send({
        message: "Invalid job ID",
      });
    }

    const job = scrapingJobs.get(jobId);

    return {
      status: job.status,
      progress: job.progress,
      totalPages: job.totalPages,
      data: job.status === "completed" ? job.data : undefined,
      error: job.error,
    };
  });
};
