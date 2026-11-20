const roundMoney = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

export const buildServiceCostRows = ({
  days = [],
  paxCount = 1,
  categoryLabel = (value) => value,
  serviceFallback = 'Service',
  optionalCategoryPrefix = 'Optional — ',
  grandTotalLabel = 'Grand total',
  allServicesLabel = 'All services'
} = {}) => {
  const divisor = Math.max(1, Number(paxCount) || 1);
  const groupedRows = new Map();
  const groupedTotals = new Map();
  const total = { buy: 0, tax: 0, sell: 0 };

  (days || []).forEach((day) => {
    const services = [
      ...(day.services || []).map((service) => ({ service, optional: false })),
      ...(day.optionalServices || []).map((service) => ({ service, optional: true }))
    ];

    services.forEach(({ service, optional }) => {
      const sourceCategory = String(service.category || '').trim() || serviceFallback;
      const category = `${optional ? optionalCategoryPrefix : ''}${categoryLabel(sourceCategory)}`;
      const serviceName = String(service.name || serviceFallback).trim() || serviceFallback;
      const details = [
        service.roomType || service.room_type,
        service.mealPlan,
        service.supplierName
      ].map((value) => String(value || '').trim()).filter(Boolean);
      const buy = Number(service.buy) || 0;
      const tax = Number(service.tax) || 0;
      const sell = Number(service.sell) || 0;
      const rows = groupedRows.get(category) || [];
      const categoryTotal = groupedTotals.get(category) || { buy: 0, tax: 0, sell: 0 };

      rows.push({
        category,
        service: details.length ? `${serviceName} — ${details.join(' · ')}` : serviceName,
        day: day.day ? `Day ${day.day}` : '',
        date: day.date || '',
        buy: roundMoney(buy / divisor),
        tax: roundMoney(tax / divisor),
        markup: roundMoney((sell - buy) / divisor),
        sellWithoutMarkup: roundMoney(buy / divisor),
        sellWithMarkup: roundMoney(sell / divisor)
      });
      groupedRows.set(category, rows);
      categoryTotal.buy += buy;
      categoryTotal.tax += tax;
      categoryTotal.sell += sell;
      groupedTotals.set(category, categoryTotal);
      total.buy += buy;
      total.tax += tax;
      total.sell += sell;
    });
  });

  const rows = [];
  groupedRows.forEach((serviceRows, category) => {
    rows.push(...serviceRows);
    const categoryTotal = groupedTotals.get(category);
    rows.push({
      category,
      service: 'Category total',
      day: '',
      date: '',
      buy: roundMoney(categoryTotal.buy / divisor),
      tax: roundMoney(categoryTotal.tax / divisor),
      markup: roundMoney((categoryTotal.sell - categoryTotal.buy) / divisor),
      sellWithoutMarkup: roundMoney(categoryTotal.buy / divisor),
      sellWithMarkup: roundMoney(categoryTotal.sell / divisor),
      isSubtotal: true
    });
  });
  if (rows.length) {
    rows.push({
      category: grandTotalLabel,
      service: allServicesLabel,
      day: '',
      date: '',
      buy: roundMoney(total.buy / divisor),
      tax: roundMoney(total.tax / divisor),
      markup: roundMoney((total.sell - total.buy) / divisor),
      sellWithoutMarkup: roundMoney(total.buy / divisor),
      sellWithMarkup: roundMoney(total.sell / divisor)
    });
  }
  return rows;
};
