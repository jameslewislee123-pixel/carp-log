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
  location: string | null;       // legacy free-text location (kept for back-compat)
  lake_id: string | null;        // canonical FK to lakes; new trips set this, legacy trips have null
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
// Per-field privacy: any of these fields can be flagged 'private' by the
// creator so other viewers see "Hidden by angler" instead of the value.
// Anything not in the map is implicitly 'public'.
export type FieldVisibility = Partial<Record<'lake' | 'swim' | 'bait' | 'rig' | 'notes', 'public' | 'private'>>;

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
  // Optional links to the angler's pinned swim/rod data. Both nullable —
  // catches saved with text-only `swim` keep working unchanged. swim_group_id
  // matches rod_spots.swim_group_id; rod_spot_id is a true FK.
  swim_group_id: string | null;
  rod_spot_id: string | null;
  visibility: CatchVisibility;
  field_visibility: FieldVisibility;
  // Ordered list of public storage URLs. Index 0 is the cover. Always has
  // length 0 for lost-fish records. For legacy single-photo catches this
  // was backfilled by the migration to contain the one
  // {angler_id}/{catch_id}.jpg URL.
  photo_urls: string[];
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

export type NotificationType = 'friend_request' | 'friend_accepted' | 'trip_invite' | 'comment_on_catch' | 'trip_new_catch' | 'trip_new_member' | 'trip_chat_mention' | 'trip_chat' | 'catch_liked';

// Comments are now a dedicated table. The legacy `Comment` type (jsonb shape)
// stays for back-compat — the in-DB array used to look like this.
export type CatchComment = {
  id: string;
  catch_id: string;
  angler_id: string;
  text: string;
  created_at: string;
};

// Composite-PK row from catch_likes. We rarely need the full row in the
// UI — most reads project to count + a Set of catch_ids the current user
// has liked.
export type CatchLike = {
  catch_id: string;
  angler_id: string;
  created_at?: string;
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

export type LakeSource = 'manual' | 'osm' | 'imported' | 'nominatim' | 'seed';
export type LakePhotoSource = 'wikipedia' | 'satellite';
export type Lake = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  created_by: string | null;
  // Provenance: 'manual' = user-typed, 'osm' = imported from
  // OpenStreetMap (Overpass nearby), 'nominatim' = global name search.
  source: LakeSource;
  // Search metadata (added 0011). All optional — legacy rows have null.
  osm_id?: number | null;
  osm_type?: string | null;
  country?: string | null;
  region?: string | null;
  importance?: number | null;
  photo_url?: string | null;
  photo_source?: LakePhotoSource | null;
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

export type RodSpot = {
  id: string;
  user_id: string;
  lake_id: string;
  // Sibling rods cast from the same swim share a swim_group_id. Solo
  // single-rod spots get their own unique group_id (one rod per group).
  swim_group_id: string;
  swim_latitude: number;
  swim_longitude: number;
  swim_label: string | null;
  spot_latitude: number;
  spot_longitude: number;
  spot_label: string | null;
  wraps_calculated: number | null;
  wraps_actual: number | null;
  features: string | null;
  // Categorical substrate from BOTTOM_TYPES. Free-text 'features' covers
  // nuance like "gravel patch with weed edge"; bottom_type is the
  // at-a-glance icon. Optional.
  bottom_type: string | null;
  // Default gear for this rod spot — when set, AddCatch's SwimRodPicker
  // pre-fills the catch's bait/rig/hook on rod selection (only if that
  // catch field is still empty). All optional FKs to gear_items.id.
  default_bait_id: string | null;
  default_rig_id: string | null;
  default_hook_id: string | null;
  created_at?: string;
  updated_at?: string;
};
// Junction row linking a trip to one of the user's swim_group_ids. As of
// migration 0022 this also stores the swim's coords + label directly, so a
// "Setup" exists as soon as the row is created — rod_spots aren't required
// for a swim marker to render on the trip Map tab. ended_at is null while
// the setup is active; non-null once the user ends it.
export type TripSwimGroup = {
  id: string;
  trip_id: string;
  swim_group_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  notes: string | null;
  swim_latitude: number | null;
  swim_longitude: number | null;
  swim_label: string | null;
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
