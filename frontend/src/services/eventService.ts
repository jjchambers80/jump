import { api } from './api';

export interface Event {
  id: string;
  name: string;
  description: string;
  venue: string;
  eventDate: string;
  ticketPrice: number;
  availableTickets: number;
  totalTickets: number;
  status: string;
}

export interface EventListResponse {
  events: Event[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

class EventService {
  /**
   * List all published events with pagination
   * @param page - Page number (default: 1)
   * @param limit - Items per page (default: 20)
   * @returns Promise with event list and pagination info
   */
  async listEvents(page: number = 1, limit: number = 20): Promise<EventListResponse> {
    return api.get<EventListResponse>(`/events?page=${page}&limit=${limit}`);
  }

  /**
   * Get event details by ID
   * @param eventId - Event UUID
   * @returns Promise with event details
   */
  async getEventById(eventId: string): Promise<Event> {
    return api.get<Event>(`/events/${eventId}`);
  }
}

export default new EventService();
