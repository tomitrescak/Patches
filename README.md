# Patches

A Next.js app for tracking patch-change days and Optune wear sessions.

## Setup

Create `.env` with a Postgres connection string:

```sh
DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public"
```

Install dependencies and create the database tables:

```sh
pnpm install
pnpm prisma:migrate
pnpm dev
```

For Vercel, add `DATABASE_URL` in Project Settings, then deploy. `vercel.json` runs `pnpm prisma:deploy` before the build so the Postgres tables are created from the committed Prisma migration.
