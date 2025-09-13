const puppeteer = require("puppeteer");
const cheerio = require("cheerio");

// In-memory storage for scraping jobs
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
        profileData: {
          type: "object",
          properties: {
            displayName: { type: "string" },
            username: { type: "string" },
            avatarUrl: { type: ["string", "null"] },
            location: { type: ["string", "null"] },
            bio: { type: ["string", "null"] },
            stats: {
              type: "object",
              properties: {
                totalFilms: { type: "number" },
                filmsThisYear: { type: "number" },
                following: { type: "number" },
                followers: { type: "number" },
              },
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

// Function to scrape profile data
async function scrapeProfile(page, username) {
  try {
    const profileUrl = `https://letterboxd.com/${username}/`;
    await page.goto(profileUrl, { waitUntil: "networkidle2", timeout: 60000 });

    await page.waitForSelector(".profile-summary", { timeout: 10000 });

    const html = await page.content();
    const $ = cheerio.load(html);

    const displayName = $(".person-display-name .displayname").text().trim();
    const usernameFromTooltip =
      $(".person-display-name .displayname").attr("data-original-title") ||
      username;

    let avatarUrl = $(".profile-avatar .avatar img").attr("src");
    if (avatarUrl) {
      avatarUrl = avatarUrl.replace(
        /\/avtr-\d+-\d+-\d+-\d+-crop/,
        "/avtr-0-1000-0-1000-crop"
      );
    }

    const location =
      $(".profile-metadata .metadatum .label").text().trim() || null;
    const bio = $(".profile-bio .collapsible-text").text().trim() || null;
    const totalFilms =
      parseInt(
        $(".profile-statistic:contains('Films') .value")
          .text()
          .trim()
          .replace(/,/g, "")
      ) || 0;
    const filmsThisYear =
      parseInt(
        $(".profile-statistic:contains('This year') .value")
          .text()
          .trim()
          .replace(/,/g, "")
      ) || 0;
    const following =
      parseInt(
        $(".profile-statistic:contains('Following') .value")
          .text()
          .trim()
          .replace(/,/g, "")
      ) || 0;
    const followers =
      parseInt(
        $(".profile-statistic:contains('Followers') .value")
          .text()
          .trim()
          .replace(/,/g, "")
      ) || 0;

    return {
      displayName,
      username: usernameFromTooltip,
      avatarUrl,
      location,
      bio,
      stats: {
        totalFilms,
        filmsThisYear,
        following,
        followers,
      },
    };
  } catch (error) {
    console.error("Error scraping profile:", error);
    return {
      displayName: username,
      username,
      avatarUrl: null,
      location: null,
      bio: null,
      stats: {
        totalFilms: 0,
        filmsThisYear: 0,
        following: 0,
        followers: 0,
      },
    };
  }
}

async function startScraping(username, jobId) {
  console.log(`[Job ${jobId}] Scraping process started for user: ${username}`);
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

    job.profileData = await scrapeProfile(page, username);

    await page.goto(filmsUrl, { waitUntil: "networkidle2", timeout: 60000 });
    // UPDATE: Wait for the new container selector
    await page.waitForSelector("ul.grid", { timeout: 10000 }).catch(() => {
      console.log(
        `[Job ${jobId}] Film grid ('ul.grid') not found - user may not have any rated films`
      );
    });

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
    console.log(`[Job ${jobId}] Found ${totalPages} page(s) to scrape.`);

    for (let currentPage = 1; currentPage <= totalPages; currentPage++) {
      if (currentPage > 1) {
        const pageUrl = `${filmsUrl}page/${currentPage}/`;
        await page.goto(pageUrl, {
          waitUntil: "networkidle2",
          timeout: 60000,
        });
      }

      // UPDATE: Check for the new container 'ul.grid'
      const posterListExists = await page.evaluate(() => {
        return !!document.querySelector("ul.grid");
      });

      if (!posterListExists) {
        console.log(`[Job ${jobId}] No film grid found on page ${currentPage}`);
        continue;
      }

      // UPDATE: Get HTML from the new container 'ul.grid'
      const filmListHTML = await page.$eval("ul.grid", (el) => el.outerHTML);
      $ = cheerio.load(filmListHTML);

      // UPDATE: Target the new list item selector 'li.griditem'
      const filmsOnPage = $("li.griditem");
      console.log(
        `[Job ${jobId}] Page ${currentPage}/${totalPages}: Found ${filmsOnPage.length} films.`
      );

      filmsOnPage.each((index, el) => {
        const $el = $(el);
        // UPDATE: Film data is now in a div with this class
        const $dataContainer = $el.find("div.react-component");

        if ($dataContainer.length === 0) {
          return; // Skip if the main data container isn't found
        }

        // UPDATE: Use new data attribute names
        const nameWithYear = $dataContainer.data("item-name");
        const slug = $dataContainer.data("item-slug");

        if (!nameWithYear || !slug) {
          return; // Skip if essential data is missing
        }

        // UPDATE: Parse name and year from the combined string
        let name = nameWithYear;
        let year = null;
        const yearMatch = nameWithYear.match(/\s\((\d{4})\)$/); // Matches "(YYYY)" at the end of the string
        if (yearMatch) {
          year = yearMatch[1];
          name = nameWithYear.replace(yearMatch[0], "").trim();
        }

        // The rating logic remains the same, just confirm the selector is correct
        const ratingText = $el
          .find(".poster-viewingdata .rating")
          .text()
          .trim();
        let rating = 0;
        if (ratingText) {
          const stars = (ratingText.match(/★/g) || []).length;
          const halfStar = ratingText.includes("½") ? 0.5 : 0;
          rating = stars + halfStar;
        }

        const filmData = {
          Name: name,
          Year: year,
          "Letterboxd URI": `https://letterboxd.com${slug}`,
          Rating: rating,
        };

        // DEBUG LOG: Log the first film parsed on the first page to confirm success
        if (currentPage === 1 && index === 0) {
          console.log(
            `[Job ${jobId}] First film parsed successfully:`,
            filmData
          );
        }

        job.data.push(filmData);
      });

      job.progress = currentPage / totalPages;
      // Added a smaller delay to be slightly faster
      await new Promise((res) => setTimeout(res, 500));
    }

    job.status = "completed";
    console.log(
      `[Job ${jobId}] Scraping completed successfully. Found ${job.data.length} total films.`
    );
  } catch (error) {
    job.status = "failed";
    job.error = error.message;
    console.error(`[Job ${jobId}] Error during scraping:`, error);
  } finally {
    if (browser) await browser.close();
    setTimeout(() => {
      scrapingJobs.delete(jobId);
    }, 3600000); // Clean up job after 1 hour
  }
}

// Correctly export the plugin as an async function
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

      const jobId = `job_${Date.now()}`;
      scrapingJobs.set(jobId, {
        status: "pending",
        data: [],
        profileData: null,
        progress: 0,
        totalPages: 1,
      });

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
      data: job.status === "completed" ? job.data : [],
      profileData: job.profileData,
      error: job.error,
    };
  });
};
