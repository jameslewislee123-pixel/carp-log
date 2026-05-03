export type Angler = { id: string; name: string; color: string; created_at?: string };

export type Trip = {
  id: string;
  name: string;
  location: string | null;
  start_date: string;
  end_date: string;
  notes: string | null;
  created_at?: string;
  updated_at?: string;
};

export type Weather = {
  tempC: number | null;
  pressure: number | null;
  wind: string | null;
  conditions: string | null;
};

export type Moon = {
  phase: number;       // 0..1 (0=new, .5=full)
  fraction: number;    // illuminated fraction 0..1
  label: string;       // "Waxing Crescent" etc.
  emoji: string;       // 🌒 etc.
};

export type Comment = {
  id: string;
  anglerId: string;
  anglerName: string;
  text: string;
  ts: number;
};

export type Catch = {
  id: string;
  angler_id: string;
  lost: boolean;
  lbs: number;
  oz: number;
  species: string | null;
  date: string;
  trip_id: string | null;
  lake: string | null;
  swim: string | null;
  bait: string | null;
  rig: string | null;
  notes: string | null;
  has_photo: boolean;
  weather: Weather | null;
  moon: Moon | null;
  comments: Comment[];
  created_at?: string;
  updated_at?: string;
};

export type NotifyConfig = {
  token: string | null;
  chat_id: string | null;
  enabled: boolean;
};
