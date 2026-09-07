export interface BusinessDetails {
  id: string;
  name: string;
  businessType: string | null;
  nickname: string | null;
  countryCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phoneCountryCode: string | null;
  phoneNumber: string | null;
  hasEin: boolean;
  einMasked: string | null;
}

export interface BusinessDetailsPayload {
  name: string;
  businessType: string;
  nickname: string | null;
  countryCode: 'US';
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  postalCode: string;
  phoneCountryCode: '+1';
  phoneNumber: string | null;
  ein?: string | null;
}

export interface OrganizationPersonSummary {
  id: string;
  firstName: string;
  lastName: string;
  isAccountRepresentative: boolean;
}

export interface CreateOrganizationPersonPayload {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  isAccountRepresentative: boolean;
}

export const BUSINESS_TYPES = [
  { value: 'SOLE_PROPRIETORSHIP', label: 'Sole proprietorship' },
  { value: 'SINGLE_MEMBER_LLC', label: 'Single Member LLC' },
  { value: 'MULTI_MEMBER_LLC', label: 'Multi Member LLC' },
  { value: 'PARTNERSHIP', label: 'Partnership' },
  { value: 'C_CORPORATION', label: 'C corporation' },
  { value: 'S_CORPORATION', label: 'S corporation' },
  { value: 'NONPROFIT', label: 'Nonprofit' },
] as const;

export const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'],
  ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'],
  ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'],
  ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'],
  ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'],
  ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'],
  ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
  ['AS', 'American Samoa'], ['GU', 'Guam'], ['MP', 'Northern Mariana Islands'],
  ['PR', 'Puerto Rico'], ['VI', 'U.S. Virgin Islands'],
] as const;

export function businessTypeLabel(value: string | null) {
  return BUSINESS_TYPES.find((option) => option.value === value)?.label || value || 'Not provided';
}
