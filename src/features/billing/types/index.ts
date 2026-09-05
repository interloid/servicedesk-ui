export interface DbPlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_month: string;
  seat_limit: number;
  ticket_limit: number;
  storage_limit_mb: number;
  features_json: Record<string, unknown> | string;
  is_active: boolean;
  sort_order: number;
}

export interface FormattedFeature {
  label: string;
  value: string | boolean;
}

export interface FormattedPlan {
  id: string;
  code: string;
  name: string;
  price: string;
  priceValue: number;
  priceSuffix: string;
  description: string;
  features: FormattedFeature[];
}
