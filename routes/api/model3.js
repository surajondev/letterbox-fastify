// routes/api/model3.js - Fixed dispose issues
const tf = require("@tensorflow/tfjs");
const fs = require("fs");
const path = require("path");

// Load processed movies data
const processedMoviesPath = path.join(
  __dirname,
  "../../public/processed_movies3.json"
);
let processedMovies;

// List of all possible genre IDs
const genreList = [
  28, 12, 16, 35, 80, 99, 18, 10751, 14, 36, 27, 10402, 9648, 10749, 878, 10770,
  53, 10752, 37,
];

/**
 * Calculate the user's preferred language for a specific genre
 */
function calculatePreferredLanguage(userRatings, genreId) {
  const languageCounts = {};

  for (const rating of userRatings) {
    if (rating.genre_ids.includes(genreId)) {
      const movie = processedMovies.find((m) => m.id === rating.id);
      if (movie) {
        const lang = movie.original_language;
        languageCounts[lang] = (languageCounts[lang] || 0) + rating.user_rating; // Weight by user rating
      }
    }
  }

  if (Object.keys(languageCounts).length === 0) {
    return null; // No preferred language
  }

  // Return the language with the highest weighted count
  return Object.keys(languageCounts).reduce((a, b) =>
    languageCounts[a] > languageCounts[b] ? a : b
  );
}

/**
 * Calculate dynamic genre weights based on user watch history
 */
function calculateGenreWeights(userRatings) {
  const genreWatchCounts = {};

  // Count the number of movies watched in each genre
  userRatings.forEach(({ genre_ids }) => {
    genre_ids.forEach((genreId) => {
      genreWatchCounts[genreId] = (genreWatchCounts[genreId] || 0) + 1;
    });
  });

  // Calculate weights: less-watched genres get higher weights
  const maxWatchCount = Math.max(...Object.values(genreWatchCounts), 1);

  return genreList.reduce((weights, genreId) => {
    const count = genreWatchCounts[genreId] || 0;
    weights[genreId] = 1 - Math.sqrt(count / maxWatchCount); // Use sqrt to reduce dominance of frequently watched genres
    return weights;
  }, {});
}

/**
 * Format recommendations to match the required structure
 * @param {Array} recommendations - Raw recommendations
 * @returns {Array} Formatted recommendations
 */
function formatRecommendations(recommendations) {
  return recommendations.map((movie) => {
    // Map language codes to integers
    const languageCodeMap = {
      en: 1,
      ja: 2,
      ko: 3,
      zh: 4,
      fr: 5,
      es: 6,
      de: 7,
      it: 8,
      ru: 9,
      hi: 10,
      pt: 11,
      th: 12,
      ar: 13,
      sv: 14,
      nl: 15,
    };

    // Calculate days since 1988-01-01 (baseline for release_days)
    const baseline = new Date("1988-01-01").getTime();
    const releaseDate = movie.release_date
      ? new Date(movie.release_date).getTime()
      : baseline;
    const daysSinceBaseline = Math.floor(
      (releaseDate - baseline) / (1000 * 60 * 60 * 24)
    );

    // Clean up genre_ids to ensure exactly 5 elements (padding with 0 if needed)
    const genreIds = [...(movie.genre_ids || [])];
    while (genreIds.length < 5) genreIds.push(0);
    if (genreIds.length > 5) genreIds.length = 5;

    return {
      id: movie.id,
      title: movie.title || "",
      overview: movie.overview || "",
      genre_ids: genreIds,
      release_days: daysSinceBaseline,
      release_year: movie.release_date
        ? movie.release_date.substring(0, 4)
        : "",
      popularity: movie.popularity || 0,
      vote_average: movie.vote_average || 0,
      vote_count: movie.vote_count || 0,
      language_code: languageCodeMap[movie.original_language] || 0,
      title_length: (movie.title || "").length,
      poster_path: movie.poster_path || "",
      score: movie.score || 0,
    };
  });
}

/**
 * Predict recommendations without neural network training
 */
async function recommendMovies(
  processedMovies,
  weights,
  voteCountPenalty,
  minVoteCount,
  userRatings,
  userPreferredGenre
) {
  const maxPopularity = Math.max(
    ...processedMovies.map((m) => m.popularity || 1)
  );
  const maxVoteCount = Math.max(
    ...processedMovies.map((m) => m.vote_count || 1)
  );

  const watchedMovieIds = userRatings.map((rating) => rating.id); // Get the list of watched movie IDs

  // Calculate dynamic genre weights
  const genreWeights = calculateGenreWeights(userRatings);

  // Calculate preferred language for animation
  const preferredLanguage = calculatePreferredLanguage(userRatings, 16);

  const filteredMovies = processedMovies.filter(
    (movie) =>
      movie.vote_count >= minVoteCount &&
      !watchedMovieIds.includes(movie.id) &&
      (userPreferredGenre === null ||
        movie.genre_ids.includes(userPreferredGenre))
  );

  if (filteredMovies.length === 0) {
    return []; // Return empty array if no movies meet criteria
  }

  const inputs = filteredMovies.map((movie) => {
    const genreFeatures = genreList.map((genreId) => {
      if (movie.genre_ids.includes(genreId)) {
        const baseWeight = genreWeights[genreId] || 0;

        // Adjust weight for animation genre based on language
        if (genreId === 16 && preferredLanguage) {
          const languageBoost =
            movie.original_language === preferredLanguage ? 2 : 0.5;
          return baseWeight * languageBoost;
        }

        // Boost weight for user's preferred genre
        if (userPreferredGenre !== null && genreId === userPreferredGenre) {
          return baseWeight * 10; // High weight for preferred genre
        }

        return baseWeight;
      } else {
        return 0;
      }
    });

    const scaledPopularity =
      Math.log(1 + (movie.popularity || 1) / maxPopularity) *
      weights.popularityWeight;
    const scaledVoteAverage =
      (movie.vote_average / 10) * weights.voteAverageWeight;
    const scaledVoteCount =
      Math.log(1 + (movie.vote_count || 1) / maxVoteCount) *
      weights.voteCountWeight *
      Math.exp(
        -voteCountPenalty * (1 - (movie.vote_count || 1) / maxVoteCount)
      );

    return [
      ...genreFeatures,
      scaledPopularity,
      scaledVoteAverage,
      scaledVoteCount,
    ];
  });

  // Use try/finally to ensure proper tensor disposal
  let inputTensor = null;
  let sumTensor = null;
  let scores = [];

  try {
    // Create input tensor
    inputTensor = tf.tensor2d(inputs);

    // Instead of using a trained model, we simply sum all features
    sumTensor = inputTensor.sum(1);

    // Convert to array
    scores = await sumTensor.data();
  } catch (error) {
    console.error("Error in tensor operations:", error);
    throw error;
  } finally {
    // Clean up tensors to avoid memory leaks
    if (inputTensor) inputTensor.dispose();
    if (sumTensor) sumTensor.dispose();
  }

  const recommendationResults = filteredMovies
    .map((movie, index) => ({
      ...movie,
      score: scores[index],
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 35);

  // Format the recommendations to match the required structure
  return formatRecommendations(recommendationResults);
}

// Define validation schema for the API
const model3Schema = {
  body: {
    type: "object",
    required: ["userRatings"],
    properties: {
      userRatings: {
        type: "array",
        items: {
          type: "object",
          required: ["genre_ids", "user_rating", "id"],
          properties: {
            genre_ids: { type: "array", items: { type: "number" } },
            user_rating: { type: "number" },
            id: { type: "number" },
          },
        },
      },
      genreWeight: { type: "number", default: 1.0 },
      voteAverageWeight: { type: "number", default: 1.0 },
      voteCountWeight: { type: "number", default: 1.0 },
      popularityWeight: { type: "number", default: 1.0 },
      userPreferredGenre: { type: ["number", "null"], default: null },
    },
  },
  response: {
    200: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "number" },
          title: { type: "string" },
          overview: { type: "string" },
          genre_ids: { type: "array", items: { type: "number" } },
          release_days: { type: "number" },
          release_year: { type: "string" },
          popularity: { type: "number" },
          vote_average: { type: "number" },
          vote_count: { type: "number" },
          language_code: { type: "number" },
          title_length: { type: "number" },
          poster_path: { type: "string" },
          score: { type: "number" },
        },
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
        error: { type: "string" },
      },
    },
  },
};

module.exports = async function (fastify, opts) {
  // Load the processed movies on startup
  try {
    const fileContent = await fs.promises.readFile(
      processedMoviesPath,
      "utf-8"
    );
    processedMovies = JSON.parse(fileContent);
    fastify.log.info(
      `Loaded ${processedMovies.length} processed movies for Model3 recommendations`
    );
  } catch (error) {
    fastify.log.error(
      `Error loading processed movies for Model3: ${error.message}`
    );
    throw new Error("Failed to load movie data for Model3");
  }

  // Endpoint to get movie recommendations
  fastify.post("/", { schema: model3Schema }, async (request, reply) => {
    try {
      const {
        userRatings,
        genreWeight = 1.0,
        voteAverageWeight = 1.0,
        voteCountWeight = 1.0,
        popularityWeight = 1.0,
        userPreferredGenre = null,
      } = request.body;

      if (!userRatings || userRatings.length === 0) {
        return reply.code(400).send({ message: "No user data" });
      }

      const voteCountPenalty = 10.0;
      const minVoteCount = voteCountWeight * 40;
      const weights = {
        genreWeight,
        voteAverageWeight,
        voteCountWeight,
        popularityWeight,
      };

      // Generate recommendations without neural network
      const recommendations = await recommendMovies(
        processedMovies,
        weights,
        voteCountPenalty,
        minVoteCount,
        userRatings,
        userPreferredGenre
      );

      return recommendations;
    } catch (error) {
      request.log.error(
        `Error generating Model3 recommendations: ${error.message}`
      );
      return reply
        .code(500)
        .send({ error: "Failed to generate Model3 recommendations" });
    }
  });
};
