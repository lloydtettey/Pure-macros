require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');
const { readDb, writeDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- OAuth (Google / Apple) ----------
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID || '';

// 'postmessage' is Google's special redirect_uri value for the JS popup code
// flow (google.accounts.oauth2.initCodeClient) — there's no real redirect
// endpoint to register, so no per-environment redirect URI setup is needed.
const googleOAuthClient = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, 'postmessage');

const appleJwks = jwksClient({ jwksUri: 'https://appleid.apple.com/auth/keys', cache: true, cacheMaxAge: 3600 * 1000 });
function getAppleSigningKey(header, callback) {
  appleJwks.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key.getPublicKey());
  });
}
function verifyAppleIdentityToken(identityToken) {
  return new Promise((resolve, reject) => {
    jwt.verify(
      identityToken,
      getAppleSigningKey,
      { algorithms: ['RS256'], audience: APPLE_CLIENT_ID, issuer: 'https://appleid.apple.com' },
      (err, decoded) => (err ? reject(err) : resolve(decoded))
    );
  });
}

app.use(express.json({ limit: '12mb' })); // raised limit — scanned plate photos arrive as base64 JSON
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- iOS Home Screen standalone app routing ----------
// A Home Screen install launches from a cached URL (the root, often with a
// trailing slash) rather than a fresh Safari navigation, so it needs an
// explicit, always-200 handler here instead of relying solely on
// express.static's implicit index.html resolution above.
const INDEX_HTML_PATH = path.join(__dirname, '..', 'public', 'index.html');
app.get(['/', '/index.html'], (req, res) => {
  res.status(200).sendFile(INDEX_HTML_PATH);
});

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'];
const CUSTOM_FOOD_ID = '__custom__';
const SCRYPT_KEYLEN = 64;
const ACTIVITY_LEVELS = ['sedentary', 'light', 'moderate', 'very', 'extreme'];
const FITNESS_GOALS = ['lose', 'maintain', 'gain'];
const FASTING_PROTOCOLS = ['16:8', '18:6', 'custom'];
const DEVICE_KEYS = ['appleHealth', 'googleFit', 'manualEntry', 'garmin', 'fitbit', 'strava', 'myFitnessPal'];
const WEEK_START_OPTIONS = ['monday', 'sunday'];
const DIARY_SHARING_OPTIONS = ['private', 'friends', 'public'];
const DAY_TYPES = ['rest', 'work', 'gym'];
const DEFAULT_DAY_TYPE_TARGETS = {
  rest: { label: 'Rest Day', calories: 2000, protein: 130, carbs: 220, fat: 65 },
  work: { label: 'Work Day', calories: 2250, protein: 145, carbs: 250, fat: 75 },
  gym: { label: 'Gym Training', calories: 2500, protein: 160, carbs: 275, fat: 85 }
};

const DEFAULT_REMINDERS = [
  { key: 'breakfast', label: 'Log Breakfast', time: '08:00' },
  { key: 'lunch', label: 'Log Lunch', time: '12:30' },
  { key: 'dinner', label: 'Log Dinner', time: '18:30' },
  { key: 'hydration', label: 'Hydration Check', time: '15:00' },
  { key: 'weight-checkin', label: 'Weight Check-In', time: '07:00' }
];

// Static editorial content for the Discovery/Learn feed — not per-user data,
// so it lives alongside FOOD_DB rather than in db.json.
const RECIPE_CATALOG = [
  { id: 'r1', name: 'Grilled Chicken & Quinoa Bowl', category: 'high-protein', prepMinutes: 20, calories: 480, protein: 42, carbs: 38, fat: 14 },
  { id: 'r2', name: 'Greek Yogurt Protein Parfait', category: 'high-protein', prepMinutes: 5, calories: 320, protein: 28, carbs: 30, fat: 8 },
  { id: 'r3', name: 'Egg White & Spinach Scramble', category: 'high-protein', prepMinutes: 10, calories: 260, protein: 30, carbs: 6, fat: 10 },
  { id: 'r4', name: 'Tuna Avocado Wrap', category: 'under-15', prepMinutes: 10, calories: 410, protein: 32, carbs: 28, fat: 18 },
  { id: 'r5', name: 'Microwave Veggie Omelette', category: 'under-15', prepMinutes: 8, calories: 290, protein: 22, carbs: 8, fat: 18 },
  { id: 'r6', name: 'Peanut Butter Banana Toast', category: 'under-15', prepMinutes: 5, calories: 350, protein: 12, carbs: 44, fat: 14 },
  { id: 'r7', name: 'Sunday Meal-Prep Chicken & Rice (5 boxes)', category: 'meal-prep', prepMinutes: 45, calories: 520, protein: 40, carbs: 55, fat: 12 },
  { id: 'r8', name: 'Turkey Chili Batch (6 servings)', category: 'meal-prep', prepMinutes: 40, calories: 390, protein: 34, carbs: 30, fat: 14 },
  { id: 'r9', name: 'Overnight Oats Jars (4 pack)', category: 'meal-prep', prepMinutes: 10, calories: 340, protein: 14, carbs: 52, fat: 9 }
];

// ---------- AI Fitness Coach formulation ----------
const ACTIVITY_MULTIPLIERS = { sedentary: 1.2, light: 1.375, moderate: 1.55, very: 1.725, extreme: 1.9 };
const GOAL_CALORIE_ADJUSTMENT = { lose: -500, maintain: 0, gain: 300 };
const GOAL_PROTEIN_PER_KG = { lose: 2.2, maintain: 1.8, gain: 2.4 };
const MIN_AGE_YEARS = 13;
const MAX_AGE_YEARS = 120;

// Mifflin-St Jeor BMR with a sex-neutral offset: this app doesn't collect
// sex, so the male (+5) and female (-161) constants are averaged into -78.
function calculateBmr(weightKg, heightCm, ageYears) {
  return 10 * weightKg + 6.25 * heightCm - 5 * ageYears - 78;
}

function computeCoachPlan({ weightKg, heightCm, ageYears, activityLevel, fitnessGoal }) {
  const bmr = calculateBmr(weightKg, heightCm, ageYears);
  const tdee = bmr * ACTIVITY_MULTIPLIERS[activityLevel];
  const calorieGoal = Math.max(1200, Math.round((tdee + GOAL_CALORIE_ADJUSTMENT[fitnessGoal]) / 10) * 10);
  const proteinG = Math.round(GOAL_PROTEIN_PER_KG[fitnessGoal] * weightKg);
  const fatG = Math.round((calorieGoal * 0.25) / 9);
  const carbG = Math.max(0, Math.round((calorieGoal - proteinG * 4 - fatG * 9) / 4));
  return { calorieGoal, macroGoals: { protein: proteinG, carbs: carbG, fat: fatG } };
}
const todayStr = () => new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time

// ---------- Dynamic food-logging streak engine ----------
// Case A (already logged today): no-op, streak stands. Case B (last log was
// exactly yesterday): the streak continues, +1. Case C (broken — a gap of 2+
// days — or a first-ever log): the streak restarts at 1. lastLoggedDate is
// always stamped to today afterward so the next call can tell which case it's in.
function applyStreakUpdate(data, today) {
  if (data.lastLoggedDate === today) return; // Case A
  const yesterday = addDaysToDateStr(today, -1);
  data.currentStreak = data.lastLoggedDate === yesterday ? (data.currentStreak || 0) + 1 : 1; // B : C
  data.lastLoggedDate = today;
}

// Micronutrient fields tracked per 100g alongside kcal/protein/carbs/fat.
// Custom foods (logged via the "custom food" form) never supply these, so
// computeFromGrams() defaults any missing field to 0 for them.
const MICRO_FIELDS = [
  'fiber', 'sugar', 'saturatedFat', 'polyunsaturatedFat', 'monounsaturatedFat', 'sodium', 'cholesterol',
  'potassium', 'iron', 'vitaminA', 'vitaminC', 'vitaminD', 'vitaminB12'
];

// Local reference database — baseline nutrition per 100g for popular gym foods.
// Whole Egg is stored as its 50g-per-unit values scaled up to a 100g basis so
// the same (grams / 100) formula applies uniformly to every food.
const FOOD_DB = [
  {
    id: 'white_rice_cooked', name: 'White Rice', group: 'white_rice', groupLabel: 'White Rice', state: 'cooked', isGroupDefault: true,
    kcal: 130, protein: 2.7, carbs: 28, fat: 0.3,
    fiber: 0.4, sugar: 0.1, saturatedFat: 0.1, polyunsaturatedFat: 0.1, monounsaturatedFat: 0.1, sodium: 1, cholesterol: 0,
    potassium: 35, iron: 0.2, vitaminA: 0, vitaminC: 0, vitaminD: 0, vitaminB12: 0
  },
  {
    id: 'white_rice_raw', name: 'White Rice (Raw)', group: 'white_rice', groupLabel: 'White Rice', state: 'raw',
    kcal: 360, protein: 6.7, carbs: 79, fat: 0.6,
    fiber: 1.3, sugar: 0.1, saturatedFat: 0.2, polyunsaturatedFat: 0.2, monounsaturatedFat: 0.2, sodium: 1, cholesterol: 0,
    potassium: 115, iron: 0.8, vitaminA: 0, vitaminC: 0, vitaminD: 0, vitaminB12: 0
  },
  {
    id: 'chicken_breast', name: 'Chicken Breast', kcal: 165, protein: 31, carbs: 0, fat: 3.6,
    fiber: 0, sugar: 0, saturatedFat: 1.0, polyunsaturatedFat: 0.8, monounsaturatedFat: 1.2, sodium: 74, cholesterol: 85,
    potassium: 256, iron: 0.7, vitaminA: 6, vitaminC: 0, vitaminD: 0.1, vitaminB12: 0.3
  },
  {
    id: 'oatmeal_cooked', name: 'Oats (Cooked)', group: 'oats', groupLabel: 'Oats', state: 'cooked', isGroupDefault: true,
    kcal: 71, protein: 2.5, carbs: 12, fat: 1.5,
    fiber: 1.7, sugar: 0.3, saturatedFat: 0.3, polyunsaturatedFat: 0.5, monounsaturatedFat: 0.4, sodium: 4, cholesterol: 0,
    potassium: 70, iron: 0.7, vitaminA: 0, vitaminC: 0, vitaminD: 0, vitaminB12: 0
  },
  {
    id: 'oatmeal', name: 'Oats (Raw)', group: 'oats', groupLabel: 'Oats', state: 'raw',
    kcal: 389, protein: 16.9, carbs: 66, fat: 6.9,
    fiber: 10.6, sugar: 1.0, saturatedFat: 1.2, polyunsaturatedFat: 2.5, monounsaturatedFat: 2.2, sodium: 2, cholesterol: 0,
    potassium: 429, iron: 4.25, vitaminA: 0, vitaminC: 0, vitaminD: 0, vitaminB12: 0
  },
  {
    id: 'whole_egg', name: 'Whole Egg', kcal: 140, protein: 12, carbs: 1, fat: 10, unitGrams: 50,
    fiber: 0, sugar: 0.4, saturatedFat: 3.2, polyunsaturatedFat: 1.4, monounsaturatedFat: 3.6, sodium: 124, cholesterol: 372,
    potassium: 126, iron: 1.75, vitaminA: 160, vitaminC: 0, vitaminD: 2, vitaminB12: 1.1
  }
];

function findFood(foodId) {
  return FOOD_DB.find((f) => f.id === foodId) || null;
}

// ---------- AI Vision "Scan Plate" detector (simulated) ----------
// No live vision API key is configured in this project, so this mocks the
// round trip to a premium vision model (GPT-4o Vision / Gemini Pro Vision):
// it inspects the uploaded filename with regex hints and otherwise derives a
// deterministic pseudo-detection from the image bytes, then cross-references
// the match against our 100g FOOD_DB baseline for real macro numbers.
const VISION_FOOD_PROFILES = [
  { pattern: /rice/i, foodId: 'white_rice_cooked', weightRange: [180, 260] },
  { pattern: /chicken|breast/i, foodId: 'chicken_breast', weightRange: [120, 220] },
  { pattern: /oat|porridge/i, foodId: 'oatmeal', weightRange: [150, 300] },
  { pattern: /egg/i, foodId: 'whole_egg', weightRange: [45, 60] }
];

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(hash, 31) + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function detectFoodFromImage(imageDataUrl, filename) {
  const nameHint = VISION_FOOD_PROFILES.find((p) => p.pattern.test(filename || ''));
  // Sample the payload sparsely (start/middle/end + length) instead of hashing
  // the full base64 string, which can be several megabytes for a phone photo.
  const sampleLen = 4000;
  const sample =
    imageDataUrl.length <= sampleLen * 3
      ? imageDataUrl
      : imageDataUrl.slice(0, sampleLen) +
        imageDataUrl.slice(Math.floor(imageDataUrl.length / 2), Math.floor(imageDataUrl.length / 2) + sampleLen) +
        imageDataUrl.slice(-sampleLen);
  const hash = hashString(sample + imageDataUrl.length);

  const profile = nameHint || VISION_FOOD_PROFILES[hash % VISION_FOOD_PROFILES.length];
  const [minGrams, maxGrams] = profile.weightRange;
  const grams = minGrams + (hash % (maxGrams - minGrams + 1));
  const confidence = nameHint ? 96 + (hash % 4) : 84 + (hash % 12);

  return { food: findFood(profile.foodId), grams, confidence };
}

function computeFromGrams(food, grams) {
  const factor = grams / 100;
  const result = { calories: Math.round(food.kcal * factor) };
  for (const key of ['protein', 'carbs', 'fat', ...MICRO_FIELDS]) {
    result[key] = Math.round((food[key] || 0) * factor * 10) / 10;
  }
  return result;
}

function emptyTotals() {
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const key of MICRO_FIELDS) totals[key] = 0;
  return totals;
}

function computeTotals(entries) {
  return entries.reduce((totals, e) => {
    totals.calories += e.calories;
    totals.protein += e.protein;
    totals.carbs += e.carbs;
    totals.fat += e.fat;
    for (const key of MICRO_FIELDS) totals[key] += e[key] || 0;
    return totals;
  }, emptyTotals());
}

function isValidCustomFood(customFood) {
  if (!customFood || typeof customFood.name !== 'string' || !customFood.name.trim()) {
    return false;
  }
  return ['kcal', 'protein', 'carbs', 'fat'].every(
    (key) => typeof customFood[key] === 'number' && !Number.isNaN(customFood[key]) && customFood[key] >= 0
  );
}

function validateEntryBody(body) {
  const errors = [];
  if (body.foodId === CUSTOM_FOOD_ID) {
    if (!isValidCustomFood(body.customFood)) {
      errors.push('customFood must include a non-empty name and non-negative kcal/protein/carbs/fat per 100g');
    }
  } else if (!findFood(body.foodId)) {
    errors.push(`foodId must be one of: ${FOOD_DB.map((f) => f.id).join(', ')}, or ${CUSTOM_FOOD_ID}`);
  }
  if (!MEALS.includes(body.meal)) {
    errors.push(`meal must be one of: ${MEALS.join(', ')}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date || '')) {
    errors.push('date must be in YYYY-MM-DD format');
  }
  const grams = body.grams;
  if (typeof grams !== 'number' || Number.isNaN(grams) || grams <= 0) {
    errors.push('grams must be a positive number');
  }
  return errors;
}

// ---------- Auth ----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return { salt, hash };
}

function verifyPassword(password, salt, hash) {
  const candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const stored = Buffer.from(hash, 'hex');
  return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
}

function defaultUserData() {
  return {
    settings: {
      calorieGoal: 2200,
      macroGoals: { protein: 150, carbs: 250, fat: 70 },
      heightCm: null,
      targetWeightKg: null,
      activityLevel: 'moderate',
      fitnessGoal: 'maintain',
      ageYears: null,
      weeklyGoalLbs: 1,
      workoutsPerWeek: 3,
      minutesPerWorkout: 45,
      bio: '',
      location: '',
      // Profile Settings sub-view
      displayName: '',
      currentWeightKg: null,
      customCalorieTargets: { rest: 2000, moderate: 2200, active: 2500 },
      // Dynamic Day Type Selector & Calorie Target Engine (Today dashboard capsule)
      dayTypeTargets: {
        rest: { ...DEFAULT_DAY_TYPE_TARGETS.rest },
        work: { ...DEFAULT_DAY_TYPE_TARGETS.work },
        gym: { ...DEFAULT_DAY_TYPE_TARGETS.gym }
      },
      activeDayType: null,
      // Diary Settings sub-view
      diary: { showDecimalMacros: false, quickAddEnabled: false, multiAddDefault: false },
      // Start of the Week sub-view
      weekStart: 'monday',
      // Sharing & Privacy sub-view
      sharing: { diarySharing: 'private', profileSearchable: false },
      // Push Notifications sub-view — MyFitnessPal-style social/activity toggles
      notifications: {
        newMessage: true,
        newFriendRequest: true,
        friendWorkoutLog: true,
        friendLoginStreak: true,
        stepGoalReached: true,
        quietHours: false
      }
    },
    entries: [],
    water: {},
    weightLogs: [],
    stepsLogs: [],
    sleepLogs: [],
    exerciseLogs: [],
    routines: [],
    customExercises: [],
    fasting: { protocol: '16:8', activeSession: null },
    reminders: DEFAULT_REMINDERS.map((r) => ({ id: r.key, ...r, enabled: true })),
    devices: {
      appleHealth: false,
      googleFit: false,
      manualEntry: false,
      garmin: false,
      fitbit: false,
      strava: false,
      myFitnessPal: false
    },
    savedMeals: [],
    savedRecipes: [],
    savedFoods: [],
    // More > Messages inbox — system messages (e.g. the registration welcome
    // note) plus anything a real messaging feature appends later.
    messages: [],
    // Dynamic food-logging streak engine — see applyStreakUpdate() below.
    currentStreak: 0,
    lastLoggedDate: null,
    // Fresh accounts must complete the first-launch AI Coach onboarding
    // wizard before the dashboard is considered fully set up.
    onboarded: false,
    // The Plan tab's separate 9-step Meal Planner questionnaire — distinct
    // from the AI Coach wizard above. Gates whether tapping "Plan" opens the
    // quiz or goes straight to the generated hub.
    mealPlan: { onboarded: false, preferences: null }
  };
}

// Every freshly created account gets this system note waiting in their
// Messages inbox — pushed onto userdata.messages right after account
// creation, for both password signup and first-time OAuth signup.
function welcomeMessage() {
  return {
    id: crypto.randomUUID(),
    sender: 'Pure Macros Team',
    subject: 'Welcome to the Community',
    body: "Welcome to the Pure Macros community! We built this space to be a safe, supportive place to share your nutrition journey — free of judgment, fad-diet pressure, or unsolicited advice.\n\nHere are a few tips to get the most out of it:\n• Add friends to see their streaks and cheer each other on.\n• Post a win in the community feed, no matter how small — consistency beats perfection.\n• Browse the Learn hub for nutrition basics, training tips, and real success stories from other members.\n\nBefore you dive in, please take a moment to review our Community Guidelines. They're what keep this space respectful and safe for everyone.\n\nWe're glad you're here. Let's hit those daily targets together!",
    date: new Date().toISOString(),
    read: false
  };
}

// Pre-auth installs of this app kept one shared log at the top level of
// db.json. The first account ever registered inherits that data instead of
// starting from a blank dashboard.
function claimLegacyData(db, userId) {
  const hasLegacyEntries = Array.isArray(db.entries) && db.entries.length > 0;
  const hasLegacyWater = db.water && Object.keys(db.water).length > 0;
  const hasLegacyWeights = Array.isArray(db.weightLogs) && db.weightLogs.length > 0;
  const hasLegacySteps = Array.isArray(db.stepsLogs) && db.stepsLogs.length > 0;
  const hasLegacySleep = Array.isArray(db.sleepLogs) && db.sleepLogs.length > 0;
  if (!hasLegacyEntries && !hasLegacyWater && !hasLegacyWeights && !hasLegacySteps && !hasLegacySleep) return;

  const data = db.userdata[userId];
  if (db.settings) data.settings = db.settings;
  data.entries = db.entries || [];
  data.water = db.water || {};
  data.weightLogs = db.weightLogs || [];
  data.stepsLogs = db.stepsLogs || [];
  data.sleepLogs = db.sleepLogs || [];
  db.entries = [];
  db.water = {};
  db.weightLogs = [];
  db.stepsLogs = [];
  db.sleepLogs = [];
}

// Reads the session token, resolves it to a user, and stashes the already-read
// db on req so handlers don't need a second readDb() round trip.
async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  const db = await readDb();
  const userId = db.sessions[token];
  const user = userId && db.users.find((u) => u.id === userId);
  if (!user) {
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }
  req.userId = userId;
  req.token = token;
  req.db = db;
  next();
}

function createSession(db, userId) {
  const token = crypto.randomUUID();
  db.sessions[token] = userId;
  return token;
}

function slugifyUsernameBase(base) {
  return (base || 'user').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'user';
}

function generateUniqueUsername(db, base) {
  const cleaned = slugifyUsernameBase(base);
  const taken = (name) => db.users.some((u) => u.username.toLowerCase() === name.toLowerCase());
  if (!taken(cleaned)) return cleaned;
  let suffix = 1;
  while (taken(`${cleaned}${suffix}`)) suffix += 1;
  return `${cleaned}${suffix}`;
}

// Resolves a verified OAuth identity (Google/Apple) to a user record: an
// existing account already linked to that provider id, an existing
// username/password (or other-provider) account sharing the same verified
// email (so one person doesn't end up with two separate accounts), or a
// freshly created account.
function findOrCreateOAuthUser(db, { provider, providerId, email, name }) {
  const idField = provider === 'google' ? 'googleId' : 'appleId';

  let user = db.users.find((u) => u[idField] === providerId);
  if (user) return user;

  if (email) {
    user = db.users.find((u) => u.email && u.email.toLowerCase() === email.toLowerCase());
    if (user) {
      user[idField] = providerId;
      return user;
    }
  }

  const username = generateUniqueUsername(db, name || (email ? email.split('@')[0] : provider));
  user = {
    id: crypto.randomUUID(),
    username,
    salt: null,
    hash: null,
    email: email || null,
    [idField]: providerId,
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  db.userdata[user.id] = defaultUserData();
  db.userdata[user.id].messages.push(welcomeMessage());
  if (db.users.length === 1) claimLegacyData(db, user.id);
  return user;
}

app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || username.trim().length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters' });
  }
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  const cleanUsername = username.trim();

  const db = await readDb();
  const exists = db.users.some((u) => u.username.toLowerCase() === cleanUsername.toLowerCase());
  if (exists) {
    return res.status(409).json({ error: 'That username is already taken' });
  }

  const { salt, hash } = hashPassword(password);
  const user = { id: crypto.randomUUID(), username: cleanUsername, salt, hash, createdAt: new Date().toISOString() };
  db.users.push(user);
  db.userdata[user.id] = defaultUserData();
  db.userdata[user.id].messages.push(welcomeMessage());
  if (db.users.length === 1) claimLegacyData(db, user.id);

  const token = createSession(db, user.id);
  await writeDb(db);
  res.status(201).json({ token, username: user.username });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const db = await readDb();
  const user = db.users.find((u) => u.username.toLowerCase() === username.trim().toLowerCase());
  if (!user || !user.hash || !verifyPassword(password, user.salt, user.hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  const token = createSession(db, user.id);
  await writeDb(db);
  res.json({ token, username: user.username });
});

// POST /api/auth/google — body: { code } (an authorization code from
// google.accounts.oauth2.initCodeClient's popup flow). Exchanges it for
// tokens with Google (proving this server, not just the browser, is the
// party talking to Google) and verifies the returned ID token's signature.
app.post('/api/auth/google', async (req, res) => {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return res.status(500).json({ error: 'Google sign-in is not configured on this server' });
  }
  const { code } = req.body || {};
  if (typeof code !== 'string' || !code) {
    return res.status(400).json({ error: 'code is required' });
  }
  try {
    const { tokens } = await googleOAuthClient.getToken({ code, redirect_uri: 'postmessage' });
    const ticket = await googleOAuthClient.verifyIdToken({ idToken: tokens.id_token, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload.email_verified) {
      return res.status(401).json({ error: 'Google account email is not verified' });
    }

    const db = await readDb();
    const user = findOrCreateOAuthUser(db, { provider: 'google', providerId: payload.sub, email: payload.email, name: payload.name });
    const token = createSession(db, user.id);
    await writeDb(db);
    res.json({ token, username: user.username });
  } catch (err) {
    res.status(401).json({ error: 'Google sign-in failed' });
  }
});

// POST /api/auth/apple — body: { identityToken, user? } (identityToken and
// the one-time user name payload both come from AppleID.auth.signIn()'s JS
// popup flow). Verifies the identity token's signature against Apple's
// published public keys (https://appleid.apple.com/auth/keys) — this is
// Apple's documented way to authenticate a sign-in from the JS SDK.
app.post('/api/auth/apple', async (req, res) => {
  if (!APPLE_CLIENT_ID) {
    return res.status(500).json({ error: 'Apple sign-in is not configured on this server' });
  }
  const { identityToken, user: appleUserPayload } = req.body || {};
  if (typeof identityToken !== 'string' || !identityToken) {
    return res.status(400).json({ error: 'identityToken is required' });
  }
  try {
    const decoded = await verifyAppleIdentityToken(identityToken);
    // Apple only ever includes the user's name in this one-time client
    // payload on their very first sign-in — never in the token, never again.
    const name = appleUserPayload?.name
      ? [appleUserPayload.name.firstName, appleUserPayload.name.lastName].filter(Boolean).join(' ')
      : null;

    const db = await readDb();
    const user = findOrCreateOAuthUser(db, { provider: 'apple', providerId: decoded.sub, email: decoded.email, name });
    const token = createSession(db, user.id);
    await writeDb(db);
    res.json({ token, username: user.username });
  } catch (err) {
    res.status(401).json({ error: 'Apple sign-in failed' });
  }
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  delete req.db.sessions[req.token];
  await writeDb(req.db);
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = req.db.users.find((u) => u.id === req.userId);
  const onboarded = Boolean(req.db.userdata[req.userId].onboarded);
  res.json({ username: user.username, createdAt: user.createdAt, onboarded });
});

// GET /api/foods — the local 100g-baseline reference database (public — no
// user data involved, and the login screen doesn't need it anyway)
app.get('/api/foods', (req, res) => {
  res.json(FOOD_DB);
});

// GET /api/oauth/config — client IDs are not secret (they're embedded in
// every OAuth request the browser makes anyway); the login screen needs them
// to initialize the Google/Apple JS SDKs before a user has a session.
app.get('/api/oauth/config', (req, res) => {
  res.json({
    googleClientId: GOOGLE_CLIENT_ID || null,
    appleClientId: APPLE_CLIENT_ID || null
  });
});

// ---------- Universal food search (Open Food Facts) ----------
// Open Food Facts is a free, public, crowd-sourced nutrition database
// covering real-world foods worldwide — no API key/signup required. It
// rate-limits aggressively for automated traffic, so results are cached
// briefly in memory to keep repeat/typo-corrected searches fast and to
// avoid tripping that limit while a user is still typing.
const OFF_SEARCH_URL = 'https://world.openfoodfacts.org/api/v2/search';
const OFF_CACHE_TTL_MS = 10 * 60 * 1000;
const OFF_OUTAGE_BACKOFF_MS = 30 * 1000;
const OFF_RESULT_LIMIT = 15;
const foodSearchCache = new Map(); // query -> { at, results }
let lastOffFailureAt = 0;

function mapOpenFoodFactsProduct(product) {
  const n = product.nutriments || {};
  const kcal = n['energy-kcal_100g'];
  const name = (product.product_name || product.generic_name || '').trim();
  if (!name || typeof kcal !== 'number' || Number.isNaN(kcal)) return null;
  const brand = (product.brands || '').split(',')[0].trim();
  return {
    id: `off_${product.code || hashString(name)}`,
    name: brand ? `${name} (${brand})` : name,
    kcal: Math.round(kcal),
    protein: Math.round((n.proteins_100g || 0) * 10) / 10,
    carbs: Math.round((n.carbohydrates_100g || 0) * 10) / 10,
    fat: Math.round((n.fat_100g || 0) * 10) / 10,
    source: 'openfoodfacts'
  };
}

// GET /api/foods/search?q=<query> — live per-100g nutrition lookup against
// Open Food Facts, so the client can log any real-world food by name (not
// just the local FOOD_DB list) at whatever gram weight the user enters.
app.get('/api/foods/search', async (req, res) => {
  const query = (req.query.q || '').toString().trim();
  if (query.length < 2) {
    return res.json([]);
  }

  const cacheKey = query.toLowerCase();
  const cached = foodSearchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < OFF_CACHE_TTL_MS) {
    return res.json(cached.results);
  }

  // Open Food Facts rate-limits search traffic aggressively and can go into
  // a temporary "unavailable" state for a stretch afterward. Once that's
  // been observed, fail fast for a short window instead of piling on more
  // requests that would just extend the block.
  if (Date.now() - lastOffFailureAt < OFF_OUTAGE_BACKOFF_MS) {
    return res.status(502).json({ error: 'Nutrition database is temporarily unavailable. Try again shortly.' });
  }

  try {
    const fields = 'code,product_name,generic_name,brands,nutriments';
    const url = `${OFF_SEARCH_URL}?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=${OFF_RESULT_LIMIT}&fields=${fields}`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'PureMacrosApp/1.0 (calorie-tracker-app)' },
      signal: AbortSignal.timeout(7000)
    });
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('json')) {
      throw new Error('Nutrition database returned an unexpected response');
    }
    const data = await response.json();
    const seen = new Set();
    const results = [];
    for (const product of data.products || []) {
      const mapped = mapOpenFoodFactsProduct(product);
      if (!mapped || seen.has(mapped.name)) continue;
      seen.add(mapped.name);
      results.push(mapped);
      if (results.length >= OFF_RESULT_LIMIT) break;
    }
    foodSearchCache.set(cacheKey, { at: Date.now(), results });
    res.json(results);
  } catch (err) {
    lastOffFailureAt = Date.now();
    res.status(502).json({ error: 'Could not reach the nutrition database. Try again in a moment.' });
  }
});

// ---------- Automated Smart Nutrition Lookup Engine ----------
// A small high-accuracy reference dictionary for common staples (keyed by
// keyword match against the typed food name), plus a keyword-classified
// generic fallback for anything else. The fallback's protein/carbs/fat are
// always derived from its kcal via the 4/4/9 calorie-per-gram rule, so the
// macro split balances back to the calorie figure exactly.
const NUTRITION_STAPLE_DICTIONARY = [
  { keywords: ['chicken breast', 'chicken'], name: 'Chicken Breast', kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
  { keywords: ['white rice', 'cooked rice', 'rice'], name: 'Cooked White Rice', kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  { keywords: ['oatmeal', 'oats'], name: 'Oatmeal', kcal: 389, protein: 16.9, carbs: 66, fat: 6.9 },
  { keywords: ['egg'], name: 'Whole Egg', kcal: 155, protein: 13, carbs: 1.1, fat: 11 },
  { keywords: ['banana'], name: 'Banana', kcal: 89, protein: 1.1, carbs: 23, fat: 0.3 }
];

// kcal here is a rough per-100g density guess by food category; the macro
// split (protein/carbs/fat fractions of kcal) always sums to 1.
const NUTRITION_GENERIC_PROFILES = [
  { keywords: ['chicken', 'beef', 'steak', 'turkey', 'pork', 'meat', 'fish', 'salmon', 'tuna', 'whey', 'protein', 'goat'], kcal: 165, protein: 0.5, carbs: 0.2, fat: 0.3 },
  { keywords: ['rice', 'bread', 'oat', 'pasta', 'potato', 'flour', 'sugar', 'fruit', 'juice', 'yam', 'cassava'], kcal: 200, protein: 0.15, carbs: 0.7, fat: 0.15 },
  { keywords: ['oil', 'butter', 'avocado', 'nuts', 'almond', 'peanut', 'cheese', 'mayo', 'dressing', 'lard'], kcal: 500, protein: 0.15, carbs: 0.15, fat: 0.7 }
];
const NUTRITION_GENERIC_DEFAULT = { kcal: 200, protein: 0.3, carbs: 0.4, fat: 0.3 };

function findStapleNutrition(lowerName) {
  return NUTRITION_STAPLE_DICTIONARY.find((entry) => entry.keywords.some((kw) => lowerName.includes(kw))) || null;
}

function estimateGenericNutrition(foodName, lowerName) {
  const profile = NUTRITION_GENERIC_PROFILES.find((p) => p.keywords.some((kw) => lowerName.includes(kw))) || NUTRITION_GENERIC_DEFAULT;
  const kcal = profile.kcal;
  return {
    name: foodName,
    kcal,
    protein: Math.round(((kcal * profile.protein) / 4) * 10) / 10,
    carbs: Math.round(((kcal * profile.carbs) / 4) * 10) / 10,
    fat: Math.round(((kcal * profile.fat) / 9) * 10) / 10,
    source: 'generic'
  };
}

// POST /api/estimate-nutrition — body: { foodName }. Returns a per-100g
// { name, kcal, protein, carbs, fat, source } estimate for a typed food name:
// a match against NUTRITION_STAPLE_DICTIONARY, or a generic 4/4/9-balanced
// fallback otherwise. Used by the meal-logging forms' custom-food fields to
// auto-populate macros as the user types a food name.
app.post('/api/estimate-nutrition', (req, res) => {
  const foodName = ((req.body && req.body.foodName) || '').toString().trim();
  if (!foodName) {
    return res.status(400).json({ error: 'foodName is required' });
  }
  const lowerName = foodName.toLowerCase();
  const staple = findStapleNutrition(lowerName);
  if (staple) {
    return res.json({ name: staple.name, kcal: staple.kcal, protein: staple.protein, carbs: staple.carbs, fat: staple.fat, source: 'staple' });
  }
  res.json(estimateGenericNutrition(foodName, lowerName));
});

// POST /api/vision/scan — body: { image: "data:image/...;base64,...", filename? }
// Simulated high-precision food detector. See detectFoodFromImage() above for
// why this doesn't call an external vision API.
app.post('/api/vision/scan', requireAuth, (req, res) => {
  const { image, filename } = req.body || {};
  if (typeof image !== 'string' || !/^data:image\/[a-z0-9.+-]+;base64,/i.test(image)) {
    return res.status(400).json({ error: 'image must be a base64 data URL (e.g. data:image/jpeg;base64,...)' });
  }

  const { food, grams, confidence } = detectFoodFromImage(image, filename);
  const macros = computeFromGrams(food, grams);

  res.json({
    foodId: food.id,
    name: food.name,
    confidence,
    grams,
    ...macros
  });
});

// ---------- Settings Generic Engine ----------
// PUT /api/settings accepts any subset of recognized fields — user
// preferences, toggle options, and calorie targets — and merges them onto
// the existing settings object. Every field is optional and independently
// validated only when present, so each settings sub-view (Profile, Diary,
// Sharing & Privacy, ...) can PUT just the slice it owns without needing to
// resend the rest of the settings object. Push Notifications has its own
// dedicated POST /api/settings/notifications route below instead.
const SETTINGS_VALIDATORS = {
  calorieGoal: (v) => typeof v === 'number' && !Number.isNaN(v) && v > 0,
  macroGoals: (v) =>
    v && typeof v === 'object' &&
    ['protein', 'carbs', 'fat'].every((k) => typeof v[k] === 'number' && !Number.isNaN(v[k]) && v[k] >= 0),
  heightCm: (v) => v === null || (typeof v === 'number' && !Number.isNaN(v) && v > 0),
  targetWeightKg: (v) => v === null || (typeof v === 'number' && !Number.isNaN(v) && v > 0),
  currentWeightKg: (v) => v === null || (typeof v === 'number' && !Number.isNaN(v) && v > 0),
  activityLevel: (v) => ACTIVITY_LEVELS.includes(v),
  fitnessGoal: (v) => FITNESS_GOALS.includes(v),
  bio: (v) => typeof v === 'string',
  location: (v) => typeof v === 'string',
  displayName: (v) => typeof v === 'string',
  weekStart: (v) => WEEK_START_OPTIONS.includes(v),
  customCalorieTargets: (v) =>
    v && typeof v === 'object' &&
    ['rest', 'moderate', 'active'].every((k) => typeof v[k] === 'number' && !Number.isNaN(v[k]) && v[k] > 0),
  activeDayType: (v) => v === null || DAY_TYPES.includes(v),
  dayTypeTargets: (v) =>
    v && typeof v === 'object' &&
    DAY_TYPES.every((dayType) =>
      v[dayType] && typeof v[dayType] === 'object' &&
      (v[dayType].label === undefined || typeof v[dayType].label === 'string') &&
      ['calories', 'protein', 'carbs', 'fat'].every((k) => typeof v[dayType][k] === 'number' && !Number.isNaN(v[dayType][k]) && v[dayType][k] > 0)
    ),
  diary: (v) =>
    v && typeof v === 'object' &&
    ['showDecimalMacros', 'quickAddEnabled', 'multiAddDefault'].every((k) => typeof v[k] === 'boolean'),
  sharing: (v) =>
    v && typeof v === 'object' &&
    DIARY_SHARING_OPTIONS.includes(v.diarySharing) && typeof v.profileSearchable === 'boolean'
};

// Push Notifications sub-view (Settings > Push Notifications) — 6 independent
// social/activity notification toggles, matching the MyFitnessPal checklist.
const NOTIFICATION_KEYS = [
  'newMessage',
  'newFriendRequest',
  'friendWorkoutLog',
  'friendLoginStreak',
  'stepGoalReached',
  'quietHours'
];

// bio/location/displayName are free text — clamp length instead of rejecting.
const SETTINGS_TEXT_LIMITS = { bio: 500, location: 120, displayName: 80 };

// GET /api/settings
app.get('/api/settings', requireAuth, async (req, res) => {
  res.json(req.db.userdata[req.userId].settings);
});

// PUT /api/settings — body: a partial object of any SETTINGS_VALIDATORS keys, merged in
app.put('/api/settings', requireAuth, async (req, res) => {
  const updates = req.body || {};
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    return res.status(400).json({ error: 'body must contain at least one settings field' });
  }

  const errors = [];
  for (const key of keys) {
    const validator = SETTINGS_VALIDATORS[key];
    if (!validator) {
      errors.push(`unrecognized settings field: ${key}`);
      continue;
    }
    if (!validator(updates[key])) {
      errors.push(`invalid value for ${key}`);
    }
  }
  if (errors.length) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  const data = req.db.userdata[req.userId];
  for (const key of keys) {
    const limit = SETTINGS_TEXT_LIMITS[key];
    data.settings[key] = limit ? updates[key].slice(0, limit) : updates[key];
  }
  await writeDb(req.db);
  res.json(data.settings);
});

// POST /api/settings/notifications — body: partial object of NOTIFICATION_KEYS
// booleans. Dedicated save path for the Push Notifications sub-view: merges
// just the provided flags into settings.notifications and persists through
// the same atomic writeDb used by every other route.
app.post('/api/settings/notifications', requireAuth, async (req, res) => {
  const updates = req.body || {};
  const keys = Object.keys(updates);
  if (keys.length === 0) {
    return res.status(400).json({ error: 'body must contain at least one notification field' });
  }

  const errors = [];
  for (const key of keys) {
    if (!NOTIFICATION_KEYS.includes(key)) {
      errors.push(`unrecognized notification field: ${key}`);
      continue;
    }
    if (typeof updates[key] !== 'boolean') {
      errors.push(`${key} must be a boolean`);
    }
  }
  if (errors.length) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  const data = req.db.userdata[req.userId];
  data.settings.notifications = { ...data.settings.notifications, ...updates };
  await writeDb(req.db);
  res.json(data.settings);
});

// POST /api/settings/active-day-type — body: { dayType: 'rest'|'work'|'gym' }
// Sets which day-type configuration is active; the Today dashboard (GET
// /api/day) substitutes that configuration's saved calorie/macro targets in
// place of the base calorieGoal/macroGoals for as long as it stays active.
app.post('/api/settings/active-day-type', requireAuth, async (req, res) => {
  const { dayType } = req.body || {};
  if (!DAY_TYPES.includes(dayType)) {
    return res.status(400).json({ error: `dayType must be one of: ${DAY_TYPES.join(', ')}` });
  }
  const data = req.db.userdata[req.userId];
  data.settings.activeDayType = dayType;
  await writeDb(req.db);
  res.json(data.settings);
});

// POST /api/settings/update — body: { profiles: [{ key: 'rest'|'work'|'gym', label, calories, protein, carbs, fat }, ...] }
// Dedicated save path for the Target Profiles editor (Goals -> Nutrition Goals
// -> "Calorie, Carbs, Protein and Fat Goals"): saves all edited Rest/Work/Gym
// profiles in one call, replacing just those keys of dayTypeTargets and
// persisting through the same atomic writeDb used by every other route.
app.post('/api/settings/update', requireAuth, async (req, res) => {
  const { profiles } = req.body || {};
  if (!Array.isArray(profiles) || profiles.length === 0) {
    return res.status(400).json({ error: 'profiles must be a non-empty array' });
  }

  const errors = [];
  for (const p of profiles) {
    if (!p || !DAY_TYPES.includes(p.key)) {
      errors.push(`profile key must be one of: ${DAY_TYPES.join(', ')}`);
      continue;
    }
    if (typeof p.label !== 'string' || !p.label.trim()) {
      errors.push(`${p.key}: label is required`);
    }
    for (const field of ['calories', 'protein', 'carbs', 'fat']) {
      if (typeof p[field] !== 'number' || Number.isNaN(p[field]) || p[field] <= 0) {
        errors.push(`${p.key}: ${field} must be a positive number`);
      }
    }
  }
  if (errors.length) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  const data = req.db.userdata[req.userId];
  const dayTypeTargets = { ...data.settings.dayTypeTargets };
  for (const p of profiles) {
    dayTypeTargets[p.key] = {
      label: p.label.trim().slice(0, 40),
      calories: p.calories,
      protein: p.protein,
      carbs: p.carbs,
      fat: p.fat
    };
  }
  data.settings.dayTypeTargets = dayTypeTargets;
  await writeDb(req.db);
  res.json(data.settings);
});

// GET /api/entries?date=YYYY-MM-DD
app.get('/api/entries', requireAuth, async (req, res) => {
  const date = req.query.date || todayStr();
  const entries = req.db.userdata[req.userId].entries.filter((e) => e.date === date);
  res.json(entries);
});

// POST /api/entries — body: { date, meal, foodId, grams }
// Calories/macros are always derived server-side from the FOOD_DB baseline
// (kcal per 100g) times (grams / 100); client-supplied macro values are ignored.
app.post('/api/entries', requireAuth, async (req, res) => {
  const body = req.body || {};
  const errors = validateEntryBody(body);
  if (errors.length) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  const isCustom = body.foodId === CUSTOM_FOOD_ID;
  const food = isCustom
    ? {
        name: body.customFood.name.trim(),
        kcal: body.customFood.kcal,
        protein: body.customFood.protein,
        carbs: body.customFood.carbs,
        fat: body.customFood.fat
      }
    : findFood(body.foodId);
  const grams = Number(body.grams);
  const macros = computeFromGrams(food, grams);

  const entry = {
    id: crypto.randomUUID(),
    date: body.date,
    meal: body.meal,
    foodId: isCustom ? CUSTOM_FOOD_ID : food.id,
    name: food.name,
    grams,
    ...macros,
    createdAt: new Date().toISOString()
  };

  const data = req.db.userdata[req.userId];
  data.entries.push(entry);
  applyStreakUpdate(data, todayStr());
  await writeDb(req.db);
  res.status(201).json(entry);
});

// GET /api/streak — current dynamic food-logging streak, for the header badge
app.get('/api/streak', requireAuth, async (req, res) => {
  res.json({ currentStreak: req.db.userdata[req.userId].currentStreak || 0 });
});

// GET /api/messages — the More > Messages inbox (system notes like the
// registration welcome message, newest first).
app.get('/api/messages', requireAuth, async (req, res) => {
  const messages = [...req.db.userdata[req.userId].messages].sort((a, b) => new Date(b.date) - new Date(a.date));
  res.json(messages);
});

// PUT /api/messages/:id/read — marks one inbox message read (drives the More
// tab's unread badge count).
app.put('/api/messages/:id/read', requireAuth, async (req, res) => {
  const message = req.db.userdata[req.userId].messages.find((m) => m.id === req.params.id);
  if (!message) return res.status(404).json({ error: 'Message not found' });
  message.read = true;
  await writeDb(req.db);
  res.json(message);
});

// DELETE /api/entries/:id
app.delete('/api/entries/:id', requireAuth, async (req, res) => {
  const entries = req.db.userdata[req.userId].entries;
  const idx = entries.findIndex((e) => e.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: 'entry not found' });
  }
  const [removed] = entries.splice(idx, 1);
  await writeDb(req.db);
  res.json(removed);
});

// Water is stored server-side as total ounces per date (water[date] is a
// plain number). The Today tab's 8-cup hydration grid maps onto this at a
// standard 8oz-per-cup, which conveniently matches the classic "8x8" daily
// water rule (8 cups x 8oz = 64oz) — so "filled" is always derivable rather
// than stored separately.
const OZ_PER_CUP = 8;
const MAX_WATER_OZ = 400;

function ouncesToFilledCups(ounces) {
  return Math.min(8, Math.round(ounces / OZ_PER_CUP));
}

// GET /api/water?date=YYYY-MM-DD — ounces logged plus the derived filled cup
// count for the hydration tracker
app.get('/api/water', requireAuth, async (req, res) => {
  const date = req.query.date || todayStr();
  const ounces = req.db.userdata[req.userId].water[date] || 0;
  res.json({ date, ounces, filled: ouncesToFilledCups(ounces) });
});

// PUT /api/water — body: { date, ounces } sets the day's total ounces.
// { date, filled } is also accepted (cup-grid clicks on the Today tab),
// converted to ounces at 8oz/cup.
app.put('/api/water', requireAuth, async (req, res) => {
  const { date, ounces, filled } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
  }

  let resolvedOunces;
  if (ounces !== undefined) {
    if (typeof ounces !== 'number' || Number.isNaN(ounces) || ounces < 0 || ounces > MAX_WATER_OZ) {
      return res.status(400).json({ error: `ounces must be a number between 0 and ${MAX_WATER_OZ}` });
    }
    resolvedOunces = Math.round(ounces * 10) / 10;
  } else if (filled !== undefined) {
    if (typeof filled !== 'number' || !Number.isInteger(filled) || filled < 0 || filled > 8) {
      return res.status(400).json({ error: 'filled must be an integer between 0 and 8' });
    }
    resolvedOunces = filled * OZ_PER_CUP;
  } else {
    return res.status(400).json({ error: 'ounces or filled is required' });
  }

  req.db.userdata[req.userId].water[date] = resolvedOunces;
  await writeDb(req.db);
  res.json({ date, ounces: resolvedOunces, filled: ouncesToFilledCups(resolvedOunces) });
});

// GET /api/weights — logged body-weight history, most recent first
app.get('/api/weights', requireAuth, async (req, res) => {
  const weights = [...req.db.userdata[req.userId].weightLogs].sort((a, b) => b.date.localeCompare(a.date));
  res.json(weights);
});

// POST /api/weights — body: { date, weight, photo? }. One entry per date;
// logging again for the same date updates that entry instead of creating a
// duplicate. photo (optional) is a base64 image data URL, same shape as the
// vision-scan upload — a progress photo attached to that day's weigh-in.
app.post('/api/weights', requireAuth, async (req, res) => {
  const { date, weight, photo } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
  }
  if (typeof weight !== 'number' || Number.isNaN(weight) || weight <= 0) {
    return res.status(400).json({ error: 'weight must be a positive number' });
  }
  if (photo !== undefined && photo !== null && !/^data:image\/[a-z0-9.+-]+;base64,/i.test(photo)) {
    return res.status(400).json({ error: 'photo must be a base64 image data URL' });
  }

  const weightLogs = req.db.userdata[req.userId].weightLogs;
  const existing = weightLogs.find((w) => w.date === date);
  let entry;
  if (existing) {
    existing.weight = weight;
    if (photo !== undefined) existing.photo = photo || null;
    existing.createdAt = new Date().toISOString();
    entry = existing;
  } else {
    entry = { id: crypto.randomUUID(), date, weight, photo: photo || null, createdAt: new Date().toISOString() };
    weightLogs.push(entry);
  }
  await writeDb(req.db);
  res.status(201).json(entry);
});

// DELETE /api/weights/:id
app.delete('/api/weights/:id', requireAuth, async (req, res) => {
  const weightLogs = req.db.userdata[req.userId].weightLogs;
  const idx = weightLogs.findIndex((w) => w.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: 'weight entry not found' });
  }
  const [removed] = weightLogs.splice(idx, 1);
  await writeDb(req.db);
  res.json(removed);
});

// POST /api/coach/plan — body: { heightCm, weightKg, ageYears, activityLevel,
// fitnessGoal }. Runs the AI Fitness Coach's BMR/TDEE formulation, persists
// the resulting calorie/macro goals plus the submitted profile fields onto
// settings, upserts today's weight log (same upsert-by-date rule as
// POST /api/weights), and returns the updated settings. Used by both the
// first-launch onboarding wizard and the later "Manage Goals" recalculation.
app.post('/api/coach/plan', requireAuth, async (req, res) => {
  const { heightCm, weightKg, ageYears, activityLevel, fitnessGoal } = req.body || {};
  if (typeof heightCm !== 'number' || Number.isNaN(heightCm) || heightCm <= 0) {
    return res.status(400).json({ error: 'heightCm must be a positive number' });
  }
  if (typeof weightKg !== 'number' || Number.isNaN(weightKg) || weightKg <= 0) {
    return res.status(400).json({ error: 'weightKg must be a positive number' });
  }
  if (typeof ageYears !== 'number' || !Number.isInteger(ageYears) || ageYears < MIN_AGE_YEARS || ageYears > MAX_AGE_YEARS) {
    return res.status(400).json({ error: `ageYears must be an integer between ${MIN_AGE_YEARS} and ${MAX_AGE_YEARS}` });
  }
  if (!ACTIVITY_LEVELS.includes(activityLevel)) {
    return res.status(400).json({ error: `activityLevel must be one of: ${ACTIVITY_LEVELS.join(', ')}` });
  }
  if (!FITNESS_GOALS.includes(fitnessGoal)) {
    return res.status(400).json({ error: `fitnessGoal must be one of: ${FITNESS_GOALS.join(', ')}` });
  }

  const { calorieGoal, macroGoals } = computeCoachPlan({ weightKg, heightCm, ageYears, activityLevel, fitnessGoal });

  const data = req.db.userdata[req.userId];
  data.settings = {
    ...data.settings,
    calorieGoal,
    macroGoals,
    heightCm,
    ageYears,
    activityLevel,
    fitnessGoal
  };

  const today = todayStr();
  const weightLogs = data.weightLogs;
  const existing = weightLogs.find((w) => w.date === today);
  if (existing) {
    existing.weight = weightKg;
    existing.createdAt = new Date().toISOString();
  } else {
    weightLogs.push({ id: crypto.randomUUID(), date: today, weight: weightKg, createdAt: new Date().toISOString() });
  }

  await writeDb(req.db);
  res.json(data.settings);
});

// POST /api/onboarding/complete — marks the first-launch AI Coach wizard as
// finished so it doesn't reappear on future logins.
app.post('/api/onboarding/complete', requireAuth, async (req, res) => {
  req.db.userdata[req.userId].onboarded = true;
  await writeDb(req.db);
  res.json({ onboarded: true });
});

// GET /api/plan — the Plan tab's 9-step Meal Planner quiz state
app.get('/api/plan', requireAuth, async (req, res) => {
  const data = req.db.userdata[req.userId];
  if (!data.mealPlan) data.mealPlan = { onboarded: false, preferences: null };
  res.json(data.mealPlan);
});

// PUT /api/plan — body: { preferences }. Persists the full quiz answer set
// (goal, metrics, psychology, food preferences/restrictions, kitchen/skill,
// sourcing, calibration feedback + servings, priority weightings) as one
// opaque blob and marks the Meal Planner wizard complete.
app.put('/api/plan', requireAuth, async (req, res) => {
  const { preferences } = req.body || {};
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    return res.status(400).json({ error: 'preferences must be an object' });
  }
  const data = req.db.userdata[req.userId];
  data.mealPlan = { onboarded: true, preferences };
  await writeDb(req.db);
  res.json(data.mealPlan);
});

// GET /api/steps — logged daily step counts, most recent first
app.get('/api/steps', requireAuth, async (req, res) => {
  const steps = [...req.db.userdata[req.userId].stepsLogs].sort((a, b) => b.date.localeCompare(a.date));
  res.json(steps);
});

// POST /api/steps — body: { date, steps }. One entry per date; logging again
// for the same date updates that entry instead of creating a duplicate.
app.post('/api/steps', requireAuth, async (req, res) => {
  const { date, steps } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
  }
  if (typeof steps !== 'number' || !Number.isInteger(steps) || steps < 0 || steps > 200000) {
    return res.status(400).json({ error: 'steps must be a non-negative integer no greater than 200000' });
  }

  const stepsLogs = req.db.userdata[req.userId].stepsLogs;
  const existing = stepsLogs.find((s) => s.date === date);
  let entry;
  if (existing) {
    existing.steps = steps;
    existing.createdAt = new Date().toISOString();
    entry = existing;
  } else {
    entry = { id: crypto.randomUUID(), date, steps, createdAt: new Date().toISOString() };
    stepsLogs.push(entry);
  }
  await writeDb(req.db);
  res.status(201).json(entry);
});

// DELETE /api/steps/:id
app.delete('/api/steps/:id', requireAuth, async (req, res) => {
  const stepsLogs = req.db.userdata[req.userId].stepsLogs;
  const idx = stepsLogs.findIndex((s) => s.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: 'steps entry not found' });
  }
  const [removed] = stepsLogs.splice(idx, 1);
  await writeDb(req.db);
  res.json(removed);
});

// GET /api/sleep — logged nightly sleep breakdowns, most recent first
app.get('/api/sleep', requireAuth, async (req, res) => {
  const sleep = [...req.db.userdata[req.userId].sleepLogs].sort((a, b) => b.date.localeCompare(a.date));
  res.json(sleep);
});

// POST /api/sleep — body: { date, awakeHours, remHours, coreHours, deepHours }.
// totalHours ("time asleep") is server-computed from rem+core+deep and
// deliberately excludes awakeHours. One entry per date, upsert-by-date.
app.post('/api/sleep', requireAuth, async (req, res) => {
  const { date, awakeHours, remHours, coreHours, deepHours } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
    return res.status(400).json({ error: 'date must be in YYYY-MM-DD format' });
  }
  const phaseFields = { awakeHours, remHours, coreHours, deepHours };
  for (const [key, val] of Object.entries(phaseFields)) {
    if (typeof val !== 'number' || Number.isNaN(val) || val < 0) {
      return res.status(400).json({ error: `${key} must be a non-negative number` });
    }
  }
  const sum = awakeHours + remHours + coreHours + deepHours;
  if (sum > 24) {
    return res.status(400).json({ error: 'Sleep phase hours cannot exceed 24 total' });
  }
  const totalHours = Math.round((remHours + coreHours + deepHours) * 10) / 10;

  const sleepLogs = req.db.userdata[req.userId].sleepLogs;
  const existing = sleepLogs.find((s) => s.date === date);
  let entry;
  if (existing) {
    Object.assign(existing, { awakeHours, remHours, coreHours, deepHours, totalHours, createdAt: new Date().toISOString() });
    entry = existing;
  } else {
    entry = { id: crypto.randomUUID(), date, awakeHours, remHours, coreHours, deepHours, totalHours, createdAt: new Date().toISOString() };
    sleepLogs.push(entry);
  }
  await writeDb(req.db);
  res.status(201).json(entry);
});

// DELETE /api/sleep/:id
app.delete('/api/sleep/:id', requireAuth, async (req, res) => {
  const sleepLogs = req.db.userdata[req.userId].sleepLogs;
  const idx = sleepLogs.findIndex((s) => s.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: 'sleep entry not found' });
  }
  const [removed] = sleepLogs.splice(idx, 1);
  await writeDb(req.db);
  res.json(removed);
});

// ---------- Exercise (Add Exercise sheet: Cardio / Strength blocks) ----------
const EXERCISE_TYPES = ['cardio', 'strength'];

// Accounts created before this feature shipped have no exerciseLogs array.
function getExerciseLogs(data) {
  if (!Array.isArray(data.exerciseLogs)) data.exerciseLogs = [];
  return data.exerciseLogs;
}

// GET /api/exercise?date=YYYY-MM-DD — today's (or a given date's) logged
// exercise entries, most recent first
app.get('/api/exercise', requireAuth, async (req, res) => {
  const date = req.query.date || todayStr();
  const entries = getExerciseLogs(req.db.userdata[req.userId])
    .filter((e) => e.date === date)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(entries);
});

// POST /api/exercise — body: { date, type, name, minutes, caloriesBurned }
app.post('/api/exercise', requireAuth, async (req, res) => {
  const { date, type, name, minutes, caloriesBurned } = req.body || {};
  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) errors.push('date must be in YYYY-MM-DD format');
  if (!EXERCISE_TYPES.includes(type)) errors.push(`type must be one of: ${EXERCISE_TYPES.join(', ')}`);
  if (typeof name !== 'string' || !name.trim()) errors.push('name is required');
  if (typeof minutes !== 'number' || Number.isNaN(minutes) || minutes <= 0) errors.push('minutes must be a positive number');
  if (typeof caloriesBurned !== 'number' || Number.isNaN(caloriesBurned) || caloriesBurned < 0) errors.push('caloriesBurned must be a non-negative number');
  if (errors.length) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  const entry = {
    id: crypto.randomUUID(),
    date,
    type,
    name: name.trim(),
    minutes: Math.round(minutes),
    caloriesBurned: Math.round(caloriesBurned),
    createdAt: new Date().toISOString()
  };
  getExerciseLogs(req.db.userdata[req.userId]).push(entry);
  await writeDb(req.db);
  res.status(201).json(entry);
});

// DELETE /api/exercise/:id
app.delete('/api/exercise/:id', requireAuth, async (req, res) => {
  const exerciseLogs = getExerciseLogs(req.db.userdata[req.userId]);
  const idx = exerciseLogs.findIndex((e) => e.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: 'exercise entry not found' });
  }
  const [removed] = exerciseLogs.splice(idx, 1);
  await writeDb(req.db);
  res.json(removed);
});

// ---------- My Exercises (Settings > My Exercises custom activity presets) ----------
// Distinct from exerciseLogs (a day's logged cardio/strength minutes): this is
// a reusable library of custom activities with a calories-burned-per-minute
// rate, defined once from the settings sub-view.
function getCustomExercises(data) {
  if (!Array.isArray(data.customExercises)) data.customExercises = [];
  return data.customExercises;
}

// GET /api/custom-exercises
app.get('/api/custom-exercises', requireAuth, async (req, res) => {
  res.json(getCustomExercises(req.db.userdata[req.userId]));
});

// POST /api/custom-exercises — body: { name, caloriesPerMinute }
app.post('/api/custom-exercises', requireAuth, async (req, res) => {
  const { name, caloriesPerMinute } = req.body || {};
  const errors = [];
  if (typeof name !== 'string' || !name.trim()) errors.push('name is required');
  if (typeof caloriesPerMinute !== 'number' || Number.isNaN(caloriesPerMinute) || caloriesPerMinute <= 0) {
    errors.push('caloriesPerMinute must be a positive number');
  }
  if (errors.length) {
    return res.status(400).json({ error: errors.join('; ') });
  }

  const exercise = {
    id: crypto.randomUUID(),
    name: name.trim(),
    caloriesPerMinute,
    createdAt: new Date().toISOString()
  };
  getCustomExercises(req.db.userdata[req.userId]).push(exercise);
  await writeDb(req.db);
  res.status(201).json(exercise);
});

// DELETE /api/custom-exercises/:id
app.delete('/api/custom-exercises/:id', requireAuth, async (req, res) => {
  const exercises = getCustomExercises(req.db.userdata[req.userId]);
  const idx = exercises.findIndex((e) => e.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: 'custom exercise not found' });
  }
  const [removed] = exercises.splice(idx, 1);
  await writeDb(req.db);
  res.json(removed);
});

// ---------- Workout Routines ----------
// GET /api/routines
app.get('/api/routines', requireAuth, async (req, res) => {
  res.json(req.db.userdata[req.userId].routines);
});

// POST /api/routines — body: { name, exercises: [{ name, sets, reps }] }
app.post('/api/routines', requireAuth, async (req, res) => {
  const { name, exercises } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!Array.isArray(exercises) || exercises.length === 0) {
    return res.status(400).json({ error: 'exercises must be a non-empty array' });
  }
  for (const ex of exercises) {
    if (!ex || typeof ex.name !== 'string' || !ex.name.trim()) {
      return res.status(400).json({ error: 'each exercise needs a name' });
    }
    if (typeof ex.sets !== 'number' || !Number.isInteger(ex.sets) || ex.sets <= 0) {
      return res.status(400).json({ error: 'each exercise needs a positive integer sets count' });
    }
    if (typeof ex.reps !== 'number' || !Number.isInteger(ex.reps) || ex.reps <= 0) {
      return res.status(400).json({ error: 'each exercise needs a positive integer reps count' });
    }
  }

  const routine = {
    id: crypto.randomUUID(),
    name: name.trim(),
    exercises: exercises.map((ex) => ({ name: ex.name.trim(), sets: ex.sets, reps: ex.reps })),
    createdAt: new Date().toISOString()
  };
  req.db.userdata[req.userId].routines.push(routine);
  await writeDb(req.db);
  res.status(201).json(routine);
});

// DELETE /api/routines/:id
app.delete('/api/routines/:id', requireAuth, async (req, res) => {
  const routines = req.db.userdata[req.userId].routines;
  const idx = routines.findIndex((r) => r.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ error: 'routine not found' });
  }
  const [removed] = routines.splice(idx, 1);
  await writeDb(req.db);
  res.json(removed);
});

// ---------- Intermittent Fasting ----------
// GET /api/fasting
app.get('/api/fasting', requireAuth, async (req, res) => {
  res.json(req.db.userdata[req.userId].fasting);
});

// POST /api/fasting/start — body: { protocol, goalHours }
app.post('/api/fasting/start', requireAuth, async (req, res) => {
  const { protocol, goalHours } = req.body || {};
  if (!FASTING_PROTOCOLS.includes(protocol)) {
    return res.status(400).json({ error: `protocol must be one of: ${FASTING_PROTOCOLS.join(', ')}` });
  }
  if (typeof goalHours !== 'number' || Number.isNaN(goalHours) || goalHours <= 0 || goalHours > 72) {
    return res.status(400).json({ error: 'goalHours must be a positive number no greater than 72' });
  }

  const data = req.db.userdata[req.userId];
  data.fasting = {
    protocol,
    activeSession: { startedAt: new Date().toISOString(), goalHours }
  };
  await writeDb(req.db);
  res.json(data.fasting);
});

// POST /api/fasting/end
app.post('/api/fasting/end', requireAuth, async (req, res) => {
  const data = req.db.userdata[req.userId];
  data.fasting.activeSession = null;
  await writeDb(req.db);
  res.json(data.fasting);
});

// ---------- Reminders ----------
// GET /api/reminders
app.get('/api/reminders', requireAuth, async (req, res) => {
  res.json(req.db.userdata[req.userId].reminders);
});

// PUT /api/reminders/:id — body: { enabled?, time? }
app.put('/api/reminders/:id', requireAuth, async (req, res) => {
  const reminders = req.db.userdata[req.userId].reminders;
  const reminder = reminders.find((r) => r.id === req.params.id);
  if (!reminder) {
    return res.status(404).json({ error: 'reminder not found' });
  }
  const { enabled, time } = req.body || {};
  if (enabled !== undefined) {
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    reminder.enabled = enabled;
  }
  if (time !== undefined) {
    if (!/^\d{2}:\d{2}$/.test(time || '')) {
      return res.status(400).json({ error: 'time must be in HH:MM format' });
    }
    reminder.time = time;
  }
  await writeDb(req.db);
  res.json(reminder);
});

// ---------- Apps & Devices ----------
// GET /api/devices
app.get('/api/devices', requireAuth, async (req, res) => {
  res.json(req.db.userdata[req.userId].devices);
});

// PUT /api/devices — body: a partial object of { [DEVICE_KEYS]: boolean }, merged in
app.put('/api/devices', requireAuth, async (req, res) => {
  const updates = req.body || {};
  const keys = Object.keys(updates);
  if (keys.length === 0 || keys.some((k) => !DEVICE_KEYS.includes(k) || typeof updates[k] !== 'boolean')) {
    return res.status(400).json({ error: `body must only contain boolean values for: ${DEVICE_KEYS.join(', ')}` });
  }
  const data = req.db.userdata[req.userId];
  data.devices = { ...data.devices, ...updates };
  await writeDb(req.db);
  res.json(data.devices);
});

// ---------- Saved Meals / Recipes / Foods (My Meals, Recipes & Foods) ----------
// A single generic handler family backs all three resources since they share
// the exact same { name, calories, protein, carbs, fat } shape.
function registerSavedItemRoutes(resource, label) {
  app.get(`/api/${resource}`, requireAuth, async (req, res) => {
    res.json(req.db.userdata[req.userId][resourceKeyFor(resource)]);
  });

  app.post(`/api/${resource}`, requireAuth, async (req, res) => {
    const { name, calories, protein, carbs, fat } = req.body || {};
    if (typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    for (const [key, val] of Object.entries({ calories, protein, carbs, fat })) {
      if (typeof val !== 'number' || Number.isNaN(val) || val < 0) {
        return res.status(400).json({ error: `${key} must be a non-negative number` });
      }
    }
    const item = {
      id: crypto.randomUUID(),
      name: name.trim(),
      calories,
      protein,
      carbs,
      fat,
      createdAt: new Date().toISOString()
    };
    const list = req.db.userdata[req.userId][resourceKeyFor(resource)];
    list.push(item);
    await writeDb(req.db);
    res.status(201).json(item);
  });

  app.delete(`/api/${resource}/:id`, requireAuth, async (req, res) => {
    const list = req.db.userdata[req.userId][resourceKeyFor(resource)];
    const idx = list.findIndex((i) => i.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: `${label} not found` });
    }
    const [removed] = list.splice(idx, 1);
    await writeDb(req.db);
    res.json(removed);
  });
}
function resourceKeyFor(resource) {
  return { 'saved-meals': 'savedMeals', 'saved-recipes': 'savedRecipes', 'saved-foods': 'savedFoods' }[resource];
}
registerSavedItemRoutes('saved-meals', 'meal');
registerSavedItemRoutes('saved-recipes', 'recipe');
registerSavedItemRoutes('saved-foods', 'food');

// GET /api/recipes/discover — static Discovery/Learn feed catalog (public, like /api/foods)
app.get('/api/recipes/discover', (req, res) => {
  res.json(RECIPE_CATALOG);
});

// GET /api/history?days=N or ?start=YYYY-MM-DD&end=YYYY-MM-DD — zero-filled
// per-day calorie/macro/micronutrient history for charts (Overview's fixed
// 7-day view and the Calories toggle's custom date-range picker both use this).
function addDaysToDateStr(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-CA');
}

app.get('/api/history', requireAuth, async (req, res) => {
  let { start, end } = req.query;
  if (start || end) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start || '') || !/^\d{4}-\d{2}-\d{2}$/.test(end || '')) {
      return res.status(400).json({ error: 'start and end must both be in YYYY-MM-DD format' });
    }
    if (start > end) {
      return res.status(400).json({ error: 'start must be on or before end' });
    }
    const spanDays = Math.round((new Date(end + 'T00:00:00') - new Date(start + 'T00:00:00')) / 86400000) + 1;
    if (spanDays > 366) {
      return res.status(400).json({ error: 'date range cannot exceed 366 days' });
    }
  } else {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 366);
    end = todayStr();
    start = addDaysToDateStr(end, -(days - 1));
  }

  const dayDates = [];
  for (let d = start; d <= end; d = addDaysToDateStr(d, 1)) {
    dayDates.push(d);
  }

  const entries = req.db.userdata[req.userId].entries;
  const days = dayDates.map((date) => {
    const dayEntries = entries.filter((e) => e.date === date);
    return { date, ...computeTotals(dayEntries) };
  });
  const totals = computeTotals(days);
  const averages = {};
  for (const key of Object.keys(totals)) {
    averages[key] = Math.round((totals[key] / days.length) * 10) / 10;
  }

  res.json({ start, end, days, totals, averages });
});

// GET /api/day?date=YYYY-MM-DD — everything the dashboard needs for one date
app.get('/api/day', requireAuth, async (req, res) => {
  const date = req.query.date || todayStr();
  const data = req.db.userdata[req.userId];
  const entries = data.entries
    .filter((e) => e.date === date)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const totals = computeTotals(entries);
  // Dynamic Day Type Selector: when a day type (Rest/Work/Gym) is active,
  // its saved calorie/macro targets substitute for the base calorieGoal/
  // macroGoals on the dashboard, without overwriting the base plan itself.
  const activeDayType = data.settings.activeDayType;
  const dayTypeTarget = activeDayType ? data.settings.dayTypeTargets?.[activeDayType] : null;
  const activeTargets = dayTypeTarget
    ? { calorieGoal: dayTypeTarget.calories, macroGoals: { protein: dayTypeTarget.protein, carbs: dayTypeTarget.carbs, fat: dayTypeTarget.fat } }
    : { calorieGoal: data.settings.calorieGoal, macroGoals: data.settings.macroGoals };
  res.json({ date, entries, totals, settings: data.settings, activeDayType, activeTargets });
});

// Catch-all fallback: any GET that isn't an /api/* route and wasn't already
// served as a static file (JS/CSS/images matched by express.static above)
// falls back to index.html at 200 instead of Express's default "Cannot GET"
// 404. This is what keeps an iOS standalone Home Screen launch — which can
// replay a stale or trailing-slash URL from its cached launch state — landing
// on the app shell instead of a dead page.
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.status(200).sendFile(INDEX_HTML_PATH);
});

app.listen(PORT, () => {
  console.log(`Calorie tracker running at http://localhost:${PORT}`);
});
