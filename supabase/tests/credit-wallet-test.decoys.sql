/* Data that already exists in a real database and must not change any result.

   The wallet test is run on an empty schema here, which is the best possible
   conditions and also the most misleading one. Every check in it has to hold on
   a database that has been in production for a year: a client who has already
   been refunded, a credit note whose reason text happens to match, another
   client's wallet sitting next to ours.

   These are planted before the script runs. If any check still passes only
   because the table was empty, it shows up here as a failure. */
INSERT INTO companies (id, name)
VALUES ('99999999-9999-9999-9999-999999999999', 'Decoy Holdings');

INSERT INTO clients (id, company_id, name, email)
VALUES ('88888888-8888-8888-8888-888888888888',
        '99999999-9999-9999-9999-999999999999', 'Pre Existing', 'pre@decoy.local');

INSERT INTO invoices
  (id, company_id, client_id, invoice_number, invoice_type, status, currency_code,
   subtotal_excl, tax_total, total_incl, balance_due, issued_date, due_date)
VALUES ('77777777-7777-7777-7777-777777777777',
        '99999999-9999-9999-9999-999999999999',
        '88888888-8888-8888-8888-888888888888',
        'DEC-2026-000001', 'final', 'validated', 'ZAR',
        5000, 0, 5000, 5000, '2026-01-01', '2026-01-15');

-- A payout this company already made. An unscoped "count the wallet_out rows"
-- check counts this one and reports 2.
INSERT INTO invoice_receipts
  (company_id, invoice_id, receipt_number, invoice_number, currency_code,
   amount, direction, received_date)
VALUES ('99999999-9999-9999-9999-999999999999',
        '77777777-7777-7777-7777-777777777777', 'DEC-RCT-1', 'DEC-2026-000001', 'ZAR',
        5000, 'wallet_out', '2026-01-20');

-- A credit note whose reason is character-for-character the one the test raises.
-- A check that finds its note by reason text can land on this instead and report
-- 77777 as the credit total.
INSERT INTO credit_notes
  (id, company_id, invoice_id, invoice_number, credit_note_number, status,
   currency_code, subtotal_excl, tax_total, total_incl, reason, issued_date)
VALUES ('66666666-6666-6666-6666-666666666666',
        '99999999-9999-9999-9999-999999999999',
        '77777777-7777-7777-7777-777777777777', 'DEC-2026-000001', 'DEC-2026-000001',
        'issued', 'ZAR', 77777, 0, 77777, 'Tour withdrawn by the client', '2026-01-21');

-- Another client's wallet, with a balance nothing like zero. A wallet balance
-- check that is not scoped by client reads this as our own.
INSERT INTO client_credit_ledger
  (company_id, client_id, currency_code, amount, direction, reason, note)
VALUES ('99999999-9999-9999-9999-999999999999',
        '88888888-8888-8888-8888-888888888888', 'ZAR', 88888, 'credit', 'credit_note',
        'Someone else''s money');
