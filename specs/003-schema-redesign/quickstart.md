# Quickstart: Schema Redesign — Developer Setup

**Feature**: 003-schema-redesign  
**Prerequisites**: Node.js 20 LTS, PostgreSQL 15+, Redis 7.x

---

## 1. Create Monorepo Workspace Root

From the repository root (`/jump`), create a root `package.json`:

```bash
# From repo root
cat > package.json << 'EOF'
{
  "private": true,
  "workspaces": ["backend", "frontend", "packages/*"],
  "scripts": {
    "db:generate": "npm run generate --workspace=packages/db",
    "db:migrate": "npm run migrate:dev --workspace=packages/db",
    "db:seed": "npm run seed --workspace=packages/db",
    "db:reset": "npm run migrate:reset --workspace=packages/db",
    "dev:backend": "npm run dev --workspace=backend",
    "dev:frontend": "npm run dev --workspace=frontend"
  }
}
EOF
```

## 2. Create packages/db

```bash
mkdir -p packages/db/prisma packages/db/src
```

### packages/db/package.json

```json
{
  "name": "@jump/db",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts",
    "generate": "prisma generate",
    "migrate:dev": "prisma migrate dev",
    "migrate:deploy": "prisma migrate deploy",
    "migrate:reset": "prisma migrate reset",
    "seed": "tsx prisma/seed.ts",
    "postinstall": "prisma generate"
  },
  "dependencies": {
    "@prisma/client": "^6.19.2"
  },
  "devDependencies": {
    "prisma": "^6.19.2",
    "tsup": "^8.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0"
  },
  "prisma": {
    "seed": "tsx prisma/seed.ts"
  }
}
```

### packages/db/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

### packages/db/src/index.ts

```typescript
import { PrismaClient } from "../generated/client/index.js";

// Singleton pattern — prevents connection exhaustion during hot reload
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// Re-export all types from the generated client
export * from "../generated/client/index.js";
export { PrismaClient };
```

### packages/db/.gitignore

```
generated/
dist/
node_modules/
```

## 3. Move Prisma Schema

```bash
# Move schema and delete old migrations (clean start)
cp backend/prisma/schema.prisma packages/db/prisma/schema.prisma

# Remove old migrations (we're wiping and starting fresh)
rm -rf backend/prisma/migrations/
```

Now replace the contents of `packages/db/prisma/schema.prisma` with the new schema from [data-model.md](data-model.md).

## 4. Environment Configuration

Create `packages/db/.env`:

```env
DATABASE_URL="postgresql://jump:jump@localhost:5432/jump?schema=public"
```

## 5. Update Backend Dependencies

In `backend/package.json`:

```bash
cd backend

# Remove direct Prisma dependencies
npm uninstall prisma @prisma/client

# Add workspace dependency
# (Add manually to package.json):
#   "@jump/db": "*"

# Replace sendgrid with resend
npm uninstall @sendgrid/mail
npm install resend
```

Update imports in all backend files:

```javascript
// Before
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

// After
import { prisma } from "@jump/db";
```

## 6. Update Frontend Dependencies

In `frontend/package.json`:

```bash
cd frontend

# Add Auth.js, Prisma adapter, and workspace dependency
npm install next-auth@beta @auth/prisma-adapter
npm install resend

# Add manually to package.json:
#   "@jump/db": "*"
```

## 7. Install and Generate

```bash
# From repo root — install all workspaces
npm install

# This triggers postinstall in packages/db, running prisma generate
# If it doesn't, run manually:
npm run db:generate
```

## 8. Run Migration

```bash
# Create the initial migration
npm run db:migrate -- --name init_schema_redesign

# Seed sample data
npm run db:seed
```

## 9. Auth.js Configuration

### Required Environment Variables

Add to `frontend/.env.local`:

```env
# Shared secret (MUST be the same in backend)
AUTH_SECRET="your-32-char-random-secret-here"

# Resend (magic link emails)
AUTH_RESEND_KEY="re_your_resend_api_key"

# Google OAuth
AUTH_GOOGLE_ID="your-google-client-id"
AUTH_GOOGLE_SECRET="your-google-client-secret"

# Database (same as packages/db)
DATABASE_URL="postgresql://jump:jump@localhost:5432/jump?schema=public"
```

Add to `backend/.env`:

```env
AUTH_SECRET="your-32-char-random-secret-here"  # Same as frontend
```

### Key Files to Create

| File                                               | Purpose                                                   |
| -------------------------------------------------- | --------------------------------------------------------- |
| `frontend/src/auth.config.ts`                      | Edge-safe config (providers only, no Prisma)              |
| `frontend/src/auth.ts`                             | Full config (PrismaAdapter, callbacks, JWT encode/decode) |
| `frontend/middleware.ts`                           | Edge middleware using auth.config.ts                      |
| `frontend/src/app/api/auth/[...nextauth]/route.ts` | Auth.js route handler                                     |

## 10. Verify Setup

```bash
# Backend should start without errors
npm run dev:backend

# Frontend should start without errors
npm run dev:frontend

# Run existing tests (expect failures — services need updating)
cd backend && npm test
```

## Common Issues

| Problem                                    | Solution                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| `Cannot find module '@jump/db'`            | Run `npm install` from repo root to link workspaces                              |
| `Cannot find module '../generated/client'` | Run `npm run db:generate` from repo root                                         |
| `P1001: Can't reach database`              | Ensure PostgreSQL is running and `DATABASE_URL` is correct in `packages/db/.env` |
| `PRISMA_SCHEMA_DOES_NOT_EXIST`             | Ensure schema.prisma exists at `packages/db/prisma/schema.prisma`                |
| Auth.js JWT errors in Express              | Ensure `AUTH_SECRET` is identical in frontend and backend `.env` files           |
