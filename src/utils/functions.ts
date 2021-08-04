export const convertName = (name: string): string => {
  if (/^\d+$/.test(name)) {
    return 'teste';
  }

  if (name === '') {
    return 'idx';
  }

  return name
    .trim()
    .split('.')[0]
    .split(',')[0]
    .replace(/\s+/g, '_')
    .replace(/[^\w+\d+]/g, '')
    .replace('Index', 'idx');
};

export const getFilename = (name: string): [string, string] => {
  const nameSplit = name.split('.');
  const extension = nameSplit.pop();
  const nameWithoutExtension = nameSplit.join('.');

  return [convertName(nameWithoutExtension), extension];
};
