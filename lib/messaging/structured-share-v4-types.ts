export type StructuredShareOption = {
  kind: "plan" | "event";
  id: string;
  title: string;
  startsAt: string | null;
  locationLabel: string | null;
  contextLabel: string;
};

export type StructuredContactPayload = {
  kind: "contact";
  displayName: string;
  phone: string | null;
  email: string | null;
  organization: string | null;
};

export type StructuredPlacePayload = {
  kind: "place";
  placeName: string;
  areaLabel: string | null;
  addressLabel: string | null;
  placeKind: "venue" | "area";
};

export type StructuredAgendaPayload = {
  kind: "agenda";
  refKind: "plan" | "event";
  refId: string;
  title: string;
  startsAt: string | null;
  locationLabel: string | null;
};

export type StructuredMessagePayload =
  | StructuredContactPayload
  | StructuredPlacePayload
  | StructuredAgendaPayload;
