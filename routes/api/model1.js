// routes/api/model1.js - Fixed dispose issue
const tf = require("@tensorflow/tfjs");
const fs = require("fs");
const path = require("path");

// Load processed movies data
const processedMoviesPath = path.join(
  __dirname,
  "../../public/processed_movies3.json"
);
let processedMovies;

// Cache for the model instance
let modelInstance = null;

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
 * Build TensorFlow model
 */
async function buildModel(inputShape) {
  if (modelInstance) {
    return modelInstance;
  }

  const model = tf.sequential();
  model.add(
    tf.layers.dense({
      units: 128,
      activation: "relu",
      inputShape: [inputShape],
      kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
      name: "dense_1",
    })
  );
  model.add(tf.layers.dropout({ rate: 0.3, name: "dropout_1" }));
  model.add(
    tf.layers.dense({
      units: 64,
      activation: "relu",
      kernelRegularizer: tf.regularizers.l2({ l2: 0.01 }),
      name: "dense_2",
    })
  );
  model.add(tf.layers.dropout({ rate: 0.2, name: "dropout_2" }));
  model.add(
    tf.layers.dense({ units: 1, activation: "linear", name: "output" })
  );

  model.compile({
    optimizer: tf.train.adam(0.001),
    loss: "meanSquaredError",
    metrics: ["mae"],
  });

  modelInstance = model;
  return modelInstance;
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
 * Train the model using userRatings
 */
async function trainModel(
  model,
  userRatings,
  processedMovies,
  weights,
  voteCountPenalty
) {
  const preferredLanguage = calculatePreferredLanguage(userRatings, 16); // Calculate preferred language for animation

  const inputs = [];
  const outputs = [];

  const maxPopularity = Math.max(
    ...processedMovies.map((m) => m.popularity || 1)
  );
  const maxVoteCount = Math.max(
    ...processedMovies.map((m) => m.vote_count || 1)
  );

  // Calculate genre watch count
  const genreWatchCount = {};
  userRatings.forEach((userMovie) => {
    userMovie.genre_ids.forEach((genreId) => {
      if (!genreWatchCount[genreId]) genreWatchCount[genreId] = 0;
      genreWatchCount[genreId] += 1;
    });
  });

  for (const userMovie of userRatings) {
    const movie = processedMovies.find((m) => m.id === userMovie.id);
    if (!movie) continue;

    // Genre score with language preference for animation
    const genreScore =
      movie.genre_ids.reduce((score, genreId) => {
        const watchCount = genreWatchCount[genreId] || 1; // Avoid division by zero
        let weight = 1 / watchCount; // Penalize frequently watched genres

        // Boost weight for animation genre if preferred language matches
        if (
          genreId === 16 &&
          preferredLanguage &&
          movie.original_language === preferredLanguage
        ) {
          weight *= 2; // Double the weight for preferred language
        }

        return score + weight;
      }, 0) / movie.genre_ids.length;

    // Other features
    const scaledPopularity =
      Math.log(1 + movie.popularity / maxPopularity) * weights.popularityWeight;
    const scaledVoteAverage =
      (movie.vote_average / 10) * weights.voteAverageWeight;
    const scaledVoteCount =
      Math.log(1 + movie.vote_count / maxVoteCount) *
      weights.voteCountWeight *
      Math.exp(-voteCountPenalty * (1 - movie.vote_count / maxVoteCount));

    // Combine all features
    inputs.push([
      genreScore,
      scaledPopularity,
      scaledVoteAverage,
      scaledVoteCount,
    ]);
    outputs.push([userMovie.user_rating / 10]); // Normalize user_rating to 0-1
  }

  const inputTensor = tf.tensor2d(inputs);
  const outputTensor = tf.tensor2d(outputs);

  // Early stopping parameters
  let bestValLoss = Infinity;
  let patienceCounter = 0;
  const patienceLimit = 5;

  try {
    for (let epoch = 0; epoch < 100; epoch++) {
      const history = await model.fit(inputTensor, outputTensor, {
        epochs: 1,
        batchSize: 32,
        validationSplit: 0.2,
        shuffle: true,
        verbose: 1,
      });

      const currentValLoss = history.history.val_loss[0]; // Get validation loss
      if (currentValLoss < bestValLoss) {
        bestValLoss = currentValLoss;
        patienceCounter = 0; // Reset patience counter
      } else {
        patienceCounter++;
        if (patienceCounter >= patienceLimit) {
          console.log(`Early stopping at epoch ${epoch + 1}`);
          break; // Stop training if no improvement
        }
      }
    }
  } finally {
    // Clean up tensors
    if (inputTensor) inputTensor.dispose();
    if (outputTensor) outputTensor.dispose();
  }
}

/**
 * Predict recommendations for all processed movies
 */
async function recommendMovies(
  model,
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
  const preferredLanguage = calculatePreferredLanguage(userRatings, 16); // Calculate preferred language for animation

  const genreWatchCount = {};
  userRatings.forEach((userMovie) => {
    userMovie.genre_ids.forEach((genreId) => {
      if (!genreWatchCount[genreId]) genreWatchCount[genreId] = 0;
      genreWatchCount[genreId] += 1;
    });
  });

  const filteredMovies = processedMovies.filter(
    (movie) =>
      movie.vote_count >= minVoteCount &&
      !watchedMovieIds.includes(movie.id) &&
      (userPreferredGenre === null ||
        movie.genre_ids.includes(userPreferredGenre))
  );

  const inputs = filteredMovies.map((movie) => {
    // Genre score with language preference for animation
    const genreScore =
      movie.genre_ids.reduce((score, genreId) => {
        const watchCount = genreWatchCount[genreId] || 1; // Avoid division by zero
        let weight = 1 / watchCount; // Penalize frequently watched genres

        // Boost weight for animation genre if preferred language matches
        if (
          genreId === 16 &&
          preferredLanguage &&
          movie.original_language === preferredLanguage
        ) {
          weight *= 2; // Double the weight for preferred language
        }

        // Boost weight for user's preferred genre
        if (userPreferredGenre !== null && genreId === userPreferredGenre) {
          weight *= weights.genreWeight; // Apply genreWeight to prioritize the selected genre
        }

        return score + weight;
      }, 0) / movie.genre_ids.length;

    // Other features
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

    return [genreScore, scaledPopularity, scaledVoteAverage, scaledVoteCount];
  });

  if (inputs.length === 0) {
    return []; // Return empty array if no movies meet criteria
  }

  let scores = [];
  let inputTensor = null;
  let predictions = null;

  try {
    inputTensor = tf.tensor2d(inputs);
    predictions = model.predict(inputTensor);
    scores = await predictions.data();
  } finally {
    // Clean up tensors
    if (inputTensor) inputTensor.dispose();
    if (predictions) predictions.dispose();
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
const model1Schema = {
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
      voteAverageWeight: { type: "number" },
      voteCountWeight: { type: "number" },
      popularityWeight: { type: "number" },
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
      `Loaded ${processedMovies.length} processed movies for recommendations`
    );
  } catch (error) {
    fastify.log.error(`Error loading processed movies: ${error.message}`);
    throw new Error("Failed to load movie data");
  }

  // Endpoint to get movie recommendations
  fastify.post("/", { schema: model1Schema }, async (request, reply) => {
    try {
      const {
        userRatings,
        genreWeight = 1.0,
        voteAverageWeight = 1.0,
        voteCountWeight = 0.5,
        popularityWeight = 0.8,
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

      // Build the model
      let model = null;

      try {
        model = await buildModel(4); // Input shape is 4 (genreScore, popularity, voteAverage, voteCount)

        // Train the model with user data
        await trainModel(
          model,
          userRatings,
          processedMovies,
          weights,
          voteCountPenalty
        );

        // Generate recommendations
        const recommendations = await recommendMovies(
          model,
          processedMovies,
          weights,
          voteCountPenalty,
          minVoteCount,
          userRatings,
          userPreferredGenre
        );

        return recommendations;
      } catch (error) {
        // Re-throw the error to be caught by the outer try/catch
        throw error;
      }
      // We don't dispose of the model here as it might be shared (modelInstance)
    } catch (error) {
      request.log.error(`Error generating recommendations: ${error.message}`);
      return reply
        .code(500)
        .send({ error: "Failed to generate recommendations" });
    }
  });
};
