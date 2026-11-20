export const COST_REPORT_OMITTED_SECTIONS = ['itinerary', 'inclusions', 'exclusions'];

export const isInternalCostBreakdown = (options = {}) =>
  Boolean(options.pricing && options.perPersonView === 'categorySummary');

export const exportSectionsForView = (options = {}) => {
  if (!isInternalCostBreakdown(options)) return options;
  return {
    ...options,
    itinerary: false,
    inclusions: false,
    exclusions: false
  };
};
