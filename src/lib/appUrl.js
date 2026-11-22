export const appUrl = (path, {
  origin = window.location.origin,
  baseUrl = import.meta.env.VITE_APP_URL
} = {}) => {
  const base = new URL((baseUrl || origin).trim());
  const destination = new URL(path, base);
  if (destination.origin !== base.origin) {
    throw new Error('Application links must stay on the configured application origin');
  }
  return destination.toString();
};
