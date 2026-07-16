// One-off migration: reads the existing server/data/db.json and loads it
// into Postgres (schema in server/db/schema.sql — run that first). Any
// base64 weight-log photo gets uploaded to Cloudinary along the way so
// nothing base64 ever lands in Postgres.
//
// Usage:
//   1. psql "$DATABASE_URL" -f server/db/schema.sql
//   2. npm run migrate
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./db/pool');
const { resolveImageUrl, isBase64Image } = require('./lib/cloudinary');

const DATA_FILE = path.join(__dirname, 'data', 'db.json');

async function main() {
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  const db = JSON.parse(raw);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    console.log(`Migrating ${db.users.length} users...`);
    for (const user of db.users) {
      await client.query(
        `insert into users (id, username, email, salt, hash, google_id, apple_id, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (id) do nothing`,
        [user.id, user.username, user.email || null, user.salt || null, user.hash || null,
          user.googleId || null, user.appleId || null, user.createdAt || new Date().toISOString()]
      );
    }

    const validUserIds = new Set(db.users.map(u => u.id));
    const sessionEntries = Object.entries(db.sessions || {});
    console.log(`Migrating ${sessionEntries.length} sessions...`);
    let skippedSessions = 0;
    for (const [token, userId] of sessionEntries) {
      if (!validUserIds.has(userId)) {
        skippedSessions += 1;
        continue;
      }
      await client.query(
        'insert into sessions (token, user_id) values ($1,$2) on conflict (token) do nothing',
        [token, userId]
      );
    }
    if (skippedSessions > 0) {
      console.log(`  skipped ${skippedSessions} session(s) referencing a non-existent user_id`);
    }

    const userIds = Object.keys(db.userdata || {});
    let photoCount = 0;
    for (const userId of userIds) {
      const data = db.userdata[userId];
      const { entries = [], savedMeals = [], exerciseLogs = [], routines = [], weightLogs = [], ...profile } = data;

      await client.query(
        `insert into user_profiles (user_id, profile) values ($1,$2)
         on conflict (user_id) do update set profile = excluded.profile`,
        [userId, JSON.stringify(profile)]
      );

      for (const e of entries) {
        await client.query(
          `insert into entries (id, user_id, date, meal, food_id, name, grams, calories, protein, carbs, fat,
             fiber, sugar, saturated_fat, polyunsaturated_fat, monounsaturated_fat, sodium, cholesterol,
             potassium, iron, vitamin_a, vitamin_c, vitamin_d, vitamin_b12, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
           on conflict (id) do nothing`,
          [e.id, userId, e.date, e.meal, e.foodId, e.name, e.grams, e.calories, e.protein, e.carbs, e.fat,
            e.fiber ?? 0, e.sugar ?? 0, e.saturatedFat ?? 0, e.polyunsaturatedFat ?? 0, e.monounsaturatedFat ?? 0,
            e.sodium ?? 0, e.cholesterol ?? 0, e.potassium ?? 0, e.iron ?? 0, e.vitaminA ?? 0, e.vitaminC ?? 0,
            e.vitaminD ?? 0, e.vitaminB12 ?? 0, e.createdAt || new Date().toISOString()]
        );
      }

      for (const m of savedMeals) {
        await client.query(
          `insert into saved_meals (id, user_id, name, calories, protein, carbs, fat, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (id) do nothing`,
          [m.id, userId, m.name, m.calories, m.protein, m.carbs, m.fat, m.createdAt || new Date().toISOString()]
        );
      }

      for (const ex of exerciseLogs) {
        await client.query(
          `insert into exercise_logs (id, user_id, date, type, name, minutes, calories_burned, created_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (id) do nothing`,
          [ex.id, userId, ex.date, ex.type, ex.name, ex.minutes, ex.caloriesBurned, ex.createdAt || new Date().toISOString()]
        );
      }

      for (const r of routines) {
        await client.query(
          `insert into routines (id, user_id, name, exercises, created_at)
           values ($1,$2,$3,$4,$5) on conflict (id) do nothing`,
          [r.id, userId, r.name, JSON.stringify(r.exercises), r.createdAt || new Date().toISOString()]
        );
      }

      for (const w of weightLogs) {
        let photoUrl = null;
        if (w.photo) {
          photoCount += 1;
          console.log(`  uploading weight photo -> Cloudinary (user ${userId}, ${w.date})`);
          photoUrl = isBase64Image(w.photo)
            ? await resolveImageUrl(w.photo, `pure-macros/${userId}/weight-logs`)
            : w.photo; // already a URL
        }
        await client.query(
          `insert into weight_logs (id, user_id, date, weight, photo_url, created_at)
           values ($1,$2,$3,$4,$5,$6) on conflict (id) do nothing`,
          [w.id, userId, w.date, w.weight, photoUrl, w.createdAt || new Date().toISOString()]
        );
      }
    }

    await client.query('COMMIT');
    console.log(`Migration complete. ${userIds.length} user profiles, ${photoCount} weight photos uploaded to Cloudinary, ${skippedSessions} session(s) skipped.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed, rolled back:', err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
