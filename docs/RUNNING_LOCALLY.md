# Running Locally

This guide explains how to run Macro on your machine. The local stack runs without Doppler. It runs Postgres, Redis, LocalStack, OpenSearch, Kafka, and FusionAuth in Docker, with dummy AWS credentials and fixed test secrets.

## What You Need

Install these tools before you start:

1. [Nix](https://nix.dev/install-nix) package manager
2. [Docker](https://docs.docker.com/get-docker/) with the Compose v2 plugin (Docker Desktop, OrbStack, or Colima work)
3. [just](https://just.systems/man/en/installation.html) command runner
4. [Cargo](https://doc.rust-lang.org/cargo/getting-started/installation.html), the Rust package manager

Clone the repository:

```bash
git clone https://github.com/macro-inc/macro.git
cd macro
```

## Enter the Nix Shell

The Nix shell provides the Rust toolchain, Bun, sqlx, zig, and cargo-zigbuild.

```bash
nix develop
```

If `nix develop` fails, enable the experimental features:

```bash
nix develop --extra-experimental-features nix-command --extra-experimental-features flakes
```

Nix requires these experimental features to work. The command above enables them for one run. To enable them permanently, set this in `~/.config/nix/nix.conf`:

```
experimental-features = nix-command flakes
```

## Start the Stack

Run this command from the repository root if you do not have Doppler access:

```bash
just run_local --no-doppler
```

The local stack does not need Doppler. It uses the code-defined local configuration with dummy AWS credentials and fixed test secrets. Most contributors are not on the team, so this is the common path.

The stack boots with stubbed values for every config the services require — including the third-party integrations (Google, GitHub, Stripe, CloudFront). Those flows won't actually work against real services with the stubs, but the stack starts and everything else (auth, documents, email, search) is fully functional.

To use a real integration locally, supply its keys via `--env-file` — see [Integration Secrets](#integration-secrets) below.

Run this command if you have Doppler access. It pulls the `lcl_personal` config and overlays the code-defined local defaults, so every integration value is real:

```bash
just run_local
```

If you prefer to test against real cloud infrastructure, you need [Doppler](https://www.doppler.com) for secrets management.

This command:

- Builds the Rust backend services
- Starts the local infrastructure (Postgres, Redis, LocalStack, OpenSearch, Kafka, FusionAuth)
- Starts the backend services
- Starts the local proxy and the frontend

When startup finishes, the command prints the frontend URL and the important service URLs.

Open the frontend URL in your browser. The stack does not pre-create any accounts —
passwordless login creates a user on demand, so just sign up with any email you like
and enter the one-time code FusionAuth emails you. Locally that email lands in
**Mailpit** at http://localhost:8025 instead of a real inbox.

### Seeding sample data (recommended)

A bare stack has no documents, channels, or other content to click through. The
seed CLI populates a realistic world — users, teams, channels, projects, documents,
tasks, chats, calls, emails, and messages — wired up with realistic permissions:

```bash
# From the repository root, after the stack is up:
just seed-scenario apply --file seed/scenarios/team-perms.json
```

`apply` creates a FusionAuth account for each persona and prints per-persona login
links (e.g. `http://alice.localhost:3000/app/login?email=alice@seed.macro.local`).
Open each link in a plain browser tab — the per-persona hostnames keep separate
cookie jars, so you can drive several personas side by side against the same stack.

- `just seed-scenario status --file seed/scenarios/team-perms.json` — show what is
  seeded and re-print the login links.
- `just seed-scenario reset --file seed/scenarios/team-perms.json` — remove the
  scenario's rows (and its user accounts by email).
- `just seed-scenario matrix --file seed/scenarios/team-perms.json` — verify the
  expected access level for every (user, entity) pair against the live DB.

`apply` only touches rows carrying the scenario's `5eed` id marker (plus the persona
accounts it created), so it is safe to run against a stack you have been testing in.

## Integration Secrets

A `--no-doppler` stack boots with deterministic stubs for every value the services' config loaders require. The stubs are enough to start the services, but the third-party integrations they back won't work until you supply real values:

| Integration | Keys | Stub behavior |
| --- | --- | --- |
| Google login / Gmail | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET_KEY` | Google SSO and Gmail inbox linking are unavailable. Local signup still works — the email service reports "no Gmail grant" and skips inbox syncing. |
| GitHub login | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_IDP_ID` | Login with GitHub is unavailable |
| Stripe billing | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` | Checkout and subscription endpoints fail. Signup still works: the create-user webhook detects the stub key and skips the real Stripe call, storing a placeholder customer id. |
| CloudFront signed URLs | `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL`, `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID`, `DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY` | Document download URLs are unsigned (fine against local S3) |

The other stubbed keys (`REDIS_HOST`, `MACRO_DB_URL`, `INTERNAL_API_KEY`, `AUTHENTICATION_SERVICE_SECRET_KEY`, `OPENSEARCH_USERNAME`, `OPENSEARCH_PASSWORD`) are internal plumbing with correct local values — you never need to override them.

To turn on an integration, create a `local.env` with the real values and pass it to `run_local`:

```bash
just run_local --no-doppler --env-file ./local.env
```

Keys in the file override the code-defined defaults, so you only need to list the integrations you care about. With Doppler access, `just run_local` (without `--no-doppler`) supplies everything automatically.

## Check the Setup

Run the preflight check before the first start:

```bash
just doctor-local
```

The check tests the Docker daemon, the toolchain, and the required ports. It reports any problem and suggests a fix. If a start fails, run the check again.

## Control the Running Stack

While `run_local` is attached:

- Press `r` to rebuild the changed Rust services and reload them.
- Press `q` to stop the stack and exit.

Use `q`, not the terminal close button. `q` stops and removes the containers at once. The next start does not have to clean up a stale stack.

## Run More than One Stack

Use named instances for several local stacks at once. This helps across worktrees:

```bash
just run_local --instance agent-a
just run_local --instance agent-b
```

Each instance has its own Compose project, volumes, networks, env files, proxy port, frontend port, and backend ports. The ports are deterministic for the instance name. The same name gets the same port window on every run.

If the port window conflicts with another program on your machine, change the base port:

```bash
just run_local --instance agent-a --port-base 23000
```

The generated files for an instance live here:

```text
infra/local/generated/<instance>
```

## Port Conflicts (macOS)

The default instance binds a fixed set of host ports, and macOS reserves some of
them for its own services. If the app loads but API calls return unexpected HTML
(or fail), a port is almost certainly hijacked by an unrelated process. The two
most common on a fresh Mac:

- **Port 8080** — macOS's built-in WebDriver service (`com.apple.WebDriver.HTTPService`)
  listens on it when "Allow Remote Automation" is on. The auth service can't bind it.
- **Port 8090** — often taken by another project's dev server (e.g. an Expo
  `--port 8090`). The proxy can't bind it.

Symptoms: the frontend loads, but login/API calls hit the squatter and you see
HTML or errors in the browser console instead of JSON. `just doctor-local` reports
the busy ports before you start.

The fix is to run the stack on a port window that is free on your machine — no
need to kill the other process:

```bash
just doctor-local                         # see which ports are busy
just run_local --no-doppler --instance test --port-base 31000
```

A named instance binds every service at `port-base + offset`, so a free base like
`31000` moves the whole stack to one contiguous window. Use whatever base is free
on your machine (see `just doctor-local`), and keep the same `--instance` name and
`--port-base` on later runs so the ports stay deterministic.

Everything that talks to the stack takes the same two flags — run it, seed it, and
check it with the identical `--instance` / `--port-base`:

```bash
just run_local --no-doppler --instance test --port-base 31000
just seed-scenario --instance test --port-base 31000 apply --file seed/scenarios/team-perms.json
just seed-scenario --instance test --port-base 31000 status --file seed/scenarios/team-perms.json
just status_local --instance test
```

If you omit `--port-base`, a named instance still gets a deterministic (but
different) port window derived from its name — so a stack started with an explicit
`--port-base` must be seeded with the same explicit `--port-base`, or the seed CLI
will look at the wrong database. The default instance (no `--instance`) always uses
the fixed ports and needs no extra flags.

Note: the seeded persona login links (below) embed the frontend port, so re-run
`just seed-scenario apply` after switching ports to get links that match the new
window. `just status_local` prints the live endpoints for whatever is running.

## What the Stack Rebuilds

The Rust services are built on the host with `cargo zigbuild`. The binaries are mounted into a shared runtime image. Docker does not compile these services during a normal `run_local`.

Press `r` to rebuild the binaries. Only the services whose binaries changed restart.

Three services have Docker-built images. They are not rebuilt by default:

- `sync_service`
- `lexical_service`
- `websocket_service`

If you change these services, the running stack can use a stale image. Force a rebuild with this flag:

```bash
just run_local --build-aux-services
```

When you start the stack with `--build-aux-services`, press `r` to rebuild those images and recreate their containers. This is slower, so leave the flag off unless you work on those services.

If you started without the flag and suspect a stale image, press `q`. Then start again with the flag.

## Headless Mode

`just stack` runs the same stack without an attached terminal. There is no hotkey loop and no dev server. The frontend is built once and served statically by the proxy. The whole product lives behind one origin. A finished `up` leaves only Docker containers running.

```bash
just stack up                  # bring everything up, print URLs, return
just stack status --json      # machine-readable state (containers, health, URLs)
just stack update             # rebuild and reload only the changed services (the `r` hotkey)
just stack update --frontend  # also rebuild the frontend bundle
just stack down               # remove containers, volumes, and state
```

All the `run_local` flags apply to `stack` too. This includes `--instance`, `--no-doppler`, `--no-build`, and `--binaries-dir`. CI can pass a prebuilt bundle with `--frontend-dist`.

The app is served at `<proxy>/app/`. The bundle resolves its backend from the origin it is served on. The same stack works on localhost or behind a preview hostname without a rebuild.

### Init Snapshots

`stack up` caches the expensive infrastructure initialization. The first cold run:

- Migrates the database
- Waits for the FusionAuth kickstart
- Creates the search indices

It saves these volumes as an init snapshot. The snapshot is content-addressed and stored under `infra/local/generated/.snapshots`. Later runs restore the snapshot and skip the initialization. An input change causes a cache miss and a normal full init.

Useful commands:

```bash
just stack snapshot           # show the current snapshot key
just stack up --no-snapshot   # skip the snapshot cache
```

CI bakes the snapshot into the preview image. This is what makes Fly previews boot fast. See `infra/preview/README.md`.

## Common Commands

Run local binaries against shared dev resources instead of a full local stack:

```bash
just run_dev
```

`run_dev` uses shared dev resources. It needs Doppler and real cloud access. It is for contributors with team access.

See what a running or stopped instance looks like. The output shows endpoints with live reachability probes, plus the state and host ports of every container. It does not start or rebuild anything:

```bash
just status_local
```

Stop an instance but keep its volumes:

```bash
just stop_local --instance agent-a
```

Remove the containers, volumes, and named-instance networks of an instance:

```bash
just destroy_local --instance agent-a
```

Drop, recreate, and migrate an instance database:

```bash
just reset_local --instance agent-a
```

For the default instance, omit `--instance`.
