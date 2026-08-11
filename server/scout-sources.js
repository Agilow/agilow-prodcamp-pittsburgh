/* ============================================================
   Scout sources: fetch candidate posts, then triage them cheaply.

   Reddit only. No API key, no OAuth, no third-party service.

   NOTE ON THE ENDPOINT — this uses Reddit's public RSS, not the .json
   endpoints. As of Aug 2026 every .json path (www, old, api, and
   oauth hosts) answers an unauthenticated request with 403 and an HTML
   block page. The .rss paths still serve, carry every field we need
   (author, title, selftext, permalink, timestamp, subreddit), and need
   no credentials. Same data, different envelope.

   Reddit rate-limits unauthenticated clients hard and answers 429 in
   bursts, so requests are serialized with a delay and retried with
   backoff. A scout on a 5-hour cron has no reason to be in a hurry.

   This file imports only from scout-config.js. Deleting both files plus
   the /api/scout route removes the scout entirely.
   ============================================================ */

import {
  SUBREDDITS,
  SEARCH_TERMS,
  CAPS,
  USER_AGENT,
  PREFILTER_MODEL,
} from "./scout-config.js";

// Between requests. A 5-hour cron has no reason to rush, and QA saw feeds
// 429 at 1.5s even with retries. ~20 requests at 3s is a minute of the
// 8-minute budget, which is cheap next to losing a quarter of the feeds.
const REDDIT_DELAY_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* GET one feed, with Reddit's rate limiter in mind.

   Breadth beats depth here. There are twenty feeds and we only need fifteen
   candidates, so a 429 gets one short retry and then we move on. Fighting a
   rate limiter for 90 seconds while nineteen other feeds go unread was
   measured at 4/20 feeds in a run; failing fast reads far more of them. */
async function fetchRss(url) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/atom+xml" },
        signal: AbortSignal.timeout(20000),
      });
      if (res.status === 429) {
        // Rate limited. One brief pause, then abandon this feed.
        if (attempt === 1) {
          await sleep(5000);
          throw new Error("HTTP 429 (retrying once)");
        }
        throw new Error("HTTP 429 (skipping feed)");
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trim()) throw new Error("empty body");
      return text;
    } catch (err) {
      lastErr = err;
      if (/429 \(skipping/.test(err.message)) break;
      if (attempt === 3) break;
      if (!/429/.test(err.message)) await sleep(attempt * 3000); // network/5xx
    }
  }
  console.warn(`[scout] skipped ${url.replace("https://www.reddit.com", "")}: ${lastErr?.message}`);
  return "";
}

/* Atom is regular enough here that a parser dependency is not worth it. */
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? m[1] : "";
};

/* Reddit double-escapes selftext: the content element holds escaped HTML,
   which itself contains escaped entities. Two passes, then strip tags. */
function decodeEntities(s) {
  return String(s || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function htmlToText(html) {
  return decodeEntities(decodeEntities(html))
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* One Atom entry -> the candidate shape the rest of the scout speaks. */
function parseEntry(entry) {
  const author = decodeEntities(tag(entry, "name")).replace(/^\/?u\//, "").trim();
  const title = decodeEntities(tag(entry, "title")).trim();
  const permalink = (entry.match(/<link[^>]+href="([^"]+)"/) || [])[1] || "";
  const subreddit = (entry.match(/<category[^>]*term="([^"]*)"/) || [])[1] || "";
  const updated = tag(entry, "updated");
  const id = tag(entry, "id");
  const selftext = htmlToText(tag(entry, "content")).slice(0, 2000);

  return {
    id,
    subreddit,
    author,
    title,
    selftext,
    permalink,
    createdUtc: updated ? Math.floor(new Date(updated).getTime() / 1000) : 0,
    flair: "",
  };
}

function parseFeed(xml) {
  return (xml.match(/<entry>[\s\S]*?<\/entry>/g) || []).map((e) => parseEntry(e));
}

/* Fetch new + search feeds across the configured subreddits.
   `since` is a unix seconds cutoff; posts older than it are dropped. */
export async function fetchRedditCandidates({
  subreddits = SUBREDDITS,
  terms = SEARCH_TERMS,
  since = Math.floor(Date.now() / 1000) - CAPS.sinceDays * 86400,
  // Wall-clock stop for the fetch phase. Rate-limit backoff can otherwise eat
  // the whole run budget and leave nothing for the scoring the run exists to
  // do. Fewer feeds is a smaller sweep; no scoring is a wasted one.
  deadline = Infinity,
} = {}) {
  const urls = [];
  for (const sub of subreddits) {
    urls.push(`https://www.reddit.com/r/${sub}/new.rss?limit=50`);
    for (const term of terms) {
      urls.push(
        `https://www.reddit.com/r/${sub}/search.rss?q=${encodeURIComponent(term)}` +
          `&restrict_sr=1&sort=new&t=week`
      );
    }
  }

  const seen = new Set();
  const out = [];
  let fetched = 0;

  // Serial on purpose. Parallel requests are what trips Reddit's limiter.
  let ranOut = false;
  for (const url of urls) {
    if (Date.now() > deadline) {
      ranOut = true;
      break;
    }
    const xml = await fetchRss(url);
    await sleep(REDDIT_DELAY_MS);
    if (!xml) continue;
    fetched++;
    for (const post of parseFeed(xml)) {
      if (!post.author || !post.id) continue;
      if (seen.has(post.id)) continue;
      // The search feed's own title element parses as an entry-less header on
      // some responses; a post without a permalink is not a post.
      if (!post.permalink.includes("/comments/")) continue;
      if (post.createdUtc && post.createdUtc < since) continue;
      if (/^(AutoModerator|\[deleted\])$/i.test(post.author)) continue;
      seen.add(post.id);
      out.push(post);
    }
  }

  console.log(
    `[scout] reddit: ${out.length} posts from ${fetched}/${urls.length} feeds` +
      (ranOut ? " (fetch deadline reached, stopped early)" : "")
  );
  return out;
}

/* ============================================================
   Relevance pre-filter.

   One batched call over titles and snippets before any expensive
   per-lead scoring. The scoring engine costs several web searches per
   lead; this costs one small-model call for twenty candidates.
   ============================================================ */
export async function prefilterCandidates(candidates, openai, batchSize = 20) {
  if (candidates.length === 0) return [];
  const keep = [];

  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    const listing = batch
      .map(
        (c, n) =>
          `[${n}] r/${c.subreddit} u/${c.author}\nTITLE: ${c.title}\nBODY: ${c.selftext.slice(0, 400)}`
      )
      .join("\n\n");

    try {
      const resp = await openai.responses.create({
        model: PREFILTER_MODEL,
        temperature: 0,
        input: [
          {
            role: "system",
            content:
              "You triage a list of Reddit posts for a sales scout. We sell standup automation to the PERSON who runs a software team's recurring standup: scrum masters, project and program managers, product owners, engineering managers, team leads, hands-on founders. " +
              "Return the indexes of posts where the AUTHOR plausibly runs or owns team ceremonies, OR expresses standup / status-meeting / status-reporting pain of their own. " +
              "KEEP: 'my team of 8', 'as a scrum master', 'our standup runs long', 'I run the daily', 'how do I get people to show up on time', someone describing their own team's process problem. " +
              "DROP: certification and exam questions, job hunting and resume posts, 'how do I become a scrum master', tool advertising, memes, generic industry news, someone asking about a process they do not participate in, and anything where the author is clearly a student or between jobs. " +
              "Be strict. A post only counts if the author themselves is plausibly the buyer. When unsure, drop it.",
          },
          { role: "user", content: `${listing}\n\nReturn the indexes to keep.` },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "prefilter",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                keep: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      index: { type: "integer" },
                      why: { type: "string" },
                    },
                    required: ["index", "why"],
                  },
                },
              },
              required: ["keep"],
            },
          },
        },
      });

      const parsed = JSON.parse((resp.output_text || "{}").trim());
      for (const hit of parsed.keep || []) {
        const c = batch[hit.index];
        if (c) keep.push({ ...c, prefilterReason: hit.why || "" });
      }
    } catch (err) {
      // A failed triage batch must not take the run down. Losing a batch
      // costs us candidates, not correctness.
      console.warn(`[scout] prefilter batch failed (skipping): ${err?.message || err}`);
    }
  }

  console.log(`[scout] prefilter: kept ${keep.length}/${candidates.length}`);
  return keep;
}
