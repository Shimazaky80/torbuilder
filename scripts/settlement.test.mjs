import {
  invoiceBalance,
  invoiceBalanceAfterRefund,
  refundableOverpayment
} from '../src/lib/settlement.js';

const invoice = {
  id: 'INV-2026-00005',
  status: 'validated',
  subtotal_excl: 4552.08,
  tax_total: 682.81,
  total_incl: 5234.89,
  balance_due: 4434.89
};
const receipts = [{
  invoice_id: invoice.id,
  amount: 6889.5,
  direction: 'in'
}];

const tests = [
  ['unpaid balance uses tax-inclusive total', invoiceBalance(invoice), 5234.89],
  ['paid overage does not create an amount due', invoiceBalance(invoice, receipts), 0],
  ['refundable amount is only the excess payment', refundableOverpayment(invoice, receipts), 1654.61],
  ['refunding the overpayment leaves no amount due', invoiceBalanceAfterRefund(invoice, 1654.61, receipts), 0],
  ['refunding more than the overpayment reopens only the shortfall', invoiceBalanceAfterRefund(invoice, 2000, receipts), 345.39],
  ['a recorded refund cannot be refunded again', refundableOverpayment(invoice, [
    ...receipts,
    { invoice_id: invoice.id, amount: 1654.61, direction: 'out' }
  ]), 0],
  ['wallet credit settles the invoice but refund remains cash-capped', refundableOverpayment(invoice, [
    { invoice_id: invoice.id, amount: 5234.89, direction: 'in' },
    { invoice_id: invoice.id, amount: 1000, direction: 'apply' }
  ]), 1000]
];

let failures = 0;
for (const [label, actual, expected] of tests) {
  const passed = actual === expected;
  if (!passed) failures += 1;
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}: got ${actual}, expected ${expected}`);
}

if (failures) process.exitCode = 1;
