const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});


// ------------------------------------------------
// Setup database
// ------------------------------------------------

async function setupDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS checkins (
      id BIGSERIAL PRIMARY KEY,

      guild_id VARCHAR(32) NOT NULL,
      user_id VARCHAR(32) NOT NULL,

      checkin_date DATE NOT NULL,

      yesterday TEXT,
      today TEXT NOT NULL,

      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      UNIQUE (guild_id, user_id, checkin_date)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_checkins_user_date
    ON checkins (guild_id, user_id, checkin_date);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS streak_stats (
      guild_id VARCHAR(32) NOT NULL,
      user_id VARCHAR(32) NOT NULL,

      longest_streak INTEGER NOT NULL DEFAULT 0,

      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      PRIMARY KEY (guild_id, user_id)
    );
  `);

  console.log("✅ PostgreSQL ready");
}


// ------------------------------------------------
// Save check-in
// ------------------------------------------------

async function saveCheckin({
  guildId,
  userId,
  date,
  yesterday,
  today,
}) {
  await pool.query(
    `
    INSERT INTO checkins (
      guild_id,
      user_id,
      checkin_date,
      yesterday,
      today
    )

    VALUES ($1, $2, $3, $4, $5)

    ON CONFLICT (
      guild_id,
      user_id,
      checkin_date
    )

    DO UPDATE SET
      yesterday = EXCLUDED.yesterday,
      today = EXCLUDED.today,
      updated_at = NOW()
    `,
    [
      guildId,
      userId,
      date,
      yesterday,
      today,
    ]
  );
}


// ------------------------------------------------
// Get user's check-in dates
// ------------------------------------------------

async function getCheckinDates(
  guildId,
  userId
) {
  const result = await pool.query(
    `
    SELECT checkin_date
    FROM checkins
    WHERE guild_id = $1
      AND user_id = $2
    ORDER BY checkin_date ASC
    `,
    [
      guildId,
      userId,
    ]
  );

  return result.rows.map((row) => {
    const date = row.checkin_date;

    if (date instanceof Date) {
      return date.toISOString().slice(0, 10);
    }

    return String(date).slice(0, 10);
  });
}


// ------------------------------------------------
// Get historical longest streak
// ------------------------------------------------

async function getHistoricalLongestStreak(
  guildId,
  userId
) {
  const result = await pool.query(
    `
    SELECT longest_streak
    FROM streak_stats
    WHERE guild_id = $1
      AND user_id = $2
    `,
    [
      guildId,
      userId,
    ]
  );

  return result.rows[0]?.longest_streak || 0;
}


// ------------------------------------------------
// Set historical longest streak
// ------------------------------------------------

async function setHistoricalLongestStreak(
  guildId,
  userId,
  longestStreak
) {
  await pool.query(
    `
    INSERT INTO streak_stats (
      guild_id,
      user_id,
      longest_streak
    )

    VALUES ($1, $2, $3)

    ON CONFLICT (
      guild_id,
      user_id
    )

    DO UPDATE SET
      longest_streak = GREATEST(
        streak_stats.longest_streak,
        EXCLUDED.longest_streak
      ),
      updated_at = NOW()
    `,
    [
      guildId,
      userId,
      longestStreak,
    ]
  );
}

async function getLeaderboardData(guildId) {
  const result = await pool.query(
    `
    WITH users AS (
      SELECT user_id
      FROM checkins
      WHERE guild_id = $1

      UNION

      SELECT user_id
      FROM streak_stats
      WHERE guild_id = $1
    )

    SELECT
      users.user_id,

      COALESCE(
        MAX(streak_stats.longest_streak),
        0
      )::INTEGER AS historical_longest,

      ARRAY_AGG(
        checkins.checkin_date
        ORDER BY checkins.checkin_date
      )
      FILTER (
        WHERE checkins.checkin_date IS NOT NULL
      ) AS checkin_dates

    FROM users

    LEFT JOIN streak_stats
      ON streak_stats.guild_id = $1
      AND streak_stats.user_id = users.user_id

    LEFT JOIN checkins
      ON checkins.guild_id = $1
      AND checkins.user_id = users.user_id

    GROUP BY users.user_id
    `,
    [guildId]
  );


  return result.rows.map((row) => {
    const dates =
      row.checkin_dates || [];

    return {
      userId: row.user_id,

      historicalLongest:
        row.historical_longest || 0,

      checkinDates:
        dates.map((date) => {
          if (date instanceof Date) {
            return date
              .toISOString()
              .slice(0, 10);
          }

          return String(date)
            .slice(0, 10);
        }),
    };
  });
}


// ------------------------------------------------
// Exports
// ------------------------------------------------

module.exports = {
  pool,
  setupDatabase,
  saveCheckin,
  getCheckinDates,
  getHistoricalLongestStreak,
  setHistoricalLongestStreak,
  getLeaderboardData,
};