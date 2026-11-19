# How to: "Redirect to offer" after the offer is shown

A "Redirect to offer" funnel eligibility rule can now wait until the visitor has seen the offer. The auction runs as usual. The results page then shows only the chosen Offer's card, inside a "match" banner with a countdown. When the countdown ends, the page opens that card's own link. That is one normal click, with the Offer's usual Meta click event. The visitor can press "Stay here" at any time to see all the offers instead.

The rule works for any Offer. Nothing in the code is set up for one partner: everything comes from the rule.

## Set up a rule

1. Go to LeadGen → Auction → (the Auction the funnel uses) → Rules → "Funnel eligibility rules".
2. Pick the Quote, the Funnel and the Variant the rule is for. A rule belongs to one Variant.
3. Click "+ New rule".
4. Fill in the window:
   - "Rule name": a name you will recognise later, for example "Business loans: open the chosen offer".
   - "Rule type": "Redirect to offer".
   - "When to redirect": "After the offer is shown". ("Straight away, before the auction" is the old redirect. It still works exactly as before.)
   - "Show the offer for (seconds)": a whole number from 2 to 30. Start at 5.
   - "What the visitor sees": "The redirect banner" (the usual choice) or "Only the animation" (see below).
   - "Redirect to offer": the Offer to open. Every Offer in the list can be picked.
   - "Redirect %": the share of matching visitors who get the countdown. The others see today's results page. See the tip below.
   - "Priority (1 = highest)", "Match" and "Conditions": who the rule is for, the same way as every other rule. Rules are tried from priority 1 down. If a rule's Offer has no card for the visitor, the next matching rule is tried. The first rule whose Offer has a card decides.
   - "Status": "Active".
5. Click "Save rule". The rules list shows the rule as "Redirect {%} → {Offer} · after {n} s".

Saving refuses, with a message, when the seconds are outside 2–30, when no Offer is picked, or when a raw redirect URL is set ("Advanced — raw redirect URL" is hidden for this timing, because a raw URL has no card to show).

What the rule never changes:
- The auction itself: the same Offers, Provider calls, bids, card order, caps and "remove clicked".
- If a rule's Offer has no card for a visitor (the Provider said no, it is capped), the next matching "After the offer is shown" rule is tried. If no matching rule's Offer has a card, the visitor sees today's results page, with no countdown.
- If the visitor already clicked that rule's Offer in this visit (for example, they were redirected and came back), lower rules are not tried: they see today's results page, so they are not sent on to the next rule's partner.
- A visitor held back by a rule's "Redirect %" (its Offer has a card) sees today's page too, and lower rules are not tried. That keeps the "held back" half a clean comparison.
- A "Straight away" rule placed below a matching "After the offer is shown" rule is not used: it can only act before the auction. Put "Straight away" rules above "After the offer is shown" rules if they should win.
- After "Stay here", the Auction's "Remove-clicked & normalization" settings decide whether the chosen card stays.
- Each visitor gives at most one counted click, whether they wait, click first, or press "Stay here" and click later.

The look of the banner and of the animation is set once per funnel layout template: LeadGen → Quotes → (a Quote) → Templates → "Funnel-layout elements" → "L · Redirect". With nothing set, it follows the funnel's Theme.

## Edit a rule

1. Go to the same place: LeadGen → Auction → (the Auction) → Rules → "Funnel eligibility rules", and pick the Quote, Funnel and Variant.
2. Click "Edit" on the rule's row. The window opens with every saved value filled in.
3. Change what you need: the Offer, "When to redirect", the seconds, what the visitor sees, "Redirect %", the conditions, the priority, or "Status".
4. Click "Save rule". The change applies to the next visitor.

To stop a rule, set "Status" to "Disabled" (or turn it off on its row). To go back to the old redirect, set "When to redirect" to "Straight away, before the auction".

## Tip: start at 50%, compare after 2 weeks

Set "Redirect %" to 50 for a new rule. Each matching visitor is put in one half and stays there:
- "opened": the visitor gets the countdown;
- "held back": the visitor sees today's results page.

After 2 weeks, run the read-out at the end of this page and compare the two halves for that rule:
- the click rate on the chosen card (step 1), among visitors whose chosen Offer had a card. The goal is 90% or more in the "opened" half, against the "held back" half;
- the money per visitor (step 2). The "opened" half must not be lower than the "held back" half.

If both hold, raise "Redirect %" (up to 100). If not, lower it or set the rule to "Disabled". This is a tip, not a setting: every value stays the operator's choice.

## "Only the animation"

With "What the visitor sees" set to "Only the animation", the results area shows just the animation, a short line ("Taking you to {brand}…") and a "Show me all offers" link. There is no banner and no offer card. When the countdown ends, the same card link opens, with the same one counted click and Meta event.

Use it only with partners who have agreed to it. The visitor never sees the card before being sent on, so:
- no card view is counted before the click, and a partner that pays per click is more likely to question these clicks;
- in the Offers stats, that Offer's "Clicks" and "CTR" will look higher than its card views explain. "Visitor CTR" stays accurate, and "Redirect clicks" shows how many clicks came from this.

No funnel needs it today. It is ready for when a partner agrees.

## Where the numbers show

- LeadGen → Offers: the "Redirect clicks" column, right after "Clicks".
- LeadGen → Offers → (an Offer) → Analytics: "Visitor clicks", "Redirect clicks" and "Visitor CTR", right after "Clicks".

"Clicks", "CTR", revenue, caps and "remove clicked" still count every click, redirect clicks included. Visitor clicks = Clicks − Redirect clicks. Visitor CTR = Visitor clicks ÷ Impressions.

How a redirect click is told apart: just before the page clicks the card, it sets a 30-second cookie on our own site (`lg_rc`), holding only that card's render id and slot. The click route sees it, counts the click as a redirect click and deletes the cookie. The card's link is unchanged, so the visitor and the partner see nothing different. A browser that blocks all cookies counts its redirect clicks as visitor clicks: a small undercount, never a wrong total.

## Read any rule's result (read-only)

Two steps. Step 1 gives the click rate for every rule. Step 2 gives the money per visitor for one rule, for every kind of Offer (paid per click or per lead). Both only read; they change nothing.

### Step 1: click rate, every rule (CMS database)

Run this on the CMS database: Cloudflare → D1 → the CMS database (`kodigital-homepages-cms-db`) → Console. It only reads; it changes nothing. It covers every "After the offer is shown" rule over the last 14 days. Change `-14 days` to look at a different period.

<!-- f11-readout-query:start -->
```sql
-- Read-only: every "After the offer is shown" rule, split into its halves.
WITH firsts AS (
  SELECT r.funnel_attempt_id,
         r.carriers_shown_json,
         json_extract(r.redirect_json, '$.rule_id')  AS rule_id,
         json_extract(r.redirect_json, '$.offer_id') AS offer_id,
         json_extract(r.redirect_json, '$.outcome')  AS outcome,
         ROW_NUMBER() OVER (PARTITION BY r.funnel_attempt_id ORDER BY r.created_at, r.auction_instance_id) AS nth
  FROM leadgen_auction_result_log AS r
  WHERE r.redirect_json IS NOT NULL
    AND r.created_at >= unixepoch('now', '-14 days')
),
visitors AS (
  SELECT f.rule_id, f.offer_id, f.outcome,
         EXISTS (SELECT 1 FROM json_each(f.carriers_shown_json) AS c
                 WHERE json_extract(c.value, '$.offer_id') = f.offer_id) AS had_card,
         EXISTS (SELECT 1 FROM leadgen_session_clicked_offers AS k
                 JOIN leadgen_offers AS o ON o.id = k.offer_id
                 WHERE k.funnel_attempt_id = f.funnel_attempt_id
                   AND o.public_id = f.offer_id) AS clicked_card,
         (SELECT COALESCE(SUM(b.bid), 0) FROM (
            SELECT MAX(json_extract(c.value, '$.bid')) AS bid
            FROM leadgen_session_clicked_offers AS k
            JOIN leadgen_offers AS o ON o.id = k.offer_id AND o.offer_type = 'cpc'
            JOIN json_each(f.carriers_shown_json) AS c
              ON json_extract(c.value, '$.offer_id') = o.public_id
             AND (k.carrier_key = '' OR json_extract(c.value, '$.carrier_key') = k.carrier_key)
            WHERE k.funnel_attempt_id = f.funnel_attempt_id
            GROUP BY k.offer_id, k.carrier_key) AS b) AS click_money
  FROM firsts AS f
  WHERE f.nth = 1
)
SELECT COALESCE(fr.rule_name, v.rule_id) AS rule,
       COALESCE(o.offer_name, v.offer_id) AS offer,
       CASE v.outcome WHEN 'opened' THEN 'opened' WHEN 'held_back' THEN 'held back' ELSE 'no card' END AS half,
       COUNT(*) AS visitors,
       SUM(v.had_card) AS visitors_with_card,
       SUM(v.had_card AND v.clicked_card) AS clicked_the_card,
       ROUND(100.0 * SUM(v.had_card AND v.clicked_card) / NULLIF(SUM(v.had_card), 0), 1) AS card_click_rate_pct,
       ROUND(SUM(CASE WHEN v.had_card THEN v.click_money ELSE 0 END) / NULLIF(SUM(v.had_card), 0), 2) AS click_money_per_visitor_usd
FROM visitors AS v
LEFT JOIN leadgen_funnel_rules AS fr ON fr.public_id = v.rule_id
LEFT JOIN leadgen_offers AS o ON o.public_id = v.offer_id
GROUP BY v.rule_id, v.offer_id, v.outcome
ORDER BY rule, offer, half;
```
<!-- f11-readout-query:end -->

How to read it (one row per rule and half):
- `rule` and `offer`: the rule's "Rule name" and the Offer it opens.
- `half`: "opened" (inside "Redirect %": got the countdown), "held back" (outside "Redirect %": saw today's page), or "no card" (no matching rule's Offer had a card for them, so they saw today's page whichever half they were in). A visitor whose rule had no card but whose next rule opened is counted under that next rule. The results log lists the rules passed over (`passed_over` in `redirect_json`).
- `visitors`: visitors in that row. Each visitor counts once, on their first results page under the rule.
- `visitors_with_card`: of those, the ones whose chosen Offer had a card (every "opened" and "held back" visitor). Compare "opened" with "held back".
- `clicked_the_card` and `card_click_rate_pct`: how many of them clicked the chosen Offer, and the rate.
- `click_money_per_visitor_usd`: the money booked at the click (the card's bid, for Offers paid per click), per visitor with a card, counting every card they clicked, not only the chosen one.

Keep in mind: a card clicked several times by one visitor counts once here, and `click_money_per_visitor_usd` holds only money booked at the click. Money a partner reports later for a lead is not in the CMS database by visitor; step 2 adds it.

### Step 2: money per visitor, one rule (CMS database, then ClickHouse)

The halves are only known in the CMS database, and the money a partner reports for a lead is only linked to its visitor in ClickHouse. The link between the two is the visitor's funnel attempt id: the CMS database keeps it on each results page (`leadgen_auction_result_log.funnel_attempt_id`), and every click in ClickHouse carries it (`lg_events_raw.funnel_attempt_id`). A lead payment (`revenue_received` in `lg_events_raw`) names the click it belongs to (`click_id`).

**2a. List the rule's visitors (CMS database).** Put the rule's "Rule name" (or its id from step 1) where it says `PUT THE RULE NAME HERE`, and run it in the same D1 Console. It returns one long line: copy it.

<!-- f11-step2a-query:start -->
```sql
-- Read-only: one rule's "opened" and "held back" visitors, ready to paste into step 2b.
WITH firsts AS (
  SELECT r.funnel_attempt_id AS funnel_attempt_id,
         json_extract(r.redirect_json, '$.rule_id') AS rule_id,
         json_extract(r.redirect_json, '$.outcome') AS outcome,
         ROW_NUMBER() OVER (PARTITION BY r.funnel_attempt_id ORDER BY r.created_at, r.auction_instance_id) AS nth
  FROM leadgen_auction_result_log AS r
  WHERE r.redirect_json IS NOT NULL
    AND r.funnel_attempt_id IS NOT NULL AND r.funnel_attempt_id <> ''
    AND r.created_at >= unixepoch('now', '-14 days')
)
SELECT group_concat(
         '(''' || replace(f.funnel_attempt_id, '''', '') || ''', ''' ||
         CASE f.outcome WHEN 'opened' THEN 'opened' ELSE 'held back' END || ''')', ', ') AS paste_into_step_2b
FROM firsts AS f
LEFT JOIN leadgen_funnel_rules AS fr ON fr.public_id = f.rule_id
WHERE f.nth = 1
  AND f.outcome IN ('opened', 'held_back')
  AND (fr.rule_name = 'PUT THE RULE NAME HERE' OR f.rule_id = 'PUT THE RULE NAME HERE');
```
<!-- f11-step2a-query:end -->

**2b. Add up the money per half (ClickHouse).** Run this read-only in the ClickHouse console, with the line from 2a pasted where it says `PASTE_STEP_2A_LIST_HERE` (until you do, it stops with an error on purpose). Use the same dates as step 1, and run it a few days after the period ends, so late lead payments are in.

<!-- f11-step2b-query:start -->
```sql
-- Read-only: money per visitor for each half of one rule.
WITH
  rule_visitors AS (
    SELECT v.funnel_attempt_id AS funnel_attempt_id, v.half AS half
    FROM VALUES('funnel_attempt_id String, half String', PASTE_STEP_2A_LIST_HERE) AS v
  ),
  visitor_clicks AS (
    SELECT e.click_id AS click_id, e.funnel_attempt_id AS funnel_attempt_id, e.revenue AS click_money, e.bid_currency AS currency
    FROM lg_events_raw AS e FINAL
    WHERE e.event_type IN ('offer_click', 'carrier_click')
      AND e.traffic_quality_flag = 'clean'
      AND e.funnel_attempt_id IN (SELECT funnel_attempt_id FROM rule_visitors)
  ),
  money_rows AS (
    SELECT c.funnel_attempt_id AS funnel_attempt_id, c.click_money AS amount, c.currency AS currency
    FROM visitor_clicks AS c
    WHERE c.click_money != 0
    UNION ALL
    SELECT c.funnel_attempt_id AS funnel_attempt_id, r.revenue AS amount, r.bid_currency AS currency
    FROM lg_events_raw AS r FINAL INNER JOIN visitor_clicks AS c ON r.click_id = c.click_id
    WHERE r.event_type = 'revenue_received'
  ),
  per_visitor AS (
    SELECT m.funnel_attempt_id AS funnel_attempt_id, sum(m.amount) AS visitor_money, groupUniqArray(m.currency) AS visitor_currencies
    FROM money_rows AS m
    GROUP BY m.funnel_attempt_id
  )
SELECT v.half AS half,
       count() AS visitors,
       round(sum(p.visitor_money), 2) AS money,
       round(sum(p.visitor_money) / count(), 2) AS money_per_visitor,
       arrayDistinct(arrayFlatten(groupArray(p.visitor_currencies))) AS currencies
FROM rule_visitors AS v
LEFT JOIN per_visitor AS p ON p.funnel_attempt_id = v.funnel_attempt_id
GROUP BY v.half
ORDER BY v.half;
```
<!-- f11-step2b-query:end -->

How to read it (one row per half):
- `visitors`: the visitors of that half from 2a (the same count as `visitors_with_card` in step 1).
- `money`: everything booked for them: money booked at the click (Offers paid per click) plus every lead payment a partner reported for one of their clicks (Offers paid per lead), for any card they clicked, not only the chosen one.
- `money_per_visitor`: `money` ÷ `visitors`. Compare "opened" with "held back".
- `currencies`: the currencies the money came in. If it shows more than one, the totals mix currencies: read them per partner report before deciding.

Only clicks from real visitors count (the same "clean" traffic the Offer stats use).
