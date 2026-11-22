# How to: Send-only Offers

Some Providers only want the lead. They take it into their own system (often a Zapier, Make or CRM webhook), and their team contacts the visitor. Nothing comes back for the visitor to click.

A send-only Offer handles that:
- The lead is posted to the Provider, the same way as for any "Provider request · static bid (CPL)" Offer.
- The Offer never shows a clickable card.
- The Provider's reply decides whether the lead was **accepted**.
- If no other card shows, the visitor sees this Offer's banner (its logo, headline and subheadline) instead of "We couldn't find a match for you right now." The banner can't be clicked. It has no button, no link and no hover effect.
- Money follows the Offer's type. Type **CPL** books the Offer's fixed bid once, when the lead is accepted. Type **CPA** books nothing and waits for the Provider's report, as today.

Nothing in the code is set up for one Provider. Everything comes from the Offer's settings.

## The two settings

Both are in LeadGen → Offers → (the Offer) → Request → "Lead delivery". They show only when "Mode" is "Provider request · static bid (CPL)".

**"What the visitor sees"**
- "Show a card" (the default). The Offer works exactly as before. Every Offer that existed before this feature has this setting.
- "Send the lead only, no card". The Offer is send-only.

**"Accepted when"** shows only when "Send the lead only, no card" is picked.
- "Any OK reply" (the default). Any success reply (HTTP 2xx) within the Auction's time limit counts as accepted, even a plain "OK" with no data. Use it for Providers that always answer "success", like Zapier hooks.
- "A field in the reply equals a value". Type the reply field (for example `status`, or `result.status` for a nested field) and the value that means accepted (for example `accepted`). The check ignores upper and lower case and spaces around the value. `true`, `false` and numbers are compared as text. Use it for Providers that answer OK but say yes or no inside the reply.

The lead is never accepted when:
- the Provider doesn't answer within the Auction's "Provider timeout (ms)";
- the Provider answers with an error (anything other than 2xx);
- the field check fails (the field is missing, or has another value).

Switching back to "Show a card" hides "Accepted when", and the Offer is no longer send-only.

## What the visitor sees

| Situation | Results page |
|---|---|
| Another Offer has a card | The cards, as today. No banner. |
| No card, and one send-only Offer accepted | That Offer's banner. |
| No card, and several send-only Offers accepted | One banner: the Offer with the highest fixed bid. |
| No card, and no send-only Offer accepted | "We couldn't find a match for you right now", as today. |

The banner uses the Offer's "Banner creative" fields: logo, headline, subheadline. A send-only Offer can't be saved without a logo and a headline.

## Money and reports

- **Type CPL:** each accepted lead books the Offer's fixed bid once per funnel attempt. A retry of the same attempt never books again. The lead is booked even when another Offer's card shows instead of the banner, because the Provider took the lead. If two send-only CPL Offers accept the same lead, both book, even though only one banner shows. The price is always the Offer's own fixed bid; an Auction's bid override is not used for send-only Offers. If the Offer has a conversions cap, each booked lead counts toward it.
- **Type CPA:** nothing is booked when the lead is sent. Money comes from the Provider's report, as for every CPA Offer.
- **Team and preview visits** (the `ko_internal` cookie, preview links): send-only Offers are not posted at all, so a Provider's team never calls a test lead. Nothing is booked.
- **Each accepted lead** sends one "lead sent" event to the event data (Athena), with the amount booked (0 for CPA) and the Facebook ad set and ad. The dashboard counts it once its own revenue query includes "lead sent" (a separate dashboard change, needed before any send-only Offer goes live).
- **The auction** counts as filled, with the reason "lead sent".
- **The Auction Simulator** never posts a send-only Offer, because it makes real calls and every run would create a fake lead. It shows them as "Send-only: not sent from the Simulator. Use the Offer's Test button." To check a Provider's reply, use the Offer's Test tab.
- **Provider diagnostics:** a Provider that answers a plain "OK" (not JSON) is accepted under "Any OK reply", but its calls still show as "malformed response" errors in the diagnostics, as for any Offer. That is expected.
- **Offer Analytics** does not count send-only leads yet. Count them from the event data.

## Redirect rules

A "Redirect to offer" rule can't point at a send-only Offer, for either timing. A send-only Offer never has a card, so there is nothing to open. Send-only Offers are left out of the rule's Offer list, and saving a rule that names one is refused.

## Add a new send-only Provider: checklist

1. **Ask the Provider the questions below,** and get the answers in writing.
2. **Create the Offer:** LeadGen → Offers → "+ New Offer".
   - "Mode": "Provider request · static bid (CPL)".
   - "Offer type": CPL if they pay per lead, CPA if they pay per funded deal.
   - The fixed bid and its currency: the price per lead (for CPA, the expected value used for ranking only).
   - "Status": paused, until the test below passes.
3. **Banner creative:** upload the Provider's logo, and write the headline and subheadline the visitor sees, for example "You're all set" / "A specialist from (Provider) will contact you shortly." Get the Provider's OK on the wording.
4. **Payload tab:** map the fields the Provider asked for, in their exact names. Send one flat JSON object per lead, not a list (some tools run once per list item). Standard starting set:
   - our lead id: the macro `{session_id}`, so the Provider can spot repeats and report by our id;
   - phone as 10 digits, and dates as YYYY-MM-DD;
   - consent: the disclosure text the funnel shows (as a fixed value), the visitor's IP (`{ip}`), the page link (`{url}`) and the time (computed value `iso_timestamp`). Before going live, confirm the funnel's disclosure covers this Provider.
5. **Request tab:**
   - "Endpoint (production)": the Provider's URL. Paste it here only, never in chat, email threads or code.
   - "API token": paste a shared key and pick where it goes ("Token placement": header, payload or query, as the Provider asked). Make one key per Provider and give it to them, so they can refuse leads that don't carry it.
   - "What the visitor sees": "Send the lead only, no card".
   - "Accepted when": from the Provider's answer about their accept and reject replies.
6. **Test tab:** run "Test" with a sample lead. The Test posts for real, so tell the Provider first. Check that:
   - the result says "Accepted";
   - the reply time is well under the Auction's time limit (LeadGen → Auction → (the Auction) → Settings → "Provider timeout (ms)"). The Test waits up to 10 seconds, but a live auction waits only as long as that setting. If the Provider is slower, raise the Auction's timeout or ask the Provider to answer faster.
   - the Provider confirms the lead arrived, with every field mapped.
7. **Add the Offer to the Auction.** Put it in the same tier as the others if the Provider accepts leads that also go to other Providers. Put it in a later tier if they want only leads nobody else got.
8. **Turn it on** (status active), with the owner's OK.
9. **Live check after about 50 leads:** accepted leads = "lead sent" events (= bookings, for CPL); no doubles; no team leads; no "no match" page when only this Offer accepted. After one week: our count and the Provider's differ by 2% or less.

## Questions to ask every send-only Provider

1. Your URL. Does it accept JSON? Tell us before you change it.
2. Which fields do you need, with exact names? Which are required, and in what formats?
3. What does your reply look like when you accept a lead, and when you reject one? (This sets "Accepted when".)
4. How do you pay: per lead, or per funded deal? At what price? (This sets the Offer type: CPL or CPA.)
5. Your minimums and exclusions (for example, for business loans: time in business, monthly revenue, credit, loan amount, states, industries), so we only send leads you'll pay for.
6. Do you accept leads that also go to other Providers, or only exclusive ones?
7. How do you handle a lead you already have? We send our own lead id on every lead.
8. What consent proof do you need: disclosure text, IP and time, or a TrustedForm or Jornaya certificate?
9. Can you check a shared key we send on every lead?
10. Will you send a weekly or monthly list of the leads you received, by our lead id?
11. Send us your logo, and approve the banner text the visitor sees after the lead is sent.

## Where things live

- **Provider URLs:** on each Offer, in the admin (behind Cloudflare Access). Never in code, chat or git.
- **Shared keys:** in each Offer's API token, encrypted when saved; nobody can read them back.
- **The setting:** the Offer's `send_only_json` field (empty = "Show a card").
- **Code:** `api/src/leadgen/send-only.ts` (the setting and the "Accepted when" rule).
