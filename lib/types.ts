// ============================================================
// Carp Log v2 — multi-user types
// ============================================================
export type Profile = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  public_profile: boolean;
  created_at?: string;
  updated_at?: string;
};

export type FriendshipStatus = 'pending' | 'accepted' | 'blocked';
export type Friendship = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  created_at?: string;
  updated_at?: string;
};

export type TripVisibility = 'private' | 'friends' | 'invited_only';
export type Trip = {
  id: string;
  owner_id: string;
  name: string;
  location: string | null;
  start_date: string;
  end_date: string;
  notes: string | null;
  visibility: TripVisibility;
  wager_enabled: boolean;
  wager_description: string | null;
  created_at?: string;
  updated_at?: string;
};

export type TripStatus = 'upcoming' | 'active' | 'completed';
export function tripStatus(t: Pick<Trip, 'start_date' | 'end_date'>): TripStatus {
  const now = Date.now();
  const s = new Date(t.start_date).getTime();
  const e = new Date(t.end_date).getTime();
  if (now < s) return 'upcoming';
  if (now <= e + 86400000) return 'active';
  return 'completed';
}

export type TripMessage = {
  id: string;
  trip_id: string;
  angler_id: string;
  text: string;
  created_at: string;
};

export type TripStake = {
  id: string;
  trip_id: string;
  angler_id: string;
  stake_text: string;
  created_at?: string;
  updated_at?: string;
};

export type TripActivityType = 'joined' | 'caught' | 'lost_fish' | 'commented' | 'joined_chat' | 'set_wager' | 'became_leader';
export type TripActivity = {
  id: string;
  trip_id: string;
  angler_id: string;
  type: TripActivityType;
  payload: Record<string, any>;
  created_at: string;
};

export type MemberRole = 'owner' | 'contributor';
export type MemberStatus = 'invited' | 'joined' | 'declined';
export type TripMember = {
  id: string;
  trip_id: string;
  angler_id: string;
  role: MemberRole;
  status: MemberStatus;
  invited_by: string | null;
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
  phase: number;
  fraction: number;
  label: string;
  emoji: string;
};

export type Comment = {
  id: string;
  anglerId: string;
  anglerName: string;
  text: string;
  ts: number;
};

export type CatchVisibility = 'public' | 'friends' | 'private';
export type Catch = {
  id: string;
  angler_id: string;
  trip_id: string | null;
  lost: boolean;
  lbs: number;
  oz: number;
  species: string | null;
  date: string;
  lake: string | null;
  swim: string | null;
  bait: string | null;
  rig: string | null;
  hook: string | null;
  notes: string | null;
  has_photo: boolean;
  weather: Weather | null;
  moon: Moon | null;
  latitude: number | null;
  longitude: number | null;
  lake_id: string | null;
  visibility: CatchVisibility;
  comments: Comment[];
  created_at?: string;
  updated_at?: string;
};

export type NotifyConfig = {
  id?: string;
  angler_id: string;
  token: string | null;
  chat_id: string | null;
  enabled: boolean;
};

export type NotificationType = 'friend_request' | 'friend_accepted' | 'trip_invite' | 'comment_on_catch' | 'trip_new_catch' | 'trip_new_member' | 'trip_chat_mention' | 'trip_chat';

// Comments are now a dedicated table. The legacy `Comment` type (jsonb shape)
// stays for back-compat — the in-DB array used to look like this.
export type CatchComment = {
  id: string;
  catch_id: string;
  angler_id: string;
  text: string;
  created_at: string;
};

export type CommentLike = {
  id: string;
  comment_id: string;
  angler_id: string;
  created_at: string;
};

export type SwimRollResult = { angler_id: string; value: number };
export type TripSwimRoll = {
  id: string;
  trip_id: string;
  rolled_by: string;
  results: SwimRollResult[];
  created_at: string;
};

export type GearType = 'rig' | 'bait' | 'hook';
export type GearItem = {
  id: string;
  angler_id: string;
  type: GearType;
  name: string;
  description: string | null;
  shared: boolean;
  active: boolean;
  created_at?: string;
  updated_at?: string;
};

export type LakeSource = 'manual' | 'osm' | 'imported';
export type Lake = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  created_by: string | null;
  // Provenance: 'manual' = user-typed, 'osm' = imported from OpenStreetMap.
  // Column added via SQL migration; defaults to 'manual' for legacy rows.
  source: LakeSource;
  created_at?: string;
};

export type LakeAnnotationType = 'productive_spot' | 'snag' | 'note' | 'hot_spot';
export type LakeAnnotation = {
  id: string;
  lake_id: string;
  angler_id: string;
  type: LakeAnnotationType;
  latitude: number;
  longitude: number;
  title: string;
  description: string | null;
  created_at?: string;
};
export type AppNotification = {
  id: string;
  recipient_id: string;
  type: NotificationType;
  payload: Record<string, any>;
  read: boolean;
  created_at: string;
};
