# Can I Park Here?

A single-question website. You land on the page, allow location, and get:

```
🟢 YES — legal until 3:30 PM
```
or
```
🔴 NO — parking becomes legal at 6:30 PM
```

Built on the City of Montréal's open data for street parking signage
("Signalisation – Stationnement"), which is republished daily.

Everything here runs on one free platform, Vercel: the page and the API
are one deploy, no server to manage, no bill.

## How it fits together

```
index.html, style.css, app.js   The page: asks for location, calls /api/check
api/check.js                     Serverless function: "is parking legal here, now?"
api/lib/                         Shared logic: nearest-sign lookup, day/time rules
data/fetch.py, parse_rtp.py      Python: turns the city's raw CSV into
                                  data/processed/signs.json, which the API reads
.github/workflows/                Scheduled job that re-runs that pipeline daily,
                                  since the city updates its data daily
```

## Deploying it — no coding required

You'll do three things: get the code onto GitHub, generate the data once,
and connect GitHub to Vercel. None of it involves writing code.

### 1. Put this folder on GitHub

1. Go to [github.com/new](https://github.com/new), name it (e.g.
   `canipark-here`), leave it public, click **Create repository**.
2. On the next page, click **uploading an existing file**.
3. Drag every file and folder from this project into the browser window,
   and commit. (GitHub's uploader accepts whole folders dragged from
   Finder/Explorer.)

### 2. Generate the real parking data

The page needs `data/processed/signs.json` to actually answer anything.
This repo includes an automated job that builds it from the city's data —
you just need to run it once:

1. In your new GitHub repo, click the **Actions** tab.
2. Click **Update parking data** in the left list.
3. Click **Run workflow** → **Run workflow**.
4. Wait a minute or two, refresh — you should see a new commit adding
   `data/processed/signs.json`.

From here on it re-runs automatically every day, so the data stays current
without you doing anything.

### 3. Deploy to Vercel

1. Go to [vercel.com](https://vercel.com), sign up with your GitHub
   account (this also connects them automatically).
2. Click **Add New → Project**, pick your `canipark-here` repo, click
   **Deploy**. No settings to change — `vercel.json` already tells it
   what to do.
3. In a minute or two you'll get a URL like
   `https://canipark-here-yourname.vercel.app`. That's the live site.

That's it — one URL, page and API together, free on both GitHub and
Vercel's free tiers for a project this size.

### Keeping it updated

Whenever the daily GitHub Action commits fresh data, Vercel notices the
push and redeploys automatically. Nothing to maintain.

### Optional: a real domain

`canipark.here` isn't a real domain ending (`.here` doesn't exist), so
you'd want something like `caniparkhere.com`. Buy it from any registrar,
then add it in the Vercel project's **Domains** tab and follow its DNS
instructions.

## Current limitations (read before trusting it with a $350 ticket)

- The RTP/RPA text parser (`data/parse_rtp.py`) covers the common French
  phrasing patterns (day ranges, time ranges, "sauf" exceptions, permit
  zones). Anything it doesn't recognize is marked `"confidence": "low"`
  and the site will say **not sure** rather than a false YES.
- No snow-removal ("déneigement") overlay yet — that's a separate city
  dataset ("Info-Neige") and matters a lot in winter.
- No paid-parking (SUM meters) data yet — also a separate dataset.
- Geolocation accuracy on phones can put you on the wrong side of the
  street. The city itself also warns some boroughs' data is incomplete,
  and none exists yet for Île-Bizard–Sainte-Geneviève.

## Roadmap ideas (from the original pitch)

- Photo fallback for when GPS is ambiguous or a sign isn't in the dataset
- Other cities as they publish comparable open data
- "Remind me before it changes" push notification

## If you ever want to poke at the code

Everything in `api/lib/` and `data/parse_rtp.py` has comments explaining
the logic. The data pipeline can also be run locally if you have Python:

```bash
cd data
pip install -r requirements.txt
python fetch.py
python parse_rtp.py --sample 20   # peek at raw rows to sanity-check parsing
python parse_rtp.py               # writes data/processed/signs.json
```
