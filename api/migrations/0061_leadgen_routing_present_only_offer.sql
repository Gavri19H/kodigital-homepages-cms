-- "Present only this offer" — a quote routing rule action (partner QA links).
--
-- OWNER 2026-09-27 (Ido, #haikov-support): partners testing a funnel need a
-- link that shows THEIR offer and nothing else. A rule carrying
-- force_offer_id keeps the visitor in the funnel (unlike Redirect, which
-- sends them away) and, when it matches, the auction for that attempt runs
-- with the chosen offer as its only participant. The matched rule's choice is
-- stamped on the attempt's routing outcome, the same row that already carries
-- feed_name and value_multiplier, and /lg/auction reads it from there.
-- NULL (the default) = no effect; every existing rule behaves exactly as before.
ALTER TABLE leadgen_quote_routing_rules ADD COLUMN force_offer_id INTEGER REFERENCES leadgen_offers(id);
ALTER TABLE leadgen_routing_outcomes ADD COLUMN force_offer_id INTEGER;
