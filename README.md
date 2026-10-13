# Daily Check-in Bot

A Discord bot for daily accountability check-ins. Members post what they did yesterday and what they plan to do today, build streaks, and compete on a leaderboard. Built for the community server of my YouTube channel [Commit Issues](https://youtube.com/@CommitIssues).

**Stack:** Node.js · discord.js v14 · PostgreSQL (Neon) · node-cron

<!-- Add a screenshot here: the check-in modal and a posted check-in embed -->
<!-- ![Check-in in action](docs/checkin.png) -->

## Features

- **`/checkin`** – opens a modal with two fields: *Yesterday* (optional) and *Today* (required). The submission is saved and posted as an embed in the channel.
- **`/streak`** – shows your current and longest streak (only visible to you).
- **`/leaderboard`** – top 10 by `current` or `longest` streak, with 🥇🥈🥉 for the top three. Ties are broken by the other streak type.
- **One check-in per day** – checking in again on the same day updates the entry instead of creating a duplicate.

## How streaks work

- **Current streak:** consecutive calendar days counted backwards from your latest check-in. It stays alive if your last check-in was today or yesterday, otherwise it resets to 0.
- **Longest streak:** the longest run of consecutive days ever. The bot stores the historical best separately, so records survive even if older data changes.
- **Time zones:** "today" is calculated in the configured `TIME_ZONE` (default `UTC`), so a check-in at 00:30 counts for the right day for the community.

## Architecture

```
index.js                  Discord client, slash commands, modal + button handling,
                          streak calculation, daily cron reminder
database.js               PostgreSQL access layer (pg connection pool)
import-longest-streaks.js One-off migration script to seed historical streak records
```

**Database** – two tables, created automatically on startup:

| Table          | Purpose                                                                 |
|----------------|-------------------------------------------------------------------------|
| `checkins`     | One row per user per day (unique on guild + user + date), with the yesterday/today text |
| `streak_stats` | Each user's historical longest streak (only ever increases)            |

Slash commands are registered to a single guild on startup, so changes are available immediately without global command propagation.

## Getting started

### Prerequisites
- Node.js 18+
- A PostgreSQL database (I use [Neon](https://neon.tech)'s free tier)
- A Discord application with a bot token ([Discord Developer Portal](https://discord.com/developers/applications)), invited to your server with the `bot` and `applications.commands` scopes

### Setup
```bash
git clone https://github.com/efeglr/checkin-discord-bot.git
cd checkin-discord-bot
npm install
cp .env.example .env   # then fill in your values
npm start
```

### Environment variables

| Variable             | Required | Description                                               |
|----------------------|----------|-----------------------------------------------------------|
| `DISCORD_TOKEN`      | yes      | Bot token from the Discord Developer Portal               |
| `GUILD_ID`           | yes      | ID of the server the bot runs on                          |
| `DATABASE_URL`       | yes      | PostgreSQL connection string                              |
| `TIME_ZONE`          | no       | IANA time zone for "today" and the reminder (default `UTC`) |
| `CHECKIN_CHANNEL_ID` | no       | Channel for the daily 09:00 reminder; reminder is off if unset |

## What I learned

- Designing streak logic around calendar days and time zones instead of 24-hour windows
- Modeling idempotent writes in Postgres (upsert on a unique key) so repeated check-ins never duplicate data
- Handling Discord's interaction lifecycle: slash commands, buttons, modals, deferred and ephemeral replies
- Migrating existing community data into a new system without losing members' records
