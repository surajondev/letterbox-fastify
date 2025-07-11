// routes/api/model2.js - Fixed dispose issues
const tf = require("@tensorflow/tfjs");
const fs = require("fs");
const path = require("path");

// Load processed movies data
const processedMoviesPath = path.join(
  __dirname,
  "../../public/processed_movies3.json"
);
const processedTop250MoviesPath = path.join(
  __dirname,
  "../../public/official-top-250-narrative-feature.json"
);
const processedTop250MoviesAllTimePath = path.join(
  __dirname,
  "../../public/letterboxd-top-250-films-history-collected-tmdb.json"
);
const processedClassicPath = path.join(
  __dirname,
  "../../public/classic-movies-for-beginners.json"
);
const processedComforMovies20sPath = path.join(
  __dirname,
  "../../public/comfort-movies.json"
);
const processedFeelingLostPath = path.join(
  __dirname,
  "../../public/feeling-lost-in-your-20s.json"
);
const processedTFeelingSomethingPath = path.join(
  __dirname,
  "../../public/for-when-you-want-to-feel-something.json"
);
const processedTop250HorrorPath = path.join(
  __dirname,
  "../../public/letterboxds-top-250-horror-films.json"
);
const processedTop100NarrativePath = path.join(
  __dirname,
  "../../public/official-top-100-narrative-feature-films-1.json"
);
const processedTop250MostFansPath = path.join(
  __dirname,
  "../../public/official-top-250-films-with-the-most-fans.json"
);
const processedTop250DcoumentariesPath = path.join(
  __dirname,
  "../../public/official-top-250-documentary-films.json"
);
const processedPsychosexualPath = path.join(
  __dirname,
  "../../public/psychosexual-dramas-nihilistic-fever-dreams.json"
);
const processedWhatIsRealityPath = path.join(
  __dirname,
  "../../public/what-is-reality.json"
);
const processedTop250WomensPath = path.join(
  __dirname,
  "../../public/women-directors-the-official-top-250-narrative.json"
);
const processedYourAreNotSamePath = path.join(
  __dirname,
  "../../public/youre-not-the-same-person-once-the-film-has.json"
);

const processedEyeCandyPath = path.join(
  __dirname,
  "../../public/eye-candy.json"
);

const processedNetflixPath = path.join(__dirname, "../../public/netflix.json");

const processedPshycosexual2Path = path.join(
  __dirname,
  "../../public/psychosexual2.json"
);

const processedAnimePath = path.join(__dirname, "../../public/anime.json");

let processedMovies;
let top250Movies;
let top250MoviesAllTime;
let classicMovies;
let comfortMovies20s;
let feelingLostMovies;
let feelSomethingMovies;
let top250HorrorMovies;
let top100NarrativeMovies;
let top250MostFansMovies;
let top250Documentaries;
let psychosexualDramas;
let whatIsRealityMovies;
let top250WomensMovies;
let youAreNotTheSameMovies;
let eyeCandy;
let anime;
let netflix;
let psychoSexual2;

// Cache for the model instance
let modelInstance = null;

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
 * Calculate genre weights based on user ratings
 */
function calculateGenreWeights(userRatings, genresList, preferredLanguage) {
  const genreCounts = {};

  // Initialize genre counts
  for (const genre of genresList) {
    genreCounts[genre] = 0;
  }

  // Count occurrences of each genre in the user's watched movies
  for (const rating of userRatings) {
    for (const genreId of rating.genre_ids) {
      genreCounts[genreId] = (genreCounts[genreId] || 0) + 1;
    }
  }

  // Normalize weights (lower count = higher weight)
  const maxCount = Math.max(...Object.values(genreCounts), 1);
  return genresList.map((genre) => {
    let weight = (maxCount - genreCounts[genre] + 1) / maxCount;

    // Boost weight for animation genre if preferred language matches
    if (genre === 16 && preferredLanguage) {
      weight *= 2; // Double the weight for preferred language
    }

    return weight;
  });
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
      units: 64,
      activation: "relu",
      inputShape: [inputShape],
      name: "dense_1",
    })
  );
  model.add(tf.layers.dropout({ rate: 0.2, name: "dropout_1" }));
  model.add(
    tf.layers.dense({ units: 32, activation: "relu", name: "dense_2" })
  );
  model.add(
    tf.layers.dense({ units: 1, activation: "linear", name: "output" })
  );

  model.compile({
    optimizer: "adam",
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
  genresList,
  voteCountPenalty
) {
  const preferredLanguage = calculatePreferredLanguage(userRatings, 16); // Calculate preferred language for animation
  const genreWeights = calculateGenreWeights(
    userRatings,
    genresList,
    preferredLanguage
  );

  const inputs = [];
  const outputs = [];

  const maxPopularity = Math.max(
    ...processedMovies.map((m) => m.popularity || 1)
  );
  const maxVoteCount = Math.max(
    ...processedMovies.map((m) => m.vote_count || 1)
  );

  for (const userMovie of userRatings) {
    const movie = processedMovies.find((m) => m.id === userMovie.id);
    if (!movie) continue;

    // One-hot encode genres with adjusted weights
    const genreFeatures = genresList.map((genreId, index) => {
      let weight = movie.genre_ids.includes(genreId) ? genreWeights[index] : 0;

      // Adjust weight for genre 16 (animation) based on language
      if (genreId === 16 && movie.genre_ids.includes(genreId)) {
        if (
          preferredLanguage &&
          movie.original_language === preferredLanguage
        ) {
          weight *= 2; // Double the weight for preferred language
        } else {
          weight *= 0.5; // Reduce weight for non-preferred language
        }
      }

      return weight;
    });

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

    // Combine all features
    const inputVector = [
      ...genreFeatures,
      scaledPopularity,
      scaledVoteAverage,
      scaledVoteCount,
    ];
    inputs.push(inputVector);

    // Normalize user rating to 0-1
    outputs.push([userMovie.user_rating / 10]);
  }

  // Convert inputs and outputs to tensors
  let inputTensor = null;
  let outputTensor = null;

  try {
    inputTensor = tf.tensor2d(inputs);
    outputTensor = tf.tensor2d(outputs);

    // Early stopping parameters
    let bestValLoss = Infinity;
    let patienceCounter = 0;
    const patienceLimit = 5;

    for (let epoch = 0; epoch < 100; epoch++) {
      const history = await model.fit(inputTensor, outputTensor, {
        epochs: 1,
        batchSize: 16,
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
  userPreferredGenre,
  movie_list
) {
  let moviesToRecommendFrom;

  switch (movie_list) {
    case "all":
      moviesToRecommendFrom = processedMovies;
      break;
    case "top250Films":
      moviesToRecommendFrom = top250Movies;
      break;
    case "top250FilmsAllTime":
      moviesToRecommendFrom = top250MoviesAllTime;
      break;
    case "top100Under15000":
      moviesToRecommendFrom = top100NarrativeMovies;
      break;
    case "top250MostFans":
      moviesToRecommendFrom = top250MostFansMovies;
      break;
    case "top250WomenDirectors":
      moviesToRecommendFrom = top250WomensMovies;
      break;
    case "top250Horro":
      moviesToRecommendFrom = top250HorrorMovies;
      break;
    case "moveisThatFeels":
      moviesToRecommendFrom = feelSomethingMovies;
      break;
    case "notSamePersion":
      moviesToRecommendFrom = youAreNotTheSameMovies;
      break;
    case "psychoSexual":
      moviesToRecommendFrom = psychosexualDramas;
      break;
    case "classicMovies":
      moviesToRecommendFrom = classicMovies;
      break;
    case "comfortMovies":
      moviesToRecommendFrom = comfortMovies20s;
      break;
    case "feelingLost20s":
      moviesToRecommendFrom = feelingLostMovies;
      break;
    case "whatIsRealtiy":
      moviesToRecommendFrom = whatIsRealityMovies;
      break;
    case "top250Documentaries":
      moviesToRecommendFrom = top250Documentaries;
      break;
    case "eyeCanday":
      moviesToRecommendFrom = eyeCandy;
      break;
    case "anime":
      moviesToRecommendFrom = anime;
      break;
    case "netflix":
      moviesToRecommendFrom = netflix;
      break;
    case "psychoSexual2":
      moviesToRecommendFrom = psychoSexual2;
      break;
    default:
      moviesToRecommendFrom = processedMovies;
  }

  const maxPopularity = Math.max(
    ...processedMovies.map((m) => m.popularity || 1)
  );
  const maxVoteCount = Math.max(
    ...processedMovies.map((m) => m.vote_count || 1)
  );

  const watchedMovieIds = userRatings.map((rating) => rating.id); // Get the list of watched movie IDs
  const preferredLanguage = calculatePreferredLanguage(userRatings, 16); // Calculate preferred language for animation

  const filteredMovies = moviesToRecommendFrom.filter(
    (movie) =>
      movie.vote_count >= minVoteCount &&
      !watchedMovieIds.includes(movie.id) &&
      // Check if movie has at least one preferred genre
      (userPreferredGenre === null ||
        userPreferredGenre.length === 0 ||
        userPreferredGenre.some((genre) => movie.genre_ids.includes(genre)))
  );

  if (filteredMovies.length === 0) {
    return []; // Return empty array if no movies meet criteria
  }

  // One-hot encode genres
  const inputs = filteredMovies.map((movie) => {
    const genreFeatures = genreList.map((genreId) => {
      // Check if movie has this genre
      const hasGenre = movie.genre_ids.includes(genreId);

      // Determine base weight
      let weight = hasGenre ? 1 : 0;

      // Apply preferred genre boost if applicable
      if (
        hasGenre &&
        userPreferredGenre &&
        userPreferredGenre.includes(genreId)
      ) {
        weight = 10; // Boost preferred genres
      }

      // Special handling for animation genre (ID 16)
      if (genreId === 16 && hasGenre) {
        if (
          preferredLanguage &&
          movie.original_language === preferredLanguage
        ) {
          weight *= 2; // Double weight for preferred language
        } else {
          weight *= 0.5; // Reduce weight for non-preferred language
        }
      }

      return weight;
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
const model2Schema = {
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
      voteCountWeight: { type: "number", default: 0.5 },
      popularityWeight: { type: "number", default: 0.8 },
      userPreferredGenre: {
        type: ["array", "null"],
        items: { type: "number" },
        default: null,
      },
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
  const loadJSON = async (filePath) => {
    const content = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(content);
  };

  try {
    processedMovies = await loadJSON(processedMoviesPath);
    top250Movies = await loadJSON(processedTop250MoviesPath);
    top250MoviesAllTime = await loadJSON(processedTop250MoviesAllTimePath);
    classicMovies = await loadJSON(processedClassicPath);
    comfortMovies20s = await loadJSON(processedComforMovies20sPath);
    feelingLostMovies = await loadJSON(processedFeelingLostPath);
    feelSomethingMovies = await loadJSON(processedTFeelingSomethingPath);
    top250HorrorMovies = await loadJSON(processedTop250HorrorPath);
    top100NarrativeMovies = await loadJSON(processedTop100NarrativePath);
    top250MostFansMovies = await loadJSON(processedTop250MostFansPath);
    top250Documentaries = await loadJSON(processedTop250DcoumentariesPath);
    psychosexualDramas = await loadJSON(processedPsychosexualPath);
    whatIsRealityMovies = await loadJSON(processedWhatIsRealityPath);
    top250WomensMovies = await loadJSON(processedTop250WomensPath);
    youAreNotTheSameMovies = await loadJSON(processedYourAreNotSamePath);
    eyeCandy = await loadJSON(processedEyeCandyPath);
    anime = await loadJSON(processedAnimePath);
    netflix = await loadJSON(processedNetflixPath);
    psychoSexual2 = await loadJSON(processedPshycosexual2Path);
  } catch (error) {
    fastify.log.error(`Error loading movie data: ${error.message}`);
    throw new Error("Failed to load movie data");
  }

  // Endpoint to get movie recommendations
  fastify.post("/", { schema: model2Schema }, async (request, reply) => {
    try {
      const {
        userRatings,
        genreWeight = 1.0,
        voteAverageWeight = 1.0,
        voteCountWeight = 0.5,
        popularityWeight = 0.8,
        userPreferredGenre = null,
        movie_list = null,
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

      // Build the model - use a local variable
      let model = null;

      try {
        // Build or get cached model
        model = await buildModel(genreList.length + 3);

        // Train the model with user data
        await trainModel(
          model,
          userRatings,
          processedMovies,
          weights,
          genreList,
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
          userPreferredGenre,
          movie_list
        );

        return recommendations;
      } catch (error) {
        fastify.log.error(`Model error: ${error.message}`);
        throw error;
      }
      // We don't dispose the model here since it might be cached in modelInstance
    } catch (error) {
      request.log.error(
        `Error generating Model2 recommendations: ${error.message}`
      );
      return reply
        .code(500)
        .send({ error: "Failed to generate Model2 recommendations" });
    }
  });
};
