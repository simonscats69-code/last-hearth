// packages/client/src/types.ts
// Client-specific type definitions

export interface ClientPlayerState {
  health: number;
  max_health: number;
  radiation: number;
  fatigue: number;
  energy: number;
  max_energy: number;
  infections: number;
  infections_list: Array<{ type: string; level: number; expires_at: string }>;
  last_energy_update: string | null;
}

export interface ClientInventoryItem {
  id: number;
  name: string;
  type: string;
  category?: string;
  rarity: string;
  price: number;
  icon: string;
  stats: Record<string, number>;
  slot?: string;
  damage?: number;
  defense?: number;
  heal?: number;
  rad_removal?: number;
  radiation_resist?: number;
  infection_resist?: number;
  durability: number;
  max_durability: number;
  quantity: number;
  upgrade_level: number;
  modifications: Record<string, number>;
}

export interface ClientEquipment {
  weapon?: ClientInventoryItem;
  armor?: ClientInventoryItem;
  head?: ClientInventoryItem;
  body?: ClientInventoryItem;
  hands?: ClientInventoryItem;
  legs?: ClientInventoryItem;
  boots?: ClientInventoryItem;
  accessory?: ClientInventoryItem;
}

export interface UIAction {
  type: string;
  payload?: unknown;
  timestamp: number;
}

export type UIState = {
  currentView: string;
  modal: { open: boolean; type: string; data?: unknown } | null;
  notifications: Array<{ id: string; message: string; type: 'success' | 'error' | 'info' }>;
  isLoading: boolean;
};
