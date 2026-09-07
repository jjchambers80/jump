import { api } from './api';

export interface PurchaseRequest {
  eventId: string;
  quantity: number;
  email: string;
}

export interface PurchaseResponse {
  sessionId: string;
  checkoutUrl: string;
}

export interface Ticket {
  id: string;
  eventId: string;
  customerId: string;
  eventName: string;
  eventDate: string;
  venue: string;
  customerEmail: string;
  ticketNumber: number;
  qrCode: string;
  qrCodeJwt: string;
  purchaseDate: string;
  purchaseTime: string;
  pricePaid: number;
  priceTierDescription?: string;
  saleStatus?: string;
  saleEndDate?: string;
  isRefundable?: boolean;
  priceBreakdown?: {
    subtotal: number;
    platformFee: number;
    processingFee: number;
    tax: number;
    total: number;
  };
  status: string;
  event?: {
    name: string;
    date: string;
    venue: string;
  };
}

export interface ConfirmResponse {
  tickets: Ticket[];
}

class TicketService {
  /**
   * Purchase tickets for an event
   * @param eventId - Event UUID
   * @param quantity - Number of tickets (1-10)
   * @param email - Customer email address
   * @returns Promise with Stripe checkout session details
   */
  async purchaseTickets(
    eventId: string,
    quantity: number,
    email: string
  ): Promise<PurchaseResponse> {
    return api.post<PurchaseResponse>('/tickets/purchase', {
      eventId,
      quantity,
      email,
    });
  }

  /**
   * Confirm purchase after Stripe success and retrieve tickets
   * @param sessionId - Stripe session ID from URL query parameter
   * @returns Promise with tickets and QR codes
   */
  async confirmPurchase(sessionId: string): Promise<ConfirmResponse> {
    return api.get<ConfirmResponse>(`/tickets/confirm?session_id=${sessionId}`);
  }

  /**
   * Get customer's ticket history
   * @returns Promise with array of tickets
   */
  async getMyTickets(): Promise<{ tickets: Ticket[] }> {
    return api.get<{ tickets: Ticket[] }>('/tickets/my');
  }

  /**
   * Get single ticket details by ID
   * @param ticketId - Ticket UUID
   * @returns Promise with ticket details
   */
  async getTicketById(ticketId: string): Promise<Ticket> {
    return api.get<Ticket>(`/tickets/${ticketId}`);
  }
}

export default new TicketService();
