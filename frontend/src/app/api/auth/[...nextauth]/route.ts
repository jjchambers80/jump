// frontend/src/app/api/auth/[...nextauth]/route.ts
// Auth.js route handler — exports GET and POST handlers

import { handlers } from '@/auth';

export const { GET, POST } = handlers;
