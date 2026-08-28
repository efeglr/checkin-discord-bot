require("dotenv").config();

const {
  setupDatabase,
  setHistoricalLongestStreak,
  pool,
} = require("./database");

const users = [
  {
    name: "tokaku",
    userId: "456883324200288257",
    longestStreak: 16,
  },
  {
    name: "miguelcol_",
    userId: "1113146171767140445",
    longestStreak: 8,
  },
  {
    name: "000captain000",
    userId: "1507702846466953326",
    longestStreak: 1,
  },
  {
    name: "thisizm",
    userId: "817080587419648001",
    longestStreak: 1,
  },
];

async function run() {
  const guildId = process.env.GUILD_ID;

  if (!guildId) {
    throw new Error("GUILD_ID is missing from .env");
  }

  await setupDatabase();

  for (const user of users) {
    await setHistoricalLongestStreak(
      guildId,
      user.userId,
      user.longestStreak
    );

    console.log(
      `✅ ${user.name}: longest streak = ${user.longestStreak}`
    );
  }

  console.log("🔥 Historical streaks imported");

  await pool.end();
}

run().catch(async (error) => {
  console.error("❌ Import failed:", error);

  await pool.end();
  process.exit(1);
});