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

## 2. Check which SMTP port the VPS can actually reach

```sh
for p in 465 587; do
  timeout 8 bash -c "cat < /dev/null > /dev/tcp/smtp.gmail.com/$p" \
    && echo "$p OPEN" || echo "$p BLOCKED"
done
```

**Result on this VPS (Hetzner nbg1, verified 2026-07-28): 465 BLOCKED, 587
OPEN.** Hence `SMTP_PORT=587` / `SMTP_SECURE=false` (STARTTLS) rather than 465
implicit TLS. Both are encrypted; the service sets `requireTLS` so a missing
STARTTLS upgrade fails rather than sending credentials in cleartext.

Do this before anything else. A blocked port and a bad password look identical
from the application — both just hang — and chasing the wrong one wastes real
time. If both ports are blocked, that is a provider support ticket; no config
will fix it.

Note: do not test `smtp.gmail.com:443` as a control. It does not listen on 443,
so a failure there means nothing.

## 3. Clone the site

The trainee stack lives in `~/Trainee/server/`, and its nginx already serves
`api.juroc.tech`. The marketing site is a separate project, so clone it to its
own home rather than nesting it in the Trainee tree:

```sh
git clone https://github.com/<your-org>/jurocwebsite.git /home/robi/jurocwebsite
```

`docker-compose.merged.yml` uses that absolute path throughout. If you put it
elsewhere, update the three paths in that file.

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

`docker-compose.merged.yml` is the trainee stack with the site's services
already merged in, so it can be dropped straight in:

```sh
cd ~/Trainee/server
cp docker-compose.yml docker-compose.yml.bak      # keep a way back
cp /home/robi/jurocwebsite/deploy/docker-compose.merged.yml docker-compose.yml
docker compose config --quiet && echo "parses OK"
```

**Diff it against your backup before going further.** The merged file mirrors
the trainee stack as it stood on 2026-07-28; if that has changed since, apply
the three additions by hand instead of overwriting:

```sh
diff docker-compose.yml.bak docker-compose.yml
```

The only differences should be the `juroc-site-api` service, the
`/var/www/juroc.tech` mount on nginx, and `juroc-site-api` in nginx's
`depends_on` — each marked `ADDED FOR JUROC SITE`.

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

## 6. Install the BOOTSTRAP nginx config

`juroc.tech` is live on GitHub Pages over HTTPS right now. This is a cutover,
not a fresh setup, so the order below is designed to avoid a window where the
domain resolves here but has no certificate.

Use the bootstrap config, which serves the site over plain HTTP and answers
ACME challenges. Do **not** install `juroc.tech.conf` yet — its `:80` block
redirects to HTTPS, and with no certificate for `juroc.tech` yet, browsers
would fall through to the `api.juroc.tech` 443 block and show a certificate
name mismatch. That is a harder failure than the site it replaces.

```sh
cd ~/Trainee/server
cp /home/robi/jurocwebsite/deploy/nginx/juroc.tech.bootstrap.conf ./nginx/conf.d/
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload
```

Config files load alphabetically, so `app.conf` is read first. That does not
matter: nginx matches on `server_name` before falling back to a default server,
so an explicit `juroc.tech` block wins and `api.juroc.tech` is untouched.

`nginx -t` before every reload, always.

## 6b. Test the whole thing BEFORE touching DNS

This is the step that de-risks the cutover. Point curl at the VPS by IP while
sending the real `Host` header — nginx routes on the header, not on DNS, so you
can exercise the production path while the public site is still on Pages:

```sh
VPS_IP=$(hostname -I | awk '{print $1}')

curl -s -o /dev/null -w "home: %{http_code}\n"    -H "Host: juroc.tech" http://$VPS_IP/
curl -s -o /dev/null -w "privacy: %{http_code}\n" -H "Host: juroc.tech" http://$VPS_IP/privacy-policy
curl -s -w "\napi: %{http_code}\n"                -H "Host: juroc.tech" http://$VPS_IP/api/health
curl -s -o /dev/null -w "secrets blocked: %{http_code}\n" -H "Host: juroc.tech" http://$VPS_IP/server/.env

# and confirm the trainee app is unaffected
curl -s -o /dev/null -w "api.juroc.tech still up: %{http_code}\n" https://api.juroc.tech/
```

Expect `200`, `200`, `{"ok":true}` / `200`, `404`, and the trainee app
unchanged. Fix anything wrong here — it costs nothing while DNS still points
at Pages.

## 7. Cut DNS over, then issue the certificate

Lower the TTL on the `juroc.tech` and `www` records to 300s **a few hours
before** the cutover, so the switch propagates in minutes rather than hours.
The records currently point at GitHub Pages; change them to the VPS IP.

Watch for the switch:

```sh
watch -n 10 'dig +short juroc.tech; curl -sI http://juroc.tech | head -1'
```

Once it resolves here (the site is up over HTTP at this point, just not yet
HTTPS), issue the certificate immediately:

```sh
cd ~/Trainee/server
docker compose run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot \
  -d juroc.tech -d www.juroc.tech \
  --email robertojudele@juroc.tech --agree-tos --no-eff-email
```

The `--entrypoint` override is needed because the certbot service's own
entrypoint is the renewal loop. Add `--dry-run` first for a rehearsal — Let's
Encrypt rate-limits failed issuance attempts aggressively.

The existing renewal loop picks the new certificate up automatically; the
nginx container already reloads every 6h to collect renewals. No change needed.

## 8. Swap the bootstrap for the real config (enables HTTPS)

Now that the certificate exists, replace the temporary HTTP-only config with
the real one and uncomment its 443 block:

```sh
cd ~/Trainee/server
rm ./nginx/conf.d/juroc.tech.bootstrap.conf
cp /home/robi/jurocwebsite/deploy/nginx/juroc.tech.conf ./nginx/conf.d/
# uncomment the 443 block in that file
nano ./nginx/conf.d/juroc.tech.conf

docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload
```

Removing the bootstrap file matters — leaving both would give two `:80` blocks
with `server_name juroc.tech`, and nginx silently keeps only the first.

Verify HTTPS and the redirect:

```sh
curl -sI https://juroc.tech | head -1          # expect 200, and no GitHub headers
curl -sI http://juroc.tech  | head -2          # expect 301 -> https
```

Note this config sends HSTS with a one-year max-age. That is a commitment:
once a browser sees it, that browser will refuse plain HTTP for juroc.tech for
a year. Only reload this after HTTPS is confirmed working.

## 9. Turn off the GitHub Pages deploy

Do this **only after** step 8 is verified. Disabling the workflow does not take
the Pages site down — it freezes it at its last build. If you merge to `main`
before the VPS serves traffic, `main` has the fix while the live site keeps
serving the old form indefinitely.

Order:

1. Confirm `https://juroc.tech` is served by the VPS (no `server: GitHub.com`).
2. Merge `contact-form-email` to `main`. The workflow is already set to
   `workflow_dispatch` only, so pushing to `main` no longer publishes.
3. Remove the custom domain in the repo's **Settings → Pages**, then disable
   Pages. Leaving the custom domain set there while DNS points elsewhere is
   harmless but leaves a dangling claim on the hostname.

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
