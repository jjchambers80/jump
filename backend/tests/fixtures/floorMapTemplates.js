export const expoHallTemplate = {
  version: 1,
  width: 60,
  height: 40,
  unit: 'ft',
  gridSize: 10,
  orientation: 'LANDSCAPE',
  zones: [
    { id: 'zone-exhibitors', label: 'Exhibitor Hall', x: 2, y: 5, w: 42, h: 30 },
    { id: 'zone-programming', label: 'Programming', x: 46, y: 5, w: 12, h: 30 },
  ],
  elements: [
    { id: 'main-stage', kind: 'stage', x: 47, y: 7, w: 10, h: 6, caption: 'Main Stage' },
    { id: 'north-wall', kind: 'wall', x: 2, y: 4, w: 56, h: 1, orientation: 'h' },
    { id: 'hall-label', kind: 'label', x: 2, y: 2, w: 12, h: 2, text: 'Convention Hall', size: 'L' },
    { id: 'entrance', kind: 'entrance', x: 25, y: 36, w: 6, h: 3, caption: 'Entrance' },
  ],
  booths: [
    { label: 'A1', kind: 'BOOTH', x: 5, y: 8, w: 8, h: 6, rotation: 0, tierLabel: 'Standard' },
    { label: 'A2', kind: 'BOOTH', x: 15, y: 8, w: 8, h: 6, rotation: 0, tierLabel: 'Standard' },
    { label: 'B1', kind: 'BOOTH', x: 5, y: 20, w: 18, h: 8, rotation: 90, tierLabel: 'Premium' },
    { label: 'T1', kind: 'TABLE', x: 30, y: 20, w: 6, h: 4, rotation: 0, tierLabel: null },
  ],
  legend: {
    title: 'Booth types',
    orientation: 'horizontal',
    tiers: [
      { tierLabel: 'Standard', label: 'Standard booth', swatch: 0 },
      { tierLabel: 'Premium', label: 'Premium booth', swatch: 1 },
    ],
  },
  metadata: {
    eventTitle: 'Event title',
    subtitle: 'Venue and date',
    brandColor: '#2563EB',
    themeMode: 'LIGHT',
  },
};
