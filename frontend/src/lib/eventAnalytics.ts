export interface RsvpAnalyticsSummary {
  headcount: number;
  rsvpCount: number;
  cancelledCount: number;
  remaining: number | null;
}

export interface AnalyticsCard {
  label: string;
  value: string | number;
  subtext: string;
  color: 'indigo' | 'green' | 'blue' | 'amber';
}

export function rsvpAnalyticsCards(
  summary: RsvpAnalyticsSummary,
  limit: number | null
): AnalyticsCard[] {
  return [
    {
      label: 'Expected headcount',
      value: summary.headcount,
      subtext: limit === null ? 'Unlimited capacity' : `of ${limit} capacity`,
      color: 'indigo',
    },
    {
      label: 'RSVPs',
      value: summary.rsvpCount,
      subtext: 'going responses',
      color: 'green',
    },
    {
      label: 'Remaining',
      value: summary.remaining === null ? 'Unlimited' : summary.remaining,
      subtext: 'RSVP spots available',
      color: 'blue',
    },
    {
      label: 'Cancelled',
      value: summary.cancelledCount,
      subtext: 'cancelled responses',
      color: 'amber',
    },
  ];
}
