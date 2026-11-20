# Zimbra mail challenge

A standalone web CTF set in a local mailbox. Players register an account and investigate a failed delivery in the Dead Letter Office. The player description is in [PLAYER_BRIEF.md](docs/PLAYER_BRIEF.md).

## Run with Docker Compose

1. Copy `.env.example` to `.env`.
2. Set `INSPECTION_CODE` in `.env` to the event flag. You can also supply this environment variable through your deployment platform.
3. Run `docker compose up -d --build --wait`.
4. Open http://127.0.0.1:8000/login on the Docker host. For an event, point a reverse proxy on that host at this address and share the public HTTPS URL with players.

Run `docker compose logs --tail=50 web gateway` to check startup errors. Run `docker compose down` to stop. A named Docker volume retains accounts and messages.

## Tests

Use a Python 3.12 virtual environment. Install `requirements-dev.txt` and run `python -m pytest -q`. The tests supply their own dummy flag.
