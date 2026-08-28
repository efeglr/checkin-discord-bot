require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

const cron = require("node-cron");

const {
  setupDatabase,
  saveCheckin,
  getCheckinDates,
  getHistoricalLongestStreak,
  setHistoricalLongestStreak,
  getLeaderboardData,
} = require("./database");


// ============================================================
// CONFIG
// ============================================================

const TIME_ZONE = process.env.TIME_ZONE || "UTC";

// These users can still check in and have streaks,
// but will NEVER appear on leaderboards.
const EXCLUDED_LEADERBOARD_USER_IDS = [
  "613407551480135691",
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
  ],
});


// ============================================================
// DATE HELPERS
// ============================================================

function getToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find(
    (part) => part.type === "year"
  ).value;

  const month = parts.find(
    (part) => part.type === "month"
  ).value;

  const day = parts.find(
    (part) => part.type === "day"
  ).value;

  return `${year}-${month}-${day}`;
}


function dateToNumber(dateString) {
  const [year, month, day] =
    dateString.split("-").map(Number);

  return Date.UTC(
    year,
    month - 1,
    day
  );
}


// ============================================================
// STREAK CALCULATION
// ============================================================

function calculateStreaks(dates) {
  if (!dates || dates.length === 0) {
    return {
      current: 0,
      longest: 0,
    };
  }

  // Remove duplicate dates and sort oldest -> newest.
  const uniqueDates = [
    ...new Set(dates),
  ].sort();


  // ----------------------------------------------------------
  // LONGEST STREAK
  // ----------------------------------------------------------

  let longest = 1;
  let running = 1;

  for (
    let i = 1;
    i < uniqueDates.length;
    i++
  ) {
    const previous =
      dateToNumber(uniqueDates[i - 1]);

    const current =
      dateToNumber(uniqueDates[i]);

    const difference =
      (current - previous) /
      (1000 * 60 * 60 * 24);

    if (difference === 1) {
      running++;
    } else {
      running = 1;
    }

    longest = Math.max(
      longest,
      running
    );
  }


  // ----------------------------------------------------------
  // CURRENT STREAK
  // ----------------------------------------------------------

  const latestDate =
    uniqueDates[uniqueDates.length - 1];

  const latestNumber =
    dateToNumber(latestDate);

  const todayNumber =
    dateToNumber(getToday());

  const daysSinceLatest =
    (todayNumber - latestNumber) /
    (1000 * 60 * 60 * 24);


  /*
   * The streak remains active if the user's
   * latest check-in was today or yesterday.
   *
   * Example:
   *
   * Today = Aug 28
   *
   * Last check-in Aug 28 -> active
   * Last check-in Aug 27 -> active
   * Last check-in Aug 26 -> broken
   */

  if (
    daysSinceLatest > 1 ||
    daysSinceLatest < 0
  ) {
    return {
      current: 0,
      longest,
    };
  }


  let currentStreak = 1;

  for (
    let i = uniqueDates.length - 1;
    i > 0;
    i--
  ) {
    const current =
      dateToNumber(uniqueDates[i]);

    const previous =
      dateToNumber(uniqueDates[i - 1]);

    const difference =
      (current - previous) /
      (1000 * 60 * 60 * 24);

    if (difference === 1) {
      currentStreak++;
    } else {
      break;
    }
  }


  return {
    current: currentStreak,
    longest,
  };
}


// ============================================================
// DISPLAY NAME
// ============================================================

function getDisplayName(interaction) {
  return (
    interaction.member?.displayName ||
    interaction.user.globalName ||
    interaction.user.username
  );
}


// ============================================================
// CHECK-IN MODAL
// ============================================================

function createCheckinModal() {
  const modal = new ModalBuilder()
    .setCustomId("daily_checkin_modal")
    .setTitle("Daily Check In ✅");


  const yesterdayInput =
    new TextInputBuilder()
      .setCustomId("yesterday")
      .setLabel(
        "What did you do yesterday?"
      )
      .setPlaceholder(
        "Finished my project, went to the gym..."
      )
      .setStyle(
        TextInputStyle.Paragraph
      )
      .setRequired(false)
      .setMaxLength(1000);


  const todayInput =
    new TextInputBuilder()
      .setCustomId("today")
      .setLabel(
        "What do you want to do today?"
      )
      .setPlaceholder(
        "Finish the bot, study for 2 hours..."
      )
      .setStyle(
        TextInputStyle.Paragraph
      )
      .setRequired(true)
      .setMaxLength(1000);


  modal.addComponents(
    new ActionRowBuilder()
      .addComponents(yesterdayInput),

    new ActionRowBuilder()
      .addComponents(todayInput)
  );


  return modal;
}


// ============================================================
// SLASH COMMANDS
// ============================================================

const commands = [

  // /checkin
  new SlashCommandBuilder()
    .setName("checkin")
    .setDescription(
      "Complete your daily check-in"
    ),


  // /streak
  new SlashCommandBuilder()
    .setName("streak")
    .setDescription(
      "See your current and longest streak"
    ),


  // /leaderboard
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription(
      "See the check-in leaderboard"
    )
    .addStringOption(
      (option) =>
        option
          .setName("type")
          .setDescription(
            "Which leaderboard do you want?"
          )
          .setRequired(false)
          .addChoices(
            {
              name: "🔥 Current streak",
              value: "current",
            },
            {
              name: "🏆 Longest streak",
              value: "longest",
            }
          )
    ),

];


// ============================================================
// BOT READY
// ============================================================

client.once(
  "ready",

  async () => {
    console.log(
      `✅ Logged in as ${client.user.tag}`
    );


    try {
      const guild =
        await client.guilds.fetch(
          process.env.GUILD_ID
        );


      // Register commands directly to this server.
      await guild.commands.set(
        commands.map(
          (command) =>
            command.toJSON()
        )
      );


      console.log(
        "✅ Slash commands registered"
      );


      startDailyReminder();

    } catch (error) {
      console.error(
        "❌ Bot setup error:",
        error
      );
    }
  }
);


// ============================================================
// INTERACTIONS
// ============================================================

client.on(
  "interactionCreate",

  async (interaction) => {
    try {

      // ======================================================
      // /checkin
      // ======================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName === "checkin"
      ) {
        await interaction.showModal(
          createCheckinModal()
        );

        return;
      }


      // ======================================================
      // /streak
      // ======================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName === "streak"
      ) {
        const dates =
          await getCheckinDates(
            interaction.guildId,
            interaction.user.id
          );


        const calculated =
          calculateStreaks(dates);


        // Imported historical record.
        const historicalLongest =
          await getHistoricalLongestStreak(
            interaction.guildId,
            interaction.user.id
          );


        // Whichever is bigger is the user's real record.
        const longestStreak =
          Math.max(
            calculated.longest,
            historicalLongest
          );


        const embed =
          new EmbedBuilder()
            .setAuthor({
              name:
                getDisplayName(
                  interaction
                ),

              iconURL:
                interaction.user
                  .displayAvatarURL(),
            })

            .setTitle(
              "🔥 Your Check-In Streak"
            )

            .addFields(
              {
                name:
                  "🔥 Current Streak",

                value:
                  `**${calculated.current} day${
                    calculated.current === 1
                      ? ""
                      : "s"
                  }**`,

                inline: true,
              },

              {
                name:
                  "🏆 Longest Streak",

                value:
                  `**${longestStreak} day${
                    longestStreak === 1
                      ? ""
                      : "s"
                  }**`,

                inline: true,
              }
            )

            .setTimestamp();


        await interaction.reply({
          embeds: [embed],
          flags:
            MessageFlags.Ephemeral,
        });


        return;
      }


      // ======================================================
      // /leaderboard
      // ======================================================

      if (
        interaction.isChatInputCommand() &&
        interaction.commandName ===
          "leaderboard"
      ) {
        await interaction.deferReply();


        const type =
          interaction.options
            .getString("type") ||
          "current";


        const users =
          await getLeaderboardData(
            interaction.guildId
          );


        // ----------------------------------------------------
        // REMOVE EXCLUDED USERS
        // ----------------------------------------------------

        const eligibleUsers =
          users.filter(
            (user) =>
              !EXCLUDED_LEADERBOARD_USER_IDS
                .includes(user.userId)
          );


        // ----------------------------------------------------
        // CALCULATE STATS
        // ----------------------------------------------------

        const leaderboard =
          eligibleUsers.map(
            (user) => {
              const calculated =
                calculateStreaks(
                  user.checkinDates
                );


              const longest =
                Math.max(
                  calculated.longest,
                  user.historicalLongest
                );


              return {
                userId:
                  user.userId,

                current:
                  calculated.current,

                longest,
              };
            }
          );


        // ----------------------------------------------------
        // SORT
        // ----------------------------------------------------

        if (type === "longest") {

          leaderboard.sort(
            (a, b) => {

              // Highest longest streak first.
              if (
                b.longest !==
                a.longest
              ) {
                return (
                  b.longest -
                  a.longest
                );
              }


              // Tie-break using current streak.
              return (
                b.current -
                a.current
              );
            }
          );

        } else {

          leaderboard.sort(
            (a, b) => {

              // Highest current streak first.
              if (
                b.current !==
                a.current
              ) {
                return (
                  b.current -
                  a.current
                );
              }


              // Tie-break using longest streak.
              return (
                b.longest -
                a.longest
              );
            }
          );
        }


        // ----------------------------------------------------
        // REMOVE PEOPLE WITH ZERO SCORE
        // ----------------------------------------------------

        const filtered =
          leaderboard.filter(
            (user) => {

              if (type === "longest") {
                return user.longest > 0;
              }

              return user.current > 0;
            }
          );


        // ----------------------------------------------------
        // TOP 10
        // ----------------------------------------------------

        const top10 =
          filtered.slice(0, 10);


        if (top10.length === 0) {
          await interaction.editReply({
            content:
              type === "current"
                ? "Nobody has an active streak yet!"
                : "There are no streak records yet!",
          });

          return;
        }


        // ----------------------------------------------------
        // BUILD LEADERBOARD
        // ----------------------------------------------------

        const medals = [
          "🥇",
          "🥈",
          "🥉",
        ];


        const lines =
          top10.map(
            (user, index) => {

              const position =
                medals[index] ||
                `**${index + 1}.**`;


              const value =
                type === "longest"
                  ? user.longest
                  : user.current;


              return (
                `${position} <@${user.userId}> ` +
                `— 🔥 **${value} day${
                  value === 1
                    ? ""
                    : "s"
                }**`
              );
            }
          );


        const title =
          type === "longest"
            ? "🏆 Longest Streak Leaderboard"
            : "🔥 Current Streak Leaderboard";


        const embed =
          new EmbedBuilder()
            .setTitle(title)

            .setDescription(
              lines.join("\n\n")
            )

            .setFooter({
              text:
                "Keep checking in every day!",
            })

            .setTimestamp();


        await interaction.editReply({
          embeds: [embed],
        });


        return;
      }


      // ======================================================
      // DAILY CHECK-IN BUTTON
      // ======================================================

      if (
        interaction.isButton() &&
        interaction.customId ===
          "daily_checkin_button"
      ) {
        await interaction.showModal(
          createCheckinModal()
        );

        return;
      }


      // ======================================================
      // CHECK-IN MODAL SUBMITTED
      // ======================================================

      if (
        interaction.isModalSubmit() &&
        interaction.customId ===
          "daily_checkin_modal"
      ) {
        const yesterdayRaw =
          interaction.fields
            .getTextInputValue(
              "yesterday"
            )
            .trim();


        const today =
          interaction.fields
            .getTextInputValue(
              "today"
            )
            .trim();


        if (!today) {
          await interaction.reply({
            content:
              "❌ Please enter what you want to do today.",

            flags:
              MessageFlags.Ephemeral,
          });

          return;
        }


        const yesterday =
          yesterdayRaw ||
          "Nothing entered.";


        const date =
          getToday();


        // ----------------------------------------------------
        // SAVE CHECK-IN
        // ----------------------------------------------------

        await saveCheckin({
          guildId:
            interaction.guildId,

          userId:
            interaction.user.id,

          date,

          yesterday,

          today,
        });


        // ----------------------------------------------------
        // CALCULATE STREAKS
        // ----------------------------------------------------

        const dates =
          await getCheckinDates(
            interaction.guildId,
            interaction.user.id
          );


        const calculated =
          calculateStreaks(dates);


        const historicalLongest =
          await getHistoricalLongestStreak(
            interaction.guildId,
            interaction.user.id
          );


        const longestStreak =
          Math.max(
            calculated.longest,
            historicalLongest
          );


        /*
         * Store the new record if they
         * have beaten their previous one.
         */
        await setHistoricalLongestStreak(
          interaction.guildId,
          interaction.user.id,
          longestStreak
        );


        // ----------------------------------------------------
        // CREATE CHECK-IN MESSAGE
        // ----------------------------------------------------

        const embed =
          new EmbedBuilder()
            .setAuthor({
              name:
                getDisplayName(
                  interaction
                ),

              iconURL:
                interaction.user
                  .displayAvatarURL(),
            })

            .setTitle(
              "Daily Check In ✅"
            )

            .setDescription(
              `<@${interaction.user.id}>`
            )

            .addFields(
              {
                name:
                  "✅ What I Did Yesterday",

                value:
                  yesterday,
              },

              {
                name:
                  "🎯 What I Want To Get Done Today",

                value:
                  today,
              },

              {
                name:
                  "🔥 Streaks!",

                value:
                  `🔥 **${calculated.current}-day streak**\n` +
                  `🏆 **${longestStreak} days longest streak**`,
              }
            )

            .setTimestamp();


        await interaction.reply({
          embeds: [embed],
        });


        return;
      }


    } catch (error) {
      console.error(
        "❌ Interaction error:",
        error
      );


      // If we already deferred the interaction,
      // edit that response instead of trying
      // to create a new one.
      if (interaction.deferred) {
        try {
          await interaction.editReply({
            content:
              "❌ Something went wrong while processing that.",
            embeds: [],
          });
        } catch (replyError) {
          console.error(
            "❌ Could not edit error response:",
            replyError
          );
        }

        return;
      }


      if (!interaction.replied) {
        try {
          await interaction.reply({
            content:
              "❌ Something went wrong while processing that.",

            flags:
              MessageFlags.Ephemeral,
          });
        } catch (replyError) {
          console.error(
            "❌ Could not send error response:",
            replyError
          );
        }
      }
    }
  }
);


// ============================================================
// DAILY REMINDER
// ============================================================

function startDailyReminder() {
  /*
   * If CHECKIN_CHANNEL_ID isn't configured,
   * the bot still works normally.
   */

  if (!process.env.CHECKIN_CHANNEL_ID) {
    console.log(
      "ℹ️ CHECKIN_CHANNEL_ID not set — daily reminder disabled"
    );

    return;
  }


  /*
   * Every day at 09:00 in TIME_ZONE.
   */

  cron.schedule(
    "0 9 * * *",

    async () => {
      try {
        const channel =
          await client.channels.fetch(
            process.env
              .CHECKIN_CHANNEL_ID
          );


        if (
          !channel ||
          !channel.isTextBased()
        ) {
          console.error(
            "❌ CHECKIN_CHANNEL_ID is not a valid text channel"
          );

          return;
        }


        const button =
          new ButtonBuilder()
            .setCustomId(
              "daily_checkin_button"
            )
            .setLabel("Check in")
            .setEmoji("✅")
            .setStyle(
              ButtonStyle.Primary
            );


        const row =
          new ActionRowBuilder()
            .addComponents(button);


        const embed =
          new EmbedBuilder()
            .setTitle(
              "☀️ Daily Check In"
            )
            .setDescription(
              "What did you accomplish yesterday, and what do you want to get done today?"
            );


        await channel.send({
          embeds: [embed],
          components: [row],
        });


        console.log(
          "✅ Daily check-in reminder sent"
        );

      } catch (error) {
        console.error(
          "❌ Daily reminder error:",
          error
        );
      }
    },

    {
      timezone: TIME_ZONE,
    }
  );


  console.log(
    `✅ Daily reminder scheduled for 09:00 (${TIME_ZONE})`
  );
}


// ============================================================
// START BOT
// ============================================================

async function start() {
  const requiredVariables = [
    "DISCORD_TOKEN",
    "GUILD_ID",
    "DATABASE_URL",
  ];


  for (
    const variable of requiredVariables
  ) {
    if (!process.env[variable]) {
      throw new Error(
        `Missing required environment variable: ${variable}`
      );
    }
  }


  // Connect to PostgreSQL and create tables.
  await setupDatabase();


  // Connect to Discord.
  await client.login(
    process.env.DISCORD_TOKEN
  );
}


// ============================================================
// RUN
// ============================================================

start().catch(
  (error) => {
    console.error(
      "❌ Bot failed to start:",
      error
    );

    process.exit(1);
  }
);