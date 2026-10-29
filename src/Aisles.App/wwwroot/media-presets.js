// Physical dimensions in millimetres: case [width, height, depth], medium [width, height or thickness].
export const PRESETS = {
  jewel: { case: [142, 125, 10], inlay: [120, 120], clear: true, medium: { kind: 'disc', size: [120, 1.2] }, mediumName: 'CD-ROM' },
  dvd: { case: [135, 190, 14], inlay: [129, 183], medium: { kind: 'disc', size: [120, 1.2] }, mediumName: 'DVD-ROM' },
  bluray: { case: [135, 171.5, 13], inlay: [129, 166], medium: { kind: 'disc', size: [120, 1.2] }, mediumName: 'Blu-ray' },
  gamecube: { case: [135, 190, 14], inlay: [129, 183], medium: { kind: 'disc', size: [80, 1.2] }, mediumName: 'miniDVD' },
  ds: { case: [135, 122, 15], inlay: [131, 118], mediumBody: '#2b2b31', medium: { kind: 'card', size: [33, 35, 3.8] }, mediumName: 'Game card' },
  '3ds': { case: [135, 122, 14], inlay: [131, 118], mediumBody: '#2b2b31', medium: { kind: 'card', size: [35, 33, 3.8] }, mediumName: 'Game card' },
  xbox360: { case: [135, 190, 14], inlay: [129, 183], medium: { kind: 'disc', size: [120, 1.2] }, mediumName: 'DVD-ROM' },
};

const BY_MEDIA = { JewelCase: 'jewel', DvdCase: 'dvd', BluRayCase: 'bluray', MiniDiscCase: 'gamecube', CartridgeCase: 'ds' };
export function presetFor(console) {
  return PRESETS[console?.id] ?? PRESETS[BY_MEDIA[console?.media]] ?? PRESETS.dvd;
}
