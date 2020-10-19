export const convertName = (name: string): string => {
  return name
    .trim()
    .split('.')[0]
    .split(',')[0]
    .replace(/\s+/g, '_')
    .replace(/[^\w+\d+]/g, '');
};
