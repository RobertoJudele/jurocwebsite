# Deploying the Juroc site + contact API

The VPS already runs a Docker Compose stack (`trainee_db`, `trainee_api`,
`trainee_nginx`, `trainee_certbot`). `trainee_nginx` owns ports 80 and 443, so
the marketing site and its contact API join that stack rather than running
beside it — nothing else can bind those ports.

Every step below touches a stack that is already serving production traffic.
Steps 1–5 change nothing live; step 6 is the first that reloads nginx.

## 1. server_name collision check — DONE

Run from `~/Trainee/server`:

```sh
grep -r "server_name" ./nginx/conf.d/
# ./nginx/conf.d/app.conf:    server_name api.juroc.tech;   (x2, :80 and :443)
```

The trainee API owns `api.juroc.tech`; this site takes `juroc.tech` and
`www.juroc.tech`. No overlap, so the new config is purely additive and
`app.conf` is never edited.

Note that `api.juroc.tech` already resolves to this VPS, but the apex
`juroc.tech` likely still points at GitHub Pages — see step 7.

## 2. Check the VPS can send mail at all

```sh
nc -zv smtp.your-provider.com 465
```

Many VPS providers block outbound SMTP by default, sometimes including 465 and
587. If this hangs, open a support ticket — no amount of config will fix it, and
it is better to find out now than after everything else is wired up.

## 3. Clone the site

The trainee stack lives in `~/Trainee/server/`, and its nginx already serves
`api.juroc.tech`. The marketing site is a separate project, so clone it to its
own home rather than nesting it in the Trainee tree:

```sh
git clone https://github.com/<your-org>/jurocwebsite.git /home/robi/jurocwebsite
```

`docker-compose.juroc-site.yml` uses that absolute path throughout. If you put
it elsewhere, update the three paths in that file.

## 4. Configure SMTP credentials

```sh
cp /home/robi/jurocwebsite/server/.env.example /home/robi/jurocwebsite/server/.env
nano /home/robi/jurocwebsite/server/.env
chmod 600 /home/robi/jurocwebsite/server/.env
```

Confirmed working values: `smtp.gmail.com`, port `465`, `SMTP_SECURE=true`,
user `robertojudele@juroc.tech`, with the Google app password. The mailbox is on
Google Workspace, so SPF and DKIM are already aligned for the domain.

Fill in `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` for
whoever hosts `robertojudele@juroc.tech`. `.env.example` lists the correct host
and port for Google Workspace, Zoho, Migadu and Microsoft 365.

If the mailbox has 2FA, `SMTP_PASS` must be an **app-specific password**. The
normal account password is rejected with `EAUTH`.

This is a different `.env` from the trainee stack's — keep them separate.

## 5. Merge the services and verify SMTP

Paste the `juroc-site-api` service from `docker-compose.juroc-site.yml` into the
main `docker-compose.yml`, and add the two marked lines to the existing `nginx`
service (the `/var/www/juroc.tech` mount and the `depends_on` entry).

Then test the relay in isolation, before any of it is public:

```sh
docker compose build juroc-site-api
docker compose run --rm juroc-site-api node verify-smtp.js
```

This connects, authenticates and sends one test message to `MAIL_TO`. Do not
continue until it passes **and the message actually arrives** — check spam too.
If it lands in spam now, nothing later in this process will fix that.

- `EAUTH` — wrong password, or an account password where an app password is needed.
- `ESOCKET` / `ETIMEDOUT` — wrong host/port, or the provider block from step 2.

Then start it:

```sh
docker compose up -d juroc-site-api
docker compose logs juroc-site-api      # expect "SMTP connection verified"
```

## 6. Add the nginx config (HTTP only for now)

```sh
cd ~/Trainee/server
cp /home/robi/jurocwebsite/deploy/nginx/juroc.tech.conf ./nginx/conf.d/
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload
```

Config files load alphabetically, so `app.conf` is read before
`juroc.tech.conf`. That does not matter here: nginx matches on `server_name`
first and only falls back to the default server when no name matches. An
explicit `juroc.tech` block wins for `juroc.tech`, and `api.juroc.tech` keeps
its own block untouched.

Leave the 443 block commented out. The certificate does not exist yet, and
nginx **refuses to start with a missing `ssl_certificate` file** — on a restart
that would take the trainee app down with it.

`nginx -t` before every reload, always.

## 7. Point DNS at the VPS, then issue the certificate

Set the `A` records for `juroc.tech` and `www.juroc.tech` to the VPS IP and wait
for propagation. The webroot challenge only works once the domain actually
resolves here.

```sh
docker compose run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot \
  -d juroc.tech -d www.juroc.tech \
  --email robertojudele@juroc.tech --agree-tos --no-eff-email
```

The `--entrypoint` override is needed because the certbot service's own
entrypoint is the renewal loop. Add `--dry-run` first if you want a rehearsal —
Let's Encrypt rate-limits failed issuance attempts fairly aggressively.

The existing renewal loop picks this cert up automatically afterwards; no change
needed there.

## 8. Enable HTTPS

Uncomment the 443 block in `./nginx/conf.d/juroc.tech.conf`, then:

```sh
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload
```

## 9. Turn off the GitHub Pages deploy

`.github/workflows/static.yml` is already set to `workflow_dispatch` only, so
pushing to `main` no longer publishes. Once the VPS serves traffic, also disable
Pages in the repo's **Settings → Pages** so no stale copy stays reachable.

## 10. Test end to end

Submit the real form at `https://juroc.tech/#contact` and confirm:

- the enquiry arrives at `robertojudele@juroc.tech`
- hitting reply addresses the visitor, not yourself
- the visitor receives the confirmation auto-reply
- **both land in the inbox, not spam** — test with a Gmail address specifically

Then the failure path, which matters as much:

```sh
docker compose stop juroc-site-api
```

Submit again. The form must show a red error pointing at the direct address and
must **keep** what was typed. Confirm the trainee app is still up — this also
proves the variable-based `proxy_pass` works and a dead upstream returns 502
rather than killing nginx. Then:

```sh
docker compose start juroc-site-api
```

## Updating the site later

```sh
cd jurocwebsite && git pull
```

Static files are bind-mounted, so HTML/CSS/JS changes are live immediately — no
restart. Only if `server/` changed:

```sh
docker compose up -d --build juroc-site-api
```
