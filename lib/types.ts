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
  created_at?: string;
  updated_at?: string;
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
  notes: string | null;
  has_photo: boolean;
  weather: Weather | null;
  moon: Moon | null;
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

export type NotificationType = 'friend_request' | 'friend_accepted' | 'trip_invite' | 'comment_on_catch';
export type AppNotification = {
  id: string;
  recipient_id: string;
  type: NotificationType;
  payload: Record<string, any>;
  read: boolean;
  created_at: string;
};
