const fs = require('fs/promises');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data', 'db.json');

const DEFAULT_DB = {
  users: [],
  sessions: {},
  userdata: {},
  // Legacy single-user fields from before accounts existed. Kept only so
  // pre-auth data survives until the first account registers and claims it
  // (see claimLegacyData in server.js).
  settings: {
    calorieGoal: 2200,
    macroGoals: { protein: 150, carbs: 250, fat: 70 }
  },
  entries: [],
  water: {},
  weightLogs: [],
  stepsLogs: [],
  sleepLogs: []
};

// Serialize writes so concurrent requests can't clobber each other's changes.
let writeQueue = Promise.resolve();

async function ensureDb() {
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(DEFAULT_DB, null, 2));
  }
}

async function readDb() {
  await ensureDb();
  const raw = await fs.readFile(DATA_FILE, 'utf-8');
  const db = JSON.parse(raw);
  // Backfill fields for db.json files written before these features existed.
  if (!db.water) db.water = {};
  if (!db.weightLogs) db.weightLogs = [];
  if (!db.stepsLogs) db.stepsLogs = [];
  if (!db.sleepLogs) db.sleepLogs = [];
  if (!db.users) db.users = [];
  if (!db.sessions) db.sessions = {};
  if (!db.userdata) db.userdata = {};
  // Water used to be stored as a 0-8 filled-cup count; it's now stored as
  // total ounces. Multiplying old values by 8oz/cup happens once per account
  // (gated by waterOuncesMigrated) and is safe to recompute on every read
  // that isn't persisted yet — it's always derived fresh from the same raw
  // on-disk cup counts, so it can never be applied twice.
  function migrateWaterToOunces(container) {
    if (container.waterOuncesMigrated) return;
    const water = container.water || {};
    for (const date of Object.keys(water)) {
      water[date] = (water[date] || 0) * 8;
    }
    container.waterOuncesMigrated = true;
  }

  migrateWaterToOunces(db);
  for (const uid of Object.keys(db.userdata)) {
    const data = db.userdata[uid];
    if (!data.weightLogs) data.weightLogs = [];
    if (!data.stepsLogs) data.stepsLogs = [];
    if (!data.sleepLogs) data.sleepLogs = [];
    if (!data.exerciseLogs) data.exerciseLogs = [];
    // Accounts that existed before onboarding did are already using the app —
    // don't retroactively block them with the first-launch wizard.
    if (data.onboarded === undefined) data.onboarded = true;
    const settings = data.settings;
    if (settings && settings.heightCm === undefined) settings.heightCm = null;
    if (settings && settings.targetWeightKg === undefined) settings.targetWeightKg = null;
    if (settings && settings.activityLevel === undefined) settings.activityLevel = 'moderate';
    if (settings && settings.fitnessGoal === undefined) settings.fitnessGoal = 'maintain';
    if (settings && settings.ageYears === undefined) settings.ageYears = null;
    migrateWaterToOunces(data);
  }
  return db;
}

function writeDb(db) {
  writeQueue = writeQueue.then(() =>
    fs.writeFile(DATA_FILE, JSON.stringify(db, null, 2))
  );
  return writeQueue;
}

module.exports = { readDb, writeDb };
