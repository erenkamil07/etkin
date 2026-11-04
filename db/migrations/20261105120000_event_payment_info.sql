-- migrate:up

-- Paid events. Etkin shows the price (ticket_types.price_cents), what it
-- covers and how to pay, but takes no money: the club collects it, at the door
-- or by bank transfer. A paid event can't be published without payment_info.
ALTER TABLE events
  ADD COLUMN price_includes text CHECK (length(price_includes) <= 500),
  ADD COLUMN payment_info   text CHECK (length(payment_info) <= 500);


-- migrate:down

ALTER TABLE events
  DROP COLUMN IF EXISTS payment_info,
  DROP COLUMN IF EXISTS price_includes;
