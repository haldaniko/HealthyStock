# HealthyStock

Full-stack blog platform where AI writes as Maria Iordanova in the style of "Bloomberg for Healthy Stocks".

## Stack

- Backend: Node.js, Express, TypeScript
- Frontend: Vite, React, TypeScript, SCSS
- Infra: Docker Compose, PostgreSQL for local development, SQLite for production
- AI writing: OpenRouter API
- Newsletter: SMTP via Nodemailer

## Project Structure

- /backend
- /frontend
- /backend/Dockerfile
- /frontend/Dockerfile
- /docker-compose.yml
- /docker-compose.prod.yml

## Features

- Custom non-standard hero section
- Blog feed on homepage
- Individual blog article page
- Article search/filter
- SMTP subscription form and API
- OpenRouter endpoint for generating new articles from master prompt
- Admin panel for creating/editing articles and generation settings
- Draft/published article status, delete for generated/overridden posts, and backend audit logging
- Protected DB-backed admin auth with access token and httpOnly refresh cookie
- SPA frontend with public blog pages and hidden `/admin` control room

## Local Development (Docker)

1. Run Docker:
   - `docker compose up -d --build`
   - Docker now runs `env-setup` first and auto-creates missing local env files (`.env`, `backend/.env`, `frontend/.env`) with generated `JWT_SECRET` and `REFRESH_TOKEN_SECRET`.
2. Fill `OPENROUTER_API_KEY` in `backend/.env` only if AI generation is needed.
   - For Docker, `DATABASE_URL` is overridden by `docker-compose.yml` and points to the `postgres` service.
   - SMTP can stay empty locally unless you want to test email subscriptions.
3. Run:
   - `npm run dev:docker` (optional convenience command, same result)
   - Docker development uses built images, not live source-code mounts. After changing backend or frontend code, rebuild the affected service with `docker compose up --build -d backend frontend`.
   - Dev and production use separate image names. Local development keeps the existing `healthystock_postgres_data` volume so generated articles survive rebuilds.
4. The local superadmin is created automatically by the `admin-seed` service:
   - Email: `admin@healthystock.local`
   - Password: `MySecretPassword123!`
   - Override these with `LOCAL_SUPERADMIN_EMAIL` and `LOCAL_SUPERADMIN_PASSWORD` before running Docker Compose if needed.
5. Open:
   - Frontend: http://localhost:3000
   - Backend: http://localhost:4000/api/health
   - Admin: http://localhost:3000/admin

## Admin Setup

Admin accounts are stored in the configured database. The database stores only `password_hash`, never the plain password.

With Docker:

- `docker compose exec backend npm run create-superadmin -- admin@yourdomain.com 'your-strong-password-here'`
- For local Docker, `admin-seed` also runs automatically on `docker compose up -d --build` and upserts `admin@healthystock.local`.

Without Docker, point `DATABASE_URL` to PostgreSQL first, then run:

- `cd backend`
- `npm run create-superadmin -- admin@yourdomain.com 'your-strong-password-here'`

In the admin login screen, enter the email and the original password you chose. Re-running `create-superadmin` for the same email resets that user's password and keeps the account active with `superadmin` role.

Do not use `ADMIN_USERNAME`, `ADMIN_PASSWORD`, or `ADMIN_PASSWORD_HASH`. Those env-based credentials were replaced by the database-backed admin system.

## Auth Troubleshooting

If the admin page shows `Failed to fetch`, first check that the backend is alive:

- `curl http://localhost:4000/api/health`
- `docker compose ps`
- `docker compose logs --tail=120 backend`

If this happened after switching from the old env-based auth to DB auth, the browser may still have an old `hs_refresh_token` cookie. Clear cookies for `localhost`, refresh `/admin`, and sign in again.

You can also clear stored refresh tokens locally:

- stop the backend or make sure nobody is logged in
- Docker/PostgreSQL: `docker compose exec postgres psql -U healthystock -d healthystock -c "delete from refresh_tokens;"`
- restart backend: `docker compose restart backend`

This only logs admins out. It does not delete users.

## Production Secrets

Set stable, strong secrets in `backend/.env.production` or your hosting secret manager:

- `DATABASE_URL` (set by production Compose to `sqlite:/host/db.sqlite3`)
- `JWT_SECRET`
- `REFRESH_TOKEN_SECRET`

Generate them once, keep them stable, and do not commit them:

- `cd backend && npm run generate-secrets`

Do not generate these secrets on every app startup. Changing them invalidates active admin sessions and refresh tokens.

For the one-time production import, keep the existing values of:

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`

## Production Deployment (Docker)

See [the production migration runbook](PRODUCTION-SQLITE-MIGRATION.md) for backup, rollout, verification, and recovery. With the existing `.env.production` and `backend/.env.production` retained, run from the same project directory:

```sh
docker compose -f docker-compose.prod.yml up --build -d
```

The first run copies PostgreSQL data into a verified temporary SQLite file, copies the old uploads volume into `./media`, and publishes `./db.sqlite3` only after the checks pass. Later runs verify and keep that SQLite file. The old PostgreSQL and uploads volumes remain attached. PostgreSQL is fenced read-only after a successful import.

Production backend will refuse to start if required secrets are missing, if `JWT_SECRET` and `REFRESH_TOKEN_SECRET` are equal, if secrets are too short, or if production CORS/site URLs still point to `localhost`.

## Local Development (without Docker)

1. Install dependencies:
   - `cd backend && npm install`
   - `cd ../frontend && npm install`
2. Start backend:
   - `cd backend && npm run dev`
3. Start frontend:
   - `cd frontend && npm run dev`

## Production Ports

- Frontend container is exposed on host port `8099`.
- Backend container is exposed on host port `4104`.
- PostgreSQL is not exposed publicly in `docker-compose.prod.yml`; it remains attached for the initial import and recovery.

Put a reverse proxy such as Nginx, Caddy, Traefik, or your hosting platform in front of these containers for HTTPS and public domains.

An Nginx starting point is available in `nginx.sample`. It proxies `/api/` and `/uploads/` to backend port `4104`, and frontend traffic to port `8099`.

## API Summary

- `GET /api/health`
- `GET /api/posts`
- `GET /api/posts/:slug`
- `GET /api/posts/search?q=...`
- `POST /api/subscribe` with `{ "email": "..." }`
- `POST /api/ai/generate-article` with `{ "topic": "..." }` - admin access token required
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/admin/posts`
- `POST /api/admin/posts`
- `PUT /api/admin/posts/:slug`
- `DELETE /api/admin/posts/:slug`
- `GET /api/admin/settings`
- `PUT /api/admin/settings`

## Notes

- Set `VITE_API_URL`, `CORS_ORIGIN`, and cookie domain settings when deploying to a real domain.
- Generated/admin-edited posts, admin settings, refresh sessions, subscribers, audit events, admin users, and password hashes are stored in `./db.sqlite3` in production.
- Legacy JSON files under `backend/data` are only used for one-time migration when the corresponding database table is empty.
- Runtime data files are ignored by git. Back up `./db.sqlite3` and `./media` after the switch; retain the old PostgreSQL and uploads volumes.
- Admin article HTML is sanitized before saving.
- Production Docker images do not include local `backend/data` files, `.env`, `node_modules`, or TypeScript build cache.

## Telegram posting bot

HealthyStock exposes the editor bot contract at `/api/bot/v1/`. Every endpoint requires
`Authorization: Bearer <BOT_INTEGRATION_TOKEN>`; this token is separate from Telegram and
admin authentication. Configure these backend variables:

```env
PUBLIC_SITE_URL=https://yourdomain.com
BOT_INTEGRATION_TOKEN=replace-with-a-long-random-secret
```

The bot site entry is:

```json
{"id":"healthystock","name":"HealthyStock","api_base":"https://yourdomain.com/api/bot/v1/","token_env":"HEALTHYSTOCK_INTEGRATION_TOKEN"}
```

Routes are `GET options/`, `POST articles/`, `GET articles/:external_id/`,
`PUT articles/:external_id/image/`, and `POST articles/:external_id/publish/`.
Bot-created posts use the existing `generated_posts` model and remain hidden until the
publish call. The `bot_articles` table is created automatically at backend startup and
enforces one article per external UUID. Uploaded JPG, PNG, and WebP images are kept under
`UPLOAD_DIR/bot`; production already binds `UPLOAD_DIR=/host/media`, while local Docker
uses the persistent `healthystock_uploads_data` volume.

Run the contract checks with `cd backend && npm test`.
