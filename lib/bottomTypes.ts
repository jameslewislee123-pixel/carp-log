// Canonical list of bottom-substrate types for rod spots. The DB column
// (rod_spots.bottom_type) is plain text with no CHECK constraint — this
// file is the source of truth for the allowed values, their display
// labels, and the emoji used on the map / in the spots list.

export const BOTTOM_TYPES = [
  { value: 'gravel',      label: 'Gravel',      emoji: '🪨' },
  { value: 'heavy_silt',  label: 'Heavy silt',  emoji: '🟫' },
  { value: 'light_silt',  label: 'Light silt',  emoji: '🟤' },
  { value: 'light_weed',  label: 'Light weed',  emoji: '🌿' },
  { value: 'heavy_weed',  label: 'Heavy weed',  emoji: '🌾' },
  { value: 'snags',       label: 'Snags',       emoji: '🪵' },
  { value: 'other',       label: 'Other',       emoji: '❓' },
] as const;

export type BottomType = typeof BOTTOM_TYPES[number]['value'];

export function bottomTypeMeta(value: string | null | undefined) {
  if (!value) return null;
  return BOTTOM_TYPES.find(t => t.value === value) || null;
}
