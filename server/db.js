const pool = require('./db/pool');

// ---------- Defaults & backfill (parity with the old file-based db.js) ----------
// server.js's own defaultUserData() already seeds every field for brand-new
// accounts and gets written straight through by writeDb(); this fallback only
// matters if a user_profiles row is ever missing (e.g. manual DB edits).
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

function defaultProfile() {
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
      displayName: '',
      communityConnected: false,
      communityPronouns: '',
      communityWhyHere: '',
      communityHobbies: '',
      communityFunFact: '',
      communityBio: '',
      currentWeightKg: null,
      customCalorieTargets: { rest: 2000, moderate: 2200, active: 2500 },
      dayTypeTargets: {
        rest: { label: 'Rest Day', calories: 2000, protein: 130, carbs: 220, fat: 65 },
        work: { label: 'Work Day', calories: 2250, protein: 145, carbs: 250, fat: 75 },
        gym: { label: 'Gym Training', calories: 2500, protein: 160, carbs: 275, fat: 85 }
      },
      activeDayType: null,
      diary: { showDecimalMacros: false, quickAddEnabled: true, multiAddDefault: false },
      weekStart: 'monday',
      sharing: { diarySharing: 'private', profileSearchable: false },
      notifications: {
        newMessage: true,
        newFriendRequest: true,
        friendWorkoutLog: true,
        friendLoginStreak: true,
        stepGoalReached: true,
        quietHours: false
      }
    },
    water: {},
    waterOuncesMigrated: true,
    stepsLogs: [],
    sleepLogs: [],
    customExercises: [],
    fasting: { protocol: '16:8', activeSession: null },
    reminders: defaultReminders(),
    devices: defaultDevices(),
    savedRecipes: [],
    savedFoods: [],
    messages: [],
    currentStreak: 0,
    lastLoggedDate: null,
    onboarded: false,
    mealPlan: { onboarded: false, preferences: null }
  };
}

function todayLocalStr() {
  return new Date().toLocaleDateString('en-CA');
}

function yesterdayLocalStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toLocaleDateString('en-CA');
}

// A streak only survives a gap of at most one day — decay it on every load,
// same rule the file-based db.js applied.
function decayStaleStreak(data) {
  if (!data.lastLoggedDate || !data.currentStreak) return;
  const today = todayLocalStr();
  if (data.lastLoggedDate === today || data.lastLoggedDate === yesterdayLocalStr()) return;
  data.currentStreak = 0;
}

// Backfills fields for profiles written before a given feature shipped —
// same checks the old readDb() ran against the on-disk db.json.
function backfillProfile(data) {
  if (!data.water) data.water = {};
  if (!data.waterOuncesMigrated) {
    for (const date of Object.keys(data.water)) data.water[date] = (data.water[date] || 0) * 8;
    data.waterOuncesMigrated = true;
  }
  if (!data.stepsLogs) data.stepsLogs = [];
  if (!data.sleepLogs) data.sleepLogs = [];
  if (!data.fasting) data.fasting = { protocol: '16:8', activeSession: null };
  if (!data.reminders || data.reminders.length === 0) data.reminders = defaultReminders();
  if (!data.devices) data.devices = defaultDevices();
  if (!data.savedRecipes) data.savedRecipes = [];
  if (!data.savedFoods) data.savedFoods = [];
  if (!data.customExercises) data.customExercises = [];
  if (!data.messages) data.messages = [];
  if (data.currentStreak === undefined) data.currentStreak = 0;
  if (data.lastLoggedDate === undefined) data.lastLoggedDate = null;
  decayStaleStreak(data);
  if (data.onboarded === undefined) data.onboarded = true;
  if (!data.mealPlan) data.mealPlan = { onboarded: false, preferences: null };

  const settings = data.settings || (data.settings = {});
  if (settings.bio === undefined) settings.bio = '';
  if (settings.location === undefined) settings.location = '';
  if (settings.heightCm === undefined) settings.heightCm = null;
  if (settings.targetWeightKg === undefined) settings.targetWeightKg = null;
  if (settings.activityLevel === undefined) settings.activityLevel = 'moderate';
  if (settings.fitnessGoal === undefined) settings.fitnessGoal = 'maintain';
  if (settings.ageYears === undefined) settings.ageYears = null;
  if (settings.displayName === undefined) settings.displayName = '';
  if (settings.currentWeightKg === undefined) settings.currentWeightKg = null;
  if (!settings.customCalorieTargets) settings.customCalorieTargets = { rest: 2000, moderate: 2200, active: 2500 };
  if (!settings.dayTypeTargets) {
    settings.dayTypeTargets = {
      rest: { label: 'Rest Day', calories: 2000, protein: 130, carbs: 220, fat: 65 },
      work: { label: 'Work Day', calories: 2250, protein: 145, carbs: 250, fat: 75 },
      gym: { label: 'Gym Training', calories: 2500, protein: 160, carbs: 275, fat: 85 }
    };
  }
  if (settings.activeDayType === undefined) settings.activeDayType = null;
  if (!settings.diary) settings.diary = { showDecimalMacros: false, quickAddEnabled: true, multiAddDefault: false, suggestRecentMeals: false, defaultSearchTab: 'all' };
  if (settings.weekStart === undefined) settings.weekStart = 'monday';
  if (!settings.sharing) settings.sharing = { diarySharing: 'private', profileSearchable: false };
  if (!settings.notifications) {
    settings.notifications = {
      newMessage: true,
      newFriendRequest: true,
      friendWorkoutLog: true,
      friendLoginStreak: true,
      stepGoalReached: true,
      quietHours: false
    };
  }
  return data;
}

// ---------- Row <-> JS shape mappers ----------
function numOrZero(v) {
  return v === null || v === undefined ? 0 : Number(v);
}

function rowToUser(u) {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    salt: u.salt,
    hash: u.hash,
    googleId: u.google_id,
    appleId: u.apple_id,
    createdAt: u.created_at.toISOString()
  };
}

function rowToEntry(r) {
  return {
    id: r.id,
    date: r.date,
    meal: r.meal,
    foodId: r.food_id,
    name: r.name,
    grams: Number(r.grams),
    calories: Number(r.calories),
    protein: Number(r.protein),
    carbs: Number(r.carbs),
    fat: Number(r.fat),
    fiber: numOrZero(r.fiber),
    sugar: numOrZero(r.sugar),
    saturatedFat: numOrZero(r.saturated_fat),
    polyunsaturatedFat: numOrZero(r.polyunsaturated_fat),
    monounsaturatedFat: numOrZero(r.monounsaturated_fat),
    sodium: numOrZero(r.sodium),
    cholesterol: numOrZero(r.cholesterol),
    potassium: numOrZero(r.potassium),
    iron: numOrZero(r.iron),
    vitaminA: numOrZero(r.vitamin_a),
    vitaminC: numOrZero(r.vitamin_c),
    vitaminD: numOrZero(r.vitamin_d),
    vitaminB12: numOrZero(r.vitamin_b12),
    createdAt: r.created_at.toISOString()
  };
}

function rowToSavedItem(r) {
  return {
    id: r.id,
    name: r.name,
    calories: Number(r.calories),
    protein: Number(r.protein),
    carbs: Number(r.carbs),
    fat: Number(r.fat),
    createdAt: r.created_at.toISOString()
  };
}

function rowToExercise(r) {
  return {
    id: r.id,
    date: r.date,
    type: r.type,
    name: r.name,
    minutes: Number(r.minutes),
    caloriesBurned: Number(r.calories_burned),
    createdAt: r.created_at.toISOString()
  };
}

function rowToRoutine(r) {
  return { id: r.id, name: r.name, exercises: r.exercises, createdAt: r.created_at.toISOString() };
}

function rowToWeight(r) {
  return {
    id: r.id,
    date: r.date,
    weight: Number(r.weight),
    photo: r.photo_url || null,
    createdAt: r.created_at.toISOString()
  };
}

function groupByUser(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!map.has(r.user_id)) map.set(r.user_id, []);
    map.get(r.user_id).push(r);
  }
  return map;
}

// Per-db-object snapshot of what was last read, used by writeDb() to skip
// resyncing users/collections nothing touched. Every request does exactly
// one readDb() + one writeDb(db) on the SAME object (see requireAuth in
// server.js), so this reliably scopes each write to only what that request
// actually mutated instead of resyncing all users on every single write.
const snapshots = new WeakMap();

async function readDb() {
  const db = { users: [], sessions: {}, userdata: {} };

  const [usersRes, sessionsRes, profilesRes, entriesRes, mealsRes, exercisesRes, routinesRes, weightsRes] = await Promise.all([
    pool.query('SELECT * FROM users'),
    pool.query('SELECT token, user_id FROM sessions'),
    pool.query('SELECT user_id, profile FROM user_profiles'),
    pool.query('SELECT * FROM entries ORDER BY created_at'),
    pool.query('SELECT * FROM saved_meals ORDER BY created_at'),
    pool.query('SELECT * FROM exercise_logs ORDER BY created_at'),
    pool.query('SELECT * FROM routines ORDER BY created_at'),
    pool.query('SELECT * FROM weight_logs ORDER BY date')
  ]);

  db.users = usersRes.rows.map(rowToUser);
  for (const s of sessionsRes.rows) db.sessions[s.token] = s.user_id;

  const profileByUser = new Map(profilesRes.rows.map((p) => [p.user_id, p.profile]));
  const entriesByUser = groupByUser(entriesRes.rows);
  const mealsByUser = groupByUser(mealsRes.rows);
  const exercisesByUser = groupByUser(exercisesRes.rows);
  const routinesByUser = groupByUser(routinesRes.rows);
  const weightsByUser = groupByUser(weightsRes.rows);

  for (const user of db.users) {
    const profile = backfillProfile(profileByUser.get(user.id) || defaultProfile());
    profile.entries = (entriesByUser.get(user.id) || []).map(rowToEntry);
    profile.savedMeals = (mealsByUser.get(user.id) || []).map(rowToSavedItem);
    profile.exerciseLogs = (exercisesByUser.get(user.id) || []).map(rowToExercise);
    profile.routines = (routinesByUser.get(user.id) || []).map(rowToRoutine);
    profile.weightLogs = (weightsByUser.get(user.id) || []).map(rowToWeight);
    db.userdata[user.id] = profile;
  }

  snapshots.set(db, {
    users: JSON.stringify(db.users),
    sessions: JSON.stringify(db.sessions),
    userdata: new Map(Object.entries(db.userdata).map(([id, data]) => [id, JSON.stringify(data)]))
  });

  return db;
}

async function upsertUser(client, user) {
  await client.query(
    `insert into users (id, username, email, salt, hash, google_id, apple_id, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8)
     on conflict (id) do update set
       username = excluded.username, email = excluded.email, salt = excluded.salt,
       hash = excluded.hash, google_id = excluded.google_id, apple_id = excluded.apple_id`,
    [user.id, user.username, user.email || null, user.salt || null, user.hash || null,
      user.googleId || null, user.appleId || null, user.createdAt]
  );
}

async function resyncUserCollections(client, userId, data) {
  const { entries, savedMeals, exerciseLogs, routines, weightLogs, ...profile } = data;

  await client.query(
    `insert into user_profiles (user_id, profile) values ($1,$2)
     on conflict (user_id) do update set profile = excluded.profile`,
    [userId, JSON.stringify(profile)]
  );

  await client.query('DELETE FROM entries WHERE user_id = $1', [userId]);
  for (const e of entries || []) {
    await client.query(
      `insert into entries (id, user_id, date, meal, food_id, name, grams, calories, protein, carbs, fat,
         fiber, sugar, saturated_fat, polyunsaturated_fat, monounsaturated_fat, sodium, cholesterol,
         potassium, iron, vitamin_a, vitamin_c, vitamin_d, vitamin_b12, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`,
      [e.id, userId, e.date, e.meal, e.foodId, e.name, e.grams, e.calories, e.protein, e.carbs, e.fat,
        e.fiber ?? 0, e.sugar ?? 0, e.saturatedFat ?? 0, e.polyunsaturatedFat ?? 0, e.monounsaturatedFat ?? 0,
        e.sodium ?? 0, e.cholesterol ?? 0, e.potassium ?? 0, e.iron ?? 0, e.vitaminA ?? 0, e.vitaminC ?? 0,
        e.vitaminD ?? 0, e.vitaminB12 ?? 0, e.createdAt]
    );
  }

  await client.query('DELETE FROM saved_meals WHERE user_id = $1', [userId]);
  for (const m of savedMeals || []) {
    await client.query(
      `insert into saved_meals (id, user_id, name, calories, protein, carbs, fat, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [m.id, userId, m.name, m.calories, m.protein, m.carbs, m.fat, m.createdAt]
    );
  }

  await client.query('DELETE FROM exercise_logs WHERE user_id = $1', [userId]);
  for (const ex of exerciseLogs || []) {
    await client.query(
      `insert into exercise_logs (id, user_id, date, type, name, minutes, calories_burned, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [ex.id, userId, ex.date, ex.type, ex.name, ex.minutes, ex.caloriesBurned, ex.createdAt]
    );
  }

  await client.query('DELETE FROM routines WHERE user_id = $1', [userId]);
  for (const r of routines || []) {
    await client.query(
      `insert into routines (id, user_id, name, exercises, created_at) values ($1,$2,$3,$4,$5)`,
      [r.id, userId, r.name, JSON.stringify(r.exercises), r.createdAt]
    );
  }

  await client.query('DELETE FROM weight_logs WHERE user_id = $1', [userId]);
  for (const w of weightLogs || []) {
    await client.query(
      `insert into weight_logs (id, user_id, date, weight, photo_url, created_at) values ($1,$2,$3,$4,$5,$6)`,
      [w.id, userId, w.date, w.weight, w.photo || null, w.createdAt]
    );
  }
}

async function writeDb(db) {
  const prev = snapshots.get(db);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (!prev || JSON.stringify(db.users) !== prev.users) {
      for (const user of db.users) await upsertUser(client, user);
    }

    if (!prev || JSON.stringify(db.sessions) !== prev.sessions) {
      await client.query('DELETE FROM sessions');
      for (const [token, userId] of Object.entries(db.sessions)) {
        await client.query('INSERT INTO sessions (token, user_id) VALUES ($1,$2)', [token, userId]);
      }
    }

    for (const [userId, data] of Object.entries(db.userdata)) {
      const serialized = JSON.stringify(data);
      if (prev && prev.userdata.get(userId) === serialized) continue; // untouched by this request
      await resyncUserCollections(client, userId, data);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  // This db object's write cycle is done — a fresh readDb() reseeds the diff base.
  snapshots.delete(db);
}

module.exports = { readDb, writeDb };
