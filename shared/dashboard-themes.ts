export const themes = [
  'dash',
  'blue-flame',
  'system',
  'light',
  'dark',
  'cupcake',
  'bumblebee',
  'emerald',
  'corporate',
  'synthwave',
  'retro',
  'cyberpunk',
  'valentine',
  'halloween',
  'garden',
  'forest',
  'aqua',
  'lofi',
  'pastel',
  'fantasy',
  'wireframe',
  'black',
  'luxury',
  'dracula',
  'cmyk',
  'autumn',
  'business',
  'acid',
  'lemonade',
  'night',
  'coffee',
  'winter',
  'dim',
  'nord',
  'sunset',
] as const;

export const dashboardThemes = themes.filter(theme => theme !== 'system');
export type DashboardTheme = (typeof dashboardThemes)[number];

export function isDashboardTheme(value: unknown): value is DashboardTheme {
  return typeof value === 'string' && dashboardThemes.some(theme => theme === value);
}
