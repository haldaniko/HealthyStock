# Production PostgreSQL ? SQLite rollout

## On the Linux server

1. **Back up the source PostgreSQL volume and existing files before updating code.** Run from the current project directory, using its existing Compose project name. A logical database dump is a useful second backup:

   ```sh
   set -eu
   test -f .env.production && test -f backend/.env.production
   backup_dir="$HOME/HealthyStock-backup-$(date +%F-%H%M%S)"
   mkdir -m 700 -p "$backup_dir"
   pg_container=$(docker compose --env-file .env.production -f docker-compose.prod.yml ps -q postgres)
   backend_container=$(docker compose --env-file .env.production -f docker-compose.prod.yml ps -q backend)
   pg_volume=$(docker inspect "$pg_container" --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}')
   uploads_volume=$(docker inspect "$backend_container" --format '{{range .Mounts}}{{if eq .Destination "/app/uploads"}}{{.Name}}{{end}}{{end}}')
   test -n "$pg_volume" && test -n "$uploads_volume"
   docker compose --env-file .env.production -f docker-compose.prod.yml stop backend admin-seed
   docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_dir/postgresql.dump"
   docker compose --env-file .env.production -f docker-compose.prod.yml stop postgres
   docker run --rm -v "$pg_volume:/source:ro" -v "$backup_dir:/backup" alpine:3.20 tar -C /source -czf /backup/postgres-volume.tar.gz .
   docker run --rm -v "$uploads_volume:/source:ro" -v "$backup_dir:/backup" alpine:3.20 tar -C /source -czf /backup/uploads-volume.tar.gz .
   cp -a .env.production "$backup_dir/root.env.production"
   cp -a backend/.env.production "$backup_dir/backend.env.production"
   if [ -f db.sqlite3 ]; then cp -a db.sqlite3 "$backup_dir/"; fi
   if [ -d media ]; then cp -a media "$backup_dir/"; fi
   ```

   The commands inspect the current containers to find the exact old volume names. Do not use `docker compose down -v`. Stopping the old backend before the backup closes the write window. Keep backup files outside the Git checkout and protect the env files.

2. Update the code **in the same directory**. Preserve the existing `.env.production`, `backend/.env.production`, and Compose project name (`COMPOSE_PROJECT_NAME` if used). The existing `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD` values must match the old volume. If the previous deployment used a different Compose project name, run with that same `COMPOSE_PROJECT_NAME` environment variable; a new project name would create new empty volumes. The new production file reads `.env.production` directly, so `--env-file` is no longer needed.

3. Run:

   ```sh
   docker compose -f docker-compose.prod.yml up --build -d
   ```

4. Inspect the migration and application:

   ```sh
   docker compose -f docker-compose.prod.yml logs --no-log-prefix migrate
   docker compose -f docker-compose.prod.yml ps
   ls -lh db.sqlite3
   find media -type f | wc -l
   curl -f http://localhost:4104/api/health
   ```

   The importer checks each of the six application tables, row counts, primary/foreign key and SQLite integrity checks, and every `/uploads/` cover URL in generated posts. A nonzero migration exit prevents backend startup. `./db.sqlite3` appears only after the checked import finishes. Existing files in `./media` are kept; a same-name file with different contents causes a hard failure. Uploaded covers remain at `/uploads/covers/<file>` and are also served through `/api/uploads/covers/<file>`, which works with an existing reverse proxy for `/api/`.

## Repeat deploys and recovery

Running the same `up --build -d` command again checks the existing SQLite file and never imports PostgreSQL over it. The migration leaves PostgreSQL data and both named volumes intact. The source database stays read-only after success as a fence against writes from old containers. The production backend uses `sqlite:/host/db.sqlite3` and `UPLOAD_DIR=/host/media`; the project root is bind mounted because SQLite's rollback journal must be created beside the database file. The importer gives the fixed backend UID/GID 10001 write access to the database, media directory, and project directory group so journal creation works on Linux. It sets the directory sticky bit to protect files owned by the deploy user. Do not move just `db.sqlite3` while the backend is writing; stop the backend or use the SQLite backup API for later backups.

If migration fails, inspect `migrate` logs. The temporary `.db.sqlite3.import-*` file is removed, `db.sqlite3` is not published, and the importer attempts to restore PostgreSQL's previous write setting. Keep the old volumes and the backup. Fix the reported cause, then rerun the same `up` command. If a source table is missing a column required by this version, inspect the live schema before changing data; the importer fails closed. If `db.sqlite3` already exists but is corrupt or has no completed migration marker, the importer refuses to replace it. Restore the last good SQLite backup or investigate it manually; never delete it merely to make the importer run.

After the transition, back up `./db.sqlite3` and `./media` regularly. Keep the pre-migration PostgreSQL and uploads backups until the SQLite deployment has been verified and retained long enough for your recovery policy.
