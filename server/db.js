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

const DEFAULT_REMINDERS = [
  { key: 'breakfast', label: 'Log Breakfast', time: '08:00' },
  { key: 'lunch', label: 'Log Lunch', time: '12:30' },
  { key: 'dinner', label: 'Log Dinner', time: '18:30' },
  { key: 'hydration', label: 'Hydration Check', time: '15:00' },
  { key: 'weight-checkin', label: 'Weight Check-In', time: '07:00' }
];

function defaultReminders() {
  return DEFAULT_REMINDERS.map((r) => ({ id: r.key, ...r, enabled: true }));
}

function defaultDevices() {
  return {
    appleHealth: false,
    googleFit: false,
    manualEntry: false,
    garmin: false,
    fitbit: false,
    strava: false,
    myFitnessPal: false
  };
}

function todayLocalStr() {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
}

function yesterdayLocalStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA');
}

// A streak only survives a gap of at most one day. Run on every db load (the
// closest thing this stateless, file-backed server has to an "app init" hook)
// so a streak nobody's touched in 2+ days decays to 0 without waiting for the
// user's next food log to notice the gap.
function decayStaleStreak(data) {
  if (!data.lastLoggedDate || !data.currentStreak) return;
  const today = todayLocalStr();
  if (data.lastLoggedDate === today || data.lastLoggedDate === yesterdayLocalStr()) return;
  data.currentStreak = 0;
}

// Serialize writes so concurrent requests can't clobber each other's changes.
let writeQueue = Promise.resolve();

// fs.writeFile() isn't atomic — it truncates DATA_FILE and streams the new
// bytes in, so a readDb() landing mid-write sees a half-written file and
// JSON.parse() throws (crashing the request, or in the worst case the whole
// process, since that throw happens deep inside an unguarded await chain).
// Writing to a sibling temp file and renaming it over the real one sidesteps
// this: fs.rename is atomic on both POSIX and Windows, so any concurrent
// read always sees either the fully-old or fully-new file, never a torn one.
// Unlike POSIX, Windows refuses to rename a file over a destination that
// another handle currently has open (a concurrent readFile() in this same
// process, mid-read) and throws EPERM/EBUSY instead of just replacing it.
// That lock only lasts as long as the read itself — microseconds — so a
// short retry clears it. This never triggers on POSIX (rename there is
// unconditionally atomic), so the loop is a no-op cost there.
async function renameWithRetry(from, to, attemptsLeft = 10) {
  try {
    await fs.rename(from, to);
  } catch (err) {
    if ((err.code === 'EPERM' || err.code === 'EBUSY') && attemptsLeft > 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return renameWithRetry(from, to, attemptsLeft - 1);
    }
    throw err;
  }
}

async function atomicWriteFile(filePath, content) {
  const tmpFile = `${filePath}.${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tmpFile, content);
  await renameWithRetry(tmpFile, filePath);
}

async function ensureDb() {
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await atomicWriteFile(DATA_FILE, JSON.stringify(DEFAULT_DB, null, 2));
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
    if (!data.routines) data.routines = [];
    if (!data.fasting) data.fasting = { protocol: '16:8', activeSession: null };
    if (!data.reminders || data.reminders.length === 0) data.reminders = defaultReminders();
    if (!data.devices) data.devices = defaultDevices();
    if (!data.savedMeals) data.savedMeals = [];
    if (!data.savedRecipes) data.savedRecipes = [];
    if (!data.savedFoods) data.savedFoods = [];
    if (!data.customExercises) data.customExercises = [];
    if (data.currentStreak === undefined) data.currentStreak = 0;
    if (data.lastLoggedDate === undefined) data.lastLoggedDate = null;
    decayStaleStreak(data);
    if (data.settings && data.settings.bio === undefined) data.settings.bio = '';
    if (data.settings && data.settings.location === undefined) data.settings.location = '';
    // Accounts that existed before onboarding did are already using the app —
    // don't retroactively block them with the first-launch wizard.
    if (data.onboarded === undefined) data.onboarded = true;
    const settings = data.settings;
    if (settings && settings.heightCm === undefined) settings.heightCm = null;
    if (settings && settings.targetWeightKg === undefined) settings.targetWeightKg = null;
    if (settings && settings.activityLevel === undefined) settings.activityLevel = 'moderate';
    if (settings && settings.fitnessGoal === undefined) settings.fitnessGoal = 'maintain';
    if (settings && settings.ageYears === undefined) settings.ageYears = null;
    // Settings Sub-Views Generic Engine — backfill for accounts created before
    // the 8 Settings sub-views (Profile, Diary, Start of Week, Sharing &
    // Privacy, Push Notifications) shipped.
    if (settings && settings.displayName === undefined) settings.displayName = '';
    if (settings && settings.currentWeightKg === undefined) settings.currentWeightKg = null;
    if (settings && !settings.customCalorieTargets) settings.customCalorieTargets = { rest: 2000, moderate: 2200, active: 2500 };
    // Dynamic Day Type Selector — Rest/Work/Gym capsule on the Today dashboard.
    // Backfill for accounts created before this feature shipped.
    if (settings && !settings.dayTypeTargets) {
      settings.dayTypeTargets = {
        rest: { label: 'Rest Day', calories: 2000, protein: 130, carbs: 220, fat: 65 },
        work: { label: 'Work Day', calories: 2250, protein: 145, carbs: 250, fat: 75 },
        gym: { label: 'Gym Training', calories: 2500, protein: 160, carbs: 275, fat: 85 }
      };
    }
    if (settings && settings.activeDayType === undefined) settings.activeDayType = null;
    if (settings && !settings.diary) settings.diary = { showDecimalMacros: false, quickAddEnabled: false, multiAddDefault: false, suggestRecentMeals: false, defaultSearchTab: 'all' };
    if (settings && settings.weekStart === undefined) settings.weekStart = 'monday';
    if (settings && !settings.sharing) settings.sharing = { diarySharing: 'private', profileSearchable: false };
    // Push Notifications sub-view (Settings > Push Notifications) — MyFitnessPal-style
    // checklist of social/activity notification toggles.
    if (settings && !settings.notifications) {
      settings.notifications = {
        newMessage: true,
        newFriendRequest: true,
        friendWorkoutLog: true,
        friendLoginStreak: true,
        stepGoalReached: true,
        quietHours: false
      };
    }
    migrateWaterToOunces(data);
  }
  return db;
}

function writeDb(db) {
  const payload = JSON.stringify(db, null, 2);
  const task = writeQueue.then(() => atomicWriteFile(DATA_FILE, payload));
  // Keep the queue alive even if this write fails, so one bad write (e.g. a
  // transient disk error) doesn't permanently wedge every write after it —
  // chaining .then() off a rejected promise skips straight to rejection
  // without ever running the callback.
  writeQueue = task.catch(() => {});
  return task;
}

module.exports = { readDb, writeDb };
